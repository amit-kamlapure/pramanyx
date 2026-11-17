"""Punch list 89 (2026-11-18): Answer now. A person stops a running deep analysis and has it answer from what it has
found — cancelling answers nothing. Every place a run decides whether to keep going goes to its write-up; the report
says it was answered early; only a person asks it, and only of a run that is running."""
from __future__ import annotations

import inspect

import pytest
from fastapi import HTTPException

from pramanyx.agent import answer_now as AN


def test_once_asked_a_run_goes_to_its_write_up_and_no_other_run_does():
    keep_going = AN.or_write_up(lambda state: "plan_queries", "synthesize")
    assert keep_going({"investigation_id": "inv1"}) == "plan_queries"
    AN.ask("inv1")
    try:
        assert keep_going({"investigation_id": "inv1"}) == "synthesize"
        assert keep_going({"investigation_id": "inv2"}) == "plan_queries"
        assert keep_going({}) == "plan_queries"
    finally:
        AN.forget("inv1")
    assert keep_going({"investigation_id": "inv1"}) == "plan_queries"


def test_every_place_a_deep_run_decides_to_keep_going_is_held_to_it():
    from pramanyx.agent import graph
    source = inspect.getsource(graph)
    for route, write_up in (("route_after_phase_wave", "ada_synthesize"), ("route_after_baseline", "ada_synthesize"),
                            ("route_after_decompose", "ada_synthesize"), ("route_after_dimensional", "ada_synthesize"),
                            ("route_after_replan", "synthesize"), ("route_after_wave", "synthesize_exploration"),
                            ("route_after_reason", "synthesize_exploration")):
        assert f'or_write_up({route}, "{write_up}")' in source, route


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
