from __future__ import annotations

from typing import Annotated, Any, Literal, Optional
from typing_extensions import NotRequired, TypedDict

from pydantic import BaseModel, Field, field_validator
import operator

# The query-execution result contract lives on the PLATFORM side so the data plane
# (db / connectors) returns it without importing the agent. Re-exported here so the
# many `from pramanyx.agent.state import QueryResult` call sites stay unchanged.
from pramanyx.control_plane.contracts.execution import QueryResult, StatResult  # noqa: F401


# ── Pydantic output schemas (structured LLM responses) ──────────────────────

class Hypothesis(BaseModel):
    id: str
    description: str
    confidence: float = 0.0
    verdict: Literal["confirmed", "refuted", "inconclusive", "untested", "skipped"] = "untested"
    key_finding: str = ""


class RouteDecision(BaseModel):
    """The BODY a question runs as — one of the four frozen ``STRUCTURAL_MODES`` (`docs/GLOSSARY.md`,
    "Names that are frozen"): ``query_mode`` on the checkpointed graph state. Since 2026-10-15 the
    mode is derived from the question's shape (`agent/question_shape.body_for`), never asked of
    a model; the model is asked for the shape (:class:`ShapeDecision`)."""
    mode: Literal["direct", "investigate", "explore", "final_text"]
    confidence: float = Field(ge=0.0, le=1.0, description="Classification confidence (0–1)")
    reasoning: str = Field(description="One sentence explaining the classification")
    #: The shape the mode was derived from; "" on a decision built before the shape was carried.
    shape: str = ""


class ShapeDecision(BaseModel):
    """What the model classifier says of a question's SHAPE on the borderline — the same four
    words code decides with (`agent/question_shape.question_shape`), so a question's kind means
    one thing at every door."""
    shape: Literal["describe", "check", "diagnose", "survey"]
    confidence: float = Field(ge=0.0, le=1.0, description="Classification confidence (0–1)")
    reasoning: str = Field(description="One sentence explaining the classification")


class QueryIntent(BaseModel):
    """Describes WHAT a single query should measure — no SQL."""
    description: str = Field(
        description="One sentence: what this query should measure and what pattern to look for."
    )
    tables: list[str] = Field(
        default_factory=list,
        description="Subset of the plan's tables this query touches.",
    )
    filters: list[str] = Field(
        default_factory=list,
        description="WHERE conditions in plain English (e.g. 'region = APAC', 'last 30 days', 'active users only').",
    )
    aggregation: str = Field(
        default="",
        description="GROUP BY columns and aggregate metric in plain English (e.g. 'GROUP BY region and month, SUM(revenue)').",
    )


class SQLOutput(BaseModel):
    """Single SQL query produced from a QueryIntent."""
    sql: str = Field(description="A valid SQL SELECT query for the target dialect.")
    reasoning: str = Field(default="", description="One sentence: what this query measures.")


# StatResult + QueryResult moved to pramanyx.control_plane.contracts.execution (imported at
# the top of this module). They remain importable from here for back-compat.


class EvidenceScore(BaseModel):
    hypothesis_id: str
    confidence: float = Field(ge=0.0, le=1.0, description="0 = fully refuted, 1 = fully confirmed")
    verdict: Literal["confirmed", "refuted", "inconclusive"]
    key_finding: str = Field(description="One sentence: what the data showed")
    should_continue: bool = Field(description="True if more queries are needed to reach a confident conclusion")
    new_hypothesis: Optional[str] = Field(
        default=None,
        description="If the data revealed an unexpected angle worth investigating, describe it as a new hypothesis. Otherwise null."
    )


class Finding(BaseModel):
    claim: str
    evidence: str
    confidence: float
    hypothesis_id: Optional[str] = None


class Pitfall(BaseModel):
    """A SQL failure that was detected and corrected during the investigation."""
    original_sql: str
    error: str
    fixed_sql: str
    fix_explanation: str = Field(
        description="One sentence: what the problem was and the general rule to avoid it (e.g. 'use EXTRACT(EPOCH FROM ...) not date subtraction in Postgres')"
    )
    data_quality_issue: Optional[str] = Field(
        default=None,
        description="If the error reveals a data quality problem (NULLs, bad types, missing values), describe it. Otherwise null."
    )
    retry_error: Optional[str] = Field(
        default=None,
        description="If the auto-corrected query also failed, the error from the retry. None if the fix succeeded."
    )


class SubQuestion(BaseModel):
    id: str = Field(description="Q1, Q2, … in execution order")
    question: str
    depends_on: list[str] = Field(default_factory=list, description="IDs of sub-questions that must complete first")
    purpose: Literal["landscape", "relationship", "threshold", "drill_down", "confounder", "synthesis"]
    expected_output: str = Field(description="What shape of data this query should return")
    done: bool = False
    answer: Optional[str] = None      # the sub-question's answer, once reasoned over
    refinement: Optional[str] = None  # a downstream hint from the reasoning step


class SubQuestionAnswer(BaseModel):
    subq_id: str
    question: str
    purpose: str
    sql: str
    columns: list[str]
    rows: list[list]
    row_count: int
    error: Optional[str] = None
    answer: str    # the natural-language answer
    insight: str   # the most actionable single finding
    refinement: Optional[str] = None  # hint injected into downstream sub-questions


class VerificationCheck(BaseModel):
    """One guard/check the engine should have run on this investigation — and whether it
    actually did. Defeats class-E silent failures (a guard that's off but assumed on):
    a check that did NOT run is surfaced, never silently treated as passed."""
    name: str
    label: str
    status: Literal["ran", "not_run", "n/a"]   # n/a = the check had nothing applicable to do
    detail: Optional[str] = None


class VerificationManifest(BaseModel):
    """The liveness + trust record for an investigation. `coverage` = fraction of applicable
    guards that ran. `earned_confidence`/`data_trust` are COMPUTED (never asserted by the
    LLM) so the report's confidence reflects evidence, not a vibe; `signals` is the
    provenance ('why this score')."""
    checks: list[VerificationCheck] = Field(default_factory=list)
    coverage: float = 0.0
    earned_confidence: float = 1.0          # 0-1: coverage × completeness × data_trust
    confidence_band: str = "high"           # high | medium | low
    data_trust: float = 1.0                 # 0-1: how trustworthy the underlying data looks
    signals: list[str] = Field(default_factory=list)   # why the score is what it is


class ExplorationReport(BaseModel):
    headline: str = Field(description="One sentence direct answer to the original question. Board-ready.")
    conclusion: str = Field(description="2-3 sentence explanation of the answer with supporting numbers.")
    narrative: str = Field(description="Flowing paragraph connecting all sub-questions into a coherent story.")
    recommended_actions: list[str] = Field(description="Concrete next steps based on the findings.")
    data_quality_notes: list["DataQualityNote"] = Field(default_factory=list)
    # Liveness record — which guards actually ran on this investigation (Bet 0). Set by
    # code, never by the LLM. Optional so older reports stay valid.
    verification: Optional["VerificationManifest"] = None

    @field_validator("data_quality_notes", mode="before")
    @classmethod
    def _drop_empty_notes(cls, v):
        """Drop malformed DataQualityNote entries that are missing required fields.

        Handles both raw dicts (from LLM output) and already-instantiated
        DataQualityNote objects (merged in by code).
        """
        if not isinstance(v, list):
            return []
        result = []
        for n in v:
            if isinstance(n, dict):
                # Raw dict from LLM — keep only if it has the minimum fields
                if n.get("issue") or n.get("table"):
                    result.append(n)
            else:
                # Already a DataQualityNote instance — pass through as-is
                result.append(n)
        return result


class DataQualityNote(BaseModel):
    table: str = ""
    column: Optional[str] = None
    issue: str = ""          # LLMs sometimes omit this — default to empty
    impact: str = ""
    recommended_fix: str = ""


class AnalysisReport(BaseModel):
    headline: str = Field(description="One sentence, board-ready. Lead with the most important finding.")
    verdict: str = Field(description="2-3 sentence diagnosis. What happened, why, which segments.")
    key_findings: list[Finding] = Field(description="Top 3-5 findings, ranked by evidence strength")
    what_is_not_the_cause: list[str] = Field(description="Hypotheses that were tested and refuted — important for ruling things out")
    data_quality_notes: list[DataQualityNote] = Field(
        default_factory=list,
        description="Structural data issues discovered during the investigation — NULLs, type problems, missing data. Empty list if none found."
    )
    risks: list[str] = Field(description="What to watch — forward-looking concerns")
    recommended_actions: list[str] = Field(description="Concrete next steps, including any data quality fixes needed")


# ── ADA Investigation types (new structured investigate mode) ─────────────────

class PhaseKeyNumber(TypedDict):
    label: str
    value: str        # formatted: "$1.4M", "-18.4%", "2.6σ"
    delta: Optional[str]   # "+5pp vs prior period"
    context: Optional[str] # "February 2026 vs January 2026"


class InvestigationFinding(TypedDict):
    finding_id: str
    title: str
    sql: str
    columns: list[str]
    rows: list[list]
    row_count: int
    error: Optional[str]
    interpretation: str   # 2-3 sentences citing real numbers
    key_numbers: list[PhaseKeyNumber]
    chart_type: str       # "bar"|"line"|"stacked_bar"|"auto"|"none"
    stat_note: Optional[str]  # "z-score = -2.4, significant at α=0.05"
    is_significant: bool
    trust_caveat: Optional[str]  # advisory from the trust battery (e.g. "fan-out", "impossible magnitude") — never blocks the answer
    # Per-column display unit so every surface (chart axis, data labels, table, key numbers) formats
    # a value the SAME way — e.g. {"metric_total": "percent"} tells the UI a rate stored as 0.4096 is
    # "41.0%", not "0.4". Absent → the UI falls back to its column-name heuristics. Units: "percent".
    column_units: NotRequired[dict[str, str]]
    # Chart-grammar exhibit spec: deterministic chart SEMANTICS —
    # {"color": {"mode": "severity"|...}, "ref_lines": [{value,label,kind}], "label_points", "quadrant",
    #  "emphasis": ["<subject entity>"]}.
    # Built by pramanyx/agent/exhibit.py from the finding's own rows; absent → legacy rendering.
    exhibit: NotRequired[dict]
    # CA-4 "title = claim": the one-sentence claim the exhibit demonstrates — the chart's
    # title on every surface; `title` keeps the query's descriptive name (the source chip).
    claim: NotRequired[Optional[str]]
    # CA-4 subtitle: scope · period · unit, assembled deterministically from the intake.
    subtitle: NotRequired[Optional[str]]


class InvestigationPhaseResult(TypedDict):
    phase_id: str       # "baseline"|"decomposition"|"dimensional"|"behavioral"|"operational"
    phase_name: str
    phase_icon: str     # emoji for UI
    status: str         # "complete"|"partial"|"skipped"|"error"
    summary: str        # one-sentence headline finding for this phase
    findings: list[InvestigationFinding]
    skipped_reason: Optional[str]
    # Machine caveats that qualify this phase (fan-out, suppressed ratios) — STRUCTURED,
    # never prepended into `summary`: a caveat glued into prose becomes whatever the
    # prose becomes, and one shipped as the headline of an executive report (the "$14"
    # specimen). Each consumer renders it in its own register; absent on older phases.
    caveats: NotRequired[list[str]]
    # P5 (canvas-output study, 2026-10-14) — the code-written significance verdict, STRUCTURED:
    # {"sigma": 0.16, "significant": False, "text": "σ = 0.16 — within normal variance"}, or
    # {"sigma": None, "significant": None, "text": "significance not assessable — …"} when the
    # baseline is too short. It used to ride `summary` as "[stats.py: σ=0.16 — within normal
    # variance]" — machinery in the reader's prose (16 of 88 stored reports). The page draws it as
    # the badge it already has; the routers and the contradiction scan read it here first and
    # fall back to the bracket on older phases. Absent on a phase code did not test.
    verdict: NotRequired[dict]
    # 2026-10-15 — the intake phase's typed decisions (`_record_intake_note`): the claim licence
    # with its reason, the routing, a recovered date axis, a dropped cut, the coverage facts — each
    # ``{"tag": …, …}``. The code that used to parse ``CLAIM LICENCE: …`` back out of the intake's
    # prose reads this slot; the prose carries the reader's sentence. Absent on other phases and on
    # older reports, whose prose the readers still parse.
    record: NotRequired[list[dict]]


class WaterfallEntry(TypedDict):
    cause: str
    amount_label: str   # "$287K" or "~18% of gap"
    pct_of_total: float # 0–100 (signed: positive = contributor to decline)
    controllable: bool
    structural: bool    # vs transient


class AnswerRecommendation(TypedDict):
    action: str
    expected_impact: str
    owner: str
    timeline: str


class AnswerReport(TypedDict):
    headline: str
    executive_summary: str
    metric: str
    observation_period: str
    comparison_basis: str
    total_change_label: str    # "-$330K (-18.4% MoM)"
    phases: list[InvestigationPhaseResult]
    attribution_waterfall: list[WaterfallEntry]
    confidence: str            # "HIGH"|"MEDIUM"|"LOW"
    confidence_justification: str
    recommendations: list[AnswerRecommendation]
    data_gaps: list[str]
    # Phase-2 structural trust artifacts (Orchestrator). Optional — older cached reports
    # may omit them; the UI reads each via .get(). See agent/orchestrator.py.
    contradiction_report: Optional[dict]   # typed cross-phase ContradictionReport.to_dict()
    orchestration_plan: Optional[dict]     # the Analyst's declared phase plan (plan of record)
    plan_reconciliation: Optional[dict]    # planned-vs-actual phases at the synthesis seam
    # T4-1 — a plain-language receipt of HOW the metric was computed (formula + ratio interpretation
    # + coverage), so a silently-chosen definition is visible and challengeable. "" when none.
    metric_definition: Optional[str]
    # A short closing "bottom line" rendered at the END of the report, before the recommendations
    # (the exec summary opens it; this closes it). "" when the synthesis didn't author one.
    closing_summary: Optional[str]
    # Wave K4b — declared actions the agent PROPOSES from this answer (staged, never executed; flag
    # `kinetic.agent_actions`, default off). Each `{action_id, status, ok, params, reasoning, message}`.
    # Optional/additive — absent on older reports and when the connection declares no actions; UI reads via .get().
    proposals: Optional[list]
    # True when narrative synthesis failed and this report was assembled deterministically
    # from phase summaries. First-class rather than a sentence inside
    # confidence_justification, because the justification renders at the BOTTOM of a
    # confident-looking document — the reader must know at the TOP that the framing is
    # machine-stitched. Absent (falsy) on every synthesized report.
    degraded: NotRequired[bool]
    # ON-10 — the question's frame: its business terms resolved against the DECLARED ontology before the intake read it
    # (`pramanyx.ontology.framing.Frame`, dumped). Shown with the answer. Absent when nothing declared was reached.
    frame: NotRequired[Optional[dict]]
    # IP-1 — the Verifier's rule-outs for the move this report states: the known ways its metric reads high (it
    # rose) or low (it fell), each with its fix and the play it came from, and the note that none was checked
    # against the data (`pramanyx.playbook.rule_outs`). Absent when the report states no move or its metric
    # names no KB entry.
    rule_outs: NotRequired[Optional[dict]]
    # CB-2 (2026-09-22) — the MEASURABLE definition this answer used: metric SQL, table, date column
    # and the observation window's length, from the intake. What a later baseline and review are
    # measured with, so an accepted recommendation can be asked "did it work?" against the same
    # number. Absent on reports written before this and on runs whose intake carried no metric.
    spec: NotRequired[Optional[dict]]
    # The sentences the trace check withheld (`report_checks.withhold_untraced`), as written: each
    # `{from, text, figures}`. Kept for audit and never rendered — the answer says a sentence was withheld.
    # Absent when nothing was.
    withheld: NotRequired[Optional[list]]
    # P1 (`conclude`) — the answer's own structure, from the analyst's `conclude` tool. `exhibits`:
    # the results the answer cites, in the order it cites them, each `{finding_id, claim}` — the canvas
    # draws each once, captioned by its claim, and names the rest under Sources. `figures`: the 3–4
    # figures the answer rests on, each `{label, value, note}`. `gaps`: what the data could not answer.
    # Absent on every report whose turn did not conclude this way, which renders exactly as before.
    exhibits: NotRequired[Optional[list]]
    figures: NotRequired[Optional[list]]
    gaps: NotRequired[Optional[str]]


class AgentState(TypedDict):
    question: str
    connection_id: str
    investigation_id: str
    schema_context: str
    # Telemetry — Langfuse trace ID (== investigation_id). Empty string when disabled.
    trace_id: str
    # agents.user_defined — the user-agent persona this run was launched AS ("" = none).
    # Persisted in state (checkpointed) because resume never passes through /ask: the
    # feedback endpoint re-activates the persona from here for the rest of the run.
    agent_id: str

    # Canvas context (Sprint 21) — set when request arrives via canvas_id.
    # canvas_id: the Canvas the user launched the investigation from.
    # canvas_schema_context: pre-filtered schema string (Canvas table selection
    #   applied). When present, nodes use this instead of re-building from
    #   connection_id. Empty string when no Canvas is active.
    canvas_id: Optional[str]
    canvas_schema_context: str
    # scope_schema: the single owning schema the investigation is pinned to (canvas
    # table-list scope OR an explicit schema-scoped run). Nodes use it to reject/repair
    # any generated SQL that references a sibling schema. "" when the run is unscoped.
    scope_schema: str

    # Investigation state
    hypotheses: list[Hypothesis]
    current_hypothesis_idx: int
    query_history: Annotated[list[QueryResult], operator.add]
    evidence_scores: Annotated[list[EvidenceScore], operator.add]

    # Accumulated pitfalls — injected into all subsequent query-planning prompts
    pitfalls: Annotated[list[Pitfall], operator.add]

    # Relevant past investigation summaries (fetched once at decompose time, via RAG).
    # This is "similar PAST investigations" — NOT the finding being drilled (see
    # origin_finding for that). Kept separate so the two never overload one channel.
    prior_analyses: list[str]

    # The specific, already-established briefing finding this investigation is DRILLING
    # (None for a cold-start question). A structured seed — set ONCE at entry and never
    # returned by any node, so it survives the whole run (a plain channel, no reducer).
    # ada_intake anchors its spec on it (metric/tables/window) instead of re-deriving,
    # and it carries provenance (insight_id) into the report. Shape:
    #   {insight_id, finding, sql, tables[], result_cells, structural[], narrative}
    origin_finding: Optional[dict]

    # Loop control
    iteration: int

    # Output
    report: Optional[AnalysisReport]

    # The body the run takes (direct · investigate · explore · final_text)
    query_mode: Optional[Literal["direct", "investigate", "explore", "final_text"]]
    # The question's shape — describe · check · diagnose · survey — decided once at the door
    # and carried into the body; a run entered without one reads it from the question.
    question_shape: NotRequired[str]

    # Data portrait read by the planners (the analyst seeds it empty)
    scan_context: str

    # Business calendar events for the investigation window (the analyst seeds it empty)
    events_context: str

    # Canonical entity/metric definitions decided once at the start of a run and
    # reused by every downstream planning/synthesis step so figures stay consistent
    # across stages (e.g. "unique customer = customer_unique_id"). Set by the
    # decompose step in both explore and investigate modes.
    analysis_ledger: str

    # Structured Data Catalog: compact markdown with column defs
    # + 5-row samples for only the relevant tables. Built once per investigation.
    data_catalog: str

    # Explore mode state (only when query_mode == "explore")
    sub_questions: list[SubQuestion]
    current_subq_idx: int
    subq_answers: Annotated[list[SubQuestionAnswer], operator.add]
    explore_report: Optional[ExplorationReport]

    # Liveness recorder (Bet 0): each guard appends its name when it actually runs, so
    # synthesize can prove which checks fired (defeats class-E silent failures).
    verification_checks: Annotated[list[str], operator.add]

    # Deep-analysis investigate mode state (only when query_mode == "investigate")
    investigation_phases: list[InvestigationPhaseResult]
    answer_report: Optional[AnswerReport]
    _ada_intake: Optional[dict]      # intake spec passed between deep-analysis phase nodes
    _intake_failed: Optional[str]    # why intake produced no spec; set ⇒ the run ends at intake
    declared_rules: Optional[list]   # Arc OC-3 — rules the intake declared for every statement (a keyed metric taken)
    # ON-10 — the frame the investigation door resolved before the graph started (a dumped
    # `pramanyx.ontology.framing.Frame`); the intake completes it with a model's choice when ambiguous.
    ontology_frame: Optional[dict]
    _clarify_pending: Optional[dict]  # P4 clarify gate: a material metric ambiguity awaiting the user's choice
    _allow_clarify: Optional[bool]    # request posture: may this run PAUSE to ask? (replaces the clarify flag)
    _suppressed_ratio: Optional[dict]  # a ratio metric proven corrupt (conditioned denom / fan-out): {metric_label, caveat, true_global_str} — synthesis scrubs it from every phase + cites the true level

    # Deep-analysis inter-phase signals (set by each phase node, read by routers + next phases)
    _baseline_summary: Optional[str]
    _baseline_passes: Optional[str]
    _baseline_significant: Optional[bool]  # code-level (stats.py) significance flag
    _baseline_sigma: Optional[float]       # z-score magnitude from stats.py
    _decomp_summary: Optional[str]
    _decomp_passes: Optional[str]
    # CA-0 — channels that were WRITTEN by nodes but never declared here. LangGraph filters a
    # node's output to the declared schema keys (langgraph/graph/state.py: `k in output_keys`),
    # so an undeclared write is dropped silently at the node boundary: the plan built by
    # the intake node never reached synthesis (orchestration_plan was null on 144/144 stored
    # reports, plan_reconciliation always "unplanned"), and route_after_baseline's
    # decompose-under-abstention branch read None on the serial path. Declared NotRequired so
    # existing fixtures that build a bare state stay valid.
    _orchestration_plan: NotRequired[Optional[dict]]   # plan_phases() output from the intake node → synthesis reconciliation
    _baseline_rel_change: NotRequired[Optional[float]]  # earlier-vs-later-half relative change from the baseline node → router
    _cross_section_summary: NotRequired[Optional[str]]  # cross-section phase summary (parallel path reads it from out)
    _degenerate_seed: NotRequired[Optional[str]]        # the degenerate-seed verdict stamped on the cross-sectional path
    # Forced pack steering for the pack eval harness (packs/engine_eval.py calls the explore
    # node directly with these set). Declared so the node's read is a schema key, not a
    # convention — and so the channel rot guard needs no allowlist.
    _pack_injection_block: NotRequired[Optional[str]]
    _pack_id: NotRequired[Optional[str]]
    # CA-3 — the analyst loop's own closing statement (the model's cause-with-size
    # conclusion, or its account of what the data cannot tell). Part of the evidence
    # the narrator writes the report from; absent/empty on every phase-script run,
    # so synthesis is byte-identical there.
    _analyst_conclusion: NotRequired[Optional[str]]
    #: P1 — the analyst's structured conclusion, as its `conclude` tool returned it: `headline`,
    #: `answer`, `exhibits` (the result ids the answer cites, each with its claim), `figures`,
    #: `gaps`. Absent when the loop ended in prose.
    _analyst_conclude: NotRequired[Optional[dict]]
    #: P4 — True on an analyst turn (`analyst._base_state`): the intake then declares no five-phase
    #: plan for it, since the analyst chooses its own slices and a plan nobody follows was being
    #: reconciled as "skipped" on 87 of 88 stored reports. Absent on the phase script.
    analyst_turn: NotRequired[bool]
    #: Rows the analyst loop gathered through non-phase tools (`run_sql`). Read by the
    #: report's no-data floor, which otherwise counts only phase findings and reads an
    #: ad-hoc-evidence run as a total failure.
    _analyst_evidence_rows: NotRequired[int]

    # AL-05 (Semantic plane) — the SemanticContext resolved once at seed (metrics · ontology ·
    # profile · KB), carried so every node reads one consistent context instead of re-consulting
    # ad-hoc. NotRequired + None when the semantic.resolve_live flag is off (the default).
    semantic_context: NotRequired[Optional[Any]]
