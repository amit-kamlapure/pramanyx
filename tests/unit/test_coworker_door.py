"""Where the coworker is: said by the coworker, remembered for two minutes, and only for an address on this machine."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx import coworkers as K
from pramanyx.routers import coworker as C


@pytest.fixture()
def door(monkeypatch):
    clock = {"t": 1000.0}
    monkeypatch.setattr(C, "_now", lambda: clock["t"])
    monkeypatch.setattr(K, "_now", lambda: clock["t"])
    monkeypatch.setattr(K, "_announced", {})
    monkeypatch.delenv("PRAMANYX_REQUIRE_IDENTITY", raising=False)
    app = FastAPI()
    app.include_router(C.router)
    # The test client's caller is "testclient"; a coworker's is this machine.
    return TestClient(app, client=("127.0.0.1", 50000)), clock


def _door(client) -> dict:
    got = client.get("/coworker").json()
    return {"available": got["available"], "url": got["url"]}


def test_no_coworker_has_said_anything_so_none_is_offered(door):
    client, _ = door
    assert _door(client) == {"available": False, "url": None}


def test_a_coworker_says_where_it_is_and_the_app_is_told(door):
    client, _ = door
    said = client.put("/coworker/address", json={"url": "http://127.0.0.1:3090/?token=abc"})
    assert said.status_code == 200
    assert _door(client) == {"available": True, "url": "http://127.0.0.1:3090/?token=abc"}


def test_a_coworker_that_has_stopped_saying_so_is_not_offered(door):
    client, clock = door
    client.put("/coworker/address", json={"url": "http://localhost:3090/"})
    clock["t"] += C.FRESH_FOR
    assert client.get("/coworker").json()["available"] is True          # the last second it stands
    clock["t"] += 1
    assert _door(client) == {"available": False, "url": None}
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
    monkeypatch.setattr(K, "_announced", {})
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
         "row_count": 5, "payload": {"receipt_id": "r1"}},
    ]})
    assert r.status_code == 200 and r.json() == {"written": 2}
    assert [e["kind"] for e in seen] == ["user_request", "tool_call_result"]
    assert {e["trace_id"] for e in seen} == {TURN["trace_id"]}
    # The door a run came in by is read off the session id's prefix.
    assert {e["session"] for e in seen} == {"coworker:" + TURN["session"]}
    assert seen[1]["payload"]["receipt_id"] == "r1" and seen[1]["row_count"] == 5


def test_a_helpers_work_is_written_inside_the_call_that_started_it(taken):
    """2026-11-15 — one question, one trace, however many agents work on it: a helper's events carry the call that
    started the helper as their parent, and what the helper was is kept in the payload."""
    client, seen = taken
    r = client.post("/coworker/trace", json={**TURN, "events": [
        {"kind": "tool_call", "name": "mcp__pramanyx__ask", "span_id": "ask_h1", "parent_span_id": "spawn_1",
         "payload": {"tool": "mcp__pramanyx__ask"}},
        {"kind": "tool_call_result", "name": "subagent", "span_id": "spawn_1", "ok": True, "duration_ms": 4400,
         "payload": {"helper": "f6602a4c-e2ec-4ff3-98fb-dfe4d7516b02", "description": "GMV by platform FY2027", "secret": "x"}},
    ]})
    assert r.status_code == 200
    assert seen[0]["parent_span_id"] == "spawn_1" and seen[1]["parent_span_id"] is None
    assert seen[1]["payload"] == {"helper": "f6602a4c-e2ec-4ff3-98fb-dfe4d7516b02", "description": "GMV by platform FY2027"}


def test_a_turn_is_filed_under_the_person_the_coworker_acts_for(taken, monkeypatch):
    """Phase 3 (2026-11-17): the coworker sends its delegation with a turn, and the turn is written under that person,
    so the trace index's filter by person finds their coworker turns. None presented is nobody named; none is left
    bound after the call."""
    from pramanyx.org.context import current_user_id
    from pramanyx.security import delegation
    from pramanyx.security.authz import Principal
    client, seen = taken
    import pramanyx.obs.session_log as session_log
    monkeypatch.setattr(session_log, "emit", lambda kind, **kw: seen.append({"kind": kind, "user": current_user_id(), **kw}))
    monkeypatch.setattr(delegation, "resolve", lambda secret, audience=delegation.AUDIENCE:
                        Principal(user_id="user:ana", org_id="default") if secret == "d" * 30 else None)
    client.post("/coworker/trace", json={**TURN, "events": [{"kind": "final_response", "ok": True}]},
                headers={delegation.HEADER: "d" * 30})
    client.post("/coworker/trace", json={**TURN, "events": [{"kind": "final_response", "ok": True}]})
    assert [e["user"] for e in seen] == ["user:ana", ""]
    assert current_user_id() == ""


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


def test_a_model_call_is_recorded_inside_the_step_it_ran_in(monkeypatch):
    """The waterfall of a coworker turn drew the platform's SQL-writing call beside the `ask` it ran for. A model
    call, a guard and an outbound call now name the innermost open span as their parent; outside every span, none."""
    from pramanyx import telemetry
    from pramanyx.obs import session_log
    written = []
    monkeypatch.setattr(session_log, "enabled", lambda: True)
    monkeypatch.setattr("pramanyx.kernel.ledger.Ledger.session_event_insert", lambda self, row: written.append(row))
    with telemetry.bind_trace("cw-88f4fdd19a454d47-3"), telemetry.bind_parent_span("call_9"):
        session_log.emit(session_log.LLM_CALL, name="coder", model="m")
        session_log.emit(session_log.GUARDRAIL, name="pii")
        session_log.emit(session_log.TOOL_CALL, name="sql.execute", span_id="s1")      # a span names its own parent
    with telemetry.bind_trace("cw-88f4fdd19a454d47-3"):
        session_log.emit(session_log.LLM_CALL, name="coder", model="m")
    assert [r["parent_span_id"] for r in written] == ["call_9", "call_9", None, None]


def test_a_turn_that_ended_with_a_reply_is_filed_once_in_the_conversation_store(taken, monkeypatch):
    """One record for both places (2026-11-20): a coworker turn's question and the coworker's own reply are filed as a
    turn of the conversation `coworker:<session>`, on its connection, as the person it was for; the Ask panel's history
    lists it beside its own. Sent twice, it is filed once; a turn with no reply is not filed."""
    from pramanyx.db.history import chat_session_turn_ids, get_investigation
    from pramanyx.security import delegation
    from pramanyx.security.authz import Principal
    client, seen = taken
    monkeypatch.setattr(delegation, "resolve", lambda secret, audience=delegation.AUDIENCE:
                        Principal(user_id="ana", org_id="default") if secret == "d" * 30 else None)
    turn = {"trace_id": "cw-77aa11bb22cc-3", "session": "session-77aa11bb-22cc"}
    end = {"kind": "final_response", "ok": True, "conn_id": "sheets",
           "payload": {"question": "How many orders were delivered?", "answer": "96,478 orders were delivered.", "turn": 3}}
    for _ in range(2):
        assert client.post("/coworker/trace", json={**turn, "events": [end]}, headers={delegation.HEADER: "d" * 30}).status_code == 200
    # the trace keeps where things are, never what the agent said
    assert all("answer" not in e["payload"] for e in seen if e["kind"] == "final_response")
    assert chat_session_turn_ids("coworker:" + turn["session"]) == [turn["trace_id"]]
    row = get_investigation(turn["trace_id"])
    assert row["question"] == "How many orders were delivered?" and row["headline"] == "96,478 orders were delivered."
    assert row["connection_id"] == "sheets" and row.get("asked_by") == "ana"
    assert row.get("trace_id") == turn["trace_id"], "the conversation's turn names its run"
    silent = {"trace_id": "cw-77aa11bb22cc-4", "session": turn["session"]}
    client.post("/coworker/trace", json={**silent, "events": [{"kind": "final_response", "ok": True, "payload": {"question": "x"}}]})
    assert get_investigation(silent["trace_id"]) is None


def test_a_question_the_coworker_asked_is_filed_in_its_conversation_and_the_persons_question_is_held_once(taken, monkeypatch):
    """2026-11-20, seen live: the coworker's `ask` step was filed as a conversation of its own (a fresh id), so the panel's
    history listed the person's question twice. A step runs with the coworker's conversation in scope and is filed in
    it; when it asked the person's own question, its row takes the coworker's reply and keeps its query."""
    from pramanyx import telemetry
    from pramanyx.db.history import chat_session_turn_ids, get_investigation, save_chat_turn
    from pramanyx.org.context import reset_session_id, set_session_id
    client, _ = taken
    turn = {"trace_id": "cw-55dd66ee77ff-1", "session": "session-55dd66ee-77ff"}
    token = set_session_id("coworker:" + turn["session"])
    try:
        with telemetry.bind_trace(turn["trace_id"]):
            step = save_chat_turn("How many orders?", "sheets", "There are 99,441 orders.", "SELECT COUNT(*) FROM o")
    finally:
        reset_session_id(token)
    assert get_investigation(step)["session_id"] == "coworker:" + turn["session"]
    end = {"kind": "final_response", "ok": True, "conn_id": "sheets",
           "payload": {"question": "How many orders?", "answer": "The olist_orders sheet has **99,441** orders."}}
    assert client.post("/coworker/trace", json={**turn, "events": [end]}).status_code == 200
    assert chat_session_turn_ids("coworker:" + turn["session"]) == [step]
    row = get_investigation(step)
    import json
    assert row["headline"] == "The olist_orders sheet has **99,441** orders." and "COUNT(*)" in json.dumps(row)   # its query kept
    # a step that asked something else stays a step, and the reply is filed beside it
    other = {"trace_id": "cw-55dd66ee77ff-2", "session": turn["session"]}
    token = set_session_id("coworker:" + turn["session"])
    try:
        with telemetry.bind_trace(other["trace_id"]):
            save_chat_turn("Orders by status", "sheets", "Delivered leads.", "SELECT 1")
    finally:
        reset_session_id(token)
    client.post("/coworker/trace", json={**other, "events": [{**end, "payload": {"question": "What is the busiest status?", "answer": "Delivered."}}]})
    assert len(chat_session_turn_ids("coworker:" + turn["session"])) == 3
