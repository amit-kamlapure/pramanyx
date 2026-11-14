"""Slack as knowledge, readable by each channel's members only (the user's call, 2026-11-15: Slack first).

Against a stand-in for Slack's Web API — nothing here reaches Slack — and the index stubbed at `index_page`'s seam."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from pramanyx.connectors.knowledge import slack as S

DAY = datetime(2026, 11, 3, 9, 30, tzinfo=timezone.utc).timestamp()


class _Resp:
    def __init__(self, body, status=200):
        self._body, self.status_code, self.headers = body, status, {}

    def raise_for_status(self):
        pass

    def json(self):
        return self._body


class _Slack:
    """conversations.list / members / history and users.info, as Slack answers them."""
    def __init__(self, *, refuse: str = "", needed: str = ""):
        self.headers, self.refuse, self.needed, self.asked = {}, refuse, needed, []

    def get(self, url, params=None, timeout=None):
        method = url.rsplit("/", 1)[-1]
        self.asked.append(method)
        if method == self.refuse:
            return _Resp({"ok": False, "error": "missing_scope", "needed": self.needed})
        if method == "conversations.list":
            return _Resp({"ok": True, "channels": [{"id": "C1", "name": "ops", "is_member": True},
                                                   {"id": "C2", "name": "secret", "is_member": False}]})
        if method == "conversations.members":
            return _Resp({"ok": True, "members": ["U1", "U2", "UB"]})
        if method == "users.info":
            users = {"U1": {"profile": {"email": "Ana@Example.com", "real_name": "Ana"}},
                     "U2": {"profile": {"real_name": "No Email"}},
                     "UB": {"is_bot": True, "profile": {"real_name": "a bot"}}}
            return _Resp({"ok": True, "user": users[params["user"]]})
        if method == "conversations.history":
            return _Resp({"ok": True, "messages": [
                {"ts": f"{DAY + 60:.6f}", "user": "U1", "text": "the Leeds DC is closed Monday"},
                {"ts": f"{DAY:.6f}", "user": "U2", "text": "morning"},
                {"ts": f"{DAY + 5:.6f}", "subtype": "channel_join", "user": "U2", "text": "joined"}]})
        raise AssertionError(method)


@pytest.fixture
def indexed(monkeypatch, tmp_path):
    monkeypatch.setattr("pramanyx.db.paths.state_dir", lambda: tmp_path)
    pages = []
    monkeypatch.setattr("pramanyx.connectors.knowledge.index_page", lambda **kw: pages.append(kw) or None)
    return pages


def test_only_the_channels_the_bot_is_in_are_read_one_document_a_day(indexed):
    got = S.SlackSync("sb1", "xoxb-test", session=_Slack()).sync()
    assert got == {"pages_indexed": 1, "channels": ["ops"], "skipped_count": 0}
    page = indexed[0]
    assert page["doc_id"] == "slack_sb1_C1_20261103" and page["title"] == "#ops · 2026-11-03"
    assert page["text"] == "09:30 No Email: morning\n09:31 Ana: the Leeds DC is closed Monday"     # in order, no joins


def test_a_day_is_readable_by_the_channels_members_and_no_one_slack_gives_no_email_for(indexed):
    S.SlackSync("sb1", "xoxb-test", session=_Slack()).sync()
    access = indexed[0]["access"]
    assert access["sharing"] == "chosen" and access["shared_with"] == [{"kind": "person", "id": "ana@example.com"}]
    assert "1 member without an email" in access["why"]


def test_a_missing_permission_is_said_with_the_one_slack_names(indexed):
    got = S.SlackSync("sb1", "xoxb-test", session=_Slack(refuse="conversations.list", needed="channels:read")).sync()
    assert got["needed"] == "channels:read" and "needs the channels:read permission" in got["refused"]
    assert indexed == []
    assert "channels:read" in S.SlackSync("sb1", "xoxb-test", session=_Slack()).status()["refused"]


def test_a_slack_page_synced_before_permissions_were_recorded_is_withheld():
    from pramanyx.knowledge.access import access_of
    assert access_of({"doc_id": "slack_sb1_C1_20261103"})["sharing"] == "chosen"


def test_a_new_bot_is_installed_with_what_reading_channels_needs():
    from pramanyx.slackbots.manifest import BOT_SCOPES
    assert {"channels:read", "groups:read", "users:read.email", "channels:history"} <= set(BOT_SCOPES)
