"""The Atlas, by Area (2026-11-25, A4a): the organisation's map — every Area with what it holds, the month's answers
that drew on it (from the tables their receipts read), what waits for review and what was learned in it; and the
figures: the month's answers, the share that drew on governed knowledge, the share placed in an Area."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

from pramanyx.discover import atlas as AT
from pramanyx.kernel.ledger import Ledger


def _item(kind: str, id_: str, name: str, area: str = "", state: str = "", conn: str = "c1"):
    return NS(kind=kind, id=id_, name=name, area=area, state=state, connection_id=conn)


def _receipt(conn: str, tables: list[str], lineage: list[tuple] = ()) -> str:
    return Ledger.default().artifact_write("chat_answer", f"chat:{conn}:{uuid.uuid4().hex[:8]}",
                                           {"question": "q", "tables": tables}, conn_id=conn, lineage=list(lineage))


def test_the_months_answers_by_area_and_which_drew_on_governed_knowledge():
    conn = "c" + uuid.uuid4().hex[:8]
    items = [_item("table", f"{conn}.order_items", "order_items", "orders_sales", conn=conn),
             _item("table", f"{conn}.returns", "returns", "returns", conn=conn),
             _item("table", f"{conn}.users", "users", "", conn=conn),
             _item("metric", f"{conn}/revenue", "revenue", "orders_sales", "approved", conn),
             _item("metric", f"{conn}/aov", "aov", "orders_sales", "draft", conn),
             _item("definition", f"{conn}/Repeat buyer/customers", "Repeat buyer", "customers", "published", conn),
             _item("definition", f"{conn}/Churn/customers", "Churn", "customers", "draft", conn)]
    _receipt(conn, ["thelook.order_items"], [("metric_used", "metric:revenue", None)])          # governed: approved metric
    _receipt(conn, ["`project.thelook.order_items`", "returns"], [("metric_used", "metric:aov", None)])  # a draft's: not
    _receipt(conn, ["users"], [("given", f"definition:{conn}/Repeat buyer/customers", "Repeat buyer")])  # governed
    _receipt(conn, ["users"], [("trusted", "query:Revenue by month", None)])                           # governed
    _receipt(conn, ["users"], [("given", f"definition:{conn}/Churn/customers", "Churn")])               # a draft's: not
    _receipt("elsewhere", ["order_items"])                                                             # not in view
    scope = NS(connections={conn: "theLook"}, person="", curator=False)
    month = AT.answers(scope, items)
    assert (month["answers"], month["governed"], month["in_an_area"]) == (5, 3, 2)
    assert month["per_area"] == {"orders_sales": 2, "returns": 1}
    later = AT.answers(scope, items, now=datetime.now(timezone.utc) + timedelta(days=AT.WINDOW_DAYS + 1))
    assert (later["answers"], later["previous"]) == (0, 5), "a month on, they are the month before's"


def test_what_waits_for_review_and_what_was_learned_is_added_up_by_area_and_an_unread_one_said(monkeypatch):
    AT._slow.clear()
    reviews = {"c1": {"total": 3, "unplaced": 1, "items": [{"kind": "gap", "area": "orders_sales"},
                                                            {"kind": "conflict", "area": "orders_sales,returns"},
                                                            {"kind": "candidate", "area": ""}]}}

    def review(conn, limit=200):
        if conn not in reviews:
            raise RuntimeError("unreadable")
        return reviews[conn]
    monkeypatch.setattr("pramanyx.knowledge.review.review", review)
    monkeypatch.setattr("pramanyx.knowledge.learned.learned_items", lambda conn, limit=50: {
        "total": 2, "items": [{"area": "orders_sales"}, {"area": ""}]})
    scope = NS(connections={"c1": "theLook", "c2": "DuckDB"}, person="", curator=False)
    slow, said = AT.slow_parts(scope, wait=True)
    assert slow["areas"]["orders_sales"] == {"gap": 1, "conflict": 1, "learned": 2}
    assert slow["areas"]["returns"] == {"conflict": 1}
    assert (slow["review_total"], slow["review_unplaced"], slow["learned_total"], slow["learned_unplaced"]) == (3, 1, 4, 2)
    assert said == ["Not read: what waits for review on DuckDB."]
    again, _ = AT.slow_parts(scope)
    assert again is slow, "kept, not read again within ten minutes"


def test_nothing_read_yet_is_said_and_the_map_still_stands(monkeypatch):
    AT._slow.clear()
    monkeypatch.setattr(AT, "_read_slow", lambda key, connections: None)
    monkeypatch.setattr(Ledger.default(), "kv_get", lambda store, key: None)
    scope = NS(connections={"c9": "x"}, person="someone-" + uuid.uuid4().hex[:6], curator=False)
    slow, said = AT.slow_parts(scope)
    assert slow is None and said[0].startswith("What waits for review and what was learned, by Area, is being read")


def test_the_map_lists_the_areas_answers_drew_on_first_and_the_rest_apart(monkeypatch):
    from pramanyx.discover import service as S
    areas = {"orders_sales": {"id": "orders_sales", "name": "Orders & sales", "question": "", "business_owners": ["user:ana"],
                              "technical_owners": [], "connections": ["c1"]},
             "returns": {"id": "returns", "name": "Returns", "question": "", "business_owners": [], "technical_owners": [],
                         "connections": ["c1"]},
             "payments": {"id": "payments", "name": "Payments", "question": "", "business_owners": [], "technical_owners": [],
                          "connections": ["c1"]},
             "promotions": {"id": "promotions", "name": "Promotions", "question": "", "business_owners": [],
                            "technical_owners": [], "connections": ["c1"]},
             S.OTHER: {"id": S.OTHER, "name": "Everything else", "question": "", "business_owners": [], "technical_owners": [],
                       "connections": ["c1"]}}
    held = [_item("table", "t1", "orders", "orders_sales"), _item("table", "t2", "refunds", "returns"),
            _item("table", "t3", "refunds_2", "returns"), _item("sheet", "s1", "notes", "")]
    monkeypatch.setattr(S, "gather", lambda scope: {})
    monkeypatch.setattr(S, "all_items", lambda found: held)
    monkeypatch.setattr(S, "areas_in_view", lambda scope: areas)
    monkeypatch.setattr(S, "area_view", lambda a, items: {"id": a["id"], "name": a["name"], "total": len(items)})
    monkeypatch.setattr(S, "by_use", lambda items, measured="": [])
    monkeypatch.setattr(S, "put_use", lambda items: [])
    monkeypatch.setattr(AT, "answers", lambda scope, items, now=None: {
        "answers": 10, "previous": 6, "governed": 4, "in_an_area": 7, "per_area": {"orders_sales": 5, "payments": 2}})
    monkeypatch.setattr(AT, "slow_parts", lambda scope, wait=False: (
        {"areas": {"orders_sales": {"gap": 2, "learned": 9}}, "review_total": 5, "review_unplaced": 3,
         "learned_total": 12, "learned_unplaced": 3, "unread": [], "at": "2026-11-25T10:00:00+00:00"}, []))
    out = AT.atlas(NS(connections={"c1": "theLook"}, person="", curator=False))
    assert [(a["id"], a["answers"], a["total"]) for a in out["areas"]] == [
        ("orders_sales", 5, 1), ("payments", 2, 0), ("returns", 0, 2)], "answers first, then what each holds"
    assert out["areas"][0]["review"] == {"gap": 2, "candidate": 0, "conflict": 0} and out["areas"][0]["learned"] == 9
    assert [q["id"] for q in out["quiet"]] == ["promotions"]
    assert out["everything_else"]["answers"] == 3 and out["everything_else"]["total"] == 1
    assert out["figures"]["governed"] == 4 and out["figures"]["given_since"] == "2026-11-25"
    assert out["contacts"] == {"named": 1, "of": 4}
    assert out["review"] == {"total": 5, "unplaced": 3} and out["learned"] == {"total": 12, "unplaced": 3}


def test_a_learned_list_asked_twice_in_one_reading_is_read_once(monkeypatch):
    """The review queue reads each connection's learned list for its findings to confirm, and the Atlas reads it for its
    counts: within one reading it is read from the store once (measured 2026-11-25: the reading took fifteen seconds
    and slowed page loads while it ran)."""
    from pramanyx.knowledge import learned as L
    reads = []
    monkeypatch.setattr(L, "_learned", lambda conn, about="": reads.append(conn) or {
        "items": [{"area": "a"}] * 3, "total": 3, "folded": 0, "withheld": None, "uses_counted": False})
    with L.read_once():
        assert len(L.learned_items("c1", limit=2)["items"]) == 2
        assert L.learned_items("c1", limit=500)["total"] == 3
    L.learned_items("c1")
    assert reads == ["c1", "c1"], "once inside, and nothing kept after"


def test_a_reading_kept_across_a_restart_is_served_for_ten_minutes_not_read_again_on_the_first_visit(monkeypatch):
    from datetime import datetime, timedelta, timezone
    AT._slow.clear()
    started = []
    monkeypatch.setattr(AT, "_read_slow", lambda key, connections: started.append(key))
    kept = {"areas": {"orders_sales": {"gap": 1}}, "review_total": 1, "review_unplaced": 0, "learned_total": 0,
            "learned_unplaced": 0, "unread": [], "at": (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()}
    monkeypatch.setattr(Ledger.default(), "kv_get", lambda store, key: kept)
    scope = NS(connections={"c1": "theLook"}, person="p-" + uuid.uuid4().hex[:6], curator=False)
    slow, said = AT.slow_parts(scope, wait=True)
    assert slow["review_total"] == 1 and said == [] and started == []
    AT._slow.clear()
    kept["at"] = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    AT.slow_parts(scope, wait=True)
    assert len(started) == 1, "older than an hour, it is read again"


def test_a_reading_that_fails_is_never_left_being_read(monkeypatch):
    AT._slow.clear()
    AT._reading.clear()
    monkeypatch.setattr(AT, "_read_each", lambda *a: (_ for _ in ()).throw(RuntimeError("boom")))
    scope = NS(connections={"c1": "theLook"}, person="p-" + uuid.uuid4().hex[:6], curator=False)
    try:
        AT.slow_parts(scope, wait=True)
    except RuntimeError:
        pass
    assert AT._reading == set()


def test_the_reading_reads_each_connections_learned_list_once_though_the_review_queue_asks_for_it_too(monkeypatch):
    from pramanyx.knowledge import learned as L
    AT._slow.clear()
    reads = []
    monkeypatch.setattr(L, "_learned", lambda conn, about="": reads.append(conn) or {
        "items": [{"area": "orders_sales"}], "total": 1, "folded": 0, "withheld": None, "uses_counted": False})
    monkeypatch.setattr(AT, "PAUSE_S", 0)

    def review(conn, limit=200):
        L.learned_items(conn, limit=500)          # as the review queue's findings-to-confirm read does
        return {"total": 0, "unplaced": 0, "items": []}
    monkeypatch.setattr("pramanyx.knowledge.review.review", review)
    scope = NS(connections={"c1": "theLook", "c2": "DuckDB"}, person="p-" + uuid.uuid4().hex[:6], curator=False)
    slow, _ = AT.slow_parts(scope, wait=True)
    assert reads == ["c1", "c2"] and slow["learned_total"] == 2
