"""A deep run goes on without its reader, and a run that stops says so — never left 'running'.

Found live 2026-11-24 on theLook (investigation e4796f93): the coworker's `deep_analysis` passed its 300 s deadline and
handed back the run's id, and the run was believed to have died when the coworker's turn ended. Measured, it had not.
Its job ran 1,258 s and ended SUCCEEDED with no error; its own trace reads `BudgetExceeded: time budget (1200s)` on the
fifth step, then "Answer stopped — the Responder's time budget (1200s) was reached", with the reader still attached.
Three defects made that a run left 'running' until a restart's sweep called it orphaned:

1. The analyst door armed the Responder's budget — a quick answer's — inside an `investigation` job, which is the
   Analyst's, whose budget (1800 s on that install) `JobKernel._run` arms and the heartbeat enforces.
2. `_metered_stream` caught that stop and turned it into an error frame, so the job ended SUCCEEDED.
3. The K1 bridge reconciled the investigation's row only when its body RAISED, so a body that ended — on an error
   frame, or on nothing — left the row 'running'.

Hermetic: the process kernel and the history store are the conftest-isolated ones; no model is called and no warehouse
is read — spend is recorded straight onto the meter.
"""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from pramanyx.kernel import jobs as J
from pramanyx.kernel import metering
from pramanyx.kernel.jobs import JobKernel, JobState


def _frames(raw: list[str]) -> list[dict]:
    return [json.loads(f[6:]) for f in raw if f.startswith("data: ")]


def _gov(**kw):
    return SimpleNamespace(token_budget=kw.get("token_budget"), time_budget_s=kw.get("time_budget_s"), model=None)


async def _settled(inv_id: str, *, leave: str = "running") -> dict:
    from pramanyx.db import history
    for _ in range(300):
        row = history.get_investigation(inv_id)
        if row["status"] != leave:
            return row
        await asyncio.sleep(0.01)
    return row


async def _job_of(inv_id: str) -> dict:
    """The kernel's row for the job that carried this investigation (its payload names it, below)."""
    ledger = J.kernel().ledger
    for _ in range(300):
        for job in ledger.jobs_where(limit=200):
            if (job.get("payload") or {}).get("question") == inv_id and job.get("state") in JobState.TERMINAL:
                return job
        await asyncio.sleep(0.01)
    pytest.fail(f"the job carrying {inv_id} never finished")


async def _bridge(body, inv_id: str, metered: bool = False) -> list[str]:
    from pramanyx.routers import investigations as inv
    factory = (lambda: inv._metered_stream(body())) if metered else (lambda: body())
    return [f async for f in inv._job_streamed_body(factory, session_id="", conn_id="conn-drr",
                                                     payload={"question": inv_id})]


# ── 1. the analyst door runs on the job's budget ──────────────────────────────

def test_the_analyst_door_arms_no_quick_answer_budget_inside_its_job(monkeypatch):
    """The deep turn's job is the Analyst's; the door must not arm the Responder's budget over it."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from pramanyx.routers import investigations as inv

    armed: list = []

    async def analyst_body(*a, **k):
        yield inv._sse("headline", {"headline": "from the analyst"})

    async def job(body_factory, **kw):
        async for f in body_factory():
            yield f

    def meter(gen, budget=None):
        armed.append(budget)
        return gen

    async def nothing(*a, **k):
        return None

    monkeypatch.setattr(inv, "_stream_analyst", analyst_body)
    monkeypatch.setattr(inv, "_job_streamed_body", job)
    monkeypatch.setattr(inv, "_metered_stream", meter)
    monkeypatch.setattr(inv, "_insight_budget", lambda conn_id: (600_000, 1200))
    monkeypatch.setattr(inv, "_ask_subject_for", nothing)
    monkeypatch.setattr(inv, "_build_origin_finding", nothing)
    monkeypatch.setattr("pramanyx.agent.converse_tools.binding_calls_tools", lambda: True)
    monkeypatch.setattr("pramanyx.licensing.has_capability", lambda *a, **k: True)
    monkeypatch.setattr("pramanyx.kernel.flags.flag_enabled", lambda n: False)
    app = FastAPI()
    app.include_router(inv.router)
    # what the coworker's `deep_analysis` posts (`mcp/client.py`)
    r = TestClient(app).post("/ask", json={"question": "Why did revenue fall in August?", "connection_id": "thelook",
                                           "schema": None, "depth": "deep", "deep": True, "skip_cache": False,
                                           "canvas_id": None})
    assert r.status_code == 200, r.text[:800]
    assert any(e.get("headline") == "from the analyst" for e in _frames(r.text.splitlines()))
    assert armed == [None], f"the analyst job was metered under {armed[0]!r}, a quick answer's budget"


# ── 2. a budget the job armed is the job's to record ──────────────────────────

@pytest.mark.anyio
async def test_the_jobs_own_budget_stops_the_run_as_the_kernel_would_and_says_so(monkeypatch):
    """The in-context budget `JobKernel._run` arms fires inside the analyst body: the job is CANCELLED with the budget,
    the row is failed with the Analyst's sentence, and the reader is told — no "Responder" anywhere."""
    from pramanyx.db import history

    monkeypatch.setattr(JobKernel, "_resolve_governance", lambda self, jid: (_gov(token_budget=100), "analyst"))
    inv_id = history.create_investigation("why did revenue fall?", "conn-drr")

    async def body():
        yield f'data: {json.dumps({"type": "start", "investigation_id": inv_id})}\n\n'
        metering.record_llm(prompt_tokens=900, completion_tokens=100)
        metering.check_budget()                   # what the model funnel calls after each request
        yield "data: {}\n\n"                      # pragma: no cover

    said = _frames(await _bridge(body, inv_id, metered=True))
    row = await _settled(inv_id)
    job = await _job_of(inv_id)

    sentence = ("Stopped at the Analyst's 100-token budget before answering (1 model call, 0 queries). Ask a narrower "
                "question, or raise token_budget with PATCH /agents/analyst.")
    assert job["state"] == JobState.CANCELLED, job
    assert job["error"] == "budget exceeded: token budget (100 tokens)"
    assert row["status"] == "failed" and row["error"] == sentence
    errors = [f for f in said if f.get("type") == "error"]
    assert [e["message"] for e in errors] == [sentence], "the reader is told why, once"
    assert errors[0]["reason"] == "budget_exceeded" and errors[0]["agent_id"] == "analyst"
    assert "Responder" not in json.dumps(said)


@pytest.mark.anyio
async def test_a_heartbeat_budget_kill_reaches_the_reader_as_a_budget(monkeypatch):
    """The heartbeat's kill arrives as a cancel; the stream used to just end. The reader is told, as a budget stop."""
    from pramanyx.db import history

    monkeypatch.setattr(J, "_HEARTBEAT_SECONDS", 0.05)
    monkeypatch.setattr(JobKernel, "_resolve_governance", lambda self, jid: (_gov(time_budget_s=0.2), "analyst"))
    inv_id = history.create_investigation("why did revenue fall?", "conn-drr")

    async def body():
        yield f'data: {json.dumps({"type": "start", "investigation_id": inv_id})}\n\n'
        await asyncio.sleep(30)                   # the slow model; the budget ends it
        yield "data: {}\n\n"                      # pragma: no cover

    told = [f for f in _frames(await _bridge(body, inv_id)) if f["type"] == "error"]
    assert len(told) == 1 and told[0]["reason"] == "budget_exceeded" and told[0]["agent_id"] == "analyst"
    assert told[0]["message"].startswith("Stopped at the Analyst's 0.2s time budget before answering")
    assert (await _settled(inv_id))["error"] == told[0]["message"], "the reader and the record say the same"


@pytest.mark.anyio
async def test_outside_a_job_a_quick_answers_own_budget_still_reads_as_the_responders():
    """Unchanged: the budget `_metered_stream` arms itself is the Responder's, and it explains that stop."""
    from pramanyx.routers.investigations import _metered_stream

    async def body():
        metering.record_llm(prompt_tokens=900, completion_tokens=100)
        metering.check_budget()
        yield "data: {}\n\n"                      # pragma: no cover

    said = _frames([f async for f in _metered_stream(body(), budget=(100, None))])
    assert said == [{**said[0], "type": "error",
                     "message": "Answer stopped — the Responder's token budget (100 tokens) was reached."}]


# ── 3. a run that ENDS without an answer is marked so ─────────────────────────

@pytest.mark.anyio
async def test_a_run_that_ends_on_its_own_error_is_failed_with_it():
    """`_stream_analyst` turns a crash into an error frame and ends; the row used to stay 'running'."""
    from pramanyx.db import history
    from pramanyx.routers import investigations as inv

    inv_id = history.create_investigation("why did revenue fall?", "conn-drr")

    async def body():
        yield f'data: {json.dumps({"type": "start", "investigation_id": inv_id})}\n\n'
        yield inv._sse("error", inv._error_event(message="the warehouse did not answer"))

    said = _frames(await _bridge(body, inv_id))
    row = await _settled(inv_id)
    assert row["status"] == "failed"
    assert row["error"] == "Stopped before answering (0 model calls, 0 queries): the warehouse did not answer"
    assert [f["message"] for f in said if f["type"] == "error"] == ["the warehouse did not answer"], \
        "the body already said why; the bridge does not say it twice"


@pytest.mark.anyio
async def test_a_run_that_ends_without_a_word_is_failed_and_says_so():
    from pramanyx.db import history

    inv_id = history.create_investigation("why did revenue fall?", "conn-drr")

    async def body():
        yield f'data: {json.dumps({"type": "start", "investigation_id": inv_id})}\n\n'

    said = _frames(await _bridge(body, inv_id))
    row = await _settled(inv_id)
    sentence = f"Stopped before answering (0 model calls, 0 queries): {J.ENDED_UNSAID}"
    assert row["status"] == "failed" and row["error"] == sentence
    told = [f for f in said if f["type"] == "error"]
    assert [f["message"] for f in told] == [sentence] and told[0]["reason"] == "unknown"
    assert "agent_id" not in told[0], "no agent's page fixes a run that said nothing"


@pytest.mark.anyio
async def test_a_run_paused_for_a_person_is_left_paused():
    """The reconcile touches only 'running': a plan or a clarify waiting on the person is not a stop."""
    from pramanyx.db import history

    inv_id = history.create_investigation("why did revenue fall?", "conn-drr")

    async def body():
        yield f'data: {json.dumps({"type": "start", "investigation_id": inv_id})}\n\n'
        history.pause_investigation(inv_id)
        yield 'data: {"type": "done"}\n\n'

    said = _frames(await _bridge(body, inv_id))
    assert history.get_investigation(inv_id)["status"] == "paused"
    assert not [f for f in said if f["type"] == "error"]


# ── 4. the run does not need its reader ───────────────────────────────────────

@pytest.mark.anyio
async def test_the_run_goes_on_after_its_reader_leaves():
    """A closed page, a restarted coworker, a client past its deadline: the job carries the run to its end without
    them (seen live 2026-11-24, 0237d0fc). Starlette closes the response generator when the client goes; here the
    reader closes it by hand."""
    from pramanyx.db import history
    from pramanyx.routers import investigations as inv

    inv_id = history.create_investigation("why did revenue fall?", "conn-drr")
    go_on = asyncio.Event()

    async def body():
        yield f'data: {json.dumps({"type": "start", "investigation_id": inv_id})}\n\n'
        await go_on.wait()                        # the long middle of a deep run
        history.complete_investigation(inv_id, report={"headline": "Revenue fell on fewer orders"}, hypotheses=[],
                                       query_history=[], question="why did revenue fall?", connection_id="conn-drr",
                                       skip_index=True)
        yield inv._sse("answer_report", {"answer_report": {"headline": "Revenue fell on fewer orders"},
                                         "investigation_id": inv_id})

    reader = inv._job_streamed_body(lambda: body(), session_id="", conn_id="conn-drr", payload={"question": inv_id})
    first = await reader.__anext__()
    assert inv_id in first
    await reader.aclose()                         # the reader leaves
    go_on.set()
    row = await _settled(inv_id)
    job = await _job_of(inv_id)
    assert row["status"] == "complete" and row["report"]["headline"] == "Revenue fell on fewer orders"
    assert job["state"] == JobState.SUCCEEDED
