"""Where the coworker is — so the app can lead to it.

The coworker (`coworker/`) is a second page of the platform, served by its own process on its own port. The app
reaches it from the nine dots in its top bar, and for that it has to know two things: that a coworker is running
now, and the address to open. Both are facts about a process that may start and stop while the API runs, so
neither is configuration and neither is stored.

* **The coworker says where it is**, when it starts and every half minute after (`coworker/plugins/home`). The
  address it gives is the one its own shell prints for a person to open.
* **The API remembers the last thing it was told, for two minutes.** A coworker that has stopped saying so is not
  offered: the app draws no nine dots, where it would otherwise draw a way in that leads nowhere.

Only this machine may say where the coworker is, and only an address on this machine is accepted. The address is
opened by a person's browser from the app's top bar; a route that let any caller set it would let any caller choose
where the app sends people.

**A coworker turn is a run, and is recorded where runs are.** The coworker's shell keeps its own trajectory of a
turn — what it was given, each model call, each tool call. Agent Ops reads one store, the session log, and until
this a coworker turn was not in it: the platform's own work for each question was (one trace per `ask`), and the
coworker's model calls were, filed under no run at all. `POST /coworker/trace` takes the turn's events as they
happen and writes them to that same store, so the turn is one trace an operator opens like any other:

* the request, each tool call and its result, and the end of the turn come from the coworker;
* its **model calls are not taken here**. The model door (`routers/model_door.py`) already records every one, with
  its tokens and its cost; the coworker names the turn on each call and the door files the call under it. Taking
  them here too would count the spend twice;
* **the platform's own work for the turn is in the same trace, not a second one.** Before the coworker asks the
  governed answer path a question, it says so (`PUT /coworker/claim`: this question, on this connection, is step
  such-and-such of turn so-and-so). The answer path then records its work — its model calls, its query, its
  checks — under the turn's trace and inside that step, where it would otherwise have opened a trace of its own.
  One question is one trace: what the coworker did, and inside its call, what the platform did to answer. The
  claim is matched on the question and the connection because a tool call carries nothing else: the coworker's
  shell cannot add a field to it. A claim is used once and lasts two minutes;
* the conversation's words are the coworker's and stay with it. What is kept is the question, each tool's name and
  what it was asked, and where in the coworker's own log the rest is (`shell_session`, `seq`).

A trace written here is named `cw-…` and no other name is accepted, so this route cannot write into a run of the
platform's own.
"""
from __future__ import annotations

import ipaddress
import re
import time
from typing import Any, Literal, Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(tags=["coworker"])

#: How long the last announcement stands. The coworker says where it is every 30 seconds; four missed is gone.
FRESH_FOR = 120.0

_last: dict = {"url": "", "at": 0.0}


def _now() -> float:
    """A seam, so a test moves the clock."""
    return time.monotonic()


def _on_this_machine(host: Optional[str]) -> bool:
    if not host:
        return False
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


class CoworkerAddress(BaseModel):
    url: str = Field(max_length=2048, description="The address a person opens to reach the coworker.")


class CoworkerDoor(BaseModel):
    available: bool = Field(description="Whether a coworker has said it is running within the last two minutes.")
    url: Optional[str] = Field(default=None, description="The address to open, when one is running.")


@router.put("/coworker/address", response_model=CoworkerDoor)
def say_where_the_coworker_is(body: CoworkerAddress, request: Request) -> CoworkerDoor:
    """The coworker's own announcement of its address. Refused from another machine, and for an address on one."""
    if not _on_this_machine(request.client.host if request.client else None):
        raise HTTPException(status_code=403, detail="Only a coworker on this machine may say where it is.")
    parts = urlsplit(body.url)
    if parts.scheme not in ("http", "https") or not _on_this_machine(parts.hostname):
        raise HTTPException(status_code=422, detail="The coworker's address must be an http(s) address on this machine.")
    _last["url"], _last["at"] = body.url, _now()
    return CoworkerDoor(available=True, url=body.url)


@router.get("/coworker", response_model=CoworkerDoor)
def where_the_coworker_is() -> CoworkerDoor:
    """Whether a coworker is running, and the address to open. Reads what was last said; asks nothing."""
    if _last["url"] and _now() - _last["at"] <= FRESH_FOR:
        return CoworkerDoor(available=True, url=_last["url"])
    return CoworkerDoor(available=False)


# ── a coworker turn, as a trace ──────────────────────────────────────────────────────────────────────────────────

#: A coworker turn's trace: `cw-<shell session, shortened>-<turn>`. The prefix is the boundary — see the module's note.
TRACE_NAME = re.compile(r"^cw-[A-Za-z0-9]{6,40}-[0-9]{1,6}$")
_SESSION_NAME = re.compile(r"^[A-Za-z0-9-]{6,80}$")
#: What a payload may carry. Named, so a field the shell adds later is not stored because it arrived.
_PAYLOAD_KEYS = frozenset({
    "question", "mode", "turn", "step", "tool", "arguments", "platform_trace", "investigation_id", "receipt_id",
    "headline", "rows", "reason", "error", "message", "shell_session", "seq", "calls",
})


class CoworkerTraceEvent(BaseModel):
    kind: Literal["user_request", "tool_call", "tool_call_result", "final_response", "execution_error"] = Field(
        description="What happened. A model call is not taken: the model door records those.")
    name: str = Field(default="", max_length=120, description="The tool's name, or `coworker` for the turn itself.")
    span_id: Optional[str] = Field(default=None, max_length=80, description="A tool call's id; its result carries the same.")
    ok: Optional[bool] = None
    duration_ms: Optional[float] = Field(default=None, ge=0)
    conn_id: Optional[str] = Field(default=None, max_length=80, description="The connection the conversation is held to.")
    row_count: Optional[int] = Field(default=None, ge=0)
    payload: dict[str, Any] = Field(default_factory=dict)


class CoworkerTraceBatch(BaseModel):
    trace_id: str = Field(max_length=60, description="The turn's trace, `cw-<session>-<turn>`.")
    session: str = Field(max_length=80, description="The shell's own id for the conversation.")
    events: list[CoworkerTraceEvent] = Field(max_length=50)


class CoworkerTraceTaken(BaseModel):
    written: int = Field(description="How many events were written to the session log.")


@router.post("/coworker/trace", response_model=CoworkerTraceTaken)
def take_a_coworker_turn(body: CoworkerTraceBatch, request: Request) -> CoworkerTraceTaken:
    """Events of one coworker turn, written to the session log Agent Ops reads. From this machine only."""
    if not _on_this_machine(request.client.host if request.client else None):
        raise HTTPException(status_code=403, detail="Only a coworker on this machine may record its turns.")
    if not TRACE_NAME.match(body.trace_id) or not _SESSION_NAME.match(body.session):
        raise HTTPException(status_code=422, detail="A coworker turn's trace is named cw-<session>-<turn>.")
    from pramanyx.obs import session_log
    from pramanyx.org.context import reset_session_id, set_session_id

    # The door a run came in by is read off its session id's prefix (`slack:…`, `mcp:…`); this is `coworker:…`.
    token = set_session_id(f"coworker:{body.session}")
    try:
        for event in body.events:
            session_log.emit(
                event.kind, name=event.name or "coworker", trace_id=body.trace_id, span_id=event.span_id,
                ok=event.ok, duration_ms=event.duration_ms, conn_id=event.conn_id, row_count=event.row_count,
                error_class=("coworker" if event.ok is False and event.kind != "tool_call" else None),
                payload={k: v for k, v in event.payload.items() if k in _PAYLOAD_KEYS},
            )
    finally:
        reset_session_id(token)
    return CoworkerTraceTaken(written=len(body.events))


# ── the platform's work for a turn, inside the turn's trace ──────────────────────────────────────────────────────

#: How long a claim waits for its question to arrive. The coworker claims and then asks at once.
CLAIM_FOR = 120.0
_claims: list[dict] = []


class CoworkerClaim(BaseModel):
    trace_id: str = Field(max_length=60, description="The turn's trace, `cw-<session>-<turn>`.")
    session: str = Field(max_length=80, description="The shell's own id for the conversation.")
    span_id: str = Field(min_length=1, max_length=80, description="The tool call the question is asked by.")
    question: str = Field(min_length=1, max_length=20000)
    connection: str = Field(default="", max_length=80)


@router.put("/coworker/claim", status_code=204)
def claim_the_next_answer(body: CoworkerClaim, request: Request) -> None:
    """Said by the coworker just before it asks: the answer to this question belongs inside this step of this turn."""
    if not _on_this_machine(request.client.host if request.client else None):
        raise HTTPException(status_code=403, detail="Only a coworker on this machine may claim an answer.")
    if not TRACE_NAME.match(body.trace_id) or not _SESSION_NAME.match(body.session):
        raise HTTPException(status_code=422, detail="A coworker turn's trace is named cw-<session>-<turn>.")
    now = _now()
    _claims[:] = [c for c in _claims if now - c["at"] <= CLAIM_FOR][-200:]
    _claims.append({"trace_id": body.trace_id, "session": body.session, "span_id": body.span_id,
                    "question": body.question, "connection": body.connection, "at": now})


def claimed_for(question: str, conn_id: str) -> Optional[dict]:
    """The coworker's claim on this question on this connection, taken — or None, and the run opens its own trace.

    The oldest fresh claim that matches: two calls asking the same thing are answered in the order they were made.
    """
    now = _now()
    for at, claim in enumerate(_claims):
        if (now - claim["at"] <= CLAIM_FOR and claim["question"] == question
                and (not claim["connection"] or claim["connection"] == (conn_id or ""))):
            return _claims.pop(at)
    return None
