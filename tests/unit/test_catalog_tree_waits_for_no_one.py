"""One catalog that does not answer does not hold the Catalog (2026-11-16).

Found live: after the machine slept, one catalog's metadata read hung on a connection that had died with the sleep,
and because the tree waited for its slowest catalog, "Loading the catalog…" stood for 153 seconds while every other
catalog had answered in under three. Each reload started another read of the same catalog behind it.
"""
from __future__ import annotations

import asyncio
import threading
import time

import pytest

from pramanyx.routers import catalog as catalog_router

HUNG = threading.Event()


@pytest.fixture
def two_catalogs(monkeypatch):
    """A catalog that answers and one that hangs until released; how often each is read."""
    import pramanyx.metastore as ms

    monkeypatch.setattr(ms, "set_catalog_schemas", lambda *a, **k: 0)
    monkeypatch.setattr(ms, "accessible_catalog_ids", lambda ws: None)
    monkeypatch.setattr("pramanyx.db.registry.list_connections", lambda *a, **k: [
        {"id": "fast", "name": "Fast", "conn_type": "duckdb", "builtin": False},
        {"id": "slow", "name": "Slow", "conn_type": "bigquery", "builtin": False},
    ])
    reads = {"fast": 0, "slow": 0}

    def read(conn_id, conn_type):
        reads[conn_id] += 1
        if conn_id == "slow":
            HUNG.wait(5)
            return [{"name": "thelook", "tables": [{"name": "orders", "row_count": 7}]}]
        return [{"name": "main", "tables": [{"name": "a", "row_count": 1}]}]

    monkeypatch.setattr(catalog_router, "quick_schemas", read)
    monkeypatch.setattr(catalog_router, "TREE_WAIT_SECONDS", 0.3)
    monkeypatch.setattr(catalog_router, "_reading", {})
    monkeypatch.setattr(catalog_router, "_last_read", {})
    HUNG.clear()
    yield reads
    HUNG.set()


def _tree() -> dict:
    return {e["conn_id"]: e for e in asyncio.run(catalog_router.get_catalog_tree())["sections"][0]["entries"]}


def test_the_tree_answers_without_the_catalog_that_hangs_and_says_so(two_catalogs):
    started = time.monotonic()
    tree = _tree()
    assert time.monotonic() - started < 2.0                     # not the hung read's time
    assert tree["fast"]["read"] == "now" and tree["fast"]["schemas"][0]["name"] == "main"
    # Never read before: no schemas, and said to be still reading — not a catalog with nothing in it.
    assert tree["slow"]["read"] == "reading" and tree["slow"]["schemas"] == [] and tree["slow"]["read_at"] == ""


def test_a_catalog_still_reading_is_read_once_however_often_the_page_asks(two_catalogs):
    for _ in range(3):
        _tree()
    assert two_catalogs["slow"] == 1                              # the reloads joined the read under way
    assert two_catalogs["fast"] == 3


def test_once_read_it_is_shown_and_while_read_again_it_shows_what_it_held_then(two_catalogs):
    _tree()
    HUNG.set()                                                    # the slow catalog answers
    time.sleep(0.2)
    tree = _tree()
    assert tree["slow"]["read"] == "now" and tree["slow"]["schemas"][0]["name"] == "thelook"
    # It hangs again: the tree shows what it held at its last read, and when that was.
    HUNG.clear()
    tree = _tree()
    assert tree["slow"]["read"] == "earlier"
    assert tree["slow"]["schemas"][0]["tables"][0]["name"] == "orders"
    assert tree["slow"]["read_at"].endswith("Z")


def test_a_catalog_whose_read_breaks_is_could_not_look_and_never_the_trees_end(two_catalogs, monkeypatch):
    def broken(conn_id, conn_type):
        if conn_id == "slow":
            raise RuntimeError("socket closed")
        return [{"name": "main", "tables": []}]
    monkeypatch.setattr(catalog_router, "quick_schemas", broken)
    tree = _tree()
    assert tree["slow"]["read"] == "failed" and tree["slow"]["schemas"] == []
    assert tree["fast"]["read"] == "now"
