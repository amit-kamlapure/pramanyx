"""People, step three: the coworker acts for the person the app hands it (2026-11-15).

Measured that morning: the coworker sent no identity, so everything it did was recorded as the API's own login; a
model-settable body field was the only way a name rode along; and `GET /coworker` handed the shell's access token to
any caller. Decided by the user the same day: only the person's own clicks are their verdict — the agent never.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import pramanyx.feedback.verdicts as vd
from pramanyx.security import delegation as D
from pramanyx.security.authz import resolve_actor, resolve_principal


class _Kv:
    def __init__(self):
        self.rows = {}

    def kv_put(self, store, key, value):
        self.rows[(store, key)] = value

    def kv_get(self, store, key):
        return self.rows.get((store, key))

    def kv_delete(self, store, key):
        return self.rows.pop((store, key), None) is not None


@pytest.fixture(autouse=True)
def kv(monkeypatch, tmp_path):
    led = _Kv()
    monkeypatch.setattr(D, "_ledger", lambda: led)
    monkeypatch.setattr(vd, "_DB_PATH", tmp_path / "verdicts.db")
    monkeypatch.setenv("PRAMANYX_LOCAL_USER", "operator@example.com")
    monkeypatch.delenv("PRAMANYX_REQUIRE_IDENTITY", raising=False)
    return led


def _req(headers: dict):
    from starlette.requests import Request
    return Request({"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
                    "method": "GET", "path": "/", "query_string": b"", "client": ("127.0.0.1", 1)})


def test_a_delegation_names_its_person_until_it_ends(kv):
    token, _ = D.mint("ana@example.com", "default")
    assert D.resolve(token).user_id == "ana@example.com"
    assert not any(token in str(k) for k in kv.rows)                    # only its hash is kept
    assert D.revoke(token) and D.resolve(token) is None


def test_an_expired_or_foreign_delegation_names_no_one(kv, monkeypatch):
    token, _ = D.mint("ana@example.com", "default", audience="elsewhere")
    assert D.resolve(token) is None
    monkeypatch.setattr(D, "TTL_S", -1)
    old, _ = D.mint("ana@example.com", "default")
    assert D.resolve(old) is None and kv.rows.get(("delegations", D._key(old))) is None


@pytest.mark.parametrize("who", ["agent:coworker", "service:nightly", "api:mcp:x", "said:ana"])
def test_only_a_person_can_be_delegated(who):
    with pytest.raises(ValueError):
        D.mint(who, "default")


def test_a_delegated_request_is_recorded_under_its_person_and_a_bad_one_never_falls_through():
    token, _ = D.mint("ana@example.com", "default")
    assert resolve_actor(_req({D.HEADER: token})) == "ana@example.com"
    assert resolve_principal(_req({D.HEADER: "not-a-token", "X-Pramanyx-Org": "o", "X-Pramanyx-User": "ceo"})) is None


def _app(*routers):
    app = FastAPI()
    for r in routers:
        app.include_router(r)
    return TestClient(app, client=("127.0.0.1", 50000))


def test_the_app_mints_one_for_its_person_and_a_delegated_or_agent_request_cannot():
    from pramanyx.routers import authcfg
    client = _app(authcfg.router)
    got = client.post("/auth/delegation").json()
    assert got["user_id"] == "operator@example.com"
    assert client.get("/auth/delegation", headers={D.HEADER: got["token"]}).json()["user_id"] == "operator@example.com"
    assert client.get("/auth/delegation", headers={D.HEADER: "nope"}).status_code == 401
    assert client.post("/auth/delegation", headers={D.HEADER: got["token"]}).status_code == 403
    assert client.post("/auth/delegation", headers={"X-Pramanyx-Agent": "mcp"}).status_code == 403


def test_a_persons_own_click_is_their_verdict_and_the_agent_cannot_give_one():
    from pramanyx.routers import verify
    client = _app(verify.router)
    token, _ = D.mint("ana@example.com", "default")
    body = {"connection_id": "c", "investigation_id": "i1", "verdict": "reject"}
    refused = client.post("/verify/verdict", json=body, headers={D.HEADER: token, "X-Pramanyx-Agent": "mcp"})
    assert refused.status_code == 403 and "person's word" in refused.json()["detail"]
    assert vd.list_verdicts("c") == []


def test_the_coworkers_address_and_its_token_go_only_to_this_machine(monkeypatch):
    from pramanyx import coworkers as K
    from pramanyx.routers import coworker as C
    monkeypatch.setattr(K, "_announced", {"": {"url": "http://127.0.0.1:3090/?token=abc", "at": K._now()}})
    monkeypatch.delenv("PRAMANYX_REQUIRE_IDENTITY", raising=False)
    app = FastAPI()
    app.include_router(C.router)
    assert TestClient(app, client=("127.0.0.1", 1)).get("/coworker").json()["url"].endswith("token=abc")
    away = TestClient(app, client=("203.0.113.9", 1)).get("/coworker").json()
    assert away["available"] is True and away["url"] is None


def test_the_mcp_client_presents_the_kept_person_and_nothing_a_tool_could_set(tmp_path, monkeypatch):
    from pramanyx.mcp import client as M
    kept = tmp_path / "delegation"
    kept.write_text("t" * 43)
    monkeypatch.setenv("PRAMANYX_DELEGATION_FILE", str(kept))
    h = M.PramanyxClient(base_url="http://x")._headers()
    assert h[M.DELEGATION_HEADER] == "t" * 43 and h[M.AGENT_HEADER] == M.AGENT_MARK
