"""Explore planning — decompose a question into sub-questions, the analysis ledger, refutation.

`decompose_exploration` is the explore planner (`packs/engine_eval.py` runs it per question);
`build_analysis_ledger` and `run_refutation` are read by the analyst's phases.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

from pramanyx.agent.prompts_explore import (
    BUILD_LEDGER_PROMPT,
    DECOMPOSE_EXPLORATION_PROMPT,
    PARALLEL_DECOMPOSITION_GUIDANCE,
    REFUTE_FINDING_PROMPT,
)
from pramanyx.agent.state import (
    AgentState,
    SubQuestion,
)
from pramanyx.llm.provider import get_provider

from pydantic import BaseModel, Field
from typing import Optional

MAX_SUBQ = int(__import__("os").getenv("PRAMANYX_MAX_SUBQ", "8"))


# ── Pydantic schema for decompose output ─────────────────────────────────────

class _ExplorationPlan(BaseModel):
    question_understanding: str
    constraints: list[str] = Field(default_factory=list)
    sub_questions: list[SubQuestion]


# ── Analysis ledger — canonical definitions shared by every stage ─────────────

class _LedgerOut(BaseModel):
    ledger: str = Field(
        description="Short binding list of canonical entity identifiers, metric "
                    "SQL expressions, and segment definitions for this analysis."
    )


def _engine_block(state: AgentState, conn: Any = None) -> str:
    """The engine and the clock (`agent/sql_context.py`) for this run's SQL-writing prompts.

    The deep path builds them once in its intake; the explore branch has no intake, so they come
    from the connection — the one a sub-question runs on, or the run's own when none is handed."""
    try:
        from pramanyx.agent.sql_context import learned_settle_days, sql_context
        if conn is None and state.get("connection_id"):
            from pramanyx.db.connection import open_connection_for
            conn = open_connection_for(state["connection_id"])
        return sql_context(conn, settle_days=learned_settle_days(state.get("connection_id")))
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the engine block is additive; an explore prompt stands without it",
                 counter="explore.engine_block")
        return ""


def build_analysis_ledger(state: AgentState, sql_context: str = "") -> str:
    """Decide canonical entity/metric definitions ONCE so every downstream step
    uses the same identifiers and expressions (prevents figures drifting between
    stages, e.g. customer_id vs customer_unique_id). Best-effort — never blocks.

    ``sql_context`` names the engine (`agent/sql_context.py`). The ledger is BINDING for
    every later query, and without it the ledger wrote ``DATE_TRUNC('month', x)`` and
    ``+ INTERVAL '90 days'`` for BigQuery — five planned queries, five repairs
    (2026-09-29)."""
    scan_context = state.get("scan_context") or ""
    scan_section = (
        f"DATA PORTRAIT (actual distributions):\n{scan_context}\n" if scan_context else ""
    )
    try:
        out: _LedgerOut = get_provider("coder").complete(
            system="You define canonical metric/entity definitions for a data analysis.",
            user=BUILD_LEDGER_PROMPT.format(
                question=state["question"],
                sql_context=sql_context or "",
                schema=state["schema_context"],
                scan_section=scan_section,
            ),
            response_model=_LedgerOut,
        )
        return (out.ledger or "").strip()
    except Exception:
        return ""


# ── Node: decompose_exploration ───────────────────────────────────────────────

def decompose_exploration(state: AgentState) -> dict[str, Any]:
    """Break the question into an ordered chain of sub-questions."""
    scan_context = state.get("scan_context") or ""
    scan_section = (
        f"DATA PORTRAIT (actual distributions — use these ranges in your SQL planning):\n{scan_context}\n"
        if scan_context else ""
    )

    # Specialist-pack steering (Bet 3/Bet 1 intake hook) — default-ON since the 2026-07-31
    # flag-strategy batch 1 (receipt 452a6fcebba4), but data-gated three deep: an ACTIVE pack
    # must own this question AND carry a human-pinned deploy binding on the connection, so a
    # run with neither is byte-identical. Prepends persona + grounded recipes + diagnostics.
    steered_by = None
    try:
        # An explicit pre-rendered block (e.g. from the pack eval harness) forces steering for
        # this run, bypassing the flag/active/select path; otherwise use the live gated path.
        _pre = state.get("_pack_injection_block")
        if _pre:
            scan_section = _pre + scan_section
            steered_by = state.get("_pack_id")
            logger.info("[explore] specialist pack '%s' steering (forced) this run", steered_by)
        else:
            # One producer, three paths (grounding.py) — investigate and quick-/ask read
            # the same resolve, so a pack that steers exploration now steers all of them.
            from pramanyx.agent.grounding import pack_steering
            _block, _pack_id = pack_steering(
                state.get("question", ""), state.get("connection_id", ""),
                state.get("scope_schema", "") or "")
            if _block:
                scan_section = _block + scan_section
                steered_by = _pack_id
                logger.info("[explore] pack '%s' is steering this run", _pack_id)
    except Exception as _exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(_exc, "specialist-pack intake best-effort; run proceeds ungrounded",
                 counter="packs.intake")

    # ON-10 — the question framed against the declared ontology before the chain is planned: the definitions it
    # reaches (with the SQL the object door compiles), where to start and the drivers lead the planner's context.
    _frame = None
    try:
        from pramanyx.agent.framing import frame_from_state
        from pramanyx.ontology.framing import render_frame_block
        _frame = frame_from_state(state)
        _frame_block = render_frame_block(_frame) if _frame is not None else ""
        if _frame_block:
            scan_section = _frame_block + "\n\n" + scan_section
    except Exception as _exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(_exc, "framing the question is best-effort; the chain is planned from the question as written",
                 counter="explore.frame")

    # Pin canonical definitions for the whole run before planning any sub-questions — told the
    # engine, as the deep path's ledger is: its metric expressions are SQL every later step reuses.
    analysis_ledger = build_analysis_ledger(state, sql_context=_engine_block(state))

    # Extract explicit user constraints from the question (re-use decompose pattern)
    constraint_section = "No explicit constraints detected."

    # The parallel-wave executor (transport-derived parallel waves) reads the plan's `depends_on`
    # to decide what runs concurrently — so under the flag we steer the planner toward a wide,
    # shallow dependency graph. Off → the prompt + downstream are byte-identical to the serial form.
    parallel_on = _parallel_subq_on()

    # Resilience: the planner is the single point where an exploration most often
    # dies (LLM/provider hiccup or an assertion-style prompt that yields no chain).
    # Retry once with a corrective nudge, then fall back to a deterministic floor
    # chain so the investigation ALWAYS proceeds to real queries + synthesis.
    sub_questions = _plan_exploration_chain(state, scan_section, constraint_section, parallel_on)
    if not sub_questions:
        sub_questions = _floor_chain(state)

    # Pre-flight prune: if the data spans a single period, drop seasonality/temporal
    # sub-questions before they cost a planning slot + a query (the Swiss-Air case that
    # "discovered" the data was single-month June only after running the step).
    span = _data_span_months(scan_context)
    sub_questions, dropped = _prune_impossible_subqs(sub_questions, span)
    if dropped:
        logger.info("[explore] pruned %d temporal sub-question(s) — data spans ~%.1f month(s): %s",
                    len(dropped), span or 0.0, "; ".join(s.question[:48] for s in dropped))
    if not sub_questions:
        sub_questions = _floor_chain(state)

    # Reindex to canonical, unique ids BEFORE truncation so the retained chain is a
    # contiguous Q1..Qn with no duplicate keys (planner can emit two 'Q3').
    sub_questions = _canonicalize_subq_ids(sub_questions[:MAX_SUBQ])

    # Under the parallel flag: deterministic dependency hygiene (a landscape can't depend on a
    # sibling) + log the realized wave layering so the achieved parallelism is measurable on the
    # real path without an LLM-variance A/B. No-op / byte-identical on the serial path.
    if parallel_on:
        sub_questions = _normalize_depends_on(sub_questions)
        sched = _wave_schedule(sub_questions)
        logger.info("[explore] wave schedule: %d wave(s), widths %s (%d sub-questions)",
                    len(sched), [len(w) for w in sched], len(sub_questions))

    return {
        "sub_questions": sub_questions,
        "ontology_frame": (_frame.model_dump(mode="json") if _frame is not None and _frame.defines else None),
        "current_subq_idx": 0,
        "subq_answers": [],
        "pitfalls": [],
        "iteration": 0,
        "analysis_ledger": analysis_ledger,
        # Liveness: the pre-flight temporal prune ran (record outcome too); plus a marker when
        # a specialist pack steered this run.
        "verification_checks": [f"temporal_prune:{len(dropped)}"]
                               + ([f"specialist:{steered_by}"] if steered_by else []),
    }


def _plan_exploration_chain(state: AgentState, scan_section: str, constraint_section: str,
                            parallel_on: bool = False) -> list[SubQuestion]:
    """Run the decompose planner with one corrective retry. Never raises —
    returns [] only if the LLM truly can't produce a valid SQL-answerable chain.

    ``parallel_on`` (the transport-derived parallel-waves decision) injects the wide-DAG guidance + a
    dependency-graph system role; when off the prompt is byte-identical to the sequential form."""
    llm = get_provider("coder")
    base_user = DECOMPOSE_EXPLORATION_PROMPT.format(
        question=state["question"],
        schema=state["schema_context"],
        scan_section=scan_section,
        constraint_section=constraint_section,
        parallelism_guidance=(PARALLEL_DECOMPOSITION_GUIDANCE if parallel_on else ""),
    )
    system = ("You are a senior data analyst designing an investigation as a dependency graph of "
              "sub-questions — independent lines of inquiry run in parallel, dependent ones in sequence."
              if parallel_on else
              "You are a senior data analyst designing a sequential investigative chain.")
    for attempt in range(2):
        user = base_user if attempt == 0 else (
            base_user
            + "\n\nYOUR PREVIOUS ATTEMPT RETURNED NO USABLE SUB-QUESTIONS. You MUST now "
            "return at least 3 concrete, SQL-answerable sub-questions that use ONLY tables "
            "and columns present in the schema above. Begin with a `landscape` question. "
            "If the input is a claim rather than a question, reframe it as a verification "
            "question (e.g. 'Is it true that …?')."
        )
        try:
            plan: _ExplorationPlan = llm.complete(
                system=system,
                user=user,
                response_model=_ExplorationPlan,
            )
            sqs = [sq for sq in (plan.sub_questions or []) if (sq.question or "").strip()]
            if sqs:
                return sqs
        except Exception:
            continue  # transient provider/parse error — fall through to retry / floor
    return []


def _floor_chain(state: AgentState) -> list[SubQuestion]:
    """Deterministic safety-net chain (no LLM) so an exploration never starts
    empty even if the planner fails entirely. Anchors on the first schema table
    and the original question, then lets the per-sub-question SQL planner do the
    real work against the live schema."""
    import re as _re
    m = _re.search(r"^(?:TABLE:|##)\s+([^\s\[(]+)", state.get("schema_context", "") or "", _re.MULTILINE)
    table = m.group(1) if m else "the primary table"
    q = (state.get("question") or "the original question").strip()
    return [
        SubQuestion(
            id="Q1", purpose="landscape", depends_on=[],
            question=f"What is the overall volume and the key measurable dimensions in the data most relevant to: {q}?",
            expected_output=f"A small summary of row counts and key aggregates from {table} and directly related tables.",
        ),
        SubQuestion(
            id="Q2", purpose="synthesis", depends_on=["Q1"],
            question=f"Based on the landscape above, what is the most direct, evidence-backed answer to: {q}?",
            expected_output="A focused aggregate (grouped/ranked as needed) that directly addresses the original question.",
        ),
    ]


def _canonicalize_subq_ids(sqs: list[SubQuestion]) -> list[SubQuestion]:
    """Assign canonical, unique, execution-order ids (Q1..Qn) to the planned chain,
    regardless of what the LLM emitted.

    The planner sometimes returns duplicate ids (two 'Q3') or gaps. Downstream state —
    subq_answers, subq_data_portrait, refinement injection, and the frontend stepper key —
    all key off the sub-question id, so a collision silently cross-contaminates two
    distinct questions (answers/portraits overwrite each other) AND crashes the React
    stepper with a duplicate-key error. Reindexing by position guarantees uniqueness.

    depends_on is advisory (execution is sequential by index), so we remap it best-effort
    through the old→new mapping, keeping only backward references that resolve."""
    if not sqs:
        return sqs
    new_ids = [f"Q{i + 1}" for i in range(len(sqs))]
    # An old id may appear more than once; record every replacement so a backward
    # depends_on reference resolves to the most recent earlier occurrence.
    old_to_new: dict[str, list[str]] = {}
    for sq, nid in zip(sqs, new_ids):
        old_to_new.setdefault(sq.id, []).append(nid)

    out: list[SubQuestion] = []
    for i, sq in enumerate(sqs):
        remapped: list[str] = []
        for dep in (sq.depends_on or []):
            earlier = [c for c in old_to_new.get(dep, []) if int(c[1:]) < i + 1]
            if earlier and earlier[-1] not in remapped:
                remapped.append(earlier[-1])
        out.append(SubQuestion(**{**sq.model_dump(), "id": new_ids[i], "depends_on": remapped}))
    return out


def _parallel_subq_on() -> bool:
    """Concurrent explore sub-question waves, transport-derived (A1 ModelProfile) — the
    former `explore.parallel_subq` flag, deleted by flag endgame Wave 6. The decision
    follows the bound transport's declared rate budget instead of a switch; any
    resolution error means the serial decompose path, unchanged."""
    from pramanyx.llm.profile import parallel_waves_enabled
    return parallel_waves_enabled()


def _normalize_depends_on(sqs: list[SubQuestion]) -> list[SubQuestion]:
    """Deterministic dependency hygiene for the wave scheduler. A `landscape` sub-question grounds
    the whole investigation and cannot depend on a sibling, so its depends_on is cleared — a plan
    that spuriously links it would otherwise push it out of the first wave and stall every dependent
    behind it. We ONLY drop dependencies that provably cannot be real (dropping a genuine data
    dependency would let a sub-question run before its input exists); real chain-widening is left to
    the planner + the DAG guidance. Forward/dangling/duplicate refs are already removed by
    _canonicalize_subq_ids, so the input here is a clean backward-only DAG."""
    out: list[SubQuestion] = []
    for sq in sqs:
        if (getattr(sq, "purpose", "") or "").strip().lower() == "landscape" and (sq.depends_on or []):
            out.append(SubQuestion(**{**sq.model_dump(), "depends_on": []}))
        else:
            out.append(sq)
    return out


def _wave_schedule(sqs: list[SubQuestion]) -> list[list[str]]:
    """The deterministic wave layering the executor will follow, computed purely from depends_on:
    wave 1 = every sub-question with no (in-chain) dependency; wave k = those whose deps all landed
    in earlier waves. The observable measure of realized parallelism — the wave *widths* are what the
    P-A+ prompt change is trying to grow. On the canonicalized DAG (backward-only refs, no cycles)
    this exactly predicts the wave loop's `_ready_subqs` sequence; a dangling ref is treated as
    satisfied and any residual cycle flushes as a final wave, so the layering always terminates."""
    ids = {sq.id for sq in sqs}
    pending = {sq.id: {d for d in (sq.depends_on or []) if d in ids} for sq in sqs}
    order = [sq.id for sq in sqs]
    done: set = set()
    waves: list[list[str]] = []
    while len(done) < len(order):
        ready = [i for i in order if i not in done and pending[i] <= done]
        if not ready:                       # unbreakable cycle — flush the remainder, never loop
            ready = [i for i in order if i not in done]
        waves.append(ready)
        done.update(ready)
    return waves


# Sub-questions that only make sense with multiple time periods. Pruned pre-flight when
# the data spans a single period — otherwise the planner spends a query to "discover" the
# obvious (the Swiss-Air seasonality step that found the data was single-month June).
_TEMPORAL_KEYWORDS = (
    "season", "seasonal", "quarter", "month-over-month", "monthly trend", "year-over-year",
    "yoy", "over time", "trend over", "by month", "by quarter", "by season", "across month",
    "across quarter", "seasonality", "time series", "per month", "per quarter", "monthly",
    "quarterly", "temporal",
)


def _data_span_months(scan_context: str) -> Optional[float]:
    """Approximate span (in months) of the data's date range, parsed from the DATA
    PORTRAIT text. Returns None when no date range is discoverable (→ don't prune)."""
    try:
        from pramanyx.agent.investigate import _extract_data_date_range
        lo, hi = _extract_data_date_range(scan_context or "")
        if not lo or not hi:
            return None
        from datetime import date
        span_days = (date.fromisoformat(hi) - date.fromisoformat(lo)).days
        return max(0.0, span_days / 30.44)
    except Exception:
        return None


def _prune_impossible_subqs(
    sub_questions: list[SubQuestion], span_months: Optional[float]
) -> tuple[list[SubQuestion], list[SubQuestion]]:
    """Drop temporal/seasonality sub-questions when the data spans a single period
    (<2 months) — they can only return one group and waste a planning slot + a query.
    landscape/synthesis steps are never pruned. Returns (kept, dropped)."""
    if span_months is None or span_months >= 2.0:
        return sub_questions, []
    kept: list[SubQuestion] = []
    dropped: list[SubQuestion] = []
    for sq in sub_questions:
        text = f"{sq.question} {sq.expected_output}".lower()
        temporal = any(k in text for k in _TEMPORAL_KEYWORDS)
        if temporal and sq.purpose not in ("landscape", "synthesis"):
            dropped.append(sq)
        else:
            kept.append(sq)
    return kept, dropped


# ── Refutation — the skeptic's pass over a headline ──────────────────────────

class _RefutationVerdict(BaseModel):
    refuted: bool = Field(description="True if the headline finding does NOT hold up to scrutiny.")
    reason: str = Field(default="", description="One-sentence strongest objection.")
    alternative: Optional[str] = Field(default=None, description="Plausible alternative explanation, or null.")
    #: Filled by the caller, never by the model: which binding challenged (phase 2 of the 2027
    #: study — a second binding where the install has two, said either way).
    binding: dict = Field(default_factory=dict)


def skeptic_binding():
    """``(provider, binding record)`` — the challenger. A SECOND binding where the install has two
    (the narrator's model differs from the coder's), else the coder's own, and the record says
    which: a challenge from the same model is weaker evidence than one from another, and the
    two must never read alike on the `causal_checks` record."""
    coder = get_provider("coder")
    try:
        other = get_provider("narrator")
    except Exception:  # noqa: BLE001 — an unbound narrator means one binding
        other = None
    if other is not None and other.model and other.model != coder.model:
        return other, {"role": "narrator", "model": other.model, "second_binding": True}
    return coder, {"role": "coder", "model": coder.model, "second_binding": False,
                   "why": "the install binds one model for both roles" if other is not None
                   else "no second role is bound"}


def _run_refutation(question: str, conclusion: str, chain_summary: str) -> Optional[_RefutationVerdict]:
    """Adversarial self-verification (Bet 0, 0-IV): an independent skeptic pass that TRIES to
    refute the headline — from a second model binding where one is configured. Best-effort —
    returns None on any provider/parse failure so synthesis is never blocked. Gated by the
    caller to load-bearing (non-no-signal) conclusions only."""
    try:
        provider, binding = skeptic_binding()
        verdict: _RefutationVerdict = provider.complete(
            system="You are a skeptical analyst whose only job is to refute a finding.",
            user=REFUTE_FINDING_PROMPT.format(
                question=question, conclusion=conclusion, chain_summary=chain_summary[:6000]),
            response_model=_RefutationVerdict,
        )
        verdict.binding = binding
        return verdict
    except Exception:
        return None


# Public alias — the ADA/investigate path (T4-3) reuses this skeptic pass to adversarially verify a
# decision-changing verdict, so a public name is exported instead of reaching into the private one.
run_refutation = _run_refutation


