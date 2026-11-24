"""One run per question: an agent asking again for a deep analysis it already has under way is handed that run.

Seen twice on 2026-11-24 (0237d0fc, then cff38269 and dd94959a): the coworker's deep analysis outlived its call, the
coworker read the running run a few times in half a minute, took it for stuck, and asked the same question again — once
in the same words, once reworded — through a custom agent, whose conversation ran a second deep analysis beside the first.

An agent's deep analysis that runs as a job — one that outlives its reader — claims its question at the door
(`routers/investigations._stream_ask`) before it starts, and, once its intake has resolved what the question asks for,
that spec too (:func:`spec_of`). The job ends both claims with the run. A repeat from the same party — same connection,
canvas and schema — is handed the run when it asks in the same words (at the door, before anything runs) or in other words
that resolve to the same spec (after its own intake: it stops there, said, rather than run the analysis twice). Two
wordings racing to their spec: the first to claim it runs on, the other is handed it.

A claim names its run from the moment it is taken: the door makes the run's row as it claims (:func:`take`'s
``name_run``) and the run adopts that row, so a repeat is always handed an id it can read — queued behind the
investigation slots, running, or ended. Until 2026-11-24 the row was the run's own to make, once its job had a slot and
its context was built, and a repeat in between was told only that a run was "still starting". A claim that names no
run a moment after it was taken has a broken maker, and is handed to no one (:func:`_wait_for_id`).

A conversation's own deep analysis (`converse_tools`) runs inline and stops with its reader, so it is never one a repeat
is handed, and it claims nothing; it only looks. Only agents' plain asks take part: a person in the app, a fresh run, an
"ask again", a follow-up and a drill from a finding are never handed one.

The claims are the kernel ledger's (`Ledger.kv_put_if_absent`, as `notifications/sent_once` claims a send), so every API
process that shares the ledger sees them; two racing for one get exactly one, and a claim is changed or let go only while
it is still the one read (`kv_replace_if`, `kv_delete_if`). A claim stands while its job does — queued, or running with a
fresh heartbeat (`kernel/jobs.py`) — and while the process that made it keeps stamping it (every 15 seconds, `_beat`): one
queued behind the investigation slots stands as long as it waits, and one whose process died lapses within two minutes,
read from any host (at once on its own, which can ask whether the process is still alive).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import socket
import threading
import time
import uuid
import weakref
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Iterable, Optional

from pramanyx.db.serving import process_alive

STORE = "one_run"
#: Claims kept: they are deleted as their runs end, so this bounds only what a crash leaves behind.
CAP = 5_000
#: A claim older than this is stale, whatever it says: the supervisor fails any run still 'running' after 60 minutes
#: (`kernel/jobs.py`, `sweep_stale_running`), so no run it could stand for is still going.
STALE_AFTER_S = 60 * 60
#: A claim no job has taken by now never will be: a door submits its job a moment after it claims.
UNSUBMITTED_FOR_S = 120
#: A running job whose heartbeat is older than this has lost its process (the kernel's own lease, `_STALE_SECONDS`); a
#: claim whose maker last stamped it longer ago than this has lost its maker.
HEARTBEAT_LAPSES_S = 120
#: How often the process holding a claim stamps it — the kernel's own heartbeat interval.
BEAT_EVERY_S = 15.0
#: How long a repeat waits for the id of a claim taken a moment ago: its door names the run as it claims, so a claim
#: that has not by then never will — its maker is broken — and is handed to no one.
WAIT_FOR_ID_S = 90.0
#: How often a waiting repeat reads the claim again.
READ_EVERY_S = 0.5


def _ledger():
    from pramanyx.kernel.ledger import Ledger
    return Ledger.default()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _age_s(at: object) -> float:
    from pramanyx.util.time import age_hours
    return age_hours(str(at or "")) * 3600


def _job_alive(job_id: str) -> bool:
    """The job a claim names is still the run's: queued (or paused), or running with a heartbeat its process is still
    giving."""
    job = _ledger().job_get(job_id) or {}
    state = job.get("state")
    if state in ("PENDING", "PAUSED"):
        return True
    if state != "RUNNING":
        return False
    return _age_s(job.get("heartbeat_at") or job.get("started_at") or job.get("created_at")) <= HEARTBEAT_LAPSES_S


def _maker_gone(row: dict) -> bool:
    """The process that made the claim, on this host, is no longer alive — its queued or still-starting run went with
    it. Asked at once, where it can be; a process on another host is judged by its stamps (:func:`_live`)."""
    host, _, pid = str(row.get("by") or "").rpartition(":")
    if host != socket.gethostname() or not pid.isdigit():
        return False
    return not process_alive(int(pid))              # the platform's one way to ask, safe on Windows (`db/serving`)


def _live(row: Optional[dict]) -> bool:
    """A claim stands for a run still going: fresh; stamped lately by the process that made it, which is still alive;
    once it names its run, that run's row still 'running' (a run that ended is never handed back, whatever its claim
    says); its job alive — or, before a job took it, only just made."""
    if not row or _age_s(row.get("began_at")) > STALE_AFTER_S:
        return False
    if _age_s(row.get("beat_at") or row.get("began_at")) > HEARTBEAT_LAPSES_S or _maker_gone(row):
        return False                                # its maker stopped stamping it: gone, on whatever host
    if row.get("inv_id"):
        from pramanyx.db.history import get_investigation
        if (get_investigation(row["inv_id"]) or {}).get("status") != "running":
            return False
    if row.get("job"):
        return _job_alive(row["job"])
    return _age_s(row.get("began_at")) <= UNSUBMITTED_FOR_S


def _party() -> str:
    """Whose runs these are: the person in scope — signed in, or the one the coworker acts for — else "" for the install
    itself. Its doors file an agent's asks with no person in scope under different labels (the actor; `api:mcp:<host>`
    for a custom agent's ask), and every one of them is the install's own agent, not a person."""
    from pramanyx.org.context import current_user_id
    from pramanyx.routers.investigations import is_said_asker
    who = (current_user_id() or "").strip().lower()
    who = who[5:] if who.startswith("user:") else who
    return "" if not who or is_said_asker(who) else who


def _slot(kind: str, name: str, connection_id: str, canvas_id: str, schema: str) -> str:
    """The ledger key of one claim: whose, where, and what — hashed, as a question can be long."""
    from pramanyx.org.context import current_org_id
    raw = "\x1f".join((kind, current_org_id() or "", _party(), connection_id or "", canvas_id or "",
                       (schema or "").lower(), name))
    return f"{kind}:" + hashlib.sha256(raw.encode()).hexdigest()[:40]


def _question_slot(question: str, connection_id: str, canvas_id: str, schema: str) -> Optional[str]:
    from pramanyx.db.history import normalized_question
    name = normalized_question(question or "")
    return _slot("q", name, connection_id, canvas_id, schema) if name else None


def _norm_sql(text: object) -> str:
    """A model-written expression as two readings of one question compare: spacing and identifier quoting and case set
    aside — never a string literal's case (`'Returned'` is not `'returned'`) nor a table's name."""
    out = []
    for i, part in enumerate(re.split(r"('(?:[^']|'')*')", str(text or ""))):
        if i % 2:
            out.append(part)                                   # a literal, as written
            continue
        t = re.sub(r"[`\"]", "", part.lower())
        t = re.sub(r"\s*([(),*/+=<>-])\s*", r"\1", t)
        out.append(re.sub(r"\s+", " ", t))
    return "".join(out).strip()


def spec_of(intake: Optional[dict]) -> Optional[str]:
    """What a question asks for once the intake has resolved it, as one string — two wordings of one question resolve
    to one spec; None when the intake named no measure (nothing to compare).

    The measure (the governed metric it framed, with the objects that metric's rule chose; else its expression and
    table), every further measure and the filters on them, the two periods it compares (as a pair), its shape, the sides
    of a driver or relationship question, and the dimensions it names. A named dimension is part of what any question
    asks, a "why" too: the run breaks it down first, whatever else it looks at (`investigate._prioritize_dimensions`
    pins it), so "what drove it — break it down by category" is not the analysis of "why did it change", which may never
    reach category. When unsure, two specs differ: a repeat then runs again, as before, where a spec too loose would
    hand a question someone else's answer."""
    i = intake or {}
    framed = i.get("framed_metric") or {}
    measure = (f"m={framed['metric']};{json.dumps(framed.get('objects'), sort_keys=True, default=str)}"
               if framed.get("metric") else _norm_sql(i.get("metric_sql")))
    if not measure:
        return None
    others = sorted(_norm_sql((m or {}).get("sql") if isinstance(m, dict) else getattr(m, "sql", ""))
                    for m in (i.get("other_measures") or []))
    shape = str(i.get("question_shape") or "")
    named = ",".join(sorted({_norm_sql(d) for d in (i.get("named_dimensions") or []) if _norm_sql(d)}))
    parts = [measure, _norm_sql(i.get("metric_table")), ";".join(others),
             ";".join(sorted(_norm_sql(f) for f in (i.get("metric_filters") or []))),
             *_periods(i),
             shape,
             *(_norm_sql(i.get(k)) for k in ("comparison_segment_sql", "relationship_left_sql", "relationship_right_sql")),
             named, "x" if i.get("cross_sectional") else "", "d" if i.get("descriptive_only") else ""]
    return "|".join(parts)


def _periods(intake: dict) -> list:
    """The two periods a question compares, as one pair, earlier first: a change between May and June is one analysis
    whichever the intake took as observed and which as its comparison (live 2026-11-24, c86e1ae1 / 6c7cab64: "Why did
    revenue change from May to June?" observed June against May; "What drove the change between May and June?" observed
    May against June, and ran a second analysis of the same two months)."""
    pair = sorted([(str(intake.get("observation_start") or ""), str(intake.get("observation_end") or "")),
                   (str(intake.get("comparison_start") or ""), str(intake.get("comparison_end") or ""))])
    return [x for period in pair for x in period]


def _drop_if_same(slot: str, row: dict) -> None:
    """Let a claim go only while it is still the one read — never one another process made since."""
    _ledger().kv_delete_if(STORE, slot, row)


@dataclass(eq=False)
class Claim:
    """One run's claims — its question, then its spec — in the ledger: told its job and its id, stamped while its
    process holds it (:func:`_beat`), ended with the run."""
    slots: list
    claim_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    began_at: str = field(default_factory=_now)
    inv_id: Optional[str] = None
    job_id: Optional[str] = None
    #: Held across every write of this claim's rows — a stamp, a `found` on a worker thread, a `hold`, the end — so none
    #: reads a row another of them is about to replace. Re-entrant: a stamp rewrites under it.
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)
    #: Let go: never claimed, rewritten or stamped again (an end can come while a stamp or a late `found` is under way).
    _ended: bool = field(default=False, repr=False)

    def _row(self) -> dict:
        return {"claim": self.claim_id, "inv_id": self.inv_id, "job": self.job_id, "began_at": self.began_at,
                "beat_at": _now(), "by": f"{socket.gethostname()}:{os.getpid()}"}

    def _rewrite(self, *, what: str = "updated") -> bool:
        """Write this claim's rows again from what it now knows, stamped now. True while any of them is still this
        claim's; one another process let go (it judged it lapsed) stays gone, and so does every row once it has ended."""
        with self._lock:
            if self._ended:
                return False
            try:
                ledger, ours = _ledger(), False
                for slot in list(self.slots):
                    for _ in range(3):
                        row = ledger.kv_get(STORE, slot)
                        if (row or {}).get("claim") != self.claim_id:
                            break
                        if ledger.kv_replace_if(STORE, slot, row, self._row()):
                            ours = True
                            break
                return ours
            except Exception as exc:  # noqa: BLE001 — a claim never fails the run it serves; it lapses with its job
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, f"a deep analysis's claim could not be {what}; it lapses with its job",
                         counter="one_run.update")
                return True                              # unread, not lost: stamped again next time

    def _stamp(self) -> None:
        """The stamper's write. A claim none of whose rows is its own any more is stamped no more — decided under its
        lock, so a slot `hold` claims meanwhile is stamped on (it puts the claim back)."""
        with self._lock:
            if not self._rewrite(what="stamped"):
                with _HELD_LOCK:
                    _HELD.discard(self)

    def started(self, job_id: str) -> None:
        """A job carries the run: the claim stands while that job does."""
        if job_id and not self.job_id:
            self.job_id = job_id
            self._rewrite()

    def found(self, inv_id: str) -> None:
        """The run's row exists: a repeat is handed it from here on."""
        if inv_id and not self.inv_id:
            self.inv_id = inv_id
            self._rewrite()

    def hold(self, slot: str) -> Optional[dict]:
        """Claim one more slot for this run (its spec, once the intake has resolved it). None when it is this run's now
        (or cannot be had); otherwise the live claim of the run already holding it — the run this one repeats."""
        ledger = _ledger()
        for _ in range(3):
            with self._lock:
                if self._ended:
                    return None                     # its run is over: nothing to claim for it
                if ledger.kv_put_if_absent(STORE, slot, self._row(), max_entries=CAP):
                    self.slots.append(slot)
                    _keep_stamping(self)
                    return None
            other = ledger.kv_get(STORE, slot)
            if other is None:
                continue                            # let go between our insert and our read: once more
            if other.get("claim") == self.claim_id:
                return None
            if _live(other):
                return other
            _drop_if_same(slot, other)
        return None

    def end(self) -> None:
        """The run has ended (or never started): its question and spec are free again. Idempotent, and never raises: a
        claim that cannot be let go lapses with its job. Under the claim's lock, so a stamp or a late `found` cannot
        replace a row between this read of it and its delete, and leave it standing."""
        with self._lock:
            self._ended = True
            with _HELD_LOCK:
                _HELD.discard(self)
            try:
                ledger = _ledger()
                for slot in list(self.slots):
                    for _ in range(3):
                        row = ledger.kv_get(STORE, slot)
                        if (row or {}).get("claim") != self.claim_id or ledger.kv_delete_if(STORE, slot, row):
                            break
            except Exception as exc:  # noqa: BLE001 — see above
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "a deep analysis's claim could not be let go; it lapses with its job", counter="one_run.end")


#: The claims this process holds, stamped every `BEAT_EVERY_S` by one thread. Weak: a claim nothing holds any more (its
#: run gone without ending it) is stamped no more, and lapses.
_HELD: "weakref.WeakSet[Claim]" = weakref.WeakSet()
_HELD_LOCK = threading.Lock()
_STAMPER: Optional[threading.Thread] = None


def _stamp_held() -> None:
    """Stamp every claim this process holds; one whose rows are all gone — let go by another process that judged it
    lapsed — is stamped no more."""
    with _HELD_LOCK:
        held = list(_HELD)
    for claim in held:
        claim._stamp()


def _beat() -> None:
    """The stamper: every `BEAT_EVERY_S`, for as long as the process runs."""
    while True:
        time.sleep(BEAT_EVERY_S)
        _stamp_held()


def _keep_stamping(claim: Claim) -> None:
    global _STAMPER
    with _HELD_LOCK:
        _HELD.add(claim)
        if _STAMPER is None or not _STAMPER.is_alive():
            _STAMPER = threading.Thread(target=_beat, daemon=True, name="one-run-stamp")
            _STAMPER.start()


def take(question: str, connection_id: str, *, canvas_id: str = "", schema: str = "",
         name_run: Optional[Callable[[], str]] = None) -> "tuple[Optional[Claim], Optional[dict]]":
    """For a run about to start as a job: ``(mine, None)`` — its claim, to be told its job and ended with it — or
    ``(None, held)`` — the claim of the run of this question already under way (``held["inv_id"]`` empty for the
    moment between a claim and its name). Never blocks on another run. ``name_run`` makes the run's row and returns its
    id, which the claim names from then on; ``(None, None)`` when no claim can be had or no row made: the run starts
    unclaimed and makes its own, as before."""
    slot = _question_slot(question, connection_id, canvas_id, schema)
    if not slot:
        return None, None
    try:
        mine = Claim(slots=[])
        held = mine.hold(slot)
    except Exception as exc:  # noqa: BLE001 — a ledger that cannot be written leaves the run to start, said once
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "a deep analysis could not claim its question; it starts unclaimed", counter="one_run.claim")
        return None, None
    if held is not None:
        return None, held
    if not mine.slots:
        return None, None
    if name_run is not None:
        try:
            mine.found(name_run())
        except Exception as exc:  # noqa: BLE001 — a row that cannot be made leaves the run to make its own, unclaimed
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "a deep analysis's row could not be made with its claim; it starts unclaimed",
                     counter="one_run.name")
        if not mine.inv_id:
            mine.end()
            return None, None
    return mine, None


def _wait_for_id(slot: str, row: dict, wait_s: float) -> Optional[dict]:
    """``{"id", "started_at"}`` of the run the claim at ``slot`` names — waiting up to ``wait_s`` for the name of one
    taken a moment ago — or None: it ended first, or never named its run (a broken maker; handed to no one, so the
    repeat runs on rather than be handed a run it could not read)."""
    deadline = time.monotonic() + max(0.0, wait_s)
    while not row.get("inv_id"):
        if time.monotonic() >= deadline:
            return None
        time.sleep(READ_EVERY_S)
        again = _ledger().kv_get(STORE, slot)
        if not _live(again):
            return None
        row = again
    return {"id": row["inv_id"], "started_at": row.get("began_at", "")}


def under_way(questions: Iterable[str], connection_id: str, *, canvas_id: str = "", schema: str = "",
              wait_s: Optional[float] = None) -> Optional[dict]:
    """The run of one of ``questions`` already under way as a job, or None — for a caller about to start one inline (a
    conversation's deep tool), which only looks. Blocks up to ``wait_s`` for the name of a claim taken a moment ago."""
    try:
        for q in questions:
            slot = _question_slot(q, connection_id, canvas_id, schema)
            row = _ledger().kv_get(STORE, slot) if slot else None
            if _live(row):
                return _wait_for_id(slot, row, WAIT_FOR_ID_S if wait_s is None else wait_s)
    except Exception as exc:  # noqa: BLE001 — a claim that cannot be read hands nothing back: the run goes on
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "a deep analysis could not read the claims; it runs", counter="one_run.read")
    return None


@dataclass
class Ask:
    """The agent's ask a deep run serves, as `agent/analyst.run_analyst` carries it to the point its intake resolves the
    question: ``claim`` — the job's (`take`), which claims the spec too — or None for an inline run, which only looks."""
    connection_id: str
    canvas_id: str = ""
    schema: str = ""
    claim: Optional[Claim] = None
    #: The reader holds `get_investigation` (the coworker); a custom agent's conversation does not.
    can_read: bool = True

    def after_intake(self, intake: Optional[dict]) -> Optional[dict]:
        """The run of the same spec already under way — this run is a repeat of it, in other words — or None to run on
        (having claimed the spec, when it is a job's). A run that ends while this one waits for its id leaves the spec
        to this one."""
        spec = spec_of(intake)
        if not spec:
            return None
        slot = _slot("s", spec, self.connection_id, self.canvas_id, self.schema)
        try:
            for _ in range(3):
                if self.claim is not None:
                    other = self.claim.hold(slot)
                else:
                    other = _ledger().kv_get(STORE, slot)
                    other = other if _live(other) else None
                if other is None:
                    return None
                twin = _wait_for_id(slot, other, WAIT_FOR_ID_S)
                if twin is not None:
                    return twin
        except Exception as exc:  # noqa: BLE001 — a spec that cannot be claimed or read lets the run go on, as before
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "a deep analysis could not claim its spec; it runs on", counter="one_run.spec")
        return None


def said(under_way: dict, *, can_read: bool = True) -> str:
    """What a repeat is told: the run under way, by its id, and that it was not started again. ``can_read`` — the
    reader holds `get_investigation` (the coworker); a custom agent's conversation is told to pass the id on."""
    secs = _age_s(under_way.get("started_at"))
    mins = int(secs // 60) if secs < 9999 * 3600 else -1     # an unparsable start reads as 9999 hours
    when = "" if mins < 0 else f", started {mins} min ago" if mins else ", started under a minute ago"
    rid = under_way.get("id") or ""                          # always named (`_wait_for_id`)
    then = (f"get_investigation('{rid}') waits for it and says how far it has got; ask for a fresh run only if a new "
            "one is wanted alongside it." if can_read else
            f"Say so in the answer, giving the run's id, {rid}, by which its report is read when it lands.")
    return (f"This question is already being analysed (run {rid}{when}, still going), so it was not started a second "
            f"time. {then}")
