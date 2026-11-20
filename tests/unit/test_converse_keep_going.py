"""Keep going (the user, 2026-11-20, on Operations: a chart asked for "YYYY-MM" stopped with "ask a narrower question").

A conversation turn that spends every step does not tell the person to narrow a question that was rarely the problem: it
says what it did and offers Keep going. Going on, the next turn is told the steps the last one took (refusals marked) and
not to call again a tool that said no. These drive the REAL `_stream_converse` against a stubbed `converse()`.
"""
from __future__ import annotations

import asyncio
import json
import types

import pytest

from pramanyx.routers import investigations as inv


def _result(answer, stop_reason, steps=3):
    return types.SimpleNamespace(answer=answer, steps=[object()] * steps, stop_reason=stop_reason,
                                 injected_chars=0, reinjection_ratio=0.0)


@pytest.fixture
def offline(monkeypatch):
    monkeypatch.setattr(inv, "build_history_section", lambda h: "")
    monkeypatch.setattr(inv, "build_prior_answers_section", lambda a: "")
    monkeypatch.setattr(inv, "resolve_prior_answers", lambda *a, **k: [])
    monkeypatch.setattr("pramanyx.agent.converse_tools.ground_answer_numbers",
                        lambda answer, rows, question="": (answer, None))


def _drive(question: str, **kw) -> list[dict]:
    async def _go():
        return [json.loads(chunk.split("data: ", 1)[1])
                for chunk in [c async for c in inv._stream_converse(question, "fixture", [], session_id="kg-1", **kw)]
                if chunk.startswith("data: ")]
    return asyncio.run(_go())


def test_a_turn_that_spent_every_step_says_so_and_offers_to_keep_going(offline, monkeypatch):
    monkeypatch.setattr("pramanyx.agent.converse_tools.converse", lambda *a, **k: _result(None, "budget", steps=8))
    frames = _drive("Write the months as YYYY-MM")
    headline = next(f for f in frames if f["type"] == "headline")["headline"]
    assert headline.startswith("I used all 8 steps this turn before finishing.") and "Keep going" in headline
    assert "narrower" not in headline
    assert [f["steps"] for f in frames if f["type"] == "keep_going"] == [8]


def test_a_turn_that_answered_at_its_last_step_still_offers_to_keep_going_and_one_that_finished_does_not(offline, monkeypatch):
    monkeypatch.setattr("pramanyx.agent.converse_tools.converse", lambda *a, **k: _result("Mostly done.", "budget_answered"))
    assert any(f["type"] == "keep_going" for f in _drive("q"))
    monkeypatch.setattr("pramanyx.agent.converse_tools.converse", lambda *a, **k: _result("Done.", "answered"))
    assert not any(f["type"] == "keep_going" for f in _drive("q"))


def test_keeping_going_tells_the_conversation_what_was_done_and_not_to_ask_a_tool_that_said_no_again(offline, monkeypatch):
    seen: dict = {}

    def converse(*a, **k):
        seen.update(k)
        return _result("Dates are now written as YYYY-MM once you allow it.", "answered")

    monkeypatch.setattr("pramanyx.agent.converse_tools.converse", converse)
    done = "1. change_chart — said no: “monthFormat” is not something the chart editor sets.\n2. explain_dashboard"
    _drive("Write the months as YYYY-MM", keep_going=done)
    ctx = seen["extra_context"]
    # among the turn's context, wherever the other sections put it (what the platform already knows can stand before it)
    assert "## Keep going" in ctx and done in ctx and "do not call again a tool that said no" in ctx
    seen.clear()
    _drive("Write the months as YYYY-MM")
    assert "## Keep going" not in (seen["extra_context"] or "")


def test_the_ask_door_carries_keep_going_from_the_panel_to_the_conversation():
    assert inv.AskRequest(question="q", keep_going="1. run_sql").keep_going == "1. run_sql"
    assert inv.AskRequest(question="q").keep_going == ""
    with pytest.raises(Exception):
        inv.AskRequest(question="q", keep_going="x" * 4001)
