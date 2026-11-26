"""One standing: the one order for everything an answer may draw on, and the words for why (2026-11-25, the
Atlas-by-Area plan's A2 — `docs/AREA_MAP_PLAN_2026-11-25.md`).

Six orders grew apart: the metric-definition authority (`ontology/authority.py`), the column ranker
(`ontology/ranking.py`), the hub's ladder (`hub/provenance.AUTHORITY_LADDER`, which the Record's claims use), the
learned list's, the Definitions' (`semantic/connection_kb.py`), and the graph read-back's. Two of them disagreed out
loud: the ladder puts *measured* above *approved*, the learned list put *confirmed by a person* above *measured by a
run*. Both were right about what they meant, because a thing can stand on two different words:

- **the data's** — executed against the data (measured by a run, a formula verified, a trusted query run);
- **a person's** — approved, declared, confirmed, published.

A confirmed finding stands on both, which is why the learned list rightly led with it; a measured number stands on the
data alone, which is why the ladder rightly puts it above a definition a person merely approved. So the tiers, strongest
first: **both · the data's · a person's · mined · said**. Then, within a tier and never across one:

1. **published** — a published word before a draft of it (a Definition its owner published before one only drafted);
   then **vouched** — what the organisation certified before what nobody marked, and what it deprecated last;
2. **who stands behind it** — its Area's contact's word first, then the person most often right in that Area (punch
   list 86, the user's rule for Definitions);
3. **use** — how many answers drew on it this month (A1, `trust.answer_inputs`), capped so popularity never swamps
   evidence (a wrong formula on the most-loved dashboard must not beat a right one nobody opened);
4. **recency** — the newest first;

and a caller's own last tie-breaks, then its own order — relevance — among what stands equal. Ordering, never
filtering: nothing here drops a thing (the column ranker's reason, kept). A lexicographic key, not a weighted sum, so
"why did this lead" is answered by reading it (`Standing.why`).

Pure, no store, no model.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Iterable, Optional, Sequence, TypeVar

T = TypeVar("T")

#: The evidence a thing stands on, strongest first.
TIERS: tuple[str, ...] = ("both", "data", "person", "mined", "said")
#: What each tier is, as a reader is told it.
TIER_SAID = {"both": "a person's word on a measured result", "data": "measured on the data", "person": "a person's word",
             "mined": "mined from people's own queries", "said": "said, never measured"}
#: The words that are a person's.
PERSON_WORDS = frozenset({"approved", "declared", "confirmed", "published", "trusted", "certified"})
#: The words that are the data's.
DATA_WORDS = frozenset({"measured", "verified", "executed"})
#: The most answers counted toward an order: reliance is real evidence and a shallow one, and it compounds
#: (`ontology/authority.py`'s cap, kept).
USE_CAP = 25
_VOUCHED = {"certified": 0, "": 1, "deprecated": 2}


def tier_of(word: str, *, measured: bool = False) -> str:
    """The tier a thing stands in, from the word its store keeps (a claim's tier, a definition's, a trusted query's) and
    whether the data also measured it. Unknown words stand as said — fail-closed, as the ladder does."""
    w = (word or "").strip().lower()
    if w in PERSON_WORDS:
        return "both" if measured else "person"
    if w in DATA_WORDS:
        return "data"
    if w == "mined":
        return "mined"
    return "data" if measured else "said"


def _day(as_of: str) -> int:
    digits = re.sub(r"[^0-9]", "", (as_of or "")[:10])
    return int(digits) if len(digits) == 8 else 0


@dataclass(frozen=True)
class Standing:
    tier: str
    #: Only a draft — not yet published by whoever publishes it.
    draft: bool = False
    #: The organisation's word: "certified", "" (none), or "deprecated".
    vouched: str = ""
    #: Its Area's contact stands behind it.
    owner_word: bool = False
    #: How often the person behind it was right in its Area.
    right: int = 0
    #: How many answers drew on it this month — None when it is not counted (said so, never taken for none).
    uses: Optional[int] = None
    as_of: str = ""

    def key(self, *then: object) -> tuple:
        """The sort key, best first under a plain ``sorted``. ``then`` — a caller's own tie-breaks, after use and before
        recency (the metric authority's source kind and attribution)."""
        return (TIERS.index(self.tier) if self.tier in TIERS else len(TIERS), 1 if self.draft else 0,
                _VOUCHED.get(self.vouched, 1),
                0 if self.owner_word else 1, -int(self.right or 0), -min(int(self.uses or 0), USE_CAP),
                *then, -_day(self.as_of))

    def why(self, said: str = "") -> str:
        """Why it stands where it does, in a reader's words: ``said`` — the caller's own name for its evidence ("confirmed
        by a person, measured by a run") — else the tier's."""
        parts = [said or TIER_SAID.get(self.tier, self.tier)]
        if self.draft:
            parts.append("a draft")
        if self.vouched in ("certified", "deprecated"):
            parts.append(self.vouched)
        if self.owner_word:
            parts.append("its Area's contact stands behind it")
        if self.uses:
            parts.append(f"used in {self.uses} answer{'s' if self.uses != 1 else ''} this month")
        if self.as_of:
            parts.append(f"as of {self.as_of[:10]}")
        return " · ".join(parts)


def order(things: Iterable[T], standing_of: Callable[[T], Standing], *then: Callable[[T], object]) -> list[T]:
    """``things`` best first by their standing — a stable sort, so what stands equal keeps the order it came in
    (a retriever's relevance)."""
    return sorted(things, key=lambda t: standing_of(t).key(*(f(t) for f in then)))


def best(things: Sequence[T], standing_of: Callable[[T], Standing]) -> Optional[T]:
    """The one that stands highest, or None."""
    ranked = order(things, standing_of)
    return ranked[0] if ranked else None
