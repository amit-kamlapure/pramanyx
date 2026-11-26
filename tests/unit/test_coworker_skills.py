"""The coworker's skills (2026-11-26, studied from LangChain's Persistent Agent and deepagents): its situational how-tos
— a schedule, helpers, an email, a memory — are `coworker/skills/<name>/SKILL.md`, listed to the model by name and
description and read when they fit, instead of paragraphs of its always-on prompt.

Held here: each skill is one the shell's provider will load (its name rule, its frontmatter); each tool a skill says it
governs (`metadata.reads-first`) is a tool the coworker really has, so the home plugin's "read the skill first" guard
gates something; each moved how-to lives in ONE place — its skill, not also the prompt; and the profile reads only
this checkout's skills, never the machine's shared `~/.agents/skills`."""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

COWORKER = Path(__file__).resolve().parents[2] / "coworker"
SKILLS = COWORKER / "skills"
#: The shell's rule for a skill's name (`@deepseek-ai/dsh-skill`, SKILL_NAME); a name outside it drops the skill.
SKILL_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
#: The shell's own tools a skill may govern (`profile.patch.yml`'s delegation group); every other is ours.
SHELL_TOOLS = {"subagent", "subagent_fork"}
#: Each skill, and words of the how-to that moved into it out of the Agent prompt.
MOVED = {
    "scheduling": "passing the person's sentence as the request COPIED EXACTLY",
    "helpers": "When a helper reports and others are still working, reply with the one word Waiting",
    "emailing": "You cannot send it, so never say it was sent",
}


class _Js(yaml.SafeLoader):
    """The profile's `!!js` values are the shell's to evaluate; here they are just text."""


_Js.add_multi_constructor("tag:yaml.org,2002:js", lambda loader, suffix, node: loader.construct_scalar(node))


def _skill(name: str) -> tuple[dict, str]:
    raw = (SKILLS / name / "SKILL.md").read_text()
    assert raw.startswith("---\n"), name
    head, body = raw[4:].split("\n---\n", 1)
    return yaml.safe_load(head), body


def _skills() -> list[str]:
    return sorted(p.name for p in SKILLS.iterdir() if (p / "SKILL.md").is_file())


def _agent_prompt() -> str:
    rows = yaml.load((COWORKER / "profile.patch.yml").read_text(), Loader=_Js)
    preset = next(r for r in rows if isinstance(r, dict) and r.get("id") == "preset-standard")
    # The Agent preset's prompt: the one plugin of the preset that carries a `prefix`.
    told = next(p for p in preset["config"]["plugins"] if "prefix" in (p.get("config") or {}))
    return " ".join(told["config"]["prefix"].split())


def test_there_are_skills_and_each_is_one_the_shell_loads():
    names = _skills()
    assert {"scheduling", "helpers", "emailing", "remembering"} <= set(names)
    for name in names:
        head, body = _skill(name)
        assert head["name"] == name and SKILL_NAME.match(name), name
        assert isinstance(head["description"], str) and 40 <= len(head["description"]) <= 500, name
        # The coworker's own how-tos: a person's slash menu does not offer them.
        assert head.get("user-invocable") is False, name
        assert body.strip(), name


def test_each_governed_tool_is_one_the_coworker_has():
    from pramanyx.mcp import server as S
    ours = set(S.mcp._tool_manager._tools)
    governed = {}
    for name in _skills():
        head, _ = _skill(name)
        for tool in str((head.get("metadata") or {}).get("reads-first", "")).split():
            assert tool not in governed, f"{tool} is governed by both {governed.get(tool)} and {name}"
            governed[tool] = name
            bare = tool.removeprefix("mcp__pramanyx__")
            assert (tool in SHELL_TOOLS) or (tool.startswith("mcp__pramanyx__") and bare in ours), tool
    assert governed == {
        "mcp__pramanyx__schedule": "scheduling", "subagent": "helpers", "subagent_fork": "helpers",
        "mcp__pramanyx__draft_email": "emailing", "mcp__pramanyx__remember_for_me": "remembering"}


@pytest.mark.parametrize("name,words", sorted(MOVED.items()))
def test_a_moved_how_to_lives_in_its_skill_alone(name, words):
    _, body = _skill(name)
    assert words in " ".join(body.split())
    assert words not in _agent_prompt(), f"{name}'s how-to is in the Agent prompt as well as its skill"


def test_the_prompt_keeps_what_every_turn_needs_and_points_at_the_skills():
    said = _agent_prompt()
    # Done only after its tool came back, and a helper's own brief: rules for every turn, not a situation.
    assert "Say a thing was done only after its tool came back saying so" in said
    assert "If you are a helper" in said
    assert "skills in your skill catalog" in said and "the helpers skill says when it is" in said


def test_the_profile_reads_only_this_checkouts_skills():
    rows = yaml.load((COWORKER / "profile.patch.yml").read_text(), Loader=_Js)
    preset = next(r for r in rows if isinstance(r, dict) and r.get("id") == "preset-standard")
    inside = next(p for p in preset["config"]["plugins"] if p.get("id") == "skill-filesystem")
    outside = next(r for r in rows if isinstance(r, dict) and r.get("id") == "skill-filesystem")
    for at in (inside, outside):
        assert at["config"]["includeDefaultRoots"] is False
        assert "PRAMANYX_COWORKER_SKILLS" in at["config"]["customSkillDirs"]
    assert 'PRAMANYX_COWORKER_SKILLS="${PRAMANYX_COWORKER_SKILLS:-$here/skills}"' in (COWORKER / "start.sh").read_text()


def test_the_scheduling_skill_offers_to_come_back_and_knows_events_as_well_as_times():
    head, body = _skill("scheduling")
    said = " ".join(body.split())
    assert "when it happens" in said and "Nothing is set up until they say yes" in said
    assert "when yesterday's orders land" in head["description"]
    # An event is a trigger the designer is offered: the palette's, named as AVAILABLE or not (`propose.py`).
    from pramanyx.automations.palette import entries
    kinds = {row["kind"] for row in entries()}
    assert {"source_change", "entity_appears", "finding_created"} <= kinds
