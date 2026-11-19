"""What the coworker can do, in either of its places, read from one list (`pramanyx/abilities.py`, 2026-11-20).

The Ask panel and the coworker app read the same rows: each ability's words, what it needs, how it is allowed (one rule)
and where it is offered, and where the two places still differ. A read, with no model call; nothing is written.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["abilities"])


@router.get("/abilities")
def list_abilities() -> dict:
    """Every ability, its words, what it needs and how it is allowed, by the one rule both places follow; the families a
    place adds at start-up; and where the two places differ."""
    from pramanyx import abilities
    return {"abilities": abilities.as_rows(), "families": list(abilities.FAMILIES), "parity": abilities.parity()}
