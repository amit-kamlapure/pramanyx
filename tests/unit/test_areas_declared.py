"""The areas of the business, as the organisation declares them (the ontology study, Phase 1, 2026-11-17): an industry
package's map, the organisation's own areas and owners on top (a curator's, in the settings), and a person's placement of
a table, a connection or a metric — a tag that outranks every placement by evidence and never widens who may read it."""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx.orgsettings.models import AreaDeclaration
from pramanyx.semantic import areas as A
from pramanyx.semantic.metric_map import Area, MetricMap


def _map() -> MetricMap:
    return MetricMap(areas=[Area(id="orders_sales", name="Orders & sales", question="How much did we sell?", pack_id="retail",
                                 words=("order", "sale")),
                            Area(id="returns", name="Returns", question="What came back?", pack_id="retail", words=("return",)),
                            Area(id="other", name="Everything else", question="", pack_id="base", generic=True)],
                     industry_pack="retail")


@pytest.fixture()
def settings(monkeypatch, tmp_path):
    monkeypatch.setattr("pramanyx.orgsettings.store._PATH", tmp_path / "org_settings.json")
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda conn, schema=None: _map())
    from pramanyx.orgsettings.store import load_org_settings, save_org_settings

    def declare(*decls):
        save_org_settings(load_org_settings().model_copy(update={"areas": list(decls)}))
    return declare


def test_the_organisation_s_areas_sit_beside_the_industry_s_with_owners_and_a_place(settings):
    settings(AreaDeclaration(id="returns", business_owners=["user:ana"], technical_owners=["user:bo"]),
             AreaDeclaration(id="marketplace_ops", name="Marketplace operations", question="Are sellers shipping?",
                             parent="orders_sales", business_owners=["user:cai"]))
    got = {a["id"]: a for a in A.areas_for("c1")}
    assert list(got) == ["orders_sales", "returns", "marketplace_ops"]                   # the industry's first, in order
    assert (got["returns"]["name"], got["returns"]["business_owners"], got["returns"]["technical_owners"],
            got["returns"]["source"]) == ("Returns", ["user:ana"], ["user:bo"], "package")
    assert (got["marketplace_ops"]["parent"], got["marketplace_ops"]["source"]) == ("orders_sales", "organisation")


def test_declarations_that_cannot_stand_are_refused_with_every_reason():
    known = {"orders_sales", "returns"}
    bad = [AreaDeclaration(id="a", name="A", parent="b"), AreaDeclaration(id="b", name="B", parent="a"),
           AreaDeclaration(id="lost", name="Lost", parent="nowhere"), AreaDeclaration(id="Bad Id", name="x"),
           AreaDeclaration(id="nameless")]
    problems = A.check_declarations(bad, known=known)
    assert "a sits under itself" in problems and "lost sits under nowhere, which is no area" in problems
    assert "'Bad Id' is not an area id (lowercase words joined by underscores)" in problems
    assert "the new area nameless needs a name" in problems
    deep = [AreaDeclaration(id=f"l{i}", name=f"L{i}", parent=f"l{i - 1}" if i else "") for i in range(6)]
    assert any("6 levels deep" in p for p in A.check_declarations(deep, known=known))
    assert A.check_declarations([AreaDeclaration(id="returns", business_owners=["user:ana"])], known=known) == []


def test_a_person_s_placement_outranks_the_evidence_and_a_connection_placed_whole_places_the_rest(settings, monkeypatch):
    from pramanyx.semantic import metric_coverage as MC
    conn = "c" + uuid.uuid4().hex[:6]
    tables = [MC.TableFacts(name=n, rows=500, date_column="created_at", grain="id") for n in
              ("orders", "order_returns", "sellers")]
    monkeypatch.setattr(MC, "tables_of", lambda c, s=None: tables)
    monkeypatch.setattr(MC, "_domains", lambda c, s: {})
    monkeypatch.setattr(MC, "defined_metrics", lambda c, s: [SimpleNamespace(name="gmv", label="GMV", status="approved",
                                                                              tables=["orders"], lineage=[])])
    monkeypatch.setattr(MC, "_moves", lambda metrics, c, figures: {})
    monkeypatch.setattr("pramanyx.semantic.coverage_proposals.proposals_by_area", lambda c, s: {})
    before = {r["id"]: [t["name"] for t in r["tables"]] for r in MC.coverage(conn, mmap=_map())["areas"]}
    assert "order_returns" in before["returns"]                                          # by its name
    A.place("table", "order_returns", "orders_sales", by="user:ana", connection_id=conn)
    A.place("metric", "gmv", "returns", by="user:ana", connection_id=conn)
    A.place("connection", "", "orders_sales", by="user:bo", connection_id=conn)
    rows = {r["id"]: r for r in MC.coverage(conn, mmap=_map())["areas"]}
    placed = {t["name"]: t["why"] for t in rows["orders_sales"]["tables"]}
    assert placed["order_returns"] == "ana placed it here"
    assert placed["sellers"] == "bo placed its connection here"
    assert [m["name"] for m in rows["returns"]["metrics"]] == ["gmv"] and rows["returns"]["metrics"][0]["why"] == "ana placed it here"
    assert A.placed_by_people("another-" + conn)["metrics"] == {}             # another connection's gmv is another metric
    A.place("table", "order_returns", "", by="user:ana", connection_id=conn)
    A.place("metric", "gmv", "", by="user:ana", connection_id=conn)
    A.place("connection", "", "", by="user:bo", connection_id=conn)
    assert A.placed_by_people(conn) == {"tables": {}, "tables_qualified": {}, "metrics": {}, "connection": None}


def test_only_a_curator_declares_areas_a_person_places_and_an_agent_does_neither(settings, monkeypatch):
    from pramanyx.mcp.client import AGENT_HEADER, AGENT_MARK
    from pramanyx.routers import metrics as M
    monkeypatch.setattr(M, "_declared_schema", lambda conn: None)
    app = FastAPI()
    app.include_router(M.router)
    client = TestClient(app)
    conn = "c" + uuid.uuid4().hex[:6]
    body = {"areas": [{"id": "returns", "business_owners": ["user:ana"]}]}
    assert client.put(f"/areas/{conn}", json=body, headers={AGENT_HEADER: AGENT_MARK}).status_code == 403
    ok = client.put(f"/areas/{conn}", json=body)                          # identity off: the install's owner
    assert ok.status_code == 200 and {a["id"]: a for a in ok.json()["areas"]}["returns"]["business_owners"] == ["user:ana"]
    refused = client.put(f"/areas/{conn}", json={"areas": [{"id": "x", "name": "X", "parent": "y"}]})
    assert refused.status_code == 422 and "x sits under y, which is no area" in refused.json()["detail"]["problems"]
    placed = client.put(f"/areas/{conn}/placement", json={"kind": "table", "ref": "orders", "area": "returns"})
    assert placed.status_code == 200 and client.get(f"/areas/{conn}").json()["placed"]["tables"]["orders"]["area"] == "returns"
    assert client.put(f"/areas/{conn}/placement", json={"kind": "table", "ref": "orders", "area": "nowhere"}).status_code == 422
    assert client.put(f"/areas/{conn}/placement", json={"kind": "table", "ref": "orders", "area": "returns"},
                      headers={AGENT_HEADER: AGENT_MARK}).status_code == 403
    monkeypatch.setattr("pramanyx.rbac.resolver.has_permission", lambda principal, perm: False)
    assert client.put(f"/areas/{conn}", json=body).status_code == 403
    # placing an asset in an area widens nobody's reach: the tag is `area`, never the grant-bearing `domain`
    from pramanyx.govern.tag_store import tags_for
    assert [t.key for t in tags_for(f"table:{conn}..orders")] == ["area"]


def test_one_table_name_in_two_schemas_is_read_under_its_schema(settings, monkeypatch):
    """2026-11-23: placements were read back by bare name, so two schemas' ``orders`` placed in two areas collided and
    the last one read stood for both. Each is read under its schema; the bare name is left to neither."""
    from pramanyx.semantic import areas as A
    conn = "c" + uuid.uuid4().hex[:6]
    A.place("table", "orders", "orders_sales", by="user:ana", connection_id=conn, schema_name="shop")
    A.place("table", "orders", "returns", by="user:ana", connection_id=conn, schema_name="returns_desk")
    placed = A.placed_by_people(conn)
    assert placed["tables_qualified"]["shop.orders"][0] == "orders_sales"
    assert placed["tables_qualified"]["returns_desk.orders"][0] == "returns"
    assert "orders" not in placed["tables"], "a bare name placed in two areas is not guessed"
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda *a, **k: type("M", (), {"areas": []})())
    assert A._area_of_tables(["returns_desk.orders"], conn) == "returns"
    assert A._area_of_tables(["shop.orders"], conn) == "orders_sales"
    A.place("table", "orders", "orders_sales", by="user:ana", connection_id=conn, schema_name="returns_desk")
    assert A.placed_by_people(conn)["tables"]["orders"][0] == "orders_sales", "one area for the name: read by it"
