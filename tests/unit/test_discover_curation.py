"""Discover D4 — an Area made whole (the plan's §4.4, `docs/DISCOVER_PLAN_2026-11-23.md`): its description and what it
puts first, changed by its curators (its owners, or an admin — the user's call, 2026-11-23: no new role) with who changed
what kept in the ledger; and anything Discover lists placed in an Area by its owner, the Area's owners or an admin —
never an agent.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx.discover import items as I
from pramanyx.semantic import areas as A


@pytest.fixture()
def journal(monkeypatch, tmp_path):
    """A throwaway settings file, and the ledger's events recorded."""
    import pramanyx.orgsettings.store as OS
    from pramanyx.kernel.ledger import Ledger
    monkeypatch.setattr(OS, "_PATH", tmp_path / "org_settings.json")
    emitted: list[tuple[str, dict]] = []
    monkeypatch.setattr(Ledger, "default", classmethod(lambda cls: SimpleNamespace(emit=lambda k, p: emitted.append((k, p)))))
    return emitted


def _declared() -> dict:
    from pramanyx.orgsettings.store import load_org_settings
    return {d.id: d for d in load_org_settings().areas}


# ── an Area's page, written by its curators ──────────────────────────────────────────────────────────────────────


def test_a_curator_writes_an_area_s_description_owners_and_what_it_puts_first_and_the_ledger_keeps_who(journal):
    got = A.edit_area("returns", {"description": "What customers send back, and why.", "business_owners": ["user:bo", "user:bo"],
                                  "featured": [{"kind": "metric", "ref": "c1/return_rate"}, {"kind": "dashboard", "ref": "c1:bo:ret"}]},
                      by="user:bo", known={"returns"})
    assert got["description"] == "What customers send back, and why." and got["business_owners"] == ["user:bo"]
    assert [f.ref for f in _declared()["returns"].featured] == ["c1/return_rate", "c1:bo:ret"]
    kind, payload = journal[-1]
    assert kind == "area.changed" and payload["area"] == "returns" and payload["by"] == "user:bo"
    assert set(payload["changed"]) == {"description", "business_owners", "featured"}
    A.edit_area("returns", {"description": "What customers send back, and why."}, by="user:bo", known={"returns"})
    assert len(journal) == 1, "nothing changed, nothing journalled"


@pytest.mark.parametrize("changes, said", [
    ({"parent": "orders"}, "changes its"),                                      # not a field its page changes
    ({"description": "x" * (A.MAX_DESCRIPTION + 1)}, "at most"),
    ({"featured": [{"kind": "nonsense", "ref": "x"}]}, "a featured thing"),
    ({"featured": [{"kind": "table", "ref": f"c1.t{i}"} for i in range(A.MAX_FEATURED + 1)]}, "at most"),
])
def test_what_an_area_s_page_cannot_hold_is_refused_and_said(journal, changes, said):
    with pytest.raises(ValueError, match=said):
        A.edit_area("returns", changes, by="user:bo", known={"returns"})
    assert journal == []


def test_an_area_no_connection_has_is_refused(journal):
    with pytest.raises(ValueError, match="declare it first"):
        A.edit_area("nowhere", {"description": "x"}, by="user:bo", known={"returns"})


def test_the_semantic_layer_saving_every_declaration_keeps_what_an_area_s_page_wrote(journal, monkeypatch):
    """The Semantic Layer saves the organisation's declarations whole and edits neither the description nor what an
    Area puts first: a save of it must not wipe them."""
    from pramanyx.routers import metrics as M
    A.edit_area("returns", {"description": "Kept.", "featured": [{"kind": "metric", "ref": "c1/rr"}]}, by="user:bo", known={"returns"})
    monkeypatch.setattr("pramanyx.rbac.resolver.has_permission", lambda principal, perm: True)
    monkeypatch.setattr(M, "_declared_schema", lambda conn: "")
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda conn, schema=None: SimpleNamespace(areas=[
        SimpleNamespace(id="returns", name="Returns", question="", generic=False, pack_id="p")]))
    monkeypatch.setattr("pramanyx.semantic.areas.areas_for", lambda conn, schema=None, **k: [])
    request = SimpleNamespace(headers={}, state=SimpleNamespace(principal=None))
    M.put_areas("c1", M.AreasIn(areas=[{"id": "returns", "name": "", "question": "", "parent": "", "business_owners": ["user:cai"]}]), request)
    d = _declared()["returns"]
    assert d.description == "Kept." and [f.ref for f in d.featured] == ["c1/rr"] and d.business_owners == ["user:cai"]


def test_an_area_s_curators_are_its_owners_and_an_admin():
    area = {"business_owners": ["user:ana"], "technical_owners": ["bo"]}
    assert A.curates(area, "ana", admin=False) and A.curates(area, "user:bo", admin=False)
    assert not A.curates(area, "user:cai", admin=False) and A.curates(area, "user:cai", admin=True)
    assert not A.curates({}, "", admin=False)


# ── placing anything Discover lists ───────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("kind, tag_kind", sorted(A.ARTIFACT_KINDS.items()))
def test_every_kind_discover_lists_is_placed_where_discover_reads_it(kind, tag_kind):
    ref = f"c1:ana:{kind}-1"
    assert A.place(kind, ref, "returns", by="user:ana") == "returns"
    assert I._placed_tags(tag_kind)[ref] == ("returns", "user:ana")
    assert A.place(kind, ref, "", by="user:ana") is None
    assert ref not in I._placed_tags(tag_kind)


def test_a_placement_says_who_made_it():
    with pytest.raises(ValueError, match="who"):
        A.place("canvas", "x", "returns", by="")


# ── the doors ─────────────────────────────────────────────────────────────────────────────────────────────────────

AREAS = {"returns": {"id": "returns", "name": "Returns", "question": "", "parent": "", "business_owners": ["user:bo"],
                     "technical_owners": [], "source": "package", "connections": ["c1"], "featured": []},
         "orders": {"id": "orders", "name": "Orders", "question": "", "parent": "", "business_owners": ["user:dee"],
                    "technical_owners": [], "source": "package", "connections": ["c1"], "featured": []},
         I.OTHER: {"id": I.OTHER, "name": "Everything else", "question": "", "parent": "", "business_owners": [],
                   "technical_owners": [], "source": "platform", "connections": ["c1"]}}


@pytest.fixture()
def door(monkeypatch, journal):
    """The Discover router over one connection, with the person asking and their standing stood in."""
    from pramanyx.routers import discover as D
    who = {"person": "user:bo", "admin": False}
    monkeypatch.setattr("pramanyx.db.registry.list_connections", lambda: [{"id": "c1", "name": "theLook"}])
    monkeypatch.setattr("pramanyx.metastore.accessible_catalog_ids", lambda ws: None)
    monkeypatch.setattr("pramanyx.security.authz.acting_person", lambda principal: who["person"])
    monkeypatch.setattr("pramanyx.rbac.resolver.has_permission", lambda principal, perm: who["admin"])
    monkeypatch.setattr("pramanyx.discover.service.areas_in_view", lambda scope: {k: dict(v) for k, v in AREAS.items()})
    monkeypatch.setattr(D, "_every_package_area", lambda: {"returns", "orders"})
    canvas = I.Item(kind="canvas", id="cv1", name="Returns desk", connection_id="c1", owner="user:ana", area="orders",
                    area_how="ana placed it here", placed=True)
    by_tables = I.Item(kind="canvas", id="cv2", name="Refunds", connection_id="c1", owner="user:ana", area="returns",
                       area_how="read from its tables")
    monkeypatch.setattr("pramanyx.discover.service.gather",
                        lambda scope, kinds=I.KINDS: {k: I.Found(items=[canvas, by_tables] if k == "canvas" else []) for k in kinds})
    placed: list[tuple] = []
    monkeypatch.setattr("pramanyx.semantic.areas.place", lambda kind, ref, area, **k: placed.append((kind, ref, area, k["by"])) or area or None)
    app = FastAPI()
    app.include_router(D.router)
    return SimpleNamespace(client=TestClient(app), who=who, placed=placed)


def test_only_an_area_s_curators_change_it_and_never_an_agent(door):
    c = door.client
    assert c.put("/discover/areas/returns", json={"description": "Sent back."}).status_code == 200       # bo owns Returns
    assert _declared()["returns"].description == "Sent back."
    assert c.put("/discover/areas/orders", json={"description": "x"}).status_code == 403                 # dee's, not bo's
    door.who["admin"] = True
    assert c.put("/discover/areas/orders", json={"description": "x"}).status_code == 200                 # an admin's
    from pramanyx.mcp.policy import AGENT_HEADER, AGENT_MARK
    assert c.put("/discover/areas/returns", json={"description": "y"}, headers={AGENT_HEADER: AGENT_MARK}).status_code == 403
    assert c.put(f"/discover/areas/{I.OTHER}", json={"description": "x"}).status_code == 404
    assert c.put("/discover/areas/returns", json={"featured": [{"kind": "nonsense", "ref": "x"}]}).status_code == 422


def test_a_thing_is_placed_by_its_owner_or_the_area_s_owners_and_taken_out_only_where_a_person_placed_it(door):
    c = door.client
    # bo owns Returns: may move ana's canvas into it, not into Orders
    assert c.put("/discover/placement", json={"kind": "canvas", "id": "cv1", "area": "returns"}).status_code == 200
    assert door.placed[-1] == ("canvas", "cv1", "returns", "user:bo")
    assert c.put("/discover/placement", json={"kind": "canvas", "id": "cv1", "area": "orders"}).status_code == 403
    # its owner may place it anywhere
    door.who["person"] = "user:ana"
    assert c.put("/discover/placement", json={"kind": "canvas", "id": "cv1", "area": "orders"}).status_code == 200
    # taking out: only what a person placed; one standing by its tables is moved, not taken out
    assert c.put("/discover/placement", json={"kind": "canvas", "id": "cv1", "area": I.OTHER}).status_code == 200
    assert door.placed[-1][2] == ""
    assert c.put("/discover/placement", json={"kind": "canvas", "id": "cv2", "area": ""}).status_code == 422
    # what the person cannot open, a Definition, a kind that is no kind, an Area that is none
    assert c.put("/discover/placement", json={"kind": "canvas", "id": "nope", "area": "returns"}).status_code == 404
    assert c.put("/discover/placement", json={"kind": "definition", "id": "x", "area": "returns"}).status_code == 422
    assert c.put("/discover/placement", json={"kind": "nonsense", "id": "x", "area": "returns"}).status_code == 422
    assert c.put("/discover/placement", json={"kind": "canvas", "id": "cv1", "area": "nowhere"}).status_code == 422
    # a third person with no standing
    door.who["person"] = "user:cai"
    assert c.put("/discover/placement", json={"kind": "canvas", "id": "cv1", "area": "returns"}).status_code == 403


def test_a_package_area_annotated_stays_on_the_connections_whose_map_has_it(journal, monkeypatch):
    """Seen live, 2026-11-24: Returns (theLook's package Area) given a description stood on every other connection as an
    organisation's Area named "returns", and Discover showed that one. A nameless declaration annotates a package's Area;
    it is listed only where the package's map has the Area."""
    from types import SimpleNamespace as NS
    maps = {"thelook": [NS(id="returns", name="Returns", question="What came back?", generic=False, pack_id="p")],
            "other": []}
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda conn, schema=None: NS(areas=maps[conn]))
    A.edit_area("returns", {"description": "Sent back."}, by="user:bo", known={"returns"})
    on_thelook = {a["id"]: a for a in A.areas_for("thelook")}
    assert on_thelook["returns"]["name"] == "Returns" and on_thelook["returns"]["description"] == "Sent back."
    assert "returns" not in {a["id"] for a in A.areas_for("other")}


def test_saving_one_connection_s_areas_keeps_an_annotation_of_an_area_that_connection_does_not_have(journal, monkeypatch):
    """The declarations are the organisation's, saved whole from one connection's page; an annotated package Area that
    connection does not have is never on its page, and a save from there must not drop it (2026-11-24)."""
    from pramanyx.routers import metrics as M
    both = {"returns", "clienteling"}                     # each annotated where its connection has it
    A.edit_area("returns", {"description": "Sent back."}, by="user:bo", known=both)
    A.edit_area("clienteling", {"description": "Seen one customer at a time."}, by="user:bo", known=both)
    monkeypatch.setattr("pramanyx.rbac.resolver.has_permission", lambda principal, perm: True)
    monkeypatch.setattr(M, "_declared_schema", lambda conn: "")
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda conn, schema=None: SimpleNamespace(areas=[
        SimpleNamespace(id="returns", name="Returns", question="", generic=False, pack_id="p")]))   # no clienteling here
    monkeypatch.setattr("pramanyx.semantic.areas.areas_for", lambda conn, schema=None, **k: [])
    request = SimpleNamespace(headers={}, state=SimpleNamespace(principal=None))
    M.put_areas("c1", M.AreasIn(areas=[{"id": "returns", "name": "", "question": "", "parent": ""},
                                       {"id": "operations", "name": "Operations", "question": "", "parent": ""}]), request)
    assert set(_declared()) == {"returns", "operations", "clienteling"}
    assert _declared()["clienteling"].description == "Seen one customer at a time."
    # a named Area left out of the save IS taken away: it is on every connection's page, so leaving it out is meant
    M.put_areas("c1", M.AreasIn(areas=[{"id": "returns", "name": "", "question": "", "parent": ""}]), request)
    assert set(_declared()) == {"returns", "clienteling"}


def test_an_area_carries_its_packages_glyph_and_its_owners_choice_wins(journal, monkeypatch):
    """Areas carry an icon (2026-11-25): the package that names an Area picks its glyph; its owners may choose another."""
    from types import SimpleNamespace as NS
    from pramanyx.discover.service import _area_view
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda conn, schema=None: NS(areas=[
        NS(id="returns", name="Returns", question="What came back?", generic=False, pack_id="p", icon="returns"),
        NS(id="fulfilment", name="Fulfilment", question="Did it arrive?", generic=False, pack_id="p", icon="truck")]))
    assert {a["id"]: a["icon"] for a in A.areas_for("c1")} == {"returns": "returns", "fulfilment": "truck"}
    A.edit_area("returns", {"icon": "Box"}, by="user:bo", known={"returns", "fulfilment"})
    got = {a["id"]: a for a in A.areas_for("c1")}
    assert got["returns"]["icon"] == "box" and got["fulfilment"]["icon"] == "truck"
    assert _area_view(got["returns"], [])["icon"] == "box"
    A.edit_area("returns", {"icon": ""}, by="user:bo", known={"returns", "fulfilment"})
    assert {a["id"]: a["icon"] for a in A.areas_for("c1")}["returns"] == "returns"     # back to its package's
    with pytest.raises(ValueError, match="icon"):
        A.edit_area("returns", {"icon": "<svg>"}, by="user:bo", known={"returns", "fulfilment"})


def test_every_package_area_names_a_glyph():
    """Each Area a package declares names its glyph; whether the app draws that name is the web's test
    (`web/lib/areaIcons.test.ts`)."""
    from pathlib import Path

    from pramanyx.packs.loader import load_pack
    packs = Path(__file__).resolve().parents[2] / "packs"
    missing = [f"{d.name}/{a.id}" for d in sorted(packs.iterdir()) if (d / "areas.yaml").exists()
               for a in load_pack(d).areas if not a.icon]
    assert missing == []


def test_a_semantic_layer_save_keeps_an_areas_icon_whether_or_not_it_sends_the_area(journal, monkeypatch):
    """The Semantic Layer saves every declaration at once, edits no icon, and cannot tell a chosen icon from its
    package's: an Area it sends keeps its icon, and one it leaves out keeps what its curators chose on its page."""
    from types import SimpleNamespace as NS

    from pramanyx.routers import metrics as M
    from pramanyx.orgsettings.store import load_org_settings
    both = {"returns", "fulfilment"}
    A.edit_area("returns", {"icon": "box"}, by="user:bo", known=both)
    A.edit_area("fulfilment", {"icon": "route", "description": "Out the door."}, by="user:bo", known=both)
    monkeypatch.setattr("pramanyx.rbac.resolver.has_permission", lambda principal, perm: True)
    monkeypatch.setattr(M, "_declared_schema", lambda conn: "")
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda conn, schema=None: NS(areas=[
        NS(id="returns", name="Returns", question="", generic=False, pack_id="p", icon="returns"),
        NS(id="fulfilment", name="Fulfilment", question="", generic=False, pack_id="p", icon="truck")]))
    request = NS(headers={}, state=NS(principal="admin"))
    M.put_areas("c1", M.AreasIn(areas=[{"id": "returns", "parent": "", "business_owners": ["user:ana"]}]), request)
    kept = {d.id: d for d in load_org_settings().areas}
    assert kept["returns"].icon == "box" and kept["returns"].business_owners == ["user:ana"]
    assert kept["fulfilment"].icon == "route" and kept["fulfilment"].description == "Out the door."
