"""An email from the coworker, and one Gmail card with a choice (the user, 2026-11-15).

The agent drafts; a person edits and presses Send; only that click sends, and what happened is said. Gmail is one card
whose choices — read, send, both — are each their own Google permission. Nothing here reaches Google."""
from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def door(monkeypatch):
    sent, journal = [], []
    monkeypatch.setattr("pramanyx.automations.email.send_email",
                        lambda to, subject, body, connection_id="": (sent.append((to, subject, body)) or True, f"sent to {to}"))

    class _L:
        def emit(self, kind, payload, **kw):
            journal.append((kind, payload))
    monkeypatch.setattr("pramanyx.kernel.ledger.Ledger.default", staticmethod(lambda: _L()))
    monkeypatch.setenv("PRAMANYX_LOCAL_USER", "ana@example.com")
    from pramanyx.routers import email
    app = FastAPI()
    app.include_router(email.router)
    return TestClient(app), sent, journal


def test_a_person_sends_and_is_told_and_it_is_journaled(door):
    client, sent, journal = door
    got = client.post("/email/send", json={"to": "ben@example.com", "subject": "GMV", "body": "Mytheresa leads."}).json()
    assert got == {"sent": True, "said": "sent to ben@example.com"}
    assert sent == [("ben@example.com", "GMV", "Mytheresa leads.")]
    assert [p for k, p in journal if k == "email.sent"] == [{"by": "user:ana@example.com", "to": "ben@example.com",
                                                             "subject": "GMV", "sent": True, "said": "sent to ben@example.com"}]


def test_an_agent_cannot_send(door):
    client, sent, _ = door
    r = client.post("/email/send", json={"to": "ben@example.com", "body": "x"}, headers={"X-Pramanyx-Agent": "mcp"})
    assert r.status_code == 403 and "draft" in r.json()["detail"] and sent == []


def test_the_coworker_only_drafts():
    from pramanyx.mcp.policy import TOOL_LEVELS
    from pramanyx.mcp.server import draft_email
    got = asyncio.run(draft_email(to=" ben@example.com ", subject="GMV", body="Mytheresa leads."))
    assert got["draft"] == {"to": "ben@example.com", "subject": "GMV", "body": "Mytheresa leads."}
    assert "Nothing has been sent" in got["note"] and TOOL_LEVELS["draft_email"] == "read"


def test_gmail_is_one_card_whose_choices_ask_only_for_their_own_permission(monkeypatch):
    from pramanyx.integrations.providers import get_provider
    gmail = get_provider("google").product("gmail")
    assert [o.id for o in gmail.options] == ["read", "send", "both"]
    assert get_provider("google").product("gmail_send") is None
    assert gmail.option("send").scopes.endswith("gmail.send") and "readonly" not in gmail.option("send").scopes
    from pramanyx.routers import integrations as R
    asked = {}
    monkeypatch.setattr(R.broker, "begin", lambda provider, user_id="", redirect_uri="", scopes="": asked.update(scopes=scopes) or "https://accounts.example/consent")
    monkeypatch.setattr(R.store, "get_app", lambda pid: None)
    app = FastAPI()
    app.include_router(R.router)
    client = TestClient(app)
    assert client.post("/integrations/google/connect", params={"product": "gmail", "option": "send"}).status_code == 200
    assert asked["scopes"].split()[-1].endswith("gmail.send") and "gmail.readonly" not in asked["scopes"]
    assert client.post("/integrations/google/connect", params={"product": "gmail", "option": "nope"}).status_code == 404
