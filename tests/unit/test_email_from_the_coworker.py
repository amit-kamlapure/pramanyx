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
                        lambda to, subject, body, connection_id="", attachment=None:
                        (sent.append((to, subject, body)) or True, f"sent to {to}"))

    class _L:
        def emit(self, kind, payload, **kw):
            journal.append((kind, payload))

        def events(self, *, kind=None, limit=200, org_id=None, **kw):       # newest first, as the journal reads
            rows = [{"seq": i, "at": f"2026-11-15T15:{40 + i}:00+00:00", "kind": k, "payload": p}
                    for i, (k, p) in enumerate(journal) if kind in (None, k)]
            return rows[::-1][:limit]
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
                                                             "subject": "GMV", "sent": True, "said": "sent to ben@example.com",
                                                             "attached": "", "draft": ""}]


def test_an_agent_cannot_send(door):
    client, sent, _ = door
    r = client.post("/email/send", json={"to": "ben@example.com", "body": "x"}, headers={"X-Pramanyx-Agent": "mcp"})
    assert r.status_code == 403 and "draft" in r.json()["detail"] and sent == []


def test_the_coworker_only_drafts():
    from pramanyx.mcp.policy import TOOL_LEVELS
    from pramanyx.mcp.server import draft_email
    got = asyncio.run(draft_email(to=" ben@example.com ", subject="GMV", body="Mytheresa leads."))
    draft = dict(got["draft"])
    name = draft.pop("id")                      # the draft's own name: what its send is journaled under
    assert len(name) == 16 and int(name, 16) >= 0
    assert draft == {"to": "ben@example.com", "subject": "GMV", "body": "Mytheresa leads."}
    assert asyncio.run(draft_email(body="Another."))["draft"]["id"] != name
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


def test_a_withheld_choice_names_its_card():
    from pramanyx.integrations.providers import get_provider
    google = get_provider("google")
    assert [p.id for p in google.products_needing("https://www.googleapis.com/auth/gmail.send")] == ["gmail"]


def test_googles_account_is_read_from_the_id_token_it_returns():
    import base64
    import json as _json

    from pramanyx.integrations.broker import _account_label
    from pramanyx.integrations.providers import get_provider
    claims = base64.urlsafe_b64encode(_json.dumps({"email": "ana@example.com"}).encode()).decode().rstrip("=")
    assert _account_label(get_provider("google"), {"id_token": f"h.{claims}.s"}) == "ana@example.com"
    assert _account_label(get_provider("google"), {"id_token": "not-a-jwt"}) == ""


def test_only_the_grants_own_person_reads_its_account(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from pramanyx.routers import integrations as R

    class _Conn:
        user_id = "ana@example.com"
    monkeypatch.setattr(R.store, "get_connection", lambda cid: _Conn() if cid == "ic1" else None)
    monkeypatch.setattr(R.broker, "account_of", lambda cid: "ana@example.com")
    app = FastAPI()
    app.include_router(R.router)
    client = TestClient(app)
    monkeypatch.setattr(R, "_user", lambda: "ana@example.com")
    assert client.post("/integrations/connections/ic1/account").json() == {"account": "ana@example.com"}
    monkeypatch.setattr(R, "_user", lambda: "eve@example.com")
    assert client.post("/integrations/connections/ic1/account").status_code == 404


# ── the analysis attached (2026-11-15: "emails … should have an option to have an attachment of the analysis") ───

def _chat_inv():
    return {"id": "c1", "kind": "chat", "question": "Top categories?", "connection_id": "demo",
            "completed_at": "2026-11-15T00:00:00",
            "report": {"headline": "Fragrance leads revenue", "sql": "SELECT category, revenue FROM s",
                       "columns": ["category", "revenue"], "rows": [["Fragrance", 503000], ["Skincare", 368000]],
                       "chart_type": "bar"}}


def test_the_analysis_is_built_as_its_export_button_builds_it(monkeypatch):
    from pramanyx.automations.email import answer_attachment
    monkeypatch.setattr("pramanyx.db.history.get_investigation", lambda i: _chat_inv() if i == "c1" else None)
    monkeypatch.setattr("pramanyx.routers.investigations.resolve_currency_symbol", lambda *a, **k: "")
    (data, filename, media), why = answer_attachment("c1", "xlsx")
    assert data[:2] == b"PK" and filename.endswith(".xlsx") and "spreadsheetml" in media and why == ""
    assert answer_attachment("c1", "exe") == (None, "an analysis is attached as PDF, Excel, Word or PowerPoint, not exe")
    assert answer_attachment("nope", "pdf")[1] == "the analysis to attach was not found"


def test_the_file_rides_in_the_message(monkeypatch):
    import base64
    from email import message_from_bytes

    from pramanyx.automations import email as E
    sent = []
    monkeypatch.setattr("pramanyx.integrations.store.list_connections",
                        lambda user_id="": [type("C", (), {"id": "ic1", "provider": "google", "scopes": E.SEND_SCOPE})()])
    monkeypatch.setattr("pramanyx.integrations.broker.fresh_access_token", lambda cid: "token")

    class _R:
        status_code = 200
    monkeypatch.setattr(E.httpx, "post", lambda url, json=None, headers=None, timeout=None: sent.append(json) or _R())
    ok, said = E.send_email("ben@example.com", "GMV", "Summary.", attachment=(b"%PDF-1.4 x", "gmv.pdf", "application/pdf"))
    assert ok and said == "sent to ben@example.com, with gmv.pdf attached"
    mail = message_from_bytes(base64.urlsafe_b64decode(sent[0]["raw"]))
    parts = [p for p in mail.walk() if p.get_filename()]
    assert [(p.get_filename(), p.get_content_type(), p.get_payload(decode=True)) for p in parts] == [
        ("gmv.pdf", "application/pdf", b"%PDF-1.4 x")]


def test_an_email_asked_to_carry_the_analysis_never_goes_without_it(door, monkeypatch):
    client, sent, journal = door
    monkeypatch.setattr("pramanyx.automations.email.answer_attachment", lambda i, f: (None, "the analysis to attach was not found"))
    got = client.post("/email/send", json={"to": "ben@example.com", "body": "x", "attach_answer": "c1", "attach_format": "pdf"}).json()
    assert got == {"sent": False, "said": "the analysis to attach was not found"} and sent == []


def test_the_draft_names_the_analysis_only_when_asked():
    from pramanyx.mcp.server import draft_email
    got = asyncio.run(draft_email(to="ben@example.com", body="Summary.", attach_answer="c1", attach_format="PDF"))
    assert got["draft"]["attach_answer"] == "c1" and got["draft"]["attach_format"] == "pdf"
    assert "attach_answer" not in asyncio.run(draft_email(body="Summary."))["draft"]
    assert "attach_answer" not in asyncio.run(draft_email(body="x", attach_answer="c1", attach_format="exe"))["draft"]


def test_a_scheduled_email_step_attaches_its_chains_analysis(monkeypatch):
    from pramanyx.automations import engine
    from pramanyx.automations.models import Automation
    monkeypatch.setattr(engine, "_gate_departure", lambda *a, **k: None)
    monkeypatch.setattr("pramanyx.automations.email.answer_attachment",
                        lambda i, f: ((b"x", f"{i}.{f}", "application/pdf"), "") if i == "inv1" else (None, "missing"))
    seen = {}
    monkeypatch.setattr("pramanyx.automations.email.send_email",
                        lambda to, s, b, connection_id="", attachment=None: (seen.update(att=attachment) or True, "sent"))
    auto = Automation(conn_id="c", name="GMV", conditions=[{"kind": "schedule", "config": {"cron": "0 9 * * *"}}],
                      effects=[{"kind": "email", "config": {"to": "ana@example.com", "message": "GMV is 5",
                                                            "attach_format": "pdf", "attach_investigation": "inv1"}}])
    assert engine._dispatch_email(auto.effects[0], auto).status == "executed" and seen["att"][1] == "inv1.pdf"
    auto.effects[0].config["attach_investigation"] = "gone"
    out = engine._dispatch_email(auto.effects[0], auto)
    assert out.status == "dispatch_error" and out.message == "not sent: missing"



# ── a sent draft says so whenever it is opened (found live, 2026-11-15: sent minutes ago, shown as open) ─────────

def test_a_send_is_journaled_under_its_drafts_name_and_read_back(door):
    client, sent, journal = door
    client.post("/email/send", json={"to": "ben@example.com", "subject": "GMV", "body": "x", "draft": "d-abc123"})
    assert [p["draft"] for k, p in journal if k == "email.sent"] == ["d-abc123"]
    got = client.get("/email/sent", params={"draft": "d-abc123"}).json()["sends"]
    assert [(s["to"], s["subject"], s["attached"]) for s in got] == [("ben@example.com", "GMV", "")] and got[0]["at"]
    assert client.get("/email/sent", params={"draft": "d-other"}).json() == {"sends": []}
    assert client.get("/email/sent").json() == {"sends": []}


def test_a_refused_send_is_not_a_send_and_another_persons_is_theirs(door, monkeypatch):
    client, sent, journal = door
    client.post("/email/send", json={"to": "ben@example.com", "body": "x", "draft": "d-1"})
    monkeypatch.setattr("pramanyx.automations.email.send_email", lambda *a, **k: (False, "Gmail refused the email (403)"))
    client.post("/email/send", json={"to": "cy@example.com", "body": "x", "draft": "d-2"})
    assert client.get("/email/sent", params={"draft": "d-2"}).json() == {"sends": []}
    assert len(client.get("/email/sent", params={"draft": "d-1"}).json()["sends"]) == 1
    monkeypatch.setenv("PRAMANYX_LOCAL_USER", "eve@example.com")
    assert client.get("/email/sent", params={"draft": "d-1"}).json() == {"sends": []}


def test_a_send_from_before_drafts_were_named_is_found_by_its_subject_and_only_then(door):
    client, sent, journal = door
    journal.append(("email.sent", {"by": "user:ana@example.com", "to": "ben@example.com", "subject": "GMV",
                                   "sent": True, "said": "sent", "attached": ""}))     # as journaled before the name
    client.post("/email/send", json={"to": "cy@example.com", "subject": "GMV", "body": "x", "draft": "d-new"})
    unnamed = client.get("/email/sent", params={"draft": "h-zzz", "subject": "GMV"}).json()["sends"]
    assert [s["to"] for s in unnamed] == ["ben@example.com"]              # never the named draft's send
    assert [s["to"] for s in client.get("/email/sent", params={"draft": "d-new"}).json()["sends"]] == ["cy@example.com"]


def test_a_drafts_name_is_a_name_and_nothing_else(door):
    client, sent, _ = door
    refused = client.post("/email/send", json={"to": "ben@example.com", "body": "x", "draft": "../../etc passwd"})
    assert refused.status_code == 422 and sent == []
