"""The metric-views plan's M6 — metric view YAML in and out (`docs/METRIC_VIEWS_PLAN_2026-11-25.md` §4.7).

A Databricks metric view (1.1) is read onto the structured metric: its source, filter, fields, measures (one reading
`MEASURE(other)` built from metrics), windows, format, synonyms and comment; its joins proposed as links for a person,
the YAML's cardinality the claim and the platform's count the check; what does not map said by name. Export writes the
same shape back, and what it writes reads back as what was written.
"""
from __future__ import annotations

import uuid

import pytest
import yaml

from pramanyx.intake import metric_view as MV

VIEW = """
version: 1.1
source: main.shop.order_items
filter: status <> 'Cancelled'
parameters:
  - name: region
joins:
  - name: users
    source: main.shop.users
    on: source.user_id = users.id
    cardinality: many_to_one
    rely:
      at_most_one_match: true
fields:
  - name: status
    expr: status
  - name: order_month
    expr: DATE_TRUNC('MONTH', created_at)
measures:
  - name: Revenue
    expr: SUM(sale_price)
    display_name: Gross revenue
    comment: Booked sales, cancelled lines left out.
    format:
      type: currency
      currency_code: USD
      decimal_places: {type: exact, places: 2}
    synonyms: [sales, turnover]
    window:
      - order: order_month
        range: cumulative
  - name: lines
    expr: COUNT(*)
  - name: per line
    expr: MEASURE(Revenue) / MEASURE(lines)
materialization:
  schedule: every 1 hour
"""


def test_a_metric_view_is_read_onto_the_structured_metric_and_what_does_not_map_is_said():
    sections, said, joins = MV.map_metric_view(yaml.safe_load(VIEW))
    revenue, lines, per_line = sections["metrics"]
    assert revenue == {"name": "revenue", "label": "Gross revenue", "measure": "SUM(sale_price)", "dimensions": ["status"],
                       "source": "order_items", "filters": ["status <> 'Cancelled'"],
                       "caveats": "Booked sales, cancelled lines left out.", "window": {"kind": "cumulative"},
                       "format": {"format": "currency", "currency": "USD", "decimals": 2, "compact": False},
                       "synonyms": ["sales", "turnover"]}
    assert (lines["source"], lines["measure"]) == ("order_items", "COUNT(*)")
    assert per_line["measure"] == "MEASURE(revenue) / MEASURE(lines)" and "source" not in per_line
    assert joins == [{"left_table": "order_items", "left_col": "user_id", "right_table": "users", "right_col": "id",
                      "claim": "many_to_one"}]
    text = " ".join(said)
    for named in ("read as order_items", "`parameters` is not taken", "`materialization` is not taken",
                  "order_month is an expression", "`rely` is not taken"):
        assert named in text, named


def test_a_source_written_as_a_query_is_said_and_not_taken():
    sections, said, _ = MV.map_metric_view({"version": "1.1", "source": "SELECT * FROM t", "measures": [{"name": "n", "expr": "COUNT(*)"}]})
    assert sections == {} and "its source is a query" in said[0]


@pytest.fixture
def conn(tmp_path, monkeypatch):
    path = tmp_path / "metrics.json"
    path.write_text("[]")
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(path))
    monkeypatch.setattr("pramanyx.semantic.metric_checks.runs_on", lambda sql, conn, name, tables, filters: ("ok", ""))
    return "m6" + uuid.uuid4().hex[:6]


def test_an_imported_metric_lands_written_as_parts_with_its_words_and_format(conn):
    from pramanyx.intake.engine import apply_candidate
    from pramanyx.ontology.vocabulary import format_for, metric_words
    from pramanyx.semantic.metrics import get_metric
    sections, _, _ = MV.map_metric_view(yaml.safe_load(VIEW))
    revenue, lines, per_line = sections["metrics"]
    apply_candidate(conn, "metric", {**revenue, "connection": conn}, actor="ana", source="shop.yaml")
    m = get_metric("revenue", connection_id=conn)
    assert (m.source, m.measure, m.window, m.status) == ("order_items", "SUM(sale_price)", {"kind": "cumulative"}, "proposed")
    assert m.sql == "SELECT SUM(sale_price) AS revenue FROM order_items WHERE (status <> 'Cancelled')"
    assert sorted(metric_words(conn)["revenue"]) == ["sales", "turnover"]
    assert format_for(conn, "metric:revenue").currency == "USD"
    with pytest.raises(ValueError, match="accept the metrics it is built from first"):
        apply_candidate(conn, "metric", {**per_line, "connection": conn}, actor="ana", source="shop.yaml")
    apply_candidate(conn, "metric", {**lines, "connection": conn}, actor="ana", source="shop.yaml")
    apply_candidate(conn, "metric", {**per_line, "connection": conn}, actor="ana", source="shop.yaml")
    assert get_metric("per_line", connection_id=conn).sql.upper().startswith("SELECT 1.0 * (SELECT SUM(SALE_PRICE)")


def test_the_file_door_stages_the_metrics_and_proposes_the_joins(client, conn, monkeypatch):
    booked = []
    monkeypatch.setattr(MV, "_count", lambda c, j: "N:1, as claimed")
    monkeypatch.setattr("pramanyx.record.writers.book_usage_claims",
                        lambda **kw: booked.extend(kw["candidates"]) or len(kw["candidates"]))
    r = client.post("/intake/files", data={"connection_id": conn}, files={"file": ("shop.yaml", VIEW.encode(), "text/yaml")})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["mapped"]["joins_proposed"] == 1 and any("parameters" in s for s in body["mapped"]["not_translated"])
    assert booked[0].proposal == "order_items.user_id = users.id"
    assert booked[0].evidence == "the metric view claims many to one; counted on the data: N:1, as claimed"
    bad = client.post("/intake/files", data={"connection_id": conn}, files={"file": ("x.yaml", b"a: 1", "text/yaml")})
    assert bad.status_code == 422 and "a metric view" in bad.json()["detail"]


def test_export_writes_the_same_shape_and_it_reads_back(client, conn):
    from pramanyx.ontology import vocabulary
    from pramanyx.semantic.metrics import MetricDefinition, save_metric
    save_metric(MetricDefinition(name="revenue", label="Gross revenue", connection=conn, source="order_items",
                                 measure="SUM(sale_price)", filters=["status <> 'Cancelled'", "sale_price > 0"],
                                 dimensions=["status"], window={"kind": "cumulative"}, time_column="order_items.created_at",
                                 caveats="Booked sales.", sql="SELECT 1"))
    save_metric(MetricDefinition(name="lines", label="Lines", connection=conn, source="order_items", measure="COUNT(*)",
                                 filters=["status <> 'Cancelled'"], sql="SELECT 1"))
    save_metric(MetricDefinition(name="per_line", label="Per line", connection=conn,
                                 measure="MEASURE(revenue) / MEASURE(lines)", sql="SELECT 1"))
    save_metric(MetricDefinition(name="whole", label="Whole", connection=conn, sql="SELECT 1 FROM a JOIN b ON 1 = 1"))
    vocabulary.add_synonym(conn, "metric", "revenue", "sales", source="human")
    vocabulary.set_format(conn, "metric:revenue", vocabulary.FormatSpec(format="currency", currency="USD", decimals=2))
    out = client.get(f"/metrics/metric-view/{conn}").json()
    assert out["said"] == ["whole is one whole query — a metric view holds measures over a source, not statements"]
    (doc,) = list(yaml.safe_load_all(out["yaml"]))
    assert (doc["version"], doc["source"], doc["filter"]) == ("1.1", "order_items", "(status <> 'Cancelled')")
    by = {m["name"]: m for m in doc["measures"]}
    assert by["revenue"]["expr"] == "SUM(sale_price) FILTER(WHERE (sale_price > 0))"
    assert by["revenue"]["format"] == {"type": "currency", "currency_code": "USD", "decimal_places": {"type": "exact", "places": 2}}
    assert by["revenue"]["synonyms"] == ["sales"] and by["revenue"]["window"] == [{"order": "created_at", "range": "cumulative"}]
    assert by["per_line"]["expr"] == "MEASURE(revenue) / MEASURE(lines)" and by["lines"]["expr"] == "COUNT(*)"
    back, _, _ = MV.map_metric_view(doc)
    again = {m["name"]: m for m in back["metrics"]}
    assert again["revenue"]["measure"] == "SUM(sale_price)", "its own filter comes back among its filters, where it was"
    assert again["revenue"]["filters"] == ["(status <> 'Cancelled')", "(sale_price > 0)"]
    assert again["revenue"]["format"]["currency"] == "USD" and again["revenue"]["window"] == {"kind": "cumulative"}


def test_export_writes_the_joins_its_linked_dimensions_go_through(client, conn, monkeypatch):
    import json

    from pramanyx.ontology.models import OntologyGraph
    from pramanyx.semantic import metric_engine as E
    from pramanyx.semantic.metrics import MetricDefinition, save_metric
    from tests.unit.test_object_bindings import GRAPH
    graph = OntologyGraph.model_validate(json.loads(GRAPH.read_text()))
    monkeypatch.setattr("pramanyx.routers.ontology.served_ontology_graph", lambda c, s=None: graph)
    m = MetricDefinition(name="line_revenue", label="Line revenue", connection=conn, source="order_items",
                         measure="SUM(line_total)", sql="SELECT 1")
    status = next(d["path"] for d in E.dimensions(m, graph) if d["via"] and d["path"].endswith(".status"))
    save_metric(m.model_copy(update={"dimensions": ["quantity", status, "nowhere.thing"]}))
    out = client.get(f"/metrics/metric-view/{conn}").json()
    assert "'on':" in out["yaml"], "`on` is written as text: YAML 1.1 reads a bare on as true"
    (doc,) = list(yaml.safe_load_all(out["yaml"]))
    assert doc["joins"] == [{"name": "order", "source": "orders", "on": "source.order_id = order.order_id", "cardinality": "many_to_one"}]
    assert {"name": "order_status", "expr": "order.status"} in doc["fields"] and {"name": "quantity", "expr": "quantity"} in doc["fields"]
    assert any("nowhere.thing reaches no to-one link" in s for s in out["said"])
    back, _, joins = MV.map_metric_view(doc)
    assert joins == [{"left_table": "order_items", "left_col": "order_id", "right_table": "orders", "right_col": "order_id",
                      "claim": "many_to_one"}], "the join written reads back as the link it was"


def test_expressions_go_out_in_the_views_sql_and_come_back_in_the_connections(conn):
    from pramanyx.semantic.metrics import MetricDefinition, save_metric
    save_metric(MetricDefinition(name="conversion", label="Conversion", connection=conn, source="events",
                                 measure="SAFE_DIVIDE(COUNT(DISTINCT buyer), COUNT(DISTINCT visitor))",
                                 filters=["kind <> 'bot'"], sql="SELECT 1"))
    text, said = MV.export_metric_views(conn, dialect="bigquery")
    (doc,) = list(yaml.safe_load_all(text))
    assert doc["measures"][0]["expr"] == "TRY_DIVIDE(COUNT(DISTINCT buyer), COUNT(DISTINCT visitor))"
    assert "translated from this connection's (bigquery)" in said[-1]
    back, _, _ = MV.map_metric_view(doc, dialect="bigquery")
    assert back["metrics"][0]["measure"] == "SAFE_DIVIDE(COUNT(DISTINCT buyer), COUNT(DISTINCT visitor))"
    view = {"version": "1.1", "source": "t", "measures": [
        {"name": "split", "expr": "COUNT(*) FILTER (WHERE a = 1) / COUNT(*)"},
        {"name": "both", "expr": "SUM(x) FILTER (WHERE a = 1) + COUNT(DISTINCT u) FILTER (WHERE a = 1)"}]}
    split, both = MV.map_metric_view(view, dialect="bigquery")[0]["metrics"]
    assert (split["measure"], split["filters"]) == ("COUNT(CASE WHEN a = 1 THEN 1 END) / COUNT(*)", []), \
        "BigQuery has no FILTER: a condition on one aggregate goes inside it"
    assert (both["measure"], both["filters"]) == ("SUM(x) + COUNT(DISTINCT u)", ["a = 1"])
