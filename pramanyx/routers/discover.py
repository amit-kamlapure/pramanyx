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


def _every_workspace() -> dict[str, list[str]]:
    """Each connection the organisation's workspaces hold, with the names of the workspaces that hold it (S1). A
    workspace has no members of its own: what a person may read is decided per connection and per thing, as in one."""
    from pramanyx.metastore import accessible_catalog_ids
    from pramanyx.org.context import current_org_id
    from pramanyx.workspace.store import list_workspaces
    org = current_org_id()
    homes: dict[str, list[str]] = {}
    for ws in list_workspaces():
        if org and ws.org_id and ws.org_id != org:
            continue                     # another organisation's workspace is never searched
        for cid in sorted(accessible_catalog_ids(ws.id) or ()):
            homes.setdefault(cid, []).append(ws.name)
    return homes


def scope_of(request: Request, workspace_id: Optional[str], connection_id: Optional[str], *, across: bool = False):
    """Who is looking, over which connections: the workspace's (the catalog's gate) — or, ``across``, every workspace's
    of the organisation — the organisation's, and the one named when one is."""
    from pramanyx.db.registry import list_connections
    from pramanyx.discover.items import Scope
    from pramanyx.metastore import accessible_catalog_ids
    from pramanyx.rbac.permissions import Permission
    from pramanyx.rbac.resolver import has_permission
    from pramanyx.security.authz import acting_person, get_principal, org_visible_conn_ids
    homes = _every_workspace() if across else None
    allowed = set(homes) if homes is not None else accessible_catalog_ids(workspace_id)
    org = org_visible_conn_ids()
    connections = {c["id"]: str(c.get("name") or c["id"]) for c in list_connections()
                   if (allowed is None or c["id"] in allowed) and (org is None or c["id"] in org)}
    if connection_id:
        if connection_id not in connections:
            raise HTTPException(status_code=404, detail="No such connection in this workspace")
        connections = {connection_id: connections[connection_id]}
    principal = get_principal(request)
    return Scope(request, acting_person(principal), connections, workspace_id=None if across else workspace_id,
                 curator=has_permission(principal, Permission.ADMIN_MANAGE_ORG), homes=homes)


@router.get("/discover")
def get_discover(request: Request, workspace_id: Optional[str] = None, connection_id: Optional[str] = None) -> dict:
    """The Discover page: the Areas with what each holds, what is certified, each kind with its first few, what the
    person may not open counted, and what could not be read said. No model and no warehouse is read."""
    from pramanyx.discover.service import home
    return home(scope_of(request, workspace_id, connection_id))


@router.get("/discover/atlas")
def get_atlas(request: Request, workspace_id: Optional[str] = None) -> dict:
    """The Atlas, by Area — the organisation's map (A4a, 2026-11-25): every Area in view with what it holds, how many of
    the month's answers drew on it, what waits for review and what was learned in it; and the side panel's figures —
    the month's answers, the share that drew on governed knowledge, the share placed in an Area, who answers for the
    Areas, what is used most. No model and no warehouse is read; what is not read yet is said."""
    from pramanyx.discover.atlas import atlas
    return atlas(scope_of(request, workspace_id, None))


@router.get("/discover/atlas/review")
def get_atlas_review(request: Request, area: str = "", workspace_id: Optional[str] = None) -> dict:
    """What waits for review in an Area across the connections in view, its sub-Areas' rolled up (A5); ``area=none``
    what waits in no Area, none given every row. From the Atlas's kept reading — as old as its ``read_at``."""
    from pramanyx.discover.atlas import review_in
    return review_in(scope_of(request, workspace_id, None), area)


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
                        limit: int = Query(50, ge=1, le=200),
                        across: str = Query("", pattern="^(|workspaces)$")) -> dict:
    """One ranked list across every kind and every connection in view, by meaning and by words, each result saying
    why it matched (the plan's §4.3). The question is embedded once by the platform's embedder; no model is called.

    ``across=workspaces`` (S1, 2026-11-25) searches every workspace of the organisation, outside the request's own,
    and each result names the workspaces it lives in."""
    from pramanyx.discover.items import KINDS
    from pramanyx.discover.search import search
    if kind and kind not in KINDS:
        raise HTTPException(status_code=422, detail=f"a kind is one of {', '.join(KINDS)}")
    if across:
        from pramanyx.workspace.context import workspace_scope
        with workspace_scope(None):
            return search(scope_of(request, None, connection_id, across=True), q, kind=kind, area=area,
                          certified=certified, mine=mine, limit=limit)
    return search(scope_of(request, workspace_id, connection_id), q, kind=kind, area=area, certified=certified,
                  mine=mine, limit=limit)


@router.get("/discover/areas/{area_id}")
def get_discover_area(request: Request, area_id: str, workspace_id: Optional[str] = None,
                      connection_id: Optional[str] = None, by_use: bool = False) -> dict:
    """One Area's page: the Area, its sub-areas, and what it holds by kind. ``by_use`` (the Atlas's opened Area, A4b):
    each thing with its use this month, the most used of each kind first."""
    from pramanyx.discover.service import area_page
    page = area_page(scope_of(request, workspace_id, connection_id), area_id, by_use_first=by_use)
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
    #: The glyph its curators chose (an icon role of the app); "" draws its package's, or the default.
    icon: Optional[str] = None


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
        raise HTTPException(status_code=403, detail="only this Area's business and technical contacts, or whoever "
                                                    "administers the organisation, change it")
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


class OpenedIn(BaseModel):
    kind: str
    id: str
    connection_id: str


#: What a page says it opened: the kinds with no read route of their own to record it (2026-11-24). Every other kind is
#: recorded on its own read route, so a page saying so too would count it twice.
OPENED_BY_ITS_PAGE = ("metric",)


@router.post("/discover/opened", status_code=204)
def note_discover_opened(body: OpenedIn, request: Request, workspace_id: Optional[str] = None) -> None:
    """A page says a person opened a thing that has no read route of its own — a metric. Kept as any open is
    (`discover.usage.note_opened`): once a person and a thing in ten minutes, never for an agent. Its id is Discover's
    (``<connection>/<name>``), on a connection the person may see."""
    from pramanyx.discover.usage import note_opened
    if body.kind not in OPENED_BY_ITS_PAGE:
        raise HTTPException(status_code=422, detail=f"a page says it opened a {', '.join(OPENED_BY_ITS_PAGE)}; "
                                                    f"a {body.kind or 'nothing'} is recorded where it is read")
    if not body.id.startswith(f"{body.connection_id}/") or len(body.id) > 300:
        raise HTTPException(status_code=422, detail="a metric is named <connection>/<name>")
    scope_of(request, workspace_id, body.connection_id)          # 404 for a connection the person may not see
    note_opened(request, body.kind, body.id, body.connection_id)
