# What OpenDashboards teaches us — a study, and the work it leads to

**Studied 2026-11-15.** [thesysdev/opendashboards](https://github.com/thesysdev/opendashboards) at `bd278a1`
(2026-11-13, a week-old MIT repo), and the three packages that do its real work, read from their published tarballs:
`@openuidev/dashboard-library@1.0.1` (the components and the rules a model writes a dashboard by),
`@openuidev/server@0.4.0` (the interpreter that runs a dashboard's queries, and dashboard create/edit) and
`@openuidev/lang-core@1.1.0` (the language and its validator). Compared against Pramanyx `main` at `95e921a`.

Every claim about our own code below was read in the file it cites, on that commit. Where the first reading was wrong
it is corrected in place, because two of the four learnings changed shape once measured (§3.2, §3.3), and the chart
gap is far smaller than it looked (§4.1).

---

## 1. What OpenDashboards is

"Ask any question, get a live dashboard." A thin Next.js app; most of the product is a hosted service (OpenUI Cloud).

1. **A chat agent** — a plain tool loop, up to 24 rounds (`lib/agent/index.ts`). It lists the person's connections,
   reads their tables, runs queries to check the numbers are real, then calls `create_dashboard` or `edit_dashboard`
   with a prompt in plain words.
2. **The hosted service writes the dashboard** as a small program in OpenUI Lang and stores it:

   ```
   root = Dashboard([filters, lead, trends])
   $range = "30d"
   totals = Query("postgres_query", {sql: "SELECT sum(revenue) AS revenue ... WHERE " + during}, {rows: []})
   now = @First(totals.rows)
   filters = FilterBar([DateRangeFilter($range, [...]), CompareToggle("Previous period", true)])
   lead = Section("", [Kpis([Kpi("Revenue", now.revenue, "currency-compact", prev.revenue)])])
   ```

   Variables (`$range`), bound queries (`Query(tool, args, default)`), reading a column across rows
   (`totals.rows.revenue`), built-ins (`@Sum`, `@First`, `@Filter`), and a fixed library of 45 components.
3. **Live on every open.** The browser runs the program; each `Query` goes back to `/api/interpreter`, which runs that
   tool against the person's connection (`app/api/interpreter/route.ts`).
4. **Sources** share one contract (`lib/sources/types.ts`): Postgres, MySQL, ClickHouse, BigQuery, PostHog, GA4,
   Search Console, and any MCP server. A tool says which callers may use it (`"agent"`, `"dashboard"`).

### 1.1 What it does not have, and what not to copy

- **No semantic layer, no governed metrics, no provenance.** Every number is a SELECT a model wrote. Ours are cards
  made only from approved metrics, approved trusted queries or findings; the model writes no SQL
  (`pramanyx/dashboards/propose.py`).
- **The interpreter runs whatever the browser names.** `createInterpreter` in `@openuidev/server` dispatches any
  registered data tool with any arguments the request carries, as long as the dashboard id is the caller's
  (`if (Object.hasOwn(tools, input.name)) return await dispatch(input.name, args)`). The query in the stored program
  is not the query that runs; a person can send any SELECT to their own connection. A read-only transaction is the
  only bound. **Not to be copied:** our card runs its own stored, guarded SQL.
- **Dashboards and chats live in the vendor's cloud**, and the data behind each answer goes there. For us that is at
  most an organisation's setting, off by default.
- **Its validator checks structure only** (§4.4). Its "validated output" claim does not reach a chart drawn wrongly
  from valid structure.

### 1.2 Where we are already ahead

| | OpenDashboards | Pramanyx |
|---|---|---|
| Where a number comes from | SQL a model wrote, re-sent by the browser | a card: an approved metric, trusted query or finding, run through the guard battery |
| A dashboard's history | overwritten in the vendor's store; delete is permanent | a Ledger artifact, superseded, draft and published (`pramanyx/dashboards/versions.py`) |
| A model's edit | the service rebuilds the part that changed | RFC 6902 patches against a version, all-or-nothing, re-validated; refused if the dashboard moved on |
| A spec that cannot be checked | "autofix" repairs it on the vendor's side | refused: `not_checked`, nothing kept (`pramanyx/dashboards/validate.py`) |
| A figure in a model-written title | not checked | refused (the numerals law, `validate.py`) |

---

## 2. The four learnings at a glance

| # | Learning | What we had | Status |
|---|---|---|---|
| L1 | A filter nothing reads is refused | only the other direction was checked | **Built** on `claude/unread-dashboard-values` |
| L2 | Every figure knows which way is good | the metric already declares it; tiles ignore it; the agent guesses from names twice | To build |
| L3 | Keep the last figures while reading | old figures stay on screen but are not said to be old; the slowest card holds back all | To build, adapted |
| L4 | The agent reads what each piece draws before editing | one grammar text for everything | To build, small |

---

## 3. The four learnings

### 3.1 L1 — a control nothing reads is refused

**Theirs.** The generation rules say: *a filter whose `$variable` nothing reads does nothing: leave it out*, and *a
literal there leaves the filter disconnected, so clicking it changes nothing*.

**Ours, measured.** We checked one direction only: a query reading a value the dashboard does not hold
(`variables.unheld`), and a value read from a query that is not placed or reads itself (`variables._queries_unread`).
Nothing refused a value the **reader** sets on the page — a control in the values bar, or a what-if slider — that no
query and no set reads. The reader moves it, nothing changes, and they learn the figures do not depend on it. That is
the "withheld is implied" failure in another form.

**Built.** `variables.unread(spec, card_ids)` (`pramanyx/dashboards/variables.py:38`) says, for each value whose
`from.by` is `"reader"`, when no placed card's SQL names it as `{{name}}` and no set's condition compares with it:

> The reader sets "Region" on the page, and nothing on this dashboard reads it: no query names {{region}} and no set
> compares with it. Moving it would change nothing. Read it in a query or a set, or take it away.

Where it is asked, and why there:

- **When a model's dashboard is kept** (`versions.keep`, `written_by_model=True`, `versions.py:400`) — the
  OpenDashboards case.
- **When any dashboard is published** (`versions.publish`, `versions.py:453`) — a control that does nothing never
  reaches readers. Unpublishing is never refused.
- **Not on a person's hand edit in the builder.** Every builder change is kept through the same door within a
  second (`BriefingDashboards.tsx` `keepSoon`), and a value is unread from the moment it is added until it is wired;
  refusing there would break building step by step.
- **Not for a value the author sets** — it is never drawn on the page — nor one counted, summed or read, which is a
  figure of its own.

**Proof.** Two tests in `tests/unit/test_dashboard_variables.py`: the sentence and its exclusions, and the keep and
publish doors with a real store. Each door was disabled in turn and the test failed on its assertion, not by raising.
The function was also run on a real 12-card dashboard read over HTTP from a running install: it says nothing as the
dashboard stands, and the sentence above once an unread control is added. None of the 18 dashboards that install's
default person holds, across seven connections, has a reader's value, so nothing published there is newly refused.

**Left open, named:** a value read only by a set that no piece reads is still, in effect, dead. That is the dead
*set* question, which wants its own check through `readersOf` (`web/lib/dashboards/sets.ts:305`), not a widening of
this one.

### 3.2 L2 — every figure knows which way is good

**Theirs.** Every `Kpi` takes `goodWhen: "up" | "down" | "neutral"`; the rules say set `"down"` for costs, CAC, churn,
latency and errors. A change is coloured by whether it is good news, not by its sign.

**Ours, measured — the premise was wrong.** The first reading said we have no direction. We do: a governed metric
declares `target_direction` — `'higher'`, `'lower'`, or empty for a band (`pramanyx/semantic/metrics.py:132`), beside
`target_value` and the warning and critical distances (`:125`). Three readers ignore it:

1. **The dashboard tile.** `moveColour` (`web/components/dashboards/DashboardTile.tsx:141`) colours a change only from
   a card's own limit; with no limit every change is grey.
2. **The agent's ranking**, `opportunity.metric_lower_is_better` (`pramanyx/agent/opportunity.py:84`) — a name scan
   for cost-like words.
3. **The agent's investigation**, `loss_signals.higher_is_worse` (`pramanyx/agent/loss_signals.py:527`) — a second
   name scan, with its own word list.

One concept, three spellings, two of them guesses. This is the "one store per concept" bug again.

**And the field is empty.** On a running install, none of theLook's 15 metrics sets `target_direction` (measured over
HTTP, 2026-11-16). Reading the declared field colours nothing until people set it, so the change below must come with
a way to set it where a metric is approved, and the name scan may *suggest* a direction there for a person to confirm.
It is never a fact until a person says it.

**The change.**

- The tile reads the metric's `target_direction` for a card made from a metric: higher → up is green, lower → down
  is green. A card's own limit, where set, still wins (it is the person's nearer word).
- An empty direction stays grey, and the tile says nothing it does not know — a band has no good direction.
- Both name scans read the declared direction first and fall back to the scan only when it is empty; the fallback is
  said where its answer is shown ("read as lower-is-better from its name").
- No model sets a direction. A person sets it on the metric, where it is already a field.

**Done when:** a metric with `target_direction='lower'` whose value fell shows green on a dashboard with no card
limit; the same with `'higher'` shows red; an empty direction shows grey; a test pins each, and both agent paths are
tested taking the declared direction over a name that says the opposite.

### 3.3 L3 — keep the last figures while reading, and say they are the last

**Theirs.** Their PR #18, "show a dashboard's last results while it reloads"; their PR #19 moved the loading pill to a small
capsule at the bottom so it never covers the filters.

**Ours, measured — narrower than first reported.** On a range change the page does not go blank: the cards already
drawn stay until every new run has finished, then all change at once (`BriefingDashboards.tsx:839-861`,
`Promise.all` then `setCards`). Three real gaps:

1. **The old figures are not said to be old.** For a few seconds the page shows the previous range's figures under
   the new range's label. That breaks our rule that a page prints only its period's own figures.
2. **The slowest card holds back every other.** One 20-second query delays eleven 1-second ones.
3. **A card that reads a value goes blank** whenever the value changes (`ComposedDashboard.tsx:781-782`,
   `reading: true` with no prior result).

**The change, adapted to our rule.**

- While a card reads, it keeps its last figure **dimmed, with the range or value it is for said on it** ("Jan–Mar ·
  reading Apr–Jun"). Never undimmed under the new label.
- Each card arrives as it finishes; the page's "reading" mark is one quiet line or capsule that never covers the
  values bar.
- A value-reading card keeps its last run the same way, said as "for Region = EU".

**Done when:** with one card slowed artificially, the others update first; the slow one shows its old figure dimmed
with its old range said, then its new one; a value change does the same for a value-reading card; a test pins that no
figure is drawn undimmed under a range it was not read for.

### 3.4 L4 — the agent reads what each piece draws before it edits

**Theirs.** `read_dashboard` returns the stored program **and** the library's own description of each component the
program uses (`componentsUsed`, `lib/agent/index.ts`), so the model knows, say, that a `GeoMap` is a map with a ranked
list before changing it.

**Ours, measured.** `options` (`pramanyx/dashboards/propose.py:551`) already returns the current spec and version —
our read-before-edit — plus the whole grammar as one text (`how_to_write_one`). It does not single out the pieces the
current spec uses.

**The change.** Add `pieces_used`: for each element type in the live spec, its description from the catalog
(`web/lib/dashboards/catalog.ts`, through the validator bundle that already serves `grammar()`). Small, and it puts
the most relevant part of a long grammar where the model reads first.

**Done when:** `options` for a dashboard holding a `ProcessBoard` and an `ObjectChart` carries exactly those two
descriptions, a test pins it, and the descriptions come from the catalog, not a second copy.

---

## 4. More kinds of chart

### 4.1 What we draw today — measured

The first reading undercounted. There are three chart surfaces, and they are not equal:

| Surface | Kinds | Where |
|---|---|---|
| **Answer charts** (one engine, Vega-Lite; raw Vega for four) | line, multi-line, small-multiples, area, bar, grouped-bar, stacked-bar, delta-bar, scatter, heatmap/matrix, pie, treemap, counter, funnel, histogram, boxplot, sankey, waterfall, pareto, line-forecast (with a band), gantt, choropleth, point-map, table — plus reference lines | `web/components/charts/chartTypeInference.ts:36`, `vega/forms.ts:50`, `vega/tier3.ts`, `vega/resolveSpec.ts:762` |
| **Dashboard cards from findings and trusted queries** | the whole answer engine above (`ResultChartCard`) | `web/components/dashboards/DashboardTile.tsx` `RowsTile` |
| **A person's own query card** | table, figure, bar, line, area, scatter | `pramanyx/dashboards/queries.py` `SHOWN`, `web/lib/dashboards/queryChart.ts` |
| **Object pieces** | ObjectFigure, ObjectChart (bars per day), ObjectBreakdown (table or bars), ObjectMap, ObjectTimeline, ObjectTable | `web/lib/dashboards/catalog.ts` |
| **Tiles** | figure (with previous), trend (sparkline), rows | `DashboardTile.tsx` |

`tier3.ts` records that the ledger shows **zero uses** of treemap, sankey, funnel and gantt. Having a kind is not the
same as it being chosen: a new kind must come with the question it answers, or it joins that list.

### 4.2 Their 45 components, mapped

| Group | Theirs | Ours |
|---|---|---|
| Structure | Dashboard, Section, Row, Card | Cockpit, Tabs, Section, Card — **have** |
| Filters | FilterBar, PeriodPicker, DateRangeFilter, ChipFilter, SelectFilter, MultiSelectFilter, SearchFilter, CompareToggle | range, reader values (choices, lists, sliders), ObjectFilters, ObjectSearch, ChooseOne, QueryFilters — **have**; compare is always on, **no toggle** |
| Metrics | Kpis, Kpi, Trend, Stat, KeyValues, KeyValue | figure and trend tiles, ObjectFigure, ObjectDetail — **have**; the change has **no good direction** (L2) |
| | Goal, Progress | **missing** — yet the metric carries `target_value`, `target_direction` and two thresholds |
| | Split, States | **missing** (a compact part-of-whole strip; counts by state) |
| Tables | Table, Column (badge, number, primary) | ObjectTable, rows table, row marks in tones — **have** |
| Trends | TimeSeries, Series, SmallMultiples | line, area, multi-line, small-multiples, line-forecast — **have** |
| | Reference | answers **have**; dashboard query cards **missing** |
| | Marker (events on a time axis) | **missing** |
| | StatusTimeline (up/degraded/down over time) | **missing** |
| Comparison | Bars, Distribution | bar family, histogram, boxplot — **have** |
| | Leaderboard (ranked, with previous and direction) | **missing**; ObjectBreakdown is close but has no change column |
| | Dumbbell (before → after per category) | **missing**; delta-bar shows the change, not both ends |
| | Intervals (estimates with uncertainty) | **missing**; only line-forecast's band |
| Composition | Donut, Treemap, Waterfall | pie, treemap, waterfall — **have** |
| | SegmentedBar | **missing** (stacked "shares" is near) |
| Flow | Funnel, Flow | funnel, sankey — **have** (zero uses) |
| Relationships | Scatter, Heatmap | **have** |
| | Cohorts (retention triangle) | **missing** |
| Maps | GeoMap, PointMap | choropleth, point-map, ObjectMap — **have** |

### 4.3 What to add, in order

Ranked by the business question each answers, and by what we already hold that makes it honest.

| # | Kind | The question it answers | Why now | Built on |
|---|---|---|---|---|
| C1 | **One vocabulary for every card** — a person's own query card draws any kind the answer engine draws | "show my query as a waterfall" | the cheapest gain: 6 kinds → 24, no new chart written; one vocabulary instead of two | `resolveSpec` behind `queryChart` |
| C2 | **Figure strip with good direction** — 3–6 headline figures, change coloured by L2 | "how are we doing" | every dashboard leads with it; L2 makes it honest | figure tile + `target_direction` |
| C3 | **Goal / progress (bullet)** — value against the metric's target, warning and critical bands drawn | "are we on target" | the target, direction and thresholds are already governed fields; nothing draws them on a dashboard | `metrics.py:125-135` |
| C4 | **Cohorts** — retention by signup cohort, a triangle | "do customers come back" | the first question of any subscription or repeat-purchase business; no current kind can draw it | heatmap encoding, cohort-shaped rows |
| C5 | **Leaderboard** — ranked top-N with previous and change | "who/what moved" | compare already runs on every card | ObjectBreakdown + compare |
| C6 | **Dumbbell** — before and after per category | "where did it change most" | the compare window gives both ends; delta-bar loses the levels | bar family |
| C7 | **Reference lines and event markers on dashboard charts** | "against what" / "what happened then" | answers have reference lines; dashboards do not; markers can read decisions and releases already in the ledger | `exhibit.ref_lines` |
| C8 | **Intervals** — estimates with their uncertainty | "how sure is that forecast" | the scenario band and conformal floor already compute intervals; nothing draws them as such | scenario bands |

Later, when a question asks for them: StatusTimeline (a connection's health over time), SegmentedBar, Split/States.

### 4.4 Rules that come with every new kind

Borrowed from their generation rules where they match ours, and kept as ours where they do not:

- **Choose by the question, then the chart.** Trends (over time) · comparison (across categories) · composition
  (part of a whole) · flow (between stages) · relationships (two measures) · maps (by place). Extends
  `docs/CHART_SELECTION_GUIDE.md` §2, which should be updated beside the first new kind (it still names the ECharts
  builders the Vega engine replaced).
- **One unit per chart.** Already ours (no dual axes).
- **Numbers raw, with a format.** Never a formatted string ("$1.2K") as data.
- **A previous value is the same measure, one period earlier, in the same unit — never invented, never the current
  value repeated.** Theirs is a prompt rule; ours should be a check where compare runs.
- **Arrays that go together have the same length and order.** A check, not a hope.
- **One engine.** A new kind is added to `resolveSpec` / `forms.ts` / `tier3.ts`, as Vega (the headless renderer
  draws Vega only), with no colour literal, and drawn by every surface — never a second chart library for dashboards.
- **Each kind ships with its question,** in the chart-type inference and in the dashboard grammar, or it is not
  offered.

### 4.5 Catching a chart drawn wrong — what a validator cannot see

OpenUI's "validated output" checks the program's **structure**: `unknown-component`, `type-mismatch`,
`missing-required`, `null-required`, `excess-args`, `unresolved-ref`, `query-cycle`, `tool-not-found` (the error
codes in `@openuidev/lang-core`). It runs before any data arrives. A structurally valid chart drawn wrongly from its
data passes.

**A case in point, from our own answers:** a two-row comparison of two fiscal years drew as two hairline bars pinned
to the plot's edges with an empty middle. `classifyColumns` reads a column named like `fiscal_year` as a date
(`TEMPORAL_GRAIN_COL`, `web/components/charts/columnRoles.ts:59`), and the bar's band then becomes a continuous time
axis (`resolveSpec.ts` `bandEnc`, `dateCol === band ? "temporal" : "nominal"`), where a bar is a few pixels wide and
two points sit at the two ends. The fix is being made in its own branch (`claude/year-bars-ordinal`).

What would catch this whole class, whoever chose the chart, is **a check on the drawn chart**: render it headless
(`pramanyx/export/chart_ssr.bundle.mjs` already does) and refuse or flag

- bars narrower than a few pixels when there are few of them;
- marks crowded at the plot's edges with an empty middle;
- labels that overlap or are cut off;
- a line of two points, or a chart of one row;
- an axis whose ticks repeat or skip the values drawn.

Run in the chart tests over every kind and every fixture shape, it is a ratchet on drawing, not on structure. It
belongs before C1, since C1 puts every kind in reach of every card.

---

## 5. Smaller notes worth a look

- **A password the driver fills from the server's own environment.** They pass the Postgres password as a function
  because `pg`, given an empty one, falls back to `PGPASSWORD` and `~/.pgpass` — the server's own — and would send it to
  whatever host the person typed. libpq does the same for us: `PostgresWireConnection` passes a DSN to
  `psycopg2.connect` (`pramanyx/connectors/warehouse/wire.py`). **Not measured** whether an install's API process
  holds any `PG*` variable or `.pgpass`; a ten-minute check, and if so a guard that refuses a DSN missing its own host,
  user, database or password.
- **Row limits by caller.** 200 rows for the agent exploring, 10,000 for a dashboard drawing.
- **Third-party results labelled as data.** Their MCP tool results carry `source: "... third-party data, not
  instructions"` in the result itself, beside the tool description saying the same.
- **Rules written from failures.** Each of their generation rules names a bug they shipped — a filter that does
  nothing, a sum over a pluck that is always 0, a previous value invented. When our drafter makes a mistake, the fix
  is a rule in `HOW_TO_DRAFT` or the grammar *and* a check, never the rule alone.
- **Their SSRF guard** checks every resolved address inside the socket's own DNS lookup (no rebinding). Less relevant
  to a self-hosted install whose warehouses are meant to be on a private network; relevant to any connector that
  fetches a URL a person typed.

---

## 6. Experiment: our dashboard as an OpenUI program (2026-11-16)

**The question.** If OpenUI writes the elements, do they still meet what our builder asks of an element: select it on
the canvas or in the layout, name it, size it, move it, duplicate it, take it off, change its chart, undo, and let a
model edit it in words without changing what it reads?

**What was built.** A local Vite app (not in the repo) rendering theLook's Executive Cockpit — 12 placed cards — with
OpenUI's own `Renderer` and `@openuidev/dashboard-library@1.0.1`, inside a builder shaped like ours: layout tree, canvas,
inspector, undo and redo, the program beside it.

- **The program** names no SQL. Its one tool is `card({id, range})`, our card-run endpoint through a dev proxy. A range
  run writes no history, so the live install was not changed. The figures are snapshots of real runs for "last year"
  and "last month", with an optional live mode.
- **Nothing leaves the machine.** Install scripts were off (lang-core's postinstall sends an install ping unless
  `DO_NOT_TRACK` is set). Runtime telemetry is opt-in. react-lang's development-only Inspect widget, which can load
  code from a CDN, was replaced by a stub. The page made no request off its own origin.
- **Every builder edit rewrites one statement** and merges it with OpenUI's `mergeStatements`, the same call a model's
  edit goes through, so the same edits work on a program a model wrote.

**What fits our editability, measured in the running mock:**

| Our builder does | On an OpenUI program | Verdict |
|---|---|---|
| A layout tree of every piece | each element is a named statement; the parser returns a tree with `statementId` | fits |
| Select on the canvas ↔ the tree | components receive their `statementId`; a hidden marker before each piece maps a click back (a wrapper breaks the library's child-selector CSS — tiles collapsed to 48px) | fits |
| Name, describe, format | rewrite one argument, merge | fits |
| Move up/down, duplicate, take off | rewrite the parent's list; `mergeStatements` collects what nothing reaches | fits — **a move must be one patch**: taken off first, the merge collected the card and its query before it was re-added (caught in the mock) |
| Move to another section | one patch over both rows | fits |
| Change the chart | Bars ↔ Leaderboard ↔ Donut ↔ Table over the same reads, live | fits for kinds that share a data shape; each kind has its own positional signature, so a general switch needs a mapping per kind |
| Undo, redo, versions | the program text is the version | fits |
| A model's edit in words | the model sends statements; ours refused one that rewrote `qRevenue` ("never changes what a piece reads") and merged one that set `goodWhen` | fits, with our check in front |
| Width 3–12, height per card, drag to resize | six named widths (quarter … full); height per **row** only (240–640) | **loses precision** |
| Tabs | no Tabs component: our four tabs became four sections | **missing** |
| Notes, images, questions, findings, object pieces, action buttons, sets | none exists in the library | **missing** — each would be our own component registered into it |
| A card's doors (refresh, edit, "why this number", its source footer) | a Card has a subtitle, no footer or doors | **missing** |
| Full width | the dashboard caps at 1440px | conflicts with our rule; overridable |
| Figures said for their period while reading | on a period switch the old figures stayed at full strength under the new period until the new ones landed | **same defect as ours** (L3) |

**Verdict.** Editability is not the obstacle: an OpenUI program is as editable as our spec, element by element, and its
named statements with merge-by-name are a clean unit for both a person's edit and a model's. What it lacks is our
vocabulary — tabs, pieces, notes, questions, card doors and free sizing — and taking it "entirely" would remove those
features, which a redesign may not do.

Two ways forward, cheapest first:

1. **Borrow their components, keep our spec.** Wrap the chart kinds we lack (C3–C8: goal, cohorts, leaderboard,
   dumbbell, intervals) as pieces inside our Card frame, drawn by their components or rebuilt in our Vega engine. No
   change to the builder, the validator or the Ledger.
2. **OpenUI Lang as the format, with our components registered.** OpenUI supports a library of one's own; our pieces,
   tabs and card frame would be registered into it, and the validator, the numerals law and the wiring checks ported
   to statements. The gain is a format models write cheaply and a native per-element edit; the cost is a second
   migration of every stored dashboard. Not justified while our model edits are small patches already.

### 6.1 Our pieces registered into OpenUI (2026-11-16)

The second way was then tried in the same mock. Our own components, imported unchanged from the web app, were
registered into an OpenUI library with `defineComponent` and zod props, beside OpenUI's content components (their
`Dashboard`, `Section` and `Row` left out):

- **Cockpit, Tabs, Tab, Section**: our structure. A section is our grid (`GRID`: 12 columns of 28px rows), and each
  piece is placed at its own `w` (3–12) and `h` (rows).
- **Tile**: our `DashboardTile`, fed by OpenUI's `Query("card", …)`, which now returns our own card record and run.
- **Note**: our `NoteTile`.

All 12 cards rendered under OpenUI's `Renderer` with our own words and controls: "45.1% higher than 2024 · not at
equal age", "Approved metric", the card limits ("Past its limit: at or below $86 · alerting"), and the brand finding
drawn by our Vega engine. The console showed no errors.

**What changed from §6, measured:**

- **Sizing is ours again.** The tile's own size picker ("Wide · 2×1") rewrote `tRevenue = Tile(qRevenue, 8, 6)`; the
  inspector's Width and Height do the same.
- **Our pieces' own controls write the program.** The note's own editor rewrote its `Note(...)` statement. The tile's
  "Take off this dashboard" removed it, and its query was collected (37 → 35 statements; the card stays in the card
  store). Undo brought both back.
- **Tabs are ours** (Radix, from `components/ui/tabs`), and a tile moved from the Sales tab to the Margin tab as one
  patch.
- **A model's patch** was held to our rule exactly as in §6: one that rewrote `qRevenue` was refused, one that resized
  `tReturn` merged.
- **Their pieces still mix in.** OpenUI's Leaderboard card and period picker stood on our grid. But their styles live
  on their root (`Dashboard` draws a style-class context and root classes), so our Cockpit has to draw their root
  inside it: a coupling to their 1440px cap and refresh capsule.

**What it took to run our code outside Next:**

- one React for both (`dedupe`);
- the `@/` alias to the web app;
- Tailwind scanning our sources;
- Radix's `dark` class on `<html>` — `--bg-2` is `var(--gray-3)`, which is resolved at `:root`;
- a `process.env` shim for the API base.

None of it needed a change to our components.

**Still to prove:**

- **Object pieces, action buttons and sets.** Our renderers for them are internal to `ComposedDashboard` and lean on
  its contexts (`DashboardContext`, `PiecesProvider`, the json-render state store). Each would need exporting, plus an
  adapter of about 20 lines.
- **Our rules** (`rules.ts`: wiring, sizes, the numerals law) read our spec, not statements.
- **The defect from L3 remains with our tiles too:** last year's figures stood under "Last month" until the new run
  landed.

**What the experiment suggests** (an inference, not measured): our spec and an OpenUI program are nearly the same
shape. Both are a flat map of named elements, each with a type, props and lists of child names: element key ↔
statement name, `type` ↔ component, `props` ↔ arguments. A converter either way is mechanical. That opens a third
way, cheaper than both above: **let a model write OpenUI Lang, convert it to our spec, and keep our validator,
renderer and Ledger.** It buys the token efficiency of their format without a migration.

### 6.2 The board we want, mocked on our own engine (2026-11-16)

**The goal, in the user's words:** an interactive and editable dashboard. Each card's chart type, labels and
aggregation can be changed. A click on a bar filters the whole dashboard. Cards rearrange freely and the rest adjust.
Vega-Lite runs everywhere, for one consistent look. And the SQL behind every card is a click away. Of the two mocks
above, OpenUI's cards felt subtler than our conversion.

**What was built.** A board page (`board.html` in the same local mock) for theLook, 2025:

- **The data:** one extract, month × department × category × channel, 2,041 rows. It was read month by month through
  `/dashboards/queries/preview` (read-only, guarded, nothing kept). Its revenue equals the approved metric revenue v4
  for 2025 to the cent ($2,000,975.86).
- **Every card's chart is our `ResultChartCard`,** the investigation chart, with its editor.
- **Their card look,** measured off their rendered dashboard and drawn on our tokens:
  - a fill one step off the page, a 4% hairline and a soft two-layer shadow;
  - 20/24 padding, a 14/600 title over a 12px subtitle at half strength;
  - figures at 26/600 with tight tracking.

  Corners stay ours.
- **The layout:** a 12-column grid of 28px rows (our `GRID`), in `react-grid-layout`.

**What works, each tried in the page:**

- **A click filters the board.** A bar ("Search"), a treemap tile ("Suits") or a point sets a filter chip, and every
  card is recomputed. The card clicked keeps all its marks, with the chosen one lit through our exhibit's `emphasis`.
  Two filters combine; a chip's × or "Clear all" takes them off. Revenue went $2M → $1.4M (Search) → $154K (Search ·
  Jeans).
- **A card the filters cannot cut says so.** The approved inventory_sell_through_rate reads inventory items, which
  carry no channel, and the card says "Not cut by channel: inventory items carry none. Shown for all of 2025." It never
  wears the filter in its subtitle.
- **The SQL behind every card.** The card's `</>` opens the statement that computes it from the warehouse's own
  tables, with the board's filters in it (but not its own). "Run it in the warehouse and compare" ran it read-only:
  "Matches the warehouse: 12 rows, every value equal (1.7 s)".
- **What a card asks:** measure, grouped by, top N, and aggregation (sum, per item, share of the total). Revenue by
  category became average item price and re-ranked; the SQL followed.
- **An approved metric's aggregation is its definition.** A ratio measure (gross margin, return rate) shows "a ratio
  of sums, as its definition says — not re-aggregated".
- **How a card is drawn:**
  - chart type (bar, line, area, pie, treemap, table) and axis title, from the board's inspector;
  - colour, labels, tooltip, transform and reference lines, from our own "Edit visualization" panel, exactly as on an
    investigation's chart.
- **Move and resize.** A card dragged by its header to the top-left; the cards it displaced moved down and the rest
  followed.
- **Every measure says where it stands.** Revenue reproduces the approved metric. Gross margin (51.83% here, 51.87%
  approved) and return rate (11.6% here, 9.9% approved) are computed here and say so. The extract leaves out cancelled
  lines and those two metrics keep them: **an extract for cross-filtering must be built from each metric's own
  definition, or its figures drift from the approved ones.**

**What it found that the real build must fix:**

1. **The engine's click contract.** Our raw-Vega charts (treemap, sankey, funnel, gantt) rename their columns, so a
   clicked treemap tile reports `name`, not `category`. `emphasis` is not applied there either. `onSelect` must say
   which field a mark stands for, on every tier.
2. **"Adjust intelligently" is more than vertical packing.** `react-grid-layout` packs cards upward and leaves holes
   beside a moved card; the top right stood empty after the drag. A packer that fills holes and keeps a row's heights
   aligned is ours to write.
3. **One inspector, not two.** Our "Edit visualization" docks over the board's inspector. The two become one panel:
   *What it shows · Chart · SQL*.
4. **Where a card's question lives.** A person's own query card already keeps how it is shown (`queries.py`
   `SHOWN`, `AGGS`, `BUCKETS`, `SEGMENTS`) but draws only 6 kinds (§4.1, C1). Its `shown`, the investigation chart's
   `VizConfig` and this board's question (measure, group by, aggregation, top) are one concept in three places, and
   should become one.
5. **Cross-filtering in production is server-side.** The mock filters one extract in the browser. On the platform,
   each card is re-asked with the filters: through the semantic layer for a metric (its declared `dimensions`), or
   narrowed for a person's own query. A card that cannot be cut says so, as above.

### 6.3 The board, built into the platform (2026-11-16)

The user chose ours over OpenUI's own ("Ours is better.. lets go"). Two decisions came with it: **CLARITY.md's no-shadow
rule stays**, and cards **move by drag-to-reorder with dense packing**, not free x/y, so the spec format is unchanged.
Everything below is on `claude/unread-dashboard-values`, with nothing behind a flag.

| Step | What is built | Where |
|---|---|---|
| S1 | **The card's look.** A quieter muted title (13/500, `--t2`) and 26/600 figures with tight tracking, on our hairline, with no shadow. Recorded in CLARITY.md "Surfaces on a ground". | `DashboardTile.tsx` `Frame`, `Title`, `FigureTile`, `QueryTile` |
| S2 | **Drag to reorder.** A grip on each piece in the builder only, with a marker where it lands and Escape to cancel; Alt+Shift+arrows from the keyboard. A move is one change (undo and versions as before). Sections pack densely, so holes fill. | `ComposedDashboard.tsx` `MoveGrip`; `lib/dashboards/edit.ts` `moveTo` |
| S3 | **The click contract.** A click reports the result's own column and value on every kind. The four hand-written Vega kinds are mapped back (`pickOf`), dates come back as their ISO day, and axis, legend and title clicks pick nothing (`clickedDatum`). The chosen value lights on every kind, tier 3 included, and the rest recede. | `charts/selection.ts`, `vega/emphasis.ts`, `forms.ts`, `tier3.ts`, `resolveSpec.ts` |
| S4 | **Every chart card can draw any kind** (narrowed). A person's own query keeps `queryChartSpec` as its default drawing, which preserves its tones, Other, shares and labels. Any other kind the investigation chart draws is chosen from the card and drawn by `ResultChartCard` from the query's points as a result grid. | `DashboardTile.tsx` `isOtherKind`, `queryGrid`; `CardInspector.tsx` `QueryKindPick` |
| S5 | **One inspector: What it shows · Chart · SQL.** The Chart tab holds the card's own investigation-chart editor, docked in the panel. The SQL tab shows the statement **as it ran**, with its bound values beside it, never pasted in. Every run returns `ran {sql, params}`. | `PieceSetup.tsx`, `CardInspector.tsx`, `VizEditorPanel.tsx` `docked`; `routers/cards.py` |
| S6 | **A click filters the dashboard, server-side.** Details below. | `dashboards/focus.py`, `routers/cards.py`, `lib/dashboards/focus.ts`, `ComposedDashboard.tsx` `FocusBar` |
| S7 | **Seven new kinds, for the questions §4.3 named:** lollipop, leaderboard (C5), dumbbell (C6), slope, bullet (C3), cohort (C4) and interval (C8). Each is Vega-Lite, offered only when the result has its shape, with no colour literal. | `forms.ts`, `chartTypeInference.ts`, `ChartTypeToggle.tsx` |

**How S6 works.**

- **What a click stands for is read off the card's own statement, never guessed.** `POST /cards/{id}/field` traces the
  column through `sql.lineage`, against the connection's columns as the query page reads them. A column the statement
  does not name the table of (`SELECT country … JOIN customers`, `SELECT *`) is still traced. The trace refuses, by
  name:
  - a column worked out rather than read;
  - a count or a constant;
  - a column read from two places;
  - a column whose table cannot be told.

  A click on any of these filters nothing, and a toast says why.
- **The focus is the reader's own,** kept per dashboard in their browser and never in the dashboard. It holds at most
  six values, and each shows as a chip.
- **Every card is asked again with it,** except the card it was chosen on, which keeps its marks and lights the
  chosen one.
  - **A card of its own SQL:** each table it reads is replaced by itself filtered to the value. sqlglot writes the
    value as a literal; it is never pasted in.
  - **A metric card:** measured as itself, cut by one value of a column on the table its dates are on
    (`run_measure(by=, part=)`).
- **Every run says whether it was cut:** `cut {applied, by, why}`. A card that could not be cut wears `NotFiltered`
  with the server's reason, for example "Not cut by traffic_source = Email: the metric is measured on order_items, not
  events." A focused figure is never recorded as the card's standing value.

**Proof.**

- **Tests:** 21 focus tests on the server, one of them sent as the dashboard sends it (a range, `compare` and the focus). The full suite caught the run route naming its range's cut statement and the focus verdict alike, which broke every run with a range; it is fixed, and that test now holds it. On the web, the dashboard, chart and board tests: 1,058 pass.
- **Mutation tests:** every guard was broken on purpose, 16 on the server and 14 on the web. Each made a test fail by
  its assertion, never by the mutant raising. Two refusals and one web guard first survived, and are now tested:
  - the two-places refusal;
  - a one-source column, which is now accepted, since the statement ran;
  - a helper field named as the chart's dimension.
- **Live, read-only on theLook, through the running API's guarded preview:**
  - **The click:** "Email" on *Unique Users by Channel* traced to `events.traffic_source`, certain.
  - **The one card cut:** *Session-to-Purchase Conversion Rate*, cut to Email for October 2026, read **0.6025111009033839**.
    Hand-written SQL over `events` gives the same value.
  - **The rest:** the other ten Executive Cockpit cards were not cut, and each said why.

**What the live run found: on theLook a channel cuts almost nothing.**

- Ten of eleven cards are measured on `order_items`, `orders` or `inventory_items`, and none of those carries a
  channel. The mock cut revenue by channel because its extract had joined `users.traffic_source` in.
- On the platform, that needs **a cut through a join**: `order_items.user_id → users.id`, filtered by
  `user_id IN (SELECT id FROM users WHERE traffic_source = …)`, taken from the declared relationships. Until then the
  cards say so honestly, and the cross-filter is narrow.
- `events.traffic_source` (a session's source) and `users.traffic_source` (how a customer first came) are also two
  different things. A join-cut must say which one it used.

**Not done yet:**

- **The model's chart vocabulary.** The new kinds are not in it yet (`chart_vocab.py`, with prompt tests).
- **L2–L4.**
- **The UI on the user's own servers.** Their servers run the live checkout, which does not carry this branch.

## 7. Order of work

| Step | What | Size | Status |
|---|---|---|---|
| L1 | A reader's control nothing reads is refused | S | built, tested, on `claude/unread-dashboard-values` |
| — | Hairline year bars | S | PR open: amit-kamlapure/pramanyx#22 (`claude/year-bars-ordinal`) |
| L2 | Good direction from the metric; one reader of it | M | — |
| L4 | `pieces_used` in `options` | S | — |
| L3 | Last figures kept, dimmed and said; cards arrive as they finish | M | — |
| §4.5 | Drawn-chart check over every kind | M | — |
| C1 | One vocabulary for every card | M | built for a person's own query card (S4, §6.3); the model's vocabulary still to come |
| C2–C3 | Figure strip with direction; goal / progress | M | bullet built (S7); the strip after L2 |
| C4–C8 | Cohorts, leaderboard, dumbbell, reference and markers, intervals | M each | cohort, leaderboard, dumbbell, interval built (S7); reference and markers to come |
| §6.3 | The board: look, drag to reorder, click contract, inspector with SQL, cross-filtering | L | built, tested, proven read-only on theLook, on `claude/unread-dashboard-values` |
| — | Cut through a join (a channel cuts revenue) | M | next: the live run found 1 of 11 cards cut |

Each step merges whole, on, with its proof on live data before its PR; nothing behind a flag.
