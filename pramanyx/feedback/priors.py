"""Plan-time priors — read the captured feedback loop BACK into the planner (P1).

Pramanyx already *captures* feedback channels but never *reads them back* when
planning the next answer, so the loop is open: a mistake a human corrected last
week gets made again this week. This module closes it. Given a question +
connection, :func:`build_corrections_section` assembles a single prompt section from:

1. **Resolved ambiguities** — the Ambiguity Ledger (:mod:`pramanyx.semantic.ambiguity_ledger`,
   the ambiguity ledger): an ambiguity settled earlier on this connection (by a probe, a
   user clarify choice, or a reviewer verdict) is injected as an authoritative prior FIRST,
   so the same question class never re-ambiguates — ambiguity burns down per connection.
2. **Past corrections** — ``reject`` / ``correct`` human verdicts
   (:mod:`pramanyx.feedback.verdicts`), which name a mistake not to repeat, plus any
   human-supplied fix SQL.
3. **The connection graph's read-back** (:mod:`pramanyx.ontology.context_graph_readback`).

Verified query patterns (:mod:`pramanyx.semantic.trusted_queries`) are injected by the
answer paths themselves, so this section leaves them out.

It is deliberately conservative: token-overlap matching with a threshold, so an
unrelated question injects nothing and the section is empty (zero prompt cost, no
behaviour change) when there are no relevant priors. Always on since flag endgame
Wave 5 (2026-08-06) — the data gate above IS the gate.
"""
from __future__ import annotations

import re
from pramanyx.feedback.verdicts import list_corrections

_STOP = frozenset({
    "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "by", "per",
    "each", "what", "which", "how", "many", "is", "are", "was", "were", "do",
    "does", "show", "list", "give", "me", "their", "its", "with", "that", "this",
    "why", "did", "has", "have", "over", "from", "into",
})

# Same conservative overlap threshold as trusted_queries — an unrelated question
# must inject nothing rather than pollute the plan with irrelevant corrections.
_MIN_CORRECTION_SCORE = 0.18


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9_]+", (text or "").lower())
            if t not in _STOP and len(t) > 2}


def _match_corrections(question: str, connection_id: str, limit: int,
                       agent_id: str = "") -> list[dict]:
    """The corrections that resemble this question. AO-7a: when an agent is answering,
    its OWN lessons are read first — a correction a reviewer gave this agent outranks one
    given to another on the same connection — then the connection's, deduplicated."""
    qtok = _tokens(question)
    if not qtok:
        return []
    out: list[tuple[float, dict]] = []
    seen: set = set()
    pools = ([list_corrections(connection_id, limit=50, agent_id=agent_id)] if agent_id else []) \
        + [list_corrections(connection_id, limit=50)]
    for tier, pool in enumerate(pools):
        for row in pool:
            if row.get("id") in seen:
                continue
            ctok = _tokens(row.get("headline", "")) | _tokens(row.get("note", ""))
            if not ctok:
                continue
            score = len(qtok & ctok) / len(qtok)
            if score >= _MIN_CORRECTION_SCORE:
                seen.add(row.get("id"))
                # The agent's own tier sorts ahead at equal resemblance.
                out.append((round(score, 3) + (1.0 if tier == 0 and agent_id else 0.0), row))
    out.sort(key=lambda x: x[0], reverse=True)
    return [r for _s, r in out[:limit]]


def _build_corrections_block(corrections: list[dict]) -> str:
    if not corrections:
        return ""
    lines = [
        "PAST CORRECTIONS (a reviewer judged earlier answers on THIS database and flagged "
        "the following — treat them as ground truth and do NOT repeat the mistake):",
    ]
    for i, row in enumerate(corrections, 1):
        verdict = row.get("verdict", "")
        headline = (row.get("headline") or "").strip()
        note = (row.get("note") or "").strip()
        tag = "WRONG — was rejected" if verdict == "reject" else "PARTIALLY WRONG — needed correction"
        line = f"\n-- Correction {i} [{tag}]"
        if headline:
            line += f'\nEarlier claim: "{headline}"'
        if note:
            line += f"\nReviewer note: {note}"
        src = (row.get("sql_source") or "").strip()
        if src:
            line += f"\nFlawed query was:\n{src[:600]}"
        fix = (row.get("corrected_sql") or "").strip()
        if fix:
            line += f"\nUSE THIS CORRECTED STRUCTURE INSTEAD:\n{fix[:600]}"
        lines.append(line)
    lines.append("")
    return "\n".join(lines)


def _dedup_resolutions_covered_by_corrections(resolutions: list, corrections: list[dict]) -> list:
    """A reject/correct verdict lands in BOTH the ledger (via the verdict→ledger bridge) and the
    corrections store. Keep the emphatic corrections framing ("was WRONG, use this") as the prompt
    voice for verdicts, and drop the redundant ledger line for the SAME subject — so the reviewer
    decision is injected once. Probe/user resolutions (no matching correction) still lead the block;
    the deduped ledger row survives untouched for the burn-down metric + the Trust Receipt."""
    if not (resolutions and corrections):
        return resolutions
    covered = {(c.get("headline") or "") for c in corrections}
    return [(res, s) for res, s in resolutions if res.subject not in covered]


def _match_resolutions(question: str, connection_id: str, org_id: str, top_k: int) -> list:
    """Ambiguity Ledger read path (I1): resolutions settled earlier on this connection whose
    subject overlaps the question. Best-effort; counts each served resolution (burn-down metric)."""
    from pramanyx.semantic.ambiguity_ledger import record_hit, retrieve_resolutions
    matches = retrieve_resolutions(question, connection_id, org_id=org_id, top_k=top_k)
    for res, _score in matches:
        try:
            record_hit(res.id)
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "ledger served-count bump is best-effort", counter="priors.ledger_hit")
    return matches


def build_corrections_section(question: str, connection_id: str, max_corrections: int = 3,
                              *, org_id: str = "", agent_id: str = "") -> str:
    """Resolved-ambiguity + past-correction prompt text — the non-trusted priors — PLUS the
    Wave-C connection-graph read-back. This is the piece the LIVE answer paths inject (the
    chat/direct SQL path and the plan node), which ALREADY inject verified query patterns
    separately, so this deliberately OMITS the trusted block to avoid double-injecting it. The
    Ambiguity-Ledger resolution leads (an explicit settled reading beats a past-mistake note); a
    verdict already crystallized into the ledger is deduped out of the corrections block. The
    connection-graph slice is appended last. Both loops are always on (flag endgame
    Wave 5, 2026-08-06 — `closed_loop` and `graph.readback` hardwired) and data-gated:
    nothing stored and no graph ⇒ empty string (zero-cost, byte-identical)."""
    parts: list[str] = []
    resolutions: list = []
    corrections: list[dict] = []
    try:
        resolutions = _match_resolutions(question, connection_id, org_id, 2)
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "ambiguity-ledger retrieval is best-effort", counter="priors.resolutions")
    try:
        corrections = _match_corrections(question, connection_id, max_corrections,
                                         agent_id=agent_id)
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "verdict-correction retrieval is best-effort", counter="priors.corrections")
    resolutions = _dedup_resolutions_covered_by_corrections(resolutions, corrections)
    from pramanyx.semantic.ambiguity_ledger import build_resolution_block
    parts += [p for p in (build_resolution_block(resolutions),
                          _build_corrections_block(corrections)) if p]

    graph_section = _graph_prior_section(question, connection_id, org_id)
    if graph_section:
        parts.append(graph_section)

    return ("\n".join(parts) + "\n") if parts else ""


def _graph_prior_section(question: str, connection_id: str, org_id: str) -> str:
    """The Wave-C connection-graph read-back (grep-the-graph-first), gated by
    ``graph.readback``. Lazily imported so ``verify.priors`` carries no ontology import
    cost when the flag is off. Best-effort inside the readback itself."""
    try:
        from pramanyx.ontology.context_graph_readback import build_graph_prior_section
        return build_graph_prior_section(question, connection_id, org_id=org_id)
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "connection-graph read-back is best-effort", counter="priors.graph")
        return ""
