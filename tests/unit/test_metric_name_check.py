"""A metric's formula against what its name says, read without a model (2026-11-26: theLook's "Daily Active Users",
written by the Explorer, counted distinct users over the whole period asked)."""
from __future__ import annotations

import pytest

from pramanyx.semantic.metric_name_check import mismatches, model_written


@pytest.mark.parametrize("metric, said", [
    ({"label": "Daily Active Users (DAU)", "name": "daily_active_users_dau", "measure": "COUNT(DISTINCT user_id)"},
     "named daily, but it counts over the whole period asked"),
    ({"label": "Daily Sales", "name": "daily_sales", "sql": "SELECT SUM(totalPrice) FROM sales"}, "named daily"),
    ({"label": "Return rate", "name": "return_rate", "measure": "COUNT(*)"}, "named a rate or a share, but nothing in it divides"),
    ({"label": "Average order value", "name": "aov", "measure": "SUM(total)"}, "named an average"),
    ({"label": "COGS per Unit", "name": "cogs_per_unit", "measure": "SUM(cost)"}, "named per unit, but nothing in it divides"),
    ({"label": "Gross profit per order", "name": "gpo", "sql": "SELECT SUM(p) / COUNT(DISTINCT customer_id) FROM t"},
     "what it divides by does not count orders"),
    ({"label": "Number of orders", "name": "n_orders", "measure": "MAX(order_id)"}, "named a count"),
])
def test_a_name_its_formula_does_not_keep_is_said(metric, said):
    assert any(said in s for s in mismatches(metric)), mismatches(metric)


@pytest.mark.parametrize("metric", [
    {"label": "Daily Active Users (DAU)", "name": "dau",
     "sql": "SELECT AVG(dau) FROM (SELECT DATE(created_at) AS day, COUNT(DISTINCT user_id) AS dau FROM events GROUP BY 1) d"},
    {"label": "Return rate", "name": "return_rate", "measure": "SUM(returned) * 1.0 / NULLIF(COUNT(*), 0)"},
    {"label": "Contribution margin (EUR)", "name": "contribution_margin_eur", "sql": "SELECT SUM(price - cost) FROM t"},
    {"label": "Revenue per item", "name": "revenue_per_item", "measure": "MEASURE(revenue) / MEASURE(units_sold)"},
    {"label": "COGS per Unit", "name": "cogs_per_unit", "sql": "SELECT SUM(q * cost) / NULLIF(SUM(units), 0) FROM t"},
    {"label": "Revenue", "name": "revenue", "measure": "SUM(sale_price)"},
])
def test_a_formula_that_keeps_its_name_says_nothing(metric):
    assert mismatches(metric) == []


def test_who_wrote_it_when_a_model_did():
    assert model_written({"lineage": ["explorer"]}) == "the Explorer (a model)"
    assert model_written({"lineage": ["orders table"]}) == ""


def test_a_name_its_formula_does_not_keep_is_approved_only_by_someone_who_read_why(client, tmp_path, monkeypatch):
    import uuid

    from pramanyx.semantic.metrics import MetricDefinition, save_metric
    path = tmp_path / "metrics.json"
    path.write_text("[]")
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(path))
    monkeypatch.setattr("pramanyx.routers.metrics._figure_gates", lambda m, c: None)
    conn = "nc" + uuid.uuid4().hex[:6]
    save_metric(MetricDefinition(name="daily_active_users", label="Daily Active Users", connection=conn, status="proposed",
                                 sql="SELECT COUNT(DISTINCT user_id) AS daily_active_users FROM events", tables=["events"],
                                 lineage=["explorer"]))
    row = next(m for m in client.get(f"/metrics?connection_id={conn}").json() if m["name"] == "daily_active_users")
    assert row["written_by"] == "the Explorer (a model)" and "named daily" in row["name_check"][0]
    r = client.post("/metrics/daily_active_users/transition", json={"action": "approve", "connection": conn})
    assert r.status_code == 409 and r.json()["detail"]["reason"] == "name_and_formula_disagree"
    assert "written by the Explorer (a model)" in r.json()["detail"]["message"]
    r = client.post("/metrics/daily_active_users/transition", json={"action": "approve", "connection": conn, "name_read": True})
    assert r.status_code == 200, r.text
