"""What changed about a table, and when (the user, 2026-11-25, "Catalog extras: table history").

One record per change, never per look: columns added, taken away or retyped, its row count moving (said at most once a
day), and a person's edit of its words with who. The first shape kept is when watching began, not a change.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

import pytest

from pramanyx.db import table_history as H

T0 = datetime(2026, 11, 25, 8, 0, tzinfo=timezone.utc)


@pytest.fixture
def conn():
    return f"hist-{uuid.uuid4().hex[:8]}"


def _orders(rows=100, **columns):
    cols = {"order_id": "INT64", "status": "STRING", **columns}
    return {"name": "thelook.orders", "row_count": str(rows),
            "columns": [{"name": n, "type": t} for n, t in cols.items() if t]}


def test_the_first_shape_kept_is_when_watching_began_not_a_change(conn):
    assert H.record_shapes(conn, [_orders()], now=T0) == []
    got = H.history(conn, "orders")
    assert got["changes"] == [] and got["since"] == T0.isoformat()
    assert H.history(conn, "users") == {"changes": [], "since": None}


def test_columns_added_taken_away_or_retyped_are_one_change(conn):
    H.record_shapes(conn, [_orders()], now=T0)
    assert H.record_shapes(conn, [_orders()], now=T0 + timedelta(minutes=5)) == []        # a look is not a change
    changed = H.record_shapes(conn, [_orders(order_id="STRING", status=None, returned_at="TIMESTAMP")],
                              now=T0 + timedelta(hours=1))
    assert changed == [{"table": "thelook.orders", "added": ["returned_at"], "removed": ["status"],
                        "retyped": [{"column": "order_id", "from": "INT64", "to": "STRING"}]}]
    (only,) = H.history(conn, "thelook.orders")["changes"]
    assert only["added"] == ["returned_at"] and only["removed"] == ["status"] and only["by"] == ""


def test_a_row_count_moving_is_said_at_most_once_a_day(conn):
    H.record_shapes(conn, [_orders(rows=100)], now=T0)
    assert H.record_shapes(conn, [_orders(rows=120)], now=T0 + timedelta(hours=2)) == []
    assert H.record_shapes(conn, [_orders(rows=125)], now=T0 + timedelta(hours=21)) == [
        {"table": "thelook.orders", "rows": {"from": 100, "to": 125}}]
    assert H.record_shapes(conn, [_orders(rows=130)], now=T0 + timedelta(hours=22)) == []
    assert [c["rows"] for c in H.history(conn, "orders")["changes"]] == [{"from": 100, "to": 125}]


def test_a_persons_edit_of_its_words_is_in_its_history_with_who(conn):
    H.record_shapes(conn, [_orders()], now=T0)
    H.note_words(conn, "thelook.orders", ["status.caveats", "description"], "ana@example.com")
    (edit,) = H.history(conn, "orders")["changes"]
    assert edit["words"] == ["description", "status.caveats"] and edit["by"] == "ana@example.com"
    assert H.history(f"{conn}-other", "orders")["changes"] == []                            # another connection's


def test_one_table_is_not_another_schemas_of_the_same_name():
    assert H._same_table("orders", "thelook.orders") and H._same_table("thelook.orders", "THELOOK.ORDERS")
    assert not H._same_table("shop.orders", "thelook.orders") and not H._same_table("orders", "order_items")


def test_the_doors_journal_a_persons_edit_for_a_connection_and_never_an_agents(monkeypatch):
    from pramanyx.mcp.client import AGENT_HEADER, AGENT_MARK
    from pramanyx.routers import knowledge as K
    heard = []
    monkeypatch.setattr(K, "update_table", lambda *a, **k: None)
    monkeypatch.setattr(K, "update_column", lambda *a, **k: None)
    monkeypatch.setattr("pramanyx.db.table_history.note_words", lambda c, t, f, by: heard.append((c, t, f)))
    person = NS(headers={}, state=NS(principal=None))
    agent = NS(headers={AGENT_HEADER: AGENT_MARK}, state=NS(principal=None))
    K.put_table_glossary("orders", K.UpdateTableRequest(description="x"), person, schema="thelook", connection_id="c1")
    K.put_column_glossary("orders", "status", K.UpdateColumnRequest(caveats="y"), person, schema="thelook",
                          connection_id="c1")
    K.put_column_glossary("orders", "status", K.UpdateColumnRequest(caveats="z"), agent, connection_id="c1")
    K.put_table_glossary("orders", K.UpdateTableRequest(description="w"), person)              # no connection
    assert heard == [("c1", "thelook.orders", ["description"]), ("c1", "thelook.orders", ["status.caveats"])]
