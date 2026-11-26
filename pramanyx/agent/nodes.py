"""The question classifier (`classify_question`) and the run's metric set (`metrics_for_state`)."""
from __future__ import annotations

import re

from pramanyx.agent.prompts import QUESTION_SHAPE_PROMPT
from pramanyx.agent.state import RouteDecision, ShapeDecision
from pramanyx.llm.provider import get_provider


def metrics_for_state(state) -> list:
    """AL-05 — the first live *consumer* of the resolved Semantic plane. When a run carries a
    `semantic_context` (resolved once at seed, schema-filtered), read its metrics instead of
    re-consulting `list_metrics()`, so every node works off ONE metric set. Falls back to a direct
    consult when no context is present (the `semantic.resolve_live` flag off → byte-identical)."""
    sc = state.get("semantic_context")
    if sc is not None and hasattr(sc, "metrics"):
        return list(sc.metrics)
    from pramanyx.semantic.metrics import list_metrics
    return list_metrics()


# A DRIVER / RELATIONSHIP question ("do late deliveries lower reviews", "is there a correlation
# between order value and review score") is answered fastest and most consistently by the
# investigate path's cross-sectional comparison — segment the metric across the condition (the Q4
# comparison_segment route, ~30s) — NOT a multi-step explore decomposition that can take 5× longer
# for the same answer. We force investigate when the LLM routed such a question to explore. Precise:
# matches "correlation/relationship between", "correlate with", "do/does X <impact-verb> Y" — and
# NOT compound conditionals ("countries where acquisition grows but revenue/customer falls").
_DRIVER_RELATIONSHIP_RE = re.compile(
    r"\b(?:relationship|correlat\w+|association)\b.{0,30}\bbetween\b"
    r"|\bcorrelate[ds]?\b.{0,20}\bwith\b"
    r"|\b(?:do|does|did)\b.{0,60}\b(?:affect|affects|lower|lowers|raise|raises|drive|drives|driven|"
    r"hurt|hurts|improve|improves|increase|increases|reduce|reduces|impact|impacts|influence|"
    r"influences|lead\s+to|leads\s+to|result\s+in)\b"
    r"|\b(?:do|does|did)\b.{0,70}\b(?:chance|likelihood|probability|odds)\b",
    re.IGNORECASE,
)


def classify_question(question: str, *, conn_id: str = "", trace_id: str = "",
                      inv_id: str = "") -> tuple[str, RouteDecision]:
    """The body a question runs as, from its SHAPE — returns (effective_mode, decision).

    Code reads the shape first (`agent/question_shape.question_shape`, the one vocabulary for a
    question's kind), and a model is asked only on the borderline — a question no rule reads —
    speaking the same four words (`ShapeDecision`). The body (`RouteDecision.mode`, one of the four
    frozen ``STRUCTURAL_MODES``) is then derived: a describe or a check runs direct, a diagnosis
    investigates, a survey explores. A low-confidence model shape is read as diagnose — a shallow
    answer to a deep question is the worse error — and a definitional describe the knowledge
    base holds takes final_text, without a query.

    It takes the question rather than a full AgentState so it can be called and tested on its
    own. The three provenance ids are optional for exactly that
    reason and default to empty; a caller that has a run around it passes them so the decision
    it records can be attributed to a connection and closed by a later human verdict.
    """
    from pramanyx.agent.question_shape import SHAPES, body_for, default_depth, question_shape, shape_reading
    shape = question_shape(question or "", default=None)
    model_chose, confidence, reasoning = False, 1.0, shape_reading(shape)
    if shape is None:
        # Cost-tiered routing (test-time scaling): a deterministic complexity assessment
        # picks the inference role — a simple question is classified by the cheap "fast"
        # model, a harder one by the frontier "coder" model (it never downgrades a hard
        # question). See docs/NL2SQL_WINNING_FORMULA_2026.md.
        from pramanyx.agent.complexity import assess_complexity, model_role_for
        llm = get_provider(model_role_for(assess_complexity(question)))
        said: ShapeDecision = llm.complete(
            system="You are a routing classifier for a business intelligence agent. Classify questions precisely.",
            user=QUESTION_SHAPE_PROMPT.format(question=question),
            response_model=ShapeDecision,
        )
        shape = said.shape if said.confidence >= 0.65 else "diagnose"
        # Driver/relationship questions are investigations (a fast cross-sectional comparison),
        # not the slower explore decomposition — consistent routing for the same question shape.
        if shape == "survey" and _DRIVER_RELATIONSHIP_RE.search(question or ""):
            shape = "diagnose"
        model_chose = shape == said.shape
        confidence = float(said.confidence) if model_chose else 0.0
        reasoning = said.reasoning
    effective_mode = body_for(shape, default_depth(shape))
    decision = RouteDecision(mode=effective_mode, confidence=confidence, reasoning=reasoning,
                             shape=shape)

    # Final-text path: definitional questions that the KB can answer without SQL
    if effective_mode == "direct":
        definitional = re.search(
            r"^(what is|what are|what does|define|explain|meaning of)",
            question,
            re.IGNORECASE,
        )
        if definitional:
            try:
                from pramanyx.semantic.kb_retriever import has_strong_kb_match
                if has_strong_kb_match(question, threshold=0.75, top_k=3):
                    decision.mode = "final_text"
                    effective_mode = "final_text"
            except Exception:
                pass

    # Decision record: the FINAL shape (the code rules, the confidence floor and the driver
    # regex included), because that is what a reflex would have to reproduce — the LLM's raw
    # pick alone is only one input to it. The body is derived from the shape, not chosen, so
    # it is not recorded as a decision. The menu is the shapes, never hand-listed beside them.
    #
    # The probability must describe the LABEL, not a different one. The model's own
    # confidence belongs to the shape it said; once the 0.65 floor or the driver regex has
    # moved it, the recorded pick is no longer the model's and carrying its number across
    # would be a corpus that trains on a number about some other answer. So an overridden
    # shape — and one code decided with no model asked — records as `rule` with no
    # probability, which is the honest reading, and also the one that keeps
    # `corpus_yield`'s with_probability count meaningful.
    from pramanyx.learning.decisions import record_decision
    record_decision("ask.shape", question, list(SHAPES), chosen=shape,
                    source="llm" if model_chose else "rule",
                    confidence=confidence if model_chose else 0.0,
                    conn_id=conn_id, trace_id=trace_id, inv_id=inv_id)
    return effective_mode, decision
