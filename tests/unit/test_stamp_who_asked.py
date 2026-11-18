"""The warehouse sees the person (punch list 96; the user, 2026-11-18: "Stamp who asked, but we do per-person sign-in
later"). Every connection is queried with its own credentials, so an engine's query history named the connection and
never the person. Each statement a person's question sends now carries who asked, as a comment the engine keeps; platform
plumbing and a statement nobody asked carry nothing, and a name can never close the comment or start a statement."""
from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from pramanyx.db.connection import DuckDBConnection
from pramanyx.db.doors import describe, stamp_asker, through_door
from pramanyx.org.context import reset_user_id, set_user_id


@pytest.fixture
def asker():
    token = set_user_id("ana@example.com")
    yield "ana@example.com"
    reset_user_id(token)


@pytest.fixture
def shop(tmp_path: Path):
    path = tmp_path / "shop.duckdb"
    raw = duckdb.connect(str(path))
    raw.execute("CREATE TABLE orders (order_id INTEGER, city VARCHAR)")
    raw.execute("INSERT INTO orders VALUES (1, 'Mumbai'), (2, 'Pune'), (3, 'Mumbai')")
    raw.close()
    conn = DuckDBConnection(path, connection_id="stamp")
    yield conn
    conn.close()


def test_a_person_s_statement_reaches_the_engine_with_who_asked_and_its_answer_is_unchanged(shop, asker):
    sent: list[str] = []
    ran = shop._run if hasattr(shop, "_run") else None
    assert ran is not None
    result = through_door(shop, "SELECT city, COUNT(*) AS n FROM orders GROUP BY 1 ORDER BY 1;", None,
                          lambda statement: (sent.append(statement), ran("q1", statement, 100))[1])
    assert sent == ["SELECT city, COUNT(*) AS n FROM orders GROUP BY 1 ORDER BY 1\n/* pramanyx asked_by=ana@example.com */"]
    assert [[str(v) for v in r] for r in result.rows] == [["Mumbai", "2"], ["Pune", "1"]]
    assert "stamped" in result.doors and "carries who asked, for the engine's own query history" in describe(result.doors)


def test_the_door_s_own_execute_runs_a_stamped_statement_and_a_bounded_one(shop, asker):
    """Through every gate the connection runs — the safety parse, the audit, and the wrapper that bounds rows."""
    full = shop.execute("q2", "SELECT COUNT(*) AS n FROM orders")
    assert not full.error and str(full.rows[0][0]) == "3" and "stamped" in full.doors
    bounded = shop.execute_bounded("q3", "SELECT city FROM orders ORDER BY order_id", 2)
    assert not bounded.error and [r[0] for r in bounded.rows] == ["Mumbai", "Pune"]


def test_plumbing_and_a_statement_nobody_asked_carry_nothing(shop, asker):
    assert stamp_asker("SELECT 1", internal=True) == "SELECT 1"
    from pramanyx.org.context import current_actor
    reset = set_user_id("")
    try:
        assert current_actor() == "" and stamp_asker("SELECT 1") == "SELECT 1"
    finally:
        reset_user_id(reset)
    assert stamp_asker("   ") == "   "


def test_a_name_can_never_close_the_comment_or_start_a_statement():
    token = set_user_id("x*/; DROP TABLE orders; --@ex.com")
    try:
        out = stamp_asker("SELECT 1")
    finally:
        reset_user_id(token)
    assert out == "SELECT 1\n/* pramanyx asked_by=xdroptableorders--@ex.com */"
    assert out.count("*/") == 1 and ";" not in out
