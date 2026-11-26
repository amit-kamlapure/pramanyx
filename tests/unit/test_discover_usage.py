"""Discover's use this month (the plan's D5, `docs/DISCOVER_PLAN_2026-11-23.md` §4.5): read from what happened — a
table's audited reads, the opens a person makes on a thing's own page — never a model's guess; what is not known is said.

Hermetic: the journal is the test's own; the statement log's reads are stood in.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from pramanyx.discover import items as I
from pramanyx.discover import service as S
from pramanyx.discover import usage as U
from pramanyx.discover.items import Found, Item, Scope


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    monkeypatch.setattr(U, "_seen", {})
    monkeypatch.setattr(U, "_seeded", True)
    import uuid
    monkeypatch.setattr(U, "READS_STORE", f"discover_reads_test_{uuid.uuid4().hex[:8]}")   # each test its own
    monkeypatch.setattr(U, "_reads", {})
    monkeypatch.setattr(U, "_reading", set())
    heard: list[dict] = []
    monkeypatch.setattr(U, "opens", lambda **kw: [h for h in reversed(heard) if h["event"] == kw.get("kind", U.OPENED)])
    from pramanyx.kernel import ledger as L
    emit = L.Ledger.emit

    def kept(self, kind, payload, *a, **kw):
        if kind in (U.OPENED, U.USED):
            heard.append({**{k: payload[k] for k in ("kind", "ref", "by")}, "event": kind,
                          "at": f"2026-11-24T10:{len(heard):02d}:00"})
        return emit(self, kind, payload, *a, **kw)
    monkeypatch.setattr(L.Ledger, "emit", kept)
    return heard


def _request(person: str, agent: bool = False):
    return SimpleNamespace(person=person, agent=agent)


@pytest.fixture(autouse=True)
def _who(monkeypatch):
    from pramanyx.rbac import agent_gate
    from pramanyx.security import authz
    monkeypatch.setattr(agent_gate, "is_agent_request", lambda request: request.agent)
    monkeypatch.setattr(authz, "get_principal", lambda request: request)
    monkeypatch.setattr(authz, "acting_person", lambda principal, named="": f"user:{principal.person}")


def test_an_open_is_a_person_s_once_in_ten_minutes_and_an_agent_s_read_is_none(_fresh, monkeypatch):
    U.note_opened(_request("ana"), "dashboard", "c1:user:ana:sales", "c1")
    U.note_opened(_request("ana"), "dashboard", "c1:user:ana:sales", "c1")       # the page read again: not a second open
    U.note_opened(_request("bo"), "dashboard", "c1:user:ana:sales", "c1")
    U.note_opened(_request("coworker", agent=True), "dashboard", "c1:user:ana:sales", "c1")
    U.note_opened(_request("ana"), "table", "c1.s.orders", "c1")                 # a table's use is its reads, not opens
    assert [(o["by"], o["ref"]) for o in _fresh] == [("user:ana", "c1:user:ana:sales"), ("user:bo", "c1:user:ana:sales")]
    monkeypatch.setattr(U.time, "monotonic", lambda: 10 ** 9)                     # ten minutes on, it is opened again
    U.note_opened(_request("ana"), "dashboard", "c1:user:ana:sales", "c1")
    assert len(_fresh) == 3


def test_use_is_reads_for_a_table_and_opens_for_what_is_opened(_fresh, monkeypatch):
    from pramanyx.ontology import entity_uses
    monkeypatch.setattr(entity_uses, "window_reads", lambda conn, tables, days=30: {
        key: {"reads": 120 if key == "c1.s.orders" else 0, "readers": 2, "unattributed": 40, "last_read": "2026-11-23"}
        for key in tables})
    things = [Item("table", "c1.s.orders", "orders", connection_id="c1"),
              Item("table", "c1.s.dc", "distribution_centers", connection_id="c1"),
              Item("dashboard", "c1:user:ana:sales", "Sales", connection_id="c1"),
              Item("canvas", "cv1", "The Look Analytics", connection_id="c1"),
              Item("metric", "c1/revenue", "Revenue", connection_id="c1")]
    for who in ("ana", "bo"):
        U.note_opened(_request(who), "dashboard", "c1:user:ana:sales", "c1")
    use, said = U.use_of(things, wait=True)
    assert use["c1.s.orders"] == {"measured": "reads", "count": 120, "people": 2, "unattributed": 40, "last": "2026-11-23"}
    assert use["c1.s.dc"]["count"] == 0
    assert use["c1:user:ana:sales"] == {"measured": "opens", "count": 2, "people": 2, "unattributed": 0,
                                        "last": "2026-11-24T10:01:00"}
    # a metric is also counted by the answers whose SQL used it (A1, 2026-11-25) — none here, and said as 0
    assert use["cv1"]["count"] == 0 and use["c1/revenue"] == {"measured": "opens", "count": 0, "people": 0,
                                                               "unattributed": 0, "last": None, "answers": 0} and said == []


def test_reads_not_read_yet_are_said_and_read_off_the_request(_fresh, monkeypatch):
    started: list[str] = []

    class _Thread:
        def __init__(self, target, args, **kw):
            self.args = args

        def start(self):
            started.append(self.args[2])                 # (read, org, connection, tables): the connection
    monkeypatch.setattr(U.threading, "Thread", _Thread)
    use, said = U.use_of([Item("table", "c1.s.orders", "orders", connection_id="c1")])
    assert started == ["c1"] and "c1.s.orders" not in use
    assert said == ["How often tables were read this month is being read; it shows on the next visit."]
    U.use_of([Item("table", "c1.s.orders", "orders", connection_id="c1")])
    assert started == ["c1"]                              # one read under way is not started twice


def test_the_page_puts_the_most_used_first_and_what_the_person_opened_lately(_fresh, monkeypatch):
    from pramanyx.ontology import entity_uses
    monkeypatch.setattr(entity_uses, "window_reads", lambda conn, tables, days=30: {
        key: {"reads": {"c1.s.orders": 9, "c1.s.dc": 0}[key], "readers": None, "unattributed": None, "last_read": None}
        for key in tables})
    monkeypatch.setattr(U, "READS_FRESH_S", 10 ** 9)
    U._read_tables(None, "c1", {"c1.s.orders": ["orders"], "c1.s.dc": ["distribution_centers"]})
    found = {"table": Found(items=[Item("table", "c1.s.orders", "orders", connection_id="c1"),
                                   Item("table", "c1.s.dc", "distribution_centers", connection_id="c1")]),
             "dashboard": Found(items=[Item("dashboard", "c1:user:ana:sales", "Sales", connection_id="c1"),
                                       Item("dashboard", "c1:user:ana:ops", "Operations", connection_id="c1")]),
             "canvas": Found(items=[Item("canvas", "cv1", "The Look Analytics", connection_id="c1")])}
    for kind in I.KINDS:
        monkeypatch.setitem(I.READERS, kind, (lambda f: (lambda scope: f))(found.get(kind, Found())))
    monkeypatch.setattr(S, "areas_in_view", lambda scope: {I.OTHER: {"id": I.OTHER, "name": "Everything else"}})
    U.note_opened(_request("ana"), "canvas", "cv1", "c1")
    U.note_opened(_request("ana"), "dashboard", "c1:user:ana:ops", "c1")
    U.note_opened(_request("bo"), "dashboard", "c1:user:ana:sales", "c1")
    page = S.home(Scope(None, "user:ana", {"c1": "theLook"}))
    assert [i["name"] for i in page["most_used"]] == ["Operations", "Sales", "The Look Analytics"]    # opens, a person's
    assert [i["name"] for i in page["most_read"]] == ["orders"]                                     # reads, apart
    assert page["most_read"][0]["use"]["measured"] == "reads" and page["most_read"][0]["use"]["people"] is None
    assert [i["name"] for i in page["recent"]] == ["Operations", "The Look Analytics"]       # hers, newest first
    assert page["use_said"] == []                                         # every kind is measured now
    listed = S.list_items(Scope(None, "user:ana", {"c1": "theLook"}), kind="table", sort="use")
    assert [i["name"] for i in listed["items"]] == ["orders", "distribution_centers"]


def test_a_kind_is_listed_by_name_or_the_newest_changed_first(monkeypatch):
    """The Areas' lists (2026-11-25): Most used, by name, recently changed — each a page at a time."""
    found = Found(items=[Item("metric", "c1/b", "Basket size", connection_id="c1", updated_at="2026-11-01T00:00:00"),
                         Item("metric", "c1/a", "average order value", connection_id="c1", updated_at="2026-11-20T00:00:00"),
                         Item("metric", "c1/c", "Conversion", connection_id="c1", updated_at="")])
    for kind in I.KINDS:
        monkeypatch.setitem(I.READERS, kind, (lambda f: (lambda scope: f))(found if kind == "metric" else Found()))
    monkeypatch.setattr(S, "put_use", lambda items: [])
    scope = Scope(None, "user:ana", {"c1": "theLook"})
    names = lambda **kw: [i["name"] for i in S.list_items(scope, kind="metric", **kw)["items"]]    # noqa: E731
    assert names(sort="name") == ["average order value", "Basket size", "Conversion"]
    assert names(sort="recent") == ["average order value", "Basket size", "Conversion"]     # the undated last
    assert names(sort="name", cursor=1, limit=1) == ["Basket size"]


def test_an_open_just_before_a_restart_is_not_counted_again_after_it(_fresh, monkeypatch):
    from datetime import datetime, timedelta, timezone
    from pramanyx.kernel import ledger as L
    two_minutes_ago = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    monkeypatch.setattr(L.Ledger, "events", lambda self, **kw: [
        {"at": two_minutes_ago, "payload": {"kind": "dashboard", "ref": "c1:user:ana:sales", "connection_id": "c1",
                                            "by": "user:ana"}}] if kw.get("kind") == U.OPENED else [])
    monkeypatch.setattr(U, "_seeded", False)                     # a process that has not read the journal back yet
    U.note_opened(_request("ana"), "dashboard", "c1:user:ana:sales", "c1")     # read again, just after a restart
    U.note_opened(_request("bo"), "dashboard", "c1:user:ana:sales", "c1")      # someone else's open still counts
    assert [o["by"] for o in _fresh] == ["user:bo"]


def test_the_last_reads_are_kept_across_a_restart_and_shown_while_they_are_read_again(_fresh, monkeypatch):
    from pramanyx.ontology import entity_uses
    monkeypatch.setattr(entity_uses, "window_reads", lambda conn, tables, days=30: {
        key: {"reads": 7, "readers": 1, "unattributed": 0, "last_read": "2026-11-24"} for key in tables})
    conn = "kept-" + str(id(object()))
    U._read_tables(U._org(), conn, {f"{conn}.s.orders": ["orders"]})     # read once, and kept
    monkeypatch.setattr(U, "_reads", {})                                    # a restart: nothing in memory
    started: list[str] = []

    class _Thread:
        def __init__(self, target, args, **kw):
            self.args = args

        def start(self):
            started.append(self.args[2])
    monkeypatch.setattr(U.threading, "Thread", _Thread)
    use, said = U.use_of([Item("table", f"{conn}.s.orders", "orders", connection_id=conn)])
    assert use[f"{conn}.s.orders"]["count"] == 7 and said == []            # the last reads, not "being read"
    assert started == []                                                    # and fresh enough not to read again yet


def test_a_metric_is_opened_by_its_page_and_a_trusted_query_used_by_the_answers_it_guides(_fresh, monkeypatch):
    from pramanyx.org.context import reset_actor, set_actor
    U.note_opened(_request("ana"), "metric", "c1/revenue", "c1")
    token = set_actor("bo")
    try:
        U.note_used("trusted_query", "c1/tq1", "c1")
        U.note_used("trusted_query", "c1/tq1", "c1")                     # every answer counts: not a page read again
        U.note_used("dashboard", "c1:user:ana:sales", "c1")              # a dashboard is opened, never "used"
    finally:
        reset_actor(token)
    use, said = U.use_of([Item("metric", "c1/revenue", "Revenue", connection_id="c1"),
                          Item("trusted_query", "c1/tq1", "Revenue by month", connection_id="c1")])
    assert use["c1/revenue"]["measured"] == "opens" and use["c1/revenue"]["count"] == 1
    assert use["c1/tq1"] == {"measured": "uses", "count": 2, "people": 1, "unattributed": 0, "last": "2026-11-24T10:02:00"}
    assert said == [] and [h["event"] for h in _fresh].count(U.USED) == 2


def test_a_page_says_it_opened_a_metric_and_nothing_the_server_records_itself(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from pramanyx.routers import discover as R
    opened: list[tuple] = []
    monkeypatch.setattr(U, "note_opened", lambda request, kind, ref, conn="": opened.append((kind, ref, conn)))
    monkeypatch.setattr(R, "scope_of", lambda request, ws, conn: (_ for _ in ()).throw(R.HTTPException(404, "no"))
                        if conn == "hidden" else None)
    app = FastAPI()
    app.include_router(R.router)
    client = TestClient(app)
    assert client.post("/discover/opened", json={"kind": "metric", "id": "c1/revenue", "connection_id": "c1"}).status_code == 204
    assert opened == [("metric", "c1/revenue", "c1")]
    for body, status in [({"kind": "dashboard", "id": "c1:ana:x", "connection_id": "c1"}, 422),   # its read route does
                         ({"kind": "metric", "id": "c2/revenue", "connection_id": "c1"}, 422),    # not this connection's
                         ({"kind": "metric", "id": "hidden/revenue", "connection_id": "hidden"}, 404)]:
        assert client.post("/discover/opened", json=body).status_code == status
    assert len(opened) == 1
