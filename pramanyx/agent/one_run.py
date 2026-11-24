"""One run per question: an agent asking again for a deep analysis it already has under way is handed that run.

Seen twice on 2026-11-24 (0237d0fc, then cff38269 and dd94959a): the coworker's deep analysis outlived its call, the
coworker read the running run a few times in half a minute, took it for stuck, and asked the same question again through
a custom agent — whose conversation ran a second deep analysis of it beside the first.

An agent's deep analysis that runs as a job — one that outlives its reader — claims its question at the door
(`routers/investigations._stream_ask`) before it starts, and the job ends the claim with the run. A repeat from the same
party — the same question, connection, canvas and schema — through either door that starts a deep analysis is handed
that run: at once when its id is known, or after waiting for the id while the run is still starting (its row is written
after the analyst's context is built, half a minute in). A conversation's own deep analysis (`converse_tools`) runs
inline and stops with its reader, so it is never one handed back, and it claims nothing. Only agents' plain asks take
part: a person in the app, a fresh run, an "ask again", a follow-up and a drill from a finding are never handed one.

The claims live in this process, as the runs do: a run does not survive its process, so neither does its claim.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Optional

#: A claim older than this is stale, whatever it says: the supervisor fails any run still 'running' after 60 minutes
#: (`kernel/jobs.py`, `sweep_stale_running`), so no run it could stand for is still going.
STALE_AFTER_S = 60 * 60
#: How long a repeat waits for the id of a run still starting before it is told the run is still starting.
WAIT_FOR_ID_S = 90.0


@dataclass(eq=False)
class Claim:
    """One run's claim on its question: its id once its row exists, and its end."""
    keys: tuple
    began: float = field(default_factory=time.monotonic)
    began_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    inv_id: Optional[str] = None
    _settled: threading.Event = field(default_factory=threading.Event)

    def found(self, inv_id: str) -> None:
        """The run's row exists: a repeat is handed it from here on."""
        if inv_id and not self.inv_id:
            self.inv_id = inv_id
            self._settled.set()

    def end(self) -> None:
        """The run has ended (or never started): its question is free to start again. Idempotent."""
        with _lock:
            for k in self.keys:
                if _claims.get(k) is self:
                    del _claims[k]
        self._settled.set()

    def under_way(self) -> dict:
        """What a repeat is handed: the run's id ("" while it is still starting) and when it began."""
        return {"id": self.inv_id or "", "started_at": self.began_at}


_lock = threading.Lock()
_claims: dict[tuple, Claim] = {}


def _party() -> str:
    """Whose runs these are: the person in scope — signed in, or the one the coworker acts for — else "" for the install
    itself. Its doors file an agent's asks with no person in scope under different labels (the actor; `api:mcp:<host>`
    for a custom agent's ask), and every one of them is the install's own agent, not a person."""
    from pramanyx.org.context import current_user_id
    from pramanyx.routers.investigations import is_said_asker
    who = (current_user_id() or "").strip().lower()
    who = who[5:] if who.startswith("user:") else who
    return "" if not who or is_said_asker(who) else who


def _keys(questions: Iterable[str], connection_id: str, canvas_id: str, schema: str) -> tuple:
    from pramanyx.db.history import normalized_question
    from pramanyx.org.context import current_org_id
    party, org = _party(), current_org_id() or ""
    names = {normalized_question(q) for q in questions if (q or "").strip()}
    return tuple((org, party, connection_id or "", canvas_id or "", (schema or "").lower(), n) for n in sorted(names) if n)


def _live(c: Claim) -> bool:
    """A claim stands for a run still going: not stale, and — once it names its run — that run's row still 'running'.
    A claim that outlived its run (a job cancelled before it ran, an end its run never reached) is never handed back."""
    if time.monotonic() - c.began > STALE_AFTER_S:
        return False
    if not c.inv_id:
        return True
    from pramanyx.db.history import get_investigation
    return (get_investigation(c.inv_id) or {}).get("status") == "running"


def _held(keys: tuple) -> Optional[Claim]:
    """The live claim on one of ``keys``, under the lock; a dead one found on the way is let go."""
    for k in keys:
        c = _claims.get(k)
        if c is None:
            continue
        if _live(c):
            return c
        for kk in c.keys:
            if _claims.get(kk) is c:
                del _claims[kk]
        c._settled.set()
    return None


def take(question: str, connection_id: str, *, canvas_id: str = "", schema: str = "") \
        -> "tuple[Optional[Claim], Optional[Claim]]":
    """For a run about to start as a job: ``(mine, None)`` — a claim to hand the run its id and end with it — or
    ``(None, held)`` — the claim of the run of this question already under way. Never blocks: a door waits for a held
    claim's id on its own terms."""
    keys = _keys([question], connection_id, canvas_id, schema)
    if not keys:
        return None, None
    with _lock:
        held = _held(keys)
        if held is not None:
            return None, held
        mine = Claim(keys=keys)
        for k in keys:
            _claims[k] = mine
        return mine, None


def under_way(questions: Iterable[str], connection_id: str, *, canvas_id: str = "", schema: str = "",
              wait_s: float = WAIT_FOR_ID_S) -> Optional[dict]:
    """The run of one of ``questions`` already under way as a job, or None — for a caller about to start one inline (a
    conversation's deep tool). Blocks up to ``wait_s`` for the id of a run still starting."""
    keys = _keys(questions, connection_id, canvas_id, schema)
    if not keys:
        return None
    with _lock:
        held = _held(keys)
    if held is None:
        return None
    if not held.inv_id:
        held._settled.wait(timeout=max(0.0, wait_s))
    if held.inv_id or (held in _claims.values()):
        return held.under_way()
    return None                     # it ended without ever naming its run: nothing is under way


def said(under_way: dict, *, can_read: bool = True) -> str:
    """What a repeat is told: the run under way, by its id, and that it was not started again. ``can_read`` — the
    reader holds `get_investigation` (the coworker); a custom agent's conversation is told to pass the id on."""
    from pramanyx.util.time import age_hours
    hours = age_hours(str(under_way.get("started_at") or ""))
    mins = int(hours * 60) if hours < 9999 else -1          # 9999: a start time that does not parse
    when = "" if mins < 0 else f", started {mins} min ago" if mins else ", started under a minute ago"
    rid = under_way.get("id") or ""
    if not rid:
        return (f"This question is already being analysed{when}, and that run is still starting, so it was not "
                "started a second time. Ask for it again in a minute to be handed its id.")
    then = (f"get_investigation('{rid}') waits for it and says how far it has got; ask for a fresh run only if a new "
            "one is wanted alongside it." if can_read else
            f"Say so in the answer, giving the run's id, {rid}, by which its report is read when it lands.")
    return f"This question is already being analysed (run {rid}{when}, still going), so it was not started a second time. {then}"
