"""The Briefing breaks a check down by a dimension one link away (2026-11-26): it offered only the dated table's own
columns, so order revenue was never broken down by the customer's country. A metric written as parts is grouped by a
linked table's column through the link the metric engine itself traverses; the source's own columns stay its own."""
from __future__ import annotations

import json
from datetime import date

import duckdb
import pytest

from pramanyx.db.connection import open_connection
from pramanyx.demo.setup import _seed_ecommerce
from pramanyx.ontology.models import OntologyGraph
from pramanyx.semantic import metric_engine as E
from pramanyx.semantic import metric_time as mt
from pramanyx.semantic.metrics import MetricDefinition
from tests.unit.test_object_bindings import GRAPH

REVENUE = MetricDefinition(name="order_revenue", label="Order revenue", connection="lb", source="orders",
                           measure="SUM(total_amount)", filters=["status <> 'cancelled'"], time_column="orders.order_date", time_kind="flow",
                           sql="SELECT 1")


@pytest.fixture(scope="module")
def db(tmp_path_factory):
    path = tmp_path_factory.mktemp("lb") / "samples.duckdb"
    con = duckdb.connect(str(path))
    _seed_ecommerce(con)
    con.close()
    conn = open_connection("duckdb", str(path), schema_name="ecommerce", connection_id="lb")
    yield conn
    conn.close()


def test_a_check_is_broken_down_by_a_linked_tables_column(db):
    graph = OntologyGraph.model_validate(json.loads(GRAPH.read_text()))
    join = E.link_join(REVENUE, graph, "order_to_customer.country")
    assert join == {"table": "customers", "local_col": "customer_id", "remote_col": "customer_id", "column": "country"}
    windows = [mt.Window("current", date(2000, 1, 1), date(2100, 1, 1))]

    def run(sql):
        r = db.execute("lb", sql.replace(" orders ", " ecommerce.orders ").replace(" customers ", " ecommerce.customers "))
        return r.columns, r.rows, r.error
    got, why = mt.run_measure(REVENUE, windows, run, by="order_to_customer.country", join=join)
    assert why == "", why
    have = {g["group"]: round(float(g["value"]), 4) for g in got}
    _, want_rows, _ = run("SELECT c.country, SUM(o.total_amount) FROM orders o JOIN customers c "
                          "ON o.customer_id = c.customer_id WHERE o.status <> 'cancelled' GROUP BY 1")
    assert have == {r[0]: round(float(r[1]), 4) for r in want_rows} and len(have) > 1
    sql, _ = mt.measure_sql(REVENUE, windows, by="order_to_customer.country", join=join)
    assert "_s.status" in sql and "LEFT JOIN" in sql, "the source's own columns said as its own"
    assert E.link_join(REVENUE, graph, "nowhere.country") is None and E.link_join(REVENUE, graph, "status") is None
