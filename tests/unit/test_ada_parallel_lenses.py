"""The cross-section scan's dimension helpers: the event-dimension classifier, the saturation
detector, and the temporal-axis resolver."""
from __future__ import annotations

import pramanyx.agent.investigate as inv


# ── event-only dimensions ────────────────────────────────────────────────────────

def test_is_event_dim_classifies_by_table():
    # restocked was mis-routed by a name regex; classifying by TABLE catches it as event-only.
    assert inv._is_event_dim("db.return_logistics.restocked") is True
    assert inv._is_event_dim("db.returns.reason") is True
    assert inv._is_event_dim("db.order_items.brand") is False
    assert inv._is_event_dim("db.platforms.segment") is False


# ── #2: saturation detector ─────────────────────────────────────────────────────

def test_is_saturated_flags_tautology_not_uniformity():
    cols = ["reason", "metric_total", "n"]
    # tautology: every group pinned at 0/100% (an event-only rate) → saturated
    assert inv._is_saturated(cols, [["NULL", 0.0, 100], ["late", 1.0, 50], ["quality", 1.0, 40]]) is True
    assert inv._is_saturated(cols, [["a", 100, 5], ["b", 100, 5]]) is True
    # legitimate uniformity (32.4 / 32.8) is a REAL flat finding — never saturated
    assert inv._is_saturated(cols, [["ultra", 32.4, 100], ["luxury", 32.8, 100]]) is False
    # a real spread is obviously not saturated
    assert inv._is_saturated(cols, [["YOOX", 26.9, 100], ["NAP", 40.1, 100]]) is False
    # too few groups → not called
    assert inv._is_saturated(cols, [["only", 100, 5]]) is False


# ── Temporal WHEN lens: axis resolver ──────────────────────────────────────────

_TYPED = {
    "db.order_items": [("order_item_id", "VARCHAR"), ("brand", "VARCHAR"), ("returned", "BOOLEAN")],
    "db.orders": [("order_id", "VARCHAR"), ("order_date", "DATE"), ("gmv_eur", "DOUBLE")],
    "db.returns": [("return_id", "VARCHAR"), ("return_date", "DATE"), ("reason", "VARCHAR")],
}


def test_resolver_prefers_population_date_over_event_date(monkeypatch):
    monkeypatch.setattr(inv, "_typed_columns", lambda s: _TYPED)
    state = {"schema_context": "x", "_ada_intake": {
        "metric_table": "db.order_items",
        "metric_sql": "AVG(CASE WHEN returned THEN 1 ELSE 0 END)",
        "metric_label": "womenswear return rate",
        "dimensions": ["db.order_items.brand", "db.returns.reason"]}}
    axis = inv._resolve_temporal_axis(state)
    # An event-RATE metric must trend on the ORDER/population date, never the event (returns) date.
    assert axis is not None
    assert axis["date_column"] == "db.orders.order_date"


def test_resolver_none_when_no_date(monkeypatch):
    monkeypatch.setattr(inv, "_typed_columns", lambda s: {
        "db.order_items": [("order_item_id", "VARCHAR"), ("returned", "BOOLEAN")]})
    state = {"schema_context": "x", "_ada_intake": {
        "metric_table": "db.order_items", "metric_sql": "AVG(returned)",
        "metric_label": "return rate", "dimensions": []}}
    assert inv._resolve_temporal_axis(state) is None
