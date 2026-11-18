"""The dashboards study's R20 — a question asked about a dashboard or one of its cards: told the cards as the asker may read the
dashboard, and held to the period on screen. Nothing here calls a model."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from pramanyx.agent import ask_subject as S
from pramanyx.routers.investigations import AskFocus

SPEC = {"root": "r", "elements": {
    "r": {"props": {"title": "Sales"}, "children": ["c1", "c2"]},
    "c1": {"type": "Card", "props": {"card": "rev", "title": "Revenue here"}, "children": []},
    "c2": {"type": "Card", "props": {"card": "ord"}, "children": []},
}}
CARDS = {"rev": SimpleNamespace(title="Revenue", sql="SELECT SUM(x) FROM o"), "ord": SimpleNamespace(title="Orders", sql="SELECT COUNT(*) FROM o")}


@pytest.fixture
def board(monkeypatch):
    import pramanyx.cards.store as store
    monkeypatch.setattr(S, "_dashboard_spec", lambda *_a: (SPEC, ""))
    monkeypatch.setattr(store, "get_card", CARDS.get)


def _ask(**kw):
    return S.resolve(AskFocus(kind="dashboard", dashboard="sales", **kw), "c", person="me")


def test_a_dashboard_is_told_with_every_card_and_held_to_the_period_on_screen(board):
    got = _ask(period="2026-10-01..2026-10-31")
    assert got.words() == "About the dashboard “Sales” · 2 cards · 2026-10-01 to 2026-10-31"
    prose = got.prose()
    assert "Answer for 2026-10-01 to 2026-10-31, from 2026-10-01 to 2026-10-31 inclusive" in prose
    assert "ask before leaving this one" in prose
    body = json.loads(prose.split("```json\n")[1].split("\n```")[0])
    assert [c["title"] for c in body["cards"]] == ["Revenue here", "Orders"]              # as this dashboard calls it
    assert body["cards"][1]["sql"] == "SELECT COUNT(*) FROM o"


def test_one_card_is_told_alone_and_a_card_not_on_the_dashboard_is_refused(board):
    one = _ask(id="ord", period="2026-10-01..2026-10-31")
    assert one.words() == "About “Orders” on “Sales” · 2026-10-01 to 2026-10-31"
    assert [c["id"] for c in one.board["cards"]] == ["ord"]
    assert "not on the dashboard" in _ask(id="elsewhere").refused


def test_a_dashboard_with_no_period_says_each_figure_s_own(board):
    got = _ask()
    assert got.words().endswith("· as written")
    assert "say the period of every figure" in got.prose()


def test_a_dashboard_the_asker_may_not_read_is_said_and_nothing_of_it_is_told(monkeypatch):
    monkeypatch.setattr(S, "_dashboard_spec", lambda *_a: (None, "This dashboard is not shared with you."))
    got = _ask()
    assert got.refused == "This dashboard is not shared with you." and "SELECT" not in got.prose()


@pytest.mark.parametrize("said", ["", "2026-10-01", "soon..later", "2026-11-01..2026-10-01", "2026-02-30..2026-03-01"])
def test_a_period_that_is_not_two_real_days_in_order_holds_nothing(said):
    assert S.held_period(said) is None


def test_a_dashboard_subject_names_its_dashboard():
    with pytest.raises(ValidationError):
        AskFocus(kind="dashboard")
