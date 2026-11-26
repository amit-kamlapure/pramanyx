"""Ask for access — the doors (Discover's left-out plan's C5, `record/access_requests.py`).

A person refused a Data Canvas or a sheet asks for it with a reason; its maker (else an admin) answers in their Inbox's
"For you" lane. Both are a person's own act: an agent's call is refused.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(tags=["access-requests"])


def _who(request: Request) -> tuple[str, bool]:
    """The person asking, as ``user:<id>``, and whether they administer the organisation."""
    from pramanyx.canvas.sharing import is_curator
    from pramanyx.security.authz import acting_person, get_principal
    principal = get_principal(request)
    return acting_person(principal), is_curator(principal)


def _persons_own(request: Request, what: str) -> None:
    from pramanyx.rbac.agent_gate import is_agent_request
    if is_agent_request(request):
        raise HTTPException(status_code=403, detail=f"{what} is a person's own act; an agent cannot do it")


class AskIn(BaseModel):
    thing: Literal["canvas", "sheet"]
    id: str = Field(min_length=1, max_length=80)
    reason: str = Field("", max_length=500)


class AnswerIn(BaseModel):
    accept: bool
    #: Why not, said to the asker — on a decline
    why: str = Field("", max_length=500)


@router.post("/access-requests", status_code=201)
def ask_for_access(req: AskIn, request: Request) -> dict:
    """Ask the maker of a Data Canvas or a sheet (else the admins) to share it with you to read — or the ask that already
    waits. 409 when you may already open it."""
    from pramanyx.record import access_requests as A
    _persons_own(request, "asking for access")
    person, admin = _who(request)
    try:
        return A.ask(req.thing, req.id, asker=person, reason=req.reason, admin=admin)
    except A.NoSuchThing as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except A.Refused as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.get("/access-requests/mine")
def my_access_request(request: Request, thing: Literal["canvas", "sheet"], id: str) -> dict:
    """Your ask for this thing, if one waits — so a refusal says "Asked" rather than offering to ask again."""
    from pramanyx.record.access_requests import is_pending_from
    person, _ = _who(request)
    return {"pending": is_pending_from(person, thing, id)}


@router.post("/access-requests/{request_id}/answer")
def answer_access_request(request_id: str, req: AnswerIn, request: Request) -> dict:
    """Answer an ask addressed to you: accept shares the thing with the asker to read; decline keeps ``why`` for them.
    403 when the ask is not yours to answer."""
    from pramanyx.record import access_requests as A
    _persons_own(request, "answering an ask for access")
    person, admin = _who(request)
    try:
        return A.answer(request_id, by=person, admin=admin, accept=req.accept, why=req.why)
    except A.NoSuchThing as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except A.Refused as exc:
        raise HTTPException(status_code=403 if "only " in str(exc) else 409, detail=str(exc)) from None
