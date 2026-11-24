"""R5 — the governed-intelligence MCP server.

Two layers of coverage:
  * **Mock** — drive the PramanyxClient against an httpx.MockTransport so the SSE-folding
    (ask / deep_analysis) and the read tools are tested without a live API or LLM.
  * **Real path** — drive the client against the actual FastAPI app in-process via
    httpx.ASGITransport, proving the wiring end-to-end (MCP client → real router → real
    ledger/registry) for the LLM-free read tools and the new /metrics/{name}/value route.
"""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from pramanyx.mcp.client import PramanyxClient, PramanyxError
from pramanyx.mcp.server import mcp


# ── helpers ──────────────────────────────────────────────────────────────────────
def _sse(events: list[dict]) -> str:
    """Pramanyx's SSE framing — one `data: {json}` line per event, blank-line terminated."""
    return "".join(f"data: {json.dumps(e)}\n\n" for e in events)


def _client(routes: dict) -> PramanyxClient:
    """A PramanyxClient whose transport answers from `routes` (path -> httpx.Response or
    a callable(request) -> httpx.Response)."""
    def handler(request: httpx.Request) -> httpx.Response:
        resp = routes.get(request.url.path)
        if resp is None:
            return httpx.Response(404, json={"detail": f"no mock route for {request.url.path}"})
        return resp(request) if callable(resp) else resp
    return PramanyxClient(base_url="http://test", transport=httpx.MockTransport(handler))


def _run(coro):
    return asyncio.run(coro)


# ── the server surface ───────────────────────────────────────────────────────────
def test_server_registers_the_governed_tools():
    # DE-2b: what is REGISTERED is the eighteen below; what is LISTED is what the organisation's
    # agent policy allows — under a policy of `run` the act tools (`cancel_job`, `schedule`) are
    # hidden; the default, since 2026-11-16, is `act`. `test_de2b_agent_policy.py` holds the listing.
    tools = set(mcp._tool_manager._tools)
    assert tools == {
        "list_connections", "ask", "deep_analysis", "get_investigation", "get_metric", "get_definitions", "read_learned", "bring_in_file", "draft_definition",
        # punch list 90 (2026-11-18) — what a person asked to be remembered about how they ask: theirs alone.
        "remember_for_me", "my_memories", "forget_for_me",
        # punch list 92 (2026-11-18) — a conversation's answers as one deck, from their stored reports (a read).
        "deck_of_answers",
        # punch list 91 (2026-11-18) — the person's own Drive, by file names, through their own grant (a read).
        "search_my_drive",
        "list_findings", "get_briefing", "explore", "list_jobs", "get_job", "cancel_job",
        # Wave S6 — knowledge reads over the stores the L→G→O→Q program built. Added to
        # this exact set deliberately: the assertion exists so growing the external agent
        # surface is a decision somebody made, not a thing that happened.
        "search_graph", "describe_entity", "get_table_health", "list_trusted_queries",
        # VA-5 — the trace surface: find a run, see its shape, read the one span that
        # matters. Same reasoning as above; and note what is NOT here, deliberately.
        "list_runs", "inspect_run", "read_run_span",
        # Phase 7 of the 2027 study — the ledger API through the same door: the contract, claims
        # as recorded, what was restated, and posting a claim with its warrant as oneself.
        "read_contract", "read_claims", "read_restatements", "post_claim",
        # Arc OC-8 — a page of a business entity's objects through the doors for builders; the propose tools are
        # registered per declared action (`register_ontology_tools`), never here.
        "list_objects",
        # 2026-11-16 — anything on a schedule from a sentence, as Pramanyx's own automation (an act).
        "schedule",
        # 2026-11-15 — the web for outside context, behind the organisation's `web_search` setting (a read).
        "search_the_web",
        # 2026-11-15 — a draft for the person to send themselves (a read; sending is the person's click).
        "draft_email",
    }
    # No whole-trace tool either, for the same reason as `query`: `GET /traces/{id}` is
    # 1.2 MB for a 1,140-event run, so a tool wrapping it would exhaust the context that
    # was going to read it. The surface is a summary plus one span, by design.
    assert not {"get_trace", "fetch_trace", "read_trace"} & tools
    # No raw `query` tool — the whole point is governed tools, not a SQL runner.
    assert "query" not in tools


def test_every_tool_has_an_llm_facing_description():
    for t in _run(mcp.list_tools()):
        assert t.description and len(t.description) > 40, t.name


# ── ask: folds the chat SSE stream + attaches the Trust Receipt ──────────────────
def test_ask_folds_stream_and_fetches_receipt():
    routes = {
        "/chat": httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_sse([
            {"type": "sql", "sql": "SELECT COUNT(*) FROM orders"},
            {"type": "columns", "columns": ["n"]},
            {"type": "rows", "rows": [[42]]},
            {"type": "headline", "headline": "There are 42 orders"},
            {"type": "trusted", "items": [{"metric": "orders"}]},
            {"type": "tables_used", "tables": ["orders"]},
            {"type": "chart_config", "chart_config": {"exhibit": {"kind": "figure"}}},
            {"type": "narrative", "narrative": "There are **42** orders.", "anomalies": ["None stand out."],
             "trend": "stable", "confidence": "high"},
            {"type": "followups", "questions": ["How many last month?"]},
            {"type": "inspect_warning", "issues": ["The question asks for a total by status."], "suggested_fix": "",
             "kind": "not_what_was_asked"},
            {"type": "done", "inv_id": "t1", "has_receipt": True},
        ])),
        "/chat/conn1/t1/receipt": httpx.Response(200, json={
            "natural_key": "chat:conn1:t1", "cost": {"total_tokens": 120},
        }),
    }
    res = _run(_client(routes).ask("how many orders", "conn1"))
    assert res["answer"] == "There are 42 orders"
    # What the platform wrote about the rows, and how it would draw them, reach the caller as they were sent.
    assert res["narrative"] == {"narrative": "There are **42** orders.", "anomalies": ["None stand out."],
                                "trend": "stable", "confidence": "high"}
    assert res["chart_config"] == {"exhibit": {"kind": "figure"}}
    assert res["followups"] == ["How many last month?"]
    # What the platform says is wrong with its own answer reaches the caller, with whether it was checked.
    assert res["warning"] == {"issues": ["The question asks for a total by status."], "suggested_fix": "",
                              "kind": "not_what_was_asked"}
    assert res["sql"].startswith("SELECT COUNT")
    assert res["row_count"] == 1
    assert res["rows"] == [[42]]
    assert res["trusted_metrics"] == [{"metric": "orders"}]
    assert res["tables_used"] == ["orders"]
    assert res["investigation_id"] == "t1"
    assert res["receipt"]["cost"]["total_tokens"] == 120


def test_ask_caps_the_row_sample():
    big = [[i] for i in range(500)]
    routes = {
        "/chat": httpx.Response(200, content=_sse([
            {"type": "rows", "rows": big},
            {"type": "headline", "headline": "ok"},
            {"type": "done", "inv_id": "x", "has_receipt": False},
        ])),
    }
    res = _run(_client(routes).ask("q", "c"))
    assert res["row_count"] == 500          # the true count is preserved …
    assert len(res["rows"]) == 50           # … but only a sample is returned to the LLM
    assert "receipt" not in res             # has_receipt False → no fetch


def test_ask_raises_on_error_event_without_answer():
    routes = {"/chat": httpx.Response(200, content=_sse([
        {"type": "error", "message": "Answer stopped — token budget exceeded"},
    ]))}
    with pytest.raises(PramanyxError) as e:
        _run(_client(routes).ask("q", "c"))
    assert "token budget" in str(e.value)


# ── deep_analysis: folds a deep /ask stream — the analyst, the one deep engine (2026-11-23) ──
def test_deep_analysis_returns_report_and_receipt():
    routes = {
        "/ask": httpx.Response(200, content=_sse([
            {"type": "start", "investigation_id": "inv9"},
            {"type": "hypotheses", "hypotheses": [{"text": "h1"}]},
            {"type": "answer_report", "answer_report": {"findings": [{"x": 1}]}, "investigation_id": "inv9"},
            {"type": "done"},
        ])),
        "/ada/conn1/inv9/receipt": httpx.Response(200, json={"natural_key": "ada:conn1:inv9"}),
    }
    res = _run(_client(routes).deep_analysis("why did margin fall", "conn1"))
    assert res["status"] == "complete"
    assert res["investigation_id"] == "inv9"
    assert res["report_kind"] == "ada"
    assert res["report"] == {"findings": [{"x": 1}]}
    assert res["hypotheses"] == [{"text": "h1"}]
    assert res["receipt"]["natural_key"] == "ada:conn1:inv9"


def test_deep_analysis_accepts_deprecated_ada_report_wire_alias():
    # The old `ada_report` event/field is kept one release (REC-U9) — a client on the new
    # code must still fold a stream from an older server.
    routes = {
        "/ask": httpx.Response(200, content=_sse([
            {"type": "start", "investigation_id": "inv9"},
            {"type": "ada_report", "ada_report": {"findings": [{"x": 1}]}, "investigation_id": "inv9"},
            {"type": "done"},
        ])),
        "/ada/conn1/inv9/receipt": httpx.Response(200, json={"natural_key": "ada:conn1:inv9"}),
    }
    res = _run(_client(routes).deep_analysis("why did margin fall", "conn1"))
    assert res["report_kind"] == "ada"
    assert res["report"] == {"findings": [{"x": 1}]}


def test_a_deep_analysis_past_its_deadline_hands_back_the_id_and_lets_the_stream_go():
    """2026-11-23, live: the analyst ran 11 minutes; the stream's keep-alive reset the read timeout, the call outran the
    shell's tool limit, and the coworker said "Request timed out". The deadline is on the whole call now, and at it the
    stream is let go: the run is a job, which writes its trace's end and files its answer envelope when it ends, read or
    not (`test_deep_run_outlives_its_reader.py`). Until 2026-11-24 it was read on in the background for those two."""
    read: list[str] = []
    let_go: list[bool] = []

    async def slow():
        try:
            yield _sse([{"type": "start", "investigation_id": "inv8", "body": "analyst"}]).encode()
            read.append("start")
            await asyncio.sleep(0.5)
            yield b": keep-alive\n\n"
            read.append("keep-alive")
            await asyncio.sleep(0.3)
            yield _sse([{"type": "answer_report", "answer_report": {"headline": "h"}, "investigation_id": "inv8"},
                        {"type": "done"}]).encode()
            read.append("report")
        finally:
            let_go.append(True)

    async def go():
        client = _client({"/ask": lambda req: httpx.Response(200, content=slow())})
        client.deep_timeout = 0.2
        res = await client.deep_analysis("why did margin fall", "c")
        assert res["status"] == "running" and res["investigation_id"] == "inv8"
        assert "get_investigation('inv8')" in res["message"]
        await asyncio.sleep(1.2)
        assert "report" not in read, "nothing reads on after the caller has the id"
        assert let_go == [True], "the stream is closed, not carried"

    _run(go())


def test_deep_analysis_running_when_no_terminal_report():
    # stream ends after `start` (e.g. the client stopped reading) — hand back the id to poll.
    routes = {"/ask": httpx.Response(200, content=_sse([
        {"type": "start", "investigation_id": "inv5"},
    ]))}
    res = _run(_client(routes).deep_analysis("q", "c"))
    assert res["status"] == "running"
    assert res["investigation_id"] == "inv5"
    assert res["report"] is None


# ── get_metric: definition + governed value ──────────────────────────────────────
def test_get_metric_returns_definition_and_value():
    routes = {
        "/metrics": httpx.Response(200, json=[
            {"name": "gross_margin", "label": "Gross Margin", "sql": "SUM(a-b)/SUM(a)"},
            {"name": "aov", "label": "AOV", "sql": "AVG(total)"},
        ]),
        "/metrics/gross_margin/value": httpx.Response(200, json={
            "name": "gross_margin", "label": "Gross Margin", "value": 0.4702,
            "unit": "ratio", "sql": "SUM(a-b)/SUM(a)",
        }),
    }
    res = _run(_client(routes).get_metric(name="gross_margin", connection="conn1"))
    assert res["definition"]["label"] == "Gross Margin"
    assert res["value"] == 0.4702
    assert res["sql"] == "SUM(a-b)/SUM(a)"


def test_get_metric_lists_when_no_name():
    routes = {"/metrics": httpx.Response(200, json=[{"name": "x", "sql": "1"}])}
    res = _run(_client(routes).get_metric())
    assert res["metrics"] == [{"name": "x", "sql": "1"}]


def test_get_metric_unknown_name_raises():
    routes = {"/metrics": httpx.Response(200, json=[{"name": "x", "sql": "1"}])}
    with pytest.raises(PramanyxError) as e:
        _run(_client(routes).get_metric(name="nope", connection="c"))
    assert "no governed metric" in str(e.value)


# ── list_findings / get_briefing / explore / jobs ────────────────────────────────
def test_list_findings_trims_and_caps():
    insights = [{"id": f"i{n}", "finding": f"f{n}", "confidence": 0.9, "novelty": 0.5,
                 "domain": "sales", "sql": "SELECT 1", "extra": "dropped"} for n in range(40)]
    routes = {"/exploration/conn1/findings": httpx.Response(200, json={
        "phase": "complete", "insights": insights,
    })}
    res = _run(_client(routes).list_findings("conn1", limit=10))
    assert res["count"] == 40
    assert len(res["findings"]) == 10
    assert set(res["findings"][0]) == {"id", "finding", "confidence", "novelty", "domain", "sql"}


def test_get_briefing_maps_fields():
    routes = {"/exploration/conn1/briefing": httpx.Response(200, json={
        "narrative": "Margin erosion …", "headline_theme": "Margin", "citations": [{"id": "i1"}],
        "generated_at": "2026-06-21T00:00:00Z", "available": True,
    })}
    res = _run(_client(routes).get_briefing("conn1"))
    assert res["available"] is True
    assert res["headline_theme"] == "Margin"
    assert res["narrative"].startswith("Margin erosion")


def test_explore_reports_started_and_phase():
    routes = {
        "/exploration/conn1/start": httpx.Response(200, json={"ok": True}),
        "/exploration/conn1/status": httpx.Response(200, json={"phase": "running", "insights_found": 3}),
    }
    res = _run(_client(routes).explore("conn1"))
    assert res["started"] is True
    assert res["phase"] == "running"
    assert res["insights_found"] == 3


def test_list_jobs_passthrough():
    routes = {"/jobs": httpx.Response(200, json=[{"id": "j1", "agent": {"name": "Scout"}}])}
    res = _run(_client(routes).list_jobs(state="active"))
    assert res[0]["agent"]["name"] == "Scout"


# ── error surfacing ──────────────────────────────────────────────────────────────
def test_capability_lock_surfaces_cleanly():
    routes = {"/ask": httpx.Response(402, json={"detail": "Upgrade to Pro for Deep Analysis"})}
    with pytest.raises(PramanyxError) as e:
        _run(_client(routes).deep_analysis("q", "c"))
    assert "capability locked" in str(e.value)


def test_a_deep_analysis_the_licence_degrades_to_quick_is_said_to_be_locked():
    routes = {"/ask": httpx.Response(200, content=_sse([
        {"type": "route", "depth": "quick", "downgraded_from": "deep",
         "why": "deep analysis needs an upgrade — answering quickly instead"},
        {"type": "done"},
    ]))}
    with pytest.raises(PramanyxError) as e:
        _run(_client(routes).deep_analysis("q", "c"))
    assert "capability locked" in str(e.value) and "upgrade" in str(e.value)


def test_deep_analysis_asks_the_analyst_through_ask_at_deep_depth():
    seen = {}

    def _ask(request):
        import json as _json
        seen.update(_json.loads(request.content))
        return httpx.Response(200, content=_sse([
            {"type": "start", "investigation_id": "inv7", "body": "analyst"},
            {"type": "answer_report", "answer_report": {"headline": "Margin fell on freight"}, "investigation_id": "inv7"},
            {"type": "done", "body": "analyst"},
        ]))
    routes = {"/ask": _ask, "/ada/c/inv7/receipt": httpx.Response(200, json={"natural_key": "ada:c:inv7"})}
    res = _run(_client(routes).deep_analysis("why did margin fall", "c", canvas="cv1"))
    assert seen["depth"] == "deep" and seen["canvas_id"] == "cv1"
    assert res["report"] == {"headline": "Margin fell on freight"} and res["status"] == "complete"


def test_not_found_surfaces_cleanly():
    routes = {"/jobs/missing": httpx.Response(404, json={"detail": "No such job"})}
    with pytest.raises(PramanyxError) as e:
        _run(_client(routes).get_job("missing"))
    assert "not found" in str(e.value).lower()


def test_dropped_none_query_params():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["query"] = str(request.url.query)
        return httpx.Response(200, json={"insights": []})

    client = PramanyxClient(base_url="http://test", transport=httpx.MockTransport(handler))
    _run(client.list_findings("conn1", schema=None, limit=5))
    # schema=None must NOT be sent as ?schema=None
    assert b"schema" not in (request_query := seen["query"].encode())
    assert b"None" not in request_query


# ── real path: drive the actual app in-process (no LLM, no live server) ──────────
def _real_client() -> PramanyxClient:
    from pramanyx.api import app
    return PramanyxClient(base_url="http://test", transport=httpx.ASGITransport(app=app))


def test_real_path_list_connections_and_jobs():
    client = _real_client()
    conns = _run(client.list_connections())
    assert isinstance(conns, list)              # hermetic env → empty, but the wiring runs
    jobs = _run(client.list_jobs())
    assert isinstance(jobs, list)


def test_real_path_metric_value_endpoint_404():
    # Proves the new GET /metrics/{name}/value route is wired into the live app.
    client = _real_client()
    with pytest.raises(PramanyxError) as e:
        _run(client._get("/metrics/__no_such_metric__/value", params={"conn_id": "x"}))
    assert "not found" in str(e.value).lower()


# ── one run per question: the coworker waits on the run it has, rather than ask again (2026-11-24) ──────────────────
def test_reading_a_running_analysis_waits_for_it_and_returns_the_report_when_it_lands(monkeypatch):
    """Seen twice: the coworker read a running run four times in half a minute — each read answered at once with a
    bare 'running' — took it for stuck, and asked the same question again through another tool."""
    import pramanyx.mcp.client as C
    monkeypatch.setattr(C, "READ_EVERY_S", 0.01)
    reads: list[int] = []

    def record(req):
        reads.append(1)
        if len(reads) < 3:
            return httpx.Response(200, json={"id": "inv9", "status": "running",
                                             "progress": {"steps": len(reads), "last_step": "decompose"}})
        return httpx.Response(200, json={"id": "inv9", "status": "complete", "report": {"headline": "It fell"}})

    client = _client({"/investigations/inv9": record})
    client.read_wait = 5.0
    got = _run(client.get_investigation("inv9"))
    assert got["status"] == "complete" and got["report"]["headline"] == "It fell"
    assert len(reads) == 3, "read again while it ran, and not after it ended"


def test_a_run_still_going_at_the_end_of_the_wait_says_how_far_it_has_got(monkeypatch):
    import pramanyx.mcp.client as C
    monkeypatch.setattr(C, "READ_EVERY_S", 0.01)
    client = _client({"/investigations/inv9": httpx.Response(200, json={
        "id": "inv9", "status": "running", "progress": {"steps": 4, "last_step": "decompose", "running_for_s": 410}})})
    client.read_wait = 0.05
    got = _run(client.get_investigation("inv9"))
    assert got["status"] == "running"
    assert "taken 4 steps so far, the last decompose" in got["message"]
    assert "get_investigation('inv9') waits for it" in got["message"] and "Poll" not in got["message"]


def test_a_finished_run_is_read_at_once():
    reads: list[int] = []
    client = _client({"/investigations/inv9": lambda req: (reads.append(1), httpx.Response(
        200, json={"id": "inv9", "status": "failed", "error": "Stopped at the Analyst's 1800s time budget"}))[1]})
    got = _run(client.get_investigation("inv9"))
    assert got["status"] == "failed" and len(reads) == 1 and "message" not in got


def test_a_deep_analysis_waiting_for_a_slot_says_so_by_its_id(monkeypatch):
    """Its door names the run as it claims the question; a call whose deadline comes while the job still waits for a
    slot hands back that id, and says the run is queued — not that it is running, nor that it never started."""
    import pramanyx.mcp.client as C
    monkeypatch.setattr(C, "READ_EVERY_S", 0.01)

    async def queued():
        yield _sse([{"type": "route", "depth": "deep"}, {"type": "start", "investigation_id": "inv5"}]).encode()
        await asyncio.sleep(1.0)
        yield b": keep-alive\n\n"

    record = httpx.Response(200, json={"id": "inv5", "status": "running",
                                       "progress": {"queued": True, "steps": 0, "running_for_s": 40}})

    async def go():
        client = _client({"/ask": lambda req: httpx.Response(200, content=queued()), "/investigations/inv5": record})
        client.deep_timeout = 0.2
        res = await client.deep_analysis("why did margin fall", "c")
        assert res["status"] == "running" and res["investigation_id"] == "inv5"
        assert "queued" in res["message"] and "get_investigation('inv5')" in res["message"]
        client.read_wait = 0.05
        read = await client.get_investigation("inv5")
        assert "queued" in read["message"] and "still running" not in read["message"]
    _run(go())


def test_a_repeat_handed_another_run_is_read_as_the_run_that_answers_it():
    """A coworker holding a repeat's id (its runs list names it) reads the run it was handed, said so — not a record
    with an error and no report, which reads as a failure."""
    client = _client({
        "/investigations/again": httpx.Response(200, json={"id": "again", "status": "handed_back", "handed_to": "inv9",
                                                           "error": "This question is already being analysed"}),
        "/investigations/inv9": httpx.Response(200, json={"id": "inv9", "status": "complete",
                                                          "report": {"headline": "It fell"}}),
    })
    got = _run(client.get_investigation("again"))
    assert got["id"] == "inv9" and got["status"] == "complete" and got["handed_from"] == "again"


def test_a_deep_analysis_already_under_way_is_handed_back_running_not_complete():
    """The door hands back the run under way by its id; it is read as running, never as a finished run with nothing in
    it."""
    said = "This question is already being analysed (run inv7, started 3 min ago, still going), so it was not started"
    routes = {"/ask": httpx.Response(200, content=_sse([
        {"type": "route", "depth": "deep"},
        {"type": "already_running", "investigation_id": "inv7", "already_running": said},
    ]))}
    res = _run(_client(routes).deep_analysis("why did margin fall", "c"))
    assert res["status"] == "running" and res["investigation_id"] == "inv7"
    assert res["message"] == said and res["report"] is None


def test_a_deep_analysis_handed_a_run_still_starting_says_so_without_an_id():
    said = "This question is already being analysed, started under a minute ago, and that run is still starting"
    routes = {"/ask": httpx.Response(200, content=_sse([
        {"type": "route", "depth": "deep"},
        {"type": "already_running", "investigation_id": None, "already_running": said},
    ]))}
    res = _run(_client(routes).deep_analysis("why did margin fall", "c"))
    assert res["status"] == "running" and res["investigation_id"] is None and res["message"] == said
