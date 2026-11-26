"""One list of abilities for the coworker's two places (Stage 2 of "one coworker, two places", 2026-11-20).

`pramanyx/abilities.py` says what each ability is, where it is offered and how it is allowed. These hold it to what each
place really serves — the Ask panel's tools as a turn builds them, the coworker's as the MCP server lists them — so a
tool cannot be added in one place without a row, nor a row claim a place that does not offer it, and the approval rule
is one rule.
"""
from __future__ import annotations

import pytest

from pramanyx import abilities as A


@pytest.fixture(scope="module")
def served() -> dict[str, set[str]]:
    from pramanyx.agent.converse_tools import converse_tools
    from pramanyx.agent.spotlight_roster import spotlight_roster
    from pramanyx.mcp import server
    from pramanyx.mcp.server import GROUNDING_TOOL
    plain = {t.name for t in converse_tools("fixture")}
    # a question beside a sheet, and about one chart of a dashboard the person keeps, adds the tools for those
    beside = {t.name for t in converse_tools("fixture", sheet="s1", dashboard=("ana", "ops", "c1"), person="ana")}
    spotlight = {t.name for t in spotlight_roster("fixture")}
    mcp_static = {t.name for t in server.mcp._tool_manager.list_tools()}
    return {"panel": plain | beside, "panel_always": plain, "spotlight": spotlight, "mcp_static": mcp_static,
            "coworker": mcp_static | spotlight | {GROUNDING_TOOL}}


def test_every_tool_the_panel_offers_has_a_row_and_every_row_there_is_offered(served):
    unlisted = {n for n in served["panel"] if A.PANEL not in getattr(A.ABILITIES.get(n), "places", ())}
    assert not unlisted, f"offered in the Ask panel with no row saying so: {sorted(unlisted)}"
    claimed = {a.name for a in A.ABILITIES.values() if A.PANEL in a.places}
    # a row offered only in some turns says when; the rest are offered in every turn
    assert {n for n in claimed - served["panel"] if not A.ABILITIES[n].only_when} == set()
    assert {n for n in served["panel"] - served["panel_always"]} <= {a.name for a in A.ABILITIES.values() if a.only_when}


def test_a_row_offered_only_in_some_turns_is_declared_by_the_panels_own_tools():
    from pathlib import Path
    agent = Path(__file__).resolve().parents[2] / "pramanyx"
    source = "".join(p.read_text() for p in [agent / "agent" / "delegate_tool.py", agent / "agent" / "action_tools.py"])
    for name in ("delegate_task", "propose_action"):
        assert f'name="{name}"' in source or f"'{name}'" in source or f'"{name}"' in source


def test_every_tool_the_coworker_offers_has_a_row_and_every_row_there_is_offered(served):
    claimed = {a.name for a in A.ABILITIES.values() if A.COWORKER in a.places}
    assert served["coworker"] - claimed == set(), "offered to the coworker with no row saying so"
    assert claimed - served["coworker"] == set(), "a row says the coworker offers what it does not"


def test_what_each_needs_is_what_the_agent_policy_gates_on(served):
    from pramanyx.mcp import policy
    for name, level in policy.TOOL_LEVELS.items():
        assert A.ABILITIES[name].needs == level, name
    for name in served["spotlight"]:
        assert A.ABILITIES[name].needs == policy.spotlight_tool_level(name), name
    assert A.ABILITIES["ground_agent"].needs == "read"


def test_what_is_written_twice_is_said(served):
    # offered in both places, and not from the one roster both are served from
    assert {a.name for a in A.ABILITIES.values() if a.places == A.BOTH} - served["spotlight"] == A.DECLARED_IN_EACH_PLACE
    assert A.DECLARED_IN_EACH_PLACE <= served["mcp_static"] and A.DECLARED_IN_EACH_PLACE <= served["panel_always"]


def test_one_rule_says_how_each_is_allowed():
    by = {a.name: A.allowed(a) for a in A.ABILITIES.values()}
    # a read goes ahead
    assert all(by[a.name] == "goes_ahead" for a in A.ABILITIES.values() if a.needs == "read")
    # a change that is staged is allowed on its card, once
    assert {n for n, how in by.items() if how == "staged"} == {
        "change_dashboard", "change_chart", "make_dashboard", "propose_action", "draft_agent", "draft_automation", "edit_automation",
        "draft_monitor", "draft_brief", "pause_or_resume_automation", "set_agent_limit", "propose_agent_grant"}
    assert all(A.ABILITIES[n].needs == "act" for n, how in by.items() if how == "staged")
    # what spends or changes otherwise asks once, unless a reason a reader can check says it goes ahead
    assert {n for n, how in by.items() if how == "asks_once"} == {
        "explore", "post_claim", "schedule", "cancel_job", "draft_definition", "remember_for_me", "forget_for_me",
        "forget_everything_about_me"}
    for name, why in A.GOES_AHEAD_BECAUSE.items():
        assert A.ABILITIES[name].needs in ("run", "act") and why, f"{name}: a reason for a read is a stale reason"
    assert A.allowed_of("an_automation_nobody_listed") == "asks_once"


def test_the_coworker_goes_ahead_with_what_it_did_and_now_also_to_a_staged_card():
    """The coworker's own list until 2026-11-20 (its browser-side `OWN_WORK`), moved here whole: the one rule allows the
    same, and adds the staged changes, whose card now asks (the user's choice), and the person's own cosmetic setting."""
    was = {"list_connections", "get_metric", "get_definitions", "read_learned", "my_memories", "list_findings",
           "get_investigation", "search_graph", "describe_entity", "list_objects", "get_table_health",
           "list_trusted_queries", "list_jobs", "get_job", "list_runs", "inspect_run", "read_run_span", "read_contract",
           "read_claims", "read_restatements", "ground_agent", "list_platform_connections", "platform_usage",
           "platform_limits", "review_missed_move", "platform_runs", "investigation_cadence", "answer_accuracy",
           "table_popularity", "platform_traces", "platform_premortem", "platform_audit", "get_object", "explain",
           "platform_guide", "ask", "deep_analysis", "get_briefing", "search_my_drive", "search_the_web",
           "deck_of_answers", "draft_email", "bring_in_file"}
    now = {a.name for a in A.ABILITIES.values() if A.COWORKER in a.places and A.allowed(a) != "asks_once"}
    assert now - was == {"set_preference", "draft_agent", "draft_automation", "edit_automation", "draft_monitor",
                         "draft_brief", "pause_or_resume_automation", "set_agent_limit", "propose_agent_grant",
                         # the Areas of the business (the Atlas plan's A8): reads, so they go ahead
                         "list_areas", "describe_area"}
    assert was - now == set()


def test_the_rows_are_served_as_one_list_with_where_the_places_differ():
    rows = {r["name"]: r for r in A.as_rows()}
    assert rows["change_chart"]["allowed"] == "staged" and rows["change_chart"]["places"] == ["panel"]
    assert rows["bring_in_file"]["why"].startswith("the person attaching the file")
    assert rows["remember_for_me"]["about_to"] == "Remember for you" and rows["list_tables"]["about_to"] == "Read the tables there are"
    p = A.parity()
    assert "change_chart" in p["panel_only"] and "remember_for_me" in p["coworker_only"] and "draft_monitor" in p["both"]
    assert ["answer_question", "ask"] in [list(x) for x in p["same_work_two_names"]]


def test_both_places_read_the_rows_from_one_door():
    from fastapi.testclient import TestClient

    from pramanyx.api import app
    got = TestClient(app).get("/abilities")
    assert got.status_code == 200
    body = got.json()
    assert {r["name"] for r in body["abilities"]} == set(A.ABILITIES)
    assert body["parity"]["approval"]["staged"] and body["families"][0]["family"] == "ask_<agent>"


def _js_object(source: str, name: str) -> str:
    import re
    m = re.search(rf"(?:export )?const {name}[^=]*= \{{(.*?)\n\}};", source, re.S)
    assert m, name
    return m.group(1)


def test_the_coworkers_step_words_and_staged_list_are_the_rows():
    import re
    from pathlib import Path
    steps = (Path(__file__).resolve().parents[2] / "coworker" / "plugins" / "answer-card" / "src" / "steps.js").read_text()
    does = dict(re.findall(r'^\s*([a-z_]+): \["([^"]+)"', _js_object(steps, "DOES"), re.M))
    for name, words in does.items():
        if name in A.ABILITIES:
            assert A.ABILITIES[name].words == words, f"{name}: the coworker says “{words}”, the rows “{A.ABILITIES[name].words}”"
    assert {n for n, a in A.ABILITIES.items() if A.COWORKER in a.places} - set(does) <= {"ask"}, "a coworker ability with no step words"
    about = dict(re.findall(r'^\s*([a-z_]+): "([^"]+)"', _js_object(steps, "ABOUT_TO"), re.M))
    for name, words in about.items():
        if name in A.ABILITIES:
            assert A.ABILITIES[name].about_to == words, name
    staged = set(re.findall(r'"([a-z_]+)"', re.search(r"export const STAGED = new Set\(\[(.*?)\]\);", steps, re.S).group(1)))
    assert staged == {n for n, a in A.ABILITIES.items() if A.allowed(a) == "staged" and A.COWORKER in a.places}


def test_the_panels_step_words_are_the_rows():
    import re
    from pathlib import Path
    trail = (Path(__file__).resolve().parents[2] / "web" / "components" / "ToolTrail.tsx").read_text()
    said = dict(re.findall(r'^\s*([a-z_]+): "([^"]+)"', _js_object(trail, "TOOL_LABEL"), re.M))
    assert {n for n, a in A.ABILITIES.items() if A.PANEL in a.places} == set(said), "every panel ability has its words, and only those"
    for name, words in said.items():
        assert A.ABILITIES[name].words == words, f"{name}: the panel says “{words}”, the rows “{A.ABILITIES[name].words}”"


def test_a_change_staged_over_mcp_is_said_as_waiting_for_the_persons_allow_never_by_its_id():
    import asyncio

    from pramanyx.mcp import server

    class Door:
        async def call_spotlight_tool(self, name, *, connection="", args=None):
            return {"tool": name, "result": {"staged": True, "proposal_id": "p-1", "summary": "staged (proposal p-1)"}}

    out = asyncio.run(server._spotlight_runner(Door(), "draft_monitor")(connection="sheets", name="x"))
    assert out["next"] == server.STAGED_NEXT and "Never name it by its id" in out["next"]
    assert out["result"]["proposal_id"] == "p-1"          # the card reads it; the person never does

    class Read(Door):
        async def call_spotlight_tool(self, name, *, connection="", args=None):
            return {"tool": name, "result": {"rows": []}}

    assert "next" not in asyncio.run(server._spotlight_runner(Read(), "platform_usage")())
