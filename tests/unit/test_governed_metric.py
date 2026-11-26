"""The metric engine where answers are made (2026-11-26): the bar found `query_metric` offered to the conversation and
called on none of theLook's nine questions — the answer core writes its SQL in one shot. A question naming a governed
metric now hands that core the metric compiled for it, where the bar is met; whether the answer started from it is
said, so the bar counts it.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import pytest

from pramanyx.agent import governed_metric as G
from pramanyx.evals import metric_bar as B
from pramanyx.ontology.models import OntologyGraph
from pramanyx.semantic.metrics import MetricDefinition, save_metric
from tests.unit.test_object_bindings import GRAPH

DIMS = [{"path": "status", "via": ""}, {"path": "quantity", "via": ""}, {"path": "order.status", "via": "order"},
        {"path": "order.customer_id", "via": "order"}, {"path": "product.category", "via": "product"}]


@pytest.mark.parametrize("question, want", [
    ("Revenue by status?", ["status"]),
    ("Revenue for each product category", ["product.category"]),
    ("What was revenue last month?", []),
    ("Revenue in Complete status", []),
    ("Revenue by category and status", ["status", "product.category"]),
])
def test_a_breakdown_is_read_only_when_asked_and_by_dimensions_whose_words_are_named(question, want):
    assert G.dimensions_asked(question, DIMS) == want


def test_a_grain_is_read_from_its_words():
    assert (G.grain_asked("revenue by month"), G.grain_asked("monthly orders"), G.grain_asked("revenue")) == ("month", "month", None)


@pytest.fixture
def conn(tmp_path, monkeypatch):
    path = tmp_path / "metrics.json"
    path.write_text("[]")
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(path))
    c = "gm" + uuid.uuid4().hex[:6]
    save_metric(MetricDefinition(name="order_revenue", label="Order revenue", connection=c, source="orders",
                                 measure="SUM(total_amount)", filters=["status <> 'cancelled'"], time_column="orders.order_date",
                                 sql="SELECT 1", status="approved"))
    save_metric(MetricDefinition(name="whole", label="Whole thing", connection=c, sql="SELECT 1 FROM a JOIN b ON 1 = 1"))
    graph = OntologyGraph.model_validate(json.loads(GRAPH.read_text()))
    monkeypatch.setattr("pramanyx.routers.ontology.served_ontology_graph", lambda cid, s=None: graph)
    return c


def test_it_is_offered_only_where_the_bar_is_met_and_compiles_what_the_question_names(conn, monkeypatch):
    assert G.reference("What was order revenue by status?", conn) is None, "never measured: never offered"
    monkeypatch.setattr("pramanyx.kernel.clock.person_clock", lambda *a, **k: "UTC")
    with B.offering(True):
        ref = G.reference("What was order revenue by payment method over the last 7 days?", conn)
        assert G.reference("What was the whole thing?", conn) is None, "a draft is not governed"
        assert G.reference("How many customers?", conn) is None, "no governed metric named"
    assert ref is not None and ref.metric == "order_revenue" and ref.by == ["payment_method"]
    assert ref.start and ref.end and ref.end == datetime.now(timezone.utc).date().isoformat(), "the last 7 days end today, exclusive"
    assert "status <> 'cancelled'" in ref.sql and "AS order_revenue" in ref.sql
    assert "GOVERNED METRIC QUERY" in ref.prompt() and "Never re-derive" in ref.prompt()
    assert "A period is counted by orders.order_date" in ref.prompt() and "whatever its name suggests" in ref.prompt()
    assert ref.adopted_by(f"SELECT * FROM ({ref.sql}) t ORDER BY 2 DESC LIMIT 5 /* asked_by=x */")
    assert not ref.adopted_by("SELECT payment_method, SUM(total_amount) FROM orders GROUP BY 1"), "its filter dropped"
    assert ref.adopted_by("SELECT t0.payment_method, ROUND(SUM(total_amount), 2) AS r FROM orders AS t0 "
                          "WHERE status <> 'cancelled' GROUP BY 1"), "rewritten, its measure and filter kept"
    assert not ref.adopted_by("SELECT payment_method, SUM(total_amount - refund) FROM orders WHERE status <> 'cancelled' "
                              "GROUP BY 1"), "its formula changed"
    assert ref.frame(ref.sql)["adopted"] is True


def test_the_bar_counts_an_answer_that_started_from_it(monkeypatch):
    from pramanyx.evals.evaluator import EvalObservation
    monkeypatch.setattr(B, "questions", lambda c: [{"id": "q1", "question": "Revenue by country?", "reference_sql": "x"}])
    v = B.run("gm" + uuid.uuid4().hex[:6], target=lambda case: EvalObservation(
        rows=[["CN", 3]], meta={"tools": ["metric_engine"] if B.offered("any") else []}), reference_rows=lambda s: [["CN", 3]])
    assert (v["used"], v["met"]) == (1, True)


def test_a_metric_kept_as_a_statement_is_handed_its_own_statement_for_one_figure(conn, monkeypatch):
    from pramanyx.semantic.metrics import MetricDefinition, save_metric
    save_metric(MetricDefinition(name="click_rate", label="Email click rate", connection=conn, status="approved",
                                 sql="SELECT SUM(e.clicked) * 1.0 / NULLIF(SUM(e.sent), 0) FROM consent c JOIN email e ON "
                                     "e.customer_id = c.customer_id", time_column="consent.updated", time_kind="flow",
                                 tables=["consent", "email"]))
    monkeypatch.setattr("pramanyx.kernel.clock.person_clock", lambda *a, **k: "UTC")
    with B.offering(True):
        whole = G.reference("What is the Email click rate?", conn)
        period = G.reference("What was Email click rate over the last 30 days?", conn)
        assert G.reference("Email click rate by country", conn) is None, "a statement is one figure, never a breakdown"
    assert whole is not None and whole.sql.startswith("SELECT SUM(e.clicked)") and whole.start is None
    assert period is not None and period.start and "AS governed" in period.sql and "AS click_rate" in period.sql
    assert period.adopted_by(period.sql) and "consent.updated" in period.prompt()


def test_the_metrics_own_name_is_not_its_breakdown_or_grain():
    from types import SimpleNamespace as NS
    m = NS(label="Daily Active Users (DAU)", name="daily_active_users_dau")
    left = G._without_name("What was Daily Active Users (DAU) over the last 30 days?", m)
    assert G.grain_asked(left) is None and "last 30 days" in left
    assert G.grain_asked(G._without_name("Daily Active Users by month", m)) == "month"
