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
import logging
import re
import time
from typing import Any, Literal, Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from pramanyx.security.authz import connection_owner_guard

router = APIRouter(tags=["coworker"])
logger = logging.getLogger(__name__)

#: How long an announcement stands (`pramanyx/coworkers.py`, which keeps them: one per person's coworker).
from pramanyx.coworkers import FRESH_FOR  # noqa: E402,F401 — re-exported for readers of this router


def _now() -> float:
    """A seam, so a test moves the clock (the answer claims below)."""
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
    person: str = Field(default="", max_length=200,
                        description="Whose coworker it is; empty for the install's first, started by start_all.sh.")


class CoworkerDoor(BaseModel):
    available: bool = Field(description="Whether the caller's own coworker has said it is running in the last two minutes.")
    url: Optional[str] = Field(default=None, description="The address to open, when it is running.")
    can_start: bool = Field(default=False, description="Whether this install starts a coworker for the caller on request.")
    starting: bool = Field(default=False, description="Whether the caller's coworker is starting now.")
    reason: str = Field(default="", description="Why none can be started, when none can.")


def _person(request: Request) -> str:
    """Who the caller is, as a delegation names them (`routers/authcfg.py`): the signed-in person, else the install's
    operator — so a coworker's owner and the delegations it takes always agree."""
    from pramanyx.security.authz import caller, get_principal
    principal = get_principal(request)
    return principal.user_id if principal else caller()


def _single_person() -> bool:
    from pramanyx.security.authz import require_identity_enabled
    return not require_identity_enabled()


@router.put("/coworker/address", response_model=CoworkerDoor)
def say_where_the_coworker_is(body: CoworkerAddress, request: Request) -> CoworkerDoor:
    """The coworker's own announcement of its address. Refused from another machine, and for an address on one."""
    if not _on_this_machine(request.client.host if request.client else None):
        raise HTTPException(status_code=403, detail="Only a coworker on this machine may say where it is.")
    parts = urlsplit(body.url)
    if parts.scheme not in ("http", "https") or not _on_this_machine(parts.hostname):
        raise HTTPException(status_code=422, detail="The coworker's address must be an http(s) address on this machine.")
    from pramanyx import coworkers
    coworkers.announce(body.url, body.person)
    return CoworkerDoor(available=True, url=body.url)


@router.get("/coworker", response_model=CoworkerDoor)
def where_the_coworker_is(request: Request) -> CoworkerDoor:
    """Whether the caller's own coworker is running, and the address to open. Reads what was last said; starts nothing.

    Each person's coworker is their own (2026-11-17): the address given is the caller's, never another person's. On an
    install without sign-in there is one person, and the coworker start_all.sh starts is theirs. The address carries
    the coworker shell's access token, so it is given only to a caller on this machine — the only place a coworker on
    this machine's loopback can be opened from anyway. Anyone else is told it is running, and not where."""
    from pramanyx import coworkers
    single = _single_person()
    url = coworkers.address_of(_person(request), single_person=single)
    here = _on_this_machine(request.client.host if request.client else None)
    if url:
        return CoworkerDoor(available=True, url=url if here else None, can_start=not single)
    return CoworkerDoor(available=False, can_start=not single and here)


@router.post("/coworker/mine", response_model=CoworkerDoor)
def start_my_coworker(request: Request) -> CoworkerDoor:
    """Start the caller's own coworker if it is not running (2026-11-17: "Each user must get its own co-worker").
    Its first start sets up its own home and takes a minute; the app asks `GET /coworker` until it is there. A person
    only, from this machine; on an install without sign-in the one coworker start_all.sh starts is the person's, and
    none is started here."""
    from pramanyx import coworkers
    from pramanyx.rbac.agent_gate import is_agent_request
    from pramanyx.security import delegation
    if is_agent_request(request) or delegation.presented(request):
        raise HTTPException(status_code=403, detail="A person starts their own coworker; an agent does not.")
    if not _on_this_machine(request.client.host if request.client else None):
        raise HTTPException(status_code=403, detail="A coworker is started for a person on this machine.")
    if _single_person():
        url = coworkers.address_of(_person(request), single_person=True)
        return CoworkerDoor(available=bool(url), url=url, reason="" if url else (
            "This install has one coworker, started with the platform (scripts/start_all.sh); it is not running."))
    got = coworkers.ensure(_person(request))
    return CoworkerDoor(available=got["state"] == "running", url=got.get("url"), can_start=got["state"] != "unavailable",
                        starting=got["state"] == "starting", reason=got.get("reason", ""))


# ── a coworker turn, as a trace ──────────────────────────────────────────────────────────────────────────────────

#: A coworker turn's trace: `cw-<shell session, shortened>-<turn>`. The prefix is the boundary — see the module's note.
TRACE_NAME = re.compile(r"^cw-[A-Za-z0-9]{6,40}-[0-9]{1,6}$")
_SESSION_NAME = re.compile(r"^[A-Za-z0-9-]{6,80}$")
#: What a payload may carry. Named, so a field the shell adds later is not stored because it arrived.
_PAYLOAD_KEYS = frozenset({
    "question", "mode", "turn", "step", "tool", "arguments", "investigation_id", "receipt_id",
    "headline", "rows", "reason", "error", "message", "shell_session", "seq", "calls",
    # A helper the turn started: which session it is, and its brief's one-line description.
    "helper", "description",
    # Not "answer": the coworker's reply comes with a turn's end only to be filed in the conversation store (2026-11-20);
    # the trace keeps where things are, never what the agent said.
})


class CoworkerTraceEvent(BaseModel):
    kind: Literal["user_request", "tool_call", "tool_call_result", "final_response", "execution_error"] = Field(
        description="What happened. A model call is not taken: the model door records those.")
    name: str = Field(default="", max_length=120, description="The tool's name, or `coworker` for the turn itself.")
    span_id: Optional[str] = Field(default=None, max_length=80, description="A tool call's id; its result carries the same.")
    #: 2026-11-15 — the step this event happened INSIDE: a helper's work (a sub-agent the turn started) is recorded
    #: under the call that started it, so one question is one trace however many agents worked on it.
    parent_span_id: Optional[str] = Field(default=None, max_length=80,
                                          description="The tool call this happened inside — for a helper's work, the call that started the helper.")
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
    from pramanyx.org.context import reset_session_id, reset_user_id, set_session_id, set_user_id
    from pramanyx.security import delegation

    # The door a run came in by is read off its session id's prefix (`slack:…`, `mcp:…`); this is `coworker:…`.
    token = set_session_id(f"coworker:{body.session}")
    # Whose turn it was (Phase 3, 2026-11-17): the person the app delegated to the coworker, when it presents them, so
    # the trace index's filter by person finds a person's coworker turns. Nobody presented is nobody named.
    who = delegation.resolve(request.headers.get(delegation.HEADER)) if delegation.presented(request) else None
    person = set_user_id(who.user_id) if who else None
    try:
        for event in body.events:
            session_log.emit(
                event.kind, name=event.name or "coworker", trace_id=body.trace_id, span_id=event.span_id,
                parent_span_id=event.parent_span_id, ok=event.ok, duration_ms=event.duration_ms, conn_id=event.conn_id, row_count=event.row_count,
                error_class=("coworker" if event.ok is False and event.kind != "tool_call" else None),
                payload={k: v for k, v in event.payload.items() if k in _PAYLOAD_KEYS},
            )
            if event.kind == "final_response":
                file_the_turn(body.session, body.trace_id, event)
    finally:
        if person is not None:
            reset_user_id(person)
        reset_session_id(token)
    return CoworkerTraceTaken(written=len(body.events))


def file_the_turn(session: str, trace_id: str, event: CoworkerTraceEvent) -> Optional[str]:
    """ONE RECORD FOR BOTH PLACES (the user, 2026-11-20: "One record for all"). A coworker turn is filed in the platform's
    conversation store as it ends, under the conversation `coworker:<shell session>`: its question and the coworker's own
    reply, on its connection, as the person it was for. The Ask panel's history then lists the coworker's conversations
    beside its own, and the app's thread opens one. Filed once per question, however often its end is sent: the row is
    named by the turn's trace. A turn with no reply, or none that ended, is not filed. Never raises: the trace stands."""
    question = str(event.payload.get("question") or "").strip()
    answer = str(event.payload.get("answer") or "").strip()
    if not question or not answer or not _SESSION_NAME.match(session) or not TRACE_NAME.match(trace_id):
        return None
    try:
        from pramanyx import telemetry
        from pramanyx.db.history import chat_session_turn_ids, get_investigation, restate_chat_turn, save_chat_turn
        if get_investigation(trace_id):
            return trace_id
        # the person's own question, asked by the coworker as a step of this turn and filed in its conversation already:
        # that row takes the reply, keeping its query and rows, so the conversation holds the question once
        conversation = f"coworker:{session}"
        for step in chat_session_turn_ids(conversation):
            row = get_investigation(step) or {}
            if row.get("trace_id") == trace_id and str(row.get("question") or "").strip() == question:
                restate_chat_turn(step, answer[:4000])
                return step
        # the turn's row names its trace, so the conversation's turn opens on the run in Agent Ops
        with telemetry.bind_trace(trace_id):
            return save_chat_turn(question[:2000], str(event.conn_id or ""), answer[:4000], "",
                                  session_id=conversation, inv_id=trace_id,
                                  status="complete" if event.ok is not False else "interrupted")
    except Exception:
        logger.debug("a coworker turn was not filed in the conversation store", exc_info=True)
        return None


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


@router.put("/coworker/claim", status_code=204, dependencies=[Depends(connection_owner_guard)])
def claim_the_next_answer(body: CoworkerClaim, request: Request) -> None:
    """Said by the coworker just before it asks: the answer to this question belongs inside this step of this turn.
    The connection it names is asked whose it is (DATA-06), like every door that takes one in its body."""
    if not _on_this_machine(request.client.host if request.client else None):
        raise HTTPException(status_code=403, detail="Only a coworker on this machine may claim an answer.")
    if not TRACE_NAME.match(body.trace_id) or not _SESSION_NAME.match(body.session):
        raise HTTPException(status_code=422, detail="A coworker turn's trace is named cw-<session>-<turn>.")
    now = _now()
    _claims[:] = [c for c in _claims if now - c["at"] <= CLAIM_FOR][-200:]
    _claims.append({"trace_id": body.trace_id, "session": body.session, "span_id": body.span_id,
                    "question": body.question, "connection": body.connection, "at": now})


# ── the one answer of a question worked by helpers, checked against the answers it gathered ──────────────────────

_ANSWER_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class GatheredAnswer(BaseModel):
    trace_id: str = Field(max_length=60, description="The question's trace, `cw-<session>-<turn>`.")
    session: str = Field(max_length=80, description="The shell's own id for the conversation.")
    text: str = Field(min_length=1, max_length=40000, description="The answer the main agent wrote, as it wrote it.")
    investigation_ids: list[str] = Field(max_length=60, description="Every answer the question gathered: the helpers' "
                                                                     "and the main agent's own.")


class GatheredAnswerChecked(BaseModel):
    checked: int = Field(description="How many figures the answer states.")
    found: int = Field(description="How many of them are in the rows of the answers it gathered.")
    not_found: list[dict] = Field(default_factory=list, description="Each figure not found, with the clause it is in.")
    answers: int = Field(description="How many of the answers had rows to check against.")
    unread: int = Field(description="How many could not be read: gone, kept no rows, or not the asker's to read.")


@router.post("/coworker/answer-check", response_model=GatheredAnswerChecked)
def check_a_gathered_answer(body: GatheredAnswer, request: Request) -> GatheredAnswerChecked:
    """The figures of a question's one answer against the answers its helpers and its main agent were given
    (`govern/gathered.py`), recorded in the question's trace as a step of it. From this machine only, like the turn's
    other events; an answer the person may not read is left out of the basis and counted as unread, never read."""
    if not _on_this_machine(request.client.host if request.client else None):
        raise HTTPException(status_code=403, detail="Only a coworker on this machine may check its answers.")
    if not TRACE_NAME.match(body.trace_id) or not _SESSION_NAME.match(body.session):
        raise HTTPException(status_code=422, detail="A coworker question's trace is named cw-<session>-<turn>.")
    from pramanyx.govern.gathered import check_gathered_answer
    from pramanyx.security.authz import Ownership, get_principal, resolve_ownership
    principal = get_principal(request)
    asked = [i for i in dict.fromkeys(body.investigation_ids) if _ANSWER_ID.match(i)]
    readable = [i for i in asked if resolve_ownership("investigation", i, principal) in (Ownership.OWNED, Ownership.SHARED)]
    said = check_gathered_answer(body.text, readable)
    said["unread"] += len(asked) - len(readable)
    from pramanyx.obs import session_log
    from pramanyx.org.context import reset_session_id, set_session_id
    token = set_session_id(f"coworker:{body.session}")
    try:
        session_log.emit(
            session_log.STEP, name="answer_check", trace_id=body.trace_id, ok=not said["not_found"],
            payload={"checked": said["checked"], "found": said["found"], "answers": said["answers"],
                     "unread": said["unread"], "not_found": [f["text"] for f in said["not_found"]][:20]})
    finally:
        reset_session_id(token)
    return GatheredAnswerChecked(**said)


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
