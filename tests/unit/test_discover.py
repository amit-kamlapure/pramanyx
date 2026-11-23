"""Discover's reads (the plan's D1, `docs/DISCOVER_PLAN_2026-11-23.md`): one page over everything a person may open, by
Area — what it lists, in what order, what it withholds and says, and the Area each thing stands in.

Hermetic: the readers and the Areas are stood in; no store, model or warehouse is read.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx.discover import items as I
from pramanyx.discover import service as S
from pramanyx.discover.items import OTHER, Found, Item, Scope

AREAS = {
    "orders_sales": {"id": "orders_sales", "name": "Orders & sales", "question": "How much did we sell?", "parent": "",
                     "business_owners": [], "technical_owners": [], "source": "package", "connections": ["c1"]},
    "returns": {"id": "returns", "name": "Returns", "question": "What came back?", "parent": "",
                "business_owners": ["user:bo"], "technical_owners": [], "source": "package", "connections": ["c1"]},
    "web_returns": {"id": "web_returns", "name": "Web returns", "question": "", "parent": "returns",
                    "business_owners": [], "technical_owners": [], "source": "organisation", "connections": ["c1"]},
    "marketing": {"id": "marketing", "name": "Marketing", "question": "What did growth cost?", "parent": "",
                  "business_owners": [], "technical_owners": [], "source": "package", "connections": ["c1"]},
    OTHER: {"id": OTHER, "name": "Everything else", "question": "", "parent": "", "business_owners": [],
            "technical_owners": [], "source": "platform", "connections": ["c1"]},
}


def _scope() -> Scope:
    return Scope(None, "user:ana", {"c1": "theLook"})


def _stand_in(monkeypatch, found: dict[str, Found]) -> None:
    for kind in I.KINDS:
        monkeypatch.setitem(I.READERS, kind, (lambda f: (lambda scope: f))(found.get(kind, Found())))
    monkeypatch.setattr(S, "areas_in_view", lambda scope: {k: dict(v) for k, v in AREAS.items()})


CERT = {"status": "certified", "by": "user:bo", "why": "", "at": "2026-11-20"}
DEPR = {"status": "deprecated", "by": "user:bo", "why": "use orders", "at": "2026-11-20"}


def _found() -> dict[str, Found]:
    return {
        "metric": Found(items=[
            Item("metric", "c1/revenue", "Revenue", connection_id="c1", area="orders_sales", state="approved"),
            Item("metric", "c1/gmr", "Gross Margin Rate", connection_id="c1", area="orders_sales", state="deprecated"),
            Item("metric", "c1/rr", "Return rate", connection_id="c1", area="returns", state="approved", owner="user:ana")]),
        "table": Found(items=[
            Item("table", "c1.s.orders", "orders", connection_id="c1", area="orders_sales", certification=CERT),
            Item("table", "c1.s.old_orders", "old_orders", connection_id="c1", area="orders_sales", certification=DEPR),
            Item("table", "c1.s.dc", "distribution_centers", connection_id="c1")],
            said=["DuckDB: its tables have not been read yet"]),
        "canvas": Found(items=[Item("canvas", "cv1", "The Look Analytics", connection_id="c1")], withheld=2),
        "document": Found(withheld=1),
    }


def test_the_page_lists_the_areas_that_hold_something_and_names_those_that_hold_nothing(monkeypatch):
    _stand_in(monkeypatch, _found())
    page = S.home(_scope())
    names = [a["name"] for a in page["areas"]]
    assert names == ["Orders & sales", "Returns", "Everything else"], "most held first; what no Area holds last"
    orders = page["areas"][0]
    assert orders["counts"] == {"metric": 2, "table": 2} and orders["total"] == 4 and orders["deprecated"] == 2
    assert {a["id"] for a in page["quiet_areas"]} == {"marketing", "web_returns"}, "an Area holding nothing is listed apart"
    other = page["areas"][-1]
    assert other["counts"] == {"table": 1, "canvas": 1}, "an unplaced thing stands in Everything else"


def test_the_page_says_what_is_withheld_and_what_could_not_be_read(monkeypatch):
    _stand_in(monkeypatch, _found())
    page = S.home(_scope())
    assert page["withheld"] == {"canvas": 2, "document": 1}
    assert page["said"] == ["DuckDB: its tables have not been read yet"]
    assert [i["name"] for i in page["certified"]] == ["orders"] and page["certified_count"] == 1


def test_within_a_kind_the_vouched_for_come_first_and_the_warned_off_last(monkeypatch):
    _stand_in(monkeypatch, _found())
    kinds = {k["kind"]: k for k in S.home(_scope())["kinds"]}
    assert [i["name"] for i in kinds["table"]["items"]] == ["orders", "distribution_centers", "old_orders"]
    assert [i["name"] for i in kinds["metric"]["items"]] == ["Return rate", "Revenue", "Gross Margin Rate"]
    assert kinds["metric"]["states"] == {"approved": 2, "deprecated": 1}
    assert kinds["definition"]["count"] == 0 and kinds["definition"]["title"] == "Definitions"
    assert "tables" not in kinds["table"]["items"][0], "the tables an item reads are not sent"


def test_a_reader_that_fails_is_said_and_the_rest_still_stand(monkeypatch):
    _stand_in(monkeypatch, _found())

    def broken(scope):
        raise RuntimeError("store away")
    monkeypatch.setitem(I.READERS, "agent", broken)
    page = S.home(_scope())
    assert "Agents could not be read (RuntimeError)" in page["said"]
    assert page["areas"], "the other kinds still stand"


def test_view_all_filters_by_kind_area_certified_and_words_a_page_at_a_time(monkeypatch):
    _stand_in(monkeypatch, _found())
    assert S.list_items(_scope(), kind="metric")["total"] == 3
    assert [i["name"] for i in S.list_items(_scope(), area="returns")["items"]] == ["Return rate"]
    assert [i["name"] for i in S.list_items(_scope(), certified=True)["items"]] == ["orders"]
    assert [i["name"] for i in S.list_items(_scope(), q="margin rate")["items"]] == ["Gross Margin Rate"]
    first = S.list_items(_scope(), kind="metric", limit=2)
    assert len(first["items"]) == 2 and first["next_cursor"] == 2
    rest = S.list_items(_scope(), kind="metric", cursor=2, limit=2)
    assert len(rest["items"]) == 1 and rest["next_cursor"] is None
    assert S.list_items(_scope(), kind="canvas")["withheld"] == {"canvas": 2}


def test_mine_keeps_what_the_person_owns_however_their_name_is_written(monkeypatch):
    _stand_in(monkeypatch, _found())
    assert [i["name"] for i in S.list_items(_scope(), mine=True)["items"]] == ["Return rate"]   # "user:ana" is ana
    assert S.list_items(Scope(None, "", {"c1": "theLook"}), mine=True)["total"] == 0           # nobody owns nothing


def test_an_area_s_page_holds_its_things_by_kind_and_its_sub_areas(monkeypatch):
    _stand_in(monkeypatch, _found())
    page = S.area_page(_scope(), "returns")
    assert page["area"]["business_owners"] == ["user:bo"]
    assert [c["id"] for c in page["children"]] == ["web_returns"]
    assert [k["kind"] for k in page["kinds"]] == ["metric"] and "definition" in page["empty_kinds"]
    assert S.area_page(_scope(), "no_such_area") is None


# ── the Area each thing stands in ──────────────────────────────────────────────────────────────────────────────────


def test_a_thing_stands_where_a_person_placed_it_else_by_its_tables_else_by_its_words(monkeypatch):
    monkeypatch.setattr("pramanyx.semantic.areas.area_of_tables", lambda tables, conn: "returns" if "returns" in tables else "")
    monkeypatch.setattr(I, "by_words",
                        lambda scope, text, conn="": ("orders_sales", "sales") if "sales" in text.lower() else ("", ""))
    s = _scope()
    placed = I.settle(Item("dashboard", "d", "Anything", connection_id="c1"), s, placed=("marketing", "user:ana"))
    assert (placed.area, placed.area_how) == ("marketing", "ana placed it here")
    by_tables = I.settle(Item("canvas", "cv", "Sales desk", connection_id="c1", tables=["returns"]), s)
    assert (by_tables.area, by_tables.area_how) == ("returns", "read from its tables")
    by_name = I.settle(Item("dashboard", "d2", "Sales", connection_id="c1"), s)
    assert (by_name.area, by_name.area_how) == ("orders_sales", 'its name says "sales"')
    nowhere = I.settle(Item("agent", "a", "Anomaly Scout", connection_id="c1"), s)
    assert (nowhere.area, nowhere.area_how) == ("", "")


def test_a_thing_is_placed_by_its_name_never_its_description(monkeypatch):
    """Seen live, 2026-11-23: a schedule whose description said it "returns the top five" stood in Returns."""
    monkeypatch.setattr(I, "by_words",
                        lambda scope, text, conn="": ("returns", "returns") if "returns" in text else ("", ""))
    got = I.settle(Item("schedule", "s", "Top sellers yesterday", line="returns the top five", connection_id="c1"),
                   _scope())
    assert got.area == ""


# ── each kind's own access rule ────────────────────────────────────────────────────────────────────────────────────


def test_a_document_not_shared_with_the_person_is_counted_not_listed(monkeypatch):
    monkeypatch.setattr("pramanyx.routers.knowledge.list_documents_endpoint", lambda: [
        {"doc_id": "d1", "title": "Kpi Handbook", "access": {"owner": "user:ana"}, "uploaded_at": "2026-10-17"},
        {"doc_id": "d2", "title": "Bo's notes", "access": {"owner": "user:bo"}}])
    monkeypatch.setattr("pramanyx.knowledge.access.may_read", lambda d, reader=None: d["doc_id"] == "d1")
    monkeypatch.setattr(I, "_certified", lambda kind: {})
    monkeypatch.setattr(I, "_placed_tags", lambda kind: {})
    monkeypatch.setattr(I, "by_words", lambda scope, text, conn="": ("", ""))
    got = I.documents(_scope())
    assert [i.name for i in got.items] == ["Kpi Handbook"] and got.withheld == 1
    assert got.items[0].href == "/?tab=documents&doc=d1"


def test_a_connection_s_schema_document_stands_with_it_and_is_out_of_view_with_it(monkeypatch):
    """Seen live, 2026-11-23: theLook's Discover listed Olist's schema documentation."""
    monkeypatch.setattr("pramanyx.routers.knowledge.list_documents_endpoint", lambda: [
        {"doc_id": "doctree::c1::thelook", "title": "Schema documentation — c1/thelook", "generated": True,
         "connection_id": "c1"},
        {"doc_id": "doctree::c9::olist", "title": "Schema documentation — c9/olist", "generated": True,
         "connection_id": "c9"},
        # an older row names no connection; its id does
        {"doc_id": "doctree::c8::ecommerce", "title": "Schema documentation — c8/ecommerce", "generated": True,
         "connection_id": None},
        {"doc_id": "d1", "title": "Kpi Handbook", "connection_id": None}])
    monkeypatch.setattr("pramanyx.knowledge.access.may_read", lambda d, reader=None: True)
    monkeypatch.setattr(I, "_certified", lambda kind: {})
    monkeypatch.setattr(I, "_placed_tags", lambda kind: {})
    monkeypatch.setattr(I, "by_words", lambda scope, text, conn="": ("", ""))
    got = I.documents(_scope())
    assert [(i.name, i.connection_name) for i in got.items] == [
        ("Schema documentation — theLook/thelook", "theLook"), ("Kpi Handbook", "")]
    assert got.withheld == 0


def test_another_person_s_draft_definition_is_theirs_and_is_not_listed(monkeypatch):
    def claim(term, tier, author):
        return SimpleNamespace(extra={"term": term, "area": "returns"}, tier=tier, author=author, owner="",
                               recorded_at="2026-11-20", statement=SimpleNamespace(text=f"{term} means…"))
    monkeypatch.setattr("pramanyx.record.writers.definitions", lambda conn: [
        claim("Shipped", "approved", "user:bo"), claim("Returned", "draft", "user:ana"), claim("Active", "draft", "user:bo")])
    got = I.definitions(_scope())
    assert [(i.name, i.state) for i in got.items] == [("Shipped", "published"), ("Returned", "draft")]
    assert got.items[0].href == "/definitions/Shipped?conn=c1&area=returns"


def test_an_archived_dashboard_is_not_listed_and_a_published_one_carries_its_owner(monkeypatch):
    monkeypatch.setattr("pramanyx.dashboards.home.person_of", lambda request: "ana")
    monkeypatch.setattr("pramanyx.dashboards.versions.of_person", lambda conn, owner: [
        {"dashboard_id": "sales", "title": "Sales", "state": "draft", "kept_at": "2026-11-18"},
        {"dashboard_id": "old", "title": "Old", "state": "archived"}])
    monkeypatch.setattr("pramanyx.dashboards.sharing.shared_with", lambda conn, person: [
        {"owner": "bo", "dashboard_id": "ops", "title": "Operations"}])
    monkeypatch.setattr(I, "_certified", lambda kind: {"c1:ana:sales": CERT})
    monkeypatch.setattr(I, "_placed_tags", lambda kind: {})
    monkeypatch.setattr(I, "by_words", lambda scope, text, conn="": ("", ""))
    got = I.dashboards(_scope())
    assert [i.name for i in got.items] == ["Sales", "Operations"]
    assert got.items[0].certification == CERT and got.items[1].href == "/?tab=dashboards&conn=c1&dashboard=shared%3Abo%3Aops"


# ── the doors ──────────────────────────────────────────────────────────────────────────────────────────────────────


@pytest.fixture()
def client(monkeypatch):
    from pramanyx.routers import discover as D
    monkeypatch.setattr("pramanyx.db.registry.list_connections", lambda: [{"id": "c1", "name": "theLook"},
                                                                         {"id": "c2", "name": "LuxExperience"}])
    monkeypatch.setattr("pramanyx.metastore.accessible_catalog_ids", lambda ws: {"c1"} if ws == "w1" else None)
    app = FastAPI()
    app.include_router(D.router)
    return TestClient(app)


def test_the_page_is_scoped_to_the_workspace_and_a_connection_outside_it_is_not_found(client, monkeypatch):
    seen = {}
    monkeypatch.setattr("pramanyx.discover.service.home", lambda scope: seen.setdefault("c", scope.connections) and {"ok": 1})
    assert client.get("/discover", params={"workspace_id": "w1"}).status_code == 200
    assert seen["c"] == {"c1": "theLook"}
    assert client.get("/discover", params={"workspace_id": "w1", "connection_id": "c2"}).status_code == 404
    assert client.get("/discover/items", params={"kind": "nonsense"}).status_code == 422
    monkeypatch.setattr("pramanyx.discover.service.area_page", lambda scope, area: None)
    assert client.get("/discover/areas/none").status_code == 404


def test_the_sheets_connection_s_tables_are_not_listed_again_as_tables(monkeypatch):
    """Seen live, 2026-11-23: every spreadsheet stood twice — as a sheet, and as a table of the Sheets connection, where
    one not shared with the person would have been listed past its sharing."""
    from types import SimpleNamespace
    from pramanyx.sheets.model import SHEETS_CONNECTION
    read = []
    monkeypatch.setattr("pramanyx.semantic.metric_coverage.tables_of",
                        lambda conn: read.append(conn) or [SimpleNamespace(name="orders", rows=3, date_column="")])
    monkeypatch.setattr(I, "_coverage_placements", lambda scope, conn: ({}, {}, None))
    monkeypatch.setattr(I, "_declared_schema", lambda conn: "shop")
    monkeypatch.setattr("pramanyx.govern.certification.of_prefix", lambda prefix: {})
    got = I.tables(Scope(None, "user:ana", {"c1": "theLook", SHEETS_CONNECTION: "Sheets"}))
    assert read == ["c1"] and [i.connection_id for i in got.items] == ["c1"]
