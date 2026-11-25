"""A column's use, read from the warehouse's own history (the user, 2026-11-25: "Catalog extras: … column popularity";
asked which reads count a column, "Warehouse query history").

What people ran in the warehouse, the platform's own statements left out and counted apart, mined once and kept; read
again in the background after six hours. Said, never implied: the read off for the organisation, the engine refusing it
with the admin's step, the first read under way.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace as NS

import pytest

from pramanyx.db.query_history import HistoryRow, QueryHistory
from pramanyx.sql import popularity as P


@pytest.fixture
def conn():
    return f"use-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def allowed(monkeypatch):
    monkeypatch.setattr("pramanyx.orgsettings.allows.allows", lambda what: what == "read_query_history")


def _history(rows, *, error=""):
    return QueryHistory(engine="postgres", supported=True, rows=rows, hours=336, source="pg_stat_statements",
                        error=error)


@pytest.fixture
def warehouse(monkeypatch):
    """The connection's door, its history and its readiness — each set by a test."""
    said = {"history": _history([]), "readiness": "Query history: ready", "opened": 0}

    class Door:
        def close(self):
            pass

    def opened(cid):
        said["opened"] += 1
        return Door()

    monkeypatch.setattr("pramanyx.db.connection.open_connection_for", opened)
    monkeypatch.setattr("pramanyx.db.query_history.read_query_history", lambda db, **k: said["history"])
    monkeypatch.setattr("pramanyx.db.query_history.check_query_history",
                        lambda db: NS(sentence=lambda: said["readiness"]))
    monkeypatch.setattr("pramanyx.db.registry.get_conn_type", lambda cid: "postgres")
    return said


def test_off_for_the_organisation_it_says_where_an_admin_turns_it_on(monkeypatch, conn, warehouse):
    monkeypatch.setattr("pramanyx.orgsettings.allows.allows", lambda what: False)
    got = P.column_use(conn, "orders", wait=True)
    assert got["columns"] == {} and "off for this organisation" in got["said"][0]
    assert warehouse["opened"] == 0                                    # nothing was read


def test_what_people_ran_is_counted_by_its_runs_and_the_platforms_own_left_out(allowed, conn, warehouse):
    from pramanyx.db.signing import sign
    warehouse["history"] = _history([
        HistoryRow(ended_at="", sql="SELECT status, COUNT(*) FROM orders GROUP BY status", calls=3),
        HistoryRow(ended_at="", sql="SELECT o.user_id FROM orders o WHERE o.status = 'Complete'", calls=1),
        HistoryRow(ended_at="", sql=sign("SELECT created_at FROM orders"), calls=50),       # the platform's own
    ])
    got = P.column_use(conn, "orders", wait=True)
    assert got["columns"]["status"] == 4 and got["columns"]["user_id"] == 1
    assert "created_at" not in got["columns"]
    assert got["ours"] == {"statements": 1, "calls": 50} and got["statements"] == 2 and got["said"] == []
    assert P.column_use(conn, "users", wait=True)["columns"] == {}      # another table's columns are not these


def test_a_refused_read_says_the_engines_reason_and_the_admins_step(allowed, conn, warehouse):
    warehouse["history"] = _history([], error="403 Access Denied")
    warehouse["readiness"] = "Query history: not readable yet: 403 Access Denied — needs bigquery.jobs.list"
    got = P.column_use(conn, "orders", wait=True)
    assert got["columns"] == {} and got["said"] == [warehouse["readiness"]]


def test_what_is_kept_is_read_and_the_warehouse_is_not_asked_again_while_it_is_fresh(allowed, conn, warehouse):
    warehouse["history"] = _history([HistoryRow(ended_at="", sql="SELECT status FROM orders", calls=2)])
    P.column_use(conn, "orders", wait=True)
    opened = warehouse["opened"]
    assert P.column_use(conn, "orders")["columns"] == {"status": 2}
    assert warehouse["opened"] == opened


def test_never_read_it_says_it_is_being_read(allowed, conn, warehouse, monkeypatch):
    started = []
    monkeypatch.setattr(P.threading, "Thread", lambda **k: NS(start=lambda: started.append(k["name"])))
    got = P.column_use(conn, "orders")
    assert got["columns"] == {} and "being read" in got["said"][0]
    assert started == [f"column-use-{conn}"]
