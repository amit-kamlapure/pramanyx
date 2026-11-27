"""
Post-synthesis narration-inversion guard (`inverted_universal_claim`).

A per-group value narrated as a universal per-entity property is flagged when the result
it came from visibly varies. (The numeric-claim verifier that once lived here ran on the
retired graph path only and was removed with it.)
"""
from __future__ import annotations

import re


# ── Narration-inversion guard ──────────────────────────────────────────────────
# A per-group / per-row value narrated as a UNIVERSAL per-entity property. A result
# like (1 item → 3 orders), (2 items → 5 orders) becomes "all orders have 3 items":
# the narrator lifts one row's number and asserts it of EVERY entity, over a
# distribution that visibly varies. A numeric-grounding check can't catch it
# — 3 IS a real cell — and _mislabeled_per_grain only covers AVG-of-line-items.
#
# High precision by construction: fires ONLY when the prose makes an
# "all/every/each <entity> have/has/contain/average <N>" claim AND the result is a
# multi-row breakdown whose column holding N is non-constant — so the data itself
# disproves the universal. A genuinely uniform result (every row = N) is NOT flagged,
# and a claim whose N is absent from the data is not this guard's to judge.
# The entity word may be singular ("every customer has 2 orders") or plural — the
# real precision gate is the data-contradiction check below, not the phrasing, so we
# match either and let the distribution decide. A possession/aggregation verb plus a
# number is required, which excludes count-of-entity phrasing ("all 12 months are
# represented" — number before the entity, no possession verb).
_UNIVERSAL_PER_ENTITY = re.compile(
    r"\b(?:all|every|each)\s+(?:of\s+the\s+|the\s+)?\w+\b[^.]{0,30}?"
    r"\b(?:have|has|contain|contains|include|includes|average|averages|averaged)\b\s*"
    r"(?:about\s+|around\s+|roughly\s+|~\s*|approximately\s+|exactly\s+|only\s+|just\s+)?"
    r"(\d+(?:\.\d+)?)\b",
    re.IGNORECASE,
)


def _cell_to_float(cell) -> "float | None":
    """Parse a result cell to float, or None if it isn't numeric (return-None, not a
    silent except-continue, so it stays off the swallow ratchet)."""
    if cell is None or cell == "NULL":
        return None
    try:
        return float(str(cell).replace(",", "").replace("%", ""))
    except (ValueError, TypeError):
        return None


def _numeric_columns(rows) -> "dict[int, list[float]]":
    """Per-column numeric cell values (column index → list of floats)."""
    cols: "dict[int, list[float]]" = {}
    for row in rows or []:
        for i, cell in enumerate(row):
            v = _cell_to_float(cell)
            if v is not None:
                cols.setdefault(i, []).append(v)
    return cols


def inverted_universal_claim(text: str, rows) -> "str | None":
    """Detect a universal per-entity claim ('all orders have 3 items') that the
    result distribution contradicts (the asserted value N varies across rows).

    Returns a one-line reason to flag/drop the finding, or None. Never raises.
    Conservative: needs ≥2 rows, the universal phrasing, N present in a NON-constant
    column, and NO column where N is uniform (which would make the claim defensible)."""
    try:
        if not text or not rows or len(rows) < 2:
            return None
        cols = _numeric_columns(rows)
        if not cols:
            return None
        for m in _UNIVERSAL_PER_ENTITY.finditer(text):
            n = float(m.group(1))
            # If some column is uniformly N, the universal is defensible at that grain.
            if any(vals and all(v == n for v in vals) for vals in cols.values()):
                continue
            for vals in cols.values():
                distinct = set(vals)
                if n in distinct and len(distinct) > 1:
                    return (
                        f"'{m.group(0).strip()}' over-generalises: {n:g} is one of "
                        f"{len(distinct)} differing values in the result, not a constant"
                    )
        return None
    except Exception:
        return None


