"""A deep report's METRIC TARGETS block names only the run's own connection's metrics.

Found 2026-11-27: the write-up's block read every metric on the install (`list_metrics()` with no
connection), so a target another connection declared entered this report's prompt as a benchmark to
compare against. The block now reads the catalogue the way every other reader does — the run's
connection, and its dataset when the run is scoped to one.
"""
from __future__ import annotations

import inspect

import pytest

from pramanyx.agent import investigate as INV
from pramanyx.semantic import metrics as M


def _metric(name, connection, label, target, schema=None):
    return {"name": name, "connection": connection, "label": label, "sql": "SUM(x)",
            "target_value": target, "schema_name": schema}


@pytest.fixture
def catalogue(monkeypatch):
    rows = [
        _metric("refund_rate", "conn_a", "Refund rate A", 2.5),
        _metric("late_rate", "conn_b", "Late rate B", 9.0),
        _metric("margin_marts", "conn_a", "Margin on marts", 30.0, schema="marts"),
        _metric("margin_staging", "conn_a", "Margin on staging", 31.0, schema="staging"),
    ]
    monkeypatch.setattr(M, "_view", lambda: [dict(r) for r in rows])
    monkeypatch.setattr(M, "_folded_scopes", lambda connection_id: [])
    monkeypatch.setattr(M, "organisation_of", lambda connection_id: "")
    return rows


def test_another_connections_targets_stay_out(catalogue):
    section = INV._metric_targets_section("conn_a")
    assert "Refund rate A: target=2.5" in section
    assert "Late rate B" not in section


def test_a_scoped_run_reads_its_own_datasets_targets(catalogue):
    section = INV._metric_targets_section("conn_a", "staging")
    assert "Refund rate A" in section and "Margin on staging" in section
    assert "Margin on marts" not in section


def test_a_run_with_no_connection_is_given_no_targets(catalogue):
    assert INV._metric_targets_section("") == ""


def test_the_write_up_reads_the_scoped_block():
    """The node passes the run's connection and dataset, rather than reading the catalogue itself."""
    src = inspect.getsource(INV.ada_synthesize)
    assert "_metric_targets_section(state.get(\"connection_id\")" in src
    assert "list_metrics()" not in src
