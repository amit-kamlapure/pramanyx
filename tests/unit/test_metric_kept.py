"""The conversation hands the answer pipeline its own wording; when the person named an approved metric and that
wording no longer does, the person's words are answered (2026-11-26: "Order Fulfilment: placed to shipped", a share,
was answered as "average dispatch lag" in days)."""
from __future__ import annotations

from types import SimpleNamespace as NS

from pramanyx.agent.converse_tools import metric_kept


def test_the_persons_named_metric_is_kept(monkeypatch):
    shipped = NS(name="placed_to_shipped", status="approved")
    monkeypatch.setattr("pramanyx.semantic.metrics.metrics_named_in",
                        lambda q, c, schema_name=None: [shipped] if "placed to shipped" in q.lower() else [])
    said = "What was Order Fulfilment: placed to shipped over the last 30 days?"
    assert metric_kept("What was the average dispatch lag in the last 30 days?", said, "c") == said
    assert metric_kept("Placed to shipped share, last 30 days", said, "c") == "Placed to shipped share, last 30 days"
    assert metric_kept("revenue by region", "revenue by region please", "c") == "revenue by region", "no metric named"
    assert metric_kept("x", "", "c") == "x"


def test_the_conversation_is_told_a_named_approved_metric_is_present_and_governed(monkeypatch):
    from pramanyx.agent.converse_tools import governed_metric_note
    monkeypatch.setattr("pramanyx.semantic.metrics.metrics_named_in",
                        lambda q, c, schema_name=None: [NS(name="cogs_per_unit", label="COGS per Unit", status="approved")])
    monkeypatch.setattr("pramanyx.evals.metric_bar.offered", lambda c: False)
    assert governed_metric_note("What was COGS per Unit?", "c") == "", "not where the bar is not met"
    monkeypatch.setattr("pramanyx.evals.metric_bar.offered", lambda c: True)
    note = governed_metric_note("What was COGS per Unit?", "c")
    assert "“COGS per Unit”" in note and "present here" in note and "answer_question" in note
