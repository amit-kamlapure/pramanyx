"""People saying a Definition is right (the user, 2026-11-25: "comments and votes on Definitions"; asked what a vote
says, '"This is right" only' — disagreement is a comment or a suggested edit, which already exist).

One vote per person per Definition, given or taken back at will. A vote is a ``definition.voted`` event in the journal
(`kernel/events.CATALOGUE`), and the count is folded from what happened — each person's latest — never kept as a
number. A person's own act; an agent never votes.
"""
from __future__ import annotations

from pramanyx.record.writers import definition_term

#: The journal kind of a vote given or taken back.
VOTED = "definition.voted"


def _person(ref: str) -> str:
    return str(ref or "").strip().lower().removeprefix("user:").removeprefix("person:")


def vote(connection_id: str, term: str, area: str, *, by: str, right: bool = True) -> dict:
    """``by`` says the Definition is right (``right``), or takes that back; returns its votes as they now stand."""
    from pramanyx.kernel.ledger import Ledger
    Ledger.default().emit(VOTED, {"connection_id": connection_id, "term": term, "area": area, "by": by,
                                  "right": bool(right)}, conn_id=connection_id or None)
    return votes(connection_id, term, area, me=by)


def votes_on(connection_id: str) -> dict[tuple[str, str], set[str]]:
    """Every Definition's voters on a connection, by ``(term, area)`` as keys — one journal read for a list."""
    from pramanyx.kernel.ledger import Ledger
    latest: dict[tuple[str, str, str], tuple[str, bool]] = {}
    for e in Ledger.default().events(kind=VOTED, conn_id=connection_id or None, limit=20_000):
        p = e.get("payload") or {}
        if p.get("connection_id") != connection_id:
            continue
        key = (definition_term(p.get("term", "")), definition_term(p.get("area", "")), _person(p.get("by", "")))
        at = str(e.get("at") or "")
        if key[2] and (key not in latest or at >= latest[key][0]):
            latest[key] = (at, bool(p.get("right")))
    out: dict[tuple[str, str], set[str]] = {}
    for (term, area, who), (_, right) in latest.items():
        if right:
            out.setdefault((term, area), set()).add(who)
    return out


def votes(connection_id: str, term: str, area: str = "", *, me: str = "") -> dict:
    """``{"right": how many say it is right, "by": who, "mine": whether ``me`` is one of them}``."""
    who = sorted(votes_on(connection_id).get((definition_term(term), definition_term(area)), set()))
    return {"right": len(who), "by": who, "mine": _person(me) in who if me else False}
