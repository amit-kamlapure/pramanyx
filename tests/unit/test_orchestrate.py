"""How the Ask panel works a request of several parts (Stage 4 of "one coworker, two places", 2026-11-20): a plan shown
and kept, helpers answering side by side, and a new dashboard handed off to the dashboard drafter and staged."""
from __future__ import annotations

import threading

from pramanyx.agent.orchestrate import helpers_tool, plan_steps, plan_tool
from pramanyx.dashboards.chat_change import new_dashboard_tools


def test_a_plan_is_shown_to_the_person_and_says_what_is_left():
    frames: list = []
    tool = plan_tool(lambda kind, payload: frames.append((kind, payload)))
    out = tool.run({"steps": [{"text": "Find out why revenue dropped", "done": True},
                              {"text": " Draft a   monitoring dashboard "}, {"text": "Set an alert for the team"}, {"text": ""}]})
    assert frames == [("plan", {"steps": [{"text": "Find out why revenue dropped", "done": True},
                                          {"text": "Draft a monitoring dashboard", "done": False},
                                          {"text": "Set an alert for the team", "done": False}]})]
    assert out["steps_left"] == ["Draft a monitoring dashboard", "Set an alert for the team"]
    assert "staged for their Allow — is done once it is staged" in out["next"]
    done = tool.run({"steps": [{"text": "a", "done": True}]})
    assert done["steps_left"] == [] and done["next"].startswith("Every step is done")
    assert tool.run({"steps": []})["shown"] is False
    assert len(plan_steps({"steps": [{"text": str(i)} for i in range(20)]})) == 8


def test_helpers_answer_side_by_side_as_the_person_and_one_failure_is_its_own_answer():
    from pramanyx.org.context import current_user_id, reset_user_id, set_user_id
    seen: list = []
    ready = threading.Barrier(2, timeout=5)

    def answer(connection_id, args, **kw):
        seen.append((args["question"], current_user_id(), kw["emit"]))
        ready.wait()                                   # both are asked before either answers: side by side
        if "fail" in args["question"]:
            raise RuntimeError("the warehouse said no")
        return {"headline": f"Answer to {args['question']}", "row_count": 3}

    token = set_user_id("ana")
    try:
        out = helpers_tool("sheets", answer=answer).run({"questions": ["Revenue by state", "Revenue by fail"]})
    finally:
        reset_user_id(token)
    assert out["answered"] is True
    assert out["answers"][0] == {"question": "Revenue by state", "answer": "Answer to Revenue by state", "rows": 3}
    assert out["answers"][1]["error"].startswith("RuntimeError")
    assert {who for _, who, _ in seen} == {"ana"} and {emit for _, _, emit in seen} == {None}
    assert helpers_tool("sheets", answer=answer).run({"questions": ["only one"]})["answered"] is False


def test_a_new_dashboard_is_handed_to_the_drafter_and_staged_for_the_persons_allow():
    from types import SimpleNamespace
    asked: list = []
    frames: list = []

    def draft(connection_id, person, about, *, schema=None, hear=None):
        asked.append((connection_id, person, about))
        hear({"type": "read", "metrics": 2, "trusted_queries": 1, "findings": 0})
        return {"staged": True, "proposal_id": "p-9"}

    record = lambda pid: SimpleNamespace(id=pid, kind="draft", connection_id="sheets", action_id="dashboard:revenue")
    tools = new_dashboard_tools("sheets", "ana", emit=lambda k, p: frames.append((k, p)), draft=draft, record=record)
    assert [t.name for t in tools] == ["make_dashboard"]
    out = tools[0].run({"about": "revenue day by day and what moves it"})
    assert asked == [("sheets", "ana", "revenue day by day and what moves it")]
    assert out["staged"] is True and "Never name it by an id" in out["next"] and "p-9" not in str(out)
    assert [k for k, _ in frames] == ["status", "proposal_staged"]
    refused = new_dashboard_tools("sheets", "ana", draft=lambda *a, **k: {"staged": False, "sentences": ["No metric here."]})[0]
    assert refused.run({"about": "x"}) == {"staged": False, "said": ["No metric here."],
                                           "next": "Nothing was staged. Tell the person why, in these words."}
    assert new_dashboard_tools("sheets", "") == []


def test_a_request_of_several_parts_is_said_to_be_one_with_the_ability_for_each_part():
    from pramanyx.agent.orchestrate import parts_note, parts_of
    asked = "Our revenue dropped yesterday. Investigate why, create a monitoring dashboard, and notify the team if it happens again."
    assert [kind for kind, _ in parts_of(asked)] == ["why", "dashboard", "alert"]
    note = parts_note(asked)
    assert note.startswith("## This request has several parts") and "Write the plan first (plan)" in note
    assert "- a new dashboard: make_dashboard" in note and "- an alert for when it happens again: draft_monitor" in note
    # one question needs no plan
    assert parts_of("Why did revenue drop yesterday?") == [] and parts_note("How many orders were delivered?") == ""
    assert [k for k, _ in parts_of("Build me a sales dashboard and alert me if orders fall")] == ["dashboard", "alert"]


def test_the_conversation_is_told_a_request_has_parts(monkeypatch):
    import asyncio
    import json
    import types

    import pramanyx.routers.investigations as inv
    seen: dict = {}
    monkeypatch.setattr(inv, "build_history_section", lambda h: "")
    monkeypatch.setattr(inv, "build_prior_answers_section", lambda a: "")
    monkeypatch.setattr(inv, "resolve_prior_answers", lambda *a, **k: [])
    monkeypatch.setattr("pramanyx.agent.converse_tools.ground_answer_numbers", lambda answer, rows, question="": (answer, None))

    def converse(*a, **k):
        seen.update(k)
        return types.SimpleNamespace(answer="Planned.", steps=[], stop_reason="answered", injected_chars=0, reinjection_ratio=0.0)

    monkeypatch.setattr("pramanyx.agent.converse_tools.converse", converse)

    async def go(q):
        return [json.loads(c.split("data: ", 1)[1]) async for c in inv._stream_converse(q, "fixture", [], session_id="p-1")
                if c.startswith("data: ")]
    asyncio.run(go("Investigate why revenue fell and create a dashboard for it"))
    assert seen["extra_context"].startswith("## This request has several parts")
    asyncio.run(go("How many orders?"))
    assert "several parts" not in (seen["extra_context"] or "")


def test_a_request_of_several_parts_has_room_for_each_and_a_single_question_keeps_the_models_budget(monkeypatch):
    from types import SimpleNamespace

    import pramanyx.llm.profile as profile
    from pramanyx.agent.orchestrate import STEPS_PER_PART, steps_for
    monkeypatch.setattr(profile, "profile_for", lambda role: SimpleNamespace(tool_loop_steps=8))
    coder = SimpleNamespace(role="coder")
    asked = "Our revenue dropped yesterday. Investigate why, create a monitoring dashboard, and notify the team if it happens again."
    assert steps_for(asked, coder) == 8 + 2 * STEPS_PER_PART
    assert steps_for("Why did revenue drop?", coder) is None


def test_what_the_queries_found_goes_on_with_the_turn():
    from pramanyx.agent.orchestrate import found_lines, parts_note
    results = [{"sql": {"sql": "SELECT day,\n SUM(paid) AS revenue FROM o GROUP BY 1"}, "columns": {"columns": ["day", "revenue"]},
                "rows": {"rows": [["2018-10-16", 1234.5], ["2018-10-17", 99.0]]}},
               {"sql": {"sql": "SELECT 1"}}]
    assert found_lines(results) == ['1. SELECT day, SUM(paid) AS revenue FROM o GROUP BY 1 → 2 rows; first: {"day": "2018-10-16", "revenue": 1234.5}',
                                    "2. SELECT 1 → 0 rows"]
    assert "do not work it out by hand with queries" in parts_note("Investigate why sales fell and create a dashboard")
