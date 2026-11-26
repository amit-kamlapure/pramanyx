"""What statements show, through one door (the Atlas plan's A7, 2026-11-25): the warehouse's history (an organisation's
setting), the platform's own dashboards, Data Canvases and saved queries, and the SQL answers ran — each mined on its
own, so each usage claim says where it came from; and the whole run once a UTC day."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

from pramanyx.kernel.ledger import Ledger
from pramanyx.ontology import statement_mining as M


def test_each_statement_is_mined_once_weighed_by_how_many_hold_it():
    statements, weights = M.weighed(["SELECT 1 FROM t;", "SELECT  1\n FROM t", "SELECT 2", "", "  "])
    assert (statements, weights) == (["SELECT 1 FROM t", "SELECT 2"], [2, 1])


def test_the_platform_s_own_work_is_read_and_a_store_that_fails_is_said(monkeypatch):
    monkeypatch.setattr("pramanyx.cards.store.list_cards", lambda connection_id=None, scope=None, scope_ref=None: [
        NS(kind="chart", sql="SELECT a FROM orders"), NS(kind="note", sql=""), NS(kind="metric", sql="SELECT b FROM users")])

    def broken(connection_id=None):
        raise RuntimeError("store away")
    monkeypatch.setattr("pramanyx.savedquery.store.list_saved_queries", broken)
    sqls, unread = M.our_own_statements("c1")
    assert sqls == ["SELECT a FROM orders", "SELECT b FROM users"] and unread == ["saved queries"]


def test_the_sql_answers_ran_is_read_from_the_last_month_s_receipts():
    conn = "c" + uuid.uuid4().hex[:8]
    led = Ledger.default()
    led.artifact_write("chat_answer", f"chat:{conn}:{uuid.uuid4().hex[:8]}", {"question": "q"}, conn_id=conn,
                       lineage=[("source_sql", "sql", "SELECT x FROM orders")])
    old = led.artifact_write("chat_answer", f"chat:{conn}:{uuid.uuid4().hex[:8]}", {"question": "q"}, conn_id=conn,
                             lineage=[("source_sql", "sql", "SELECT y FROM orders")])
    with led._lock, led._conn:
        led._conn.execute("UPDATE artifacts SET created_at=? WHERE id=?",
                          ((datetime.now(timezone.utc) - timedelta(days=M.ANSWERS_DAYS + 5)).isoformat(), old))
    assert M.answers_statements(conn) == ["SELECT x FROM orders"]


def test_each_source_is_mined_on_its_own_and_says_where_it_came_from(monkeypatch):
    calls = []
    monkeypatch.setattr("pramanyx.ontology.store.load_latest_ontology", lambda c, s=None: NS(schema_name="s"))
    monkeypatch.setattr("pramanyx.db.connection.open_connection_for_with_schema", lambda c, s: NS(close=lambda: None))
    monkeypatch.setattr(M, "our_own_statements", lambda c: (["SELECT a FROM orders"], ["saved queries"]))
    monkeypatch.setattr(M, "answers_statements", lambda c: ["SELECT b FROM orders", "SELECT b FROM orders"])
    monkeypatch.setattr(M, "mine_and_book", lambda conn, graph, db, statements, weights, **k: calls.append(
        (statements, weights, k["source"], k["came_from"], k["book"])) or {"offered": [], "refused": []})
    out = M.mine_our_own("c1", book=True)
    assert calls == [(["SELECT a FROM orders"], [1], M.OUR_OWN, M.OUR_OWN, True),
                     (["SELECT b FROM orders"], [2], M.ANSWERS, M.ANSWERS, True)]
    assert out["said"] == ["Not read: saved queries."]
    monkeypatch.setattr("pramanyx.ontology.store.load_latest_ontology", lambda c, s=None: None)
    assert M.mine_our_own("c1")["said"] == ["No ontology is built on this connection."]


def test_a_claim_booked_from_our_own_work_says_so_in_the_learned_list():
    from pramanyx.knowledge.learned import learned_items
    from pramanyx.record.writers import book_usage_claims
    conn = "c" + uuid.uuid4().hex[:8]
    candidate = NS(kind="filter", proposal="status = 'Complete'", subject="orders.status", evidence="in 3 statements")
    book_usage_claims(connection_id=conn, candidates=[candidate], source=M.OUR_OWN, came_from=M.OUR_OWN)
    [item] = [i for i in learned_items(conn, limit=50)["items"] if i["kind"] == "usage"]
    assert item["source"] == M.OUR_OWN and item["author"] == M.OUR_OWN
    other = "c" + uuid.uuid4().hex[:8]
    book_usage_claims(connection_id=other, candidates=[candidate], source="pg_stat_statements")
    [item] = [i for i in learned_items(other, limit=50)["items"] if i["kind"] == "usage"]
    assert item["source"] == "the warehouse's query history", "the warehouse's, as before"


def test_the_daily_mining_runs_once_a_day_reads_the_warehouse_only_where_allowed_and_a_failure_leaves_the_rest(monkeypatch):
    monkeypatch.setattr(M, "_last_day", "")
    monkeypatch.setattr("pramanyx.kernel.once_a_day.first_today", lambda name, day: True)
    monkeypatch.setattr("pramanyx.db.registry.list_connections", lambda: [{"id": "c1"}, {"id": "c2"}, {"id": "c3"}])

    def own(c, book=True):
        if c == "c2":
            raise RuntimeError("no such warehouse")
        return {"sources": {M.OUR_OWN: {"booked": {"booked": ["a", "b"]}}, M.ANSWERS: {"statements": 0}}}
    monkeypatch.setattr(M, "mine_our_own", own)
    history = []
    monkeypatch.setattr(M, "_mine_history", lambda c: history.append(c) or 1)
    allowed = {"read_query_history": False}
    monkeypatch.setattr("pramanyx.orgsettings.allows.allows", lambda s: allowed.get(s, False))
    day = datetime(2026, 11, 26, 3, tzinfo=timezone.utc)
    assert M.run_mining_daily(now=day) == 4, "c1 and c3 booked two each; c2 failed and the rest still ran"
    assert history == [], "the warehouse's history is not read while the organisation has not allowed it"
    assert M.run_mining_daily(now=day) == 0, "once a day"
    allowed["read_query_history"] = True
    assert M.run_mining_daily(now=day, force=True) == 6 and history == ["c1", "c3"]
