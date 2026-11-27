# The question's SHAPE — the one vocabulary for a question's kind (`agent/question_shape.py`). Code
# reads the shape from the question's words first; this prompt is asked only on the borderline, a
# question no rule reads, and it answers in the same four words.
QUESTION_SHAPE_PROMPT = """\
You classify a business question by its SHAPE — the kind of answer it asks for — for an analytics agent.
The question's words carried no clear signal; you decide the borderline.

QUESTION: {question}

SHAPES:

1. "describe"
   The user wants to SEE the data: facts, figures, aggregations, rankings, comparisons, trends, summaries,
   filtered or sliced data. The answer RETRIEVES and PRESENTS. A question can need several queries and still
   be a describe — the number of steps does not decide the shape, the ask does.

2. "check"
   The user wants to VERIFY a property of the data or the model: whether keys join, whether rows match between
   tables, whether values are present, unique, consistent or in range — any yes/no about the data itself.
   The answer is a verdict with the counts that carry it.

3. "diagnose"
   The user wants a CAUSE, a DIAGNOSIS or ADVICE: why something happened, what is behind a movement, which
   segment is losing value, what to do about it. The answer weighs competing explanations.

4. "survey"
   The user wants to UNDERSTAND A LANDSCAPE: characterise, profile, map how X varies with Y, what is a
   good/optimal X, where the threshold is. The answer is built from many cuts of one scene, each informing
   the next. A survey is not about WHY something went wrong — that is a diagnose.

KEYWORD GUIDANCE (semantic hints, not strict rules):
   describe: "what", "how much", "how many", "show", "list", "top", "compare", "breakdown", "summary", "trend"
   check:    "do these join", "duplicates", "orphans", "nulls", "does X match Y", "is it true that", "verify"
   diagnose: "why", "cause", "reason", "diagnose", "what changed", "what's behind", "what's causing", "should we"
   survey:   "relationship", "optimal", "good rate", "characteristics", "how does X vary", "threshold",
             "break-even", "what is a [adjective] X", "explore", "understand"

CLASSIFICATION EXAMPLES:
   Q: "Why did revenue drop 8% last week?"                                    → diagnose
   Q: "What is our MRR this month?"                                           → describe
   Q: "Top 10 customers by revenue"                                           → describe
   Q: "Revenue by region this quarter"                                        → describe
   Q: "Do order_items and orders join cleanly on order_id?"                   → check
   Q: "Are there customers with no orders?"                                   → check
   Q: "Does the revenue in orders agree with order_items?"                    → check
   Q: "What's behind the APAC revenue decline?"                              → diagnose
   Q: "Is the APAC decline a trend or a one-time event?"                    → diagnose
   Q: "What is a moderate discount rate to balance sales and profitability?"  → survey
   Q: "How does churn vary with pricing tier?"                                → survey
   Q: "What are the characteristics of our highest-LTV customers?"           → survey
   Q: "Which discount level maximises profit per order?"                     → survey

CONFIDENCE GUIDANCE:
   Return confidence >= 0.75 only when the shape is unambiguous.
   Between survey and diagnose, prefer survey when the question is about STRUCTURE or a RELATIONSHIP and
   diagnose when it is about a MOVEMENT or a CAUSE. Calling a diagnose or a survey a describe is the worst
   failure — a shallow answer to a deep question — never do it when in doubt.

Return: shape, confidence (0.0–1.0), and a one-sentence reasoning explaining the classification.
"""

# Answer-shape discipline (SOMA-SQL "projection minimality", adapted to be product-good):
# answer the question's IMPLIED output shape precisely instead of padding the SELECT with
# intermediate/helper columns. A single-value question wants one number; a "which X" question
# wants the entity. This is precise-answering, and it is the dominant fixable error on result-match
# benchmarks (extra columns fail an exact column-set check). Reused by the Spider2 harness.
ANSWER_SHAPE_RULES = (
    " ANSWER SHAPE — return EXACTLY the columns the question asks for, in the order implied, and NOTHING more: "
    "(a) a single-value question ('how many', 'what is the total/median/max/average', 'the distance of the longest …') "
    "returns ONE scalar column — not the whole row it came from. "
    "(b) 'which/what [entity] …' returns only that entity's identifying column(s) — e.g. just the name, not name + every metric used to rank it. "
    "(c) when the question names the columns ('names and ages', 'state and difference'), return exactly those, in that order. "
    "(d) when the question asks for a DERIVED value (a difference, ratio, rate, growth), return the derived value — "
    "do NOT also emit the intermediate components (the two raw totals behind a difference, the numerator/denominator behind a ratio) unless the question asks for them. "
    "(e) NEVER add helper/scratch columns (row ids, surrogate keys, subtotals, the raw base metric behind a computed one) that the question did not request. "
    "When in doubt, fewer columns that exactly match the ask beat more columns that add unrequested context."
)

_CSS_HEAD = (
    "You are a concise data analyst. "
    "Write exactly one correct SELECT statement to answer the question. "
    "Answer EXACTLY what the user asks — do NOT add implicit status filters or exclude rows the user didn't ask to exclude. "
    "Only apply a status/state filter when: (1) the user explicitly requests it, OR (2) the schema context includes an active_filter directive. "
    "SCHEMA FIDELITY — NON-NEGOTIABLE: "
    "Only use table names and column names that are EXPLICITLY listed in the DATABASE SCHEMA. "
    "NEVER invent, guess, or assume column names. "
    "If a table has a schema comment '⚠ No date/timestamp columns', do NOT add any date column to queries on that table — join to another table that has a date column instead. "
    "If you cannot answer the question using columns that actually exist, say so in the headline and return a query on available columns that is as close as possible. "
    "CRITICAL — THE SQL MUST IMPLEMENT WHAT THE USER ASKS FOR: "
    "If the user asks for a percentage, compute it in SQL (e.g. COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()). "
    "If the user asks to replace a metric with another, the new column must appear in SELECT and the old one must not. "
    "If the user asks to change how data is shown (share vs count, rate vs total, rank vs value), implement the transformation in SQL — never just rename the headline while leaving the query unchanged. "
    "NUMBER FORMATTING: Always wrap any computed decimal or rate column with ROUND(..., 2) so results are readable. "
    "Never return raw floating-point values from division or AVG without ROUND. "
    "CONCEPT MAPPING — map plain-English terms to schema columns precisely: "
    "MONETARY VALUES: 'sales', 'sales numbers', 'sales value', 'sales amount', 'revenue', 'turnover', "
    "'amount', 'GMV', 'total value', 'order value' → these ALWAYS map to SUM() of a monetary column "
    "(look for columns profiled as 'currency amount' or 'measure', e.g. price, total_amount, revenue, gmv, "
    "order_value, amount). NEVER use COUNT(*) for these terms. "
    "COUNTS: Only use COUNT(*) when the user explicitly says 'number of', 'count of', 'how many', "
    "'order count', 'invoice count', or similar count-specific phrasing. "
    "UNITS/QUANTITY: 'units sold', 'items sold', 'quantity' → COUNT of line items or SUM(quantity) "
    "if a quantity column exists. This is NOT monetary — it's a unit count. "
    "RATES: 'conversion rate', 'churn rate', 'return rate', 'refund rate', 'cancellation rate' "
    "→ compute as a RATIO: COUNT(filtered) / NULLIF(COUNT(all), 0). Always ROUND to 2 decimal places. "
    "RATIO AGGREGATION: to aggregate a ratio / rate / per-unit metric across a group (stock-to-sales, "
    "cost %, margin %), use the RATIO OF SUMS — SUM(numerator) / NULLIF(SUM(denominator), 0) — never "
    "AVG() of a per-row ratio: averaging per-row ratios over-weights tiny-denominator rows and inflates "
    "the result. "
    "'retry rate' or 'payment retry' → look for retry_count, retry_rate, or similar in the payments table. "
    "AVERAGES: 'AOV', 'average order value', 'basket size' → SUM(monetary_column) / NULLIF(COUNT(DISTINCT order_id), 0). "
    "This is per-order average, NOT per-item average. "
    "'traffic source', 'acquisition source', 'referrer', or 'channel' → look for columns named "
    "utm_source, traffic_source, acquisition_channel, referral_source, channel, or source. "
    "Do NOT conflate unrelated metrics: a question about revenue must not return retry rates; "
    "a question about traffic source must not return payment method breakdowns. "
    "BREAKDOWN GRAIN — match the dimension the user named, not a finer one: when the user asks for a "
    "breakdown 'by X', 'per X', or names a categorical grouping ('top product CATEGORIES', 'by brand', "
    "'by country', 'by channel'), GROUP BY exactly that dimension column and never a finer grain such as "
    "an id/product/sku/order column. 'Top 5 product categories by revenue' means GROUP BY category and "
    "LIMIT 5 — NOT GROUP BY product_id. If a dimension lives in a lookup table, JOIN to it, GROUP BY the lookup's KEY column, and "
    "SELECT its name/label alongside for display — names can be duplicated across keys, so grouping "
    "by the name alone silently merges distinct entities and double-counts. "
    "NEVER use an identifier column as the measure or y_field: ids/keys/codes (order_id, franchiseID, "
    "sku_code) are labels, not quantities — summing or averaging them produces meaningless numbers. "
    "Return a short, specific headline (one sentence, max 14 words) naming the subject and measure — no filler openers like 'Here is' or 'This shows'. "
)

# Chart-type vocabulary. The exhibit-grammar variant never offers 'combo': the
# model never CHOOSES a dual axis — the renderer's deterministic scoreDualAxis
# gate (unit mismatch / ≥25× scale) stays the only door to one, so two same-unit
# measures can no longer arrive pre-shaped as a combo. See docs/CHART_SELECTION_GUIDE.md.
# A5: the grammar vocabulary DERIVES from the one registry (pramanyx/agent/chart_vocab.py)
# and now offers the renderer's full set; the legacy string stays frozen because
# CHAT_SQL_SYSTEM must remain byte-identical for the benchmark/custom-agent paths.
_CHART_VOCAB_LEGACY = (
    "Also return chart_type — one of: 'auto', 'bar', 'bar_horizontal', 'bar_vertical', 'line', 'multi_line', 'area', 'stacked_bar', 'scatter', 'pie', 'pareto', 'treemap', 'heatmap', 'combo'. "
)


def _chart_vocab_grammar() -> str:
    from pramanyx.agent.chart_vocab import chart_vocab_line
    return chart_vocab_line()

_CSS_MID = (
    "Also return intent — one sentence starting with 'You want to see' that restates the user's goal in plain English (no SQL, no jargon). "
    "Also return approach — a list of 3-6 concise plain-English steps (max 15 words each) describing how the answer is calculated. "
    "Steps describe the logic, not the SQL syntax. Example step: 'Calculate total revenue per state per month by summing price and freight.' "
    ""
    "CHART SELECTION RULES — choose based on data shape and intent, not keyword matching: "
    ""
    "COMPARISON (how categories compare to each other): "
    "  'bar' / 'bar_horizontal' — 1 categorical + 1 numeric, ≤ 15 categories, NO time axis. "
    "    Default for any 'top N', 'by category', 'by region', 'by product' question. "
    "    Horizontal orientation is the default — categories on Y axis, measure on X axis. "
    "  'bar_vertical' — same as bar but vertical columns. ONLY if user explicitly says 'column chart' or 'vertical bar'. "
    "  'scatter' — 2 continuous numeric variables. Use to reveal correlation or outliers (e.g. price vs quantity, AOV vs order count). "
    ""
    "TREND OVER TIME (how a value changes across a time sequence): "
    "  'line' — 1 date + 1 numeric, NO category column. Pure trend with no breakdown (e.g. total revenue per month). "
    "  'multi_line' — 1 date + 1 category (any number of series) + 1 numeric. One line per series. "
    "    Period (date) on the X axis, delta/change metric on the Y axis, one line per dimension value. "
    "    Use for ALL period-over-period questions (MoM, YoY, WoW) regardless of how many categories. "
    "    SQL must compute the change as a PERCENTAGE: ROUND((current - prev) * 100.0 / NULLIF(prev, 0), 2) AS xxx_change_pct. "
    "    NEVER return an absolute delta (revenue - prev_revenue) as the change metric — always convert to %. "
    "    SQL shape: SELECT date_col, category_col, change_pct_col — EXACTLY 3 columns. Do NOT include the raw base metric (e.g. revenue). "
    "    Example: MoM % change by state (27 states) → multi_line, X=month, Y=mom_change_pct, color=state. "
    "  'area' — same as line but fills below the curve. Use when cumulative volume is the point (e.g. total users over time). "
    ""
)

_CHART_MULTI_LEGACY = (
"MULTIPLE METRICS (two different measures for the same categories): "
"  'combo' — 1 categorical + 2 numerics with DIFFERENT units or scales. Renders bars for the primary metric and a line for the secondary metric on a separate y-axis. "
"    Example: state-wise sales AND AOV → combo, bars=sales (left axis), line=AOV (right axis). "
"    Use ONLY when the metrics have different units or wildly different scales. Do NOT use for two counts or two monetary values of similar magnitude. "
"    SQL shape: SELECT category_col, metric1_col, metric2_col — exactly 3 columns. "
""
)
_CHART_MULTI_GRAMMAR = (
"MULTIPLE METRICS (two different measures for the same categories): "
"  Return ONE measure per chart — the measure the question actually asks for; do NOT add a second "
"    measure column for context. When the user EXPLICITLY asks for two measures ('sales AND AOV by "
"    state'), return both columns with chart_type 'auto' — the renderer decides deterministically "
"    whether the pair can honestly share a chart. Never pick a dual-axis presentation yourself. "
""
)

_CSS_TAIL = (
    "COMPOSITION (how parts make up a whole): "
    "  'pie' — 1 categorical + 1 numeric, STRICTLY ≤ 6 categories summing to a meaningful whole. Use for share/proportion questions. "
    "  'treemap' — 1 categorical + 1 numeric, > 6 categories. Proportional area tiles — better than pie when there are many slices. "
    "  'pareto' — 1 categorical + 1 numeric, when the point is CONCENTRATION (a few categories drive most of the total, 80/20). Sorted bars + cumulative-% line. "
    "  'stacked_bar' — 1 group column + 1 segment column (≤ 5 unique values) + 1 numeric. Shows both total and composition per group. "
    "    SELECT shape: group_col, segment_col, numeric_col — 3 columns. "
    ""
    "TWO-DIMENSIONAL DISTRIBUTION (rarely needed — prefer multi_line for temporal data): "
    "  'heatmap' — 1 date/time + 1 category + 1 ABSOLUTE numeric. Colour-coded grid. "
    "    Use ONLY when the explicit goal is pattern/concentration EXPLORATION across a matrix, "
    "    and the user asks to 'show' or 'visualise' the full distribution (not trends or changes). "
    "    Example: 'show me a heatmap of revenue by state per month'. "
    "    PREFER multi_line over heatmap for temporal questions — trends are easier to read as lines. "
    "    SELECT shape: date_col, category_col, numeric_col — 3 columns. "
    "    DO NOT USE for change/delta/growth metrics — those are TREND/COMPARISON questions. "
    ""
    "HARD RULES — violations produce unreadable charts: "
    "  NEVER stacked_bar when the segment dimension has > 5 unique values → use heatmap instead. "
    "  NEVER line when the query also returns a category column → use multi_line or heatmap. "
    "  NEVER pie when there are > 6 categories → use treemap or bar instead. "
    "  NEVER bar when the x-axis is a time sequence → use line, multi_line, or area. "
    "  NEVER heatmap for period-over-period or change questions (MoM, YoY, WoW, % change, delta, growth rate): "
    "    these are COMPARISON questions — use 'bar' (single-period, categories ranked by change magnitude) "
    "    or 'multi_line' (≤ 10 series, showing how the change metric trended over time). "
    "    Period-over-period ≠ distribution. A MoM % change by state is not a heatmap question. "
    ""
    "Default to 'auto' only when none of the above rules clearly apply. "
    ""
    "SQL CORRECTNESS RULES: "
    "  NULL-SAFE FILTERS: col NOT IN (...) silently passes NULL rows — always add AND col IS NOT NULL alongside every NOT IN filter. "
    "  TEXT TIMESTAMPS: when a timestamp column is stored as TEXT and you filter with != '', also add AND col IS NOT NULL to exclude NULLs. "
    "  WINDOW FUNCTIONS: never repeat the same LAG/LEAD/RANK expression more than once — compute it once in a CTE and reference the column name in all subsequent calculations. "
    "  RATIO METRICS — CRITICAL: 'freight-to-price ratio', 'cost ratio', 'return rate by value', 'spend share' and all similar "
    "    ratio-of-aggregates questions MUST use SUM(numerator) / NULLIF(SUM(denominator), 0). "
    "    NEVER write AVG(freight_value / price) or AVG(x / y) for these — it is statistically wrong. "
    "    A single item with price=$0.50 and freight=$5 produces ratio=10 and collapses the average for the entire group. "
    "    CORRECT:   SUM(oi.freight_value) / NULLIF(SUM(oi.price), 0) AS freight_to_price_ratio "
    "    INCORRECT: AVG(oi.freight_value / NULLIF(oi.price, 0)) AS freight_to_price_ratio "
    "  TOP-N QUERIES — CRITICAL: for 'highest N', 'lowest N', 'top N', 'bottom N' questions, you MUST use a ranking CTE: "
    "    WITH ranked AS (SELECT ..., RANK() OVER (ORDER BY metric DESC) AS rnk FROM ...) SELECT ... FROM ranked WHERE rnk <= N. "
    "    NEVER use bare LIMIT N — it silently drops tied rows at the boundary and produces non-deterministic results. "
    "  FILTER RELEVANCE: only add WHERE conditions that are directly relevant to the question. "
    "    Do NOT add timestamp or date filters on queries that have no time dimension. "
    "    Do NOT add order_status filters unless the user asks to exclude cancellations or specific statuses. "
    "  TEMPORAL REFINEMENT — CRITICAL: phrases like 'for a single month', 'for any month', 'in [period]', "
    "    'last month', 'this year', 'show it for [period]' are TIME FILTERS on the existing analysis — "
    "    they are NOT requests to collapse the breakdown into one aggregate number. "
    "    When refining time scope you MUST: "
    "    (a) Remove the date/month column from GROUP BY and SELECT (the period is now a filter, not a dimension). "
    "    (b) Add a WHERE clause: WHERE month_col = (SELECT MAX(month_col) FROM ...) for 'any/most recent month'. "
    "    (c) Keep every NON-TIME GROUP BY dimension intact (e.g. category, state stay in GROUP BY). "
    "    (d) NEVER use LIMIT N as a substitute for a time filter — LIMIT caps row count, it does NOT filter to one period. "
    "    WRONG: CTE aggregates all months, outer query adds LIMIT 100  ← still spans many months "
    "    WRONG: SELECT ROUND(SUM(freight)/NULLIF(SUM(price),0),2) AS ratio  ← 1 row, all dimensions gone "
    "    RIGHT:  WITH base AS (SELECT category, state, SUM(freight)/NULLIF(SUM(price),0) AS ratio, "
    "              DATE_TRUNC('month',ts) AS month FROM ... GROUP BY category, state, month) "
    "            SELECT category, state, ratio FROM base "
    "            WHERE month = (SELECT MAX(month) FROM base) ORDER BY ratio DESC "
    "    chart_type for single-period category×dimension grid → 'heatmap' (not multi_line — there is no time axis). "
    + ANSWER_SHAPE_RULES
)


def chat_sql_system(exhibit_grammar: bool = False) -> str:
    """The quick-path SQL system prompt. `exhibit_grammar=True` swaps the chart
    vocabulary/rules to the one-measure-per-exhibit grammar — combo is no longer offered,
    so a dual axis can only come from the renderer's deterministic gate. The /ask path
    always passes True; False composes the exact legacy prompt byte-for-byte
    (`CHAT_SQL_SYSTEM`), which the benchmark and custom-agent quality paths still use."""
    if exhibit_grammar:
        return _CSS_HEAD + _chart_vocab_grammar() + _CSS_MID + _CHART_MULTI_GRAMMAR + _CSS_TAIL
    return _CSS_HEAD + _CHART_VOCAB_LEGACY + _CSS_MID + _CHART_MULTI_LEGACY + _CSS_TAIL


CHAT_SQL_SYSTEM = chat_sql_system(False)

CHAT_PROMPT = """\
DATABASE SCHEMA:
{schema}

{metrics_section}{conn_kb_section}{exploration_section}{document_section}{sql_examples_section}{kb_patterns_section}{history_section}QUESTION: {question}

Write a single SELECT query using ONLY tables and columns that are explicitly listed in the schema above.
NEVER invent column names — if a column is not in the schema, it does not exist.
If a table is annotated "⚠ No date/timestamp columns", do NOT reference any date column on it — join to a table that has one.
IMPORTANT: Always use the exact table names as shown in the DATABASE SCHEMA above. When a table name includes a schema prefix (e.g. ecommerce.orders), use the full qualified name. When no schema prefix is shown, use the bare name.
IMPORTANT: Wrap any computed decimal/rate/ratio column with ROUND(..., 2). Never return raw floats from division or aggregation.
MULTIPLE METRICS: when the user asks for two or more metrics in the same question (e.g. "order count AND average delivery time"), 
return BOTH metrics as separate numeric columns in the same SELECT. Do NOT pick only one.
NUMBER FORMATTING: return all numeric values as raw numbers (e.g. 0.15, 15.2). NEVER format them as strings with % signs (e.g. "15.2%") 
in the SQL — formatting belongs in the headline, not the query result. String-formatted numbers break charts and aggregation.
Use the detected join paths when joining tables.
If the question references previous results ("also", "add", "filter by", "compare to", "instead of", "show X instead", "change to", "replace with", "for a month", "for any month", "for a single month", "in [month/year]", "last month", "this year", "show only", "narrow to", "just for"), start from the previous SQL and modify it — do NOT write a new query from scratch.
TEMPORAL NARROWING — CRITICAL: when the user asks to restrict the time period ("for a single month", "for any month", "in [period]", "last month", "this year", "show it for [period]"), that is a TIME FILTER — NOT a new aggregation. You MUST:
  1. Take the previous SQL as the base query.
  2. REMOVE the date/month column from GROUP BY and SELECT — it is now a filter, not a dimension.
  3. Keep every NON-TIME GROUP BY dimension intact (e.g. product_category AND customer_state stay in GROUP BY).
  4. Add a WHERE clause to lock the period. A period named from today ("yesterday", "last month", "this year") is the dates the TODAY line gives, on the person's clock — never the data's latest month; if the data holds no rows for it, say so. Only "any month" or "the most recent month in the data" locks to WHERE month_col = (SELECT MAX(month_col) FROM ...).
  5. NEVER use LIMIT N as a substitute for a time filter — LIMIT caps row count, it does NOT restrict to one period.
  6. chart_type for a single-period category×dimension result → 'heatmap' (no time axis left, so multi_line is WRONG).
  WRONG: CTE aggregates all months, outer query adds LIMIT 100 → still spans many months, multi_line shows flat useless lines
  WRONG: SELECT 0.15 AS ratio → one number, all dimensions gone
  RIGHT: WITH base AS (SELECT category, state, SUM(freight)/NULLIF(SUM(price),0) AS ratio,
           DATE_TRUNC('month',ts) AS month FROM ... GROUP BY category, state, month)
         SELECT category, state, ratio FROM base
         WHERE month = (SELECT MAX(month) FROM base) ORDER BY ratio DESC
When the user asks to change a metric (e.g. "show percentage instead of count"), modify the SELECT clause to compute the new metric in SQL and REMOVE the old metric column. The transformation must happen inside the query, not just in the headline. Do NOT return both the old and new metric — only the one the user asked for.
If a BUSINESS DEFINITION is provided above, use it exactly — do NOT substitute your own interpretation of the metric.
CHART TYPE — pick the type that matches the data shape and the user's intent:

COMPARISON (categories vs each other, no time):
  bar / bar_horizontal  →  1 categorical + 1 numeric, ≤ 15 categories. Default for any "top N / by X" question. Horizontal orientation.
  bar_vertical          →  ONLY when user says "column chart" or "vertical bar".
  scatter               →  2 continuous numerics — correlation or outlier detection.

TREND OVER TIME:
  line                  →  1 date + 1 numeric, NO category column. Pure single-series trend.
  multi_line            →  1 date + 1 category (any number of series) + 1 change/delta metric.
                            Period on X axis, delta % on Y axis, one line per category value.
                            Use for ALL period-over-period questions regardless of category count.
                            SQL must return the change metric explicitly (mom_change_pct, yoy_delta, etc).
                            Example: MoM revenue change by state → multi_line, X=month, Y=mom_change_pct.
  area                  →  Like line but shaded fill; best for cumulative volume over time.

MULTIPLE METRICS (two different measures for the same categories):
  combo                 →  1 categorical + 2 numerics with DIFFERENT units or scales.
                            Bars for the primary metric (left y-axis), line for the secondary (right y-axis).
                            Use ONLY when metrics have different units or wildly different scales.
                            Example: state-wise sales AND AOV → combo, bars=sales, line=AOV.
                            SQL shape: SELECT category_col, metric1_col, metric2_col.

COMPOSITION (parts of a whole):
  pie                   →  ≤ 6 categories summing to 100%. Use ONLY for share/proportion with very few slices.
  treemap               →  > 6 categories, proportional area. Better than pie for many slices.
  stacked_bar           →  1 group + 1 segment (≤ 5 unique values) + 1 numeric. Shows total AND composition.
                            SQL shape: SELECT group_col, segment_col, numeric_col.

TWO-DIMENSIONAL GRID (rarely needed):
  heatmap               →  Use ONLY when the user explicitly asks for a heatmap or pattern exploration.
                            PREFER multi_line for any temporal question — lines show trends better than a colour grid.
                            NEVER for change/delta/growth metrics.
                            SQL shape: SELECT date_col, category_col, numeric_col.

HARD RULES (never break these):
  • stacked_bar segment > 5 unique values           → use heatmap
  • line with a category column present             → use multi_line or heatmap
  • pie with > 6 categories                        → use treemap or bar
  • bar on a time sequence                         → use line, multi_line, or area
  • heatmap for MoM / YoY / WoW / % change / delta → NEVER. These are COMPARISON questions.
      Use bar (single period, ranked by change magnitude) or multi_line (≤ 10 series, change trend over time).
"""


WRITE_SQL_PROMPT = """\
You are a SQL expert. Translate a query intent into a single SQL SELECT statement.

TARGET DIALECT: {dialect}

HYPOTHESIS: {hypothesis_description}

QUERY INTENT:
{intent_description}

Tables to use: {intent_tables}
Filters (WHERE conditions): {intent_filters}
Aggregation (GROUP BY + metric): {intent_aggregation}

SCHEMA:
{schema}

{pitfall_section}{sql_examples_section}{ontology_actions_section}RULES:
1. Write exactly ONE SELECT statement. No DDL, no DML.
2. Use ONLY tables and columns listed in the SCHEMA above. NEVER invent column names.
   IMPORTANT: use the exact table names as shown in the SCHEMA. When a table name includes a schema prefix (e.g. ecommerce.orders), use the full qualified name. When no schema prefix is shown, use the bare name.
3. Qualify every column with a table alias when joining multiple tables.
4. Use the target dialect's date/time functions. Common differences:
   - DuckDB: DATE_DIFF('day', a, b), DATE_TRUNC('month', col), CURRENT_DATE, strftime('%Y-%m', col)
   - PostgreSQL: EXTRACT(EPOCH FROM (a - b))/86400, DATE_TRUNC('month', col), CURRENT_DATE, TO_CHAR(col, 'YYYY-MM')
5. Wrap decimal/ratio columns with ROUND(..., 2).
6. Prefer result sets under 50 rows — add ORDER BY and LIMIT as appropriate.
7. If a table is marked "⚠ No date/timestamp columns", join to a table that has one instead of adding a date filter directly.
8. If an ACTION:name() token is listed in the ontology section, you may use it in the query — it will be expanded before execution.
9. NULL-SAFE FILTERS: col NOT IN (...) silently passes NULL rows — always pair with AND col IS NOT NULL.
10. WINDOW FUNCTIONS: never repeat the same LAG/LEAD/RANK expression more than once — compute it in a CTE first, then reference the alias.
11. RATIO METRICS — CRITICAL: ratio-of-aggregates (freight-to-price, cost ratio, return rate by value, spend share) MUST use
    SUM(numerator) / NULLIF(SUM(denominator), 0). NEVER AVG(x/y) — it is statistically wrong for group-level ratios.
    CORRECT:   SUM(oi.freight_value) / NULLIF(SUM(oi.price), 0) AS freight_to_price_ratio
    INCORRECT: AVG(oi.freight_value / NULLIF(oi.price, 0)) AS freight_to_price_ratio
12. TOP-N QUERIES — CRITICAL: use RANK() OVER (ORDER BY metric DESC) in a CTE, then WHERE rank <= N.
    NEVER bare LIMIT N — it silently drops tied rows at the boundary.
13. FILTER RELEVANCE: only add WHERE conditions directly relevant to the hypothesis. Do NOT add timestamp/date filters
    on queries with no time dimension. Do NOT add order_status filters unless the hypothesis requires excluding specific statuses.
"""

FIX_SQL_PROMPT = """\
A SQL query failed during a data investigation. Rewrite it so it works.

TARGET DIALECT: {dialect}

ORIGINAL QUERY:
{sql}

ERROR MESSAGE:
{error}

{error_diagnosis}
SCHEMA:
{schema}

{kb_patterns_section}{metrics_section}
CRITICAL RULES (violating these causes repeated failures):
1. NEVER invent column names. Every column in your fixed query MUST appear verbatim in the SCHEMA above.
   If the original query used a column like `invoice_date` that is NOT in the schema, do NOT keep it —
   find the correct column from the schema, or join to another table that has it.
   IMPORTANT: use the exact table names as shown in the SCHEMA. When a table name includes a schema prefix (e.g. ecommerce.orders), use the full qualified name. When no schema prefix is shown, use the bare name.
2. If the error is "does not have a column named X", look up X in the SCHEMA and use the real name.
   If no equivalent column exists anywhere, rewrite the query to avoid needing it.
3. If a table has "⚠ No date/timestamp columns" in its schema comment, do NOT add a date filter on
   that table directly — join to another table that has a date column instead.

Fix the query for the target dialect. Common issues to watch for:
- Column names: copy exact column names from the SCHEMA — never guess or invent
- Date/time arithmetic: in Postgres use EXTRACT(EPOCH FROM (a - b))/86400 for day differences, not direct subtraction
- NULL handling: wrap nullable columns with COALESCE or add IS NOT NULL filters
- Type casting: Postgres requires explicit CAST() for type coercion
- Interval syntax: Postgres uses INTERVAL '30 days', not date arithmetic shorthands
- String functions: dialect differences (e.g. STRFTIME vs TO_CHAR)
- Ambiguous columns: if a column exists in multiple joined tables, qualify it with the table name

Return the corrected query and a one-sentence explanation of what was wrong.
If the error reveals a data quality problem in the underlying data (not just a SQL syntax issue),
describe it in data_quality_issue — e.g. "order_purchase_timestamp has NULL values for ~15% of rows".
"""


