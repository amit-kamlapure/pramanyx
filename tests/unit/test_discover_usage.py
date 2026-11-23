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
    monkeypatch.setattr(U, "_reads", {})
    monkeypatch.setattr(U, "_reading", set())
    heard: list[dict] = []
    monkeypatch.setattr(U, "opens", lambda **kw: list(reversed(heard)))
    from pramanyx.kernel import ledger as L
    emit = L.Ledger.emit

    def kept(self, kind, payload, *a, **kw):
        if kind == U.OPENED:
            heard.append({**{k: payload[k] for k in ("kind", "ref", "by")}, "at": f"2026-11-24T10:{len(heard):02d}:00"})
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
    U.note_opened(_request("ana"), "metric", "c1/revenue", "c1")                 # not a kind a person opens on its page
    assert [(o["by"], o["ref"]) for o in _fresh] == [("user:ana", "c1:user:ana:sales"), ("user:bo", "c1:user:ana:sales")]
    monkeypatch.setattr(U.time, "monotonic", lambda: 10 ** 9)                     # ten minutes on, it is opened again
    U.note_opened(_request("ana"), "dashboard", "c1:user:ana:sales", "c1")
    assert len(_fresh) == 3


def test_use_is_reads_for_a_table_and_opens_for_what_is_opened_and_none_for_what_is_not_measured(_fresh, monkeypatch):
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
    assert use["cv1"]["count"] == 0 and "c1/revenue" not in use and said == []


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
    assert U.NOT_MEASURED in page["use_said"]
    listed = S.list_items(Scope(None, "user:ana", {"c1": "theLook"}), kind="table", sort="use")
    assert [i["name"] for i in listed["items"]] == ["orders", "distribution_centers"]
