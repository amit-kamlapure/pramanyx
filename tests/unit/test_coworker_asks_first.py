"""The coworker goes ahead only with what the platform itself calls harmless. The list it goes ahead with lives in its browser-side
plugin, so this holds that list against the platform's own account of what each tool does."""
from __future__ import annotations

import re
from pathlib import Path

from pramanyx.mcp import policy

HOME = Path(__file__).resolve().parents[2] / "coworker" / "plugins" / "home" / "lib" / "index.js"


def _own_work() -> set[str]:
    block = re.search(r"const OWN_WORK = new Set\(\[(.*?)\]\);", HOME.read_text(), re.S)
    assert block, "the coworker's list of what goes ahead was not found"
    return set(re.findall(r'"([a-z_]+)"', block.group(1)))


def test_nothing_that_changes_something_goes_ahead_without_asking():
    acts = {name for name, level in policy.TOOL_LEVELS.items() if level == "act"} | set(policy.SPOTLIGHT_ACT_TOOLS)
    # a file the person attached becomes their own private sheet: the attaching was the asking
    assert _own_work() & acts == {"bring_in_file"}


def test_what_books_an_entry_or_crawls_the_warehouse_is_asked_about():
    assert not _own_work() & {"post_claim", "explore", "schedule"}


def test_every_tool_on_the_list_is_one_the_platform_has():
    known = set(policy.TOOL_LEVELS) | {"ground_agent", "list_platform_connections", "platform_usage", "platform_limits", "review_missed_move",
                                       "platform_runs", "investigation_cadence", "answer_accuracy", "table_popularity", "platform_traces",
                                       "platform_premortem", "platform_audit", "get_object", "explain", "platform_guide"}
    assert _own_work() <= known
