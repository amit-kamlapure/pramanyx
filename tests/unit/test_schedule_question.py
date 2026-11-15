"""A question asked again on a rhythm runs on the platform, not in the coworker's shell (the coworker plan,
2026-11-15). The shell's own scheduler held a schedule that stopped when the shell did and that no one else saw; the
coworker now makes Pramanyx's own automation — a schedule trigger and one governed `investigate` step."""
from __future__ import annotations

import asyncio

from pramanyx.mcp.client import PramanyxClient


def _client(settings: dict):
    sent = {"gets": []}
    c = PramanyxClient(base_url="http://x")

    async def post(path, json_body=None, params=None):
        sent["path"], sent["body"] = path, json_body
        return {"id": "a1", "name": json_body["name"], "enabled": True, "probation": True}

    async def get(path, params=None):
        sent["gets"].append(path)
        if path.endswith("/schedule"):
            return {"said": ["Every Mon at 09:00 UTC"], "next_run": "2026-11-16T09:00:00Z", "timezone": "UTC"}
        return settings
    c._post, c._get = post, get
    return c, sent


def test_a_rhythm_becomes_an_automation_that_asks_the_governed_path():
    c, sent = _client({"timezone": ""})
    got = asyncio.run(c.schedule_question("revenue by category", "conn-1", "0 9 * * 1"))
    assert sent["path"] == "/automations"
    assert sent["body"]["conditions"] == [{"kind": "schedule", "config": {"cron": "0 9 * * 1"}}]
    assert sent["body"]["effects"] == [{"kind": "investigate", "config": {"question": "revenue by category"}}]
    assert sent["body"]["conn_id"] == "conn-1" and got["id"] == "a1" and "Agent Ops" in got["note"]
    # It starts at its first scheduled time, never at the moment it is made (the create door mutes it until then).
    assert sent["body"]["start_at_first_run"] is True
    # When, in words, and when next — as the platform reads the schedule, not as this client guesses it.
    assert got["when"] == "Every Mon at 09:00 UTC" and got["next_run"] == "2026-11-16T09:00:00Z"
    assert got["open"] == "/automations?conn=conn-1&focus=a1"


def test_it_claims_nothing_the_platform_does_not_do():
    """Its note once said "It will not run until an admin turns on scheduled model work". Measured 2026-11-15: no
    automation step reads that setting, so the schedule ran either way and the sentence was false."""
    c, _ = _client({"scheduled_model_work": None, "timezone": ""})
    got = asyncio.run(c.schedule_question("revenue by category", "conn-1", "0 9 * * 1"))
    assert "will not run" not in got["note"] and "scheduled model work" not in got["note"]


def test_its_times_are_read_in_the_clock_named_else_the_organisations():
    c, sent = _client({"timezone": "Asia/Kolkata"})
    asyncio.run(c.schedule_question("revenue by category", "conn-1", "0 9 * * 1"))
    assert sent["body"]["timezone"] == "Asia/Kolkata"            # the tool's words promised this and sent none
    c, sent = _client({"timezone": "Asia/Kolkata"})
    asyncio.run(c.schedule_question("revenue by category", "conn-1", "0 9 * * 1", timezone="Europe/Berlin"))
    assert sent["body"]["timezone"] == "Europe/Berlin" and "/org-settings" not in sent["gets"]
    c, sent = _client({"timezone": ""})
    asyncio.run(c.schedule_question("revenue by category", "conn-1", "0 9 * * 1"))
    assert "timezone" not in sent["body"]                        # neither names one: UTC, the door's own default


def test_once_and_every_n_are_recurrences_the_door_accepts():
    from pramanyx.routers.automations import CreateAutomationRequest
    c, sent = _client({"timezone": ""})
    # A model may write the line break as the two characters \n; the door is given two lines either way.
    asyncio.run(c.schedule_question("gmv by platform", "conn-1", "DTSTART:20261116T150000\\nRRULE:FREQ=DAILY;COUNT=1"))
    assert sent["body"]["conditions"][0]["config"]["cron"] == "DTSTART:20261116T150000\nRRULE:FREQ=DAILY;COUNT=1"
    CreateAutomationRequest(**sent["body"])                                     # raises on a recurrence that cannot be read


def test_the_body_it_sends_is_one_the_automation_door_accepts():
    from pramanyx.routers.automations import CreateAutomationRequest
    c, sent = _client({"timezone": ""})
    asyncio.run(c.schedule_question("revenue by category", "conn-1", "0 9 * * 1", name="Monday revenue"))
    CreateAutomationRequest(**sent["body"])                                     # raises on a malformed step


def test_the_coworker_no_longer_mounts_the_shells_scheduler():
    from pathlib import Path
    profile = (Path(__file__).resolve().parents[2] / "coworker" / "profile.patch.yml").read_text()
    assert "name: '@deepseek-ai/dsh-tool-schedule'" not in profile
    assert "schedule_question" in profile
    # …nor its scheduler at all, since 2026-11-15 (`test_one_scheduler`): one scheduler, the platform's.


def test_a_schedule_for_a_while_stops_on_its_own():
    c, sent = _client({"timezone": ""})
    asyncio.run(c.schedule_question("gmv by platform", "conn-1", "*/5 * * * *", stop_after_minutes=30))
    assert sent["body"]["expires_at"].endswith("Z")
    c, sent = _client({"timezone": ""})
    asyncio.run(c.schedule_question("gmv by platform", "conn-1", "*/5 * * * *"))
    assert "expires_at" not in sent["body"]
