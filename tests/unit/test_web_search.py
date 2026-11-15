"""The web, for outside context only (the user's call, 2026-11-15): an organisation's setting, off by default; a
provider the operator configures; each search counted as an outside call and journaled; a source, never a figure.
Hermetic: the provider is stubbed at its seam, so nothing here leaves the machine."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx import web_search as W


@pytest.fixture
def allowed(monkeypatch):
    state = {"on": True, "journal": [], "calls": []}
    monkeypatch.setattr("pramanyx.orgsettings.allows.allows", lambda k: state["on"] if k == "web_search" else False)
    monkeypatch.setenv("PRAMANYX_WEB_SEARCH_PROVIDER", "brave")
    monkeypatch.setenv("PRAMANYX_WEB_SEARCH_KEY", "test-key")

    def brave(q, n, key):
        state["calls"].append((q, n))
        return [W.Result("Bank holiday", "https://example.org/holiday", "Monday is a public holiday"),
                W.Result("Not a page", "javascript:alert(1)", "")]
    monkeypatch.setitem(W._PROVIDERS, "brave", brave)

    class _L:
        def emit(self, kind, payload, **kw):
            state["journal"].append((kind, payload))
    monkeypatch.setattr("pramanyx.kernel.ledger.Ledger.default", staticmethod(lambda: _L()))
    return state


def test_off_by_default_says_where_to_turn_it_on(allowed):
    allowed["on"] = False
    with pytest.raises(W.SearchRefused, match="off for this organisation"):
        W.search("bank holiday may 2026")
    assert allowed["calls"] == []


def test_no_provider_configured_is_said(allowed, monkeypatch):
    monkeypatch.delenv("PRAMANYX_WEB_SEARCH_KEY")
    with pytest.raises(W.SearchRefused, match="No web search provider"):
        W.search("bank holiday")


def test_a_search_returns_sources_and_journals_what_left(allowed):
    got = W.search("  bank   holiday  ", n=50, by="user:ana@example.com")
    assert [r.url for r in got] == ["https://example.org/holiday"]                # only real web addresses
    assert allowed["calls"] == [("bank holiday", W.MAX_RESULTS)]
    assert [j for j in allowed["journal"] if j[0] == "web.searched"] == [("web.searched", {"query": "bank holiday", "provider": "brave", "results": 2,
                                                    "by": "user:ana@example.com"})]


def test_a_usage_cap_stops_it_before_it_leaves(allowed, monkeypatch):
    from pramanyx.govern import outbound

    class _No:
        allowed, reason = False, "monthly cap reached"
    monkeypatch.setattr(outbound, "_cap_decision", lambda org, user: _No())
    with pytest.raises(W.SearchRefused, match="monthly cap reached"):
        W.search("bank holiday")
    assert allowed["calls"] == []


def test_the_route_answers_a_refusal_with_its_sentence(allowed):
    from pramanyx.routers import web_search as R
    app = FastAPI()
    app.include_router(R.router)
    client = TestClient(app)
    ok = client.get("/web/search", params={"q": "bank holiday"}).json()
    assert ok["results"][0]["url"] == "https://example.org/holiday" and "never state a figure" in ok["use"]
    allowed["on"] = False
    assert "off for this organisation" in client.get("/web/search", params={"q": "x"}).json()["refused"]


def test_it_is_an_organisation_setting_and_the_coworker_tool_is_a_read():
    from pramanyx.mcp.policy import TOOL_LEVELS
    from pramanyx.orgsettings.allows import FORMER_ENV
    from pramanyx.orgsettings.models import OrgSettings
    assert FORMER_ENV["web_search"] == () and OrgSettings().web_search is None
    assert TOOL_LEVELS["search_the_web"] == "read" and TOOL_LEVELS["schedule_question"] == "act"
