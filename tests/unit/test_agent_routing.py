"""Punch list 93 (2026-11-18): a question goes to the connection's own agent. The coworker is told, where it reads its
instructions for a connection, which agent that connection has (ask through it) or which it has (choose by purpose) —
and nothing when it has none. An agent bound to no connection, or switched off, is never routed to by connection."""
from __future__ import annotations

from types import SimpleNamespace as A

from pramanyx.custom_agents.routing import agents_for_connection, routing_words

MARGIN = A(id="ua_1", name="Margin Analyst", purpose="Superstore sales, profit and margin", connection_id="c1", enabled=True)
SCOUT = A(id="ua_2", name="Anomaly Scout", purpose="", connection_id="c2", enabled=True)
LOOK = A(id="ua_3", name="The Look Analyst", purpose="theLook orders and revenue", connection_id="c2", enabled=True)
OFF = A(id="ua_4", name="Old Analyst", purpose="x", connection_id="c1", enabled=False)
FREE = A(id="ua_5", name="Anywhere", purpose="any data", connection_id="", enabled=True)


def test_one_agent_on_a_connection_is_asked_through():
    agents = agents_for_connection("c1", [MARGIN, SCOUT, LOOK, OFF, FREE])
    assert [a["tool"] for a in agents] == ["ask_margin_analyst"]
    words = routing_words(agents)
    assert words.startswith("## Its agent\n")
    assert "**Margin Analyst** — Superstore sales, profit and margin" in words
    assert "through `ask_margin_analyst`" in words and "Use `ask` only when the person asks" in words


def test_several_agents_are_chosen_between_by_purpose():
    agents = agents_for_connection("c2", [MARGIN, SCOUT, LOOK])
    assert [a["name"] for a in agents] == ["Anomaly Scout", "The Look Analyst"]
    words = routing_words(agents)
    assert "This connection has 2 agents" in words
    assert "- **Anomaly Scout** (`ask_anomaly_scout`) — no purpose written" in words
    assert "- **The Look Analyst** (`ask_the_look_analyst`) — theLook orders and revenue" in words
    assert "When none of them fits the question, use `ask`." in words


def test_no_agent_says_nothing_and_an_unbound_or_switched_off_agent_is_not_routed_to():
    assert agents_for_connection("c3", [MARGIN, SCOUT, OFF, FREE]) == []
    assert routing_words([]) == ""
    assert agents_for_connection("", [FREE]) == []


def test_the_route_is_not_read_as_an_agents_id():
    from pramanyx.routers import agents as R
    paths = [getattr(r, "path", "") for r in R.router.routes]
    assert paths.index("/agents/custom/routing") < paths.index("/agents/custom/{agent_id}")
