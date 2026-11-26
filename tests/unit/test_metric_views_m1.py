"""The metric-views plan's M1 — the structured metric (`docs/METRIC_VIEWS_PLAN_2026-11-25.md` §4.1; the user,
2026-11-25: "A metric is structured", and 2026-11-26: "Complete until M6").

A metric written as parts — a source, a measure, filters — has its statement COMPOSED from them, so every reader of its
`sql` runs the same figure; a statement keeps working and says it cannot be grouped; every save is a version, and an
earlier one can be put back; a statement is split into parts only where the parts give the same figure on the
warehouse, run both ways. The figures do the work: a wrong split gets a wrong NUMBER.
"""
from __future__ import annotations

import duckdb
import pytest

from pramanyx.db.connection import DuckDBConnection
from pramanyx.semantic import metric_structure as S
from pramanyx.semantic.metrics import MetricDefinition, get_metric, save_metric, versions_of

CONN = "c_m1"


@pytest.fixture(autouse=True)
def isolated_metrics(tmp_path, monkeypatch):
    path = tmp_path / "metrics.json"
    path.write_text("[]")
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(path))
    return path


@pytest.fixture
def warehouse(tmp_path, monkeypatch):
    """Four order lines: 100 + 50 shipped, 30 cancelled, 20 returned — SUM over the uncancelled is 170."""
    path = tmp_path / "w.duckdb"
    w = duckdb.connect(str(path))
    try:
        w.execute("CREATE TABLE order_items AS SELECT * FROM (VALUES (1, 100.0, 'Shipped'), (2, 50.0, 'Shipped'), "
                  "(3, 30.0, 'Cancelled'), (4, 20.0, 'Returned')) t(id, sale_price, status)")
        w.execute("CREATE TABLE orders AS SELECT * FROM (VALUES (1, 'web'), (2, 'app')) t(order_id, channel)")
    finally:
        w.close()

    def _open(_conn_id):
        return DuckDBConnection(str(path))
    monkeypatch.setattr("pramanyx.db.connection.open_connection_for", _open, raising=False)
    monkeypatch.setattr("pramanyx.routers.metrics._dialect_of", lambda conn: "duckdb")
    return path


# ── the parts ───────────────────────────────────────────────────────────────────────────────────────────────────────

def test_a_structured_metric_composes_its_statement_from_its_parts():
    got = S.compose("revenue", "order_items", "SUM(sale_price)", ["status <> 'Cancelled'"], "duckdb")
    assert got == "SELECT SUM(sale_price) AS revenue FROM order_items WHERE (status <> 'Cancelled')"
    assert S.compose("lines", "shop.order_items", "COUNT(*)", [], "duckdb") == "SELECT COUNT(*) AS lines FROM shop.order_items"


@pytest.mark.parametrize("source, measure, filters, said", [
    ("", "SUM(x)", [], "names its source"),
    ("order_items", "", [], "has a measure"),
    ("order_items", "SELECT SUM(x) FROM t", [], "the aggregate alone"),
    ("order_items", "sale_price * 2", [], "aggregates nothing"),
    ("order_items", "SUM(sale_price", [], "does not parse"),
    ("order_items", "SUM(sale_price)", ["COUNT(*) > 1"], "keeps or drops single rows"),
])
def test_parts_that_do_not_hold_together_are_said_before_the_warehouse(source, measure, filters, said):
    assert said in S.check_parts(source, measure, filters, "duckdb")


def test_a_statement_splits_only_where_one_table_and_one_measure_can_be_lifted_out():
    one = MetricDefinition(name="revenue", label="Revenue", connection=CONN,
                           sql="SELECT SUM(sale_price) AS revenue FROM order_items WHERE status <> 'Cancelled'")
    parts, why = S.split(one, "duckdb")
    assert parts == {"source": "order_items", "measure": "SUM(sale_price)", "filters": ["status <> 'Cancelled'"]}, why
    joined = one.model_copy(update={"sql": "SELECT SUM(i.sale_price) FROM order_items i JOIN orders o ON o.order_id = i.id"})
    assert S.split(joined, "duckdb")[0] is None and "one whole query" in S.split(joined, "duckdb")[1]
    assert S.groupable(one) == (False, S.NOT_GROUPABLE)
    assert S.groupable(one.model_copy(update={"source": "order_items", "measure": "SUM(sale_price)"})) == (True, "")


def test_a_split_is_kept_only_where_both_give_the_same_figure():
    m = MetricDefinition(name="revenue", label="Revenue", connection=CONN,
                         sql="SELECT SUM(sale_price) AS revenue FROM order_items WHERE status <> 'Cancelled'")
    assert S.migration_row(m, lambda sql: 170.0, "duckdb")["outcome"] == "split"
    figures = iter([170.0, 200.0])
    differs = S.migration_row(m, lambda sql: next(figures), "duckdb")
    assert differs["outcome"] == "kept" and "the parts give 200.0, the statement 170.0" in differs["why"]

    def boom(sql):
        raise RuntimeError("Binder Error: no such column")
    assert "could not be run to compare: Binder Error" in S.migration_row(m, boom, "duckdb")["why"]


# ── the doors ───────────────────────────────────────────────────────────────────────────────────────────────────────

def _body(**over):
    return {"name": "revenue", "label": "Revenue", "connection": CONN, "source": "order_items",
            "measure": "SUM(sale_price)", "filters": ["status <> 'Cancelled'"], "sql": "ignored", **over}


def test_a_structured_save_stores_the_composed_statement_and_says_it_may_be_grouped(client, warehouse):
    r = client.post("/metrics", json=_body())
    assert r.status_code == 201, r.text
    m = get_metric("revenue", connection_id=CONN)
    assert m.sql == "SELECT SUM(sale_price) AS revenue FROM order_items WHERE (status <> 'Cancelled')", "the sent sql is not read"
    assert (m.source, m.measure, m.tables) == ("order_items", "SUM(sale_price)", ["order_items"])
    assert client.get(f"/metrics/revenue/value?conn_id={CONN}").json()["value"] == 170.0
    row = next(x for x in client.get(f"/metrics?connection_id={CONN}").json() if x["name"] == "revenue")
    assert (row["structured"], row["groupable"], row["groupable_why"]) == (True, True, "")
    bad = client.post("/metrics", json=_body(name="bad", measure="sale_price"))
    assert bad.status_code == 422 and "aggregates nothing" in bad.json()["detail"]


def test_every_save_is_a_version_and_an_earlier_one_can_be_put_back(client, warehouse):
    assert client.post("/metrics", json=_body()).status_code == 201
    assert client.put("/metrics/revenue", json=_body(label="Revenue")).status_code == 200      # nothing changed
    assert client.put("/metrics/revenue", json=_body(filters=[])).status_code == 200            # the formula changed
    versions = client.get(f"/metrics/revenue/versions?connection_id={CONN}").json()["versions"]
    assert [v["version"] for v in versions] == [2, 1], "a save that changes nothing is not a version"
    assert versions[0]["definition"]["filters"] == [] and versions[1]["definition"]["filters"] == ["status <> 'Cancelled'"]
    assert client.get(f"/metrics/revenue/value?conn_id={CONN}").json()["value"] == 200.0
    r = client.post("/metrics/revenue/versions/1/restore", json={"connection": CONN})
    assert r.status_code == 200, r.text
    assert client.get(f"/metrics/revenue/value?conn_id={CONN}").json()["value"] == 170.0
    m = get_metric("revenue", connection_id=CONN)
    from pramanyx.semantic.metrics import home_schema
    assert [v["version"] for v in versions_of("revenue", CONN, home_schema(m))] == [3, 2, 1], "putting one back is a version too"


def test_statements_are_split_where_the_figure_holds_and_kept_where_it_cannot(client, warehouse):
    save_metric(MetricDefinition(name="revenue", label="Revenue", connection=CONN, status="approved", version=2,
                                 approved_by="ana", sql="SELECT SUM(sale_price) AS revenue FROM order_items "
                                                        "WHERE status <> 'Cancelled'"))
    save_metric(MetricDefinition(name="web_lines", label="Web lines", connection=CONN, status="approved",
                                 approved_by="ana", sql="SELECT COUNT(*) FROM order_items i JOIN orders o "
                                                        "ON o.order_id = i.id WHERE o.channel = 'web'"))
    look = client.post(f"/metrics/structure/{CONN}", json={"apply": False}).json()
    assert {r["name"]: r["outcome"] for r in look["rows"]} == {"revenue": "split", "web_lines": "kept"}
    assert next(r for r in look["rows"] if r["name"] == "revenue")["before"] == 170.0
    assert get_metric("revenue", connection_id=CONN).measure is None, "looking changes nothing"
    done = client.post(f"/metrics/structure/{CONN}", json={"apply": True}).json()
    assert (done["split"], done["kept"]) == (1, 1)
    m = get_metric("revenue", connection_id=CONN)
    assert (m.source, m.measure, m.filters) == ("order_items", "SUM(sale_price)", ["status <> 'Cancelled'"])
    assert (m.status, m.version, m.approved_by) == ("approved", 2, "ana"), "the figure is the same: governance stands"
    assert client.get(f"/metrics/revenue/value?conn_id={CONN}").json()["value"] == 170.0
    assert get_metric("web_lines", connection_id=CONN).measure is None


def test_an_edit_that_names_no_dataset_changes_the_definition_it_addressed(client, warehouse):
    # Before: the edit was written as dataset "*", a second row beside the first, and every read kept returning the old
    from pramanyx.semantic.metrics import _load_raw
    body = {"name": "lines", "label": "Lines", "connection": CONN, "sql": "SELECT COUNT(*) AS lines FROM order_items"}
    assert client.post("/metrics", json=body).status_code == 201
    edited = {**body, "sql": "SELECT COUNT(*) AS lines FROM order_items WHERE id > 1"}
    assert client.put("/metrics/lines", json=edited).status_code == 200
    assert [r["sql"] for r in _load_raw() if r.get("name") == "lines"] == [edited["sql"]]
    assert client.get(f"/metrics/lines/value?conn_id={CONN}").json()["value"] == 3.0

