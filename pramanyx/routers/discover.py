"""Discover's doors (`pramanyx/discover/`; the plan's D1, D3 and D4): the page, a kind or an Area's things in full, one
Area, search — and an Area's curation: its words, owners and what it puts first, and what stands in it.

All three are reads over what the platform keeps, scoped as the catalog is: the workspace's connections the caller's
organisation may see, and one of them when ``connection_id`` names it (checked by the connection guard, as every door
naming a connection is). Who may open each thing is each kind's own rule, applied by its reader.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from pramanyx.security.authz import connection_owner_guard

router = APIRouter(tags=["discover"], dependencies=[Depends(connection_owner_guard)])


def scope_of(request: Request, workspace_id: Optional[str], connection_id: Optional[str]):
    """Who is looking, over which connections: the workspace's (the catalog's gate), the organisation's, and the one
    named when one is."""
    from pramanyx.db.registry import list_connections
    from pramanyx.discover.items import Scope
    from pramanyx.metastore import accessible_catalog_ids
    from pramanyx.rbac.permissions import Permission
    from pramanyx.rbac.resolver import has_permission
    from pramanyx.security.authz import acting_person, get_principal, org_visible_conn_ids
    allowed = accessible_catalog_ids(workspace_id)
    org = org_visible_conn_ids()
    connections = {c["id"]: str(c.get("name") or c["id"]) for c in list_connections()
                   if (allowed is None or c["id"] in allowed) and (org is None or c["id"] in org)}
    if connection_id:
        if connection_id not in connections:
            raise HTTPException(status_code=404, detail="No such connection in this workspace")
        connections = {connection_id: connections[connection_id]}
    principal = get_principal(request)
    return Scope(request, acting_person(principal), connections, workspace_id=workspace_id,
                 curator=has_permission(principal, Permission.ADMIN_MANAGE_ORG))


@router.get("/discover")
def get_discover(request: Request, workspace_id: Optional[str] = None, connection_id: Optional[str] = None) -> dict:
    """The Discover page: the Areas with what each holds, what is certified, each kind with its first few, what the
    person may not open counted, and what could not be read said. No model and no warehouse is read."""
    from pramanyx.discover.service import home
    return home(scope_of(request, workspace_id, connection_id))


@router.get("/discover/items")
def get_discover_items(request: Request, workspace_id: Optional[str] = None, connection_id: Optional[str] = None,
                       kind: str = "", area: str = "", certified: bool = False, mine: bool = False,
                       q: str = Query("", max_length=200),
                       cursor: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
                       sort: str = Query("", pattern="^(|use)$")) -> dict:
    """Every thing of a kind, of an Area, certified, or the person's own — "View all" — a page at a time; ``sort=use``
    puts the most used this month first (D5)."""
    from pramanyx.discover.items import KINDS
    from pramanyx.discover.service import list_items
    if kind and kind not in KINDS:
        raise HTTPException(status_code=422, detail=f"a kind is one of {', '.join(KINDS)}")
    return list_items(scope_of(request, workspace_id, connection_id), kind=kind, area=area, certified=certified,
                      mine=mine, q=q, cursor=cursor, limit=limit, sort=sort)


@router.get("/discover/search")
def get_discover_search(request: Request, q: str = Query(..., min_length=1, max_length=200),
                        workspace_id: Optional[str] = None, connection_id: Optional[str] = None, kind: str = "",
                        area: str = "", certified: bool = False, mine: bool = False,
                        limit: int = Query(50, ge=1, le=200)) -> dict:
    """One ranked list across every kind and every connection in view, by meaning and by words, each result saying
    why it matched (the plan's §4.3). The question is embedded once by the platform's embedder; no model is called."""
    from pramanyx.discover.items import KINDS
    from pramanyx.discover.search import search
    if kind and kind not in KINDS:
        raise HTTPException(status_code=422, detail=f"a kind is one of {', '.join(KINDS)}")
    return search(scope_of(request, workspace_id, connection_id), q, kind=kind, area=area, certified=certified,
                  mine=mine, limit=limit)


@router.get("/discover/areas/{area_id}")
def get_discover_area(request: Request, area_id: str, workspace_id: Optional[str] = None,
                      connection_id: Optional[str] = None) -> dict:
    """One Area's page: the Area, its sub-areas, and what it holds by kind."""
    from pramanyx.discover.service import area_page
    page = area_page(scope_of(request, workspace_id, connection_id), area_id)
    if page is None:
        raise HTTPException(status_code=404, detail="No such Area on the connections in view")
    return page


# ── D4: an Area's curation (the plan's §4.4) ────────────────────────────────────────────────────────────────────────


def _a_persons_own(request: Request, what: str) -> None:
    from pramanyx.rbac.agent_gate import is_agent_request
    if is_agent_request(request):
        raise HTTPException(status_code=403, detail=f"{what} is a person's own call; an agent cannot make it")


def _every_package_area() -> set[str]:
    """Every industry package's Area id on every connection — what an organisation's declaration may sit under."""
    from pramanyx.db.registry import list_connections
    from pramanyx.semantic.metric_map import map_for
    known: set[str] = set()
    for c in list_connections():
        try:
            known |= {a.id for a in map_for(c["id"]).areas if not a.generic}
        except Exception as exc:  # noqa: BLE001 — a connection's map unread adds none
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "discover: a connection's areas could not be read for a curation", counter="discover.known")
    return known


class AreaEditIn(BaseModel):
    """What an Area's page changes; a field left out is left as it is."""
    name: Optional[str] = None
    question: Optional[str] = None
    description: Optional[str] = None
    business_owners: Optional[list[str]] = None
    technical_owners: Optional[list[str]] = None
    featured: Optional[list[dict]] = None


@router.put("/discover/areas/{area_id}")
def put_discover_area(request: Request, area_id: str, body: AreaEditIn, workspace_id: Optional[str] = None) -> dict:
    """An Area's curators — its business and technical owners, or whoever administers the organisation — change its
    words, its owners and what it puts first. Published on save, and who changed what is kept in the ledger."""
    from pramanyx.discover.items import OTHER
    from pramanyx.discover.service import areas_in_view
    from pramanyx.semantic.areas import curates, edit_area
    _a_persons_own(request, "curating an Area")
    scope = scope_of(request, workspace_id, None)
    area = areas_in_view(scope).get(area_id)
    if area is None or area_id == OTHER:
        raise HTTPException(status_code=404, detail="No such Area on the connections in view")
    if not curates(area, scope.person, admin=scope.curator):
        raise HTTPException(status_code=403, detail="only this Area's owners, or whoever administers the organisation, change it")
    changes = body.model_dump(exclude_unset=True)
    try:
        return {"area": edit_area(area_id, changes, by=scope.person, known=_every_package_area())}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


class PlaceIn(BaseModel):
    kind: str
    id: str          # the thing's id as Discover lists it
    area: str = ""   # an Area's id; "" (or Everything else) takes it out


@router.put("/discover/placement")
def put_discover_placement(request: Request, body: PlaceIn, workspace_id: Optional[str] = None) -> dict:
    """Place one thing the person can open in an Area, or take it out. Its own owner may, the Area's owners may (for a
    thing taken out, the owners of the Area it stood in), and whoever administers the organisation; an agent never. A
    Definition's Area is chosen on its own page."""
    from pramanyx.discover.items import OTHER, who_of
    from pramanyx.discover.service import areas_in_view, gather
    from pramanyx.semantic.areas import ARTIFACT_KINDS, areas_for, curates, place
    _a_persons_own(request, "placing a thing in an Area")
    kind = (body.kind or "").strip()
    if kind == "definition":
        raise HTTPException(status_code=422, detail="a Definition's Area is chosen on its own page")
    if kind not in ("table", "metric", *ARTIFACT_KINDS):
        raise HTTPException(status_code=422, detail=f"a thing placed is a table, a metric or one of {', '.join(ARTIFACT_KINDS)}")
    scope = scope_of(request, workspace_id, None)
    item = next((i for i in gather(scope, (kind,))[kind].items if i.id == body.id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="No such thing among those you can open here")
    areas = areas_in_view(scope)
    target = "" if body.area == OTHER else (body.area or "").strip()
    if target and target not in areas:
        raise HTTPException(status_code=422, detail=f"{target!r} is no Area on the connections in view")
    me = who_of(scope.person).lower()
    owns = bool(me) and who_of(item.owner).lower() == me
    may = scope.curator or owns or (
        curates(areas[target], scope.person, admin=False) if target
        else item.area in areas and curates(areas[item.area], scope.person, admin=False))
    if not may:
        raise HTTPException(status_code=403, detail="its own owner, the Area's owners, or whoever administers the organisation place it")
    if not target and not item.placed:
        raise HTTPException(status_code=422, detail="nobody placed it here: it stands here by its tables or its name; place it in another Area instead")
    try:
        if kind in ("table", "metric"):
            if target and target not in {a["id"] for a in areas_for(item.connection_id)}:
                raise HTTPException(status_code=422, detail=f"{target!r} is no Area of {item.connection_name or item.connection_id}")
            ref = item.name if kind == "table" else item.id.split("/", 1)[-1]
            now = place(kind, ref, target, by=scope.person, connection_id=item.connection_id,
                        schema_name=str(item.detail.get("schema") or "") if kind == "table" else "")
        else:
            now = place(kind, item.id, target, by=scope.person)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {"kind": kind, "id": item.id, "area": now or ""}
