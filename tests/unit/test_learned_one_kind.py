"""What the platform has learned, read as one kind (the ontology study, Phase 1, 2026-11-17): four stores, one shape,
one authority order, held to the reader's clearance by the tables each item rests on, and use not counted — said."""
from __future__ import annotations

import uuid
from types import SimpleNamespace

from pramanyx.knowledge.learned import learned_items, learned_line
from pramanyx.record import claims as C
from pramanyx.record import writers as W


def _conn() -> str:
    return "c" + uuid.uuid4().hex[:8]


def test_four_stores_read_in_one_shape_and_one_order(monkeypatch):
    conn = _conn()
    fid = "f-" + uuid.uuid4().hex[:6]
    cid = W.book_explorer_finding(finding={"id": fid, "finding": "Returns doubled in Brazil", "domain": "Ops"},
                                  sql="SELECT COUNT(*) FROM returns", connection_id=conn, receipt_id="r1")
    other = W.book_explorer_finding(finding={"id": fid + "x", "finding": "Orders peak on Mondays"},
                                    sql="SELECT COUNT(*) FROM orders", connection_id=conn, receipt_id="r2")
    C.confirm(other, by="user:ana")
    monkeypatch.setattr("pramanyx.semantic.trusted_queries.list_trusted", lambda c: [SimpleNamespace(
        id="tq1", question="Revenue by month", sql="SELECT SUM(x) FROM orders", tables=["orders"], source="api",
        verified_by="user:bo", proposed_by="", verified_at="2026-11-10T00:00:00", proposed_at="",
        last_executed_at="2026-11-10T00:00:00")])
    monkeypatch.setattr("pramanyx.semantic.areas.placed_by_people", lambda c: {"tables": {"returns": ("returns", "user:ana")},
                                                                               "metrics": {}, "connection": None})
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda c, s=None: SimpleNamespace(areas=[]))
    out = learned_items(conn)
    assert out["uses_counted"] is False and out["withheld"] is None
    by_text = {i["text"]: i for i in out["items"]}
    assert [i["standing"] for i in out["items"]][:2] in (["approved", "trusted"], ["trusted", "approved"])   # confirmed first
    assert out["items"][-1]["text"] == "Returns doubled in Brazil"                                           # measured last
    r = by_text["Returns doubled in Brazil"]
    assert (r["kind"], r["source"], r["standing_said"], r["tables"], r["area"]) == (
        "finding", "the explorer", "measured by a run", ["returns"], "returns")
    assert r["lineage"] == ["run:r1"] and r["ref"] == cid and r["uses"] is None
    assert by_text["Orders peak on Mondays"]["author"] == "user:ana"                                     # who confirmed it
    assert by_text["Revenue by month"]["author"] == "user:bo"
    assert learned_items(conn, about="brazil returns")["total"] == 1
    assert learned_line(r).startswith("Returns doubled in Brazil — measured by a run, from the explorer · returns,")


def test_what_the_reader_may_not_see_is_withheld_and_counted(monkeypatch):
    from pramanyx.govern.retrieval_trim import securable_for_table
    from pramanyx.govern.tags import ClearanceDecision, Requirement
    conn = _conn()
    W.book_explorer_finding(finding={"id": "a", "finding": "Pay rose"}, sql="SELECT AVG(x) FROM salaries",
                            connection_id=conn, receipt_id="r1")
    W.book_explorer_finding(finding={"id": "b", "finding": "Orders fell"}, sql="SELECT COUNT(*) FROM orders",
                            connection_id=conn, receipt_id="r2")
    monkeypatch.setattr("pramanyx.semantic.trusted_queries.list_trusted", lambda c: [])
    blocked = securable_for_table(conn, "", "salaries")
    req = Requirement(key="tier", value="restricted", clearance="clearance.restricted")
    monkeypatch.setattr("pramanyx.govern.tags.check", lambda s, held, bypass=False: (
        ClearanceDecision(securable=s, allowed=False, requirements=[req], missing=[req]) if s == blocked
        else ClearanceDecision(securable=s, allowed=True)))
    out = learned_items(conn)
    assert [i["text"] for i in out["items"]] == ["Orders fell"] and out["withheld"]["withheld"] == 1


def test_one_thing_learned_is_one_item_however_often_it_was_booked(monkeypatch):
    """2026-11-25 (the Atlas-by-Area plan's A0): theLook's list held the same statement twice, and one re-check's
    restatement once under each of three answers it moved — five of the first 200 items, read as five things known."""
    conn = _conn()
    for n in range(2):
        W.book_explorer_finding(finding={"id": f"same{n}", "finding": "Orders peak on  Mondays"},
                                sql="SELECT COUNT(*) FROM orders", connection_id=conn, receipt_id=f"r{n}")
    W.book_explorer_finding(finding={"id": "other", "finding": "Returns doubled in Brazil"},
                            sql="SELECT COUNT(*) FROM returns", connection_id=conn, receipt_id="r9")
    changes = [{"column": "revenue", "label": {"country": "Korea"}, "old": 1, "new": 2}]
    for n, first in enumerate(("Revenue by country", "Revenue by country, led by China", "Revenue, all time")):
        claim = C.Claim(kind="observation", statement=C.Statement(
            text=f"Restated: revenue for Korea is now 2 (we said 1). First said: {first}"),
            tier="measured", as_of="2026-11-25", warrants=[C.Warrant(kind="run", ref=f"rc{n}", detail="SELECT 1 FROM orders")],
            author="system", author_kind="system",
            extra={"restated_by": "answers.recheck", "changes": changes, "tables": ["orders"]})
        C.book(claim, key=W.observation_key(conn, f"inv{n}"), conn_id=conn)
    monkeypatch.setattr("pramanyx.semantic.trusted_queries.list_trusted", lambda c: [])
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda c, s=None: SimpleNamespace(areas=[]))
    out = learned_items(conn)
    by_text = {i["text"]: i for i in out["items"]}
    assert out["total"] == 3 and out["folded"] == 3
    mondays = by_text["Orders peak on  Mondays"]
    assert mondays["times"] == 2 and len(mondays["also"]) == 1
    restated = by_text["Restated: revenue for Korea is now 2 (we said 1)."]
    assert restated["times"] == 3 and len(restated["also"]) == 2
    assert by_text["Returns doubled in Brazil"]["times"] == 1
    assert "_same" not in mondays
    assert learned_line(mondays).endswith("· booked 2 times")



def test_one_standing_a_persons_word_on_what_ran_leads_and_a_word_never_run_stands_below_a_measurement(monkeypatch):
    """A2 (2026-11-25): one order for everything an answer may draw on (`trust.standing`). A confirmed finding and a
    trusted query that ran stand on a person's word AND the data's; a measured finding on the data's; a trusted query
    nobody ran on a person's word alone — below the measurement, as the platform's ladder has always put it. Each says
    why, and a trusted query says how many answers it guided."""
    conn = _conn()
    measured = W.book_explorer_finding(finding={"id": "m", "finding": "Orders fell 2%"}, sql="SELECT COUNT(*) FROM orders",
                                       connection_id=conn, receipt_id="r1")
    sure = W.book_explorer_finding(finding={"id": "s", "finding": "Returns rose 1%"}, sql="SELECT COUNT(*) FROM returns",
                                   connection_id=conn, receipt_id="r2")
    C.confirm(sure, by="user:ana")
    monkeypatch.setattr("pramanyx.semantic.trusted_queries.list_trusted", lambda c: [SimpleNamespace(
        id="tq9", question="Revenue by week", sql="SELECT SUM(x) FROM orders", tables=["orders"], source="api",
        verified_by="user:bo", proposed_by="", verified_at="2026-11-12T00:00:00", proposed_at="", last_executed_at="")])
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda c, s=None: SimpleNamespace(areas=[]))
    monkeypatch.setattr("pramanyx.discover.usage.answers_of", lambda kind, ref: 3 if kind == "trusted_query" else 0)
    out = learned_items(conn)
    assert [i["text"] for i in out["items"]] == ["Returns rose 1%", "Orders fell 2%", "Revenue by week"]
    by_text = {i["text"]: i for i in out["items"]}
    assert by_text["Returns rose 1%"]["why"].startswith("confirmed by a person, measured by a run")
    assert by_text["Orders fell 2%"]["why"].startswith("measured by a run") and by_text["Orders fell 2%"]["ref"] == measured
    assert by_text["Revenue by week"]["why"] == "approved as a trusted query · used in 3 answers this month · as of 2026-11-12"
    assert by_text["Revenue by week"]["uses"] == 3 and by_text["Orders fell 2%"]["uses"] is None
    assert by_text["Orders fell 2%"]["standing_said"] == "measured by a run", "the review queue's sentence keeps its words"
    assert sure


def test_an_answers_tables_are_read_from_its_receipt_so_it_is_placed_and_held_to_clearance(monkeypatch):
    """A3 (2026-11-25): 145 of theLook's 150 learned items in no Area named no table — each an answer whose warrant
    names its receipt and carries no SQL. The receipt says what its SQL read: so the item is placed by those tables, and
    held to the reader's clearance by them, which a tableless item escaped."""
    from pramanyx.kernel.ledger import Ledger
    conn = _conn()
    receipt = Ledger.default().artifact_write("chat_answer", f"chat:{conn}:inv1", {"question": "q", "tables": ["order_items"]},
                                              conn_id=conn)
    claim = C.Claim(kind="observation", statement=C.Statement(text="Revenue fell on 24 Nov"), tier="measured",
                    as_of="2026-11-24", warrants=[C.Warrant(kind="run", ref=receipt, detail="")], author="system",
                    author_kind="system", extra={"writer": "answer"})
    C.book(claim, key=W.observation_key(conn, "inv1"), conn_id=conn)
    monkeypatch.setattr("pramanyx.semantic.trusted_queries.list_trusted", lambda c: [])
    area = SimpleNamespace(id="orders_sales", generic=False, name="Orders & sales", words=("order",), absorbs=())
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda c, s=None: SimpleNamespace(areas=[area]))
    monkeypatch.setattr("pramanyx.semantic.metric_map.best_areas", lambda t, named: [(named[0], "order")] if "order" in t else [])
    item = learned_items(conn)["items"][0]
    assert item["tables"] == ["order_items"] and item["area"] == "orders_sales"


def test_the_learned_page_names_every_area_counts_what_each_holds_and_narrows_to_none(monkeypatch):
    """A3 (2026-11-25): the page narrows to an Area or to what sits in none, across every item rather than the first
    page; every Area of the connection is named (a Promote may place a draft in any), with how many it holds."""
    from pramanyx.routers import knowledge as K
    items = [{"ref": f"r{n}", "area": a, "text": "t"} for n, a in enumerate(["orders_sales"] * 3 + [""] * 2 + ["returns"])]
    monkeypatch.setattr("pramanyx.knowledge.learned.learned_items",
                        lambda c, about="", limit=50: {"items": list(items), "total": len(items), "folded": 0, "withheld": None})
    monkeypatch.setattr("pramanyx.semantic.areas.areas_for", lambda c: [
        {"id": "orders_sales", "name": "Orders & sales"}, {"id": "returns", "name": "Returns"}, {"id": "payments", "name": "Payments"}])
    out = K.read_learned("c1", limit=2)
    assert [i["ref"] for i in out["items"]] == ["r0", "r1"] and out["matched"] == 6 and out["unplaced"] == 2
    assert out["areas"] == [{"id": "orders_sales", "name": "Orders & sales", "count": 3},
                            {"id": "returns", "name": "Returns", "count": 1}, {"id": "payments", "name": "Payments", "count": 0}]
    none = K.read_learned("c1", area=K.NO_AREA, limit=50)
    assert [i["ref"] for i in none["items"]] == ["r3", "r4"] and none["matched"] == 2
    assert [i["ref"] for i in K.read_learned("c1", area="returns", limit=50)["items"]] == ["r5"]
