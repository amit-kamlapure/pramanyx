"""Stage 2 of the Ask panel (the user, 2026-11-19): the conversation knows where data comes from and what the platform
holds over it — how a table was made (a file or sheet brought in, a dbt model and what it is built from), what depends on
it, and what a dashboard or a Definition is. Each read says what it did not cover, and never names a dashboard the asker
neither keeps nor was shared."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from pramanyx.agent import origin_tools as O

MANIFEST = {
    "nodes": {
        "model.shop.orders": {
            "resource_type": "model", "name": "orders", "alias": "orders", "schema": "analytics",
            "config": {"materialized": "table"}, "description": "One row per order, cancelled ones left out.",
            "raw_code": "select * from {{ ref('stg_orders') }} where status != 'cancelled'",
            "compiled_code": "select * from analytics.stg_orders where status != 'cancelled'",
            "depends_on": {"nodes": ["model.shop.stg_orders"]},
        },
        "model.shop.stg_orders": {
            "resource_type": "model", "name": "stg_orders", "schema": "analytics", "config": {"materialized": "view"},
            "raw_code": "select * from {{ source('raw', 'orders') }}",
            "depends_on": {"nodes": ["source.shop.raw.orders"]},
        },
        "test.shop.not_null": {"resource_type": "test", "name": "orders"},
    },
    "sources": {
        "source.shop.raw.orders": {"resource_type": "source", "name": "orders", "identifier": "orders", "schema": "raw",
                                   "loader": "fivetran"},
    },
}


def test_reads_a_dbt_model_its_sql_and_what_it_is_built_from():
    [model] = O.dbt_model_of(MANIFEST, "analytics.orders")
    assert model["source"] == "a dbt model" and model["materialized"] == "table"
    assert "cancelled" in model["sql_as_written"] and "analytics.stg_orders" in model["sql_as_compiled"]
    assert model["built_from"] == [{"unique_id": "model.shop.stg_orders", "table": "analytics.stg_orders", "kind": "model"}]
    # one step further back, the staging model is built from a source, loaded by a tool the manifest names
    [stg] = O.dbt_model_of(MANIFEST, "stg_orders")
    assert stg["built_from"][0]["table"] == "raw.orders"
    [raw] = O.dbt_model_of(MANIFEST, "raw.orders")
    assert raw["source"] == "a dbt source" and raw["loaded_by"] == "fivetran"


def test_a_named_schema_keeps_a_model_of_the_same_name_elsewhere_out():
    assert [m["unique_id"] for m in O.dbt_model_of(MANIFEST, "orders")] == ["model.shop.orders", "source.shop.raw.orders"]
    assert O.dbt_model_of(MANIFEST, "other.orders") == []


@pytest.fixture
def nothing_else(monkeypatch):
    """No sheet, no files, and the organisation does not allow reading the warehouse's query history."""
    monkeypatch.setattr(O, "_from_uploads", lambda *_a: ([], "this connection holds no files brought in through the platform"))
    monkeypatch.setattr("pramanyx.orgsettings.allows.allows", lambda _s: False)
    monkeypatch.delenv("PRAMANYX_DBT_MANIFEST", raising=False)


def test_says_plainly_where_no_source_covers_a_table(nothing_else):
    out = O.table_origin("thelook", {"table": "orders"})
    assert out["found"] is False and out["origins"] == []
    assert "No source the platform reads says how orders was made." == out["summary"]
    said = " ".join(out["not_covered"])
    assert "no dbt manifest is configured" in said
    assert "does not allow reading the warehouse's query history" in said
    assert "Pipelines run outside Pramanyx" in said


def test_reads_the_configured_manifest(nothing_else, monkeypatch, tmp_path):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(MANIFEST))
    monkeypatch.setenv("PRAMANYX_DBT_MANIFEST", str(path))
    out = O.table_origin("thelook", {"table": "analytics.orders"})
    assert out["found"] is True and out["origins"][0]["unique_id"] == "model.shop.orders"


def test_says_the_query_history_cannot_say_how_a_table_was_made_when_it_is_allowed(nothing_else, monkeypatch):
    monkeypatch.setattr("pramanyx.orgsettings.allows.allows", lambda _s: True)
    said = " ".join(O.table_origin("thelook", {"table": "orders"})["not_covered"])
    assert "not for the statements that create or fill tables" in said


def test_reads_the_record_of_a_file_brought_in(monkeypatch):
    files = [{"table_name": "complaints", "schema": "main", "source_file": "complaints.csv", "format": "csv",
              "created_at": "2026-11-01T10:00:00Z", "size_bytes": 900},
             {"table_name": "other", "schema": "main", "source_file": "other.csv"}]
    monkeypatch.setattr("pramanyx.db.connection.open_connection_for", lambda _c: SimpleNamespace(list_files=lambda: files))
    found, why = O._from_uploads("workspace", "main.complaints")
    assert why == "" and [f["file"] for f in found] == ["complaints.csv"]
    assert found[0]["who"].startswith("not recorded")                    # said, never implied


def _row(key, cards, *, published_to=None, title="T"):
    return {"natural_key": key, "payload": {"cards": cards, "published_to": published_to or [],
                                            "spec": {"root": "r", "elements": {"r": {"props": {"title": title}}}}}}


def test_names_only_the_dashboards_the_asker_keeps_or_was_shared_and_counts_the_rest(monkeypatch):
    from pramanyx.dashboards import home, sharing, versions
    cards = [SimpleNamespace(id="c1", title="Orders by day", sql="SELECT day, COUNT(*) FROM orders GROUP BY 1",
                             provenance=SimpleNamespace(superseded_by=None)),
             SimpleNamespace(id="c2", title="Users", sql="SELECT COUNT(*) FROM users",
                             provenance=SimpleNamespace(superseded_by=None))]
    monkeypatch.setattr("pramanyx.cards.store.list_cards", lambda **_k: cards)
    mine, theirs, shared = (home.prefix("thelook", "ana") + "d1", home.prefix("thelook", "bo") + "d2",
                            home.prefix("thelook", "cy") + "d3")
    rows = [_row(mine, ["c1", "c2"], title="Mine"), _row(theirs, ["c1"], title="Bo's secret"),
            _row(shared, ["c1"], title="Cy's shared", published_to=[{"kind": "group", "id": "g1"}])]
    monkeypatch.setattr("pramanyx.kernel.ledger.Ledger.default",
                        staticmethod(lambda: SimpleNamespace(artifacts_of_kind=lambda *_a, **_k: rows)))
    monkeypatch.setattr(versions, "is_mine", lambda _r: True)
    monkeypatch.setattr(sharing, "audience_of", lambda _p: {"groups": [{"kind": "group", "id": "g1"}], "roles": []})
    out = O.dashboards_reading("thelook", "orders", "ana")
    assert out["cards_reading"] == 1 and out["cards_on_no_dashboard"] == 0
    assert [(d["dashboard"], d["yours"], d["cards"]) for d in out["dashboards"]] == [
        ("Mine", True, ["Orders by day"]), ("Cy's shared", False, ["Orders by day"])]
    assert out["dashboards_not_yours"] == 1
    assert "Bo's secret" not in json.dumps(out)


def test_says_what_depends_on_a_table_and_what_it_does_not_cover(monkeypatch):
    from pramanyx.govern.lineage import Dependent, LineageReport
    report = LineageReport(root="orders")
    report.dependents.append(Dependent(node_id="metric:aov", kind="metric", label="Average order value", depth=1,
                                       via="grounded_in", site="", site_kind="", site_line=0))
    monkeypatch.setattr("pramanyx.govern.lineage.dependents_of_table", lambda *_a, **_k: report)
    monkeypatch.setattr(O, "dashboards_reading", lambda *_a: {"dashboards": [], "dashboards_not_yours": 0, "cards_reading": 2,
                                                             "cards_on_no_dashboard": 1})
    monkeypatch.setattr("pramanyx.db.connection.open_connection_for", lambda _c: SimpleNamespace(dialect="bigquery"))
    out = O.table_dependents("thelook", {"table": "orders"}, person="ana")
    assert out["summary"] == "1 metric, 2 cards (1 on no dashboard now) depend on orders."
    assert out["lineage"]["dependents"][0]["label"] == "Average order value"
    assert "outside Pramanyx" in out["does_not_cover"]


def test_explains_a_definition_and_names_the_known_ones_when_the_word_has_none(monkeypatch):
    from pramanyx.record import writers
    claim = SimpleNamespace(statement=SimpleNamespace(text="A customer who ordered in the last 90 days."),
                            extra={"term": "active customer", "area": "Sales"}, owner="ana", status="Verified",
                            version=2, recorded_at="2026-11-10")
    monkeypatch.setattr(writers, "definitions_of", lambda _c, t: [claim] if t == "active customer" else [])
    monkeypatch.setattr(writers, "definitions", lambda _c, **_k: [claim])
    got = O.explain_definition("thelook", {"term": "active customer"})
    assert got["found"] and got["definitions"][0]["means"].startswith("A customer who ordered")
    missing = O.explain_definition("thelook", {"term": "churned"})
    assert missing["found"] is False and missing["known_terms"] == ["active customer"]


def test_explains_one_of_the_askers_dashboards_its_pages_filters_and_cards(monkeypatch):
    from pramanyx.agent import ask_subject
    from pramanyx.dashboards import versions
    monkeypatch.setattr(versions, "of_person", lambda _c, _p: [{"dashboard_id": "d1", "title": "Operations", "version": 4,
                                                                "kept_at": "2026-11-18", "published_to": []}])
    spec = {"root": "r", "elements": {
        "r": {"props": {"title": "Operations"}},
        "t1": {"type": "Tab", "props": {"label": "Main"}}, "t2": {"type": "Tab", "props": {"label": "Returns"}},
        "f": {"type": "GlobalFilter", "props": {"title": "Ordered", "table": "orders", "column": "created_at", "type": "dates"}},
        "c": {"type": "Card", "props": {"card": "c1", "not_filtered": True}},
    }}
    monkeypatch.setattr(ask_subject, "dashboard_spec", lambda *_a: (spec, ""))
    card = SimpleNamespace(title="Orders", sql="SELECT 1", kind="chart", render={"shown": {"as": "bar"}})
    monkeypatch.setattr("pramanyx.cards.store.get_card", lambda _i: card)
    out = O.explain_dashboard("thelook", {"dashboard": "operations"}, person="ana")
    assert out["found"] and out["pages"] == ["Main", "Returns"]
    assert out["filters"] == [{"title": "Ordered", "table": "orders", "column": "created_at", "type": "dates"}]
    assert out["cards"] == [{"title": "Orders", "drawn_as": "bar", "own_query": True, "sql": "SELECT 1", "not_cut_by_filters": True}]
    listed = O.explain_dashboard("thelook", {}, person="ana")
    assert listed["found"] is False and listed["dashboards"] == [{"id": "d1", "title": "Operations"}]


def test_the_conversation_holds_the_four_reads():
    from pramanyx.agent.converse_tools import converse_tools
    names = {t.name for t in converse_tools("c1", person="ana")}
    assert {"table_dependents", "table_origin", "explain_dashboard", "explain_definition"} <= names
