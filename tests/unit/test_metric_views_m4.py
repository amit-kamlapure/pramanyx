"""The metric-views plan's M4 — metadata (`docs/METRIC_VIEWS_PLAN_2026-11-25.md` §4.6).

A metric's format is declared once, in the vocabulary store's `FormatSpec`, and handed with its figures; the words
people call it live in the one store of synonyms and are read by the answer path's matching and Discover's search (a
model's proposal is not); `additivity` means one thing — may its figures be summed, across groups and across periods.
"""
from __future__ import annotations

import uuid

import pytest

from pramanyx.semantic.metrics import MetricDefinition, metrics_named_in, save_metric


@pytest.fixture
def conn(tmp_path, monkeypatch):
    path = tmp_path / "metrics.json"
    path.write_text("[]")
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(path))
    c = "m4" + uuid.uuid4().hex[:6]
    save_metric(MetricDefinition(name="revenue", label="Revenue", connection=c, source="order_items",
                                 measure="SUM(sale_price)", sql="SELECT SUM(sale_price) AS revenue FROM order_items"))
    return c


def _row(client, conn, name="revenue"):
    return next(m for m in client.get(f"/metrics?connection_id={conn}").json() if m["name"] == name)


def test_the_words_people_call_a_metric_are_kept_and_read(client, conn):
    from pramanyx.ontology import vocabulary
    r = client.put("/metrics/revenue/synonyms", json={"connection": conn, "add": ["turnover", "  sales  "]})
    assert r.status_code == 200 and sorted(r.json()["synonyms"]) == ["sales", "turnover"]
    assert sorted(_row(client, conn)["synonyms"]) == ["sales", "turnover"]
    assert [m.name for m in metrics_named_in("What was our turnover last month?", conn)] == ["revenue"]
    vocabulary.add_synonym(conn, "metric", "revenue", "takings", source="llm_candidate")
    assert metrics_named_in("what were the takings", conn) == [], "a model's proposal is not a word people use"
    client.put("/metrics/revenue/synonyms", json={"connection": conn, "remove": ["sales"]})
    assert _row(client, conn)["synonyms"] == ["turnover"]
    assert client.put("/metrics/nope/synonyms", json={"connection": conn, "add": ["x"]}).status_code == 404


def test_a_metrics_format_is_declared_once_and_handed_with_it(client, conn):
    r = client.put("/metrics/revenue/format", json={"connection": conn, "format": "currency", "currency": "eur", "decimals": 2})
    assert r.status_code == 200 and r.json()["format"]["currency"] == "EUR"
    assert _row(client, conn)["format"] == {"display_name": "", "format": "currency", "decimals": 2, "currency": "EUR", "compact": False}
    assert client.put("/metrics/revenue/format", json={"connection": conn, "format": "currency", "currency": "euro"}).status_code == 422
    assert client.put("/metrics/revenue/format", json={"connection": conn, "format": "date"}).status_code == 422
    assert client.put("/metrics/revenue/format", json={"connection": conn}).json() == {"metric": "revenue", "format": None}
    assert _row(client, conn)["format"] is None


def test_discover_finds_a_metric_by_the_words_people_call_it():
    from pramanyx.discover.items import Item
    from pramanyx.discover.search import words_score
    item = Item(kind="metric", id="c/revenue", name="Revenue", line="Gross booked sales", connection_id="c",
                connection_name="theLook", detail={"synonyms": ["turnover"]})
    score, why = words_score(item, ["turnover"])
    assert score == 1.0 and why == "its name"


def test_additivity_means_one_thing_across_groups_and_periods():
    from pramanyx.semantic.metrics import metric_additivity
    avg = MetricDefinition(name="avg_price", label="Average price", connection="c", sql="SELECT AVG(price) FROM t")
    assert metric_additivity(avg) is False
    assert metric_additivity(avg.model_copy(update={"additivity": "additive"})) is True, "a declaration overrides the inference"
    assert "across groups and across periods" in MetricDefinition.model_fields["additivity"].description
