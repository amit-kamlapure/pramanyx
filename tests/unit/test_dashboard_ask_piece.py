"""The study's R19 — a change asked for in words about one piece: held to that piece, and a draft that reaches past it is sent
back to be repaired, never staged. No model is called here."""
from __future__ import annotations

from types import SimpleNamespace

from pramanyx.dashboards import ask, versions

SPEC = {"root": "r", "elements": {
    "r": {"type": "Cockpit", "props": {"title": "Sales"}, "children": ["c1", "n1"]},
    "c1": {"type": "Card", "props": {"card": "a"}, "children": []},
    "n1": {"type": "Note", "props": {"text": "Mine"}, "children": []},
}}


def test_a_draft_stays_on_the_piece_or_says_where_it_went():
    inside = {"op": "edit", "patches": [{"op": "replace", "path": "/elements/c1/props/size", "value": "wide"}]}
    assert ask.outside_piece(inside, "c1") == []
    assert ask.outside_piece({"op": "options"}, "c1") == []
    away = {"op": "edit", "patches": [{"op": "remove", "path": "/elements/n1"}, {"op": "move", "from": "/elements/c10/props/x", "path": "/elements/c1/props/x"}]}
    assert ask.outside_piece(away, "c1") == ["Only the element c1 may be changed; these reach past it: /elements/c10/props/x, /elements/n1."]
    assert "op edit alone" in ask.outside_piece({"op": "publish", "to": []}, "c1")[0]
    assert "changes nothing" in ask.outside_piece({"op": "edit", "patches": []}, "c1")[0]


def _live(monkeypatch):
    monkeypatch.setattr(versions, "latest", lambda _h: {"retired": False, "spec": SPEC})


def test_a_piece_no_longer_there_and_a_note_are_refused_before_any_model_is_asked(monkeypatch):
    _live(monkeypatch)
    gone = ask.edit_in_words("c", "me", "d1", "make it wider", target="c9", provider=object())
    assert gone["staged"] is False and gone["sentences"] == ["That piece is no longer on the dashboard."]
    note = ask.edit_in_words("c", "me", "d1", "reword this", target="n1", provider=object())
    assert note["staged"] is False and note["sentences"] == ["A note or an image is yours to change by hand."]


def test_a_draft_that_reaches_past_the_piece_never_reaches_the_drafting_tool(monkeypatch):
    import pramanyx.agent.dashboard_tool as tool_module
    import pramanyx.agent.tool_loop as loop

    _live(monkeypatch)
    drafted: list[dict] = []
    monkeypatch.setattr(tool_module, "drafting_tool", lambda *a, **k: SimpleNamespace(
        name="draft_dashboard", description="", parameters={}, run=lambda args: drafted.append(args) or {"staged": True}))

    def loop_once(_provider, system, asked, tools, **_k):
        assert "alone" in system and 'the element "c1"' in asked
        out = tools[0].run({"op": "edit", "patches": [{"op": "remove", "path": "/elements/n1"}]})
        assert out["staged"] is False and "reach past it" in out["refused"][0]
        return SimpleNamespace(answer="", stop_reason="done")

    monkeypatch.setattr(loop, "run_tool_loop", loop_once)
    got = ask.edit_in_words("c", "me", "d1", "take the note off too", target="c1", provider=object())
    assert drafted == [] and got["staged"] is False and "reach past it" in got["sentences"][0]
