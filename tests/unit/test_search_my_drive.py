"""A person's own Drive, searched from a conversation (punch list 91, 2026-11-18): names, types, dates and links of the
files whose names hold the words — through the asker's OWN Google grant only, the words quoted and never passed through
as Drive's search syntax, and a missing or narrower grant said with how to connect one."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from pramanyx.integrations import call as callmod
from pramanyx.integrations import store
from pramanyx.integrations.models import Connection

DRIVE = "https://www.googleapis.com/auth/drive.metadata.readonly"


@pytest.fixture(autouse=True)
def _virgin_stores():
    for s in (store._APPS, store._CONNS, store._PENDING):
        for d in list(s.all()):
            s.delete(d["id"])
    yield
    for s in (store._APPS, store._CONNS, store._PENDING):
        for d in list(s.all()):
            s.delete(d["id"])


@pytest.fixture
def wire(monkeypatch):
    calls: list[dict] = []
    answer = {"files": [{"id": "f1", "name": "Q3 budget", "mimeType": "application/vnd.google-apps.spreadsheet",
                         "modifiedTime": "2026-11-01T10:00:00Z", "webViewLink": "https://docs.google.com/x"}]}

    def _fake_request(method, url, *, headers, query, body):
        calls.append({"url": url, "query": dict(query or {})})
        return 200, answer
    monkeypatch.setattr(callmod, "_request", _fake_request)
    monkeypatch.setattr(callmod, "_fresh_token", lambda cid: "at-live")
    return calls


@pytest.fixture
def client():
    from pramanyx.api import app
    return TestClient(app)


def _grant(cid: str, user: str = "", scopes: str = f"openid {DRIVE}", status: str = "active"):
    return store.save_connection(Connection(id=cid, provider="google", user_id=user, scopes=scopes,
                                            access_token="at", refresh_token="rt", status=status))


def test_the_words_find_files_by_name_in_the_asker_s_own_drive(client, wire):
    _grant("ic_mine")
    r = client.get("/integrations/drive/files", params={"words": "Q3 budget", "limit": 5})
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["searched"] is True and got["files"] == [{"name": "Q3 budget", "type": "application/vnd.google-apps.spreadsheet",
                                                         "modified": "2026-11-01T10:00:00Z", "link": "https://docs.google.com/x"}]
    assert wire[0]["url"] == "https://www.googleapis.com/drive/v3/files"
    assert wire[0]["query"]["q"] == "name contains 'Q3' and name contains 'budget' and trashed = false"
    assert wire[0]["query"]["pageSize"] == 5


def test_a_word_cannot_become_drive_search_syntax():
    from pramanyx.routers.integrations import _drive_query
    q = _drive_query("x' or name contains '")
    assert q == "name contains 'x\\'' and name contains 'or' and name contains 'name' and name contains 'contains' and name contains '\\'' and trashed = false"
    assert _drive_query("a\\b") == "name contains 'a\\\\b' and trashed = false"
    assert _drive_query(" ".join(str(i) for i in range(20))).count("name contains") == 8


def test_with_no_grant_of_their_own_it_says_how_to_connect_and_searches_nothing(client, wire):
    _grant("ic_someone_else", user="u-other")
    got = client.get("/integrations/drive/files", params={"words": "budget"}).json()
    assert got["searched"] is False and "connect Google Drive" in got["why"] and wire == []


def test_a_grant_without_drive_is_said_and_not_used(client, wire):
    _grant("ic_gmail_only", scopes="openid https://www.googleapis.com/auth/gmail.readonly")
    got = client.get("/integrations/drive/files", params={"words": "budget"}).json()
    assert got["searched"] is False and "add Google Drive" in got["why"] and wire == []
    _grant("ic_revoked", status="revoked")
    assert client.get("/integrations/drive/files", params={"words": "budget"}).json()["searched"] is False


def test_no_words_is_refused(client, wire):
    _grant("ic_mine")
    assert client.get("/integrations/drive/files", params={"words": "  "}).status_code == 422
