"""Group conversations (2026-11-17; the user: "there cannot be shared conversations unless users add other users in it").

Receipts, with sign-in: a thread is its first asker's; nobody else lists it, reads it or asks in it — they are told it
is not found — until its owner adds them; then they see it, ask in it as themselves, and each question says who asked.
Only the owner renames it, deletes it or chooses who is in it (never an agent); a member may leave. A person must be
one of the organisation's people when it has a directory. Without sign-in the one person sees every thread, as before.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from pramanyx.db import history as H
from pramanyx.routers import investigations as I


@pytest.fixture()
def people(monkeypatch):
    who = {"now": "ana@acme.test"}
    monkeypatch.setattr(H, "person_now", lambda: who["now"])
    monkeypatch.setattr(I, "_single_person", lambda: False)
    return who


def _thread(asker_now: dict, question: str = "How many orders yesterday?") -> str:
    sid = "s-" + uuid.uuid4().hex[:10]
    I._thread_door(sid)                                   # the first question claims it
    H.save_chat_turn(question, "c1", "42 orders.", "SELECT 42", session_id=sid)
    return sid


def test_a_thread_is_its_first_askers_and_hidden_from_everyone_else(people):
    sid = _thread(people)
    assert H.thread_people(sid)["owner"] == "ana@acme.test"
    assert H.thread_people(sid)["askers"] == ["ana@acme.test"]
    assert sid in [t["session_id"] for t in H.list_chat_sessions(person="ana@acme.test", single_person=False)]
    people["now"] = "bo@acme.test"
    assert sid not in [t["session_id"] for t in H.list_chat_sessions(person="bo@acme.test", single_person=False)]
    for door in (lambda: I._thread_door(sid), lambda: I.get_chat_session_messages(sid),
                 lambda: I.get_chat_session_turns(sid), lambda: I.thread_people_route(sid)):
        with pytest.raises(HTTPException) as refused:
            door()
        assert refused.value.status_code == 404


def test_once_added_a_person_sees_it_asks_as_themselves_and_each_question_says_who(people, monkeypatch):
    import pramanyx.rbac.directory as D
    monkeypatch.setattr(D, "people", lambda org, include_inactive=False: [D.Person(email="ana@acme.test"),
                                                                          D.Person(email="bo@acme.test")])
    sid = _thread(people)
    I.set_thread_members_route(sid, I.ThreadMembersRequest(members=["Bo@Acme.test"]), _Request())
    people["now"] = "bo@acme.test"
    listed = {t["session_id"]: t for t in H.list_chat_sessions(person="bo@acme.test", single_person=False)}
    assert listed[sid]["shared"] is True and listed[sid]["owner"] == "ana@acme.test"
    I._thread_door(sid)                                    # Bo may ask in it now
    H.save_chat_turn("And the day before?", "c1", "40 orders.", "SELECT 40", session_id=sid)
    asked = [m["metadata"]["asked_by"] for m in I.get_chat_session_messages(sid) if m["role"] == "user"]
    assert asked == ["ana@acme.test", "bo@acme.test"]

    # A member cannot rename, delete or choose who is in it; they may leave.
    for door in (lambda: I.rename_chat_session_route(sid, I.RenameChatSessionRequest(title="Mine now")),
                 lambda: I.delete_chat_session_route(sid),
                 lambda: I.set_thread_members_route(sid, I.ThreadMembersRequest(members=[]), _Request())):
        with pytest.raises(HTTPException) as refused:
            door()
        assert refused.value.status_code == 403 and "ana@acme.test" in refused.value.detail
    I.leave_thread_route(sid)
    with pytest.raises(HTTPException):
        I.get_chat_session_messages(sid)


def test_only_the_organisations_people_and_never_an_agent(people, monkeypatch):
    import pramanyx.rbac.directory as D
    monkeypatch.setattr(D, "people", lambda org, include_inactive=False: [D.Person(email="bo@acme.test")])
    sid = _thread(people)
    with pytest.raises(HTTPException) as refused:
        I.set_thread_members_route(sid, I.ThreadMembersRequest(members=["eve@elsewhere.test"]), _Request())
    assert refused.value.status_code == 422 and "organisation's people" in refused.value.detail
    with pytest.raises(HTTPException):
        I.set_thread_members_route(sid, I.ThreadMembersRequest(members=["not an email"]), _Request())
    import pramanyx.rbac.agent_gate as gate
    monkeypatch.setattr(gate, "is_agent_request", lambda request: True)
    with pytest.raises(HTTPException) as agent:
        I.set_thread_members_route(sid, I.ThreadMembersRequest(members=["bo@acme.test"]), _Request())
    assert agent.value.status_code == 403
    assert H.thread_people(sid)["members"] == []


def test_without_sign_in_the_one_person_sees_every_thread(people, monkeypatch):
    sid = _thread(people)
    monkeypatch.setattr(I, "_single_person", lambda: True)
    people["now"] = "someone-else"
    assert I.get_chat_session_messages(sid)
    assert sid in [t["session_id"] for t in H.list_chat_sessions(person="someone-else", single_person=True)]


def test_clearing_a_title_keeps_who_is_in_the_conversation(people, monkeypatch):
    import pramanyx.rbac.directory as D
    monkeypatch.setattr(D, "people", lambda org, include_inactive=False: [])
    sid = _thread(people)
    I.set_thread_members_route(sid, I.ThreadMembersRequest(members=["bo@acme.test"]), _Request())
    I.rename_chat_session_route(sid, I.RenameChatSessionRequest(title="Orders"))
    I.rename_chat_session_route(sid, I.RenameChatSessionRequest(title=""))
    assert H.thread_people(sid)["members"] == ["bo@acme.test"] and H.thread_people(sid)["owner"] == "ana@acme.test"
    [row] = [t for t in H.list_chat_sessions(person="ana@acme.test", single_person=False) if t["session_id"] == sid]
    assert row["renamed"] is False and row["title"] == "How many orders yesterday?"


class _Request:
    """A person's request, as the agent check reads one."""
    def __init__(self):
        from types import SimpleNamespace
        self.headers: dict = {}
        self.state = SimpleNamespace()


def test_a_persons_own_questions_are_listed_as_theirs(people):
    """The coworker's "Asked lately" reads `/investigations?mine=1`: with a coworker per person, it lists theirs."""
    _thread(people, "Ana's question")
    people["now"] = "bo@acme.test"
    I._thread_door("s-" + uuid.uuid4().hex[:10])
    H.save_chat_turn("Bo's question", "c1", "7.", "SELECT 7", session_id="s-bo-" + uuid.uuid4().hex[:6])
    mine = [r["question"] for r in I.get_investigations(limit=50, mine=True)]
    assert "Bo's question" in mine and "Ana's question" not in mine
