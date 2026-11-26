"""What an answer was given, recorded as it is made (2026-11-25, the Atlas-by-Area plan's A1 —
`docs/AREA_MAP_PLAN_2026-11-25.md`).

An enterprise ontology worth the name says of every definition, governed metric and learned item how many answers drew
on it (the study of 2026-11-25); ours could not, because nothing recorded what an answer was given. The grounding receipt (`agent/grounding.py`, ``GET /ask/context``)
re-derives the blocks after the fact; the Trust Receipt records the tables and columns the SQL read and whether a
governed formula was used or departed from. This records the rest **when the answer is made**, and stores nothing of
its own: the answer path starts a record (:func:`start_recording`), each retriever that picks things for the question
notes what it put in front of the model (:func:`note_given`), and the receipt writer consumes the record onto the
receipt's lineage (the Ledger's lineage table, beside the tables and columns) and counts each counted thing's use in
the journal (`discover.usage.note_used`, ``thing.used``).

Two words, kept apart:

- **given** — put in front of the model that wrote the answer: the Definitions, trusted queries and documents picked
  for the question, the confirmed findings every answer reads.
- **used** — what the SQL itself shows: a governed metric's formula used (the receipt's ``metric_used``), the tables
  read (its ``input`` rows). Nothing is called used that the answer cannot be shown to rest on.

Counted as a use (Discover's "used in N answers"): what is picked FOR the question — a Definition, a trusted query, a
document — and a metric whose formula the SQL used. Not counted: what every answer is given alike (the metrics block
lists every governed metric the schema fits; the confirmed findings go to every answer) — counting those would say
every one of them was used by every answer, which says nothing.

The record is a dict in a context variable. A retriever in a worker thread appends to it: a copied context
(``ContextThreadPoolExecutor``, ``contextvars.copy_context().run``) holds the SAME dict, so an append is seen by the
answer that started it — the very thing a ``ContextVar.set`` in a worker never is (`ontology.context_graph_readback`
learnt that). No record started — an explorer run, an eval, the ``/ask/context`` re-derivation — and nothing is noted.
"""
from __future__ import annotations

import contextvars
from typing import Optional

#: The day answers began to record what they were given (A1's deploy): a figure that reads `given` rows says it counts
#: from here — an older receipt holds none, which is not the same as having been given nothing.
RECORDED_SINCE = "2026-11-25"
#: The kinds whose being given to an answer is counted as a use of them: each is picked for the question.
COUNTED = ("definition", "trusted_query", "document")
#: The most of one kind a receipt names — a retriever's own top-k is smaller; this only bounds a runaway.
MAX_PER_KIND = 20

_GIVEN: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar("pramanyx_answer_given", default=None)
#: What a conversation's turn was given so far, across every answer it makes (2026-11-26). A turn may write several
#: receipts — ``answer_question``'s, then a ``run_sql`` the model ran after its answer was held — and each says what the
#: model writing it had in front of it, which is everything the turn was given before it: the Definition picked for the
#: first answer is still in the model's context when it writes the second. Until then the second receipt said it was
#: given nothing ("Repeat buyer", theLook, 2026-11-26: given to the first answer, absent from the one shown).
_TURN: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar("pramanyx_turn_given", default=None)
#: The path the answer took — the question's kind, the depth, the engine and why — set once by the door that routed it
#: (`routers/investigations._stream_ask`) and written on every receipt of the turn (the plan of record, 2026-11-27: "what
#: touched what" could not be read from any receipt).
_PATH: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar("pramanyx_answer_path", default=None)


def set_path(path: dict) -> None:
    """The route this turn's answers take; every receipt written in this context carries it."""
    _PATH.set({k: v for k, v in (path or {}).items() if v not in (None, "")})


def path() -> Optional[dict]:
    """The route set for this turn, or None when no door set one (a scheduled read, an evaluation's own call)."""
    got = _PATH.get()
    return dict(got) if got else None


def start_recording() -> dict:
    """Begin recording what this answer is given: a fresh record for the rest of this context (and every context
    copied from it from now on). An answer path calls it first thing, before it fans its retrievals out."""
    _fold(_GIVEN.get())                   # what the turn was given before this answer began stays the turn's
    rec: dict[str, dict[str, str]] = {}
    _GIVEN.set(rec)
    return rec


def start_turn() -> dict:
    """Begin a conversation's turn: every receipt it writes from here carries what the turn was given so far
    (:func:`given_this_turn`). Starts the recording too, so what a tool notes before the first answer is kept. A path
    that is not a conversation starts no turn, and each of its receipts says what that answer alone was given."""
    turn: dict = {"given": {}, "counted": set()}
    _TURN.set(turn)
    _GIVEN.set({})
    return turn


def _fold(rec: Optional[dict]) -> None:
    """``rec`` added to the turn's record, when a turn is running. Never raises: a fold missed is a receipt that says
    less than the turn was given, never an answer lost."""
    turn = _TURN.get()
    if turn is None or not rec:
        return
    try:
        for kind, refs in rec.items():
            bucket = turn["given"].setdefault(kind, {})
            for ref, name in refs.items():
                if ref not in bucket and len(bucket) < MAX_PER_KIND:
                    bucket[ref] = name
    except Exception:  # noqa: BLE001 — see the docstring
        return


def note_given(kind: str, ref: str, name: str = "") -> None:
    """A retriever put ``kind`` ``ref`` in front of the model writing an answer. Nothing when no answer is recording.
    Never raises: a note missed is a use not counted, and the answer goes on."""
    rec = _GIVEN.get()
    if rec is None or not kind or not ref:
        return
    try:
        bucket = rec.setdefault(kind, {})
        if ref not in bucket and len(bucket) < MAX_PER_KIND:
            bucket[ref] = name or ""
    except Exception:  # noqa: BLE001 — see the docstring
        return


def consume() -> dict[str, dict[str, str]]:
    """What this answer was given — ``kind → {ref: name}`` — and the record emptied, so a later answer in the same
    context that started no record of its own is never credited with this one's."""
    rec = _GIVEN.get()
    if not rec:
        return {}
    out = {k: dict(v) for k, v in rec.items() if v}
    _fold(out)
    rec.clear()
    return out


def given_this_turn(fresh: dict[str, dict[str, str]]) -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    """``(said, to_count)`` for a receipt: what it says its answer was given, and what of that is counted as a use now.
    In a conversation's turn, ``said`` is everything the turn was given so far and ``to_count`` what no earlier receipt
    of the turn counted — a Definition given once and named on two receipts is one use. Elsewhere, ``fresh`` both."""
    turn = _TURN.get()
    if turn is None:
        return fresh, fresh
    _fold(fresh)
    said = {k: dict(v) for k, v in turn["given"].items() if v}
    to_count: dict[str, dict[str, str]] = {}
    for kind, refs in said.items():
        for ref, name in refs.items():
            if (kind, ref) not in turn["counted"]:
                turn["counted"].add((kind, ref))
                to_count.setdefault(kind, {})[ref] = name
    return said, to_count


def lineage_rows(given: dict[str, dict[str, str]]) -> list[tuple]:
    """The receipt's rows for what an answer was given: ``("given", "<kind>:<ref>", name)``."""
    return [("given", f"{kind}:{ref}", name or None) for kind, refs in given.items() for ref, name in refs.items()]


def summary(given: dict[str, dict[str, str]]) -> dict[str, list[str]]:
    """What a reader is told an answer was given, by kind: the names (a ref when a thing has none)."""
    return {kind: [name or ref for ref, name in refs.items()] for kind, refs in given.items()}


def count_uses(given: dict[str, dict[str, str]], metrics_used: list[str], connection_id: str) -> None:
    """One ``thing.used`` for each counted thing an answer was given and each governed metric its SQL used.
    Best effort: a use not kept is a count one short, never an answer lost."""
    from pramanyx.discover.usage import note_used
    for kind in COUNTED:
        for ref in given.get(kind, {}):
            note_used(kind, ref, connection_id)
    for name in dict.fromkeys(metrics_used):
        if connection_id and name:
            note_used("metric", f"{connection_id}/{name}", connection_id)
