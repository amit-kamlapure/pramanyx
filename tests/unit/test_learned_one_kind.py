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
        verified_by="user:bo", proposed_by="", verified_at="2026-11-10T00:00:00", proposed_at="")])
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
