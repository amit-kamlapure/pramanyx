"""Every model call an agent makes belongs to a run.

Measured 2026-11-14: 373 model calls over two days were filed under no run (`untraced:request:<day>`) — 350 of them a
custom agent's quality check, which ran each certified question through the answer path with no trace open, and the
rest the platform's own agent loop called from a sheet's chat or a dashboard. Work that starts an agent where no run
is open now opens one (`obs/own_run.py`); work inside a request or a job keeps the run it has.
"""
from __future__ import annotations

from pramanyx import telemetry
from pramanyx.obs import session_log
from pramanyx.obs.own_run import own_run


def _recorded(monkeypatch):
    rows = []
    monkeypatch.setattr(session_log, "enabled", lambda: True)
    monkeypatch.setattr("pramanyx.kernel.ledger.Ledger.session_event_insert", lambda self, row: rows.append(row))
    return rows


def test_work_with_no_run_open_opens_one_and_records_what_it_was_and_how_it_ended(monkeypatch):
    rows = _recorded(monkeypatch)
    with own_run("agent_eval", "Checking the agent The Look Analyst against 3 certified questions") as trace:
        assert telemetry.current_trace_id() == trace and trace.startswith("agent_eval-")
        session_log.emit(session_log.LLM_CALL, name="coder", model="m")
    assert telemetry.current_trace_id() == ""
    assert [r["kind"] for r in rows] == ["user_request", "llm_call", "final_response"]
    assert {r["trace_id"] for r in rows} == {trace}                                 # nothing under no run
    assert rows[0]["payload"]["question"].startswith("Checking the agent") and rows[-1]["ok"] is True


def test_work_inside_a_run_keeps_it_and_opens_nothing(monkeypatch):
    rows = _recorded(monkeypatch)
    with telemetry.bind_trace("1d5a621b"), own_run("agent", "x") as trace:
        assert trace == "1d5a621b"
        session_log.emit(session_log.LLM_CALL, name="coder", model="m")
    assert [r["kind"] for r in rows] == ["llm_call"] and rows[0]["trace_id"] == "1d5a621b"


def test_a_run_that_fails_says_so(monkeypatch):
    rows = _recorded(monkeypatch)
    try:
        with own_run("agent_loop", "q"):
            raise ValueError("the model refused")
    except ValueError:
        pass
    assert rows[-1]["kind"] == "final_response" and rows[-1]["ok"] is False
    assert "the model refused" in rows[-1]["payload"]["error"]


def test_an_agent_activated_with_no_run_open_works_under_its_own(monkeypatch):
    from pramanyx.custom_agents.context import activate_agent, release_agent
    from pramanyx.custom_agents.models import UserAgent
    rows = _recorded(monkeypatch)
    agent = UserAgent(id="ua_test", name="The Look Analyst", connection_id="8233e4fd")
    token = activate_agent(agent)
    try:
        session_log.emit(session_log.LLM_CALL, name="coder", model="m")
    finally:
        release_agent(token)
    assert [r["kind"] for r in rows] == ["user_request", "llm_call", "final_response"]
    assert rows[1]["trace_id"].startswith("agent-") and telemetry.current_trace_id() == ""


def test_the_agent_loop_runs_under_a_run(monkeypatch):
    from pramanyx.agent import tool_loop
    seen = {}
    monkeypatch.setattr(tool_loop, "_run_tool_loop",
                        lambda *a, **kw: seen.update(trace=telemetry.current_trace_id(), passed=kw.get("trace_id")) or "done")
    _recorded(monkeypatch)
    assert tool_loop.run_tool_loop(object(), "system", "how many orders?", [], site="sheets.chat") == "done"
    assert seen["trace"].startswith("agent_loop-") and seen["passed"] == seen["trace"]
