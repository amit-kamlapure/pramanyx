"""Ask-vs-guess clarification — decide when to ask one targeted question instead of guessing.

Phase 3 of the unified-answer-path arc (``docs/UNIFIED_ANSWER_PATH.md``); the #1 unsolved NL2SQL skill
per BIRD-INTERACT (arXiv 2510.05318). Pramanyx *detects* ambiguity but, until now, never *asks* — it
guesses. This module is the deterministic decision of whether the ambiguity is material enough to spend
one clarifying question on.

**Two-source detection** — the Phase-2 interactive-harness baseline proved one source is not enough:
``assess_complexity(...).ambiguous`` catches *under-specification* (vague pronoun, no concrete
metric/time), but NOT *value/term* ambiguity ("urgent orders" → which status?). So:

  * **Source A — under-specification.** The deterministic ``ambiguous`` flag. Low false-positive: it
    only fires on genuinely vague, anchor-less questions.
  * **Source B — ambiguous term.** A subjective/relative qualifier that implies an *unstated value
    filter*, when the question is **not already grounded** (no nearby metric / threshold / number).
    This is a deterministic proxy for candidate-disagreement; the execution-grounded version
    (bind the term against the value index / glossary, ask only on real disagreement) is the deepening
    (3b) — the seam is here.

Budget is the caller's (one ask per turn by default — BIRD-INTERACT's τ); this module only decides
*whether* and *what* to ask. Pure and deterministic (no model, no DB), so it is cheap at the door and
unit-testable.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from pramanyx.agent.complexity import assess_complexity

# Subjective / relative qualifiers that imply an UNSTATED value filter — the value/term ambiguity the
# under-specification flag misses. Deliberately excludes ranking words (top/best/worst), which are
# almost always metric-grounded ("top 10 by revenue") and would be high false-positive.
_QUALIFIER_TERMS = (
    "urgent", "important", "active", "inactive", "recent", "premium", "vip", "loyal",
    "high-value", "high value", "low-value", "low value", "at risk", "at-risk", "churned",
    "engaged", "successful", "failing", "underperforming", "outperforming", "healthy",
    "critical", "key accounts", "power users", "whales", "big spenders",
)

# Grounding signals — if the question already binds a metric / threshold / quantity, the qualifier is
# probably specified enough; suppress the term-ambiguity ask to avoid noise (the FP gate).
_GROUNDED_NEAR = re.compile(
    r"\b(by|per|>=|<=|=|>|<|over|under|above|below|more than|less than|at least|at most|"
    r"top\s+\d|bottom\s+\d|first\s+\d|last\s+\d|where|having|between)\b|\d",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ClarifyDecision:
    """Whether to ask, and what to ask — the payload of the ``clarify`` SSE event."""
    should_ask: bool
    source: str = ""                          # "underspecified" | "ambiguous_term" | "rival_meanings" | ""
    question: str = ""                        # the one targeted clarifying question
    options: list = field(default_factory=list)   # grounded options the user can click (best-effort)
    terms: list = field(default_factory=list)     # ambiguous terms detected (for Source B)
    reason: str = ""                          # why we're asking (shown small, for transparency)

    def to_event(self) -> dict:
        return {"question": self.question, "options": list(self.options),
                "source": self.source, "terms": list(self.terms), "reason": self.reason}


def assess_clarification(question: str, connection_id: str = "") -> ClarifyDecision:
    """Decide whether one clarifying question would materially improve the answer. Deterministic.

    Returns ``should_ask=False`` for well-specified questions (the common case), so the door stays
    fast and quiet; only genuinely ambiguous questions trigger an ask."""
    q = (question or "").strip()
    if not q:
        return ClarifyDecision(False)

    # Source C (the ontology study, 2026-11-17) — a word the organisation has defined differently in two areas of the
    # business, and the question names neither: ask which, with each area as a choice. Rivals are said, never picked.
    if connection_id:
        try:
            from pramanyx.semantic.areas import rival_meanings
            open_ = [r for r in rival_meanings(q, connection_id) if not r["chosen"]]
        except Exception as exc:  # noqa: BLE001 — unread, nothing is asked on its account
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "rival meanings could not be read", counter="clarify.rivals")
            open_ = []
        if open_:
            r = open_[0]
            names = [m["area_name"] for m in r["meanings"]]
            return ClarifyDecision(
                True, source="rival_meanings", terms=[r["term"]],
                question=f"“{r['term']}” means one thing in {' and '.join(names[:2])}{' and others' if len(names) > 2 else ''}"
                         " here. Which do you mean?",
                options=[f"in {n}" for n in names],
                reason=f"the organisation defines “{r['term']}” differently in {len(names)} areas of the business",
            )

    # Source A — under-specification (vague reference, no concrete metric / time anchor).
    if assess_complexity(q).ambiguous:
        return ClarifyDecision(
            True, source="underspecified",
            question="Could you be a bit more specific — which metric, and over what time period?",
            # Time is the one axis we can ground deterministically (no schema / no model):
            # offer standard windows as quick chips; the user types the metric in the box.
            options=["last 7 days", "last 30 days", "this quarter", "year to date"],
            reason="the question is under-specified (no concrete metric or time window)",
        )

    # Source B — a subjective qualifier that implies an unstated value filter, not already grounded. A qualifier inside
    # a word the organisation has defined ("active" in a written "active customer") is defined, not vague (2026-11-17).
    ql = q.lower()
    terms = [t for t in _QUALIFIER_TERMS if re.search(rf"(?<![\w-]){re.escape(t)}(?![\w-])", ql)]
    if terms and connection_id:
        defined = _defined_words_in(ql, connection_id)
        terms = [t for t in terms if not any(t in d for d in defined)]
    if terms and not _GROUNDED_NEAR.search(ql):
        t = terms[0]
        return ClarifyDecision(
            True, source="ambiguous_term", terms=terms,
            question=f"What counts as “{t}” here — a specific status, threshold, or definition?",
            options=[],
            reason=f"“{t}” is subjective and could map to different filters",
        )

    return ClarifyDecision(False)


def _defined_words_in(question: str, connection_id: str) -> list[str]:
    """The written Definitions' words (and other names) the question says, lowercased; [] when none, or unread."""
    try:
        from pramanyx.record.writers import definitions
        out = []
        for c in definitions(connection_id):
            for w in [c.extra.get("term", ""), *(c.extra.get("aliases") or [])]:
                w = re.sub(r"[^a-z0-9]+", " ", str(w).lower()).strip()
                if w and re.search(rf"(?<![a-z0-9]){re.escape(w)}(?:s|es)?(?![a-z0-9])", question):
                    out.append(w)
        # and the words the declared ontology resolves — "VIP customers" is a rule (tier is VIP or Top Customer), and
        # was asked about at every door of LuxExperience's proof, 2026-11-27: "What counts as “vip” here?"
        from pramanyx.agent.framing import framed_terms
        out.extend(re.sub(r"[^a-z0-9]+", " ", t.lower()).strip() for t in framed_terms(question, connection_id))
        return out
    except Exception as exc:  # noqa: BLE001 — unread, every qualifier is asked about as before
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the definitions could not be read", counter="clarify.defined")
        return []
