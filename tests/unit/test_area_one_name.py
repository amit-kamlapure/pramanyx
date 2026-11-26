"""One name per Area across the install (2026-11-25, the Atlas-by-Area plan's A0). Packages share an Area's id but an
industry's package names it in its own words; a page over several connections named it after whichever it read first —
live, Discover said "Inventory" while theLook's review queue said "Inventory & merchandising"."""
from __future__ import annotations

from types import SimpleNamespace as NS

from pramanyx.semantic import areas as A
from pramanyx.semantic.metric_map import Area, MetricMap

RETAIL = [Area(id="inventory", name="Inventory & merchandising", question="Is the stock right for what sells?", pack_id="retail"),
          Area(id="orders_sales", name="Orders & sales", question="How much did we sell?", pack_id="retail")]
BASE = [Area(id="inventory", name="Inventory", question="Is the stock right?", pack_id="analytics-base")]


def _install(monkeypatch, connections: dict[str, list[Area]]):
    """Each connection reads the packages named by its own id; each package set maps to the Areas given."""
    monkeypatch.setattr("pramanyx.db.registry.list_connections", lambda: [{"id": c} for c in connections])
    monkeypatch.setattr("pramanyx.semantic.metric_catalogue.industry_packages",
                        lambda conn, schema: [NS(pack_id=conn)])
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_of",
                        lambda packages: MetricMap(areas=list(connections[packages[0].pack_id])))
    A._names_read.update(at=None, names={})


def test_an_area_named_two_ways_takes_the_name_most_connections_give_it(monkeypatch):
    _install(monkeypatch, {"thelook": RETAIL, "postgres": RETAIL, "duckdb": BASE})
    assert A.install_names()["inventory"] == ("Inventory & merchandising", "Is the stock right for what sells?")


def test_a_tie_takes_the_shorter_more_general_name_and_its_question(monkeypatch):
    _install(monkeypatch, {"thelook": RETAIL, "duckdb": BASE})
    assert A.install_names()["inventory"] == ("Inventory", "Is the stock right?")
    assert A.one_name("orders_sales", "x", "y") == ("Orders & sales", "How much did we sell?")
    assert A.one_name("nowhere", "Its own", "Its question") == ("Its own", "Its question")


def test_every_page_says_the_one_name_and_the_organisation_s_own_name_stands_over_it(monkeypatch):
    _install(monkeypatch, {"thelook": RETAIL, "duckdb": BASE})
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda conn, schema=None: MetricMap(areas=list(RETAIL)))
    monkeypatch.setattr(A, "declarations", lambda workspace_id=None: [])
    assert [a["name"] for a in A.areas_for("thelook")] == ["Inventory", "Orders & sales"]
    from pramanyx.orgsettings.models import AreaDeclaration
    monkeypatch.setattr(A, "declarations", lambda workspace_id=None: [AreaDeclaration(id="inventory", name="Stock")])
    assert A.areas_for("thelook")[0]["name"] == "Stock"


def test_the_coverage_card_says_it_too(monkeypatch):
    _install(monkeypatch, {"thelook": RETAIL, "duckdb": BASE})
    from pramanyx.semantic import metric_coverage as MC
    monkeypatch.setattr(A, "declarations", lambda workspace_id=None: [])
    named = MC._with_declared(MetricMap(areas=list(RETAIL)))
    assert [a.name for a in named.areas] == ["Inventory", "Orders & sales"]
    assert RETAIL[0].name == "Inventory & merchandising", "the map read is never changed in place"


def test_the_name_is_read_once_a_minute_not_on_every_page(monkeypatch):
    _install(monkeypatch, {"thelook": RETAIL})
    calls = []
    monkeypatch.setattr("pramanyx.db.registry.list_connections", lambda: calls.append(1) or [{"id": "thelook"}])
    A.install_names(); A.install_names()
    assert len(calls) == 1
