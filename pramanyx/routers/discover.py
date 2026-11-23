"""Discover's doors (`pramanyx/discover/`; the plan's D1 and D3): the page, a kind or an Area's things in full, one
Area, and search.

All three are reads over what the platform keeps, scoped as the catalog is: the workspace's connections the caller's
organisation may see, and one of them when ``connection_id`` names it (checked by the connection guard, as every door
naming a connection is). Who may open each thing is each kind's own rule, applied by its reader.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

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
                       cursor: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)) -> dict:
    """Every thing of a kind, of an Area, certified, or the person's own — "View all" — a page at a time."""
    from pramanyx.discover.items import KINDS
    from pramanyx.discover.service import list_items
    if kind and kind not in KINDS:
        raise HTTPException(status_code=422, detail=f"a kind is one of {', '.join(KINDS)}")
    return list_items(scope_of(request, workspace_id, connection_id), kind=kind, area=area, certified=certified,
                      mine=mine, q=q, cursor=cursor, limit=limit)


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
