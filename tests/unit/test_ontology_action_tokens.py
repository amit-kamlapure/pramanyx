"""An ontology action called by name — ``ACTION:<id>()``, which the ontology block every schema carries offers — runs
as its verified template (2026-11-27). Only the retired graph's planner expanded the tokens; a statement written with
one since then reached the warehouse as written and failed."""
from __future__ import annotations

from types import SimpleNamespace as NS

from pramanyx.ontology import actions as A

_ACTION = NS(display_name="Active customers", sql_template="SELECT id FROM customers WHERE active",
             business_rules_enforced=["active only"])
_GRAPH = NS(actions={"active_customers": _ACTION})


def test_a_named_action_becomes_its_template(monkeypatch):
    monkeypatch.setattr("pramanyx.ontology.store.load_latest_ontology", lambda conn, *a, **k: _GRAPH)
    sql, notes = A.expand_for("SELECT COUNT(*) FROM ACTION:active_customers() t", "c1")
    assert sql == "SELECT COUNT(*) FROM (SELECT id FROM customers WHERE active) t"
    assert notes and "Active customers" in notes[0]


def test_a_statement_with_no_token_is_untouched_and_reads_no_ontology(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("the ontology is read only for a statement that names an action")
    monkeypatch.setattr("pramanyx.ontology.store.load_latest_ontology", boom)
    assert A.expand_for("SELECT 1", "c1") == ("SELECT 1", [])


def test_both_places_model_sql_runs_expand_tokens_first():
    import inspect

    from pramanyx.agent import converse_tools
    from pramanyx.routers import investigations as inv
    run_sql = inspect.getsource(converse_tools.run_sql)
    assert run_sql.index("expand_for(sql, connection_id)") < run_sql.index("execute_guarded(")
    core = inspect.getsource(inv._answer_core)
    assert core.index("_expand_actions(final_sql, connection_id)") < core.index("result = _execute_chat_sql(db, final_sql)")
