"""Anything on a schedule, from a sentence (2026-11-16). The user, after the agent shell's scheduler took "deliver me AI
related news in the next 5 minutes here": a sentence is the de-facto way to schedule anything; the model designs the
chain in the platform; a person can still design it by hand. The coworker's `schedule` passes the person's words to the
platform's own designer (`POST /automations/propose`) and makes what it drafts — unless the draft left a choice open."""
from __future__ import annotations

import asyncio

from pramanyx.mcp.client import PramanyxClient

DRAFT = {"conn_id": "conn-1", "name": "AI news in five minutes", "timezone": "Asia/Kolkata",
         "conditions": [{"kind": "schedule", "config": {"cron": "DTSTART:20261116T115800\nRRULE:FREQ=DAILY;COUNT=1"}}],
         "effects": [{"kind": "investigate", "config": {"question": "gmv by platform"}}]}


def _client(proposal: dict, settings: dict | None = None):
    sent = {"posts": [], "gets": []}
    c = PramanyxClient(base_url="http://x")

    async def post(path, json_body=None, params=None):
        sent["posts"].append((path, json_body))
        if path == "/automations/propose":
            return proposal
        return {"id": "a1", "name": json_body["name"], "enabled": True, "probation": True}

    async def get(path, params=None):
        sent["gets"].append(path)
        if path.endswith("/schedule"):
            return {"said": ["Once, on Mon 16 Nov 2026 at 11:58 Asia/Kolkata"], "next_run": "2026-11-16T06:28:00Z",
                    "timezone": "Asia/Kolkata"}
        return settings or {"timezone": ""}
    c._post, c._get = post, get
    return c, sent


def test_the_persons_words_go_to_the_platforms_designer_and_what_it_draws_is_made():
    c, sent = _client({"verdict": "proposed", "draft": DRAFT, "to_fill": [], "notes": ""})
    got = asyncio.run(c.schedule("in five minutes, GMV by platform, here", "conn-1", "Asia/Kolkata"))
    (path, asked), (made_at, made) = sent["posts"]
    assert path == "/automations/propose" and asked == {"outcome": "in five minutes, GMV by platform, here",
                                                       "conn_id": "conn-1", "timezone": "Asia/Kolkata",
                                                       "clock_here": "", "from_conversation": True}
    assert made_at == "/automations" and made["conditions"] == DRAFT["conditions"] and made["start_at_first_run"] is True
    assert got["scheduled"] is True and got["when"].startswith("Once, on Mon 16 Nov 2026")
    assert got["steps"] == ["investigate"] and got["open"] == "/automations?conn=conn-1&focus=a1"


def test_a_choice_the_request_left_open_is_asked_never_guessed_and_nothing_is_made():
    c, sent = _client({"verdict": "proposed", "draft": DRAFT, "notes": "",
                       "to_fill": ["Action 2 needs a Slack channel — the request names no Slack channel"]})
    got = asyncio.run(c.schedule("every Monday post GMV to Slack", "conn-1"))
    assert got["scheduled"] is False and "Slack channel" in got["needs"][0]
    assert [p for p, _ in sent["posts"]] == ["/automations/propose"]


def test_a_request_nothing_here_can_do_says_why_and_nothing_is_made():
    c, sent = _client({"verdict": "refused", "reason": "nothing on this deployment can search the web", "notes": ""})
    got = asyncio.run(c.schedule("deliver me AI news every morning", "conn-1"))
    assert got == {"scheduled": False, "reason": "nothing on this deployment can search the web", "notes": ""}
    assert [p for p, _ in sent["posts"]] == ["/automations/propose"]


def test_the_zone_named_and_the_browsers_go_to_the_designer_which_decides_between_them():
    """The user, 2026-11-16: "Yes, my clock". The shell tells the agent the browser's zone on every message; the
    agent passes it apart from a zone the person named, and the platform's order decides (`the_clock`)."""
    c, sent = _client({"verdict": "refused", "reason": "x"})
    asyncio.run(c.schedule("at nine", "conn-1", browser_time_zone="Asia/Kolkata"))
    assert sent["posts"][0][1]["timezone"] == "" and sent["posts"][0][1]["clock_here"] == "Asia/Kolkata"
    c, sent = _client({"verdict": "refused", "reason": "x"})
    asyncio.run(c.schedule("at nine London time", "conn-1", "Europe/London", "Asia/Kolkata"))
    assert sent["posts"][0][1]["timezone"] == "Europe/London" and sent["posts"][0][1]["clock_here"] == "Asia/Kolkata"
    assert sent["gets"] == []                                    # the client no longer reads the org's clock itself


def test_what_it_makes_is_one_the_automation_door_accepts():
    from pramanyx.routers.automations import CreateAutomationRequest
    c, sent = _client({"verdict": "proposed", "draft": DRAFT, "to_fill": [], "notes": ""})
    asyncio.run(c.schedule("in five minutes, GMV by platform", "conn-1"))
    CreateAutomationRequest(**sent["posts"][1][1])                               # raises on a malformed chain


def test_the_coworker_mounts_no_scheduler_of_its_own_and_tells_its_agent_to_use_this_one():
    from pathlib import Path
    profile = (Path(__file__).resolve().parents[2] / "coworker" / "profile.patch.yml").read_text()
    assert "name: '@deepseek-ai/dsh-tool-schedule'" not in profile
    assert "schedule_question" not in profile and "with schedule," in profile
