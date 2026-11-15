"""An automation's answer sent as email (2026-11-15). Nothing here reaches Google: the send is stubbed at httpx."""
from __future__ import annotations

import base64
from email import message_from_bytes

import pytest

from pramanyx.automations import email as E
from pramanyx.automations.models import Automation, Effect


class _Conn:
    def __init__(self, scopes):
        self.id, self.provider, self.scopes = "ic1", "google", scopes


@pytest.fixture
def google(monkeypatch):
    state = {"scopes": E.SEND_SCOPE + " openid", "sent": []}
    monkeypatch.setattr("pramanyx.integrations.store.list_connections", lambda user_id="": [_Conn(state["scopes"])])
    monkeypatch.setattr("pramanyx.integrations.broker.fresh_access_token", lambda cid: "token")

    class _R:
        status_code = 200

        def json(self):
            return {"id": "m1"}

    def post(url, json=None, headers=None, timeout=None):
        state["sent"].append((url, json, headers))
        return _R()
    monkeypatch.setattr(E.httpx, "post", post)
    return state


def test_a_step_must_name_its_recipient():
    with pytest.raises(ValueError, match="to"):
        Effect(kind="email", config={})
    Effect(kind="email", config={"to": "ana@example.com"})


def test_the_answer_is_sent_to_the_named_address_as_the_connected_account(google):
    ok, said = E.send_email("ana@example.com", "GMV by platform", "Mytheresa leads with €1,205,163.43.")
    assert ok and said == "sent to ana@example.com"
    url, body, headers = google["sent"][0]
    assert url.endswith("/users/me/messages/send") and headers["Authorization"] == "Bearer token"
    mail = message_from_bytes(base64.urlsafe_b64decode(body["raw"]))
    assert mail["To"] == "ana@example.com" and mail["Subject"] == "GMV by platform"
    assert "Mytheresa leads" in mail.get_payload(decode=True).decode()


def test_without_the_sending_permission_it_says_what_to_connect_and_sends_nothing(google):
    google["scopes"] = "https://www.googleapis.com/auth/gmail.readonly"
    ok, said = E.send_email("ana@example.com", "s", "b")
    assert not ok and "choose Send" in said and google["sent"] == []


@pytest.mark.parametrize("to", ["", "not-an-address", "a@b.com, c@d.com"])
def test_only_one_real_address_is_sent_to(google, to):
    assert E.send_email(to, "s", "b")[0] is False and google["sent"] == []


def test_the_engine_gates_the_email_like_a_slack_post(monkeypatch, google):
    from pramanyx.automations import engine

    class _Held:
        held = True

        def reason_sentence(self):
            return "a figure no analysis measured"
    monkeypatch.setattr(engine, "_gate_departure", lambda *a, **k: _Held())
    auto = Automation(conn_id="c", name="GMV", conditions=[{"kind": "schedule", "config": {"cron": "0 9 * * *"}}],
                      effects=[{"kind": "email", "config": {"to": "ana@example.com", "message": "GMV is 5"}}])
    out = engine._dispatch_email(auto.effects[0], auto)
    assert out.status == "held" and google["sent"] == []
    assert "email" in engine.DEPARTURE_SENDS and "email" in engine.OUTWARD_EFFECT_KINDS


def test_a_refused_slack_post_says_what_to_do():
    from pramanyx.slackbots.post import refusal_said
    said = refusal_said("channel_not_found", "#general")
    assert "cannot see #general" in said and "/invite" in said and said.endswith("(Slack: channel_not_found)")
    assert refusal_said("some_new_error") == "some_new_error"
