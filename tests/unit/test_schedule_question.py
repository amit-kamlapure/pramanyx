"""A question asked again on a rhythm runs on the platform, not in the coworker's shell (the coworker plan,
2026-11-15). The shell's own scheduler held a schedule that stopped when the shell did and that no one else saw; the
coworker now makes Pramanyx's own automation — a schedule trigger and one governed `investigate` step."""
from __future__ import annotations

import asyncio

from pramanyx.mcp.client import PramanyxClient


def _client(settings: dict):
    sent = {}
    c = PramanyxClient(base_url="http://x")

    async def post(path, json_body=None, params=None):
        sent["path"], sent["body"] = path, json_body
        return {"id": "a1", "name": json_body["name"], "enabled": True, "probation": True}

    async def get(path, params=None):
        return settings
    c._post, c._get = post, get
    return c, sent


def test_a_rhythm_becomes_an_automation_that_asks_the_governed_path():
    c, sent = _client({"scheduled_model_work": True})
    got = asyncio.run(c.schedule_question("revenue by category", "conn-1", "0 9 * * 1"))
    assert sent["path"] == "/automations"
    assert sent["body"]["conditions"] == [{"kind": "schedule", "config": {"cron": "0 9 * * 1"}}]
    assert sent["body"]["effects"] == [{"kind": "investigate", "config": {"question": "revenue by category"}}]
    assert sent["body"]["conn_id"] == "conn-1" and got["id"] == "a1" and "Agent Ops" in got["note"]


def test_it_says_when_the_organisation_has_not_allowed_scheduled_model_work():
    c, _ = _client({"scheduled_model_work": None})
    got = asyncio.run(c.schedule_question("revenue by category", "conn-1", "0 9 * * 1"))
    assert "will not run until an admin turns on scheduled model work" in got["note"]


def test_the_body_it_sends_is_one_the_automation_door_accepts():
    from pramanyx.automations.models import Automation
    c, sent = _client({"scheduled_model_work": True})
    asyncio.run(c.schedule_question("revenue by category", "conn-1", "0 9 * * 1", name="Monday revenue"))
    Automation(**sent["body"])                                                  # raises on a malformed step


def test_the_coworker_no_longer_mounts_the_shells_scheduler():
    from pathlib import Path
    profile = (Path(__file__).resolve().parents[2] / "coworker" / "profile.patch.yml").read_text()
    assert "name: '@deepseek-ai/dsh-tool-schedule'" not in profile
    assert "schedule_question" in profile


def test_a_schedule_for_a_while_stops_on_its_own():
    c, sent = _client({"scheduled_model_work": True})
    asyncio.run(c.schedule_question("gmv by platform", "conn-1", "*/5 * * * *", stop_after_minutes=30))
    assert sent["body"]["expires_at"].endswith("Z")
    c, sent = _client({"scheduled_model_work": True})
    asyncio.run(c.schedule_question("gmv by platform", "conn-1", "*/5 * * * *"))
    assert "expires_at" not in sent["body"]
