"""Governed fields that did nothing at answer time now count (the grounding audit, 2026-11-26): a metric's quality tests
are run and a failure said beside its figure; its "never this" examples are a check; its declared format shapes its
column; custom instructions reach the conversation and deep analyses, not only the quick path."""
from __future__ import annotations

import inspect
import uuid
from types import SimpleNamespace as NS

from pramanyx.agent import governed_metric as G


def test_a_failing_quality_test_is_said_and_run_at_most_once_a_day(monkeypatch):
    runs = []

    class _DB:
        def close(self):
            pass
    monkeypatch.setattr("pramanyx.db.connection.open_connection_for", lambda c: _DB())

    def validate(m, db):
        runs.append(m.name)
        return NS(results=[NS(test_sql="SELECT COUNT(*) = 0 FROM t WHERE x < 0", passed=False, error=None),
                           NS(test_sql="SELECT 1", passed=True, error=None)])
    monkeypatch.setattr("pramanyx.semantic.metrics.validate_metric", validate)
    m = NS(name="rev" + uuid.uuid4().hex[:6], quality_tests=["SELECT COUNT(*) = 0 FROM t WHERE x < 0", "SELECT 1"])
    said = G.quality_said(m, "c1")
    assert said == ["its quality test “SELECT COUNT(*) = 0 FROM t WHERE x < 0” failed"]
    assert G.quality_said(m, "c1") == said and len(runs) == 1, "kept for the day"
    assert G.quality_said(NS(name="x", quality_tests=[]), "c1") == []


def test_the_quick_path_checks_warned_forms_and_formats_the_governed_column():
    from pramanyx.routers import investigations as inv
    src = inspect.getsource(inv._answer_core)
    run = src.index("result = _execute_chat_sql(db, final_sql)")
    assert src.index("_warned_forms(final_sql)") < run, "a warned-against form is checked before the statement runs"
    assert "format_for(connection_id, f\"metric:{_governed.metric}\")" in src
    assert "_governed.quality" in src


def test_custom_instructions_reach_the_conversation_and_the_analyst(monkeypatch):
    monkeypatch.setattr("pramanyx.semantic.instructions.build_instructions_block",
                        lambda c, canvas_id="": "CUSTOM INSTRUCTIONS (user-authored…):\nNet of returns, always.\n")
    from pramanyx.agent.analyst import analyst_system_prompt
    from pramanyx.agent.converse_tools import converse_system_prompt
    assert "Net of returns, always." in converse_system_prompt("c1", question="revenue?")
    # the analyst is handed the one builder's block (`_run_analyst` → `extra`), as the conversation is
    from pramanyx.agent.grounding import build_grounding_context
    knowledge = build_grounding_context("revenue?", "c1").prompt()
    assert "Net of returns, always." in analyst_system_prompt("c1", {}, 10, extra=knowledge)
    import inspect

    from pramanyx.agent import analyst
    assert "build_grounding_context(" in inspect.getsource(analyst._run_analyst)
