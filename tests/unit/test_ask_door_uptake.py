"""SP-15's measure — the share of held rows whose Ask door was used, from the session log.

Pinned: the ask door's request event records the object the palette was summoned from;
the meter joins it to the ledger's held rows; a row asked about that is not held is
counted apart, not as uptake; an unreadable store reports unmeasured, never zero; the
departures summary serves it.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from pramanyx import telemetry
from pramanyx.api import app
from pramanyx.govern.departure_store import record_departure
from pramanyx.obs import session_log
from pramanyx.obs.ask_door_uptake import ask_door_uptake

client = TestClient(app)


@pytest.fixture(autouse=True)
def _own_ledger(tmp_path, monkeypatch):
    monkeypatch.setenv("PRAMANYX_DEPARTURES_DB", str(tmp_path / "departures.db"))


def _row(id_, state):
    return record_departure(id=id_, org_id="default", kind="briefing", state=state, conn_id="c1",
                            automation_id="a1", automation_name="Daily", actor="automation:a1",
                            target="sb:#c", reasons=json.dumps(["held" if state != "departed" else ""]),
                            checks="{}", guards=json.dumps({"remeasure": "held"} if state != "departed" else {}),
                            text_preview="x", investigation_id="")


def _asked(trace: str, focus: dict | None):
    with telemetry.bind_trace(trace):
        session_log.emit(session_log.USER_REQUEST, name="ask", conn_id="c1",
                         payload={"question": "why held?", "depth": "quick",
                                  **({"focus": focus} if focus else {})})


def test_the_meter_joins_held_rows_to_the_requests_that_named_them():
    _row("held-a", "held"); _row("held-b", "held_owner"); _row("gone-c", "departed")
    _asked("t1", {"kind": "departure", "id": "held-a"})
    _asked("t2", {"kind": "departure", "id": "held-a"})        # asked twice: one row
    _asked("t3", {"kind": "departure", "id": "gone-c"})        # a departed row: apart
    _asked("t4", {"kind": "automation", "id": "a1"})           # another kind: not this meter
    _asked("t5", None)                                          # a plain ask
    out = ask_door_uptake()
    assert out["measured"] is True
    assert out["held"] == 2 and out["asked"] == 1 and out["rate"] == 0.5
    assert out["asked_about_rows_not_held"] == 1
    assert out["by_day"] and out["by_day"][0]["asked"] == 1


def test_nothing_held_is_not_a_rate():
    out = ask_door_uptake()
    assert out["measured"] is True and out["held"] == 0 and out["rate"] is None


def test_an_unreadable_store_reports_unmeasured_never_zero(monkeypatch):
    from pramanyx.obs import ask_door_uptake as m
    monkeypatch.setattr("pramanyx.govern.departure_store.list_departures",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("locked")))
    out = m.ask_door_uptake()
    assert out == {"held": None, "asked": None, "rate": None, "by_day": [], "measured": False}


def test_the_departures_summary_serves_it():
    _row("held-z", "held")
    _asked("t9", {"kind": "departure", "id": "held-z"})
    body = client.get("/departures/summary").json()
    assert body["by_state"]["held"] == 1
    assert body["ask_door"]["held"] == 1 and body["ask_door"]["asked"] == 1


def test_the_ask_door_records_the_focus_on_its_request_event():
    """The writer half: `stream_with_session_log(focus=…)` puts it on the request event."""
    import asyncio

    from pramanyx.routers.investigations import stream_with_session_log

    async def _body():
        yield "data: " + json.dumps({"type": "headline", "headline": "x"}) + "\n\n"

    async def _drain():
        return [c async for c in stream_with_session_log(
            _body(), question="why held?", conn_id="c1", door="ask",
            focus={"kind": "departure", "id": "held-q"})]

    asyncio.run(_drain())
    from pramanyx.kernel.ledger import Ledger
    reqs = Ledger.default().session_events(kind=session_log.USER_REQUEST, limit=50)
    mine = [r for r in reqs if (r.get("payload") or {}).get("question") == "why held?"]
    assert mine and mine[0]["payload"]["focus"] == {"kind": "departure", "id": "held-q"}


def test_a_question_the_coworker_claimed_is_recorded_inside_the_coworkers_turn(monkeypatch):
    """One question, one trace. The coworker says which step of which turn is asking; the run then writes under that
    trace and inside that step, and does not open and close a run of its own — the turn's request and end are the
    coworker's to record, and written twice they would read as two runs."""
    import asyncio

    from pramanyx import telemetry
    from pramanyx.org.context import current_session_id
    from pramanyx.routers import coworker
    from pramanyx.routers.investigations import stream_with_session_log

    monkeypatch.setattr(coworker, "_claims", [{
        "trace_id": "cw-88f4fdd19a454d47-7", "session": "session-88f4", "span_id": "call_9",
        "question": "claimed by the coworker?", "connection": "c1", "at": coworker._now()}])
    during = {}

    async def _body():
        during["trace"], during["session"] = telemetry.current_trace_id(), current_session_id()
        with telemetry.mlflow_tool_span("inside the answer"):
            pass
        yield "data: " + json.dumps({"type": "done", "inv_id": "t1"}) + "\n\n"

    async def _drain():
        return [c async for c in stream_with_session_log(_body(), question="claimed by the coworker?", conn_id="c1", door="chat")]

    (done,) = [json.loads(c[6:]) for c in asyncio.run(_drain())]
    assert during == {"trace": "cw-88f4fdd19a454d47-7", "session": "coworker:session-88f4"}
    assert done == {"type": "done", "inv_id": "t1"}                 # the frame is delivered as it was sent
    from pramanyx.kernel.ledger import Ledger
    mine = Ledger.default().session_events(trace_id="cw-88f4fdd19a454d47-7", limit=50)
    kinds = {e["kind"] for e in mine}
    assert session_log.USER_REQUEST not in kinds and session_log.FINAL_RESPONSE not in kinds
    # What the platform did to answer hangs from the coworker's tool call.
    spans = [e for e in mine if e["kind"] == session_log.TOOL_CALL]
    assert spans and {e["parent_span_id"] for e in spans} == {"call_9"}
    assert coworker._claims == [] and telemetry.current_trace_id() == "" and current_session_id() == ""


def test_both_meters_are_served_on_one_spotlight_route():
    """SP-M's vocabulary meter had no route at all; it and the Ask door's share one door now."""
    body = client.get("/spotlight/uptake").json()
    assert set(body) == {"vocabulary", "ask_door"}
    assert {"turns", "in_parts", "rate", "by_day", "measured"} <= set(body["vocabulary"])
    assert {"held", "asked", "rate", "measured"} <= set(body["ask_door"])
