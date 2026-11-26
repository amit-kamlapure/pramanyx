"""What people wrote about columns reaches the SQL writer beside the Data Catalog (the grounding audit, 2026-11-26: the
catalog replaced the annotated schema and only relationships were put back)."""
from __future__ import annotations

from types import SimpleNamespace as NS

from pramanyx.semantic import glossary as G


def test_a_columns_notes_and_what_empty_means_are_said(monkeypatch):
    monkeypatch.setattr(G, "load_merged_glossary", lambda path=None, connection_id=None: {"tables": {
        "orders": {"description": "One row per order", "columns": {
            "status": {"description": "Where the order is", "values": "Complete, Cancelled", "caveats": "Returned counts as Complete"}}}}})
    graph = NS(entities={"order": NS(source_tables=["thelook.orders"], properties={
        "shipped_at": NS(null_meaning="not shipped yet"), "status": NS(null_meaning="")})})
    notes = G.column_notes(["thelook.orders"], "c1", graph=graph)
    assert "- orders: One row per order" in notes
    assert "- orders.status: Where the order is | values: Complete, Cancelled | ⚠ Returned counts as Complete" in notes
    assert "- orders.shipped_at: an empty value means not shipped yet" in notes
    assert G.column_notes(["users"], "c1", graph=graph) == ""


def test_the_quick_path_puts_the_declared_filters_on_its_statement_before_it_runs():
    """The grounding audit, 2026-11-26: the quick core ran its statement through its own door, never the shared
    executor that applies a declared metric's filters — revenue could include cancelled lines under a governed badge."""
    import inspect

    from pramanyx.routers import investigations as inv
    src = inspect.getsource(inv._answer_core)
    guard, run = src.index("enforce_metric_filters(final_sql"), src.index("result = _execute_chat_sql(db, final_sql)")
    assert guard < run, "the declared filters go on before the statement runs"
