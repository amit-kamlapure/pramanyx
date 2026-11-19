"""A change to the dashboard on screen, asked in the Ask panel's conversation: staged for the person's own Allow."""
from __future__ import annotations

from types import SimpleNamespace

import pramanyx.routers.investigations as I
from pramanyx.dashboards.chat_change import change_tools, heard_words
from pramanyx.dashboards.propose import KIND


def test_no_dashboard_gives_no_tool():
    assert change_tools("c1", None) == []
    assert change_tools("c1", ("", "d1")) == []


def test_a_change_is_drafted_on_the_persons_own_dashboard_and_staged_for_their_allow():
    frames, asked = [], {}

    def draft(conn, person, dashboard, words, *, schema=None, hear=None):
        asked.update(conn=conn, person=person, dashboard=dashboard, words=words, schema=schema)
        hear({"type": "read", "metrics": 3, "trusted_queries": 1, "findings": 2})
        hear({"type": "checking", "cards": 1})
        return {"staged": True, "proposal_id": "p1", "summary": "Adds one card."}

    kept = SimpleNamespace(id="p1", kind=KIND, connection_id="c1", action_id="as-staged")
    [tool] = change_tools("c1", ("ana", "sales"), emit=lambda k, p: frames.append((k, p)), schema="s", draft=draft,
                          record=lambda pid: kept if pid == "p1" else None)
    out = tool.run({"change": "  make the revenue   card bigger "})
    assert asked == {"conn": "c1", "person": "ana", "dashboard": "sales", "words": "make the revenue card bigger", "schema": "s"}
    assert out["staged"] and "Nothing has changed yet" in out["next"] and "never by an id" in out["next"]
    assert "p1" not in str(out)   # the model is handed no id to repeat
    # the card is the stored proposal, as the inbox keeps it
    assert ("proposal_staged", {"proposal_id": "p1", "kind": KIND, "connection_id": "c1", "action_id": "as-staged"}) in frames
    assert [p["text"] for k, p in frames if k == "status"] == [
        "Read what the dashboard can be made of: 3 metrics, 1 trusted queries, 2 findings", "Checking a draft with 1 new card"]


def test_a_change_not_drafted_says_why_in_the_platforms_words():
    [tool] = change_tools("c1", ("ana", "sales"), draft=lambda *a, **k: {"staged": False, "sentences": ["There is no dashboard here to change."]})
    out = tool.run({"change": "add a map"})
    assert out == {"staged": False, "said": ["There is no dashboard here to change."], "next": "Nothing was staged. Tell the person why, in these words."}
    assert tool.run({"change": " "})["said"] == ["Say what to change."]


def test_a_card_running_and_unknown_steps_read_as_lines_or_nothing():
    assert heard_words({"type": "card", "state": "running", "title": "Revenue"}) == "Running the card “Revenue”"
    assert heard_words({"type": "sent_back", "points": 2}) == "Repairing 2 points the platform sent back"
    assert heard_words({"type": "card", "state": "ok"}) == "" and heard_words({}) == ""


def test_only_the_askers_own_dashboard_can_be_changed(monkeypatch):
    import pramanyx.dashboards.home as H
    monkeypatch.setattr(H, "person_of", lambda request: "ana")
    own = SimpleNamespace(focus=I.AskFocus(kind="dashboard", dashboard="sales"))
    shared = SimpleNamespace(focus=I.AskFocus(kind="dashboard", dashboard="sales", owner="bo"))
    assert I._own_dashboard(own, None) == ("ana", "sales")
    assert I._own_dashboard(shared, None) is None
    assert I._own_dashboard(SimpleNamespace(focus=I.AskFocus(kind="sheet", id="s1")), None) is None
    assert I._own_dashboard(SimpleNamespace(focus=None), None) is None
