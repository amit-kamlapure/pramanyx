"""One run per question: an agent asking again for a deep analysis it already has under way is handed that run.

Seen twice on 2026-11-24 (0237d0fc, then cff38269 and dd94959a): the coworker's deep analysis outlived its call, the
coworker read the running run a few times in half a minute — each read answered at once with a bare 'running' — took it
for stuck, and asked the same question again through a custom agent, whose conversation ran a second deep analysis
beside the first. That second one ran inline, not as a job, and `run_analyst` wrote its row only when it returned.

Hermetic: the history store is the conftest-isolated one; no model is called and no warehouse is read.
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import subprocess
import sys
import threading
import uuid

import pytest

Q = "Why did theLook's revenue change from May to June 2026? Find the drivers."


@pytest.fixture(autouse=True)
def no_claims_left():
    from pramanyx.agent import one_run
    from pramanyx.kernel.ledger import Ledger
    Ledger.default().kv_replace_all(one_run.STORE, {})
    yield
    Ledger.default().kv_replace_all(one_run.STORE, {})


@pytest.fixture
def as_user():
    """The user a request is (`org.context`), set as sign-in, a delegation or a door's `principal_ref` sets it."""
    from pramanyx.org.context import reset_user_id, set_user_id
    tokens = []

    def become(who: str):
        tokens.append(set_user_id(who))
    yield become
    for t in reversed(tokens):
        reset_user_id(t)


# ── the claim ─────────────────────────────────────────────────────────────────

def _running(conn: str = "conn-1") -> str:
    """A real run's row, still 'running' — what a claim names once its run exists."""
    from pramanyx.db import history
    return history.create_investigation(Q, conn)


def test_a_repeat_is_handed_the_run_under_way_and_only_its_own_partys(as_user):
    from pramanyx.agent import one_run

    mine, held = one_run.take(Q, "conn-1")
    assert mine is not None and held is None
    run = _running()
    mine.found(run)
    assert one_run.take("why did thelook's revenue change from may to june 2026?  find the drivers.",
                        "conn-1")[1]["inv_id"] == run, "the same question, as `asked_before` compares two"
    # The review's probe: with no person in scope, `deep_analysis` files the actor and a custom agent's ask files
    # `api:mcp:<host>` — both the install's own agent, one party.
    as_user("api:mcp:my-host")
    assert one_run.take(Q, "conn-1")[1]["inv_id"] == run
    for other in (dict(question=Q, connection_id="conn-2"), dict(question=Q, connection_id="conn-1", canvas_id="cv"),
                  dict(question=Q, connection_id="conn-1", schema="sales"),
                  dict(question="Why did orders fall?", connection_id="conn-1")):
        theirs, handed = one_run.take(**other)
        assert handed is None, other
        theirs.end()
    as_user("ana@example.com")
    ana, handed = one_run.take(Q, "conn-1")
    assert handed is None, "never another party's run: a person is not the install"
    as_user("bo@example.com")
    assert one_run.take(Q, "conn-1")[0] is not None, "nor another person's"


def test_a_repeat_while_the_first_is_still_starting_waits_for_its_id():
    """The analyst writes its row half a minute in: two asks at once both started a run."""
    from pramanyx.agent import one_run

    first, _ = one_run.take(Q, "conn-1")
    run = _running()
    got: dict = {}
    t = threading.Thread(target=lambda: got.update(r=one_run.under_way([Q], "conn-1", wait_s=5)))
    t.start()
    first.found(run)
    t.join(5)
    assert got["r"] == {"id": run, "started_at": first.began_at}


def test_a_run_that_ends_without_an_id_lets_the_repeat_start_its_own():
    from pramanyx.agent import one_run

    first, _ = one_run.take(Q, "conn-1")
    got: dict = {}
    t = threading.Thread(target=lambda: got.update(r=one_run.under_way([Q], "conn-1", wait_s=5)))
    t.start()
    first.end()
    t.join(5)
    assert got["r"] is None and one_run.take(Q, "conn-1")[0] is not None


def test_a_claim_that_outlived_its_run_is_never_handed_back():
    """A leaked claim — a job cancelled before it ran, an end its run never reached — would hand a finished run back as
    'still going': a claim stands only while its run's row is 'running'."""
    from pramanyx.agent import one_run
    from pramanyx.db import history

    leaked, _ = one_run.take(Q, "conn-1")
    run = _running()
    leaked.found(run)
    history.fail_investigation(run, status="failed", reason="stopped")
    mine, held = one_run.take(Q, "conn-1")
    assert held is None and mine is not None


# ── the door: an agent's plain repeat is handed the run, and nothing else is ──

@pytest.fixture
def door(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from pramanyx.routers import investigations as inv

    started: list[str] = []
    seen: dict = {}

    async def analyst_body(*a, **k):
        seen["run_id"] = k.get("run_id")
        yield inv._sse("headline", {"headline": "a new run"})

    async def job(body_factory, **kw):
        started.append("analyst")
        seen["claim"] = kw.get("claim")
        seen["payload"] = kw.get("payload")
        async for f in body_factory():
            yield f

    async def nothing(*a, **k):
        return None

    async def converse_turn(*a, **kw):
        seen["converse"] = kw
        yield inv._sse("headline", {"headline": "from the conversation"})

    monkeypatch.setattr(inv, "_stream_analyst", analyst_body)
    monkeypatch.setattr(inv, "_job_streamed_body", job)
    monkeypatch.setattr(inv, "_stream_converse", converse_turn)
    monkeypatch.setattr(inv, "_metered_stream", lambda gen, budget=None: gen)
    monkeypatch.setattr(inv, "_ask_subject_for", nothing)
    monkeypatch.setattr(inv, "_build_origin_finding", nothing)
    monkeypatch.setattr("pramanyx.agent.converse_tools.binding_calls_tools", lambda: True)
    monkeypatch.setattr("pramanyx.licensing.has_capability", lambda *a, **k: True)
    monkeypatch.setattr("pramanyx.kernel.flags.flag_enabled", lambda n: False)
    app = FastAPI()
    app.include_router(inv.router)
    return TestClient(app), started, seen


def _ask(client, *, agent: bool, depth: str = "deep", question: str = Q, **extra) -> list[dict]:
    # what the coworker's `deep_analysis` posts (`mcp/client.py`), with the agent mark its every call carries
    body = {"question": question, "connection_id": "conn-1", "schema": None, "depth": depth, "deep": True,
            "skip_cache": False, "canvas_id": None, **extra}
    r = client.post("/ask", json=body, headers={"X-Pramanyx-Agent": "mcp"} if agent else {})
    assert r.status_code == 200, r.text[:800]
    return [json.loads(ln[6:]) for ln in r.text.splitlines() if ln.startswith("data: ")]


def test_an_agents_repeat_is_handed_the_run_under_way(door):
    from pramanyx.agent import one_run

    client, started, _ = door
    first, _ = one_run.take(Q, "conn-1")
    run = _running()
    first.found(run)
    frames = _ask(client, agent=True)
    assert started == [], "no second run"
    said = next(f for f in frames if f["type"] == "already_running")
    assert said["investigation_id"] == run and f"get_investigation('{run}') waits for it" in said["already_running"]


def test_an_agents_ask_is_named_the_moment_it_is_claimed_and_a_repeat_is_handed_that_name(door):
    """At ca93400 a run's row was made by its body, once its job had a slot and its context was built; a repeat in
    between waited 90 s and was told only that a run was "still starting" — with no id to read it by."""
    import time

    from pramanyx.db import history

    client, started, seen = door
    _ask(client, agent=True)
    named = seen["claim"].inv_id
    assert named and history.get_investigation(named)["status"] == "running", "its row exists before its job runs"
    assert seen["run_id"] == named, "the run adopts it"
    assert seen["payload"]["investigation_id"] == named, "its job names it while queued"
    began = time.monotonic()
    said = next(f for f in _ask(client, agent=True) if f["type"] == "already_running")
    assert said["investigation_id"] == named and time.monotonic() - began < 5, "handed its name at once"
    assert started == ["analyst"], "and not run twice"


def test_a_claim_that_never_names_its_run_is_handed_to_no_one(door, monkeypatch):
    """A claim whose maker never named its run (a broken maker) is never a hand-back with nothing to read: the repeat
    runs its own."""
    from pramanyx.agent import one_run

    monkeypatch.setattr(one_run, "WAIT_FOR_ID_S", 0.3)
    client, started, _ = door
    one_run.take(Q, "conn-1")                          # claimed with no name, and never named
    frames = _ask(client, agent=True)
    assert not [f for f in frames if f["type"] == "already_running"]
    assert started == ["analyst"]


def test_an_agents_first_ask_claims_its_question_for_its_run(door):
    client, started, seen = door
    _ask(client, agent=True)
    assert started == ["analyst"] and seen["claim"] is not None and seen["claim"].slots


@pytest.mark.parametrize("who", [
    dict(agent=False),                                              # a person in the app
    dict(agent=True, skip_cache=True),                              # a fresh run
    dict(agent=True, purpose="ask_again"),
    dict(agent=True, history=[{"question": "How much revenue in May?", "sql": "SELECT 1"}]),   # a follow-up
    dict(agent=True, insight_id="f1"),                              # a drill from a finding
])
def test_nothing_but_an_agents_plain_repeat_is_handed_one(door, who):
    from pramanyx.agent import one_run

    client, started, seen = door
    first, _ = one_run.take(Q, "conn-1")
    first.found(_running())
    _ask(client, **who)
    assert started == ["analyst"] and seen["claim"] is None


def test_the_conversation_route_carries_an_agents_plain_ask_to_its_deep_tool(door):
    """The route dd94959a took: an agent's ask answered by a conversation, whose deep tool ran its own analysis."""
    client, _, seen = door
    plain = "How many orders were there in June 2026?"      # a "why" asked quick is routed to the analyst, claimed there
    _ask(client, agent=True, depth="quick", deep=False, question=plain)
    assert seen["converse"]["agent_call"] is True
    _ask(client, agent=True, depth="quick", deep=False, question=plain, skip_cache=True)
    assert seen["converse"]["agent_call"] is False, "a fresh ask starts its own"
    _ask(client, agent=False, depth="quick", deep=False, question=plain)
    assert seen["converse"]["agent_call"] is False


def test_the_conversation_body_hands_converse_the_agents_plain_ask(monkeypatch):
    from pramanyx.agent import converse_tools
    from pramanyx.agent.tool_loop import LoopResult
    from pramanyx.routers import investigations as inv

    got: dict = {}

    def converse(*a, **kw):
        got.update(kw)
        return LoopResult(answer="", steps=[], stop_reason="done")

    monkeypatch.setattr(converse_tools, "converse", converse)

    async def drain():
        return [f async for f in inv._stream_converse(Q, "conn-1", [], agent_call=True)]

    asyncio.run(drain())
    assert got["agent_call"] is True


def test_converse_hands_its_tool_set_the_agents_ask_and_the_turns_own_question(monkeypatch):
    from pramanyx.agent import converse_tools

    class Built(Exception):
        pass

    def tools(*a, **kw):
        raise Built(kw)

    monkeypatch.setattr(converse_tools, "converse_tools", tools)
    with pytest.raises(Built) as got:
        converse_tools.converse("conn-1", Q, agent_call=True)
    assert got.value.args[0]["agent_call"] is True and got.value.args[0]["user_question"] == Q


def test_the_deep_tool_is_handed_a_jobs_run_by_the_agents_words(monkeypatch):
    from pramanyx.agent import converse_tools, one_run

    monkeypatch.setattr("pramanyx.licensing.has_capability", lambda *a, **k: True)
    first, _ = one_run.take(Q, "conn-1")
    run = _running()
    first.found(run)
    deep = next(t for t in converse_tools.converse_tools("conn-1", user_question=Q, agent_call=True)
                if t.name == "deep_analysis")
    out = deep.run({"question": "What drove the revenue increase from May to June 2026?"})   # the inner model's words
    assert out["status"] == "running" and out["investigation_id"] == run


def test_a_conversations_deep_tool_says_the_run_it_was_handed_where_the_coworker_reads_it(monkeypatch):
    from pramanyx.agent import converse_tools, one_run
    from pramanyx.custom_agents.reach import fold_frame, start_fold

    monkeypatch.setattr("pramanyx.licensing.has_capability", lambda *a, **k: True)
    monkeypatch.setattr("pramanyx.agent.analyst.run_analyst", lambda *a, **k: pytest.fail("ran a second analysis"))
    first, _ = one_run.take(Q, "conn-1")
    run = _running()
    first.found(run)
    frames: list[tuple] = []
    out = converse_tools.deep_analysis("conn-1", {"question": Q}, agent_call=True, emit=lambda t, p: frames.append((t, p)))
    assert out["status"] == "running" and f"giving the run's id, {run}" in out["note"]
    fold = start_fold("theLook Analyst", Q)
    for t, p in frames + [("done", {"inv_id": "chat-turn-7"})]:
        fold_frame(fold, {"type": t, **p})
    assert fold["deep_analysis"]["investigation_id"] == run, "the coworker reads the run, not the chat turn"


def test_a_conversations_inline_run_is_never_one_a_repeat_is_handed(monkeypatch):
    """It stops with its reader (the custom agent's call), so a coworker handed it would read it failed."""
    from pramanyx.agent import converse_tools, one_run
    from pramanyx.agent.analyst import AnalystResult

    monkeypatch.setattr("pramanyx.licensing.has_capability", lambda *a, **k: True)
    during: dict = {}

    def run_analyst(connection_id, question, *, emit=None, **kw):
        during["repeat"] = one_run.take(Q, "conn-1")
        return AnalystResult(answer="done", report=None, steps=[], stop_reason="done", investigation_id="inv2")

    monkeypatch.setattr("pramanyx.agent.analyst.run_analyst", run_analyst)
    converse_tools.deep_analysis("conn-1", {"question": Q}, agent_call=True, user_question=Q)
    mine, held = during["repeat"]
    assert held is None and mine is not None, "the repeat starts its own, as a job"


def test_the_bridge_hands_its_claim_the_runs_id_and_frees_it_when_the_run_ends():
    from pramanyx.agent import one_run
    from pramanyx.routers import investigations as inv

    mine, _ = one_run.take(Q, "conn-1")
    run = _running()
    during: dict = {}

    async def body():
        yield f'data: {json.dumps({"type": "start", "investigation_id": run})}\n\n'
        await asyncio.sleep(0.05)
        during["repeat"] = one_run.take(Q, "conn-1")[1]
        yield inv._sse("done", {})

    async def drain():
        return [f async for f in inv._job_streamed_body(lambda: body(), session_id="", conn_id="conn-1", claim=mine)]

    asyncio.run(drain())
    assert during["repeat"]["inv_id"] == run
    assert one_run.take(Q, "conn-1")[1] is None


def test_a_job_cancelled_before_it_ran_lets_its_claim_go(tmp_path, monkeypatch):
    """The kernel's `on_finish` runs for a job cancelled while queued too, so the run's claim does not outlive it."""
    from pramanyx.agent import one_run
    from pramanyx.kernel.jobs import JobKernel
    from pramanyx.kernel.ledger import Ledger

    mine, _ = one_run.take(Q, "conn-1")
    full = asyncio.Semaphore(0)                     # no slot free: the job waits in the queue
    monkeypatch.setattr(JobKernel, "_slot_for", lambda self, kind: full)

    async def main():
        k = JobKernel(Ledger(tmp_path / "system.db"))

        async def work():                           # pragma: no cover — never runs
            pytest.fail("ran")

        jid = await k.submit("investigation", work, on_finish=lambda _j, _s: mine.end())
        await asyncio.sleep(0.05)
        k.cancel(jid, reason="cancelled on request")
        await asyncio.sleep(0.05)

    asyncio.run(main())
    assert one_run.take(Q, "conn-1")[1] is None


# ── a deep run started inside a conversation says how it stopped ──────────────

@pytest.mark.parametrize("stop,said", [
    ("cancel", "Stopped before answering — the request streaming it ended (a closed page or an API restart). "
               "Ask again."),
    ("run_stopped", "Stopped before answering — its reader went away before the answer finished."),
])
def test_a_turn_stopped_on_the_way_leaves_its_row_failed_with_why(monkeypatch, stop, said):
    """Through the real `_run_analyst`: it writes its row, then the first frame it sends finds its reader gone."""
    from pramanyx.agent import analyst
    from pramanyx.db import history
    from pramanyx.kernel.cancellation import RunStopped
    from pramanyx.routers.investigations import _CoreCancelled

    monkeypatch.setattr(analyst, "build_analyst_context",
                        lambda conn_id, question, **kw: (None, {"connection_id": conn_id, "schema_context": ""}))
    exc_type = _CoreCancelled if stop == "cancel" else RunStopped
    seen: dict = {}

    def emit(kind, payload):
        seen["inv"] = payload.get("investigation_id")
        raise exc_type() if stop == "cancel" else exc_type("its reader went away before the answer finished")

    with pytest.raises(exc_type):
        analyst.run_analyst("conn-1", Q, emit=emit)
    row = history.get_investigation(seen["inv"])
    assert row["status"] == "failed" and row["error"] == said


def test_a_run_that_completed_first_keeps_what_it_recorded():
    from pramanyx.db import history

    run = history.create_investigation(Q, "conn-1")
    history.complete_investigation(run, report={"headline": "It rose"}, hypotheses=[], query_history=[],
                                   question=Q, connection_id="conn-1", skip_index=True)
    assert history.fail_if_running(run, "stopped") is False
    assert history.get_investigation(run)["status"] == "complete"


# ── a running run read back says how far it has got ───────────────────────────

def test_reading_a_running_run_says_how_far_it_has_got():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from pramanyx import telemetry
    from pramanyx.db import history
    from pramanyx.obs import session_log
    from pramanyx.routers import investigations as inv

    with telemetry.bind_trace("trace-one-run"):
        run = history.create_investigation(Q, "conn-1")
        for i, tool in enumerate(("baseline", "decompose"), 1):
            session_log.emit(session_log.STEP, name=tool, trace_id="trace-one-run", ok=True,
                             payload={"index": i, "tool": tool})
    app = FastAPI()
    app.include_router(inv.router)
    got = TestClient(app).get(f"/investigations/{run}").json()
    assert got["status"] == "running"
    assert got["progress"]["steps"] == 2 and got["progress"]["last_step"] == "decompose"
    assert got["progress"]["running_for_s"] >= 0


# ── a repeat in other words: the same spec once the intake has resolved it ────

INTAKE = {"metric_sql": "SUM(oi.sale_price)", "metric_table": "order_items", "observation_start": "2026-05-01",
          "observation_end": "2026-05-31", "comparison_start": "2026-04-01", "comparison_end": "2026-04-30",
          "question_shape": "diagnose", "named_dimensions": []}


def test_two_wordings_resolve_to_one_spec_and_different_questions_do_not():
    from pramanyx.agent.one_run import spec_of

    # the motivating pair: "Why did revenue change…? Find the drivers." / "What drove the revenue increase…?" — the
    # model's spelling of one measure is not a different question
    reworded = {**INTAKE, "metric_sql": "sum( oi.sale_price )", "metric_table": "`order_items`"}
    assert spec_of(INTAKE) == spec_of(reworded), "the model's spelling is not a different question"
    # live 2026-11-24: one wording's intake observed June against May, the other's May against June — the same change
    swapped = {**INTAKE, "observation_start": INTAKE["comparison_start"], "observation_end": INTAKE["comparison_end"],
               "comparison_start": INTAKE["observation_start"], "comparison_end": INTAKE["observation_end"]}
    assert spec_of(swapped) == spec_of(INTAKE), "the same two periods, either way round"
    by_category = {**INTAKE, "named_dimensions": ["products.category"]}
    assert spec_of(by_category) != spec_of(INTAKE), \
        "a why broken down by category pins category first: not the analysis of the why that named nothing"
    assert spec_of(by_category) == spec_of({**INTAKE, "named_dimensions": ["`Products`.Category"]})
    assert spec_of({**INTAKE, "named_dimensions": ["a", "b"]}) == spec_of({**INTAKE, "named_dimensions": ["b", "a", "a"]})
    different = [
        {**INTAKE, "observation_start": "2026-06-01", "observation_end": "2026-06-30"},          # another period
        {**INTAKE, "question_shape": "describe"},                                                # another kind of ask
        {**INTAKE, "metric_sql": "SUM(o.sale_price)"},                                            # another table's column
        {**INTAKE, "metric_filters": ["order_items.status = 'Returned'"]},                        # a filter on the rows
        {**INTAKE, "other_measures": [{"label": "orders", "sql": "COUNT(DISTINCT order_id)"}]},   # a second measure
    ]
    for d in different:
        assert spec_of(d) != spec_of(INTAKE), d
    assert spec_of({**INTAKE, "metric_filters": ["status = 'Returned'"]}) != \
        spec_of({**INTAKE, "metric_filters": ["status = 'returned'"]}), "a literal's case is the data's"
    describe = {**INTAKE, "question_shape": "describe"}
    assert spec_of(describe) != spec_of({**describe, "named_dimensions": ["products.category"]}), \
        "a breakdown asked for IS the question when nothing is being explained"
    framed = {**INTAKE, "framed_metric": {"metric": "revenue", "objects": ["completed"]}}
    assert spec_of(framed) == spec_of({**framed, "metric_sql": "SUM(x.y)"}), "a governed metric is itself"
    assert spec_of(framed) != spec_of({**framed, "framed_metric": {"metric": "revenue", "objects": ["returned"]}})
    assert spec_of({"question_shape": "check"}) is None, "nothing to compare without a measure"


def _analyst_up_to_intake(monkeypatch, intake: dict):
    """The real `_run_analyst` as far as its intake, which resolves the question to ``intake``; no model, no
    warehouse."""
    from pramanyx.agent import analyst

    monkeypatch.setattr(analyst, "build_analyst_context", lambda conn_id, question, **kw: (None, {
        "connection_id": conn_id, "schema_context": "", "scope_schema": "", "canvas_id": None,
        "canvas_schema_context": "", "data_catalog": ""}))
    monkeypatch.setattr("pramanyx.agent.investigate.ada_intake", lambda state, conn: {"_ada_intake": dict(intake)})
    monkeypatch.setattr(analyst, "run_tool_loop", lambda *a, **k: pytest.fail("ran the analysis a second time"))
    return analyst


REWORDED = "What drove the revenue increase from April to May 2026?"


@pytest.mark.parametrize("job", [True, False], ids=["as a job", "inline in a conversation"])
def test_a_repeat_in_other_words_is_handed_the_run_after_its_intake(monkeypatch, job):
    from pramanyx.agent import one_run
    from pramanyx.db import history

    analyst = _analyst_up_to_intake(monkeypatch, {**INTAKE, "metric_sql": "sum( oi.sale_price )"})
    first, _ = one_run.take(Q, "conn-1")
    run = _running()
    first.found(run)
    assert one_run.Ask(connection_id="conn-1", claim=first).after_intake(INTAKE) is None, "the first claims its spec"

    second, _ = one_run.take(REWORDED, "conn-1") if job else (None, None)
    frames: list[tuple] = []
    result = analyst.run_analyst("conn-1", REWORDED, emit=lambda t, p: frames.append((t, p)),
                                 ask=one_run.Ask(connection_id="conn-1", claim=second, can_read=job))
    assert result.stop_reason == "already_running" and result.handed_to["id"] == run
    handed = dict(frames)["already_running"]
    assert handed["investigation_id"] == run and "already being analysed" in handed["already_running"]
    row = history.get_investigation(result.investigation_id)
    assert row["status"] == "handed_back" and row["handed_to"] == run, "its own row names the run that answers it"
    assert row["error"] == handed["already_running"], "and what it was told"


def test_a_why_broken_down_by_something_else_runs_its_own_analysis():
    """At c24a181 a named dimension in a why question was taken as a focus of the run under way, and the repeat was
    handed a run that might never break it down that way."""
    from pramanyx.agent import one_run

    first, _ = one_run.take(Q, "conn-1")
    first.found(_running())
    assert one_run.Ask(connection_id="conn-1", claim=first).after_intake(INTAKE) is None
    by_brand, _ = one_run.take("Why did revenue change from April to May 2026, by brand?", "conn-1")
    assert one_run.Ask(connection_id="conn-1", claim=by_brand).after_intake(
        {**INTAKE, "named_dimensions": ["products.brand"]}) is None, "runs: it asks for a breakdown the other may not"
    by_brand.found(_running())
    again, _ = one_run.take("What drove April to May revenue, broken down by brand?", "conn-1")
    assert one_run.Ask(connection_id="conn-1", claim=again).after_intake(
        {**INTAKE, "named_dimensions": ["products.brand"]})["id"] == by_brand.inv_id, "and the same breakdown is its run"


def test_a_hand_back_is_not_booked_as_a_failure_and_never_overwrites_an_end():
    from pramanyx.db import history

    from pramanyx.kernel.ledger import Ledger

    run = _running()
    assert history.hand_back_investigation(run, "handed run abc", handed_to="abc") is True
    got = history.get_investigation(run)
    assert got["status"] == "handed_back" and got["handed_to"] == "abc"
    listed = next(r for r in history.list_investigations(limit=500) if r["id"] == run)
    assert listed["status"] == "handed_back" and listed["handed_to"] == "abc", "the person's history opens run abc"
    journaled = Ledger.default().events(kind="investigation.handed_back", limit=20)
    assert any((e.get("payload") or {}).get("investigation_id") == run for e in journaled), \
        "a page listening for investigation events redraws the row"
    assert not [e for e in Ledger.default().events(kind="investigation.failed", limit=50)
                if (e.get("payload") or {}).get("investigation_id") == run], "not a failure"
    done = _running()
    history.fail_investigation(done, status="failed", reason="cancelled on request")
    assert history.hand_back_investigation(done, "handed run abc") is False
    assert history.get_investigation(done)["error"] == "cancelled on request"


@pytest.mark.parametrize("attempt", range(5))
def test_two_wordings_racing_to_their_spec_at_once_run_once(attempt):
    """Both intakes finish at the same moment: exactly one claims the spec and runs on; the other is handed it."""
    from pramanyx.agent import one_run

    claims = [one_run.take(Q, "conn-1")[0], one_run.take(REWORDED, "conn-1")[0]]
    for c in claims:
        c.found(_running())
    got: list = [None, None]
    go = threading.Barrier(2)

    def race(i):
        go.wait()
        got[i] = one_run.Ask(connection_id="conn-1", claim=claims[i]).after_intake(INTAKE)

    threads = [threading.Thread(target=race, args=(i,)) for i in (0, 1)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    ran_on = [i for i in (0, 1) if got[i] is None]
    assert len(ran_on) == 1, got
    assert got[1 - ran_on[0]]["id"] == claims[ran_on[0]].inv_id


def test_a_twin_that_ends_while_awaited_leaves_the_spec_to_the_waiting_run(monkeypatch):
    """Otherwise a third wording, later, would find the spec unclaimed and run too."""
    from pramanyx.agent import one_run

    monkeypatch.setattr(one_run, "READ_EVERY_S", 0.02)
    a, _ = one_run.take(Q, "conn-1")
    assert one_run.Ask(connection_id="conn-1", claim=a).after_intake(INTAKE) is None   # holds the spec, no row yet
    b, _ = one_run.take(REWORDED, "conn-1")
    got: dict = {}
    t = threading.Thread(target=lambda: got.update(r=one_run.Ask(connection_id="conn-1", claim=b).after_intake(INTAKE)))
    t.start()
    a.end()
    t.join(5)
    assert got["r"] is None, "b runs on"
    b.found(_running())
    third, _ = one_run.take("Why did revenue move between April and May 2026?", "conn-1")
    assert one_run.Ask(connection_id="conn-1", claim=third).after_intake(INTAKE)["id"] == b.inv_id


# ── claims every API process sees, standing as long as their job does ──────────

def _job(state: str, **at) -> str:
    from pramanyx.kernel.ledger import Ledger
    from pramanyx.agent.one_run import _now
    jid = uuid.uuid4().hex[:12]
    Ledger.default().job_insert({"id": jid, "kind": "investigation", "state": state, "created_at": _now(),
                                 "attempt": 1, **at})
    return jid


def test_a_claim_stands_while_its_job_does():
    """At 281c594 a claim with no run yet lapsed after five minutes, though eight investigation slots can keep a job
    queued far longer; and a run whose process died stayed 'running' — handed to repeats — until the hourly sweep."""
    from datetime import datetime, timedelta, timezone

    from pramanyx.agent import one_run

    long_ago = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()

    def row(**kw):       # made twenty minutes ago, its maker stamping it since
        return {"claim": "c", "inv_id": None, "job": None, "began_at": long_ago, "beat_at": one_run._now(), **kw}

    assert one_run._live(row(job=_job("PENDING"))), "queued behind the slots for twenty minutes: still the run"
    assert one_run._live(row(job=_job("RUNNING", heartbeat_at=one_run._now())))
    stale = (datetime.now(timezone.utc) - timedelta(seconds=one_run.HEARTBEAT_LAPSES_S + 30)).isoformat()
    assert not one_run._live(row(job=_job("RUNNING", heartbeat_at=stale))), "its process stopped beating"
    assert not one_run._live(row(job=_job("CANCELLED")))
    assert not one_run._live(row()), "never taken by a job, twenty minutes on"
    assert one_run._live(row(began_at=one_run._now())), "a moment before its job is submitted"


def test_a_claim_whose_process_on_this_host_is_gone_lapses_at_once():
    """A queued job left by a crashed process would otherwise hold its question for the hour."""
    from pramanyx.agent import one_run

    gone = subprocess.run([sys.executable, "-c", "import os; print(os.getpid())"], capture_output=True, text=True)
    dead_pid = int(gone.stdout.strip())
    row = {"claim": "c", "inv_id": None, "job": _job("PENDING"), "began_at": one_run._now(),
           "by": f"{one_run.socket.gethostname()}:{dead_pid}"}
    assert not one_run._live(row)
    assert one_run._live({**row, "by": f"{one_run.socket.gethostname()}:{os.getpid()}"})
    assert one_run._live({**row, "by": "another-host:1"}), "another host's process cannot be asked: it is stamping"


def test_a_claim_whose_maker_stopped_stamping_it_lapses_on_any_host():
    """At c24a181 a claim made on another host stood on its job alone: a queued job whose process died there held its
    question for the hour, as nothing on this host could ask that process."""
    from datetime import datetime, timedelta, timezone

    from pramanyx.agent import one_run

    lapsed = (datetime.now(timezone.utc) - timedelta(seconds=one_run.HEARTBEAT_LAPSES_S + 30)).isoformat()
    queued = {"claim": "c", "inv_id": None, "job": _job("PENDING"), "began_at": lapsed, "by": "another-host:1"}
    assert one_run._live({**queued, "beat_at": one_run._now()})
    assert not one_run._live({**queued, "beat_at": lapsed}), "its maker stopped stamping it: gone"
    assert not one_run._live(queued), "a claim never stamped counts from when it was made"


def test_the_process_holding_a_claim_stamps_it_and_stops_once_it_is_let_go(monkeypatch):
    from pramanyx.agent import one_run
    from pramanyx.kernel.ledger import Ledger

    mine, _ = one_run.take(Q, "conn-1")
    slot = mine.slots[0]
    first = Ledger.default().kv_get(one_run.STORE, slot)["beat_at"]
    assert mine in one_run._HELD, "stamped from the moment it is taken"
    monkeypatch.setattr(one_run, "_now", lambda: "2099-01-01T00:00:00+00:00")
    one_run._stamp_held()
    assert Ledger.default().kv_get(one_run.STORE, slot)["beat_at"] == "2099-01-01T00:00:00+00:00" != first
    monkeypatch.undo()

    other, _ = one_run.take("Another question", "conn-1")
    Ledger.default().kv_delete_if(one_run.STORE, other.slots[0], Ledger.default().kv_get(one_run.STORE, other.slots[0]))
    one_run._stamp_held()                                   # another process let it go: never written back
    assert Ledger.default().kv_get(one_run.STORE, other.slots[0]) is None and other not in one_run._HELD
    mine.end()
    assert mine not in one_run._HELD


def test_a_claim_never_fails_the_run_it_serves(monkeypatch):
    from pramanyx.agent import one_run

    mine, _ = one_run.take(Q, "conn-1")

    class Broken:
        def __getattr__(self, name):
            raise RuntimeError("the ledger is unwritable")

    monkeypatch.setattr(one_run, "_ledger", lambda: Broken())
    mine.found("inv-x")
    mine.started("job-x")
    mine.end()                                              # none of these raises
    assert one_run.take(Q, "conn-2") == (None, None), "and a run that cannot claim starts unclaimed"


def test_another_api_process_sees_the_claim_and_is_handed_the_run():
    """A second process sharing the ledger: a real one, not this process pretending."""
    from pramanyx.agent import one_run

    mine, _ = one_run.take(Q, "conn-1")
    run = _running()
    mine.found(run)
    mine.started(_job("RUNNING", heartbeat_at=one_run._now()))
    code = ("import json; from pramanyx.agent import one_run; "
            f"m, held = one_run.take({Q!r}, 'conn-1'); print(json.dumps({{'mine': m is not None, 'held': held}}))")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=120,
                         cwd=str(pathlib.Path(__file__).resolve().parents[2]), env=dict(os.environ))
    assert out.returncode == 0, out.stderr[-2000:]
    got = json.loads(out.stdout.strip().splitlines()[-1])
    assert got["mine"] is False and got["held"]["inv_id"] == run
    assert got["held"]["by"].endswith(f":{os.getpid()}"), "the claim the other process saw is this one's"


def test_a_claim_is_changed_or_let_go_only_while_it_is_the_one_read():
    """Two processes both finding a dead claim: the first replaces it; the second's late delete must not take the
    first's new claim with it."""
    from pramanyx.agent import one_run
    from pramanyx.kernel.ledger import Ledger

    ledger = Ledger.default()
    slot = one_run._question_slot(Q, "conn-1", "", "")
    dead = {"claim": "dead", "inv_id": None, "job": None, "began_at": "2000-01-01T00:00:00+00:00", "by": "gone:1"}
    ledger.kv_put(one_run.STORE, slot, dead)
    seen_by_late_process = ledger.kv_get(one_run.STORE, slot)
    mine, held = one_run.take(Q, "conn-1")                  # this process clears the dead claim and claims
    assert mine is not None and held is None
    one_run._drop_if_same(slot, seen_by_late_process)       # the late process acts on what it read
    assert ledger.kv_get(one_run.STORE, slot)["claim"] == mine.claim_id


# ── a handed-back run whose reader left, through the real analyst and bridge ──

def test_a_handed_back_run_whose_reader_left_ends_its_trace_ok(monkeypatch):
    """The job writes the trace's end for a reader that left (570a226): a run handed back is not a failure."""
    from pramanyx import telemetry
    from pramanyx.agent import one_run
    from pramanyx.obs import session_log
    from pramanyx.routers import investigations as inv

    _analyst_up_to_intake(monkeypatch, INTAKE)
    first, _ = one_run.take(Q, "conn-1")
    run = _running()
    first.found(run)
    one_run.Ask(connection_id="conn-1", claim=first).after_intake(INTAKE)
    mine, _ = one_run.take(REWORDED, "conn-1")
    trace: dict = {}

    async def turn():
        trace["id"] = telemetry.current_trace_id()
        async for frame in inv._metered_stream(inv._stream_analyst(
                REWORDED, "conn-1", [], ask=one_run.Ask(connection_id="conn-1", claim=mine))):
            yield frame

    door = inv.stream_with_session_log(inv.stream_with_envelope(
        inv._job_streamed_body(lambda: turn(), session_id="", conn_id="conn-1", payload={"question": REWORDED},
                               claim=mine),
        question=REWORDED, conn_id="conn-1"), question=REWORDED, conn_id="conn-1", door="ask", depth="deep")

    async def read_then_leave():
        got: list = []

        async def read():
            async for frame in door:
                got.append(frame)
        reader = asyncio.create_task(read())
        while not got:
            await asyncio.sleep(0.01)
        reader.cancel()
        await asyncio.gather(reader, return_exceptions=True)
        for _ in range(500):
            fins = [e for e in session_log.recover_session(trace.get("id") or "-") if e["kind"] == "final_response"]
            if fins:
                return fins
            await asyncio.sleep(0.01)
        pytest.fail("no end written")

    fins = asyncio.run(read_then_leave())
    assert len(fins) == 1 and fins[0]["ok"] is True
    assert f"run {run}" in fins[0]["payload"]["headline"], "the run it was handed, said"
    from pramanyx.db import history
    assert history.get_investigation(run)["status"] == "running", "the run under way is never ended by its repeat"
    own = next(r for r in history.list_investigations(limit=500) if r.get("handed_to") == run)
    assert own["status"] == "handed_back"
    env = history.get_investigation(own["id"])["report"]["envelope"]
    assert env["provenance"]["handed_to"] == run and env["provenance"]["investigation_id"] == own["id"]
    assert "already being analysed" in env["headline"], "the saved answer says it was handed the run, and which"


def test_the_answer_envelope_records_a_hand_back():
    """At c24a181 the fold ignored the `already_running` frame: a repeat's envelope had no answer, so none was filed."""
    from pramanyx.answer.envelope import EnvelopeFolder

    folder = EnvelopeFolder(question=REWORDED, connection_id="conn-1")
    folder.feed("start", {"investigation_id": "own-row", "connection_id": "conn-1", "question": REWORDED})
    folder.feed("already_running", {"investigation_id": "twin", "already_running": "This question is already being "
                                    "analysed (run twin, still going), so it was not started a second time."})
    env = folder.finish()
    assert env.has_answer and env.headline.startswith("This question is already being analysed")
    assert env.provenance.handed_to == "twin" and env.provenance.investigation_id == "own-row"
    talk = EnvelopeFolder(question=REWORDED, connection_id="conn-1")      # a conversation whose deep tool was handed it
    talk.feed("already_running", {"investigation_id": "twin", "already_running": "already being analysed"})
    talk.feed("headline_delta", {"headline": "Revenue rose 12%; run twin, still going, is breaking it down."})
    said = talk.finish()
    assert said.headline.startswith("Revenue rose 12%") and said.provenance.handed_to == "", \
        "it answered in its own words: its own answer, not a hand-back"
    door = EnvelopeFolder(question=REWORDED, connection_id="conn-1")      # handed at the door: no run of its own
    door.feed("already_running", {"investigation_id": "twin", "already_running": "already being analysed"})
    assert door.finish().provenance.investigation_id == "", "nothing of its own to file the answer on"


def test_a_body_that_hands_back_first_never_ends_the_run_it_names():
    """The bridge files a run's end on the first run id its frames name. A hand-back's frame names the run under way —
    taken for this run's own, a body handed back before it named itself would have the bridge fail the run it was
    handed."""
    from pramanyx.db import history
    from pramanyx.routers import investigations as inv

    twin = _running()

    async def body():
        yield inv._sse("already_running", {"investigation_id": twin, "already_running": f"already being analysed ({twin})"})

    async def drain():
        return [f async for f in inv._job_streamed_body(lambda: body(), session_id="", conn_id="conn-1",
                                                         payload={"question": twin})]

    frames = asyncio.run(drain())
    assert any('"already_running"' in f for f in frames)
    assert history.get_investigation(twin)["status"] == "running", "the run under way goes on"


def test_a_claim_let_go_while_it_is_being_stamped_is_gone(monkeypatch):
    """The stamper reads the claim's row and replaces it; an end that read the same row and deletes after that replace
    would miss it, and leave the claim standing for a run that is over."""
    import time

    from pramanyx.agent import one_run
    from pramanyx.kernel.ledger import Ledger

    real = Ledger.default()
    mine, _ = one_run.take(Q, "conn-1")
    slot = mine.slots[0]
    replacing, release, replaced = threading.Event(), threading.Event(), threading.Event()

    class Slow:
        def __getattr__(self, name):
            return getattr(real, name)

        def kv_replace_if(self, *a, **k):
            replacing.set()
            release.wait(5)
            try:
                return real.kv_replace_if(*a, **k)
            finally:
                replaced.set()

        def kv_delete_if(self, *a, **k):
            replaced.wait(5)                       # an end that read the row before the stamp deletes after it
            return real.kv_delete_if(*a, **k)

    monkeypatch.setattr(one_run, "_ledger", lambda: Slow())
    stamp = threading.Thread(target=one_run._stamp_held)
    stamp.start()
    assert replacing.wait(5)
    ender = threading.Thread(target=mine.end)
    ender.start()
    time.sleep(0.1)
    release.set()
    stamp.join(5)
    ender.join(5)
    assert real.kv_get(one_run.STORE, slot) is None, "let go, whatever the stamp did meanwhile"


def test_the_stamper_thread_stamps_on_its_own(monkeypatch):
    import time

    from pramanyx.agent import one_run
    from pramanyx.kernel.ledger import Ledger

    monkeypatch.setattr(one_run, "BEAT_EVERY_S", 0.02)
    monkeypatch.setattr(one_run, "_STAMPER", None)
    mine, _ = one_run.take(Q, "conn-1")
    first = Ledger.default().kv_get(one_run.STORE, mine.slots[0])["beat_at"]
    for _ in range(250):
        if Ledger.default().kv_get(one_run.STORE, mine.slots[0])["beat_at"] != first:
            break
        time.sleep(0.02)
    assert Ledger.default().kv_get(one_run.STORE, mine.slots[0])["beat_at"] != first, "stamped with no one asking"
    assert one_run._STAMPER is not None and one_run._STAMPER.is_alive()
    mine.end()


def test_a_reloaded_conversation_names_the_run_a_repeat_was_handed():
    """At c24a181 a thread's handed-back turn reloaded as "This deep analysis ended as interrupted — its result is
    uncertain"; nothing about it is uncertain."""
    from pramanyx.routers import investigations as inv

    turn = {"id": "again", "question": REWORDED, "kind": "investigation", "status": "handed_back", "handed_to": "r2",
            "started_at": "2026-11-24T10:00:00+00:00"}
    parts = inv._turn_to_ui_messages(turn)[1]["parts"]
    assert not [p for p in parts if p["type"] == "data-error"]
    assert any(p["type"] == "text" and "(run r2)" in p["text"] and "handed that run" in p["text"] for p in parts)



# ── every claim names its run; nothing nameless is handed to anyone ───────────

def _nameless(slot: str) -> None:
    """A live claim at ``slot`` that names no run: made a moment ago by this process, stamped, never named."""
    from pramanyx.agent import one_run
    from pramanyx.kernel.ledger import Ledger
    Ledger.default().kv_put(one_run.STORE, slot, {"claim": "broken", "inv_id": None, "job": None,
                                                  "began_at": one_run._now(), "beat_at": one_run._now(),
                                                  "by": f"{one_run.socket.gethostname()}:{os.getpid()}"})


def test_a_nameless_claim_is_never_handed_back_after_the_intake_or_to_a_conversation(monkeypatch):
    from pramanyx.agent import one_run

    monkeypatch.setattr(one_run, "WAIT_FOR_ID_S", 0.2)
    monkeypatch.setattr(one_run, "READ_EVERY_S", 0.02)
    _nameless(one_run._slot("s", one_run.spec_of(INTAKE), "conn-1", "", ""))
    mine, _ = one_run.take(REWORDED, "conn-1", name_run=_running)
    assert one_run.Ask(connection_id="conn-1", claim=mine).after_intake(INTAKE) is None, "runs on"
    assert one_run.Ask(connection_id="conn-1", can_read=False).after_intake(INTAKE) is None
    _nameless(one_run._question_slot(Q, "conn-1", "", ""))
    assert one_run.under_way([Q], "conn-1") is None, "a conversation's look finds nothing to hand back"


def test_a_claim_whose_row_cannot_be_made_starts_unclaimed():
    from pramanyx.agent import one_run

    def broken() -> str:
        raise RuntimeError("history is unwritable")

    assert one_run.take(Q, "conn-1", name_run=broken) == (None, None)
    mine, held = one_run.take(Q, "conn-1", name_run=_running)
    assert held is None and mine is not None and mine.inv_id, "nothing of the failed claim was left standing"


def test_the_analyst_adopts_its_doors_row_and_ends_it_if_it_stops_first(monkeypatch):
    from pramanyx.agent import one_run
    from pramanyx.db import history

    analyst = _analyst_up_to_intake(monkeypatch, INTAKE)
    first, _ = one_run.take(Q, "conn-1", name_run=_running)
    assert one_run.Ask(connection_id="conn-1", claim=first).after_intake(INTAKE) is None
    second, _ = one_run.take(REWORDED, "conn-1", name_run=_running)
    before = len(history.list_investigations(limit=1000))
    result = analyst.run_analyst("conn-1", REWORDED, ask=one_run.Ask(connection_id="conn-1", claim=second),
                                 run_id=second.inv_id)
    assert result.investigation_id == second.inv_id and len(history.list_investigations(limit=1000)) == before
    assert history.get_investigation(second.inv_id)["handed_to"] == first.inv_id

    third, _ = one_run.take("A third question entirely", "conn-1", name_run=_running)

    def no_context(*a, **k):
        raise RuntimeError("the warehouse would not open")
    monkeypatch.setattr(analyst, "build_analyst_context", no_context)
    with pytest.raises(RuntimeError):
        analyst.run_analyst("conn-1", "A third question entirely", run_id=third.inv_id)
    row = history.get_investigation(third.inv_id)
    assert row["status"] == "failed" and "would not open" in row["error"], "its row says why, though it never started"


def test_a_job_cancelled_in_the_queue_ends_its_row_its_claim_and_its_readers_stream(monkeypatch):
    """At ca93400 a job cancelled while it waited for a slot never ran its body: its claim was let go, but its reader
    was kept on keep-alives for good, and the row its door made would have stayed 'running' for the hour."""
    from pramanyx.agent import one_run
    from pramanyx.db import history
    from pramanyx.kernel.jobs import JobKernel, kernel
    from pramanyx.routers import investigations as inv

    full = asyncio.Semaphore(0)                     # no slot free: the job waits in the queue
    monkeypatch.setattr(JobKernel, "_slot_for", lambda self, kind: full)
    monkeypatch.setattr(inv, "KEEP_ALIVE_EVERY", 0.05)
    mine, _ = one_run.take(Q, "conn-1", name_run=_running)
    run = mine.inv_id

    async def body():                               # pragma: no cover — never runs
        pytest.fail("ran")
        yield ""

    async def main():
        frames: list = []

        async def read():
            async for f in inv._job_streamed_body(lambda: body(), session_id="", conn_id="conn-1",
                                                  payload={"question": Q, "investigation_id": run}, claim=mine):
                frames.append(f)
        reader = asyncio.create_task(read())
        for _ in range(100):
            if inv._job_id_for_investigation(run):
                break
            await asyncio.sleep(0.02)
        job_id = inv._job_id_for_investigation(run)
        assert job_id, "the cancel route finds a queued run's job by the run its payload names"
        assert inv._progress_of(history.get_investigation(run)).get("queued") is True, "read as waiting"
        kernel().cancel(job_id, reason="cancelled on request")
        await asyncio.wait_for(reader, timeout=5)
        return frames

    frames = asyncio.run(main())
    told = [json.loads(f[6:]) for f in frames if f.startswith('data: {"type": "error"')]
    assert told and "before it started" in told[-1]["message"], "the reader is told, and let go"
    row = history.get_investigation(run)
    assert row["status"] == "failed" and "before it started" in row["error"]
    assert one_run.take(Q, "conn-1")[1] is None, "its question is free again"


def test_a_run_whose_job_cannot_be_started_ends_its_row(monkeypatch):
    from pramanyx.agent import one_run
    from pramanyx.db import history
    from pramanyx.kernel.jobs import kernel
    from pramanyx.routers import investigations as inv

    mine, _ = one_run.take(Q, "conn-1", name_run=_running)

    async def refuse(*a, **k):
        raise RuntimeError("the job ledger is full")
    monkeypatch.setattr(kernel(), "submit", refuse)

    async def body():                               # pragma: no cover — never runs
        yield ""

    async def main():
        return [f async for f in inv._job_streamed_body(lambda: body(), session_id="", conn_id="conn-1", claim=mine)]

    with pytest.raises(RuntimeError):
        asyncio.run(main())
    row = history.get_investigation(mine.inv_id)
    assert row["status"] == "failed" and "could not be started" in row["error"] and "ledger is full" in row["error"]
    assert one_run.take(Q, "conn-1")[1] is None


def test_the_phase_scripts_cache_answers_its_doors_row_by_handing_it_the_run_already_done(monkeypatch):
    from types import SimpleNamespace

    from pramanyx.db import history
    from pramanyx.routers import investigations as inv

    done = _running()
    history.complete_investigation(done, {"headline": "Revenue rose 12%", "_report_type": "investigate"}, [], [],
                                   question=Q, connection_id="conn-1")
    run = _running()
    scope = SimpleNamespace(connection_id="conn-1", schema_context="", eff_schema=None, open=lambda: object())
    monkeypatch.setattr("pramanyx.canvas.scope.resolve_execution_scope", lambda *a, **k: scope)
    monkeypatch.setattr("pramanyx.tools.prior_analyses.find_similar_investigation", lambda q, c: (done, 0.97))

    async def main():
        return [f async for f in inv._stream_investigation(Q, "conn-1", None, run_id=run)]

    frames = asyncio.run(main())
    assert any(f'"investigation_id": "{done}"' in f for f in frames)
    row = history.get_investigation(run)
    assert row["status"] == "handed_back" and row["handed_to"] == done, "opens the run that answered it"



# ── the edges of a run named at its door (2026-11-24 review) ──────────────────

def _drain_bridge(claim, body, **kw):
    from pramanyx.routers import investigations as inv

    async def main():
        return [f async for f in inv._job_streamed_body(lambda: body(), session_id="", conn_id="conn-1", claim=claim,
                                                         **kw)]
    return asyncio.run(main())


def test_the_bridge_names_the_run_once_its_job_holds_it():
    """The id frame goes out once the job is submitted, never before: a reader leaving earlier would have left a row
    and a claim nothing ends."""
    from pramanyx.agent import one_run
    from pramanyx.routers import investigations as inv

    mine, _ = one_run.take(Q, "conn-1", name_run=_running)
    held: dict = {}

    async def body():
        yield inv._sse("headline", {"headline": "done"})

    from pramanyx.routers.investigations import _job_streamed_body

    async def main():
        frames = []
        async for f in _job_streamed_body(lambda: body(), session_id="", conn_id="conn-1", claim=mine,
                                          payload={"question": Q, "investigation_id": mine.inv_id}):
            if not frames:
                held["job"] = inv._job_id_for_investigation(mine.inv_id)
            frames.append(f)
        return frames
    frames = asyncio.run(main())
    first = json.loads(frames[0][6:])
    assert first["type"] == "start" and first["investigation_id"] == mine.inv_id
    assert held["job"], "its job existed when its name was sent"


def test_an_ask_left_while_it_claims_ends_the_row_its_door_made(monkeypatch):
    from types import SimpleNamespace

    from pramanyx.agent import one_run
    from pramanyx.db import history
    from pramanyx.routers import investigations as inv

    real_take = one_run.take
    made: dict = {}

    def slow_take(*a, **k):
        import time
        time.sleep(0.3)
        mine, held = real_take(*a, **k)
        made["claim"] = mine
        return mine, held
    monkeypatch.setattr(one_run, "take", slow_take)
    req = SimpleNamespace(question=Q, canvas_id=None, schema_name=None, purpose="", session_id="")

    async def main():
        task = asyncio.create_task(inv._claim_question(req, "conn-1", inv._named_at_the_door(req, "conn-1")))
        await asyncio.sleep(0.05)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await asyncio.sleep(0.6)                    # the claim finishes in its thread, then is let go
    asyncio.run(main())
    row = history.get_investigation(made["claim"].inv_id)
    assert row["status"] == "interrupted" and "left before its run started" in row["error"]
    assert one_run.take(Q, "conn-1")[1] is None


def test_a_queued_cancel_writes_the_turns_end_and_its_answer_and_frees_an_unclaimed_reader(monkeypatch):
    import time

    from pramanyx.agent import one_run
    from pramanyx.answer.envelope import EnvelopeFolder
    from pramanyx.db import history
    from pramanyx.kernel.jobs import JobKernel, kernel
    from pramanyx.obs import session_log
    from pramanyx.routers import investigations as inv

    monkeypatch.setattr(JobKernel, "_slot_for", lambda self, kind: asyncio.Semaphore(0))   # no slot ever frees
    monkeypatch.setattr(inv, "KEEP_ALIVE_EVERY", 0.05)

    async def body():                               # pragma: no cover — never runs
        pytest.fail("ran")
        yield ""

    async def queued_then_cancelled(claim, payload, *, left: bool):
        frames: list = []

        async def read():
            inv._TURN_ENVELOPE.set(inv._TurnEnvelope(folder=EnvelopeFolder(question=Q, connection_id="conn-1"),
                                                     question=Q, began=time.monotonic()))
            inv._TURN_END.set(inv._TurnEnd(run_id="trace-queued", door="ask", conn_id="conn-1", claimed=False,
                                           t0=time.monotonic(), reader_left_ms=1.0 if left else None))
            async for f in inv._job_streamed_body(lambda: body(), session_id="", conn_id="conn-1", claim=claim,
                                                  payload=payload):
                frames.append(f)
        reader = asyncio.create_task(read())
        for _ in range(100):
            jobs = [j for j in kernel().ledger.jobs_where(kinds=["investigation"], states=["PENDING"], limit=50)
                    if (j.get("payload") or {}) == payload]
            if jobs:
                break
            await asyncio.sleep(0.02)
        kernel().cancel(jobs[0]["id"], reason="cancelled on request")
        await asyncio.wait_for(reader, timeout=5)
        return frames

    mine, _ = one_run.take(Q, "conn-1", name_run=_running)
    asyncio.run(queued_then_cancelled(mine, {"question": Q, "investigation_id": mine.inv_id}, left=True))
    fins = [e for e in session_log.recover_session("trace-queued") if e["kind"] in ("final_response", "execution_error")]
    assert fins and any("before it started" in json.dumps(e) for e in fins), "the trace says how it ended"
    env = history.get_investigation(mine.inv_id)["report"]["envelope"]
    assert "before it started" in env["error"], "and so does its saved answer"

    unclaimed = asyncio.run(queued_then_cancelled(None, {"question": "a person's own deep ask"}, left=False))
    assert any("before it started" in f for f in unclaimed), "a person's queued run, cancelled, is told and let go"


def test_a_job_cancelled_before_its_first_step_still_ends():
    """A cancel landing between the job's task being made and its first step skipped the whole queue hook."""
    import tempfile

    from pramanyx.kernel.jobs import JobKernel, JobState
    from pramanyx.kernel.ledger import Ledger

    ended: list = []

    async def main():
        k = JobKernel(Ledger(pathlib.Path(tempfile.mkdtemp()) / "system.db"))

        async def work():                           # pragma: no cover — never runs
            pytest.fail("ran")
        jid = await k.submit("investigation", work, on_finish=lambda j, st: ended.append(st))
        k.cancel(jid, reason="cancelled on request")    # before the task's first step: no await between
        await asyncio.sleep(0.05)
        return k.ledger.job_get(jid)["state"]
    assert asyncio.run(main()) == JobState.CANCELLED and ended == [JobState.CANCELLED]


def test_the_stale_sweep_spares_a_run_waiting_for_a_slot_and_a_run_is_timed_from_its_start():
    from datetime import datetime, timedelta, timezone

    from pramanyx.db import history

    waiting, orphan = _running(), _running()
    long_ago = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    c = history._conn()
    c.execute("UPDATE investigations SET started_at = ? WHERE id IN (?, ?)", (long_ago, waiting, orphan))
    c.commit()
    c.close()
    _job("PENDING", payload={"question": Q, "investigation_id": waiting})
    history.sweep_stale_running(60)
    assert history.get_investigation(waiting)["status"] == "running", "still waiting for a slot: not orphaned"
    assert history.get_investigation(orphan)["status"] == "failed"
    assert history.adopt_investigation(waiting, "conn-2")
    row = history.get_investigation(waiting)
    assert row["started_at"] > long_ago and row["connection_id"] == "conn-2", "its run time counts from its start"


def test_answer_now_is_refused_for_a_run_still_waiting_for_a_slot():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from pramanyx.routers import investigations as inv

    run = _running()
    _job("PENDING", payload={"question": Q, "investigation_id": run})
    app = FastAPI()
    app.include_router(inv.router)
    r = TestClient(app).post(f"/investigations/{run}/answer-now")
    assert r.status_code == 409 and "waiting for a free analysis slot" in r.json()["detail"]
    got = TestClient(app).get(f"/investigations/{run}").json()
    assert got["progress"]["queued"] is True



def test_a_job_whose_wait_for_a_slot_fails_still_ends():
    import tempfile

    from pramanyx.kernel.jobs import JobKernel, JobState
    from pramanyx.kernel.ledger import Ledger

    ended: list = []

    class Broken:
        async def acquire(self):
            raise RuntimeError("the slot could not be waited on")

    async def main():
        k = JobKernel(Ledger(pathlib.Path(tempfile.mkdtemp()) / "system.db"))
        k._slot_for = lambda kind: Broken()

        async def work():                           # pragma: no cover — never runs
            pytest.fail("ran")
        jid = await k.submit("investigation", work, on_finish=lambda j, st: ended.append(st))
        await asyncio.sleep(0.05)
        return k.ledger.job_get(jid)["state"]
    assert asyncio.run(main()) == JobState.FAILED and ended == [JobState.FAILED]
