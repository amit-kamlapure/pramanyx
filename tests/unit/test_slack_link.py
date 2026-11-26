"""A person links their own Slack account (2026-11-26, the user: "From Slack, confirmed in app"), and a post addressed
to `@me` reaches them there.

Held here: the code is sent to the Slack account and never returned to whoever asked; it works once, for fifteen
minutes, and only its hash is kept; a newer code retires an older one; wrong guesses are capped; the person entering it
is the one linked; only the bot runtime may ask for a code; a person sees and unlinks only their own accounts; `@me`
resolves at send time to the saver's linked account, and is said — never sent elsewhere — when it cannot; and a drafted
chain keeps `@me` only when the request asks for the person's own Slack messages."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx.identity import link_codes as C
from pramanyx.identity import store as S
from pramanyx.org.context import reset_user_id, set_user_id


@pytest.fixture()
def as_person():
    tokens = []

    def be(who: str) -> None:
        tokens.append(set_user_id(who))
    yield be
    for t in reversed(tokens):
        reset_user_id(t)


def test_a_code_links_the_account_it_was_sent_to_once_and_only_its_hash_is_kept():
    code = C.start("slack", "U100", display="Amit")
    assert len(code) == 8 and set(code) <= set(C._ALPHABET)
    assert C.shown(code) == f"{code[:4]}-{code[4:]}"
    rows = sqlite3.connect(S._DB_PATH).execute("SELECT * FROM identity_link_codes").fetchall()
    assert rows and not any(code in str(r) for r in rows)
    linked = C.redeem(f"  {C.shown(code).lower()} ", "ana")              # case, spaces and the dash do not matter
    assert (linked.provider, linked.external_id, linked.display) == ("slack", "U100", "Amit")
    assert S.get_link("slack", "U100") == "ana"
    with pytest.raises(C.LinkRefused, match="already used"):
        C.redeem(code, "bo")
    assert S.get_link("slack", "U100") == "ana"


def test_a_code_expires_and_a_newer_code_retires_the_older():
    now = datetime(2026, 11, 26, 9, 0, tzinfo=timezone.utc)
    old = C.start("slack", "U200", now=now)
    with pytest.raises(C.LinkRefused, match="expired"):
        C.redeem(old, "ana", now=now + timedelta(minutes=C.CODE_MINUTES + 1))
    first = C.start("slack", "U200", now=now)
    second = C.start("slack", "U200", now=now + timedelta(minutes=1))
    with pytest.raises(C.LinkRefused, match="newer one was sent"):
        C.redeem(first, "ana", now=now + timedelta(minutes=2))
    assert C.redeem(second, "ana", now=now + timedelta(minutes=2)).external_id == "U200"


def test_wrong_codes_are_capped_and_nobody_is_linked_without_a_person():
    now = datetime(2026, 11, 26, 10, 0, tzinfo=timezone.utc)
    good = C.start("slack", "U300", now=now)
    for _ in range(C.MAX_TRIES):
        with pytest.raises(C.LinkRefused, match="not right"):
            C.redeem("ZZZZ-ZZZZ", "eve", now=now)
    with pytest.raises(C.LinkRefused, match="Too many wrong codes"):
        C.redeem(good, "eve", now=now)                                  # even the right one, until the window passes
    assert S.get_link("slack", "U300") is None
    with pytest.raises(C.LinkRefused, match="Sign in first"):
        C.redeem(good, "", now=now)


def test_one_persons_wrong_guesses_do_not_stop_another():
    now = datetime(2026, 11, 26, 11, 0, tzinfo=timezone.utc)
    good = C.start("slack", "U400", now=now)
    for _ in range(C.MAX_TRIES):
        with pytest.raises(C.LinkRefused):
            C.redeem("ZZZZ-ZZZZ", "mallory", now=now)
    assert C.redeem(good, "ivy", now=now).external_id == "U400"


def _app():
    from pramanyx.routers import slackbots as R
    app = FastAPI()
    app.include_router(R.router)
    return TestClient(app), R


def test_only_the_bot_runtime_may_ask_for_a_code_and_the_code_is_sent_never_returned(monkeypatch):
    http, R = _app()
    from pramanyx.slackbots import post as P
    sent = []
    monkeypatch.setattr(R.store, "get_bot_decrypted", lambda b: SimpleNamespace(bot_token="xoxb-t", enabled=True, name="Bot"))
    monkeypatch.setattr(P, "post_as_bot", lambda token, channel, text, **k: sent.append((token, channel, text)) or (True, {"ts": "1"}))
    shut = http.post("/slack-bots/b1/link-code", json={"slack_user_id": "U500"})
    assert shut.status_code == 503 and "only the Slack bot may ask for a code" in shut.json()["detail"]
    assert sent == []
    monkeypatch.setattr(R, "_refuse_without_a_front_door", lambda request: None)   # the runtime's key, presented
    got = http.post("/slack-bots/b1/link-code", json={"slack_user_id": "U500", "display": "Amit"})
    assert got.status_code == 200 and got.json()["sent"] is True
    (token, channel, text), = sent
    assert (token, channel) == ("xoxb-t", "U500")                     # to the account itself: its DM with the bot
    code = text.split("*")[1]
    assert code not in got.text and C.normalise(code) not in got.text   # never in the response
    assert C.LINK_PLACE in text and "Slack bots ▸ Your Slack account" in C.LINK_PLACE
    assert http.post("/slack-bots/b1/link-code", json={"slack_user_id": "#general"}).status_code == 422


def test_a_person_links_sees_and_unlinks_only_their_own(as_person):
    http, _ = _app()
    as_person("ana@example.com")
    assert http.get("/me/slack").json()["linked"] == []
    code = C.start("slack", "U600", display="Ana")
    assert http.post("/me/slack", json={"code": "WRONG-123"}).status_code == 422
    made = http.post("/me/slack", json={"code": code})
    assert made.status_code == 200 and made.json()["linked"] == {"external_id": "U600", "display": "Ana"}
    assert [r["external_id"] for r in http.get("/me/slack").json()["linked"]] == ["U600"]
    as_person("bo@example.com")
    assert http.get("/me/slack").json()["linked"] == []
    assert http.delete("/me/slack/U600").status_code == 404           # someone else's does not exist to them
    as_person("ana@example.com")
    assert http.delete("/me/slack/U600").status_code == 204
    assert S.get_link("slack", "U600") is None


# ── @me at send time ────────────────────────────────────────────────────────────────────────────────────────────

def _post_to_me(monkeypatch, declared_by: str):
    from pramanyx.automations import engine as E
    from pramanyx.automations.models import Automation, Condition, Effect
    from pramanyx.slackbots import post as P
    from pramanyx.slackbots import store as B
    sent = []
    monkeypatch.setattr(B, "get_bot_decrypted", lambda b: SimpleNamespace(bot_token="xoxb-t", enabled=True, name="Bot"))
    monkeypatch.setattr(B, "get_bot", lambda b: SimpleNamespace(rehearse=False))
    monkeypatch.setattr(P, "post_as_bot", lambda token, channel, text, **k: sent.append(channel) or (True, {"ts": "1", "channel": "D1"}))
    monkeypatch.setattr(E, "_gate_departure", lambda *a, **k: None)
    monkeypatch.setattr(E, "_attach_chart", lambda *a, **k: None)
    monkeypatch.setattr(E, "_file_departure_link", lambda *a, **k: "")
    auto = Automation(id="a1", name="Daily revenue", conn_id="c1", declared_by=declared_by,
                      conditions=[Condition(kind="schedule", config={"cron": "0 9 * * *"})],
                      effects=[Effect(kind="slack_post", config={"bot_id": "b1", "channel": "@me", "message": "Revenue rose."})])
    return E._dispatch_slack_post(auto.effects[0], auto), sent


def test_at_me_goes_to_the_savers_linked_account(monkeypatch):
    S.put_link("slack", "U700", "kim@example.com")
    outcome, sent = _post_to_me(monkeypatch, "user:kim@example.com")
    assert outcome.status == "executed" and sent == ["U700"]
    assert outcome.target == "b1:U700"                                 # the gate and the record see the person's address


def test_at_me_with_no_or_two_links_is_said_and_sent_nowhere(monkeypatch):
    outcome, sent = _post_to_me(monkeypatch, "user:lee@example.com")
    assert outcome.status == "dispatch_error" and sent == []
    assert "no Slack account is linked to user:lee@example.com, who saved it" in outcome.message
    assert "write “link” to the Pramanyx bot" in outcome.message
    S.put_link("slack", "U801", "max@example.com")
    S.put_link("slack", "U802", "max@example.com")
    outcome, sent = _post_to_me(monkeypatch, "user:max@example.com")
    assert outcome.status == "dispatch_error" and sent == [] and "U801, U802" in outcome.message
    outcome, sent = _post_to_me(monkeypatch, "agent:watcher")
    assert outcome.status == "dispatch_error" and sent == [] and "saved by agent:watcher" in outcome.message


# ── a drafted chain keeps @me only when the request asks for it ─────────────────────────────────────────────────

@pytest.mark.parametrize("request_words,kept", [
    ("every Monday at 9, DM me the revenue", True),
    ("send it to me on Slack every morning", True),
    ("post revenue to my DMs daily", True),
    ("every Monday at 9, send me the revenue", False),
    ("every Monday at 9, post revenue to Slack", False),
])
def test_a_drafted_at_me_stays_only_when_the_request_asks_for_the_persons_own_slack(monkeypatch, request_words, kept):
    from pramanyx.automations import propose as PR
    monkeypatch.setattr(PR, "_enabled_bots", lambda: [("b1", "Pramanyx")])
    monkeypatch.setattr(PR, "_has_a_slack_link", lambda: True)
    drafted = SimpleNamespace(effects=[SimpleNamespace(kind="slack_post", config={"bot_id": "b1", "channel": "@me"})])
    opened = PR._open_unnamed_choices(drafted, request_words)
    assert (drafted.effects[0].config["channel"] == "@me") is kept
    assert bool(opened) is (not kept)


def test_a_drafted_at_me_for_someone_with_no_linked_slack_is_an_open_choice_that_says_how_to_link(as_person):
    from pramanyx.automations import propose as PR
    as_person("noa@example.com")
    drafted = SimpleNamespace(effects=[SimpleNamespace(kind="slack_post", config={"bot_id": "b1", "channel": "@me"})])
    opened = PR._open_unnamed_choices(drafted, "every Monday at 9, DM me the revenue")
    assert drafted.effects[0].config["channel"] == ""
    assert any("no Slack account is linked to you yet" in why and C.LINK_PLACE in why for _, key, why in opened)
    S.put_link("slack", "U900", "noa@example.com")
    drafted = SimpleNamespace(effects=[SimpleNamespace(kind="slack_post", config={"bot_id": "b1", "channel": "@me"})])
    PR._open_unnamed_choices(drafted, "every Monday at 9, DM me the revenue")
    assert drafted.effects[0].config["channel"] == "@me"
