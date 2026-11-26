"""Every kind of question at every door, beside a general model given only the schema — the plan of record's
measurement (2026-11-27: "Measured whole, against a plain model: every kind of question at every door, beside a general
model given only the schema; the owner judges the pairs").

Before this, every eval ran ONE door (``/ask`` forced quick) and ONE pattern of question ("What was X over the last 30
days?"). So nothing said whether an open question, a why, a check or a follow-up was answered alike at the web
conversation, the coworker, Slack, an agent's door and a schedule — nor whether the platform answers better than the
same model would with no platform around it.

**The cases** (`CASES`) are written by hand from each connection's real tables and shipped declarations — theLook
(``8233e4fd``, BigQuery, ``thelook``) and LuxExperience (``dcc63d83``, Postgres, ``luxexperience``) — a few of every
kind the router reads (`agent/question_shape.py`): figure, breakdown, why, open, check, definition, and a follow-up pair.
Held as a suite per connection in the eval store (`evals/store.py`, key ``kinds:<connection>``) — one store.

**The doors** (`DOORS`) are the ``AskRequest`` fields each place sends ``/ask`` today, driven in-process through
``build_ask_stream`` (`targets.drain_ask`) as the doors themselves are: the web conversation, the coworker's ``ask`` and
its ``deep_analysis``, Slack, an agent's door (Teams, HTTP, webhook, A2A — `custom_agents/reach.fold_ask`) and a
schedule (`runners/investigation`). Every door is given the run's scope on top — the connection, its schema, and
``skip_cache`` (a cached answer measures the cache, and the second door would read the first door's answer); what was
sent rides each answer as ``fields``. In-process there is no HTTP request, so the coworker's "an agent's call is handed
the run already under way" (`rbac.agent_gate.is_agent_request`) is not exercised; with ``skip_cache`` it would not be
either.

**The plain model** (`baseline_answer`) is the platform's own model (`get_provider("coder")`) WITHOUT the platform: the
schema text a turn may see (read as `converse_tools` reads it), one ``run_sql`` tool through the read-only guarded
executor (`sql.executor.execute_guarded`, with no metric rules — the platform's declared filters are the platform), a
short neutral prompt, the tool loop (`agent/tool_loop.run_tool_loop`) and the model's own step budget, the one a quick
turn has.

**No grading of which is better** — the owner judges the pairs. What IS recorded are facts: did it run, did it error,
is the headline empty, how many of the headline's figures are cells of the answer's own rows (`explorer/grounding`), the
route the answer took (``envelope.provenance.path``), its receipt, its SQL, its time and tokens — and, per question,
whether the doors give the same leading figure.

Each run spends model calls (every door and the plain model, for every case), so it runs only on a person's click.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

SUITE_KEY = "kinds:{conn}"
#: The most cases a run answers by default — each answers at every door chosen and the plain model.
RUN_LIMIT = 20
#: Rows kept per answer for the owner to read; the facts are computed over every row the answer ran.
ROWS_KEPT = 20

#: The kinds, in the order a reader meets them — the router's shapes in the words a person uses.
KINDS = ("figure", "breakdown", "why", "open", "check", "definition", "follow_up")

#: The connections the case set is written for, each with its schema and words.
CONNECTIONS: dict[str, dict[str, str]] = {
    "8233e4fd": {"name": "theLook", "schema": "thelook"},
    "dcc63d83": {"name": "LuxExperience", "schema": "luxexperience"},
}

#: The cases, by connection. Names come from the tables themselves (`evals/golden_thelook.jsonl`,
#: `evals/ablation_luxexperience_business.jsonl`, the shipped declarations under `data/shipped/ontology_overrides/`).
#: A follow-up case is two turns: ``question`` first, then ``follow_up`` in the same conversation.
CASES: dict[str, list[dict[str, str]]] = {
    "8233e4fd": [
        {"kind": "open", "question": "Show me interesting trends and facts in the data set"},
        {"kind": "open", "question": "What stands out in our sales over the last year?"},
        {"kind": "why", "question": "Why did revenue change last month compared with the month before?"},
        {"kind": "why", "question": "Why are so many order items returned?"},
        {"kind": "figure", "question": "How many orders were placed in the last 30 days?"},
        {"kind": "figure", "question": "What is the average order value of completed orders?"},
        {"kind": "breakdown",
         "question": "What is revenue by product category for order items that were not cancelled or returned?"},
        {"kind": "check", "question": "Do order items really join to products on product_id, or are there orphan "
                                      "order items with no product?"},
        {"kind": "definition", "question": "What is a completed order?"},
        {"kind": "follow_up", "question": "How many orders are there in each order status?",
         "follow_up": "Which of those statuses has the most orders, and what share of all orders is it?"},
    ],
    "dcc63d83": [
        {"kind": "open", "question": "Show me interesting trends and facts in the data set"},
        {"kind": "open", "question": "What should I know about our returns?"},
        {"kind": "why", "question": "Why did GMV change in fiscal year 2025 compared with fiscal year 2024?"},
        {"kind": "why", "question": "Why is the return rate higher on some platforms than on others?"},
        {"kind": "figure", "question": "What was YNAP's total GMV in fiscal year 2025?"},
        {"kind": "figure", "question": "How many orders were cancelled in fiscal year 2025?"},
        {"kind": "breakdown", "question": "What was GMV by platform in fiscal year 2025?"},
        {"kind": "check", "question": "Do payments really join to orders on order_id, or are there orphan payments "
                                      "with no order?"},
        {"kind": "definition", "question": "What is GMV?"},
        {"kind": "follow_up", "question": "How many VIP customers are there in each customer region?",
         "follow_up": "What share of fiscal year 2025 GMV came from the largest of those regions?"},
    ],
}


# ── the doors ────────────────────────────────────────────────────────────────────────────────────────────────────


#: Each door: the ``AskRequest`` fields that place sends ``/ask`` (beyond the question, the connection and its
#: scope), where it is sent from, and how it carries a follow-up — ``history`` (the earlier turn rides the request),
#: ``session`` (the conversation is the session id) or ``none`` (the door has no second turn; said, never skipped
#: silently).
DOORS: dict[str, dict[str, Any]] = {
    "web": {"fields": {"depth": "auto", "surface": ""}, "follows": "history",
            "from": "the web conversation (web/components/ChatPanel.tsx, web/lib/chatDoors.ts)"},
    "coworker": {"fields": {"depth": "auto", "allow_clarify": False, "session_id": ""}, "follows": "history",
                 "from": "the coworker's ask (pramanyx/mcp/client.py `ask`)"},
    "coworker_deep": {"fields": {"depth": "deep", "escalate": True}, "follows": "none",
                      "from": "the coworker's deep_analysis (pramanyx/mcp/client.py `deep_analysis`)"},
    "slack": {"fields": {"depth": "auto"}, "follows": "session",
              "from": "the Slack bot (bots/slack/src/pramanyx.ts; session_id = the thread)"},
    "agent": {"fields": {"depth": "quick", "allow_clarify": False}, "follows": "session",
              "from": "an agent's door — Teams, HTTP, webhook, A2A (pramanyx/custom_agents/reach.py `fold_ask`)"},
    "scheduled": {"fields": {"depth": "deep"}, "follows": "none",
                  "from": "a schedule (pramanyx/runners/investigation.py, an automation's investigate effect)"},
}

#: The plain model's prompt — short and neutral on purpose: no house style, no hints, nothing the platform knows.
BASELINE_SYSTEM = ("You are a data analyst. Answer the question from this database. Run SQL as needed. "
                   "Give the answer in plain prose with the figures.")
#: Rows of a statement's result the plain model is shown.
BASELINE_ROWS = 50


def ask_request(door: str, question: str, conn: str, *, schema: Optional[str], session_id: str = "",
                agent_id: Optional[str] = None, history: Optional[list[dict]] = None):
    """The ``AskRequest`` ``door`` sends for ``question`` — its own fields, the run's scope (connection, schema,
    ``skip_cache``), and the conversation for a second turn as that door carries one."""
    from pramanyx.routers.investigations import AskRequest
    spec = DOORS[door]
    fields: dict[str, Any] = dict(spec["fields"])
    if door == "agent" and agent_id:
        fields["agent_id"] = agent_id
    if spec["follows"] in ("history", "session") and session_id and door != "coworker":
        fields["session_id"] = session_id
    if history and spec["follows"] == "history":
        fields["history"] = history
    return AskRequest(question=question, connection_id=conn, schema_name=schema, skip_cache=True, **fields)


def sent_fields(req: Any) -> dict:
    """What a request sent, as the wire carries it — the fields it was given, no default it was not — what each answer records as ``fields``."""
    return req.model_dump(exclude_unset=True, exclude={"question"}, by_alias=True)


# ── one answer, its facts ────────────────────────────────────────────────────────────────────────────────────────


def _numerals(text: str) -> list:
    """The figures ``text`` states, calendar years left out (a year is a date, never the answer's figure)."""
    from pramanyx.explorer.grounding import extract_numerals
    return [n for n in extract_numerals(text or "")
            if not (not n.suffix and n.decimals == 0 and 1900.0 <= n.value <= 2100.0)]


def leading_figure(headline: str, body: str = "") -> Optional[dict]:
    """The answer's first figure — its headline's first, else its body's — ``{text, value}``, or None."""
    for text in (headline, body):
        found = _numerals(text)
        if found:
            return {"text": found[0].text, "value": found[0].value}
    return None


def facts_of(headline: str, body: str, rows: list) -> dict:
    """The objective facts about one answer: is its headline empty, what figures it states, how many of them are cells
    of the rows it ran (`grounding.figures_found`, a writer's rounding allowed), and the grounding guard's own verdict
    on its magnitudes (`grounding.verify_finding`)."""
    from pramanyx.explorer.grounding import figures_found, verify_finding
    said = headline or body
    verdict = verify_finding(said, rows)
    return {"headline_empty": not (headline or "").strip(),
            "figures_stated": [n.text for n in _numerals(said)],
            "figures_in_rows": figures_found(said, rows),
            "grounding": {"checked": verdict.checked, "ungrounded": list(verdict.ungrounded)},
            "leading_figure": leading_figure(headline, body)}


def _rows_of(seen: dict) -> list:
    """Every row an answer ran or cites: each result it streamed, else its envelope's grid and exhibits."""
    rows: list = [r for result in seen.get("all_rows") or [] for r in (result or [])]
    if rows:
        return rows
    env = seen.get("envelope") or {}
    grids = [env.get("grid") or {}] + [(e or {}).get("grid") or {} for e in env.get("exhibits") or []]
    return [r for g in grids for r in (g.get("rows") or [])]


def tokens_of(trace_id: str) -> Optional[dict]:
    """The model calls a run's trace recorded — ``{calls, input_tokens, output_tokens}`` — or None when none was
    recorded (said as not recorded, never as zero)."""
    if not trace_id:
        return None
    try:
        from pramanyx.obs import session_log
        from pramanyx.obs.trace_summary import build_summary
        events = session_log.recover_session(trace_id)
        models = (build_summary(trace_id, events).get("models") or {}) if events else {}
    except Exception as exc:  # noqa: BLE001 — unread is said as unrecorded
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "kinds evals: a run's tokens could not be read", counter="evals.kinds.tokens")
        return None
    if not models:
        return None
    return {"calls": sum(int(m.get("calls") or 0) for m in models.values()),
            "input_tokens": sum(int(m.get("input_tokens") or 0) for m in models.values()),
            "output_tokens": sum(int(m.get("output_tokens") or 0) for m in models.values())}


def door_answer(door: str, req: Any, *, drain: Optional[Callable[[Any], dict]] = None,
                tokens: Callable[[str], Optional[dict]] = tokens_of) -> dict:
    """One door's answer to one request, with its facts. An error — a frame, or the stream raising — is a datum."""
    if drain is None:
        from pramanyx.evals.targets import drain_ask as drain
    t0 = time.perf_counter()
    try:
        seen = drain(req)
    except Exception as exc:  # noqa: BLE001 — a door that fails is an answer that failed, recorded
        return {"door": door, "fields": sent_fields(req), "question": req.question, "ran": False,
                "error": f"{type(exc).__name__}: {exc}"[:500], "duration_ms": round((time.perf_counter() - t0) * 1000, 1),
                "headline": "", "body": "", "path": {}, "receipt_id": "", "sql": [], "tokens": None,
                **facts_of("", "", [])}
    env = seen.get("envelope") or {}
    report = seen.get("report") or {}
    headline = str(env.get("headline") or seen.get("headline") or report.get("headline") or "")
    body = str(env.get("body") or report.get("summary") or "")
    rows = _rows_of(seen)
    prov = env.get("provenance") or {}
    error = str(seen.get("error") or env.get("error") or "")
    return {
        "door": door, "fields": sent_fields(req), "question": req.question,
        "ran": not error, "error": error[:500],
        "duration_ms": round((time.perf_counter() - t0) * 1000, 1),
        "headline": headline, "body": body,
        "figures": list(env.get("figures") or report.get("figures") or []),
        "caveats": list(env.get("caveats") or []),
        "clarified": str(seen.get("clarify") or ""),
        "path": dict(prov.get("path") or {}), "route": dict(seen.get("route") or {}),
        "receipt_id": str(seen.get("receipt_id") or prov.get("receipt_id") or ""),
        "sql": list(seen.get("all_sql") or prov.get("sql") or []),
        "columns": list(seen.get("columns") or []), "rows": rows[:ROWS_KEPT], "row_count": len(rows),
        "tools": list(seen.get("tools") or []), "trace_id": str(seen.get("trace_id") or ""),
        "tokens": tokens(str(seen.get("trace_id") or "")),
        **facts_of(headline, body, rows),
    }


def history_turn(answer: dict) -> dict:
    """An answered turn as a door that carries history sends it (`routers.investigations.ChatHistoryTurn`)."""
    sql = answer.get("sql") or []
    return {"question": answer.get("question", ""), "sql": sql[-1] if sql else "",
            "columns": list(answer.get("columns") or []), "headline": answer.get("headline", ""),
            "key_rows": list(answer.get("rows") or [])[:5]}


# ── the plain model ──────────────────────────────────────────────────────────────────────────────────────────────


def baseline_answer(conn: str, question: str, *, schema: Optional[str] = None, provider: Any = None,
                    earlier: Optional[dict] = None, loop: Optional[Callable] = None,
                    open_conn: Optional[Callable[[], Any]] = None, schema_text: Optional[str] = None,
                    tokens: Callable[[str], Optional[dict]] = tokens_of) -> dict:
    """The same model WITHOUT the platform: the schema, one read-only ``run_sql`` tool, the neutral prompt, the tool
    loop and its own step budget. ``earlier`` — a follow-up's first turn — rides the question as the earlier exchange,
    the only conversation a bare model has. Errors are recorded, never raised."""
    from pramanyx.obs.own_run import own_run
    t0 = time.perf_counter()
    statements: list[str] = []
    results: list[list] = []
    last_columns: list[str] = []
    out: dict[str, Any] = {"door": "baseline", "question": question, "fields": {"schema": schema or ""}}
    try:
        if provider is None:
            from pramanyx.llm.provider import get_provider
            provider = get_provider("coder")
        if loop is None:
            from pramanyx.agent.tool_loop import run_tool_loop as loop
        if open_conn is None:
            def open_conn():
                # the connection a turn's tools read, pinned to the scope — as `converse_tools` opens it
                if not schema:
                    from pramanyx.db.connection import open_connection_for
                    return open_connection_for(conn)
                from pramanyx.canvas.scope import resolve_execution_scope
                return resolve_execution_scope(conn, None, schema_scope=schema).open()
        db = open_conn()
        if schema_text is None:
            # the schema text a turn may see, as the reader may read it (`converse_tools._read_schema`'s own reading)
            from pramanyx.ontology.security_sql import schema_as_read
            schema_text = schema_as_read(conn, db.get_schema())[0]
        dialect = str(getattr(db, "dialect", "") or "sql")

        def run_sql(args: dict) -> dict:
            from pramanyx.sql.executor import execute_guarded
            sql = str((args or {}).get("sql") or "").strip()
            if not sql:
                return {"error": "no sql supplied"}
            statements.append(sql)
            result = execute_guarded(db, sql, query_id="eval.baseline")
            rows = list(getattr(result, "rows", None) or [])
            if not getattr(result, "error", ""):
                results.append(rows)
                last_columns[:] = list(getattr(result, "columns", None) or [])
            return {"columns": list(getattr(result, "columns", None) or []), "rows": rows[:BASELINE_ROWS],
                    "row_count": getattr(result, "row_count", len(rows)), "truncated": len(rows) > BASELINE_ROWS,
                    "error": getattr(result, "error", "") or ""}

        from pramanyx.agent.tool_loop import ToolSpec
        tool = ToolSpec(name="run_sql", description="Run one read-only SQL statement against the database and get back "
                                                    f"its columns and up to {BASELINE_ROWS} rows.",
                        parameters={"type": "object", "properties": {"sql": {"type": "string",
                                                                             "description": "The SQL statement"}},
                                    "required": ["sql"]},
                        run=run_sql)
        system = f"{BASELINE_SYSTEM}\n\nThe database is {dialect}.\n\nSchema:\n{schema_text}"
        asked = question if not earlier else (
            f"Earlier question: {earlier.get('question', '')}\nYour earlier answer: "
            f"{earlier.get('body') or earlier.get('headline') or ''}\n\nFollow-up question: {question}")
        from pramanyx.llm.profile import profile_for
        steps = profile_for(getattr(provider, "role", "coder")).tool_loop_steps
        out["model"] = {"backend": str(getattr(provider, "backend", "") or ""),
                        "model": str(getattr(provider, "_model", "") or "")}
        with own_run("eval_baseline", question, conn_id=conn) as trace:
            result = loop(provider, system, asked, [tool], max_steps=steps, conn_id=conn, trace_id=trace,
                          site="eval.baseline")
        text = str(getattr(result, "answer", "") or "")
        out.update(trace_id=trace, stop_reason=str(getattr(result, "stop_reason", "") or ""),
                   steps=len(getattr(result, "steps", None) or []), budget=steps)
        error = "" if text.strip() else f"the model gave no answer ({out['stop_reason'] or 'no text'})"
    except Exception as exc:  # noqa: BLE001 — the plain model failing is an answer that failed, recorded
        text, error = "", f"{type(exc).__name__}: {exc}"[:500]
        out.setdefault("trace_id", "")
    rows = [r for rs in results for r in rs]
    headline = _first_sentence(text)
    out.update({"ran": not error, "error": error, "duration_ms": round((time.perf_counter() - t0) * 1000, 1),
                "headline": headline, "body": text, "path": {"engine": "plain model", "depth": "quick"},
                "receipt_id": "", "sql": statements, "columns": last_columns, "rows": rows[:ROWS_KEPT],
                "row_count": len(rows), "tokens": tokens(str(out.get("trace_id") or "")),
                **facts_of(headline, text, rows)})
    return out


def _first_sentence(text: str) -> str:
    """The prose's first sentence — what a headline is, for an answer written as prose."""
    import re
    first = next((ln.strip() for ln in (text or "").splitlines() if ln.strip()), "")
    m = re.match(r"(.+?[.!?])(\s|$)", first)
    return (m.group(1) if m else first)[:400]


# ── consistency across the doors ─────────────────────────────────────────────────────────────────────────────────


def same_figure(a: float, b: float) -> bool:
    """Two leading figures agree within a writer's rounding (0.5%, `grounding`'s rule for a figure against a cell)."""
    if a == b:
        return True
    return abs(a - b) <= 0.005 * max(abs(a), abs(b))


def consistency(answers: dict[str, dict], baseline: Optional[dict] = None) -> dict:
    """Whether the doors that answered with a figure give the same leading figure — ``agree`` None when fewer than
    two did (nothing to compare is said, not taken for agreement) — the groups of doors that agree, the doors with no
    figure, and which doors the plain model's figure agrees with."""
    figures = {d: a["leading_figure"]["value"] for d, a in answers.items()
               if a.get("ran") and a.get("leading_figure")}
    groups: list[list[str]] = []
    for door, v in figures.items():
        for g in groups:
            if same_figure(figures[g[0]], v):
                g.append(door)
                break
        else:
            groups.append([door])
    out: dict[str, Any] = {"figures": figures, "agree": (len(groups) == 1) if len(figures) >= 2 else None,
                           "groups": groups, "without_figure": sorted(d for d in answers if d not in figures)}
    if baseline is not None:
        lead = baseline.get("leading_figure") if baseline.get("ran") else None
        out["baseline_figure"] = lead["value"] if lead else None
        out["baseline_agrees_with"] = sorted(d for d, v in figures.items() if lead and same_figure(lead["value"], v))
    return out


# ── the suite and a run ──────────────────────────────────────────────────────────────────────────────────────────


def suite_of(conn: str) -> dict:
    from pramanyx.evals import store
    name = CONNECTIONS.get(conn, {}).get("name") or conn
    suite, _ = store.ensure_suite(SUITE_KEY.format(conn=conn), f"Every kind at every door — {name}",
                                  description="Each kind of question asked at every door and of the same model given "
                                              "only the schema; the owner judges the pairs.",
                                  target="ask", connection_id=conn)
    return suite


def generate(conn: str) -> dict:
    """Write the connection's case set into its suite, replacing what was there — no model, no warehouse."""
    from pramanyx.evals import store
    if conn not in CASES:
        raise KeyError(conn)
    suite = suite_of(conn)
    for old in store.list_cases(suite["id"]):
        store.delete_case(old["id"])
    rows = [{"question": c["question"], "expected": {"kind": c["kind"], "order": i, **({"follow_up": c["follow_up"]}
                                                                                       if c.get("follow_up") else {})},
             "tags": ["kinds", c["kind"]]} for i, c in enumerate(CASES[conn])]
    store.add_cases(suite["id"], rows)
    return {"suite": suite, "cases": len(rows), "by_kind": {k: sum(1 for c in CASES[conn] if c["kind"] == k)
                                                            for k in KINDS}}


def cases_of(suite_id: str) -> list[dict]:
    """A suite's cases in the case set's order — written in one write, they share a time and the store returns them in
    any order."""
    from pramanyx.evals import store
    return sorted(store.list_cases(suite_id), key=lambda c: int((c.get("expected") or {}).get("order", 0)))


def find_suite(conn: str) -> Optional[dict]:
    """The suite of ``conn`` when its cases were written — read only: a read never makes one."""
    from pramanyx.evals import store
    key = SUITE_KEY.format(conn=conn)
    return next((s for s in store.list_suites(limit=500) if s.get("key") == key), None)


def _ask_case(case: dict, conn: str, *, schema: Optional[str], doors: list[str], baseline: bool, run_id: str,
              agent_id: Optional[str], drain: Optional[Callable], tokens: Callable, baseline_of: Callable) -> dict:
    """One case at every door chosen and of the plain model: ``{answers, baseline, follow_up, consistency}``."""
    expected = case.get("expected") or {}
    second = str(expected.get("follow_up") or "")
    answers: dict[str, dict] = {}
    follow: dict[str, dict] = {}
    for door in doors:
        session = f"eval-kinds-{run_id}-{case['id']}-{door}"
        first = door_answer(door, ask_request(door, case["question"], conn, schema=schema, session_id=session,
                                              agent_id=agent_id), drain=drain, tokens=tokens)
        answers[door] = first
        if not second:
            continue
        how = DOORS[door]["follows"]
        if how == "none":
            follow[door] = {"door": door, "question": second, "ran": False, "skipped": True,
                            "error": "", "why": "this door has no second turn: each request is a question on its own"}
            continue
        history = [history_turn(first)] if how == "history" else None
        follow[door] = door_answer(door, ask_request(door, second, conn, schema=schema, session_id=session,
                                                     agent_id=agent_id, history=history), drain=drain, tokens=tokens)
    base = base_follow = None
    if baseline:
        base = baseline_of(conn, case["question"], schema=schema)
        if second:
            base_follow = baseline_of(conn, second, schema=schema, earlier=base)
    out: dict[str, Any] = {"case_id": case["id"], "kind": expected.get("kind", ""), "question": case["question"],
                           "answers": answers, "baseline": base,
                           "consistency": consistency(answers, base)}
    if second:
        asked = {d: a for d, a in follow.items() if not a.get("skipped")}
        out["follow_up"] = {"question": second, "answers": follow, "baseline": base_follow,
                            "consistency": consistency(asked, base_follow)}
    return out


def run(conn: str, *, doors: Optional[list[str]] = None, baseline: bool = True, limit: int = RUN_LIMIT,
        run_id: str = "", agent_id: Optional[str] = None, schema: Optional[str] = None,
        drain: Optional[Callable[[Any], dict]] = None, tokens: Callable[[str], Optional[dict]] = tokens_of,
        baseline_of: Optional[Callable[..., dict]] = None) -> dict:
    """Ask up to ``limit`` of the suite's cases at each of ``doors`` (all by default) and, with ``baseline``, of the
    plain model; record one result per case. ``passed`` on a result means every answer RAN — never that it was right:
    which is better is the owner's call. Spends model calls: a person's click only."""
    from pramanyx.evals import store
    chosen = list(doors or DOORS)
    unknown = [d for d in chosen if d not in DOORS]
    if unknown:
        raise ValueError(f"no such door: {', '.join(unknown)}")
    schema = schema if schema is not None else CONNECTIONS.get(conn, {}).get("schema")
    suite = suite_of(conn)
    cases = cases_of(suite["id"])[: max(1, int(limit))]
    config = {"kind": "kinds", "doors": chosen, "baseline": bool(baseline), "limit": int(limit), "schema": schema,
              "agent_id": agent_id or "", "skip_cache": True}
    run_id = run_id or store.start_run(suite["id"], config=config)
    baseline_of = baseline_of or baseline_answer
    ran = errored = 0
    try:
        for case in cases:
            t0 = time.perf_counter()
            got = _ask_case(case, conn, schema=schema, doors=chosen, baseline=baseline, run_id=run_id,
                            agent_id=agent_id, drain=drain, tokens=tokens, baseline_of=baseline_of)
            every = list(got["answers"].values()) + ([got["baseline"]] if got["baseline"] else [])
            if got.get("follow_up"):
                every += [a for a in got["follow_up"]["answers"].values() if not a.get("skipped")]
                every += [got["follow_up"]["baseline"]] if got["follow_up"]["baseline"] else []
            failed = sorted({a["door"] for a in every if not a.get("ran")})
            store.record_result(run_id, case["id"], 1, passed=not failed, correct=None,
                                duration_ms=(time.perf_counter() - t0) * 1000,
                                error="; ".join(f"{a['door']}: {a['error']}" for a in every
                                                if not a.get("ran") and a.get("error"))[:2000],
                                fired=failed, scores=[got])
            ran += 1
            errored += int(bool(failed))
        summary = {"kind": "kinds", "cases": ran, "every_answer_ran": ran - errored, "some_answer_failed": errored,
                   "doors": chosen, "baseline": bool(baseline)}
        store.finish_run(run_id, summary=summary)
        return {"run_id": run_id, **summary}
    except Exception as exc:
        store.finish_run(run_id, status=store.FAILED, summary={"kind": "kinds", "error": str(exc)[:300]})
        raise


_RUNNING: set[str] = set()
_LOCK = threading.Lock()


def running(conn: str) -> bool:
    with _LOCK:
        return conn in _RUNNING


def start(conn: str, *, doors: Optional[list[str]] = None, baseline: bool = True, limit: int = RUN_LIMIT,
          agent_id: Optional[str] = None) -> Optional[str]:
    """Start a run in the background (a run is many answers, deep ones minutes each) and return its id at once — None
    when one is already under way on ``conn``."""
    import contextvars
    from pramanyx.evals import store
    with _LOCK:
        if conn in _RUNNING:
            return None
        _RUNNING.add(conn)
    try:
        chosen = list(doors or DOORS)
        unknown = [d for d in chosen if d not in DOORS]
        if unknown:
            raise ValueError(f"no such door: {', '.join(unknown)}")
        suite = suite_of(conn)
        run_id = store.start_run(suite["id"], config={"kind": "kinds", "doors": chosen, "baseline": bool(baseline),
                                                      "limit": int(limit), "agent_id": agent_id or "",
                                                      "schema": CONNECTIONS.get(conn, {}).get("schema"),
                                                      "skip_cache": True})
    except Exception:
        with _LOCK:
            _RUNNING.discard(conn)
        raise
    ctx = contextvars.copy_context()

    def go():
        try:
            run(conn, doors=chosen, baseline=baseline, limit=limit, run_id=run_id, agent_id=agent_id)
        except Exception:
            logger.warning("kinds evals: the run on %s failed", conn, exc_info=True)
        finally:
            with _LOCK:
                _RUNNING.discard(conn)
    threading.Thread(target=ctx.run, args=(go,), daemon=True, name="kinds-evals").start()
    return run_id


# ── reading a run: the pairs ─────────────────────────────────────────────────────────────────────────────────────


def pairs(run_id: str) -> Optional[dict]:
    """A run as the owner reads it: each question → each door's answer and the plain model's, the follow-up's beside
    it, and the facts — in the case set's order. None when there is no such run. Writes nothing."""
    from pramanyx.evals import store
    got = store.get_run(run_id)
    if got is None:
        return None
    by_case = {r["case_id"]: r for r in store.run_results(run_id)}
    order = [c["id"] for c in cases_of(got["suite_id"])]
    rows = []
    for cid in [c for c in order if c in by_case] + [c for c in by_case if c not in order]:
        r = by_case[cid]
        payload = (r.get("scores") or [{}])[0]
        rows.append({**payload, "every_answer_ran": bool(r.get("passed")), "failed": list(r.get("fired") or []),
                     "duration_ms": r.get("duration_ms")})
    return {"run": got, "questions": rows}


def latest(conn: str) -> dict:
    """The suite of ``conn``, its cases by kind, the doors, whether a run is under way, and the newest run's pairs —
    ``suite`` None when the cases were not written yet. Writes nothing."""
    from pramanyx.evals import store
    suite = find_suite(conn)
    doors = {d: {"fields": s["fields"], "follows": s["follows"], "from": s["from"]} for d, s in DOORS.items()}
    if suite is None:
        return {"suite": None, "cases": [], "doors": doors, "running": running(conn), "latest": None,
                "has_case_set": conn in CASES}
    cases = [{"id": c["id"], "question": c["question"], "kind": (c.get("expected") or {}).get("kind", ""),
              "follow_up": (c.get("expected") or {}).get("follow_up", "")} for c in cases_of(suite["id"])]
    runs = store.list_runs(suite["id"], limit=1)
    return {"suite": suite, "cases": cases, "doors": doors, "running": running(conn),
            "latest": pairs(runs[0]["id"]) if runs else None, "has_case_set": conn in CASES}
