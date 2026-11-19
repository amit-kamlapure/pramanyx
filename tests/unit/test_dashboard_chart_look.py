"""How ONE chart of a person's own query is drawn, changed by asking about that chart (the user, 2026-11-19, of a peer
product's per-chart assistant: "pin-point precision"): only the named settings change, each held to what the chart editor
offers and to the statement's columns; it is staged line by line and drawn so only on the person's Allow, and not at all
when the chart was changed since."""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

import pramanyx.routers.investigations as I
from pramanyx.cards import store as card_store
from pramanyx.cards.models import StoredCard
from pramanyx.dashboards import cards, chart_look
from pramanyx.dashboards.chat_change import change_tools
from pramanyx.dashboards.home import Home

COLUMNS = [{"name": "day", "type": "DATE"}, {"name": "total", "type": "DOUBLE"}, {"name": "priority", "type": "VARCHAR"}]
SHOWN = {"as": "line", "x": "day", "bucket": "day", "series": [{"column": "total", "agg": "sum"}]}


@pytest.fixture
def chart():
    tag = uuid.uuid4().hex[:6]
    board = f"sales-{tag}"
    home = Home(f"c{tag}", f"ana{tag}", board)
    card = cards.place(home, StoredCard(id=f"q{tag}", kind="chart", title="Revenue by priority", sql="SELECT day, total, priority FROM o",
                                        render={"shown": SHOWN, "columns": COLUMNS}))
    return SimpleNamespace(home=home, board=board, card=card)


def _propose(c, shown=None, viz=None):
    return chart_look.propose(c.home.connection_id, c.home.owner, c.board, c.card.id, shown, viz, "Thicker lines")


def test_only_the_settings_named_change_and_each_is_said_as_a_line(chart):
    p = _propose(chart, shown={"split": "priority"}, viz={"lineWidth": 4, "lineShape": "smooth"})
    assert p.kind == "chart_look" and p.status == "pending"
    assert p.detail["lines"] == ["Coloured by: none → priority", "Line width: 2 → 4", "Line shape: none → smooth"]
    assert p.params["shown"]["x"] == "day" and p.params["shown"]["split"] == "priority"     # the rest stay
    assert p.params["viz"] == {"lineWidth": 4, "lineShape": "smooth"}
    # nothing is drawn differently until the person allows it
    assert card_store.get_card(chart.card.id).render["shown"] == SHOWN


def test_what_the_chart_editor_does_not_offer_or_the_statement_does_not_return_is_refused_whole(chart):
    with pytest.raises(chart_look.Refused) as e:
        _propose(chart, shown={"split": "region", "glow": True}, viz={"lineWidth": 9, "sparkle": 1})
    said = " ".join(e.value.sentences)
    assert "“glow” is not part of how a chart is set up." in said
    assert "Line width is a whole number from 1 to 6." in said
    assert "“sparkle” is not something the chart editor sets." in said
    with pytest.raises(chart_look.Refused) as e:
        _propose(chart, shown={"split": "region"})
    assert "“region”, which this query does not return" in " ".join(e.value.sentences)
    with pytest.raises(chart_look.Refused, match="nothing would change"):
        _propose(chart, shown={"as": "line"})


def test_only_a_chart_of_the_persons_own_query_is_changed(chart):
    with pytest.raises(chart_look.Refused, match="Only a chart of your own query"):
        chart_look.propose(chart.home.connection_id, "bo", chart.board, chart.card.id, None, {"lineWidth": 3})


def test_allowed_it_is_drawn_so_and_a_chart_changed_since_is_left_as_it_is(chart):
    from pramanyx.actions.inbox import accept_proposal
    p = _propose(chart, viz={"lineWidth": 4})
    accept_proposal(p.id, actor="briefing")
    assert card_store.get_card(chart.card.id).render["viz"] == {"lineWidth": 4}
    later = _propose(chart, viz={"lineWidth": 6})
    held = card_store.get_card(chart.card.id)
    card_store.upsert_card(held.model_copy(update={"render": {**held.render, "viz": {"lineWidth": 1}}}))   # the editor, meanwhile
    accept_proposal(later.id, actor="briefing")
    assert card_store.get_card(chart.card.id).render["viz"] == {"lineWidth": 1}


def test_a_question_about_one_chart_of_the_persons_own_dashboard_can_change_its_look(chart, monkeypatch):
    import pramanyx.dashboards.home as H
    monkeypatch.setattr(H, "person_of", lambda request: "ana")
    one = SimpleNamespace(focus=I.AskFocus(kind="dashboard", dashboard="sales", id="q1"))
    assert I._own_dashboard(one, None) == ("ana", "sales", "q1")
    assert [t.name for t in change_tools("c1", ("ana", "sales"))] == ["change_dashboard"]
    frames: list = []
    tools = change_tools(chart.home.connection_id, (chart.home.owner, chart.board, chart.card.id),
                         emit=lambda k, p: frames.append((k, p)))
    assert [t.name for t in tools] == ["change_dashboard", "change_chart"]
    out = tools[1].run({"viz": {"lineWidth": 4}, "summary": "Make the lines thicker"})
    assert out["staged"] and out["changes"] == ["Line width: 2 → 4"] and "Nothing has changed yet" in out["next"]
    assert [p["kind"] for k, p in frames if k == "proposal_staged"] == ["chart_look"]
    refused = tools[1].run({"viz": {"lineWidth": 12}})
    assert refused["staged"] is False and refused["said"] == ["Line width is a whole number from 1 to 6."]


def test_the_conversation_is_told_how_the_chart_is_drawn_now():
    drawn = chart_look.drawn({"shown": SHOWN, "viz": {"lineWidth": 3}, "columns": COLUMNS})
    assert drawn["shown"] == SHOWN and drawn["viz"] == {"lineWidth": 3}
    assert drawn["columns"] == [{"name": "day", "kind": "date"}, {"name": "total", "kind": "number"}, {"name": "priority", "kind": "text"}]
