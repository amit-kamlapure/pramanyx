"""A staged change in a person's words, the same wherever its card is drawn (2026-11-20: in the coworker too, the person
allows a staged change once, on its card in the conversation, after seeing what changes)."""
from __future__ import annotations

from types import SimpleNamespace

from pramanyx.actions.said import said_of


def _p(kind, params=None, detail=None, reasoning="", action_id=""):
    return SimpleNamespace(kind=kind, params=params or {}, detail=detail or {}, reasoning=reasoning, action_id=action_id)


def test_a_monitor_and_its_alert_say_what_they_watch_and_where_the_alert_goes():
    chain = {"effects": [{"kind": "investigate", "config": {"question": "Why did revenue drop?"}},
                         {"kind": "slack_post", "config": {"channel": "#sales", "bot_id": "sb_1"}}]}
    said = said_of(_p("monitor_bundle", {"monitor": {}, "automation": chain},
                      {"watches": "revenue", "sigma": 3, "check_cadence": "hourly", "open_choices": []},
                      "alert when revenue breaks 3σ OPEN CHOICES: x"))
    assert said["asks"] == "Set up this monitor and its alert?"
    assert said["lines"] == ["Watches: revenue", "Fires when: it moves more than 3σ from usual", "Checked: hourly",
                             "Then: a deep analysis: “Why did revenue drop?”", "Then: a Slack post to #sales"]
    assert said["why"] == "alert when revenue breaks 3σ" and said["needs_choices"] is False


def test_an_alert_with_no_channel_says_one_is_still_to_choose_and_that_the_full_card_takes_it():
    chain = {"effects": [{"kind": "slack_post", "config": {"channel": ""}}]}
    said = said_of(_p("monitor_bundle", {"automation": chain}, {"watches": "orders", "open_choices": [{"key": "channel"}]}))
    assert "Then: a Slack post, to a channel still to choose" in said["lines"] and said["needs_choices"] is True


def test_a_chart_change_and_a_stand_in_say_so_first_and_no_line_names_an_id():
    said = said_of(_p("chart_look", detail={"title": "Olist orders", "lines": ["Line width: 4 → 6"],
                                          "stand_in": "Not possible here: a neon glow. This is the closest the chart can do."}))
    assert said["asks"] == "Change how “Olist orders” is drawn?"
    assert said["lines"][0].startswith("Not possible here") and said["lines"][1] == "Line width: 4 → 6"


def test_an_edit_a_pause_a_delete_and_a_limit_each_say_what_changes():
    edit = said_of(_p("automation_edit", detail={"automation_name": "Daily sales", "diff": [{"field": "name", "before": "a", "after": "b"}]}))
    assert edit["asks"] == "Change the automation “Daily sales”?" and edit["lines"] == ["name: a → b"]
    gone = said_of(_p("automation_state", {"action": "delete"}, action_id="automation-delete:Daily sales"))
    assert gone["lines"] == ["Delete: “Daily sales”", "A delete cannot be undone."]
    limit = said_of(_p("agent_limit", {"agent": "Curator", "label": "Monthly spend", "before": 1000, "value": 2500, "unit": "USD"}))
    assert limit["lines"] == ["Curator: monthly spend 1,000 → 2,500 USD"]
    sched = said_of(_p("automation_draft", {"name": "Morning", "conditions": [{"kind": "schedule", "config": {"cron": "0 9 * * *"}}],
                                            "effects": [{"kind": "ask", "config": {"question": "How many orders?"}}]}))
    assert sched["lines"] == ["Name: Morning", "Runs: every day at 09:00 UTC", "Then: a question answered: “How many orders?”"]


def test_the_said_door_reads_one_staged_change(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from pramanyx.actions.inbox import StagedProposal, stage_proposal
    from pramanyx.routers import kinetic
    p = stage_proposal(StagedProposal(kind="brief_draft", connection_id="sheets", action_id="brief:Weekly",
                                      params={"name": "Weekly", "period": "week", "send_cron": "0 8 * * 1"},
                                      detail={"send_words": "every Monday at 08:00 UTC"}, reasoning="asked for a weekly brief"))
    app = FastAPI()
    app.include_router(kinetic.router)
    got = TestClient(app).get(f"/kinetic-actions/inbox/{p.id}/said")
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["asks"] == "Send this brief on a schedule?" and body["status"] == "pending"
    assert body["lines"] == ["Name: Weekly", "Sent: every Monday at 08:00 UTC"]
    assert TestClient(app).get("/kinetic-actions/inbox/nope/said").status_code == 404
