"""Ask for access — Discover's left-out plan's C5 (`docs/DISCOVER_LEFT_OUT_PLAN_2026-11-25.md` §4.1; the user's call 4,
2026-11-25: "Access is decided by the thing's owner, else an admin").

Where the app says no and knows what was refused and whose it is — a Data Canvas, a sheet — a person may ask for it, with
a short reason. The ask is a proposal like every other thing awaiting a person (`actions/inbox`, kind
``access_request``), addressed to the thing's maker, or to the organisation's admins when nobody made it here. It
reaches them in the Inbox's "For you" lane, never anyone else's. Accepting shares the thing with the asker to read,
through the thing's own sharing door (so only its owner can); declining says why, and the asker reads it in their own
"For you" lane.

One ask a person and a thing is pending at once: asking again returns the one that waits. A thing the person may
already open is not asked for. Nothing here is a model's: an ask is a person's own act, and so is its answer.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

KIND = "access_request"
THINGS = ("canvas", "sheet")
#: How long an answered ask stays in the asker's "For you" lane.
ANSWERED_DAYS = 30
#: The most words a reason may carry.
REASON_MOST = 500


class Refused(ValueError):
    """An ask that cannot be made or answered, in a sentence."""


class NoSuchThing(LookupError):
    """There is no such canvas or sheet."""


def _id(person: str) -> str:
    return str(person or "").strip().removeprefix("user:").removeprefix("person:")


def _user(person: str) -> str:
    return f"user:{_id(person)}" if _id(person) else ""


def thing(kind: str, thing_id: str) -> dict:
    """``{kind, id, name, maker, connection_id}`` — what is asked for, as its own store keeps it."""
    if kind == "canvas":
        from pramanyx.canvas.store import get_canvas
        c = get_canvas(thing_id)
        if c is None:
            raise NoSuchThing("there is no such Data Canvas")
        return {"kind": kind, "id": c.id, "name": c.name, "maker": _user(c.created_by),
                "connection_id": c.primary_connection_id or ""}
    if kind == "sheet":
        from pramanyx.sheets import model
        s = model.get(thing_id)
        if s is None:
            raise NoSuchThing("there is no such sheet")
        return {"kind": kind, "id": s.id, "name": s.name, "maker": _user(s.created_by), "connection_id": ""}
    raise Refused(f"access is asked for a Data Canvas or a sheet, not {kind!r}")


def _level(kind: str, thing_id: str, person: str, *, admin: bool) -> str:
    if kind == "canvas":
        from pramanyx.canvas import sharing
        from pramanyx.canvas.store import get_canvas
        c = get_canvas(thing_id)
        return sharing.level_of(c, _user(person), curator=admin).level if c else ""
    from pramanyx.sheets import model, sharing as sheet_sharing
    s = model.get(thing_id)
    return sheet_sharing.level_of(s, _user(person)).level if s else ""


def _what(kind: str) -> str:
    return "Data Canvas" if kind == "canvas" else "sheet"


def _pending() -> list:
    from pramanyx.actions.inbox import list_proposals
    return [p for p in list_proposals(status="pending", kind=KIND, limit=1000) if not p.expired]


def view(p) -> dict:
    """An ask as the Inbox and the asker read it."""
    d, prm = dict(p.detail or {}), dict(p.params or {})
    return {"id": p.id, "thing": prm.get("thing"), "thing_id": prm.get("id"), "name": d.get("name", ""),
            "asker": _id(prm.get("asker", "")), "reason": p.reasoning, "to": [_id(t) for t in d.get("to") or []],
            "to_admins": bool(d.get("to_admins")), "status": p.status, "why": p.status_message,
            "asked_at": p.created_at, "answered_at": p.resolved_at, "answered_by": _id(p.resolved_by)}


def ask(kind: str, thing_id: str, *, asker: str, reason: str = "", admin: bool = False) -> dict:
    """``asker`` asks for ``thing`` with ``reason``: staged for its maker (else the admins), or the ask that already
    waits. `Refused` when they may already open it."""
    from pramanyx.actions.inbox import StagedProposal, stage_proposal
    t = thing(kind, thing_id)
    if not _id(asker):
        raise Refused("an ask for access is a person's own, and nobody is signed in")
    if _level(kind, thing_id, asker, admin=admin):
        raise Refused(f'you can already open "{t["name"]}"')
    for p in _pending():
        prm = p.params or {}
        if prm.get("thing") == kind and prm.get("id") == thing_id and _id(prm.get("asker", "")) == _id(asker):
            return {**view(p), "already": True}
    words = " ".join(str(reason or "").split())[:REASON_MOST]
    to = [t["maker"]] if t["maker"] else []
    p = stage_proposal(StagedProposal(
        kind=KIND, connection_id=t["connection_id"], action_id=f"share_{kind}",
        params={"thing": kind, "id": thing_id, "asker": _user(asker), "level": "view"},
        detail={"name": t["name"], "to": to, "to_admins": not to, "what": _what(kind)},
        reasoning=words, proposer=_user(asker), source=f"person:{_id(asker)}",
        run_id=f"access:{kind}:{thing_id}:{_id(asker)}", call_id=uuid.uuid4().hex[:12]))
    return {**view(p), "already": False}


def may_answer(p, person: str, *, admin: bool) -> bool:
    """Whether ``person`` answers this ask: the thing's maker, or an admin when nobody made it here."""
    d = p.detail or {}
    if d.get("to_admins"):
        return admin
    return _id(person) in {_id(t) for t in d.get("to") or []}


def addressed_to(person: str, *, admin: bool) -> list:
    """The asks that wait on ``person``, newest first."""
    return [p for p in _pending() if may_answer(p, person, admin=admin)]


def asked_by(person: str, *, days: int = ANSWERED_DAYS) -> list:
    """``person``'s own asks: those that wait, and those answered in the last ``days``, newest first."""
    from pramanyx.actions.inbox import list_proposals
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    out = []
    for p in list_proposals(kind=KIND, limit=1000):
        if _id((p.params or {}).get("asker", "")) != _id(person):
            continue
        if p.status == "pending" or str(p.resolved_at or "") >= since[:19]:
            out.append(p)
    return out


def answer(proposal_id: str, *, by: str, admin: bool, accept: bool, why: str = "") -> dict:
    """``by`` answers an ask: accepted, the thing is shared with the asker to read; declined, ``why`` is kept for them."""
    from pramanyx.actions.inbox import accept_proposal, get_proposal, reject_proposal
    p = get_proposal(proposal_id)
    if p is None or p.kind != KIND:
        raise NoSuchThing("there is no such ask for access")
    if not p.pending:
        raise Refused(f"this ask was already answered ({p.status})")
    if not may_answer(p, by, admin=admin):
        who = "an admin" if (p.detail or {}).get("to_admins") else ", ".join(view(p)["to"]) or "its maker"
        raise Refused(f"only {who} answers this ask")
    if accept:
        result, _ = accept_proposal(proposal_id, actor=_user(by))
        if not result.ok:
            raise Refused(result.message or "it could not be shared")
    else:
        if not reject_proposal(proposal_id, actor=_user(by),
                               message=" ".join(str(why or "").split())[:REASON_MOST] or "declined, with no reason given"):
            raise Refused("this ask was already answered")
    return view(get_proposal(proposal_id))


def share_accepted(p, *, actor: str) -> tuple[bool, str]:
    """The accept's effect (`actions/inbox` calls it once the ask is resolved): the thing shared with the asker to read,
    through the thing's own door — kept as its owner's act, so only someone who may change its sharing can."""
    prm = dict(p.params or {})
    kind, thing_id, asker = prm.get("thing"), str(prm.get("id") or ""), _id(prm.get("asker", ""))
    try:
        if kind == "canvas":
            from pramanyx.canvas import sharing
            from pramanyx.canvas.store import get_canvas
            c = get_canvas(thing_id)
            if c is None:
                return False, "that Data Canvas is gone"
            shares = [s.model_dump() for s in c.shared_with if not (s.kind == "person" and s.id == asker)]
            sharing.set_sharing(c, "chosen", [*shares, {"kind": "person", "id": asker, "level": "view"}],
                                by=_user(actor) if not c.created_by else c.created_by,
                                curator=bool((p.detail or {}).get("to_admins")))
            return True, f'"{c.name}" shared with {asker} to read'
        if kind == "sheet":
            from pramanyx.sheets import model, sharing as sheet_sharing
            s = model.get(thing_id)
            if s is None:
                return False, "that sheet is gone"
            shares = [x.model_dump() for x in s.shared_with if not (x.kind == "person" and x.id == asker)]
            sheet_sharing.set_sharing(s, "chosen", [*shares, {"kind": "person", "id": asker, "level": "view"}],
                                      by=s.created_by or _user(actor))
            return True, f'"{s.name}" shared with {asker} to read'
    except Exception as exc:  # noqa: BLE001 — the thing's own door refused; said on the ask, nothing shared
        return False, str(exc)[:300]
    return False, f"access is asked for a Data Canvas or a sheet, not {kind!r}"


def rows_for(person: str, *, admin: bool) -> list[dict]:
    """The "For you" rows about access: each ask waiting on ``person``, and each of their own asks answered."""
    out = []
    for p in addressed_to(person, admin=admin):
        v = view(p)
        out.append({"source": "access_request", "id": p.id, "since": p.created_at, "ask": v,
                    "title": f'{v["asker"]} asks to open the {(p.detail or {}).get("what", "thing")} “{v["name"]}”'
                             + (f" — {v['reason']}" if v["reason"] else ""),
                    "resolve": {"surface": "access", "answer": f"/access-requests/{p.id}/answer"}})
    for p in asked_by(person):
        if p.status == "pending":
            continue
        v = view(p)
        said = ("shared it with you to read" if p.status in ("accepted", "executed")
                else f"did not share it: {v['why']}" if p.status == "rejected" else f"the ask {p.status}")
        out.append({"source": "access_answer", "id": p.id, "since": p.resolved_at or p.created_at, "ask": v,
                    "title": f'{v["answered_by"] or "Its owner"} {said} — “{v["name"]}”',
                    "open": {"kind": v["thing"], "id": v["thing_id"]} if p.status in ("accepted", "executed") else None})
    return out


def is_pending_from(person: str, kind: str, thing_id: str) -> Optional[dict]:
    """The ask ``person`` already made for this thing, if one waits — so a list can say "Asked" instead of offering it."""
    for p in _pending():
        prm = p.params or {}
        if prm.get("thing") == kind and prm.get("id") == thing_id and _id(prm.get("asker", "")) == _id(person):
            return view(p)
    return None
