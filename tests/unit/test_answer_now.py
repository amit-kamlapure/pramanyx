"""Punch list 89 (2026-11-18): Answer now. A person stops a running deep analysis and has it answer from what it has
found — cancelling answers nothing. The report says it was answered early; only a person asks it, and only of a run
that is running."""
from __future__ import annotations


import pytest
from fastapi import HTTPException

from pramanyx.agent import answer_now as AN


def test_once_asked_only_that_run_is_asked_until_forgotten():
    assert not AN.was_asked("inv1")
    AN.ask("inv1")
    try:
        assert AN.was_asked("inv1")
        assert not AN.was_asked("inv2") and not AN.was_asked("")
    finally:
        AN.forget("inv1")
    assert not AN.was_asked("inv1")


def test_only_a_person_asks_and_only_of_a_running_analysis(monkeypatch):
    from types import SimpleNamespace as NS

    from pramanyx.mcp.client import AGENT_HEADER, AGENT_MARK
    from pramanyx.routers import investigations as I
    rows = {"run": {"status": "running"}, "done": {"status": "complete"}}
    monkeypatch.setattr(I, "get_investigation", lambda i: rows.get(i))
    person = NS(headers={}, state=NS(principal=None))
    try:
        assert I.answer_now_route("run", person) == {"investigation_id": "run", "answering_now": True}
        assert I._early("run") == {"answered_early": AN.SAID}
        assert I._early("done") == {}
        with pytest.raises(HTTPException) as e:
            I.answer_now_route("done", person)
        assert e.value.status_code == 409
        with pytest.raises(HTTPException) as e:
            I.answer_now_route("gone", person)
        assert e.value.status_code == 404
        with pytest.raises(HTTPException) as e:
            I.answer_now_route("run", NS(headers={AGENT_HEADER: AGENT_MARK}, state=NS(principal=None)))
        assert e.value.status_code == 403
    finally:
        AN.forget("run")


def test_the_coworkers_fold_carries_what_the_report_says():
    import asyncio

    from pramanyx.mcp.client import PramanyxClient

    async def frames(*_a, **_k):
        for ev in ({"type": "start", "investigation_id": "inv9"},
                   {"type": "explore_report", "explore_report": {"headline": "h"}, "investigation_id": "inv9",
                    "answered_early": AN.SAID},
                   {"type": "done"}):
            yield ev
    client = PramanyxClient.__new__(PramanyxClient)
    client.deep_timeout = 5
    client._stream_sse = frames
    got = asyncio.run(client.deep_analysis("why did revenue fall", "c1"))
    assert got["answered_early"] == AN.SAID and got["investigation_id"] == "inv9"
