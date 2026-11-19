"""Agent on a dashboard the person keeps: the conversation decides (the user, 2026-11-19, "Conversation decides").

In the Ask panel beside a dashboard the person keeps, one box takes a question or a change. Agent mode used to send every
turn to the analyst, which holds no change tool and whose intake would invent a metric for "make the card wide". Such a
turn is served by the conversation now: it holds both `deep_analysis` and `change_dashboard`, and is told the person chose
Agent. Anywhere else, Agent is the analyst as before. Each test posts the body the panel sends (`focusOf` of a dashboard
subject, Agent's door: depth deep), as the web's chat route forwards it.
"""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx.routers import investigations as inv


def _events(text: str) -> list[dict]:
    return [json.loads(ln[6:]) for ln in text.splitlines() if ln.startswith("data: ")]


@pytest.fixture
def door(monkeypatch):
    served: dict = {}

    async def converse(question, connection_id, history, **kw):
        served.update(body="converse", **kw)
        yield inv._sse("headline", {"headline": "from the conversation"})
        yield inv._sse("done", {})

    async def analyst_job(*a, **kw):
        served.update(body="analyst")
        yield inv._sse("headline", {"headline": "from the analyst"})
        yield inv._sse("done", {})

    async def nothing(*a, **k):
        return None

    async def no_origin(*a, **k):
        return ""

    def refuse(*a, **k):
        raise AssertionError("another body served the turn")

    monkeypatch.setattr(inv, "_stream_converse", converse)
    monkeypatch.setattr(inv, "_job_streamed_body", analyst_job)
    monkeypatch.setattr(inv, "_stream_analyst", lambda *a, **k: None)
    monkeypatch.setattr(inv, "_stream_chat", refuse)
    monkeypatch.setattr(inv, "_investigation_job_streamed", refuse)
    monkeypatch.setattr(inv, "_metered_stream", lambda gen, budget=None: gen)
    monkeypatch.setattr(inv, "_ask_subject_for", nothing)
    monkeypatch.setattr(inv, "_build_origin_finding", nothing)
    monkeypatch.setattr(inv, "_origin_prose_for", no_origin)
    monkeypatch.setattr(inv, "_focus_prose_for", lambda *a, **k: "## On screen\nthe dashboard")
    monkeypatch.setattr("pramanyx.agent.converse_tools.binding_calls_tools", lambda: True)
    monkeypatch.setattr("pramanyx.licensing.has_capability", lambda *a, **k: True)
    monkeypatch.setattr("pramanyx.dashboards.home.person_of", lambda request: "ana")
    monkeypatch.setattr("pramanyx.kernel.flags.flag_enabled", lambda n: False)
    app = FastAPI()
    app.include_router(inv.router)
    return TestClient(app), served


def _ask(client, question: str, focus: dict | None, depth: str = "deep") -> list[dict]:
    # what `web/app/api/chat/route.ts` posts to /ask for a plain question from the panel
    body = {"question": question, "connection_id": "sheets", "canvas_id": None, "schema": None, "history": [],
            "session_id": "s1", "depth": depth, "agent_id": None, "skip_clarify": False, "clarify_reading": "",
            "clarify_subject": "", "clarify_source": "", "insight_id": None, "deep": False, "mode": None,
            "purpose": "", "surface": "", "brief_period": "", "focus": focus}
    r = client.post("/ask", json=body)
    assert r.status_code == 200, (r.status_code, r.text[:800])
    return _events(r.text)


OWN = {"kind": "dashboard", "dashboard": "ask-panel-check", "label": "Ask panel check", "period": "2026-10-01..2026-10-31"}
SHARED = {**OWN, "owner": "bo"}


def test_agent_on_the_persons_own_dashboard_is_served_by_the_conversation_told_they_chose_agent(door):
    client, served = door
    evs = _ask(client, "Make the Titles by type card wide", OWN)
    assert served["body"] == "converse"
    assert served["dashboard"] == ("ana", "ask-panel-check")         # it holds the change tool
    assert inv.AGENT_CHOSEN_PROSE in served["origin_prose"]          # and knows the person asked for depth
    route = next(e for e in evs if e["type"] == "route")
    assert route["depth"] == "quick" and route["body"] == "converse" and route["decided_by"] == "conversation"
    assert route["why"] == inv.AGENT_CHOSEN_WHY


def test_agent_on_a_dashboard_shared_with_them_stays_the_analyst(door):
    client, served = door
    evs = _ask(client, "Why did returns rise?", SHARED)
    assert served["body"] == "analyst"
    route = next(e for e in evs if e["type"] == "route")
    assert route["depth"] == "deep" and "decided_by" not in route


def test_agent_with_no_dashboard_stays_the_analyst(door):
    client, served = door
    _ask(client, "Why did returns rise?", None)
    assert served["body"] == "analyst"


def test_quick_on_the_persons_own_dashboard_is_the_conversation_as_before_and_is_not_told_agent(door):
    client, served = door
    evs = _ask(client, "How many titles are there?", OWN, depth="quick")
    assert served["body"] == "converse" and inv.AGENT_CHOSEN_PROSE not in served["origin_prose"]
    assert "decided_by" not in next(e for e in evs if e["type"] == "route")


def test_a_change_naming_the_dashboard_reaches_the_conversation_on_the_persons_own(door):
    client, served = door
    ask = "Add a revenue card to this dashboard"
    _ask(client, ask, OWN, depth="quick")
    assert served["body"] == "converse"
    # with no dashboard of theirs open, the same words are still told where dashboards are made
    served.clear()
    evs = _ask(client, ask, None, depth="quick")
    assert not served
    assert next(e["headline"] for e in evs if e["type"] == "headline").startswith("Dashboards are drafted in the Briefing")
