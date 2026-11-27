"""
Prompts for explore planning — the analysis ledger, the decomposition into sub-questions,
and the refuter's challenge to a headline.
"""

BUILD_LEDGER_PROMPT = """\
You are setting up the shared definitions for a data analysis so that every step
computes the same metrics the same way. Read the question and schema, then list the
canonical definitions the whole analysis must reuse.

QUESTION: {question}

{sql_context}

SCHEMA (already annotated with any known column caveats):
{schema}

{scan_section}

Produce a SHORT ledger (max ~10 lines, no prose) with these parts:
- ENTITIES: for each entity the question involves, the EXACT column that uniquely
  identifies it. Watch for per-row hash IDs vs stable IDs (e.g. an order-level
  customer_id vs a stable customer_unique_id) — pick the stable identifier and say so.
- METRICS: the exact SQL expression for each metric the question needs
  (e.g. revenue = SUM(payment_value); unique customers = COUNT(DISTINCT customer_unique_id);
  average order value = SUM(payment_value) / COUNT(DISTINCT order_id)).
- SEGMENTS: any standard grouping/filter the question implies (e.g. primary payment
  method per customer = the payment_type of that customer's highest-value order).

Use only tables/columns that exist in the schema. If a concept is ambiguous, pick one
definition and state it explicitly. This ledger is binding for all later steps.
"""

DECOMPOSE_EXPLORATION_PROMPT = """\
You are a senior data analyst designing an investigation into a question that requires
building understanding progressively — not testing parallel hypotheses, but sequencing
sub-questions where each answer informs the next.

ORIGINAL QUESTION: {question}

DATABASE SCHEMA:
{schema}

{scan_section}

DESIGN AN INVESTIGATIVE CHAIN of 4–7 sub-questions that build toward a complete answer.

Sub-question types (use these as building blocks, in roughly this order):
  landscape   — "What is the distribution / scale of X?" — always first; grounds everything
  relationship — "How does X vary as Y changes?" — maps dependencies
  threshold   — "Where does the relationship change sign or cliff?" — finds critical points
  drill_down  — "Within the transition zone found in the previous step, what is the fine-grained pattern?"
  confounder  — "Does this finding hold across segments / categories / time?" — validates generalisability
  synthesis   — "Given all of the above, what is the answer?" — connects the chain (use sparingly; synthesis is usually implicit)

Rules:
1. ALWAYS start with a landscape sub-question to ground subsequent ones in actual data.
2. Each sub-question must cite the IDs of any sub-questions it depends on (depends_on).
3. expected_output must describe the shape of the query result, not the answer itself.
   Good: "A table of discount_band (0–0.8 in 0.1 increments) with average profit per band."
   Bad: "The optimal discount rate."
4. Do NOT include sub-questions about data the schema does not contain.
5. If the schema profiles show a data range, use it. Do not use made-up ranges.
6. Keep sub-questions concrete and SQL-testable. Vague sub-questions produce useless queries.
{parallelism_guidance}
Constraints from the question (extract before writing sub-questions):
{constraint_section}
"""

# Injected into the decompose prompt ONLY when the parallel-wave executor is enabled
# (transport-derived parallel waves, A1 ModelProfile); empty otherwise so the default prompt is byte-identical.
# The wave executor runs every sub-question whose `depends_on` are all satisfied concurrently,
# so an over-linked (deep-chain) plan serializes work that could run at once. This steers the
# planner toward a WIDE, SHALLOW dependency graph — the realized parallelism is entirely a
# function of how independent the emitted `depends_on` are.
PARALLEL_DECOMPOSITION_GUIDANCE = """\
PARALLELISM — these sub-questions run CONCURRENTLY in dependency waves, so the shape of
`depends_on` decides how fast the investigation finishes:
  • Cite `depends_on` ONLY when a sub-question genuinely needs another's ACTUAL OUTPUT VALUES
    before it can be written — e.g. a drill_down into "the transition zone found in Q2" truly
    needs Q2's result. If two sub-questions could be answered in EITHER order, they have NO
    dependency between them.
  • Independent CUTS of the same landscape — the same metric sliced by different segments,
    dimensions, or time periods — do NOT depend on each other. Each depends only on the
    landscape (typically Q1), so they all run in ONE wave.
  • Prefer a WIDE, SHALLOW graph (landscape → many parallel cuts → an optional synthesis) over
    a DEEP chain (Q1→Q2→Q3→Q4). A deep chain runs one-at-a-time; only build one when each step
    truly consumes the previous step's findings.
  • Do NOT invent dependencies just to impose an order.
"""


DISTILL_PACK_DELTAS_PROMPT = """\
You are improving a domain-expert PACK from a completed, VERIFIED investigation it steered.
Propose ONLY concrete, durable improvements to the expert that THIS run revealed — either:
  • a schema caveat (a column-level gotcha an analyst must know to avoid a wrong result), or
  • a diagnostic question the expert should always ask on this kind of question.

Be conservative and specific. Return an EMPTY list if nothing durable was learned. Do NOT
restate the findings, recommendations, or generic advice — only pack-level learnings grounded
in what the data actually showed here.

PACK: {pack_id}

INVESTIGATION SUMMARY (the chain that just ran):
{chain_summary}

Return deltas: a list where each item has
  kind: "caveat" (a column gotcha) or "diagnostic" (a question to always ask),
  target: "table.column" for a caveat, "" for a diagnostic,
  content: one precise sentence.
"""


REFUTE_FINDING_PROMPT = """\
You are a SKEPTICAL senior analyst. Your ONLY job is to REFUTE the headline finding below —
find the single strongest reason it could be WRONG, given the evidence actually gathered.

Default to refuted=true when: the sample is small, an obvious confound is unaddressed, the
number could be a data artifact (e.g. a fan-out/cardinality issue, a single time period, a
single category value), the conclusion overclaims beyond what the queries measured, or the
"driver" is one cherry-picked cell among many comparisons. Be adversarial, not agreeable.

ORIGINAL QUESTION: {question}

HEADLINE FINDING (the claim to attack):
{conclusion}

EVIDENCE — the investigative chain that produced it:
{chain_summary}

Return:
- refuted: true if the finding does NOT hold up to scrutiny, false only if it is genuinely robust.
- reason: one sentence — the strongest specific objection (cite the weak point in the evidence).
- alternative: a plausible alternative explanation for the same data, or null.
"""


