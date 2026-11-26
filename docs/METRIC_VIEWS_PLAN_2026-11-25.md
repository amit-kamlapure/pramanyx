# Metric views parity — the plan (2026-11-25)

The user, 2026-11-25, sharing Databricks' [metric views](https://docs.databricks.com/aws/en/uc-semantics/metric-views/):
"Also, check this" — then, shown the comparison, "Yes for the metric-view parity plan". Their four calls are in §3.

The comparison in one line: Databricks' metric model is stronger — a metric there is structured and can be grouped by
any field of any joined table, composed from other metrics and windowed, all declared; ours is stronger at vouching for
a metric (its formula run against the data, an owner's approval, figure gates, quality and freshness checks, cohort
time). This plan takes their model and keeps our vouching.

## 1 · What a metric view is, in one paragraph

A Unity Catalog object, written in YAML (`version: 1.1`), that separates **measures** (aggregate expressions) from the
**fields** they are grouped and filtered by. Top-level keys: `source` (a table, another metric view, or SQL), `filter`
(always applied), `joins` (each `name`, `source`, `on`/`using`, `cardinality` `many_to_one` (default) or `one_to_many`,
nested for a snowflake; `rely.at_most_one_match`), `fields`, `measures` (an aggregate; may reference earlier measures as
`MEASURE(name)`, also across metric views; a `window` list: `order`, `range` — current, cumulative, trailing/leading N
unit, all — `offset`, `semiadditive` first|last), `parameters`, `materialization`. Every field and measure may carry
`display_name`, `format` (number, currency with an ISO code, percentage, decimal places, compact), `synonyms` (up to
10, fed to Genie) and a `comment`. It is queried as `SELECT field, MEASURE(m) FROM mv GROUP BY ALL` — grouped by any
field at query time — from SQL, notebooks, AI/BI dashboards, Genie, alerts, JDBC/ODBC and BI tools (Tableau
pass-through, Power BI, Sigma, Excel, Sheets). Joined measures from sibling one-to-many joins are aggregated apart and
blended, so they never cross-multiply. Materialization pre-aggregates on a schedule and rewrites queries onto the
rollups. Relationships *between* metric views (Beta) are metadata for AI and BI tools, not enforced.

## 2 · What we already have (measured 2026-11-25, code read, three defects checked by hand)

| | Metric views | Ours | Verdict |
|---|---|---|---|
| The definition | YAML: source, filter, joins, fields, measures | `MetricDefinition` (`semantic/metrics.py:96-195`): since 2026-09-26 its `sql` must be one **whole SELECT** (`semantic/metric_statement.py`, enforced `routers/metrics.py:532-547`); `tables`, `filters` ignored for a statement | **Behind**: a statement is opaque to every compiler |
| Group by any field | `GROUP BY` any field, joins applied | `/metrics/{name}/value` returns one number (`routers/metrics.py:1497-1559`). The v1 compiler is single-table and its output only a hint (`semantic/compiler.py`). The Briefing breaks down by the first table's columns only, and skips statements (`briefing/edition.py:163-166`) | **Behind** |
| Joins | Declared per metric view, with cardinality | Declared once, in the ontology's links, with **measured** cardinality (`ontology/models.py:560-612`, `ontology/cardinality.py`); the object compiler groups through to-one links and pre-aggregates to-many ones (`semantic/object_query.py`), but refuses approved catalog metrics with a grouping and statements outright (`:1946-1949, 1982-1984`) | **The pieces exist**, not wired to metrics |
| Measures from measures | `MEASURE(a) / MEASURE(b)` | None: a ratio is hand-written SQL. The object compiler has `divide_by` (two aggregates) | **Behind** |
| Window measures | cumulative, trailing, offset, semiadditive first/last | An engine for every one of them exists (`ontology/window_measures.py`) but serves object time series only. Metrics get previous-period and last-year comparison at equal age (`briefing/ranges.py`) and an expected-next range | **The engine exists**, not wired to metrics |
| Display metadata | display_name, format, synonyms, comment | `label`; `unit` is free text parsed by guesswork in four places; `caveats`. No synonyms on a metric — they live in the vocabulary store (`subject_kind="metric"`, `ontology/vocabulary.py:47-58`) and on Definitions. A `FormatSpec` exists with no route and no reader (`vocabulary.py:101-115`) | **Behind**, partly built |
| Governance | UC permissions, ownership, lineage | Lifecycle draft → proposed → approved → deprecated; approval refused on figure gates and twins; an edited approved metric goes back to proposed; dry-run on save; `verified` by execution; owner; quality and freshness checks; cohort time. No per-metric permission; old SQL versions not kept | **Ahead**, one gap (versions) |
| Speed | Materialization, query rewrite | A 1-hour result cache by SQL hash (`db/matcache.py`), Briefing cache | **Behind** (out of this plan, §3) |
| From outside | JDBC/ODBC, BI tools | REST and MCP (`get_metric`, one scalar) | **Behind** (out of this plan, §3) |
| Interchange | YAML is the format | Import of dbt, LookML (one view), Power BI (to Definitions); export of our own YAML bundle only (`intake/bi_models.py`, `intake/engine.py:495-526`) | **Behind** |

**The bar a compiled path has to meet.** The chat's `query_objects` tool — the object compiler, exposed to the model —
was deleted after it lost to model-written SQL on our golden sets: 10 of 16 against 16 of 16 on LuxExperience
(`agent/converse_tools.py:358-362`). A metric engine reaches answers only where it matches or beats the model's own
path on the same questions (§4.5).

## 3 · The user's calls (2026-11-25, the question tool; each the recommended option)

1. **A metric is structured.** New metrics are written as source + filters + measure expression + dimensions, so any
   dimension can group them. Existing statements are split where they cleanly can be (`sql/metric_filter_guard.measure_of`
   already splits a single-table statement); a statement stays allowed, and says it cannot be grouped.
2. **Joins come from the ontology.** One store of joins: a metric names its source, and any column reachable through
   the ontology's measured to-one links can group it. A metric may pin a path where two exist. No copy of joins on
   each metric.
3. **Outside access later.** An SQL/BI endpoint (JDBC, `MEASURE()`) and materialization are their own plan, once the
   engine is proven inside the platform. The result cache stays.
4. **Metric view YAML in and out.** Version 1.1 is imported (beside dbt, LookML, Power BI) and exported, mapped onto
   the structured metric; whatever does not map is said, never dropped.

## 4 · The design

### 4.1 The structured metric

`MetricDefinition` gains a structured form beside `sql`:

- `source`: an ontology entity, else a table (the connection's, schema-qualified).
- `filters`: always applied (exists; read again for a structured metric).
- `measure`: one aggregate expression over the source and what its links reach (`SUM(sale_price)`,
  `COUNT(DISTINCT order_id)`), or a composition of other metrics (§4.3).
- `dimensions`: what it may be grouped by — named, or *every* column reachable through to-one links, the default.
- `time_column` / `time_kind` / `time_grain`, `until_column`, `outcome_column` — as today.
- `window` (§4.4), `display_name` (today's `label`), `format`, `synonyms`, `description` (today's `caveats`).
- `path`: the link path to pin where two exist.

A statement-form metric keeps working everywhere it does today, and says *cannot be grouped: it is one whole query*
wherever a grouping is asked of it. Migration splits a statement into the structured form only where `measure_of`
splits it exactly and the split computes the same figure (checked by running both); anything else stays a statement.

**Versions are kept.** Every save of a metric's definition is a version (*supersede, do not delete*), so an approved
metric's earlier formula can be read and restored.

### 4.2 One metric engine

`metric × dimensions × time grain × window × filters → SQL`, compiled deterministically on top of what exists:
`object_query`'s compiler (measured to-one joins, to-many pre-aggregation, `divide_by`, fiscal grains, cross-source
reads) and `window_measures.compile_measure`. Joins come from the ontology's links only; a to-one link whose measured
cardinality says otherwise is refused, a to-many one is pre-aggregated, and two paths with no pinned one are refused
with both named. **Coverage-gated:** it compiles when every reference resolves, and otherwise says why — the caller
falls back to the model's own path, as the compiler does today. Exposed as `POST /metrics/query` (metric, `by`,
`grain`, `window`, `filters`, period).

### 4.3 Metrics from metrics

A measure may be `MEASURE(revenue) / MEASURE(orders)`: each is compiled at the grain asked and then combined — never
inside one aggregate, so a ratio never cross-multiplies. Cycles are refused. Its unit and format are derived where they
can be (currency ÷ count is currency; a count ÷ a count is a ratio) and said where they cannot.

### 4.4 Windows

A metric's `window`: `cumulative`, `trailing N day|week|month|year`, `offset` (the period-over-period figure), and
`semiadditive: first|last` for a stock read at a period's edge — compiled by the existing window engine. The Briefing's
and the dashboards' equal-age comparison keeps working, and reads a declared offset where one is declared.

### 4.5 Where it is used, in order

1. **Dashboards**: a card from a metric is grouped by any dimension, in its own query, deterministic.
2. **The Briefing**: breakdowns by any dimension, not only the first table's columns; statements still say why not.
3. **MCP `get_metric`**: `by`, `grain`, `window` — the coworker gets the figure the platform computes, scoped to the
   connection asked (§6, defect 2).
4. **Answers**: the answer path offers a metric query where a question is a metric by dimensions, **only once the engine
   meets the bar** — on the golden sets (LuxExperience, theLook) the engine's answers must match or beat the model's own
   path on the metric-by-dimension questions, measured before it is switched on and kept as a ratchet after.

### 4.6 Metadata

- `format` on the metric: number, currency (ISO code), percentage, decimal places, compact — the existing `FormatSpec`,
  given a route and read by the web's number formatting in place of the four guesses at `unit`.
- `synonyms` live in the **vocabulary store** that already holds them (`subject_kind="metric"`) — one store, edited
  from the metric's page — and are read by `metrics_named_in` (the answer path's matching) and Discover's search.
- `additivity` says one thing: may this be summed across groups and periods. Today the editor and the backend read it
  differently (§6, defect 5).

### 4.7 Metric view YAML

Import maps `source` → source, `filter` → filters, `fields` → dimensions, `measures` → metrics (a measure referencing
measures → §4.3), `window` → window, `display_name`/`format`/`synonyms`/`comment` → the same. `joins` are **proposed as
ontology links** (call 2) for a person to accept, with the YAML's cardinality as the claim and the platform's
measurement as the check. Export writes the same shape from a structured metric, its joins read from the links its
dimensions go through. `parameters`, `materialization` and `rely` are said as not taken, by name.

## 5 · Phases

Each is shown working on theLook (and LuxExperience for the golden bar) before the next, with its tests and the gates.
No feature flags.

| | What | Size |
|---|---|---|
| **M0** | **Defects** (§6) fixed, and **the bar measured**: the model's accuracy today on the golden sets' metric-by-dimension questions, written down | S |
| **M1** | **The structured metric** (§4.1): the model, the editor's fields, versions kept, the migration that splits statements where it exactly can, and "cannot be grouped" said for the rest | M |
| **M2** | **The engine** (§4.2) and `POST /metrics/query`; dashboards' metric cards and the Briefing's breakdowns grouped by any dimension | L |
| **M3** | **Metrics from metrics and windows** (§4.3, §4.4) | M |
| **M4** | **Metadata** (§4.6): format, synonyms, one meaning of additivity | S |
| **M5** | **Answers and the coworker** (§4.5 items 3-4), behind the golden bar | M |
| **M6** | **Metric view YAML** in and out (§4.7) | M |

## 6 · Defects found while planning

Checked by hand (2026-11-25):
1. `semantic/canonical.py:41-47` loads the metric catalog with `list_metrics()` and no connection, and the governed set
   is then de-duplicated by name: another connection's metric of the same name can be the one used.
2. The coworker's `get_metric` (`mcp/client.py:636-653`) ignores the connection it is given and takes the first metric
   of that name from `/metrics`.
3. `rbac/owners.py:164` reads `connection_id` from a metric; the field is `connection`, so every metric's owner is
   listed with no connection.

Found by the code read, to confirm in M0:
4. The v1 compiler pastes a statement-form metric's `sql` inside its own SELECT, which cannot parse (`compiler.py:97, 218`).
5. `additivity` means "may period figures be summed" in the editor (`MetricsPanel.tsx:1088-1094`) and only "share of
   total across groups" in the backend (`semantic/metrics.py:116-121`).
6. `FormatSpec` has no route and no reader.
7. An approved metric's earlier formula is not kept anywhere but the ledger's event text.
8. The ontology's copy of a metric can override the catalog's SQL (`semantic/metrics.py:1247-1249`): two stores.

**M0, 2026-11-26** (the user: "Yes, start M0"). Measured first: on the live install, 7 metric names are defined on more
than one connection — `units_sold` is theLook's `COUNT(id)` and LuxExperience's `SUM(oi.quantity)` — and where both
formulas run on one schema the name dedupe kept whichever came last in the store.

- **1–3 fixed** (`tests/unit/test_metric_views_m0.py`, each test red before its fix):
  - 1: the canonical resolver AND the answer's semantic context (`semantic/context.py`, the same read and the same
    "metrics are global" comment) read the connection's own metrics through `list_metrics`' scoping (its own · its
    organisation's · the install's); the schema filter still runs on what is left.
  - 2: `get_metric` reads `/metrics?connection_id=`; a name more than one connection defines, asked without one, is
    said, not settled by the list's order. The MCP tool says to give the connection.
  - 3: the owner list names each metric's own connection ("" for one every connection reads) and lists only the
    connections in view, their organisation's and the install's — it had listed every organisation's metrics too.
    Its old test built its metrics with the same wrong field the code read, so the two agreed.
- **4–8 confirmed by reading**, left to their phases:
  - 4 (→ M1/M2) is wider than written: 70 of the 71 live metrics are statements, so the compiler's named-metric path
    builds `SELECT SELECT …`, the transpile fails and it falls back in silence — the v1 compiler never uses a governed
    metric on this install.
  - 5 (→ M4): the editor and the intake mappers say "period figures may be summed"; the one backend reader
    (`metrics.is_additive`) uses it for share-of-total across groups.
  - 6 (→ M4): `vocabulary.set_format` / `format_for` have no caller.
  - 7 (→ M1): approving bumps `version`; neither the row nor the audit keeps the earlier formula.
  - 8 (→ M2): a verified ontology formula replaces the catalog's SQL in `_ontology_corrections`.
- **Found while fixing, for M2's one engine:** ten other readers call `list_metrics()` with no connection —
  `routers/investigations.py:342`, `tools/schema_linker.py:218`, `learning/knowledge.py:382`,
  `agent/spotlight_act.py:581`, `agent/nodes.py:86`, `agent/investigate.py:11390`, `ontology/keys.py:215`,
  `intake/engine.py:512`, and `components/registry.py:533` and `automations/palette.py:197` when they are given none.
  Each is a name list, a count or a schema-filtered set today; M2's engine is the one reader they move to.
- **Not yet:** the bar — the model's accuracy on the golden sets' metric-by-dimension questions — costs model calls
  and waits for the user's go-ahead. (Measured in M5, below.)

**M1–M6, 2026-11-26** (the user: "Complete until M6"), each on `claude/metric-views-m0`, shown on theLook:

- **M1** — the structured metric (`semantic/metric_structure.py`): `source`, `measure`, `filters`, `dimensions`,
  `window`; `sql` composed on save; every saved version kept (`metric_definition` on the Ledger) and restorable;
  statements split into parts only where the figure is identical — 19 of theLook's 23, each figure checked equal.
- **M2** — one engine (`semantic/metric_engine.py`) on the object compiler, joins only through the ontology's links;
  `POST /metrics/query`, the Metrics row's Grouped tab, the dashboards' `MetricBreakdown` piece. Revenue by user
  country: 16 groups summing to 9,173,377.25.
- **M3** — metrics from metrics (`MEASURE()` parts, joined on one plain key column — BigQuery refused a null-safe FULL
  JOIN) and windows (cumulative, trailing, offset, first/last). `revenue_per_item` by month equals the hand ratios.
- **M4** — the format declared once (`FormatSpec`, `PUT /metrics/{name}/format`), the words people call it (the one
  synonym store, read by matching and Discover search; a model's proposal is not), one meaning of additivity.
- **M5** — `query_metric` on the answer path and the coworker's `get_metric` grouped — offered only where the bar is
  met (`evals/metric_bar.py`, the Ledger's `metric_engine_bar:<conn>`, nightly where allowed). **Measured on theLook's
  9 golden metric-by-dimension questions:** run 1, 7 right without the tool and 6 with it — but the tool sent no
  result frames, so one answer was graded on a 2,000-row exploration (fixed: its result goes out as `run_sql`'s does,
  with a receipt). Run 2, 7 and 7 — and the tool was **called on none of the nine**: the conversation handed every
  question to `answer_question`, which does not see it. A tie of answers that never called it now does not meet the
  bar, so it is **not offered**. For the engine to reach answers it must be offered where metric questions are
  actually answered (`answer_question`'s core), and measured there — the next step, not built.
  LuxExperience's bar waits for its database.
- **M6** — metric view YAML (version 1.1) in at the Import tab's file door and out from the Metrics list
  (`intake/metric_view.py`): measures, filters, fields, windows, format, synonyms, comments; joins proposed as links
  (the YAML's cardinality the claim, the data's count the check); what does not map said by name. Expressions go out
  in the view's SQL and come back in the connection's. theLook: 5 documents, 19 measures; read back, all 19 mean what
  they meant (18 the same text, one `DATE()` written as `CAST(… AS DATE)`); 5 not written, each said why.

**After the merge, 2026-11-26** (the user: "Work found during the run, not built" — all of it), on
`claude/metric-answers`:

- **The engine where answers are made** (`agent/governed_metric.py`). The answer core writes its SQL in one shot, so a
  question naming a governed metric written as parts is handed that metric compiled for it — by the dimensions it
  names, over the period it names, by a grain it asks — as its starting point, where the bar is met. Whether the answer
  started from it (its statement, or its measure and every filter kept) is said on the stream and the receipt, and the
  bar counts it. **Measured:** theLook 8 right with it, 7 without, the engine used — met; LuxExperience 7 and 7, used
  twice, both right — met. Offered on both.
- **One reading of "the last N days"** (`kernel/clock.period_named`): the N whole days ending yesterday, said in every
  prompt — two answers to one eval had read it as 27 Oct–25 Nov and 28 Oct–26 Nov.
- **Context evals** grade a metric by the data's word too: an answer giving the governed metric's figure for the period
  passes; the receipt's formula check leaves quotes and table qualifiers aside (it read the engine's own `COUNT(t0.id)`
  as departing from `COUNT(id)`). theLook: **15 of 21** (5 in the morning). LuxExperience: 6 of 25, then a refusal found
  and fixed — "“Session Conversion Rate” is not present in this data" on a connection that governs it (answer
  resolution now spares a noun naming a governed metric).
- **A composed metric groups by what its parts reach**, not a path spelled alike in each.
- **The Briefing breaks a metric written as parts down by a dimension one link away** (`link.column`), through the link
  the engine traverses.
- theLook's 18 before-versions written back (the API stopped, one writer); LuxExperience's 21 of 43 metrics split into
  parts, figures identical on Postgres, each original kept; its golden questions, bound to a DuckDB copy that is gone,
  read as the connection reading their schema.

**The failing cases, gone through one by one (2026-11-26, `claude/answer-figures`).** Context evals: theLook 15 → 16
→ **18 of 21**; LuxExperience 10 → 19 → **23 of 25**. What the failures were, each fixed where it came from:
refusals naming words the conversation added in rewording ("“UTC.” is not present"); metrics read by their names
("placed to shipped", a share, computed as days — the starting point now says what a metric measures and which date its
period is counted by, and the metric is found in the person's own words first); a metric's own name read as its grain
("Daily Active Users" by day); metrics kept as statements answered from other tables (they are handed their own
statement too, cut to the period); undated metrics asked for a period; no figure for the period, said as none, graded
as a miss. And one answer printed theLook's dollars as euros: prose now names only a currency its figures carry.
Then the last five, gone through: the conversation had reworded a named metric away ("average dispatch lag" for
"placed to shipped") — the person's own words are answered when it does; a phrase to filter by ran across a sentence
("“LuxExperience. Include”") and "COGS" was folded to "cog"; and the conversation answered governed metrics as absent or
with its own SQL — it is now told, where the bar is met, that a named approved metric is present and which path starts
from its definition. **Final: theLook 20 of 21, LuxExperience 25 of 25.** The one left, "Daily Active Users", is the
definition's own: it counts distinct users over the period asked (30-day actives over 30 days), not a daily figure.
The cases follow one pattern ("What was X over the last 30 days?"); the scores show the mechanism, not every question.
The bar needs golden questions, which only theLook and LuxExperience have.

Known limits (before the round above, which lifted the first two): a composed metric groups only by dimension paths both its parts share by name; the Briefing guide's
dimensions are still the dated table's columns; theLook's first 18 splits kept no before-version (the originals are
in the session's scratchpad copy).

## 7 · Not in this plan

- **An SQL/BI endpoint and materialization** — the user's call 3; their own plan once M2 is proven.
- **Parameters** (a metric queried as a function with arguments) — dashboards' variables cover today's uses.
- **Per-metric permissions** — access stays the connection's, with row-level security inside it.
- **Relationships between metric views** — in Databricks metadata only; our ontology links are the one place joins live.
- **Blending sibling one-to-many facts** beyond what to-many pre-aggregation gives — later, if a real question needs it.

## Sources

Databricks docs, read 2026-11-25: [metric views](https://docs.databricks.com/aws/en/uc-semantics/metric-views/) (updated
2026-10-29), [YAML reference](https://docs.databricks.com/aws/en/uc-semantics/metric-views/yaml-reference),
[joins](https://docs.databricks.com/aws/en/uc-semantics/metric-views/joins) (2026-10-29),
[relationships](https://docs.databricks.com/aws/en/uc-semantics/metric-views/relationships) (Beta, 2026-11-11),
[advanced techniques](https://docs.databricks.com/aws/en/uc-semantics/metric-views/advanced-techniques),
[query](https://docs.databricks.com/aws/en/uc-semantics/metric-views/query),
[materialization](https://docs.databricks.com/aws/en/uc-semantics/metric-views/materialization),
[feature availability](https://docs.databricks.com/aws/en/uc-semantics/metric-views/feature-availability) (2026-11-09),
[BI tools](https://docs.databricks.com/aws/en/uc-semantics/metric-views/bi-tools) (2026-11-20),
[basic modeling](https://docs.databricks.com/aws/en/uc-semantics/metric-views/basic-modeling),
[UC semantics](https://docs.databricks.com/aws/en/uc-semantics/) (2026-11-09).
Our code: the paths cited above, read at `b8703bd`.
