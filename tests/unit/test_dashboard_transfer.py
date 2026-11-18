"""The dashboards study's R22 — a dashboard written out as a file and read back: all of it or none, and whatever does not
resolve on the connection it lands on is refused by name."""
from __future__ import annotations

import copy
import json

import pytest

from pramanyx.cards.store import get_card, list_cards
from pramanyx.dashboards import cards, transfer, versions
from pramanyx.dashboards.home import Home
from pramanyx.org.context import using_org
from tests.unit.test_dashboard_sharing import AMIT, PRIYA, Office, needs_rules


@pytest.fixture
def office(monkeypatch):
    monkeypatch.setattr(transfer, "_tables_here", lambda _c: ({"orders", "main.orders"}, "duckdb"))
    o = Office()
    assert o.keep().kept
    return o


def _file(o: Office) -> dict:
    with using_org(o.org):
        return json.loads(json.dumps(transfer.export_of(o.home)))


@needs_rules
def test_a_file_holds_the_spec_and_each_card_with_its_source_and_no_value_it_last_read(office):
    doc = _file(office)
    assert doc["format"] == transfer.FORMAT and doc["from"] == {"connection": office.connection, "dashboard": office.home.cockpit_id, "version": 1}
    assert {c["id"] for c in doc["cards"]} == {office.rate, office.net}
    assert all(c["source"] == "authored" and "provenance" in c for c in doc["cards"])
    assert "refresh" not in doc["cards"][0] and "last_value" not in json.dumps(doc["cards"])


@needs_rules
def test_a_file_read_back_is_a_new_dashboard_of_the_reader_s_own_with_its_own_cards(office):
    doc = _file(office)
    with using_org(office.org):
        out = transfer.import_into(office.connection, PRIYA, doc, approved_by=f"user:{PRIYA}")
        assert out["imported"] is True and out["version"] == 1
        home = Home(office.connection, PRIYA, out["cockpit_id"])
        latest = versions.latest(home)
        placed = {el["props"]["card"] for el in latest["spec"]["elements"].values() if el["type"] == "Card"}
        assert placed.isdisjoint({office.rate, office.net}) and len(placed) == 2
        card = get_card(next(iter(placed)))
        assert card.scope == cards.OWN and card.scope_ref == PRIYA and card.links[0].startswith("imported:")
        assert latest["source"].startswith("imported from a file of")


@pytest.mark.parametrize("doc, says", [
    ({"format": "something else"}, "not a dashboard file"),
    ({"format": transfer.FORMAT, "format_version": 99}, "format 99"),
    ({"format": transfer.FORMAT, "format_version": 1, "spec": "x", "cards": []}, "holds no dashboard"),
])
def test_what_is_not_a_dashboard_file_is_said(doc, says):
    assert says in transfer.problems(doc, "c")[0]


@needs_rules
def test_every_card_that_does_not_resolve_is_refused_by_name_and_nothing_is_made(office, monkeypatch):
    doc = _file(office)
    by_id = {c["id"]: c for c in doc["cards"]}
    by_id[office.rate].update(sql="SELECT SUM(x) FROM ledger.payments")
    by_id[office.net].update(source="", title="Net revenue")
    with using_org(office.org):
        before = len(list_cards(connection_id=office.connection, scope=cards.OWN, scope_ref=PRIYA))
        out = transfer.import_into(office.connection, PRIYA, doc, approved_by=f"user:{PRIYA}")
        assert out["imported"] is False
        assert out["sentences"] == ['The card "Return rate" reads ledger.payments, which this connection does not have.',
                                    'The card "Net revenue" does not say where it came from.']
        assert len(list_cards(connection_id=office.connection, scope=cards.OWN, scope_ref=PRIYA)) == before


@needs_rules
def test_a_card_placed_but_not_in_the_file_and_a_metric_not_here_are_named(office):
    doc = _file(office)
    gone = copy.deepcopy(doc)
    gone["cards"] = [c for c in gone["cards"] if c["id"] != office.rate]
    with using_org(office.org):
        said = transfer.problems(gone, office.connection)
        assert said == [f"The dashboard places a card ({office.rate}) that the file does not hold and this connection does not have."]
        doc["cards"][0]["provenance"]["metric"] = "no_such_metric"
        assert any("made from the metric no_such_metric" in s for s in transfer.problems(doc, office.connection))


@needs_rules
def test_a_connection_whose_tables_cannot_be_read_takes_no_file(office, monkeypatch):
    doc = _file(office)
    monkeypatch.setattr(transfer, "_tables_here", lambda _c: None)
    with using_org(office.org):
        out = transfer.import_into(office.connection, AMIT, doc, approved_by=f"user:{AMIT}")
    assert out["imported"] is False and "could not be read" in out["sentences"][0]


def test_tables_are_known_however_a_connection_nests_them():
    assert transfer._names_in({"shop": {"orders": {"id": "UNKNOWN"}}}) == {"shop.orders", "orders"}
    assert transfer._unread_tables("SELECT 1 FROM shop.orders JOIN other.orders o ON 1=1", {"shop.orders", "orders"}) == ["other.orders"]
    assert transfer._unread_tables("SELECT 1 FROM main.orders", {"orders"}) == []             # a connection of bare tables
