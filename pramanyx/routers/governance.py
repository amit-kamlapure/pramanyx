"""Governance surface (Wave G3) — usage attribution, the unified audit feed, usage caps.

Reporting routes report over stores that already exist and cost neither a warehouse query
nor a model call. The one write surface is the usage-cap pair (2026-09-06): the G4 cap
store shipped with ``set_cap``/``clear_cap`` and no route, so caps could be read by the
enforcement path and set by nobody — the complete-and-inert shape §7 of the roadmap names.

Authorization rides the existing declarative table in ``pramanyx/rbac/policy.py`` rather
than a decorator here — that table is the auditable map of the whole surface, and a route
that gated itself would be invisible to anyone reading it.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

router = APIRouter(tags=["governance"])


@router.get("/usage")
def get_usage(
    by: str = Query(default="provider,model",
                    description="Comma-separated axes: provider, model, feature, "
                                "org_id, user_id, conn_id"),
    scan: int = Query(default=5000, ge=1, le=100_000),
    org_id: Optional[str] = None,
):
    """Model usage and cost, grouped by the requested axes.

    The response carries ``unattributed`` and ``coverage`` per axis alongside the rows.
    That is not padding: ``user_id`` is 0% populated in local mode, and a page that folded
    those into one blank-named group would present it as a real cohort. Cost likewise
    reports ``cost_is_complete`` — a model with no declared price contributes nothing to
    the total rather than being counted as free.
    """
    from pramanyx.obs.usage import AXES, ensure_catalogue_prices, usage_report

    axes = tuple(a.strip() for a in (by or "").split(",") if a.strip())
    if not axes:
        raise HTTPException(status_code=400, detail="`by` needs at least one axis")
    if unknown := [a for a in axes if a not in AXES]:
        raise HTTPException(
            status_code=400,
            detail=f"unknown axis/axes {unknown}; known: {sorted(AXES)}")
    # Ask the provider's catalogue for rates (at most hourly) BEFORE pricing, as the obs summary does: this reader never
    # did, so on a fresh API process Spend read "$0.00 at least" until something else loaded them (2026-10-12).
    ensure_catalogue_prices()
    return usage_report(axes=axes, org_id=org_id, scan=scan).to_dict()


@router.get("/usage/cost-sql")
def get_cost_sql():
    """The copy-pasteable cost query against our own session log.

    Served rather than only documented so it stays the same string the module computes
    from — `pramanyx_ops` reads that table directly, and an agent writing its own SQL needs
    column names that are real today, not as of whenever a doc was last edited.
    """
    from pramanyx.obs.usage import COST_SQL

    return {"sql": COST_SQL, "table": "session_events", "kind": "llm_call"}


@router.get("/audit/feed")
def get_audit_feed(
    category: Optional[str] = Query(default=None,
                                    description="data_access | governance_change | "
                                                "action_decision | model_call | "
                                                "human_verdict | enforcement"),
    limit: int = Query(default=100, ge=1, le=1000),
    since: Optional[str] = Query(default=None, description="govern.justifications: from this "
                                 "date or moment (ISO-8601), inclusive"),
    until: Optional[str] = Query(default=None, description="govern.justifications: before this "
                                 "date or moment, exclusive"),
    cursor: Optional[str] = Query(default=None, description="govern.justifications: the "
                                  "`next_cursor` of the page before"),
):
    """Governance events across every audit sink, newest first.

    Five sinks record governance-relevant events and none knows about the others; this
    reads them under one category vocabulary. An unknown category is a 400 rather than an
    empty list — "no events" and "that category does not exist" are different answers.

    Arc TC, TC-5 (`govern.justifications`, off by default): `since`/`until` bound the window
    and `cursor` pages past the newest thousand — a position in the feed's own order, so a
    page never shifts as events arrive. Off, those three are read by nothing.
    """
    from pramanyx.govern.audit_categories import CATEGORIES, BadWindow, feed, feed_page
    from pramanyx.govern.justifications import required

    if required():
        try:
            page = feed_page(category=category, limit=limit, since=since, until=until,
                             cursor=cursor)
        except BadWindow as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return {"categories": list(CATEGORIES), "category": category,
                "count": len(page["events"]), "events": [e.to_dict() for e in page["events"]],
                "since": page["since"], "until": page["until"],
                "next_cursor": page["next_cursor"]}
    try:
        events = feed(category=category, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"categories": list(CATEGORIES), "category": category,
            "count": len(events), "events": [e.to_dict() for e in events]}


@router.get("/audit/feed/export")
def export_audit_feed(
    format: str = Query(default="csv", description="csv | jsonl"),
    category: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
):
    """Arc TC, TC-5 (`govern.justifications`) — the feed's whole window as a file, streamed
    page by page through the same cursor, with the same filters as the feed. Off: the answer
    of a route that does not exist."""
    from fastapi.responses import StreamingResponse

    from pramanyx.govern.audit_categories import BadWindow, export_rows
    from pramanyx.govern.justifications import required

    if not required():
        raise HTTPException(status_code=404, detail="Not Found")
    try:
        rows = export_rows(fmt=format, category=category, since=since, until=until)
    except BadWindow as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    media = "text/csv" if format == "csv" else "application/x-ndjson"
    name = f"pramanyx-governance-feed.{'csv' if format == 'csv' else 'jsonl'}"
    return StreamingResponse(rows, media_type=media,
                             headers={"Content-Disposition": f"attachment; filename={name}"})


@router.get("/governance/gate-map")
def get_gate_map():
    """Every door in and out, as a person reads it: where a statement reaches a warehouse and how
    its dialect is handled (the census the build is held to), and each law of the departure gate
    with what it held. A read; an install without the census says so."""
    from pramanyx.govern.gate_map import gate_map

    return gate_map()


# ── usage caps (G4's missing door, 2026-09-06) ────────────────────────────────


class CapIn(BaseModel):
    scope: str
    subject: str = "*"
    metric: str
    limit: float = Field(ge=0)
    window_hours: int = Field(default=24, ge=1)
    action: str = "alert"


@router.get("/governance/caps")
def list_usage_caps(observe: bool = True):
    """Every declared cap, with the vocabulary the form needs and — because a cap
    without its measurement is just a wish — the observed value of each cap's metric
    over its own window, read through the same rollup the usage page shows."""
    from pramanyx.govern.cap_store import list_caps
    from pramanyx.govern.usage_caps import ACTIONS, METRICS, SCOPES, observed_usage
    from pramanyx.org.context import current_org_id

    caps = [c.to_dict() for c in list_caps()]
    if observe and caps:
        org = current_org_id()
        seen: dict[tuple, dict] = {}
        for cap in caps:
            key = (cap["scope"], cap["subject"], cap["window_hours"])
            if key not in seen:
                try:
                    seen[key] = observed_usage(
                        org_id=org,
                        user_id=cap["subject"] if cap["scope"] == "user" else "",
                        window_hours=cap["window_hours"])
                except Exception as exc:
                    from pramanyx.kernel.errors import tolerate
                    tolerate(exc, "cap list: observed usage unreadable; caps still served",
                             counter="govern.caps.observe")
                    seen[key] = {}
            cap["observed"] = seen[key].get(cap["metric"])
    return {"caps": caps, "scopes": list(SCOPES), "metrics": list(METRICS),
            "actions": list(ACTIONS)}


@router.put("/governance/caps")
def put_usage_cap(body: CapIn):
    """Declare (or replace) one cap. The author is the identified caller — a limit
    nobody set is not a policy, so without a sign-in it is the person the request acts
    for (`authz.caller`), never blank and never the word ``operator``."""
    from pramanyx.govern.cap_store import set_cap
    from pramanyx.org.context import current_user_id
    from pramanyx.security.authz import caller

    try:
        cap = set_cap(body.scope, body.subject, body.metric, body.limit,
                      window_hours=body.window_hours, action=body.action,
                      set_by=current_user_id() or caller())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return cap.to_dict()


@router.delete("/governance/caps")
def delete_usage_cap(scope: str, metric: str, subject: str = "*",
                     window_hours: int = Query(default=24, ge=1)):
    """Remove one cap — a real delete, per the store's own law (a retired cap that
    still reads as present would keep refusing work after the operator lifted it)."""
    from pramanyx.govern.cap_store import clear_cap
    from pramanyx.org.context import current_user_id
    from pramanyx.security.authz import caller

    removed = clear_cap(scope, subject, metric, window_hours=window_hours,
                        cleared_by=current_user_id() or caller())
    if not removed:
        raise HTTPException(status_code=404, detail="no cap matches those dimensions")
    return {"removed": True, "scope": scope, "subject": subject, "metric": metric,
            "window_hours": window_hours}


@router.get("/governance/tags")
def get_governed_tags(key: str | None = None, securable_prefix: str | None = None,
                      limit: int = 200):
    """Browse the G2 governed-tag plane (read-only). S1/J13: the governance axis
    was write-only — tags existed in the store with no route and no UI, so a
    'Certified' securable could never LOOK certified. Writes stay with the
    clearance machinery; this is the render path."""
    from dataclasses import asdict

    from pramanyx.govern.tag_store import list_tags
    return [asdict(t) for t in
            list_tags(key=key, securable_prefix=securable_prefix, limit=limit)]


# ── certified and deprecated (the ontology study, Phase 1, 2026-11-17) ───────────────────────────────────────────────

class CertificationIn(BaseModel):
    kind: str = Field(min_length=1, max_length=20)      # table · document · dashboard
    ref: str = Field(min_length=1, max_length=300)      # the table's name, or the asset's id
    connection_id: str = Field("", max_length=80)
    schema_name: str = Field("", alias="schema", max_length=120)
    status: str = Field("", max_length=20)              # certified · deprecated · "" to clear
    why: str = Field("", max_length=400)


def _curator_or_owner(kind: str, ref: str, who: str, principal) -> bool:
    """A curator — whoever administers the organisation — certifies anything; a document's owner certifies their own."""
    from pramanyx.rbac.permissions import Permission
    from pramanyx.rbac.resolver import has_permission
    if has_permission(principal, Permission.ADMIN_MANAGE_ORG):
        return True
    if kind == "document":
        from pramanyx.knowledge.access import access_of
        from pramanyx.knowledge.indexer import get_document
        entry = get_document(ref) or {}
        owner = str(access_of(entry).get("owner") or "") if entry else ""
        return bool(owner) and owner.lower() == who.replace("user:", "").lower()
    return False


@router.put("/governance/certification")
def put_certification(body: CertificationIn, request: Request):
    """Certify or deprecate a table, document or dashboard — a curator's word (a document's owner's for
    their own), never an agent's. A deprecation says why. Clearing it is an empty ``status``."""
    from pramanyx.govern.certification import securable_for, set_certification
    from pramanyx.rbac.agent_gate import is_agent_request
    from pramanyx.security.authz import acting_person
    if is_agent_request(request):
        raise HTTPException(status_code=403, detail="certifying or deprecating an asset is a person's own call; an agent cannot make it")
    principal = getattr(request.state, "principal", None)
    who = acting_person(principal)
    if not _curator_or_owner(body.kind, body.ref, who, principal):
        raise HTTPException(status_code=403, detail="only a curator — the organisation's owner or an admin — certifies "
                                                    "or deprecates this; a document's owner does their own")
    try:
        securable = securable_for(body.kind, body.ref, connection_id=body.connection_id, schema=body.schema_name)
        now = set_certification(securable, body.status, by=who, why=body.why)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {"securable": securable, "certification": now}


@router.get("/governance/certification")
def get_certification(kind: str, connection_id: str = "", ref: str = ""):
    """What is certified or deprecated: one asset (``ref``), or every one of a kind (a connection's tables)."""
    from pramanyx.govern import certification as K
    try:
        if ref:
            return {"certification": K.certification_of(K.securable_for(kind, ref, connection_id=connection_id))}
        if kind == "table":
            if not connection_id:
                raise ValueError("a connection's tables are read by its id")
            return {"by_ref": K.tables_of(connection_id)}
        if kind not in K.KINDS:
            raise ValueError(f"one of {', '.join(K.KINDS)}")
        return {"by_ref": K.artifacts_of(kind)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
