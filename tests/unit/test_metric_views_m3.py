"""The metric-views plan's M3 — metrics from metrics, and windows (`docs/METRIC_VIEWS_PLAN_2026-11-25.md` §4.3, §4.4).

`MEASURE(a) / MEASURE(b)` is each metric compiled at the grouping asked and then combined — never inside one aggregate,
so a ratio never cross-multiplies; division by nothing is nothing; a cycle is refused; its unit is derived where it can
be. A window runs a metric across periods: a running total or the last N (an additive metric only), the figure N periods
before, a stock's first or last reading in each period. Checked against the seeded samples shop, figure by figure.
"""
from __future__ import annotations

import json

import duckdb
import pytest

from pramanyx.db.connection import open_connection
from pramanyx.demo.setup import _seed_ecommerce
from pramanyx.ontology.models import OntologyGraph
from pramanyx.semantic import metric_engine as E
from pramanyx.semantic import metric_structure as S
from pramanyx.semantic.metrics import MetricDefinition
from tests.unit.test_object_bindings import GRAPH


@pytest.fixture(scope="module")
def graph() -> OntologyGraph:
    return OntologyGraph.model_validate(json.loads(GRAPH.read_text()))


@pytest.fixture(scope="module")
def db(tmp_path_factory):
    path = tmp_path_factory.mktemp("m3") / "samples.duckdb"
    con = duckdb.connect(str(path))
    _seed_ecommerce(con)
    con.close()
    conn = open_connection("duckdb", str(path), schema_name="ecommerce", connection_id="m3-t")
    yield conn
    conn.close()


def _rows(db, sql):
    r = db.execute("m3-test", sql)
    assert not r.error, (r.error, sql)
    return [list(row) for row in r.rows]


def _m(name, **kw):
    return MetricDefinition(name=name, label=kw.pop("label", name.replace("_", " ").title()), connection="m3-t",
                            sql=kw.pop("sql", "SELECT 1"), **kw)


REVENUE = _m("line_revenue", source="order_items", measure="SUM(line_total)", filters=["quantity > 1"], unit="$",
             sql="SELECT SUM(line_total) AS line_revenue FROM order_items WHERE (quantity > 1)")
LINES = _m("line_count", source="order_items", measure="COUNT(*)", filters=["quantity > 1"],
           sql="SELECT COUNT(*) AS line_count FROM order_items WHERE (quantity > 1)")
AVERAGE = _m("average_line", measure="MEASURE(line_revenue) / MEASURE(line_count)")
ORDERS = _m("order_revenue", source="orders", measure="SUM(total_amount)", time_column="orders.order_date",
            filters=["status <> 'cancelled'"], unit="$")
STORE = {m.name: m for m in (REVENUE, LINES, AVERAGE, ORDERS)}


def resolve(name):
    return STORE.get(name)


def _status_path(graph):
    return next(d["path"] for d in E.dimensions(REVENUE, graph) if d["via"] and d["path"].endswith(".status"))


# ── metrics from metrics ────────────────────────────────────────────────────────────────────────────────────────────

def test_a_ratio_of_metrics_is_each_grouped_then_divided(graph, db):
    by = _status_path(graph)
    c = E.compile_metric(AVERAGE, graph, dialect="duckdb", resolve=resolve, by=[by])
    got = {r[0]: round(float(r[1]), 6) for r in _rows(db, c.sql)}
    want = {r[0]: round(float(r[1]), 6) for r in _rows(db, (
        "SELECT o.status, SUM(i.line_total) / COUNT(*) FROM ecommerce.order_items i JOIN ecommerce.orders o "
        "ON o.order_id = i.order_id WHERE i.quantity > 1 GROUP BY o.status"))}
    assert got == want and len(got) > 1
    assert E.dimensions(AVERAGE, graph, resolve) == E.dimensions(REVENUE, graph), "what both its metrics reach"


def test_its_statement_reads_each_metrics_own_so_every_reader_runs_the_same_figure(db):
    sql = S.compose_composed("average_line", AVERAGE.measure, resolve, "duckdb")
    assert "NULLIF" in sql.upper(), "a denominator of nothing is nothing, never an error"
    (got,), = _rows(db, sql.replace("order_items", "ecommerce.order_items"))
    (want,), = _rows(db, "SELECT SUM(line_total) / COUNT(*) FROM ecommerce.order_items WHERE quantity > 1")
    assert round(float(got), 6) == round(float(want), 6)


def test_an_expression_written_before_statements_is_read_as_its_statement(db):
    old = _m("old_lines", sql="COUNT(*)", tables=["ecommerce.order_items"], filters=["quantity > 1"])
    sql = S.compose_composed("per_line", "MEASURE(line_revenue) / MEASURE(old_lines)", {**STORE, "old_lines": old}.get, "duckdb")
    (got,), = _rows(db, sql.replace(" order_items", " ecommerce.order_items"))
    (want,), = _rows(db, "SELECT SUM(line_total) / COUNT(*) FROM ecommerce.order_items WHERE quantity > 1")
    assert round(float(got), 6) == round(float(want), 6)


def test_a_cycle_and_a_name_no_metric_has_are_refused():
    loop = {"a": _m("a", measure="MEASURE(b) * 2"), "b": _m("b", measure="MEASURE(a) + 1")}
    with pytest.raises(ValueError, match="goes round in a circle"):
        S.compose_composed("a", "MEASURE(b) * 2", loop.get, "duckdb")
    with pytest.raises(ValueError, match="MEASURE\\(nope\\) names no metric"):
        S.compose_composed("x", "MEASURE(nope) / 2", {}.get, "duckdb")


def test_metrics_that_group_differently_say_so(graph):
    mixed = _m("per_order", measure="MEASURE(line_revenue) / MEASURE(order_revenue)")
    store = {**STORE, "per_order": mixed}
    with pytest.raises(E.NotCompiled, match="MEASURE\\(order_revenue\\)"):
        E.compile_metric(mixed, graph, resolve=store.get, by=["quantity"])


@pytest.mark.parametrize("measure, filters, said", [
    ("SUM(x) / MEASURE(line_count)", [], "MEASURE(…) and arithmetic only"),
    ("MEASURE(a) / MEASURE(b)", ["x > 1"], "takes its filters from the metrics it names"),
])
def test_a_measure_built_from_metrics_holds_only_them(measure, filters, said):
    assert said in S.check_parts("", measure, filters, "duckdb")
    assert S.check_parts("", "MEASURE(line_revenue) / MEASURE(line_count)", [], "duckdb") == ""


def test_its_unit_is_derived_where_it_can_be():
    assert E.unit_of(AVERAGE, resolve) == ("$", "$ for each of Line Count")
    same = {**STORE, "b": _m("b", source="t", measure="SUM(x)", unit="$")}
    assert E.unit_of(_m("r", measure="MEASURE(line_revenue) / MEASURE(b)"), same.get)[0] is None
    assert E.unit_of(REVENUE, resolve) == ("$", "")


# ── windows ─────────────────────────────────────────────────────────────────────────────────────────────────────────

MONTHS = dict(grain="month", start="2024-01-01", end="2024-07-01")


def _monthly(db):
    return [(str(r[0])[:7], float(r[1])) for r in _rows(db, (
        "SELECT date_trunc('month', order_date) m, SUM(total_amount) FROM ecommerce.orders WHERE status <> 'cancelled' "
        "AND order_date >= '2024-01-01' AND order_date < '2024-07-01' GROUP BY 1 ORDER BY 1"))]


def _by_period(db, c):
    return {str(r[0])[:7]: (None if r[1] in (None, "NULL") else round(float(r[1]), 2)) for r in _rows(db, c.sql)}


def test_a_running_total_and_the_last_n_periods(graph, db):
    months = _monthly(db)
    running, total = {}, 0.0
    for m, v in months:
        total += v
        running[m] = round(total, 2)
    got = _by_period(db, E.compile_metric(ORDERS, graph, window={"kind": "cumulative"}, **MONTHS))
    assert got == running and len(got) == 6
    last2 = {m: round(v + (months[i - 1][1] if i else 0), 2) for i, (m, v) in enumerate(months)}
    assert _by_period(db, E.compile_metric(ORDERS, graph, window={"kind": "trailing", "n": 2}, **MONTHS)) == last2


def test_the_figure_n_periods_before(graph, db):
    months = _monthly(db)
    want = {m: (round(months[i - 1][1], 2) if i else None) for i, (m, _) in enumerate(months)}
    assert _by_period(db, E.compile_metric(ORDERS, graph, window={"kind": "offset", "n": 1}, **MONTHS)) == want


def test_a_stocks_last_reading_in_each_period(graph, db):
    got = _by_period(db, E.compile_metric(ORDERS, graph, window={"kind": "last"}, **MONTHS))
    want = {str(r[0])[:7]: round(float(r[1]), 2) for r in _rows(db, (
        "WITH d AS (SELECT CAST(order_date AS DATE) day, SUM(total_amount) v FROM ecommerce.orders WHERE status <> 'cancelled' "
        "AND order_date >= '2024-01-01' AND order_date < '2024-07-01' GROUP BY 1) "
        "SELECT date_trunc('month', day), arg_max(v, day) FROM d GROUP BY 1"))}
    assert got == want


def test_a_running_total_of_a_rate_is_refused_and_a_window_needs_a_grain(graph):
    avg = _m("avg_order", source="orders", measure="AVG(total_amount)", time_column="orders.order_date",
             sql="SELECT AVG(total_amount) AS avg_order FROM orders")
    with pytest.raises(E.NotCompiled, match="running total of a rate or an average"):
        E.compile_metric(avg, graph, window={"kind": "cumulative"}, **MONTHS)
    with pytest.raises(E.NotCompiled, match="choose a grain"):
        E.compile_metric(ORDERS, graph, window={"kind": "offset", "n": 1})
    assert E.check_window({"kind": "trailing"}) == "a trailing window counts 1 to 366 periods"


def test_a_metric_built_from_metrics_is_saved_with_a_statement_every_reader_runs(client, tmp_path, monkeypatch):
    from pramanyx.db.connection import DuckDBConnection
    path = tmp_path / "metrics.json"
    path.write_text("[]")
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(path))
    w = tmp_path / "w.duckdb"
    con = duckdb.connect(str(w))
    con.execute("CREATE TABLE order_items AS SELECT * FROM (VALUES (1, 100.0, 2), (2, 50.0, 3), (3, 30.0, 1)) t(id, line_total, quantity)")
    con.close()
    monkeypatch.setattr("pramanyx.db.connection.open_connection_for", lambda conn: DuckDBConnection(str(w)), raising=False)
    monkeypatch.setattr("pramanyx.routers.metrics._dialect_of", lambda conn: "duckdb")
    for body in ({"name": "line_revenue", "label": "Line revenue", "source": "order_items", "measure": "SUM(line_total)",
                  "filters": ["quantity > 1"], "unit": "$"},
                 {"name": "line_count", "label": "Lines", "source": "order_items", "measure": "COUNT(*)", "filters": ["quantity > 1"]}):
        assert client.post("/metrics", json={**body, "connection": "m3-t"}).status_code == 201
    r = client.post("/metrics", json={"name": "average_line", "label": "Average line", "connection": "m3-t",
                                      "measure": "MEASURE(line_revenue) / MEASURE(line_count)"})
    assert r.status_code == 201, r.text
    assert r.json()["source"] is None and r.json()["tables"] == ["order_items"]
    assert client.get("/metrics/average_line/value?conn_id=m3-t").json()["value"] == 75.0     # (100 + 50) / 2
    bad = client.post("/metrics", json={"name": "loop", "label": "Loop", "connection": "m3-t", "measure": "MEASURE(loop) + 1"})
    assert bad.status_code == 422 and "goes round in a circle" in bad.json()["detail"]
    win = client.post("/metrics", json={"name": "w", "label": "W", "connection": "m3-t", "source": "order_items",
                                        "measure": "COUNT(*)", "window": {"kind": "trailing"}})
    assert win.status_code == 422 and "counts 1 to 366 periods" in win.json()["detail"]
