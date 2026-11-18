"""Punch list 88 (2026-11-18): a deep analysis kept as a skill names the approved metrics it is held to, read by the
platform's one enforcement check from its SQL; a skill that computes an approved metric some other way is refused,
with which."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from pramanyx.memory import skills as S
from pramanyx.ontology.models import QueryTemplate


def _template(**over):
    base = dict(id="s1", display_name="Revenue by region last month", description="", entity="Order",
                action_type="aggregate", sql_template="SELECT region, SUM(sale_price) FROM orders GROUP BY 1",
                returns="rows", source_table="orders", origin="learned")
    return QueryTemplate(**{**base, **over})


def test_the_metrics_held_to_are_read_by_the_enforcement_check(monkeypatch):
    seen = {}

    def check(question, sql, metrics):
        seen["metrics"] = metrics
        return [{"metric": "revenue", "status": "used"}, {"metric": "margin", "status": "drift"}]
    monkeypatch.setattr("pramanyx.semantic.enforcement.check_metric_enforcement", check)
    monkeypatch.setattr("pramanyx.semantic.metrics.list_metrics", lambda connection_id=None: [f"metrics of {connection_id}"])
    assert S.held_to("revenue and margin", "SELECT …", "c1") == (["revenue"], ["margin"])
    assert seen["metrics"] == ["metrics of c1"]                      # only the connection's own metrics


def test_a_skill_computing_an_approved_metric_otherwise_is_refused_and_one_held_to_its_metrics_records_them(monkeypatch):
    from pramanyx.routers import ontology as O
    monkeypatch.setattr("pramanyx.govern.guard", lambda *a, **k: None)
    kept = {}
    monkeypatch.setattr("pramanyx.memory.skills.save_skill", lambda c, s, action, validator=None: kept.setdefault("a", action) or True)
    monkeypatch.setattr(O, "_skill_schema", lambda c, s: "public")
    monkeypatch.setattr("pramanyx.memory.skills.held_to", lambda q, sql, c="": ([], ["margin"]))
    with pytest.raises(HTTPException) as e:
        O.save_learned_skill(_template(), connection_id="c1")
    assert e.value.status_code == 422 and "computes margin otherwise than the approved definition" in e.value.detail
    assert "a" not in kept
    monkeypatch.setattr("pramanyx.memory.skills.held_to", lambda q, sql, c="": (["revenue"], []))
    out = O.save_learned_skill(_template(), connection_id="c1")
    assert out["metrics"] == ["revenue"] and kept["a"].metrics == ["revenue"]


def test_a_deep_analysis_is_kept_by_the_query_its_report_leads_with():
    """Found live 2026-11-18: a deep analysis keeps its queries in its report's phases and no finished one could be
    kept as a skill. The query behind the report's first exhibit is its method; else a significant finding's."""
    report = {"phases": [
        {"findings": [{"finding_id": "f0", "sql": "", "error": None},
                      {"finding_id": "f1", "sql": "SELECT day, SUM(x) FROM t GROUP BY 1", "error": None}]},
        {"findings": [{"finding_id": "f2", "sql": "SELECT region, SUM(x) FROM t GROUP BY 1", "is_significant": True},
                      {"finding_id": "f3", "sql": "SELECT broken", "error": "syntax"}]}],
        "exhibits": [{"finding_id": "f2"}, {"finding_id": "f1"}]}
    assert S._primary_sql({"report": report}) == "SELECT region, SUM(x) FROM t GROUP BY 1"
    report["exhibits"] = []
    assert S._primary_sql({"report": report}) == "SELECT region, SUM(x) FROM t GROUP BY 1"
    report["phases"][1]["findings"][0]["is_significant"] = False
    assert S._primary_sql({"report": report}) == "SELECT day, SUM(x) FROM t GROUP BY 1"
    assert S._primary_sql({"report": {"sql": "SELECT 1"}}) == "SELECT 1"
    assert S._primary_sql({"report": {"phases": []}}) == ""


def test_a_scheduled_run_is_kept_by_what_was_asked_not_by_the_context_it_ran_with(monkeypatch):
    """Found live 2026-11-18: a scheduled run's question starts with the code-written context it ran with, and the skill
    proposed from it was named "[Scheduled-run context — written by code, not inferred]…"."""
    from pramanyx.automations.temporal import OBSERVATION_HEADER
    asked = "Which product categories sold most yesterday?"
    inv = {"question": f"{OBSERVATION_HEADER}\nThis is a scheduled daily run; the most recent complete day is 2026-11-17.\n\n{asked}",
           "connection_id": "c1", "report": {"sql": "SELECT category, COUNT(*) FROM orders GROUP BY 1"}}
    monkeypatch.setattr("pramanyx.db.history.get_investigation", lambda _id: inv)
    monkeypatch.setattr(S, "held_to", lambda q, sql, c="": ([], []))
    out = S.propose_skill_from_investigation("inv-1")
    assert out is not None and out.display_name == asked and "Scheduled-run" not in out.returns
    inv["question"] = asked
    assert S.propose_skill_from_investigation("inv-1").display_name == asked
