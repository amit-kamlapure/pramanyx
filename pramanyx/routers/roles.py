"""RBAC administration — the role catalogue, the caller's effective grants, and the
org role roster (P3).

The roster read/write endpoints are org-scoped: they operate on the caller's *own*
org (``current_org_id()``, bound per-request by ``_OrgContextMiddleware``) — an admin
can never manage another tenant's roles. They are gated on ``admin.manage_roles``,
so only an owner may assign/revoke (in localhost/identity-off mode the caller is
treated as owner, so local administration works unchanged).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from pramanyx.org.context import current_org_id
from pramanyx.rbac import (
    BUILTIN_ROLES,
    is_builtin_role,
    permissions_for,
    resolve_roles,
)
from pramanyx.rbac.store import assign_role, list_assignments, revoke_role
from pramanyx.security.authz import get_principal

router = APIRouter(tags=["rbac"])


class AssignRoleRequest(BaseModel):
    user_id: str
    role: str


def _sorted_perms(perms) -> list[str]:
    return sorted(p.value for p in perms)


@router.get("/rbac/roles")
def list_roles():
    """The built-in role catalogue + the permissions each grants (reference data)."""
    return [
        # `name` is the value a grant stores; `label` is what to show a human. They differ
        # for `analyst`, displayed as "Editor" — see rbac/roles.py.
        {"name": r.name, "label": r.label, "description": r.description,
         "permissions": _sorted_perms(r.permissions)}
        for r in BUILTIN_ROLES.values()
    ]


@router.get("/rbac/me")
def my_access(request: Request):
    """The caller's effective identity, roles and permissions — so a client can
    show/hide admin surfaces. In localhost mode the caller resolves to owner."""
    from pramanyx.security.authz import caller
    principal = get_principal(request)
    return {
        "user_id": principal.user_id if principal else None,
        # Who what this person does is recorded under — the signed-in person, or this install's own
        # login when nobody signs in. A form shows it; it never asks for a name.
        "actor": caller(),
        "signed_in": principal is not None,
        "org_id": principal.org_id if principal else current_org_id(),
        "roles": resolve_roles(principal),
        "permissions": _sorted_perms(permissions_for(principal)),
    }


@router.get("/rbac/assignments")
def get_assignments():
    """Every role grant in the caller's org (the admin roster)."""
    org = current_org_id()
    return [
        {"org_id": a.org_id, "user_id": a.user_id, "role": a.role,
         "created_at": a.created_at, "updated_at": a.updated_at}
        for a in list_assignments(org)
    ]


@router.post("/rbac/assignments", status_code=201)
def create_assignment(req: AssignRoleRequest):
    """Grant a built-in role to a user in the caller's org. Idempotent."""
    role = (req.role or "").strip().lower()
    if not is_builtin_role(role):
        raise HTTPException(status_code=400, detail=f"unknown role '{req.role}'")
    if not (req.user_id or "").strip():
        raise HTTPException(status_code=400, detail="user_id is required")
    a = assign_role(current_org_id(), req.user_id.strip(), role)
    return {"org_id": a.org_id, "user_id": a.user_id, "role": a.role,
            "created_at": a.created_at, "updated_at": a.updated_at}


@router.delete("/rbac/assignments")
def delete_assignment(user_id: str = Query(...), role: str = Query(...)):
    """Revoke a role grant from a user in the caller's org."""
    removed = revoke_role(current_org_id(), user_id.strip(), (role or "").strip().lower())
    return {"removed": removed}


# ── The people directory (People, 2026-11-15) ────────────────────────────────────────────────────────────

class DirectoryImport(BaseModel):
    csv: str
    #: True — the file is the whole directory, so a person it does not name is deactivated.
    full: bool = True
    #: True — say what would happen and change nothing (the form's first step).
    dry_run: bool = True


@router.get("/rbac/directory")
def get_directory(include_inactive: bool = False):
    """The organisation's people: email, name, title, team (a group id) and manager."""
    from dataclasses import asdict

    from pramanyx.rbac.directory import people
    return [asdict(p) for p in people(current_org_id(), include_inactive=include_inactive)]


@router.get("/people")
def find_people(request: Request, q: str = Query("", max_length=120), limit: int = Query(8, ge=1, le=25)) -> list[dict]:
    """People to name as someone, as a person types a name or an email (2026-11-25: an Area's contacts "pop up if they
    exist") — ``[{ref, name, email, source}]``, ``ref`` being who they sign in as (``user:<email>``). Read by anyone who
    may name someone, so it says names and emails only: the organisation's directory (the admin's list holds titles,
    teams and managers), the person asking, the people already named as an Area's contacts, and the organisation's
    members (a role or a group), as a thing's sharing lists them. Matched on any part of
    the name or the email; the person asking first, then the directory, by name."""
    from pramanyx.orgsettings.store import load_org_settings
    from pramanyx.rbac.directory import people
    from pramanyx.security.authz import acting_person
    words = q.strip().lower()

    def matches(*texts: str) -> bool:
        return not words or any(words in (t or "").lower() for t in texts)

    out: list[dict] = []
    seen: set[str] = set()

    def add(ref: str, name: str, email: str, source: str) -> None:
        key = ref.strip().lower()
        if key and key not in seen and matches(name, email, ref.removeprefix("user:")):
            seen.add(key)
            out.append({"ref": ref, "name": name, "email": email, "source": source})

    you = acting_person(get_principal(request))
    if you:
        add(you, you.removeprefix("user:"), "", "you")
    for p in sorted(people(current_org_id()), key=lambda p: (p.name or p.email).lower()):
        add(f"user:{p.email}", p.name or p.email, p.email, "directory")
    for area in load_org_settings().areas:
        for ref in [*area.business_owners, *area.technical_owners]:
            add(ref, ref.removeprefix("user:").removeprefix("person:"), "", "named")
    # the organisation's members — each holding a role, or in one of its groups — by the name they sign in with, as a
    # thing's sharing already lists them (2026-11-26: a comment's @ could not reach an owner who was in no directory)
    from pramanyx.rbac.groups import list_groups, list_members
    from pramanyx.rbac.store import list_assignments
    org = current_org_id()
    members = {a.user_id for a in list_assignments(org)}
    for g in list_groups(org):
        members |= {m.removeprefix("user:") for m in list_members(org, g.id) if m.startswith("user:")}
    for m in sorted(x for x in members if x):
        add(f"user:{m}", m, m if "@" in m else "", "member")
    return out[:limit]


@router.post("/rbac/directory/import")
def import_directory(body: DirectoryImport, request: Request):
    """Import people from a CSV (email, name, title, team, manager). A dry run says what would change; the real run
    applies it, puts each person in their team's group, and journals it under the person who ran it."""
    from pramanyx.rbac.directory import apply_import, plan_import
    from pramanyx.security.authz import acting_person
    if not (body.csv or "").strip():
        raise HTTPException(status_code=400, detail="The CSV is empty.")
    org = current_org_id()
    plan = (plan_import(org, body.csv, full=body.full) if body.dry_run
            else apply_import(org, body.csv, full=body.full, by=acting_person(get_principal(request))))
    if not plan.add and not plan.change and not plan.unchanged and plan.refused:
        raise HTTPException(status_code=422, detail=f"No one could be read from the CSV: {plan.refused[0]['reason']}")
    return {"applied": not body.dry_run, **plan.as_dict()}
