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
import threading

import pytest

Q = "Why did theLook's revenue change from May to June 2026? Find the drivers."


@pytest.fixture(autouse=True)
def no_claims_left():
    from pramanyx.agent import one_run
    one_run._claims.clear()
    yield
    one_run._claims.clear()


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
                        "conn-1")[1].inv_id == run, "the same question, as `asked_before` compares two"
    # The review's probe: with no person in scope, `deep_analysis` files the actor and a custom agent's ask files
    # `api:mcp:<host>` — both the install's own agent, one party.
    as_user("api:mcp:my-host")
    assert one_run.take(Q, "conn-1")[1].inv_id == run
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
        yield inv._sse("headline", {"headline": "a new run"})

    async def job(body_factory, **kw):
        started.append("analyst")
        seen["claim"] = kw.get("claim")
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


def test_an_agents_repeat_while_the_run_is_still_starting_is_told_so(door, monkeypatch):
    from pramanyx.agent import one_run

    monkeypatch.setattr(one_run, "WAIT_FOR_ID_S", 0.3)
    client, started, _ = door
    one_run.take(Q, "conn-1")                          # claimed, its row not written yet
    said = next(f for f in _ask(client, agent=True) if f["type"] == "already_running")
    assert started == [] and said["investigation_id"] is None and "still starting" in said["already_running"]


def test_an_agents_first_ask_claims_its_question_for_its_run(door):
    client, started, seen = door
    _ask(client, agent=True)
    assert started == ["analyst"] and seen["claim"] is not None and seen["claim"].keys


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
    assert during["repeat"].inv_id == run
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
