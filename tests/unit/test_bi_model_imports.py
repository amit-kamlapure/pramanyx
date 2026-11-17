"""Phase 3 (2026-11-17) — what a BI tool says a word means, read into the intake lane.

Receipts: a dbt simple metric and a same-model ratio become metrics with SQL; derived, cumulative and filtered ones
come in as Definitions quoting dbt, and the import says so. A LookML sum, count, filtered count and number-of-measures
become metrics over the view's table; Liquid and another view's fields do not; an explore's join is readable. Power
BI's DAX never becomes SQL: a .bim or a .tmdl measure is a Definition quoting it. Each mapper is deterministic, and the
file door stages every one as a candidate a person decides — an accepted Definition lands with its aliases, never its
provenance tags, and in its area.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from pramanyx.api import app
from pramanyx.intake import bi_models

client = TestClient(app)
CONN = "bi3conn"

DBT = {
    "metadata": {"dbt_version": "1.8.0"}, "nodes": {}, "sources": {},
    "semantic_models": {
        "semantic_model.shop.orders": {
            "name": "orders", "node_relation": {"alias": "orders", "schema_name": "Analytics"},
            "defaults": {"agg_time_dimension": "ordered_at"},
            "dimensions": [{"name": "ordered_at", "type": "time", "type_params": {"time_granularity": "day"}},
                           {"name": "status", "type": "categorical"}],
            "measures": [{"name": "order_total", "agg": "sum", "expr": "amount"},
                         {"name": "order_count", "agg": "count", "expr": "1"},
                         {"name": "customers", "agg": "count_distinct", "expr": "customer_id"},
                         {"name": "balance", "agg": "sum", "expr": "balance",
                          "non_additive_dimension": {"name": "ordered_at"}}]}},
    "metrics": {
        "metric.shop.revenue": {"name": "revenue", "label": "Revenue", "type": "simple",
                                "description": "Completed order value, before refunds.",
                                "type_params": {"measure": {"name": "order_total"}}},
        "metric.shop.orders": {"name": "orders", "label": "Orders", "type": "simple",
                               "type_params": {"measure": {"name": "order_count"}}},
        "metric.shop.aov": {"name": "aov", "label": "Average order value", "type": "ratio",
                            "description": "Revenue per order.",
                            "type_params": {"numerator": {"name": "revenue"}, "denominator": {"name": "orders"}}},
        "metric.shop.food_revenue": {"name": "food_revenue", "type": "simple",
                                     "filter": {"where_filters": [
                                         {"where_sql_template": "{{ Dimension('order__is_food') }} = true"}]},
                                     "type_params": {"measure": {"name": "order_total"}}},
        "metric.shop.net": {"name": "net", "type": "derived", "description": "Revenue less refunds.",
                            "type_params": {"expr": "revenue - refunds",
                                            "metrics": [{"name": "revenue"}, {"name": "refunds"}]}},
        "metric.shop.balance": {"name": "balance_total", "type": "simple",
                                "type_params": {"measure": {"name": "balance"}}},
    },
}

LOOKML = '''
# a comment
view: order_items {
  sql_table_name: thelook.order_items ;;
  dimension: id { primary_key: yes type: number sql: ${TABLE}.id ;; }
  dimension: status { type: string sql: ${TABLE}.status ;; description: "Where the item is in fulfilment" }
  dimension: is_returned { type: yesno sql: ${TABLE}.returned_at IS NOT NULL ;; }
  dimension: sale_price { type: number sql: ${TABLE}.sale_price ;; }
  dimension_group: created { type: time timeframes: [raw, date, week, month] sql: ${TABLE}.created_at ;; }
  measure: total_revenue {
    type: sum
    sql: ${sale_price} ;;
    value_format_name: usd
    label: "Total Revenue"
    description: "Sum of item sale prices."
  }
  measure: count { type: count }
  measure: complete_count { type: count filters: [status: "Complete"] }
  measure: returned_count { type: count filters: [is_returned: "yes"] }
  measure: average_price { type: number sql: ${total_revenue} / NULLIF(${count}, 0) ;; }
  measure: user_count { type: count_distinct sql: ${users.id} ;; }
  measure: liquid_sum { type: sum sql: {% if x %} ${sale_price} {% endif %} ;; }
}
explore: order_items {
  join: users {
    type: left_outer
    sql_on: ${order_items.user_id} = ${users.id} ;;
    relationship: many_to_one
  }
}
'''

BIM = {"name": "Sales", "compatibilityLevel": 1550, "model": {
    "tables": [{"name": "Sales", "columns": [{"name": "Amount"}],
                "measures": [{"name": "Total Sales", "expression": "SUM(Sales[Amount])",
                              "description": "All invoiced sales."},
                             {"name": "Margin %", "expression": ["DIVIDE(", "  [Profit],", "  [Total Sales]", ")"]}]}],
    "relationships": [{"name": "r1", "fromTable": "Sales", "fromColumn": "CustomerKey",
                       "toTable": "Customer", "toColumn": "CustomerKey"}]}}

TMDL = '''table Sales
\tlineageTag: 1a2b

\t/// All invoiced sales, in USD.
\tmeasure 'Total Sales' = SUM(Sales[Amount])
\t\tformatString: \\$#,0.00
\t\tlineageTag: 3c4d

\tmeasure Margin =
\t\t\tDIVIDE(
\t\t\t\t[Profit],
\t\t\t\t[Total Sales]
\t\t\t)
\t\tformatString: 0.0%

\tcolumn Amount
\t\tdataType: decimal

relationship 7f8e
\tfromColumn: 'Sales Orders'.CustomerKey
\ttoColumn: Customer.CustomerKey
'''


# ── the mappers ────────────────────────────────────────────────────────────────────────────────────────────────


def test_dbt_simple_and_ratio_metrics_become_sql_and_the_rest_definitions():
    sections, not_translated = bi_models.map_dbt_semantic(DBT)
    assert bi_models.map_dbt_semantic(DBT) == (sections, not_translated)        # deterministic
    metrics = {m["name"]: m for m in sections["metrics"]}
    assert set(metrics) == {"revenue", "orders", "aov"}
    assert metrics["revenue"]["sql"] == "SELECT SUM(amount) AS revenue FROM analytics.orders"
    assert metrics["revenue"]["time_column"] == "analytics.orders.ordered_at"
    assert metrics["revenue"]["additivity"] == "additive" and metrics["revenue"]["schema_name"] == "analytics"
    assert metrics["orders"]["sql"] == "SELECT COUNT(*) AS orders FROM analytics.orders"
    assert metrics["aov"]["sql"] == "SELECT SUM(amount) / NULLIF(COUNT(*), 0) AS aov FROM analytics.orders"
    assert metrics["aov"]["additivity"] == "non_additive"
    # A filter, a derived formula and a semi-additive measure are not guessed at: each is said, and defined.
    said = " | ".join(not_translated)
    for name in ("food_revenue", "net", "balance_total"):
        assert repr(name) in said
    defs = {d["title"]: d for d in sections["definitions"]}
    assert "In dbt: derived as 'revenue - refunds'" in defs["Net"]["body"]
    assert "{{ Dimension('order__is_food') }} = true" in defs["Food revenue"]["body"]
    assert defs["Revenue"]["body"] == "Completed order value, before refunds."
    assert "aliases" not in defs["Revenue"]                     # its code name is its title: no second name
    assert defs["Average order value"]["aliases"] == ["aov"]


def test_lookml_measures_become_metrics_over_the_views_table():
    sections, not_translated = bi_models.map_lookml(LOOKML)
    assert bi_models.map_lookml(LOOKML) == (sections, not_translated)
    m = {x["name"]: x for x in sections["metrics"]}
    assert m["order_items_total_revenue"]["sql"] == (
        "SELECT SUM((order_items.sale_price)) AS order_items_total_revenue FROM thelook.order_items AS order_items")
    assert m["order_items_total_revenue"]["unit"] == "USD"
    assert m["order_items_total_revenue"]["time_column"] == "thelook.order_items.created_at"
    assert m["order_items_count"]["sql"].startswith("SELECT COUNT(*) AS order_items_count FROM thelook.order_items")
    assert m["order_items_complete_count"]["sql"].endswith("WHERE order_items.status = 'Complete'")
    assert m["order_items_returned_count"]["sql"].endswith("WHERE (order_items.returned_at IS NOT NULL)")
    assert "SUM((order_items.sale_price)) / NULLIF(COUNT(*), 0)" in m["order_items_average_price"]["sql"]
    assert m["order_items_average_price"]["additivity"] == "non_additive"
    # Another view's field and Liquid are not translated, and the import says so.
    said = " | ".join(not_translated)
    assert "order_items.user_count" in said and "order_items.liquid_sum" in said
    assert "user_count" not in " ".join(m) and "liquid_sum" not in " ".join(m)
    assert sections["joins"] == [{"title": "order_items joins users", "body": (
        "In LookML's order_items explore, users joins on order_items.user_id = users.id, many to one, "
        "a left outer join.")}]
    assert sections["glossary"] == [{"table": "thelook.order_items",
                                     "columns": {"status": {"description": "Where the item is in fulfilment"}}}]


def test_lookml_that_does_not_parse_is_said():
    with pytest.raises(ValueError, match="could not be read"):
        bi_models.map_lookml("view: broken { sql_table_name: x ")


@pytest.mark.parametrize("sections_of", [lambda: bi_models.map_powerbi_model(BIM), lambda: bi_models.map_tmdl(TMDL)])
def test_power_bi_measures_are_definitions_quoting_their_dax_never_sql(sections_of):
    sections, not_translated = sections_of()
    assert "metrics" not in sections
    defs = {d["title"]: d["body"] for d in sections["definitions"]}
    assert set(defs) in ({"Total Sales", "Margin %"}, {"Total Sales", "Margin"})
    assert defs["Total Sales"].startswith("All invoiced sales")
    assert "DAX: SUM(Sales[Amount])" in defs["Total Sales"]
    margin = defs.get("Margin %") or defs["Margin"]
    assert "DAX: DIVIDE( [Profit], [Total Sales] )" in margin
    assert len(sections["joins"]) == 1 and "CustomerKey = Customer.CustomerKey" in sections["joins"][0]["body"]
    assert not_translated and "not translated into SQL" in not_translated[0]


# ── the file door ──────────────────────────────────────────────────────────────────────────────────────────────


@pytest.fixture()
def stores(tmp_path, monkeypatch):
    monkeypatch.setenv("PRAMANYX_INTAKE_DB", str(tmp_path / "intake.db"))
    monkeypatch.setenv("PRAMANYX_TRUSTED_QUERIES_PATH", str(tmp_path / "tq.json"))
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(tmp_path / "metrics.json"))
    monkeypatch.setenv("PRAMANYX_GLOSSARY_PATH", str(tmp_path / "glossary.yaml"))
    monkeypatch.setenv("PRAMANYX_VOCABULARY_ROOT", str(tmp_path / "vocab"))
    import pramanyx.semantic.connection_kb as kb
    monkeypatch.setattr(kb, "_DATA_DIR", tmp_path / "kb")
    monkeypatch.setattr(kb, "_index_entry", lambda e: None)
    monkeypatch.setattr(kb, "_delete_from_index", lambda c, i: None)
    monkeypatch.setattr(kb, "_invalidate_linker_hints", lambda c: None)
    import pramanyx.semantic.metric_checks as checks
    monkeypatch.setattr(checks, "runs_on", lambda *a, **k: ("unchecked", "test"), raising=False)
    return tmp_path


@pytest.mark.parametrize("name,payload,kinds", [
    ("manifest.json", json.dumps(DBT).encode(), {"metric", "definition"}),
    ("order_items.view.lkml", LOOKML.encode(), {"metric", "definition", "join", "glossary"}),
    ("model.bim", json.dumps(BIM).encode(), {"definition", "join"}),
    ("Sales.tmdl", TMDL.encode(), {"definition", "join"}),
])
def test_each_format_enters_the_one_lane_and_says_what_it_did_not_translate(stores, name, payload, kinds):
    r = client.post("/intake/files", files={"file": (name, payload, "application/octet-stream")},
                    data={"connection_id": CONN, "actor": "ana@example.com"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert {c["kind"] for c in body["candidates"]} == kinds
    assert all(c["status"] == "pending" for c in body["candidates"])
    assert body["mapped"]["not_translated"], "what was not translated is said"
    assert not body["refused"], "and it is not called refused: it came in, as a Definition"


def test_an_accepted_definition_carries_its_aliases_and_area_never_its_provenance_tags(stores, monkeypatch):
    from pramanyx.intake.engine import apply_candidate
    from pramanyx.record.writers import definitions_of

    apply_candidate(CONN, "definition", {"title": "Revenue", "body": "Completed order value.",
                                         "aliases": ["revenue", "turnover"], "tags": ["dictionary", "mined:llm"]},
                    actor="ana@example.com", source="test")
    got = definitions_of(CONN, "Revenue")
    assert len(got) == 1
    assert sorted(got[0].extra.get("aliases") or []) == ["revenue", "turnover"]

    import pramanyx.semantic.areas as areas
    monkeypatch.setattr(areas, "areas_for", lambda c: [{"id": "finance"}])
    apply_candidate(CONN, "definition", {"title": "Margin", "body": "Revenue less cost.", "area": "finance"},
                    actor="ana@example.com", source="test")
    assert [d.extra.get("area") for d in definitions_of(CONN, "Margin")] == ["finance"]
    with pytest.raises(ValueError, match="no area of this connection"):
        apply_candidate(CONN, "definition", {"title": "Churn", "body": "Lost customers.", "area": "made-up"},
                        actor="ana@example.com", source="test")


# ── a whole project, as a .zip (2026-11-17) ───────────────────────────────────────────────────────────────────────

def _zip(files: dict[str, str]) -> bytes:
    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in files.items():
            z.writestr(name, text)
    return buf.getvalue()


MODEL_LKML = '''
explore: orders {
  join: users { type: left_outer sql_on: ${orders.user_id} = ${users.id} ;; relationship: many_to_one }
}
'''


def test_a_lookml_and_power_bi_project_is_read_whole_and_merged():
    data = _zip({"views/order_items.view.lkml": LOOKML, "models/shop.model.lkml": MODEL_LKML,
                 "views/broken.view.lkml": "view: broken { sql_table_name: x ",
                 "definition/tables/Sales.tmdl": TMDL, "README.md": "# the project",
                 "__MACOSX/._order_items.view.lkml": "junk"})
    sections, notes = bi_models.map_project_zip(data)
    assert {m["name"] for m in sections["metrics"]} >= {"order_items_total_revenue", "order_items_count"}
    assert {j["title"] for j in sections["joins"]} == {"order_items joins users", "orders joins users", "Sales Orders joins Customer"}
    assert any(d["title"] == "Total Sales" for d in sections["definitions"])
    said = " | ".join(notes)
    assert "views/broken.view.lkml: the LookML could not be read" in said
    assert "views/order_items.view.lkml: LookML measure order_items.user_count" in said
    assert "1 other file in the archive was not read" in said            # the README; the macOS junk is not counted


def test_an_archive_that_is_not_one_or_is_too_large_is_refused(monkeypatch):
    with pytest.raises(ValueError, match="not a .zip"):
        bi_models.map_project_zip(b"not a zip")
    with pytest.raises(ValueError, match="no .lkml"):
        bi_models.map_project_zip(_zip({"notes.txt": "hello"}))
    monkeypatch.setattr(bi_models, "MAX_TOTAL", 10)
    with pytest.raises(ValueError, match="unpacks to more than"):
        bi_models.map_project_zip(_zip({"a.lkml": LOOKML}))


def test_a_project_archive_enters_the_lane_through_the_file_door(stores):
    r = client.post("/intake/files", files={"file": ("shop-lookml.zip", _zip({"order_items.view.lkml": LOOKML,
                                                                              "shop.model.lkml": MODEL_LKML}), "application/zip")},
                    data={"connection_id": CONN, "actor": "ana@example.com"})
    assert r.status_code == 201, r.text
    assert {c["kind"] for c in r.json()["candidates"]} == {"metric", "definition", "join", "glossary"}
    assert any(n.startswith("order_items.view.lkml: ") for n in r.json()["mapped"]["not_translated"])
