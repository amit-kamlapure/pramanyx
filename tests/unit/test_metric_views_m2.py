"""The metric-views plan's M2 — one metric engine (`docs/METRIC_VIEWS_PLAN_2026-11-25.md` §4.2).

A metric written as parts is grouped by any dimension its source reaches through the ontology's measured to-one links,
by a grain over a period, compiled by the object compiler on a COPY of the graph; its filters always hold; what cannot
be compiled says why. Checked against the seeded samples shop: each grouped figure is compared with the same figure
written by hand, so a wrong join or a dropped filter is a wrong NUMBER.
"""
from __future__ import annotations

import json
from types import SimpleNamespace as NS

import duckdb
import pytest

from pramanyx.db.connection import open_connection
from pramanyx.demo.setup import _seed_ecommerce
from pramanyx.ontology.models import OntologyGraph
from pramanyx.semantic import metric_engine as E
from pramanyx.semantic.metrics import MetricDefinition
from tests.unit.test_object_bindings import GRAPH


@pytest.fixture(scope="module")
def graph() -> OntologyGraph:
    return OntologyGraph.model_validate(json.loads(GRAPH.read_text()))


@pytest.fixture(scope="module")
def db(tmp_path_factory):
    path = tmp_path_factory.mktemp("m2") / "samples.duckdb"
    con = duckdb.connect(str(path))
    _seed_ecommerce(con)
    con.close()
    conn = open_connection("duckdb", str(path), schema_name="ecommerce", connection_id="m2-t")
    yield conn
    conn.close()


def _rows(db, sql):
    r = db.execute("m2-test", sql)
    assert not r.error, r.error
    return [[str(c) for c in row] for row in r.rows]


LINES = MetricDefinition(name="line_revenue", label="Line revenue", connection="m2-t", source="order_items",
                         measure="SUM(line_total)", filters=["quantity > 1"],
                         sql="SELECT SUM(line_total) AS line_revenue FROM order_items WHERE (quantity > 1)")


def test_it_lists_what_a_metric_may_be_grouped_by_through_its_to_one_links(graph):
    dims = {d["path"]: d for d in E.dimensions(LINES, graph)}
    assert "quantity" in dims and dims["quantity"]["via"] == ""
    by_order = [p for p, d in dims.items() if d["via"] and p.endswith(".status")]
    assert len(by_order) == 1, "Order is one to-one link away"
    assert any(p.endswith(".category") for p in dims), "and so is Product"
    assert not any(p.endswith(".rating") for p in dims), "Review is many-to-many from a line: never offered"


def test_a_metric_is_grouped_through_a_link_with_its_filters_and_the_figures_hold(graph, db):
    status = next(d["path"] for d in E.dimensions(LINES, graph) if d["via"] and d["path"].endswith(".status"))
    compiled = E.compile_metric(LINES, graph, dialect="duckdb", by=[status])
    assert [ln["treatment"] for ln in compiled.links if ln.get("treatment")] and "JOIN" in compiled.sql.upper()
    got = sorted((r[0], round(float(r[1]), 2)) for r in _rows(db, compiled.sql))
    want = sorted((r[0], round(float(r[1]), 2)) for r in _rows(db, (
        "SELECT o.status, SUM(i.line_total) FROM ecommerce.order_items i JOIN ecommerce.orders o "
        "ON o.order_id = i.order_id WHERE i.quantity > 1 GROUP BY o.status")))
    assert got == want and len(got) > 1


def test_a_grain_over_a_period_on_the_sources_own_date(graph, db):
    orders = MetricDefinition(name="order_revenue", label="Order revenue", connection="m2-t", source="orders",
                              measure="SUM(total_amount)", filters=["status <> 'cancelled'"],
                              time_column="orders.order_date", sql="SELECT 1")
    compiled = E.compile_metric(orders, graph, dialect="duckdb", grain="month", start="2024-01-01", end="2024-04-01")
    got = {str(r[0])[:7]: round(float(r[1]), 2) for r in _rows(db, compiled.sql)}
    want = {str(r[0])[:7]: round(float(r[1]), 2) for r in _rows(db, (
        "SELECT date_trunc('month', order_date), SUM(total_amount) FROM ecommerce.orders WHERE status <> 'cancelled' "
        "AND order_date >= '2024-01-01' AND order_date < '2024-04-01' GROUP BY 1"))}
    assert got == want and got


@pytest.mark.parametrize("metric, said", [
    (MetricDefinition(name="s", label="S", connection="m2-t", sql="SELECT SUM(line_total) FROM order_items"),
     "cannot be grouped: it is one whole query"),
    (MetricDefinition(name="x", label="X", connection="m2-t", source="ledger_lines", measure="SUM(amount)", sql="SELECT 1"),
     "its source ledger_lines is no entity"),
    (LINES.model_copy(update={"time_column": "orders.order_date"}), "its date is on orders, not on its source"),
])
def test_what_cannot_be_compiled_says_why(graph, metric, said):
    with pytest.raises(E.NotCompiled, match=said):
        E.plan(metric, graph, grain="month" if metric.time_column else None)


def test_the_served_graph_is_never_changed(graph):
    before = (set(graph.metrics), {k: set(e.segments or {}) for k, e in graph.entities.items()})
    E.plan(LINES, graph, by=["quantity"])
    assert (set(graph.metrics), {k: set(e.segments or {}) for k, e in graph.entities.items()}) == before


def test_a_link_with_no_measured_cardinality_is_not_offered(graph):
    g = graph.model_copy(deep=True)
    for rel in g.relationships.values():
        rel.measured_cardinality = None
    assert all(d["via"] == "" for d in E.dimensions(LINES, g)), "an uncounted label is never traversed"


def test_a_metric_written_as_parts_is_broken_down_as_an_expression_was(graph):
    from pramanyx.semantic.metric_time import Window, measure_sql
    m = NS(name="line_revenue", sql=LINES.sql, source="order_items", measure="SUM(line_total)", tables=["order_items"],
           filters=["quantity > 1"], time_column="order_items.created_at", time_kind="flow", until_column=None,
           outcome_column=None, time_grain="month")
    from datetime import date
    sql, why = measure_sql(m, [Window(label="w", start=date(2024, 1, 1), end=date(2024, 2, 1))], dialect="duckdb", by="product_id")
    assert sql and not why and "GROUP BY product_id" in sql and "quantity > 1" in sql


def test_the_doors_list_dimensions_and_answer_a_grouped_metric_or_say_why(graph, db, client, tmp_path, monkeypatch):
    from contextlib import contextmanager

    from pramanyx.semantic.metrics import save_metric
    from pramanyx.semantic.object_query import compile_object_query
    path = tmp_path / "metrics.json"
    path.write_text("[]")
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(path))
    save_metric(LINES)
    save_metric(MetricDefinition(name="whole", label="Whole", connection="m2-t", sql="SELECT COUNT(*) FROM order_items"))
    monkeypatch.setattr("pramanyx.routers.ontology.served_ontology_graph", lambda conn, schema=None: graph)
    monkeypatch.setattr("pramanyx.routers.metrics._dialect_of", lambda conn: "duckdb")

    @contextmanager
    def reader(conn, schema, g):                       # the object door's read, on the seeded shop
        def run(query):
            r = db.execute("m2-door", compile_object_query(query, g, dialect="duckdb").sql)
            return list(r.columns), r.rows, []
        yield run
    monkeypatch.setattr("pramanyx.dashboards.from_object.reader", reader)

    dims = client.get("/metrics/line_revenue/dimensions?connection_id=m2-t").json()
    assert dims["groupable"] is True and "quantity" in [d["path"] for d in dims["dimensions"]]
    r = client.post("/metrics/query", json={"metric": "line_revenue", "connection_id": "m2-t", "by": ["quantity"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["columns"][-1] == "line_revenue" and body["sql"].upper().startswith("SELECT")
    got = {str(row[0]): round(float(row[-1]), 2) for row in body["rows"]}
    want = {r[0]: round(float(r[1]), 2) for r in _rows(db, "SELECT quantity, SUM(line_total) FROM ecommerce.order_items "
                                                           "WHERE quantity > 1 GROUP BY quantity")}
    assert got == want
    whole = client.post("/metrics/query", json={"metric": "whole", "connection_id": "m2-t", "by": ["quantity"]})
    assert whole.status_code == 422 and whole.json()["detail"]["why"] == "cannot be grouped: it is one whole query"
    assert client.get("/metrics/whole/dimensions?connection_id=m2-t").json() == {
        "metric": "whole", "groupable": False, "why": "cannot be grouped: it is one whole query", "dimensions": []}


def test_a_dashboards_metric_breakdown_is_checked_before_it_is_kept(graph, tmp_path, monkeypatch):
    from pramanyx.dashboards.pieces import not_resolved
    from pramanyx.semantic.metrics import save_metric
    path = tmp_path / "metrics.json"
    path.write_text("[]")
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(path))
    save_metric(LINES)
    save_metric(MetricDefinition(name="whole", label="Whole", connection="m2-t", sql="SELECT COUNT(*) FROM order_items"))
    status = next(d["path"] for d in E.dimensions(LINES, graph) if d["via"] and d["path"].endswith(".status"))

    def spec(**props):
        return {"elements": {"b": {"type": "MetricBreakdown", "props": {"label": "Lines", **props}, "children": []}}}
    assert not_resolved("m2-t", spec(metric="line_revenue", by=status), graph=graph) == []
    assert not_resolved("m2-t", spec(metric="whole", by="quantity"), graph=graph) == [
        'The metric breakdown "b" cannot be read: cannot be grouped: it is one whole query.']
    assert not_resolved("m2-t", spec(metric="nope"), graph=graph) == [
        'The metric breakdown "b" names the metric "nope", which this connection does not define.']
    refused = not_resolved("m2-t", spec(metric="line_revenue", by="no_such"), graph=graph)
    assert len(refused) == 1 and refused[0].startswith('The metric breakdown "b" cannot be read: ') and "no_such" in refused[0]
