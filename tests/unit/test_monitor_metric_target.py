"""One meaning of "off target" (the Atlas plan's A8, 2026-11-25): a threshold monitor with no line of its own, on a metric
that keeps a target, is judged by the metric's own rule — the one Health scores it by — and says so; a monitor's own
line stands as before; a metric with no target judges nothing."""
from __future__ import annotations

from types import SimpleNamespace as NS

import pytest

from pramanyx.monitors import runner
from pramanyx.monitors.models import Monitor


@pytest.fixture
def reading(monkeypatch):
    value = {"now": 0.0}
    monkeypatch.setattr(runner, "_reading_sql", lambda monitor, db: ("SELECT 1", "duckdb"))
    monkeypatch.setattr(runner, "_scalar", lambda db, sql, dialect: value["now"])
    monkeypatch.setattr(runner, "_last_alert_value", lambda mid: None)
    monkeypatch.setattr(runner, "covered_words", lambda: "")
    return value


def _metric(monkeypatch, **kw):
    m = NS(**{"target_value": 100.0, "warning_threshold": 5.0, "critical_threshold": 10.0, "target_direction": "higher", **kw})
    monkeypatch.setattr("pramanyx.semantic.metrics.get_metric", lambda name, connection_id=None, **k: m)


def test_a_monitor_with_no_line_is_judged_by_its_metric_s_target(monkeypatch, reading):
    _metric(monkeypatch)
    monitor = Monitor(conn_id="c", name="Revenue", metric_name="revenue", alert_on="threshold_cross")
    reading["now"] = 88.0
    alert = runner.run_threshold_monitor(monitor, db=None)
    assert alert.severity == "critical" and alert.threshold == 100.0
    assert "short of its metric's target of 100 by more than the metric's critical distance (10)" in alert.message
    reading["now"] = 93.0
    assert runner.run_threshold_monitor(monitor, db=None).severity == "warning"
    reading["now"] = 101.0
    assert runner.run_threshold_monitor(monitor, db=None) is None, "beating a directed target is never off it"


def test_lower_is_better_is_off_target_above_it(monkeypatch, reading):
    _metric(monkeypatch, target_value=2.0, warning_threshold=0.5, critical_threshold=1.0, target_direction="lower")
    monitor = Monitor(conn_id="c", name="Return rate", metric_name="return_rate", alert_on="threshold_cross")
    reading["now"] = 3.5
    assert runner.run_threshold_monitor(monitor, db=None).severity == "critical"
    reading["now"] = 0.4
    assert runner.run_threshold_monitor(monitor, db=None) is None


def test_a_monitor_s_own_line_stands_and_a_metric_with_no_target_judges_nothing(monkeypatch, reading):
    _metric(monkeypatch)
    own = Monitor(conn_id="c", name="Revenue", metric_name="revenue", alert_on="threshold_cross", warning_threshold=50.0,
                  threshold_direction="below")
    reading["now"] = 88.0
    assert runner.run_threshold_monitor(own, db=None) is None, "88 is not below its own line of 50"
    assert runner.metric_target_of(own) is None
    _metric(monkeypatch, target_value=None)
    bare = Monitor(conn_id="c", name="Revenue", metric_name="revenue", alert_on="threshold_cross")
    assert runner.metric_target_of(bare) is None and runner.run_threshold_monitor(bare, db=None) is None
