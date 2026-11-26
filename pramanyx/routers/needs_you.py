"""Needs you — the Inbox's doors (the Atlas plan's §7.8, decision 2; the user, 2026-11-25: "Yes to all three, go ahead";
2026-11-26: "go ahead with the Inbox"). One view over every queue that waits on a person, by lane — what to decide,
alerts, the knowledge review by Area — each row read or not for the person signed in, and the count the rail shows.
Reading writes nothing (`record/needs_you.py`); marking read is the person's own record, one artifact for them.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

router = APIRouter(tags=["needs-you"])


def _scope(request: Request, workspace_id: Optional[str]):
    from pramanyx.routers.discover import scope_of
    return scope_of(request, workspace_id, None)


@router.get("/needs-you")
def get_needs_you(request: Request, workspace_id: Optional[str] = None) -> dict:
    """What waits on this person across the connections in view: ``lanes`` — to decide (staged proposals, automation
    approvals, paused deep runs, automations that cannot dispatch), alerts (monitor and agent), the knowledge review by
    Area — each row with ``key`` and ``read``; ``badge``, what this person has not opened that is theirs to act on."""
    from pramanyx.record.needs_you import needs_you
    return needs_you(_scope(request, workspace_id))


@router.get("/needs-you/count")
def get_needs_you_count(request: Request, workspace_id: Optional[str] = None) -> dict:
    """The rail's count: what this person has not opened, by lane, and in all."""
    from pramanyx.record.needs_you import needs_you
    got = needs_you(_scope(request, workspace_id))
    lanes = {lane["id"]: (lane.get("mine_unread", lane["unread"]) if lane["id"] == "review" else lane["unread"])
             for lane in got["lanes"]}
    return {"badge": got["badge"], "lanes": lanes}


class Marks(BaseModel):
    #: the rows' keys, as the view gave them (`row_key`)
    keys: list[str] = Field(default_factory=list, max_length=2000)
    #: False marks them unread again
    read: bool = True


@router.post("/needs-you/read")
def mark_needs_you_read(req: Marks, request: Request, workspace_id: Optional[str] = None) -> dict:
    """Mark rows read (or unread) for the person signed in. Past `TIDY_AT` marks, those whose rows no longer wait are
    let go, read afresh then rather than on every mark."""
    from pramanyx.record.needs_you import TIDY_AT, mark, needs_you
    scope = _scope(request, workspace_id)
    marks = mark(scope.person, req.keys, read=req.read)
    if len(marks) > TIDY_AT:
        marks = mark(scope.person, [], live=set(needs_you(scope, with_live=True)["live"]))
    return {"marked": len(req.keys), "read": len(marks)}
