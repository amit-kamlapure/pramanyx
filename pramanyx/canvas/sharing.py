"""Who may open and change a Data Canvas (the user, 2026-11-20: "Let get option to clone it, share it with people or
certify it").

A canvas is shared as a sheet is (`sheets/sharing.py`), by the same rule and in the same words: it is its workspace's —
everyone in it opens and changes it, as every canvas always was — until its maker shares it with chosen people and
groups, each able to open it and ask in it (``view``) or to change it (``edit``). The maker holds ``own``: only they
change who it is shared with, or remove it.

A canvas made before makers were kept (before 2026-11-20) has none. It stays the workspace's, and a curator — whoever
administers the organisation — holds ``own`` on it: the first curator to choose who it is shared with becomes its maker,
so a canvas shared with chosen people never shuts out the one who chose them. On an install with sign-in off, its one
person administers it.

**A canvas not shared with someone is listed and said, never opened**: the list names it and who to ask; every by-id
door refuses it with that sentence (`routers/canvas.py`, `canvas_owner_guard`).
"""
from __future__ import annotations

from typing import Optional

from pramanyx.canvas.models import Canvas, CanvasShare
from pramanyx.rbac.levels import EDIT, OWN, VIEW, level_covers
from pramanyx.sheets import sharing as _shared
from pramanyx.sheets.service import Refused
from pramanyx.sheets.sharing import Access

__all__ = ["EDIT", "OWN", "VIEW", "NotShared", "Refused", "level_of", "require", "described", "set_sharing"]


class NotShared(Refused):
    """A canvas, or what was asked of it, not shared with the person asking — in a sentence that names who to ask."""


def is_curator(principal=None) -> bool:
    """Whether the person administers the organisation — on an install with sign-in off, its one person does."""
    from pramanyx.security.authz import require_identity_enabled
    if not require_identity_enabled():
        return True
    from pramanyx.rbac.permissions import Permission
    from pramanyx.rbac.resolver import has_permission
    return has_permission(principal, Permission.ADMIN_MANAGE_ORG)


def level_of(canvas: Canvas, person: str, *, curator: Optional[bool] = None) -> Access:
    """What ``person`` (``user:<id>``) may do to ``canvas``: its maker owns it; a curator owns one with no maker; the
    rest is a sheet's rule — the workspace's is everyone's to change, a chosen one is its people's."""
    if not canvas.created_by and (is_curator() if curator is None else curator):
        return Access(OWN, "nobody made it here; you administer the organisation")
    return _shared.level_of(canvas, person)


def refusal(canvas: Canvas, got: Access, need: str) -> str:
    """Why ``need`` is not held, naming who decides."""
    maker = _shared.person_name(canvas.created_by) if canvas.created_by else "a curator"
    if not got.level:
        return f'"{canvas.name}" is not shared with you. Ask {maker} to share it with you.'
    if need == OWN:
        return (f'Only {maker}, who made "{canvas.name}", can change who it is shared with or remove it.'
                if canvas.created_by else
                f'Only a curator can change who "{canvas.name}" is shared with: nobody made it here.')
    return f'You can open "{canvas.name}" and ask in it, but not change it: {maker} shared it with you to read.'


def require(canvas: Canvas, person: str, need: str = VIEW, *, curator: Optional[bool] = None) -> Access:
    """The person's access, or `NotShared` saying why it is not enough."""
    got = level_of(canvas, person, curator=curator)
    if got.level and level_covers(got.level, need):
        return got
    raise NotShared(refusal(canvas, got, need))


def described(canvas: Canvas, person: str, *, curator: Optional[bool] = None) -> dict:
    """Who a canvas is shared with, as the person asking sees it — the same shape a sheet's sharing is said in."""
    out = _shared.described(canvas, person)
    got = level_of(canvas, person, curator=curator)
    return {**out, "maker": canvas.created_by.removeprefix("user:"), "access": got.level, "why": got.why,
            "may_change": got.level == OWN}


def set_sharing(canvas: Canvas, sharing: str, shared_with: list[dict], *, by: str,
                curator: Optional[bool] = None) -> Canvas:
    """Share a canvas with everyone in the workspace, or with the people and groups chosen. Only its owner may."""
    from pramanyx.canvas import store
    require(canvas, by, OWN, curator=curator)
    word, shares = _shared.chosen_shares(sharing, shared_with, canvas.created_by or by, what="a canvas")
    kept = store.set_sharing(canvas.id, word, [CanvasShare(**s.model_dump()) for s in shares], created_by=by)
    if kept is None:
        raise Refused("that canvas is gone")
    return kept
