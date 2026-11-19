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
