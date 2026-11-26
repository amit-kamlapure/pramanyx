"""Thin async HTTP client over the running Pramanyx REST API — the substrate the MCP
server's governed tools call.

Keeping the MCP layer a *client* (not an in-process import of the FastAPI app) is a
deliberate choice: every tool then runs the exact governed path the web UI runs —
cost metering, agent governance/budgets, capability gating, and Trust Receipts all
happen in the API process, not a second copy of it. The MCP server stays stateless
and light (httpx only), so it starts fast under a stdio launcher and never spins up a
second JobKernel.

Two of the surfaces are SSE streams (``/chat`` and a deep ``/ask``); the rest are
plain JSON. ``_stream_sse`` parses Pramanyx's framing (one ``data: {"type": …}`` line
per event) and the high-level ``ask``/``deep_analysis`` helpers fold the stream into a
single result an MCP tool can return.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from contextvars import ContextVar
from typing import Any, AsyncIterator, Optional

import httpx

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "http://127.0.0.1:8000"
# Sample caps — an MCP result feeds an LLM context, so we never return the full
# (up to 10k-row) result set; we return a sample + the true row_count.
_ROW_SAMPLE = 50
_FINDING_CAP = 25

# DE-2a (ROADMAP §3.51) — the principal this client acts as. The API's identity mode
# (`PRAMANYX_REQUIRE_IDENTITY=1`) resolves a caller from an OIDC bearer, or — while no issuer
# is configured — from the `X-Pramanyx-Org` / `X-Pramanyx-User` seam (`security/authz`). This
# client sent neither, so every MCP call was refused with a 401 the moment identity was
# required. The header names are spelled here rather than
# imported: this module stays httpx-only by design, and a test holds the two spellings equal.
IDENTITY_ORG_HEADER = "X-Pramanyx-Org"
IDENTITY_USER_HEADER = "X-Pramanyx-User"
#: DE-2b — the mark that makes a request an agent's own, and the tool it serves. Spelled here
#: so this module stays httpx-only; `pramanyx.mcp.policy` imports them from here.
AGENT_HEADER = "X-Pramanyx-Agent"
#: `security.delegation.HEADER`, spelled here so the client imports nothing of the API's.
DELEGATION_HEADER = "X-Pramanyx-Delegation"


def _kept_clock() -> str:
    """The zone the coworker's page said its browser is in (``PRAMANYX_CLOCK_FILE``), or ""."""
    path = os.environ.get("PRAMANYX_CLOCK_FILE", "").strip()
    if not path:
        return ""
    try:
        with open(path, encoding="utf-8") as f:
            zone = f.read(64).strip()
    except OSError:
        return ""
    from pramanyx.kernel.clock import readable_zone
    return readable_zone(zone)


def _delegation() -> str:
    """The delegation the coworker's host keeps (``PRAMANYX_DELEGATION_FILE``), or ""."""
    path = os.environ.get("PRAMANYX_DELEGATION_FILE", "").strip()
    if not path:
        return ""
    try:
        with open(path, encoding="utf-8") as f:
            return f.read(256).strip()
    except OSError:
        return ""
TOOL_HEADER = "X-Pramanyx-Tool"
AGENT_MARK = "mcp"
#: The MCP tool a request serves, set by the server around each call (`PolicedFastMCP`).
CURRENT_TOOL: ContextVar[str] = ContextVar("pramanyx_mcp_current_tool", default="")
#: Arc ED, ED-2 — a service principal's headers, spelled here as `security.service_principals` spells them (a test holds
#: the two equal), and the HTTP caller a request acts as, set by the server around each list and call
#: (`mcp/callers.py`): ``(name, key)``, or None for this process's own principal.
SERVICE_NAME_HEADER = "X-Pramanyx-Service"
SERVICE_KEY_HEADER = "X-Pramanyx-Service-Key"
CURRENT_CALLER: ContextVar[Optional[tuple[str, str]]] = ContextVar("pramanyx_mcp_current_caller", default=None)


#: What a brought-in file becomes, by its extension: a table to ask about, or a document to read.
SHEET_EXTENSIONS = frozenset({".csv", ".tsv", ".xlsx", ".parquet", ".parq", ".json"})
DOCUMENT_EXTENSIONS = frozenset({".pdf", ".docx", ".doc", ".pptx", ".ppt", ".md", ".markdown", ".txt", ".html", ".htm",
                                 ".rtf", ".odt"})
#: The most a brought-in file may weigh: the sheets' own staging limit.
MAX_ATTACHED_BYTES = 512 * 1024 * 1024


def attached_file(path: str) -> "tuple[str, int] | str":
    """``(real path, size)`` of a file the person attached in the coworker, or why it cannot be read. Only a file inside
    the coworker's attachments folder is read — resolved, so neither ``..`` nor a link leads out of it."""
    root = (os.environ.get("PRAMANYX_ATTACHMENTS_DIR") or "").strip()
    if not root:
        return "attached files are not readable here: the coworker did not say where it keeps them"
    root_real = os.path.realpath(root)
    real = os.path.realpath(os.path.expanduser(str(path or "").strip()))
    if not real.startswith(root_real + os.sep):
        return "only a file the person attached in this conversation is brought in; that path is not one"
    if not os.path.isfile(real):
        return "no attached file is there"
    size = os.path.getsize(real)
    if size > MAX_ATTACHED_BYTES:
        return f"the file is {size // (1024 * 1024)} MB; the most brought in is {MAX_ATTACHED_BYTES // (1024 * 1024)} MB"
    return real, size


#: How long one `get_investigation` call waits on a run still going, and how often it reads it meanwhile. Under the
#: shell's six-minute tool limit, with room for the deep call's own wait (`PRAMANYX_MCP_DEEP_TIMEOUT`) before it.
READ_WAIT_S = 120.0
READ_EVERY_S = 5.0
#: How long the call's deadline waits to read how far a run it hands back has got.
PROGRESS_READ_S = 5.0


def _running(rec: Any) -> bool:
    return isinstance(rec, dict) and str(rec.get("status") or "") in ("running", "pending", "started")


class PramanyxError(RuntimeError):
    """A Pramanyx API call failed (a non-2xx response or a transport error). The
    message is shaped for an LLM client — capability-locked (402) and not-found
    (404) read cleanly rather than as raw stack traces."""


class PramanyxClient:
    """An async client over the Pramanyx REST API.

    Config comes from the environment so a stdio launcher (Claude Desktop/Code/Cursor)
    can set it once: ``PRAMANYX_API_URL`` (default ``http://127.0.0.1:8000``),
    ``PRAMANYX_API_KEY`` (sent as ``X-Api-Key`` when set), ``PRAMANYX_MCP_TIMEOUT`` (plain
    calls, default 60s), ``PRAMANYX_MCP_DEEP_TIMEOUT`` (the streaming ask/deep tools,
    default 300s). Tests inject ``transport=httpx.ASGITransport(app=…)`` to drive the
    real app in-process.

    The principal (DE-2a), when the API requires identity: ``PRAMANYX_MCP_BEARER`` is sent as
    ``Authorization: Bearer …`` (an OIDC token, for an API with an issuer configured);
    ``PRAMANYX_MCP_ORG`` and ``PRAMANYX_MCP_USER`` (default ``mcp``) are sent as the
    ``X-Pramanyx-Org`` / ``X-Pramanyx-User`` seam a self-hosted API resolves while no issuer is
    configured. Unset, nothing is sent and identity-off installs are byte-identical.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        *,
        timeout: Optional[float] = None,
        deep_timeout: Optional[float] = None,
        read_wait: Optional[float] = None,
        transport: Optional[httpx.BaseTransport] = None,
        org: Optional[str] = None,
        user: Optional[str] = None,
        bearer: Optional[str] = None,
    ) -> None:
        self.base_url = (base_url or os.environ.get("PRAMANYX_API_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.api_key = api_key if api_key is not None else os.environ.get("PRAMANYX_API_KEY", "")
        self.timeout = float(timeout if timeout is not None else os.environ.get("PRAMANYX_MCP_TIMEOUT", "60"))
        self.deep_timeout = float(
            deep_timeout if deep_timeout is not None else os.environ.get("PRAMANYX_MCP_DEEP_TIMEOUT", "300")
        )
        # How long `get_investigation` waits on a run still going before it says how far it has got (`READ_WAIT_S`).
        self.read_wait = float(read_wait if read_wait is not None else READ_WAIT_S)
        self._transport = transport
        self.org = (org if org is not None else os.environ.get("PRAMANYX_MCP_ORG", "")).strip()
        self.user = (user if user is not None else os.environ.get("PRAMANYX_MCP_USER", "")).strip()
        self.bearer = (bearer if bearer is not None else os.environ.get("PRAMANYX_MCP_BEARER", "")).strip()

    # ── plumbing ────────────────────────────────────────────────────────────────
    def _headers(self) -> dict[str, str]:
        h = {"accept": "application/json"}
        if self.api_key:
            h["X-Api-Key"] = self.api_key
        # Arc ED, ED-2 — an HTTP caller let in as itself: its own service principal, and none of this process's.
        caller = CURRENT_CALLER.get()
        if caller is not None:
            h[SERVICE_NAME_HEADER], h[SERVICE_KEY_HEADER] = caller
        # DE-2a — the principal this client acts as, so an API that requires identity can
        # resolve one: a verified bearer where an issuer is configured, the header seam where
        # not. The user defaults to `mcp` once an org is named, so the audit row says who.
        elif self.bearer:
            h["Authorization"] = f"Bearer {self.bearer}"
        if self.org and caller is None:
            h[IDENTITY_ORG_HEADER] = self.org
            h[IDENTITY_USER_HEADER] = self.user or "mcp"
        # DE-2b — every call this client makes is an agent's own, and says which tool it serves,
        # so the API applies the organisation's agent policy to it and audits it with its principal.
        h[AGENT_HEADER] = AGENT_MARK
        # People (2026-11-15) — the person the app handed the coworker, kept by the coworker's host in a file only
        # this account reads (`security/delegation.py`). Read on every call, so a new one applies without a restart;
        # never from a tool argument, so the model cannot choose who it acts for. Not for an HTTP caller let in as
        # itself: that one is its own principal.
        if caller is None:
            person = _delegation()
            if person:
                h[DELEGATION_HEADER] = person
            # 2026-11-17 — the person's clock, kept beside them by the coworker's host: the platform counts "yesterday"
            # from this person's today (`kernel/clock.py`).
            zone = _kept_clock()
            if zone:
                from pramanyx.kernel.clock import CLOCK_HEADER
                h[CLOCK_HEADER] = zone
        tool = CURRENT_TOOL.get()
        if tool:
            h[TOOL_HEADER] = tool
        return h

    def _mk_client(self, timeout: Optional[float] = None) -> httpx.AsyncClient:
        kw: dict[str, Any] = {
            "base_url": self.base_url,
            "headers": self._headers(),
            "timeout": timeout if timeout is not None else self.timeout,
        }
        if self._transport is not None:
            kw["transport"] = self._transport
        return httpx.AsyncClient(**kw)

    @staticmethod
    def _err_message(status: int, detail: str, path: str) -> str:
        """One LLM-friendly error string for both the JSON and the streaming paths —
        a capability lock (402) and a not-found (404) read cleanly, not as stack traces."""
        if status == 402:
            return f"{path}: capability locked — {detail}"
        if status == 404:
            return f"{path}: not found — {detail}"
        return f"{path}: HTTP {status} — {detail}"

    @classmethod
    def _unwrap(cls, r: httpx.Response, path: str) -> Any:
        if r.status_code >= 400:
            raise PramanyxError(cls._err_message(r.status_code, _safe_detail(r), path))
        try:
            return r.json()
        except Exception:
            return r.text

    async def _get(self, path: str, params: Optional[dict] = None) -> Any:
        async with self._mk_client() as c:
            try:
                r = await c.get(path, params=_clean(params))
            except httpx.HTTPError as e:
                raise PramanyxError(f"GET {path} failed — is the Pramanyx API running at {self.base_url}? ({e})") from e
        return self._unwrap(r, path)

    async def _post(self, path: str, json_body: Optional[dict] = None, params: Optional[dict] = None) -> Any:
        async with self._mk_client() as c:
            try:
                r = await c.post(path, json=json_body, params=_clean(params))
            except httpx.HTTPError as e:
                raise PramanyxError(f"POST {path} failed — is the Pramanyx API running at {self.base_url}? ({e})") from e
        return self._unwrap(r, path)

    async def _delete(self, path: str) -> Any:
        async with self._mk_client() as c:
            try:
                r = await c.delete(path)
            except httpx.HTTPError as e:
                raise PramanyxError(f"DELETE {path} failed — is the Pramanyx API running at {self.base_url}? ({e})") from e
        return self._unwrap(r, path)

    async def _post_file(self, path: str, name: str, data: bytes) -> Any:
        async with self._mk_client() as c:
            try:
                r = await c.post(path, files={"file": (name, data)}, timeout=180.0)
            except httpx.HTTPError as e:
                raise PramanyxError(f"POST {path} failed — is the Pramanyx API running at {self.base_url}? ({e})") from e
        return self._unwrap(r, path)

    async def _stream_sse(
        self, method: str, path: str, json_body: Optional[dict] = None, *, timeout: Optional[float] = None
    ) -> AsyncIterator[dict]:
        """Yield each Pramanyx SSE event as a dict. Pramanyx frames every event as a
        single ``data: {"type": …, …}`` line (see investigations._sse)."""
        async with self._mk_client(timeout=timeout if timeout is not None else self.deep_timeout) as c:
            async with c.stream(method, path, json=json_body) as r:
                if r.status_code >= 400:
                    await r.aread()
                    raise PramanyxError(self._err_message(r.status_code, _safe_detail(r), path))
                async for line in r.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    payload = line[len("data:"):].strip()
                    if not payload:
                        continue
                    try:
                        yield json.loads(payload)
                    except json.JSONDecodeError:
                        logger.debug("skipping non-JSON SSE data line on %s", path)
                        continue

    # ── governed tools ──────────────────────────────────────────────────────────
    async def list_connections(self) -> list[dict]:
        conns = await self._get("/connections")
        out = []
        for c in conns if isinstance(conns, list) else []:
            out.append({
                "id": c.get("id"),
                "name": c.get("name"),
                "dialect": c.get("dialect") or c.get("conn_type"),
                "schemas": c.get("schemas") or c.get("schema_names"),
            })
        return out

    # ── DS-14: chains as tools ──────────────────────────────────────────────────
    async def list_automation_tools(self) -> list[dict]:
        """The automations this deployment offers as MCP tools.

        Read at server start, so what an external agent can invoke is whatever the
        deployment has OPTED IN — never every automation it happens to hold.
        """
        payload = await self._get("/automations/tools")
        tools = payload.get("tools") if isinstance(payload, dict) else payload
        return list(tools or [])

    # ── SP-5: the Spotlight roster, one declaration for every transport ─────────
    async def list_spotlight_tools(self) -> list[dict]:
        """The declared Spotlight roster (name/description/parameters), read at
        server start — the MCP transport registers FROM the declaration, never a
        hand-kept copy, which is what keeps the parity diff empty."""
        payload = await self._get("/spotlight/tools")
        tools = payload.get("tools") if isinstance(payload, dict) else payload
        return list(tools or [])

    async def call_spotlight_tool(self, name: str, *, connection: str = "",
                                  args: Optional[dict] = None) -> Any:
        """One Spotlight call through the API — the stores stay behind their one
        writer; this process never opens them."""
        return await self._post(f"/spotlight/tools/{name}",
                                json_body={"connection_id": connection,
                                           "args": dict(args or {})})

    async def run_automation(self, automation_id: str) -> dict:
        """Fire one automation through the SAME route the web app's "Run now" uses.

        Not a private path for external callers: it lands in the one engine, records a run
        row, and stops for the approval gate exactly as a scheduled tick would. That is the
        whole claim of exposing a chain as a tool — the caller changes, the governance does
        not.
        """
        return await self._post(f"/automations/{automation_id}/run")

    # ── AO-5a: custom agents as tools ───────────────────────────────────────────
    async def list_user_agents(self) -> list[dict]:
        """The deployment's custom agents (the roster the registrar reads at start). Kept a moment, so the grounding
        roster reads whether there is an agent to ground off this same answer rather than asking the API again
        (FA-7)."""
        payload = await self._get("/agents/custom")
        rows = list(payload or []) if isinstance(payload, list) else []
        self._agents_seen = (time.monotonic(), rows)
        return rows

    async def recent_user_agents(self, max_age: float) -> list[dict]:
        """The custom agents as last read, when that was under ``max_age`` seconds ago; otherwise read again."""
        seen = getattr(self, "_agents_seen", None)
        if seen and time.monotonic() - seen[0] < max_age:
            return seen[1]
        return await self.list_user_agents()

    async def ask_as_agent(self, agent_id: str, question: str, connection: str = "", *,
                           asker: str = "") -> dict:
        """One question through `/ask` AS a custom agent, folded to one answer — by the same
        fold the HTTP door makes server-side (`custom_agents/reach.fold_frame`): headline,
        the SQL that ran, rows (capped), receipt and investigation id. This process is the
        principal (`api:mcp:<asker>`), attributed by the ask door when no session is in scope."""
        body = {
            "question": question, "connection_id": connection or "workspace",
            "agent_id": agent_id, "depth": "quick", "allow_clarify": False,
            "principal_ref": f"api:mcp:{(asker or 'anonymous')[:64]}", "history": [],
            "session_id": "",
        }
        # The server's own fold, frame by frame — not a copy of it. This had a copy, and the copy kept the
        # first query's columns over every query's rows under the last query's SQL (receipt 2026-11-13).
        from pramanyx.custom_agents.reach import finish_fold, fold_frame, start_fold
        acc = start_fold(agent_id, question)
        async for ev in self._stream_sse("POST", "/ask", body, timeout=self.deep_timeout):
            fold_frame(acc, ev)
        acc = finish_fold(acc)
        acc.pop("frames", None)   # the door's own count of what it read; no use to a tool's caller
        return acc

    # ── Arc FA, FA-7: the grounding read ────────────────────────────────────────

    async def ground_agent(self, agent_id: str, question: str, *, connection: Optional[str] = None,
                           asker: str = "") -> dict:
        """What a custom agent would read for a question, through the session route — so the agent gate holds and
        audits the call like every other tool's. No model is asked."""
        from urllib.parse import quote
        return await self._get(f"/agents/custom/{quote(agent_id, safe='')}/grounding",
                               params={"question": question, "connection_id": connection, "asker": asker or None})

    async def ask(
        self,
        question: str,
        connection: str,
        *,
        canvas: Optional[str] = None,
        history: Optional[list] = None,
        with_receipt: bool = True,
    ) -> dict:
        """Drive ``/chat`` to completion and fold the stream into one governed answer
        + its Trust Receipt."""
        body = {
            "question": question,
            "connection_id": connection,
            "canvas_id": canvas,
            "history": history or [],
            "session_id": "",
        }
        acc: dict[str, Any] = {
            "question": question, "connection": connection, "answer": None, "sql": None,
            "columns": None, "rows": None, "row_count": None, "chart_type": None,
            "analysis": None, "trusted_metrics": None, "tables_used": None,
            # What the platform itself wrote about the rows, and how it would draw them. A caller that shows the
            # answer shows these, so it does not have a second model retell the first.
            "narrative": None, "chart_config": None, "followups": None,
            # What the platform itself says is wrong with the answer, when it says anything: `kind`
            # "not_what_was_asked" is a verdict it checked on the rows, anything else a model's suspicion.
            "warning": None,
            "investigation_id": None, "has_receipt": False, "error": None,
        }
        async for ev in self._stream_sse("POST", "/chat", body, timeout=self.deep_timeout):
            t = ev.get("type")
            if t == "sql":
                acc["sql"] = ev.get("sql")
            elif t == "columns":
                acc["columns"] = ev.get("columns")
            elif t == "rows":
                rows = ev.get("rows") or []
                acc["row_count"] = len(rows)
                acc["rows"] = rows[:_ROW_SAMPLE]
            elif t == "headline":
                acc["answer"] = ev.get("headline")
            elif t == "chart_type":
                acc["chart_type"] = ev.get("chart_type")
            elif t == "analysis":
                acc["analysis"] = {"intent": ev.get("intent"), "steps": ev.get("steps")}
            elif t == "trusted":
                acc["trusted_metrics"] = ev.get("items")
            elif t == "tables_used":
                acc["tables_used"] = ev.get("tables")
            elif t == "chart_config":
                acc["chart_config"] = ev.get("chart_config")
            elif t == "narrative":
                acc["narrative"] = {k: ev.get(k) for k in ("narrative", "anomalies", "trend", "confidence")}
            elif t == "followups":
                acc["followups"] = ev.get("questions")
            elif t == "inspect_warning":
                acc["warning"] = {"issues": ev.get("issues") or [], "suggested_fix": ev.get("suggested_fix") or "",
                                  "kind": ev.get("kind") or ""}
            elif t == "error":
                acc["error"] = ev.get("message")
            elif t == "done":
                acc["investigation_id"] = ev.get("inv_id")
                acc["has_receipt"] = bool(ev.get("has_receipt"))
        if acc["error"] and acc["answer"] is None:
            raise PramanyxError(f"ask failed: {acc['error']}")
        if with_receipt and acc["investigation_id"] and acc["has_receipt"]:
            try:
                acc["receipt"] = await self._get(f"/chat/{connection}/{acc['investigation_id']}/receipt")
            except PramanyxError:
                acc["receipt"] = None
        return acc

    async def _drive_deep(self, body: dict, acc: dict) -> None:
        """Read a deep ``/ask`` stream, folding each frame into ``acc`` as it lands — so a caller that stops waiting
        still holds what arrived, the run's id first of all."""
        async for ev in self._stream_sse("POST", "/ask", body, timeout=self.deep_timeout):
            t = ev.get("type")
            if t == "route" and ev.get("downgraded_from") == "deep":
                # `/ask` degrades a deep turn the licence does not cover to a quick one; asked for a deep
                # analysis, say it is locked, as `/investigate`'s 402 did, rather than hand back a quick answer.
                raise PramanyxError(f"capability locked: {ev.get('why') or 'deep analysis needs an upgrade'}")
            if t == "start":
                acc["investigation_id"] = ev.get("investigation_id") or acc["investigation_id"]
            elif t == "already_running":
                # The platform handed back this question's run already under way, rather than start a second — by its
                # id, which its door names the moment it claims the question (a platform before 2026-11-24 could send
                # none): never this repeat's own run, which stopped at the hand-back.
                acc["investigation_id"] = ev.get("investigation_id") or None
                acc["already_running"], acc["message"] = True, str(ev.get("already_running") or "")
            elif t == "hypotheses":
                acc["hypotheses"] = ev.get("hypotheses")
            elif t in ("answer_report", "ada_report"):  # ada_report = deprecated wire alias (U9)
                acc["report"], acc["report_kind"] = ev.get("answer_report") or ev.get("ada_report"), "ada"
                acc["from_cache"] = bool(ev.get("from_cache"))
                acc["investigation_id"] = ev.get("investigation_id") or acc["investigation_id"]
            elif t == "explore_report":
                acc["report"], acc["report_kind"] = ev.get("explore_report"), "explore"
                acc["from_cache"] = bool(ev.get("from_cache"))
                acc["investigation_id"] = ev.get("investigation_id") or acc["investigation_id"]
            elif t == "dossier_report":
                acc["report"], acc["report_kind"] = ev.get("dossier"), "dossier"
                acc["investigation_id"] = ev.get("insight_id") or acc["investigation_id"]
            elif t == "report":
                acc["report"] = ev.get("report")
                acc["report_kind"] = acc["report_kind"] or "report"
                acc["investigation_id"] = ev.get("investigation_id") or acc["investigation_id"]
            elif t == "error":
                acc["error"] = ev.get("message")
            elif t == "done":
                acc["status"] = "complete"
            if ev.get("answered_early"):
                # The person had it answer now (punch list 89): the report says less than the run planned.
                acc["answered_early"] = ev.get("answered_early")

    async def deep_analysis(
        self,
        question: str,
        connection: str,
        *,
        schema: Optional[str] = None,
        deep: bool = True,
        skip_cache: bool = False,
        canvas: Optional[str] = None,
    ) -> dict:
        """Drive a deep ``/ask`` turn to completion (bounded by ``deep_timeout``) and return
        the final report. On timeout, hands back the investigation_id to read it by.

        The engine is the analyst (`agent/analyst.py`), the one the Ask panel's and a Data Canvas's
        deep turns run — the user, 2026-11-23: one deep engine everywhere. Until then this drove
        ``/investigate``, the older phase graph, so the same "why" got a different method and a
        different report in the coworker than beside a dashboard. A binding that cannot call tools
        is still served by the graph, behind the same door, as every place's is."""
        body = {
            "question": question, "connection_id": connection, "schema": schema,
            "depth": "deep", "deep": deep, "skip_cache": skip_cache, "canvas_id": canvas,
        }
        acc: dict[str, Any] = {
            "question": question, "connection": connection, "investigation_id": None,
            "status": "running", "report": None, "report_kind": None, "hypotheses": None,
            "from_cache": False, "error": None,
        }
        # The deadline is on the whole call, not on silence (2026-11-23, seen live: the analyst ran 11 minutes on a free
        # model; the stream's keep-alive every 20 s reset the read timeout, so the call ran past the shell's 6-minute
        # tool limit and the coworker said "Request timed out" over an analysis that then finished). At the deadline the
        # stream is let go and the caller gets the id to read it by. Nothing on the platform needs a reader: the run is a job
        # (measured 2026-11-24, 0237d0fc), and the job writes the trace's end and files the answer envelope when the run
        # ends (`routers/investigations._TurnEnd`, `_TurnEnvelope`). Until then this read on in the background, first on
        # the belief that the run would stop without it, then for the trace and the envelope.
        run = asyncio.create_task(self._drive_deep(body, acc))
        try:
            await asyncio.wait_for(run, timeout=self.deep_timeout)
        except asyncio.TimeoutError:
            if acc["investigation_id"]:
                acc["status"] = "running"
                acc["message"] = self._still_running(acc["investigation_id"], self.deep_timeout,
                                                     await self._progress(acc["investigation_id"]))
                return dict(acc)
            raise PramanyxError(
                f"deep_analysis had not started after {self.deep_timeout:.0f}s; it goes on, and its report will be "
                "in the person's analyses when it finishes."
            )
        except httpx.TimeoutException:
            # The stream itself went silent past the read timeout (no keep-alive came). If it has started, hand back
            # the id to read it by; otherwise it never got going. Genuine errors — a 402 lock, a bad request — are raised by
            # _stream_sse and propagate cleanly, uncaught here.
            if acc["investigation_id"]:
                acc["status"] = "running"         # the platform went silent: not asked again how far it has got
                acc["message"] = self._still_running(acc["investigation_id"], self.deep_timeout)
                return acc
            raise PramanyxError(
                f"deep_analysis timed out after {self.deep_timeout:.0f}s before producing a report."
            )
        if acc.get("already_running"):
            acc["status"] = "running"     # the run under way, handed back: not a finished one with nothing in it
            return acc
        if acc["report"] is not None:
            acc["status"] = "complete"
        elif acc["error"]:
            raise PramanyxError(f"deep_analysis failed: {acc['error']}")
        if acc["investigation_id"] and acc["report_kind"] in ("ada", "report"):
            try:
                acc["receipt"] = await self._get(f"/ada/{connection}/{acc['investigation_id']}/receipt")
            except PramanyxError:
                acc["receipt"] = None
        return acc

    async def _progress(self, investigation_id: str) -> dict:
        """How far a run handed back at the call's deadline has got — queued, or its steps — read once, within a few
        seconds (the deadline is there to keep inside the shell's tool limit); {} when the read fails or is slow (the run
        is still said to go on, without how far)."""
        try:
            rec = await asyncio.wait_for(self._get(f"/investigations/{investigation_id}"), timeout=PROGRESS_READ_S)
        except (PramanyxError, asyncio.TimeoutError):
            return {}
        return (rec or {}).get("progress") or {} if isinstance(rec, dict) else {}

    def _still_running(self, investigation_id: str, after_s: Optional[float], progress: Optional[dict] = None) -> str:
        """What a caller is told about a run still going: that it goes on, how far it has got, and that reading it
        waits — so a read that finds it running is not mistaken for one that found it stuck."""
        p = progress or {}
        after = f" after {after_s:.0f}s" if after_s else ""
        if p.get("queued"):
            # its door named it as it claimed the question; it waits for one of the platform's analysis slots
            return (f"Deep analysis is queued{after}: other analyses hold every slot, and it starts by itself as one "
                    f"frees. get_investigation('{investigation_id}') waits for it (up to {self.read_wait:.0f}s a call) "
                    "and returns its report as soon as it lands.")
        far = ""
        if p.get("steps"):
            far = f" It has taken {p['steps']} step{'' if p['steps'] == 1 else 's'} so far" + (
                f", the last {p['last_step']}." if p.get("last_step") else ".")
        return (f"Deep analysis is still running{after}, and goes on in the platform.{far} "
                f"get_investigation('{investigation_id}') waits for it (up to {self.read_wait:.0f}s a call) and "
                "returns its report as soon as it lands.")

    async def get_investigation(self, investigation_id: str, *, wait_s: Optional[float] = None,
                                _follow: bool = True) -> dict:
        """A run by its id. One still running is waited on — up to ``wait_s`` (default ``read_wait``), read every few
        seconds — and returned the moment it ends; still going at the end of the wait, it comes back with how far it has
        got. 2026-11-24, seen twice: the coworker read a running run four times in half a minute, each answering at once
        with a bare 'running', took it for stuck and asked the same question again."""
        import time as _time
        wait = self.read_wait if wait_s is None else float(wait_s)
        deadline = _time.monotonic() + max(0.0, wait)
        rec = await self._get(f"/investigations/{investigation_id}")
        handed_to = str((rec or {}).get("handed_to") or "") if (rec or {}).get("status") == "handed_back" else ""
        if handed_to and _follow:
            # A repeat handed the run of its question already under way (`agent/one_run.py`) answers nothing itself:
            # the run it was handed does, and is the one read — named, so a caller knows whose record it holds.
            return {**(await self.get_investigation(handed_to, wait_s=wait, _follow=False)), "handed_from": investigation_id}
        while _running(rec) and _time.monotonic() < deadline:
            await asyncio.sleep(max(0.0, min(READ_EVERY_S, deadline - _time.monotonic())))
            rec = await self._get(f"/investigations/{investigation_id}")
        if _running(rec):
            rec = dict(rec)
            progress = rec.get("progress") or {}
            ran = progress.get("running_for_s")
            rec["message"] = self._still_running(investigation_id, float(ran) if ran else None, progress)
        return rec

    async def get_metric(self, *, connection: Optional[str] = None, name: Optional[str] = None) -> dict:
        if not name:
            return {"metrics": await self._get("/metrics")}
        definition = None
        for m in (await self._get("/metrics")) or []:
            if m.get("name") == name:
                definition = m
                break
        if definition is None:
            raise PramanyxError(f"get_metric: no governed metric named '{name}'")
        result: dict[str, Any] = {"name": name, "definition": definition}
        if connection:
            try:
                val = await self._get(f"/metrics/{name}/value", params={"conn_id": connection})
                result.update({"value": val.get("value"), "unit": val.get("unit"), "sql": val.get("sql")})
            except PramanyxError as e:
                result["value_error"] = str(e)
        return result

    async def list_findings(self, connection: str, *, schema: Optional[str] = None, limit: int = _FINDING_CAP) -> dict:
        # Only what a person confirmed (the user, 2026-11-17: findings reach an answer "confirmed only", everywhere).
        data = await self._get(f"/exploration/{connection}/findings", params={"schema": schema, "confirmed": "true"})
        insights = (data or {}).get("insights") or []
        waiting = int((data or {}).get("unconfirmed_withheld") or 0)
        trimmed = [
            {
                "id": i.get("id"), "finding": i.get("finding"), "confidence": i.get("confidence"),
                "novelty": i.get("novelty"), "domain": i.get("domain"), "sql": i.get("sql"),
            }
            for i in insights[: max(1, int(limit))]
        ]
        out = {
            "connection": connection, "schema": schema, "phase": (data or {}).get("phase"),
            "count": len(insights), "findings": trimmed, "unconfirmed_withheld": waiting,
        }
        if waiting:
            out["said"] = (f"{waiting} more the explorer found wait for a person to confirm them; no answer leans on "
                           "them until then, and neither should you.")
        return out

    async def get_briefing(self, connection: str, *, schema: Optional[str] = None, refresh: bool = False) -> dict:
        data = await self._post(
            f"/exploration/{connection}/briefing", params={"schema": schema, "refresh": refresh}
        )
        return {
            "connection": connection, "schema": schema,
            "available": bool((data or {}).get("available")),
            "headline_theme": (data or {}).get("headline_theme"),
            "narrative": (data or {}).get("narrative"),
            "citations": (data or {}).get("citations"),
            "generated_at": (data or {}).get("generated_at"),
        }

    async def explore(self, connection: str, *, schema: Optional[str] = None) -> dict:
        started = await self._post(f"/exploration/{connection}/start", params={"schema": schema})
        status = await self._get(f"/exploration/{connection}/status", params={"schema": schema})
        return {
            "connection": connection, "schema": schema,
            "started": bool((started or {}).get("ok")),
            "reason": (started or {}).get("reason"),
            "phase": (status or {}).get("phase"),
            "insights_found": (status or {}).get("insights_found"),
        }

    async def list_jobs(self, *, state: Optional[str] = None, connection: Optional[str] = None, limit: int = 50) -> list:
        return await self._get("/jobs", params={"state": state, "conn_id": connection, "limit": limit})

    async def get_job(self, job_id: str) -> dict:
        return await self._get(f"/jobs/{job_id}")

    async def cancel_job(self, job_id: str) -> dict:
        return await self._post(f"/jobs/{job_id}/cancel")

    # ── traces (VA-5) ────────────────────────────────────────────────────────
    # Three calls, narrowing: which runs → one run's shape → one span's payload.
    # There is deliberately no "give me the whole trace": that response is 1.2 MB
    # for a 1,140-event run, and a tool whose success case floods the caller's
    # context is not a usable tool.

    async def list_runs(self, *, limit: int = 20, investigation_id: Optional[str] = None,
                        agent_id: Optional[str] = None) -> Any:
        return await self._get("/traces", params={
            "limit": limit, "investigation_id": investigation_id, "agent_id": agent_id})

    async def inspect_run(self, trace_id: str, *, top: int = 8) -> Any:
        return await self._get(f"/traces/{trace_id}/summary", params={"top": top})

    async def run_span(self, trace_id: str, span_id: str) -> Any:
        return await self._get(f"/traces/{trace_id}/spans/{span_id}")

    # ── DE-2b: the organisation's agent policy, as the API answers it ─────────────
    async def agent_policy(self) -> dict:
        return await self._get("/org-settings/agent-policy")

    async def agent_policy_version(self) -> str:
        """Whether the policy changed, as a fingerprint — read every few seconds, recorded nowhere (2026-11-16)."""
        from pramanyx.orgsettings.agent_policy import POLICY_VERSION_ROUTE
        return str((await self._get(POLICY_VERSION_ROUTE) or {}).get("version") or "")

    async def service_principal_me(self, name: str, key: str) -> tuple[int, Optional[dict]]:
        """Arc ED, ED-2 — ``(status, body)`` the API gives a presented service principal: 200 with its grant, 401 when the
        name and key do not match. 0 when the API could not be asked."""
        token = CURRENT_CALLER.set((name, key))
        try:
            async with self._mk_client() as c:
                r = await c.get("/ledger/v1/principals/service/me")
        except httpx.HTTPError:
            return 0, None
        finally:
            CURRENT_CALLER.reset(token)
        try:
            body = r.json()
        except ValueError:
            body = None
        return r.status_code, body if isinstance(body, dict) else None

    # ── Phase 7 of the 2027 study: the ledger API ──────────────────────────────────
    async def contract(self) -> dict:
        return await self._get("/ledger/v1/contract")

    async def read_claims(self, *, connection: Optional[str] = None, kind: Optional[str] = None,
                          author: Optional[str] = None, as_of: Optional[str] = None, limit: int = 50) -> Any:
        return await self._get("/ledger/v1/claims", params={"connection_id": connection, "kind": kind, "author": author,
                                                            "as_of": as_of, "limit": limit})

    async def read_restatements(self, *, since: str = "", connection: Optional[str] = None, limit: int = 100) -> Any:
        return await self._get("/ledger/v1/restatements", params={"since": since or None, "connection_id": connection, "limit": limit})

    async def post_claim(self, body: dict) -> Any:
        return await self._post("/ledger/v1/claims", json_body=body)

    # ── The web, for outside context only (2026-11-15) ──────────────────────────────────────────────
    async def search_the_web(self, query: str, n: int = 5) -> dict:
        return await self._get("/web/search", params={"q": query, "n": n})

    # ── A question on a rhythm, run by the platform (the coworker plan, 2026-11-15) ────────────────
    async def schedule(self, request: str, connection: str, timezone: str = "", browser_time_zone: str = "",
                       confirm_rhythm: bool = False) -> dict:
        """ANYTHING ON A SCHEDULE, FROM A SENTENCE (2026-11-16). The person's words go to the platform's own designer
        (`POST /automations/propose`, `automations/propose.py`): a model drafts the whole chain — when it runs, what
        it does, where it goes — from what this install has, and the same checks a save runs refuse a draft that
        could not be saved. A draft with nothing left open is then made, as the person asked; its runs are shown in
        the conversation, and its design opens on the platform's canvas, where a person can change it by hand. A
        draft that left a choice open (a Slack channel the person did not name) is NOT made: what is open comes back,
        for the agent to ask. One scheduler — the platform's; one designer — the one the Automations page uses.

        ``timezone`` is a zone the person named; ``browser_time_zone`` the one the shell tells the agent the person's
        browser is in. Which the times are read in is the platform's order (`automations.propose.the_clock`).

        ``confirm_rhythm`` says the person confirmed a rhythm more often than hourly, which is otherwise left open and
        asked (2026-11-17: an agent passed "in 2 minutes" on as "every 2 minutes", and that schedule was made)."""
        drafted = await self._post("/automations/propose", json_body={
            "outcome": request, "conn_id": connection, "timezone": timezone.strip(),
            "clock_here": browser_time_zone.strip(), "from_conversation": True, "confirmed_rhythm": bool(confirm_rhythm)})
        drafted = drafted if isinstance(drafted, dict) else {}
        if drafted.get("verdict") != "proposed" or not drafted.get("draft"):
            return {"scheduled": False, "reason": drafted.get("reason") or "the request could not be made into a schedule",
                    "notes": drafted.get("notes") or ""}
        if drafted.get("to_fill"):
            return {"scheduled": False, "needs": drafted["to_fill"], "notes": drafted.get("notes") or "",
                    "reason": "the request leaves a choice open; ask the person and set it up again with their answer"}
        draft = dict(drafted["draft"])
        draft["description"] = (draft.get("description") or "") + " Set up from a conversation, in the person's words."
        made = await self._post("/automations", json_body={**draft, "start_at_first_run": True})
        when = await self._get(f"/automations/{made.get('id')}/schedule")
        when = when if isinstance(when, dict) else {}
        return {"scheduled": True, "id": made.get("id"), "name": made.get("name"), "connection": connection,
                "when": "; ".join(when.get("said") or []), "next_run": when.get("next_run") or "",
                "timezone": when.get("timezone") or draft.get("timezone") or "UTC",
                "steps": [str(e.get("kind")) for e in draft.get("effects") or []],
                "stops_at": made.get("expires_at") or "never",
                "notes": " ".join(x for x in [str(drafted.get("notes") or "").strip(),
                                              "Each run is shown in this conversation, kept with the schedule, and "
                                              "traced in Agent Ops; its design can be changed on the schedule's page."] if x),
                "open": f"/automations?conn={connection}&focus={made.get('id')}"}

    # ── DE-2c: the knowledge tools, through the API like everything else ───────────
    async def get_definitions(self, connection: str, *, term: Optional[str] = None) -> dict:
        rows = await self._get("/record/definitions", params={"connection_id": connection, **({"term": term} if term else {})})
        keep = ("term", "area", "state", "owner", "aliases", "links", "approved_by", "approved_on")
        return {"definitions": [{**{k: r.get(k) for k in keep}, "text": (r.get("statement") or {}).get("text", ""),
                                 "suggested_edits_pending": len(r.get("suggestions") or [])} for r in rows or []]}

    async def draft_definition(self, connection: str, *, term: str, text: str, area: str = "",
                               aliases: Optional[list[str]] = None, why: str = "") -> dict:
        body = {"connection_id": connection, "term": term, "text": text, "area": area, "why": why,
                **({"aliases": aliases} if aliases is not None else {})}
        got = await self._post("/record/definitions/draft", json_body=body)
        return {"made": got.get("made"), "term": got.get("term"), "area": got.get("area"), "state": got.get("state"),
                "owner": got.get("owner"), "text": (got.get("statement") or {}).get("text"),
                "suggestion": got.get("suggested"), "publish_at": got.get("publish_at")}

    async def remember_for_me(self, text: str, *, replaces: Optional[str] = None) -> dict:
        """Remember something about how the person asks, for them alone (punch list 90); with ``replaces``, in place
        of one of their memories, which is kept as history."""
        return await self._post("/me/memories", json_body={"text": text, **({"replaces": replaces} if replaces else {})})

    async def my_memories(self, *, history: bool = False) -> dict:
        return await self._get("/me/memories", params={"history": "true"} if history else None)

    async def forget_for_me(self, memory_id: str) -> dict:
        from urllib.parse import quote
        await self._delete(f"/me/memories/{quote(memory_id, safe='')}")
        return {"forgotten": memory_id}

    async def search_my_drive(self, words: str, *, limit: int = 10) -> dict:
        """Files in the person's own Google Drive whose names hold the words (punch list 91): names and links only."""
        return await self._get("/integrations/drive/files", params={"words": words, "limit": limit})

    async def deck_of_answers(self, investigation_ids: list[str], *, title: str = "") -> dict:
        """Several of the person's answers as one PowerPoint deck (punch list 92). Each answer is read first, so one that
        is gone or not theirs is named instead of breaking the download; the deck itself is built by the platform from
        the stored reports (`GET /exports/answers`), never by code a model wrote."""
        from urllib.parse import urlencode
        wanted = [i for i in dict.fromkeys(str(x).strip() for x in investigation_ids or []) if i]
        if not wanted:
            return {"deck": None, "why": "Name the answers the deck is made of: their investigation ids, as each answer returned it."}
        if len(wanted) > 30:
            return {"deck": None, "why": "A deck holds at most 30 answers; ask the person which ones it is for."}
        answers, missing = [], []
        for inv_id in wanted:
            try:
                inv = await self._get(f"/investigations/{inv_id}")
            except PramanyxError:
                missing.append(inv_id)
                continue
            answers.append({"id": inv_id, "question": str((inv or {}).get("question") or "")[:200]})
        if not answers:
            return {"deck": None, "missing": missing, "why": "None of those answers could be read."}
        query = urlencode({"ids": ",".join(a["id"] for a in answers), **({"title": title.strip()[:120]} if title.strip() else {})})
        return {"deck": {"title": title.strip()[:120] or (answers[0]["question"] if len(answers) == 1 else f"{len(answers)} answers"),
                         "answers": answers, "format": "pptx", "download": f"/exports/answers?{query}"},
                "missing": missing}

    async def bring_in_file(self, path: str, *, name: str = "") -> dict:
        """A file the person attached in the coworker, brought into Pramanyx as theirs (the ontology study, Phase 2,
        2026-11-17): a table-shaped file becomes a SHEET on the Sheets connection, anything else to read a DOCUMENT
        the answers search — each private to the person until they share it. Read only from the coworker's own
        attachments (`PRAMANYX_ATTACHMENTS_DIR`): a path anywhere else is refused, so the model can never point this
        at another file on the machine."""
        found = attached_file(path)
        if isinstance(found, str):
            return {"brought_in": False, "why": found}
        real, size = found
        shown = (name or os.path.basename(real)).strip()[:200] or "attached file"
        ext = os.path.splitext(shown.lower())[1] or os.path.splitext(real.lower())[1]
        with open(real, "rb") as fh:
            data = fh.read()
        if ext in SHEET_EXTENSIONS:
            staged = await self._post_file("/sheets/files", shown, data)
            tabs = staged.get("tabs") or [{"tab": ""}]
            base = os.path.splitext(shown)[0][:80] or "Attached sheet"
            plans = [{"tab": t.get("tab", ""), "name": base if len(tabs) == 1 else f"{base} · {t.get('tab') or i + 1}"}
                     for i, t in enumerate(tabs)]
            made = await self._post("/sheets", json_body={"source": "file", "token": staged.get("token", ""), "tabs": plans})
            sheets = [{"id": x.get("id"), "name": x.get("name"), "table": x.get("table"), "rows": x.get("row_count"),
                       "open": f"/sheets/{x.get('id')}"} for x in (made or {}).get("sheets") or []]
            return {"brought_in": True, "kind": "sheet", "connection": "sheets", "file": shown, "bytes": size,
                    "sheets": sheets, "private": "only the person can see it until they share it",
                    "next": "ask about it with `ask` on connection `sheets`, naming the sheet"}
        if ext in DOCUMENT_EXTENSIONS:
            doc = await self._post_file("/documents/upload", shown, data)
            return {"brought_in": True, "kind": "document", "file": shown, "bytes": size,
                    "document": {"id": doc.get("doc_id"), "title": doc.get("title"), "chunks": doc.get("chunk_count"),
                                 "pages_needing_ocr": doc.get("pages_needing_ocr") or []},
                    "private": "only the person can see it until they share it",
                    "next": "its passages now reach answers on any connection the person asks about"}
        return {"brought_in": False, "why": f"a {ext or 'nameless'} file is neither a table nor a document Pramanyx reads; "
                                            f"tables: {', '.join(sorted(SHEET_EXTENSIONS))}; documents: "
                                            f"{', '.join(sorted(DOCUMENT_EXTENSIONS))}"}

    async def read_learned(self, connection: str, *, about: str = "", area: str = "") -> dict:
        return await self._get(f"/knowledge/{connection}/learned",
                               params={k: v for k, v in (("about", about), ("area", area)) if v})

    async def search_graph(self, connection: str, query: str, *, limit: int = 10) -> dict:
        return await self._get(f"/knowledge/{connection}/graph/search", params={"q": query, "limit": limit})

    async def describe_entity(self, connection: str, entity: str) -> dict:
        return await self._get(f"/knowledge/{connection}/entity/{entity}")

    async def get_table_health(self, connection: str, table: str) -> dict:
        return await self._get(f"/knowledge/{connection}/table-health", params={"table": table})

    async def list_trusted_queries(self, connection: str, *, limit: int = 25) -> dict:
        return await self._get(f"/knowledge/{connection}/trusted-queries", params={"limit": limit})

    # ── the Atlas plan's A8 (2026-11-25): the Areas of the business reach every agent — the Atlas's own reads ─────
    async def list_areas(self) -> dict:
        from pramanyx.mcp.area_views import areas_for_agents
        return areas_for_agents(await self._get("/discover/atlas"))

    async def describe_area(self, area: str) -> dict:
        from urllib.parse import quote

        from pramanyx.mcp.area_views import area_for_agents
        page = await self._get(f"/discover/areas/{quote(area, safe='')}", params={"by_use": True})
        review = await self._get("/discover/atlas/review", params={"area": area})
        return area_for_agents(page, review)

    # ── Arc OC-8: the doors for builders — the published contract, listing, proposing ─────
    async def ontology_contract(self, connection: str, *, schema: Optional[str] = None) -> dict:
        return await self._get("/ontology/v1/contract", params={"connection_id": connection, "schema_name": schema})

    async def list_objects(self, connection: str, body: dict, *, schema: Optional[str] = None) -> dict:
        return await self._post("/objects/v1/list", json_body=body,
                                params={"connection_id": connection, "schema_name": schema})

    async def propose_action(self, connection: str, action_id: str, params: dict, *, reasoning: str = "",
                             release: str = "", schema: Optional[str] = None) -> dict:
        return await self._post(f"/objects/v1/actions/{action_id}/propose",
                                json_body={"params": params, "reasoning": reasoning, "release": release},
                                params={"connection_id": connection, "schema_name": schema})


def _clean(params: Optional[dict]) -> Optional[dict]:
    """Drop None-valued query params so we never send ``?schema=None``."""
    if not params:
        return None
    return {k: v for k, v in params.items() if v is not None}


def _safe_detail(r: httpx.Response) -> str:
    try:
        body = r.json()
        if isinstance(body, dict) and "detail" in body:
            d = body["detail"]
            return d if isinstance(d, str) else json.dumps(d)
        return json.dumps(body)
    except Exception:
        return (r.text or "")[:300]
