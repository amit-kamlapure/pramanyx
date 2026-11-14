"""Where the coworker is: said by the coworker, remembered for two minutes, and only for an address on this machine."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx.routers import coworker as C


@pytest.fixture()
def door(monkeypatch):
    clock = {"t": 1000.0}
    monkeypatch.setattr(C, "_now", lambda: clock["t"])
    monkeypatch.setattr(C, "_last", {"url": "", "at": 0.0})
    app = FastAPI()
    app.include_router(C.router)
    # The test client's caller is "testclient"; a coworker's is this machine.
    return TestClient(app, client=("127.0.0.1", 50000)), clock


def test_no_coworker_has_said_anything_so_none_is_offered(door):
    client, _ = door
    assert client.get("/coworker").json() == {"available": False, "url": None}


def test_a_coworker_says_where_it_is_and_the_app_is_told(door):
    client, _ = door
    said = client.put("/coworker/address", json={"url": "http://127.0.0.1:3090/?token=abc"})
    assert said.status_code == 200
    assert client.get("/coworker").json() == {"available": True, "url": "http://127.0.0.1:3090/?token=abc"}


def test_a_coworker_that_has_stopped_saying_so_is_not_offered(door):
    client, clock = door
    client.put("/coworker/address", json={"url": "http://localhost:3090/"})
    clock["t"] += C.FRESH_FOR
    assert client.get("/coworker").json()["available"] is True          # the last second it stands
    clock["t"] += 1
    assert client.get("/coworker").json() == {"available": False, "url": None}
    client.put("/coworker/address", json={"url": "http://localhost:3090/"})
    assert client.get("/coworker").json()["available"] is True          # and it comes back when it says so again


@pytest.mark.parametrize("url", [
    "http://example.com:3090/",            # another machine
    "http://10.0.0.7:3090/",               # another machine on the network
    "javascript:alert(1)",                 # not an address a browser should be sent to
    "ftp://127.0.0.1/",
    "http://127.0.0.1.example.com/",       # looks local, is not
    "//127.0.0.1:3090/",
    "",
])
def test_an_address_that_is_not_http_on_this_machine_is_refused_and_not_kept(door, url):
    client, _ = door
    assert client.put("/coworker/address", json={"url": url}).status_code == 422
    assert client.get("/coworker").json()["available"] is False


def test_an_ipv6_loopback_address_is_this_machine(door):
    client, _ = door
    assert client.put("/coworker/address", json={"url": "http://[::1]:3090/"}).status_code == 200


def test_another_machine_may_not_say_where_the_coworker_is(monkeypatch):
    monkeypatch.setattr(C, "_last", {"url": "", "at": 0.0})
    app = FastAPI()
    app.include_router(C.router)
    stranger = TestClient(app, client=("203.0.113.9", 50000))
    assert stranger.put("/coworker/address", json={"url": "http://127.0.0.1:3090/"}).status_code == 403
    assert stranger.get("/coworker").json()["available"] is False


def test_the_route_is_served_by_the_api():
    """The router only matters if the app mounts it."""
    import inspect
    from pramanyx import api
    assert "coworker_router.router" in inspect.getsource(api)


# ── a coworker turn, recorded where runs are ─────────────────────────────────────────────────────────────────────

@pytest.fixture()
def taken(door, monkeypatch):
    """What the session log was told, and under which session id."""
    from pramanyx.obs import session_log
    from pramanyx.org.context import current_session_id
    seen = []
    monkeypatch.setattr(session_log, "emit", lambda kind, **kw: seen.append({"kind": kind, "session": current_session_id(), **kw}))
    return door[0], seen


TURN = {"trace_id": "cw-88f4fdd19a454d47-1", "session": "session-88f4fdd1-9a45-4d47-a907-c446dd4d3d83"}


def test_a_turns_events_are_written_under_its_trace_and_named_as_the_coworkers(taken):
    client, seen = taken
    r = client.post("/coworker/trace", json={**TURN, "events": [
        {"kind": "user_request", "name": "coworker", "conn_id": "c1", "payload": {"question": "How many orders?", "turn": 1}},
        {"kind": "tool_call_result", "name": "mcp__pramanyx__ask", "span_id": "call_1", "ok": True, "duration_ms": 7000,
         "row_count": 5, "payload": {"platform_trace": "1d5a621b", "receipt_id": "r1"}},
    ]})
    assert r.status_code == 200 and r.json() == {"written": 2}
    assert [e["kind"] for e in seen] == ["user_request", "tool_call_result"]
    assert {e["trace_id"] for e in seen} == {TURN["trace_id"]}
    # The door a run came in by is read off the session id's prefix.
    assert {e["session"] for e in seen} == {"coworker:" + TURN["session"]}
    assert seen[1]["payload"]["platform_trace"] == "1d5a621b" and seen[1]["row_count"] == 5


def test_the_session_id_is_not_left_bound_after_the_call(taken):
    from pramanyx.org.context import current_session_id
    client, _ = taken
    client.post("/coworker/trace", json={**TURN, "events": [{"kind": "final_response", "ok": True}]})
    assert current_session_id() == ""


@pytest.mark.parametrize("trace", ["1d5a621b", "untraced:request:2026-11-14", "cw-", "cw-abc-1", "cw-88f4fdd19a454d47-x"])
def test_only_a_coworker_turns_own_trace_can_be_written_to(taken, trace):
    """A run of the platform's own is named otherwise; this route cannot add to one."""
    client, seen = taken
    r = client.post("/coworker/trace", json={**TURN, "trace_id": trace, "events": [{"kind": "final_response"}]})
    assert r.status_code == 422 and seen == []


def test_a_model_call_is_not_taken_here_the_door_records_those(taken):
    client, seen = taken
    r = client.post("/coworker/trace", json={**TURN, "events": [{"kind": "llm_call", "payload": {}}]})
    assert r.status_code == 422 and seen == []


def test_a_payload_carries_only_what_is_named(taken):
    client, seen = taken
    client.post("/coworker/trace", json={**TURN, "events": [
        {"kind": "tool_call", "name": "t", "payload": {"tool": "t", "system_prompt": "the shell's own words", "seq": 19}}]})
    assert seen[0]["payload"] == {"tool": "t", "seq": 19}


def test_another_machine_cannot_record_a_turn(taken, monkeypatch):
    _, seen = taken
    app = FastAPI()
    app.include_router(C.router)
    r = TestClient(app, client=("203.0.113.9", 50000)).post("/coworker/trace", json={**TURN, "events": [{"kind": "final_response"}]})
    assert r.status_code == 403 and seen == []


# ── the platform's work for a turn is inside the turn's trace ────────────────────────────────────────────────────

CLAIM = {**TURN, "span_id": "call_1", "question": "How many orders?", "connection": "c1"}


@pytest.fixture()
def claims(door, monkeypatch):
    monkeypatch.setattr(C, "_claims", [])
    return door


def test_a_claim_is_taken_once_by_the_question_it_was_made_for(claims):
    client, _ = claims
    assert client.put("/coworker/claim", json=CLAIM).status_code == 204
    assert C.claimed_for("Another question", "c1") is None
    assert C.claimed_for("How many orders?", "another") is None
    taken = C.claimed_for("How many orders?", "c1")
    assert taken["trace_id"] == TURN["trace_id"] and taken["span_id"] == "call_1" and taken["session"] == TURN["session"]
    assert C.claimed_for("How many orders?", "c1") is None            # used once


def test_two_calls_asking_the_same_thing_are_answered_in_the_order_they_were_made(claims):
    client, _ = claims
    client.put("/coworker/claim", json=CLAIM)
    client.put("/coworker/claim", json={**CLAIM, "span_id": "call_2"})
    assert [C.claimed_for("How many orders?", "c1")["span_id"] for _ in range(2)] == ["call_1", "call_2"]


def test_a_claim_nobody_took_does_not_wait_forever(claims):
    client, clock = claims
    client.put("/coworker/claim", json=CLAIM)
    clock["t"] += C.CLAIM_FOR + 1
    assert C.claimed_for("How many orders?", "c1") is None


def test_a_claim_names_a_coworker_turn_and_comes_from_this_machine(claims):
    client, _ = claims
    assert client.put("/coworker/claim", json={**CLAIM, "trace_id": "1d5a621b"}).status_code == 422
    app = FastAPI()
    app.include_router(C.router)
    assert TestClient(app, client=("203.0.113.9", 50000)).put("/coworker/claim", json=CLAIM).status_code == 403
    assert C._claims == []
