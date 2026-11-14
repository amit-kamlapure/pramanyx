"""People, step one: every verdict names the person whose word it is (2026-11-15).

Measured that morning on the live install: 11 verdicts, not one naming a person; the Record's approvals read the
literal "a person", because the confirmation loop asked the sign-in contextvar, which is empty with sign-in off; and
`/ask`'s body could name the request's person. Each is closed at the cause here.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import pramanyx.feedback.verdicts as vd
from pramanyx.org.context import current_user_id


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(vd, "_DB_PATH", tmp_path / "verdicts.db")
    monkeypatch.setenv("PRAMANYX_LOCAL_USER", "operator@example.com")
    return vd


def test_a_verdict_is_stored_under_one_spelling_of_its_person(store):
    assert store.record_verdict("c", "i1", "accept", by="user:ana@example.com")["judged_by"] == "user:ana@example.com"
    assert store.record_verdict("c", "i2", "reject", by="ben@example.com")["judged_by"] == "user:ben@example.com"
    assert [r["judged_by"] for r in store.list_verdicts("c")] == ["user:ben@example.com", "user:ana@example.com"]


def test_an_unsaid_person_is_the_one_the_request_acts_for_never_blank(store):
    assert store.record_verdict("c", "i1", "accept")["judged_by"] == "user:operator@example.com"


@pytest.mark.parametrize("who", ["agent:coworker", "service:nightly", "system"])
def test_an_agent_or_a_service_cannot_give_a_persons_verdict(store, who):
    with pytest.raises(ValueError, match="not a person"):
        store.record_verdict("c", "i1", "accept", by=who)
    assert store.list_verdicts("c") == []


def test_the_record_is_approved_by_the_verdicts_person_not_a_placeholder(store, monkeypatch):
    seen = {}
    monkeypatch.setattr("pramanyx.record.writers.approve_answer_claims",
                        lambda **kw: seen.update(kw) or [])
    store.record_verdict("conn1", "inv1", "accept", by="user:ana@example.com")
    assert seen["by"] == "user:ana@example.com"


def test_the_verdict_door_takes_the_person_from_the_request_never_the_body(store):
    from pramanyx.routers import verify
    from pramanyx.security.authz import Principal
    app = FastAPI()
    app.include_router(verify.router)

    @app.middleware("http")
    async def signed_in(request, call_next):              # what `_require_auth` binds for a signed-in person
        request.state.principal = Principal(user_id="ana@example.com", org_id="default")
        return await call_next(request)
    got = TestClient(app).post("/verify/verdict", json={"connection_id": "c", "investigation_id": "i1",
                                                        "verdict": "accept", "by": "user:ceo@example.com",
                                                        "judged_by": "user:ceo@example.com"}).json()
    assert got["judged_by"] == "user:ana@example.com"


# ── /ask: a body names a label, never a person ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("ref,label", [
    ("api:mcp:amit", "api:mcp:amit"),                     # a door's own prefix stays as written
    ("teams:Ana", "teams:Ana"),
    ("ana@example.com", "said:ana@example.com"),          # a bare name is marked as said
    ("user:ceo", "said:user:ceo"),
])
def test_a_body_asker_is_kept_as_a_label(ref, label):
    from pramanyx.routers.investigations import said_asker
    assert said_asker(ref) == label


def test_a_linked_slack_id_in_a_body_does_not_become_the_linked_person(monkeypatch):
    import asyncio

    from pramanyx.routers.investigations import _stream_with_session
    monkeypatch.setattr("pramanyx.identity.resolver.resolve",
                        lambda raw: (_ for _ in ()).throw(AssertionError("a body must not be resolved to a person")))

    async def stream():
        yield current_user_id()

    async def run():
        return [e async for e in _stream_with_session("", stream(), "slack:U1")]
    assert asyncio.run(run()) == ["slack:U1"]
