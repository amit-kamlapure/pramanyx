# The Atlas, by Area — plan (2026-11-25)

The user, 2026-11-25: *"deep scan this [Genie Ontology], and tell me how we have it in our platform/coworker, how it
uses it and where it needs improvements.. also, we need to have a better representation of it.. currently Atlas is
restricted to modeled knowledge as per the connection only.."* Then, after the study: **"Plan and mockup".**

This plan is the answer to the second half. The study (§1) and the survey of our code (§2) set its scope; §3 is what
the Atlas becomes; §4 the work in order. The mockup is a private design canvas (link in §6).

---

## 1 · What Genie Ontology does that we do not (read 2026-11-25)

Sources: the docs (`genie/genie-ontology/` and its five sub-pages, `uc-semantics/` domains, Pages, certification), the
benchmark post (Nov 11: 91% vs 45% and 58%, less than half the tokens), the GA post (Nov 11), and the Ontology Manager
demo — 63 s, read frame by frame.

- **Two kinds of knowledge, one ranking.** *Modeled* (metric views, domains — our Areas — Pages — our Definitions —
  certification) and *learned* ("snippets": calculations, business rules, relationships, extracted continuously from
  dashboards, SQL query history, notebooks, Genie Agents and Power BI). OntoRank weighs source authority,
  certification, the people behind it, popularity and recency; modeled beats learned; unresolved, it asks.
- **Every object says how much it is used.** "Used in 6.2K Genie responses" on each Page, metric view and snippet;
  each snippet an authority of 1–5 ("higher scores reflect stronger usage and ownership signals").
- **The Ontology Manager is a map of domains, not of tables.** Domains as bubbles sized by use, the model's proposals
  dashed ("Inferred"); a rail of figures (conversations a month, the share that needed the ontology, *usefulness reach*
  — cited it — and *domain coverage*, top experts, most-referenced Pages and snippets); drill into a domain's
  subdomains; a subdomain fans out by kind with counts ("6 metric views · 16 pages · 5 certified assets · 259
  snippets · 2 agents · 2 MCP servers · 4 other assets"); each kind a list sorted by use; opened objects stay as tabs
  in a right panel; a box to "ask about or change your ontology".
- **Curation comes from use.** Each domain's Review queue, rolled up to its parent: *new page* ("115 people asked about
  this last month, but it only lives in a few chats as learned knowledge"), *coverage gap* ("96 questions/month"),
  *page edit* ("Genie learned 3 things about this from recent chats that the page doesn't cover yet"), *feedback
  hotspot*. A snippet's **Promote** drafts a Page that says where it came from and how many answers used it.
- **One layer for every agent**, through Genie MCP, gated by the reader's permissions.

## 2 · What we have (surveyed in code and measured live on 2026-11-25)

| Genie | Ours | What is missing |
|---|---|---|
| Metric views | Metrics registry (`semantic/metrics.py`), in every answer, MCP `get_metric` | not on the Atlas; uses not counted |
| Domains / subdomains, owners | **Areas** (`semantic/areas.py`, `OrgSettings.areas`): parent (5 levels), icon, Business and Technical contacts, curated on Discover | the Atlas's zones are another thing — `entity.domain`, the enricher's label (`lib/atlas/compose.ts:280`); no MCP tool for Areas |
| Pages | **Definitions** (`record/` claims of kind definition: draft → published, votes, comments) | per connection only; not on the Atlas |
| Certification | tag on table / document / dashboard / canvas (`govern/certification.py`) | coworker cannot see it |
| Snippets | **learned items** (`knowledge/learned.py`: answers, findings, usage, trusted queries — one shape) | `uses: None` — never counted; only MCP `read_learned` reads them (no page); not on the answer path as a set |
| Authority / OntoRank | `ontology/authority.py` (metric provenance only); `ontology/ranking.py` (imported by its test alone); four more orders | no one score; six rankers |
| Learned from dashboards, query history, BI | query-history mining is manual and off by default (`allows("read_query_history")`); BI files imported once (`intake/bi_models.py`) | our own dashboards, Data Canvases, saved SQL are never mined |
| Review queue | `knowledge/review.py` per connection: gaps, candidates, conflicts | not by Area across connections; no "asked by N" |
| Citations, considered vs chosen | receipt sources: metrics, tables, objects | Definitions, learned items, documents never cited; nothing recorded at answer time |
| The map | **Business Atlas**: one connection's entities and processes (`BusinessAtlas.tsx`) | nothing learned, no metrics, Definitions, Areas, use, or other connections |

**Measured live (theLook and the install, 2026-11-25):** 304 answers in the last 30 days (186 the 30 before; theLook
65); 18 Areas hold something, 10 are quiet, the model suggests 5 more across connections; 71 metrics (59 approved),
92 tables, **1 Definition**, 5 dashboards, 7 Data Canvases, 5 agents, 20 schedules, 9 documents, 6 sheets, 2 trusted
queries, 0 certified. theLook alone: 200+ learned items (165 answers, 35 findings) of which **147 sit in no Area**, and
5 of the first 200 repeat another word for word. **801 wait for review across the connections** (71 gaps, 664
candidates, 66 conflicts; theLook 94, PostgreSQL 391, Workspace 205, DuckDB 105), **534 of them in no Area**; by Area,
Orders & sales 105, Inventory 41, Payments 37, Clienteling & events 27, Marketing 21. Use is
measured only as **opens** (the Definition "Repeat buyer" opened 3 times; the dashboard "Sales Analysis" 3) and a
trusted query's guided answers (`thing.used`) — nothing counts the answers that drew on a metric, a Definition or a
learned item. theLook's Atlas draws 8 entities in zones named Inventory, Customer, Commerce, Catalog — none of them an
Area's name.

**Defects found on the way (each its own fix, listed so none is lost):**
1. MCP `list_findings` hands the coworker every explorer finding with the model's confidence — the 11-17 call was
   *findings confirmed only, everywhere* (`mcp/client.py:655` reads `/exploration/{c}/findings` unfiltered).
2. The same Area is named by each connection's package: theLook's and PostgreSQL's review queues say "Inventory &
   merchandising", "Payments & risk"; DuckDB's and Workspace's, Discover and the Semantic Layer say "Inventory",
   "Payments". An Area across connections needs one name.
3. theLook's learned list repeats itself: 5 of the first 200 word for word, and one restatement ("revenue for South
   Korea is now 519,924.80…") filed once under each of three answers.
4. `ontology/ranking.py` is on no path (its test alone imports it); `authority.py` reaches no answer. Read on 25 Nov:
   the ranker is the designed order A2 needs — a person's word over use over freshness, never edge evidence,
   ordering and never filtering — so it is kept for A2 to put on the answer path, not deleted.

## 3 · The Atlas, by Area

**The Atlas opens on the organisation's Areas, across every connection, with what people defined and what the
platform learned on one map, each counted by how much it is used.** Today's Business Atlas is not removed: it becomes
the *Relationships* view of the same page — inside an Area, its entities and process lanes, joined across connections
where the organisation's ontology joins them (a feature may move, never vanish).

### 3.1 The organisation (the opening screen)
- **Canvas.** One bubble per Area that holds something, sized by the answers that drew on it in the last 30 days
  (until those are counted: by what it holds — said on the canvas), its glyph, its name; the model's suggested Areas
  dashed and marked *Suggested*; *Everything else* small at the edge. Quiet Areas listed, not drawn. Zoom, fit,
  minimap. Two views on the title row: **Areas** · **Relationships**.
- **The rail (left).** Answers in the last 30 days and the change on the 30 before; **governed reach** — the share of
  answers that drew on an approved metric, a published Definition or a trusted query; **Area coverage** — the share
  placed in an Area; *who answers for it* — the contacts named most, and what each answers for; the most-used
  Definitions and metrics; the most-used learned items with their standing. A figure we do not count yet is shown as
  *not counted yet*, never as 0.
- **Tabs on the rail:** Overview · Review (count) · and, for an admin, Settings (where learned knowledge comes from:
  query history, dashboards, imports — each an organisation setting, off by default).

### 3.2 An Area
- Click a bubble: the canvas centres it, its sub-Areas radiate as a tree (a dashed one is suggested), and the selected
  Area **fans out by kind with counts**, the same counts Discover's Area card carries — metrics, Definitions, certified
  things, learned items, trusted queries, dashboards, Data Canvases, agents, documents, tables — each count a door.
- The rail becomes the Area's: its glyph and name, contacts (+ to add, the people picker), what it covers; its own
  Overview figures; its Review queue.

### 3.3 A kind, and an object
- A count's door lists that kind in the rail, **sorted by use** ("used in N answers · opened N times"), each with its
  state (approved, published, certified, deprecated) and the connections it comes from.
- Opening one adds a **tab to the right panel** — a metric (formula, source, dimensions, who owns it, where it is
  used), a Definition (its page, in place), a learned item (what it says, where it came from, its standing and why,
  the Areas it sits in, **Promote → a draft Definition** that says where it came from and how many answers used it),
  a table, a dashboard. Several stay open side by side.

### 3.4 Review, by Area
The review queue regrouped by Area across connections, rolled up to the parent Area, each item with its reason and
its weight: **new Definition** (a learned item many answers used and nobody defined — "used in N answers this
month"), **gap** (questions framed on no Definition — "N questions this month"), **Definition edit** (answers that
said more than the Definition does), **conflict** (answered N ways — Settle it), **thumbs-down cluster**. Accept /
Edit and accept / Reject; only a contact or an admin decides (as today).

### 3.5 Relationships
Today's Atlas, unchanged in what it draws, inside an Area: its entities (structures, records of activity), links and
process lanes. Zones are **Areas**, not the enricher's `entity.domain` — an entity's Area is where its tables are
placed (Discover's placement), and an entity in none is drawn aside and said. Across connections, the organisation's
ontology (`ontology/domains.py`) draws the joins it declares; nothing is joined that a person did not declare.

### 3.6 Asking about it
The box on the canvas asks *about* the map ("which Areas have no Definition?") through the same coworker every other
place uses (three places, one answer). Changing the map goes through its doors — a contact's or an admin's — never a
model writing a person's tier.

## 4 · The work, in order

Each phase is shown working on theLook before the next; no flags (each source of learned knowledge that costs a model
call or reads outside data is an organisation setting, off by default). Since 2026-11-25 (late) each phase also folds in
the surfaces §7 places on its stage of the loop — a surface folded is moved, its every feature listed and shown working
in its new place, never dropped.

- **A0 · Defects** (§2's four) — DONE. *Added by §7:* the platform's own runs (agent self-checks, eval runs) counted as
  people's signals — they are 10 of theLook's last 25 framing misses and crowd answers out of the graph's 100-receipt
  window (`context_graph_build.py:111`); "Org" names two different things (the rail's promoted findings, the Ontology
  switch's every-connection entity map); 3 eval runs stuck "running" since August; stale comments
  (`context_graph_readback.py:12`, `OrgIntelPanel.tsx:14,146`).
- **A1 · What an answer used** — DONE (`trust/answer_inputs.py`). *Added by §7 (A1b):* what an answer **tried** — the
  SQL that failed and the one that worked after it, the joins it chose, the clarification left unanswered — kept on the
  receipt, so A7 can learn from them; today only the trace views see them, for 14 days.
- **A2 · One standing** — DONE 2026-11-25 (`pramanyx/trust/standing.py`). The orders disagreed out loud — the
  platform's ladder put *measured* above *approved*, the learned list *confirmed* above *measured* — and were both right:
  a thing stands on the data's word, a person's, or both. Tiers, strongest first: both · the data's · a person's · mined
  · said; within a tier and never across: published before a draft, certified before plain (deprecated last), its Area
  contact's word then the person most often right there (punch list 86), the answers that drew on it this month (A1,
  capped), the newest; then relevance among equals. On it now: the learned list (each item says `why`), the
  Definitions given to an answer, the metric-definition authority (its order unchanged, its own tie-breaks kept). It
  agrees with the hub's ladder (measured > approved > declared > mined > said). Left as they are, on purpose: the graph
  slice selects by relevance first (its vouched/published parts already agree); `ontology/ranking.py` orders candidate
  COLUMNS for a vague word — schema linking, not knowledge — and wiring it is a retrieval change to measure with an
  eval of its own, not part of one standing. *Added by §7 (A2b):* the *measured* tier also earned by evals that test
  the context layer (§7.9), not only by a run's own numbers.
- **A3 · Learned knowledge on a page** — DONE (the list, Promote, `area=`). *Added by §7 (A3b): one learned list.*
  Memory's readings (clarifications a person answered), reviewer verdicts and trusted queries, and the learned list's
  answers, findings and usage are two halves of what the platform learned, each missing the other's: one list, one
  standing, one Promote; the Memory page becomes that list's place in the rail; its training corpus moves to the AI
  Factory, where it is used.
- **A4 · The Atlas, by Area** — A4a DONE (the organisation's map, the month's figures, review by Area counts), A4b DONE
  (an Area opened: fan-out by kind with counts, each kind by use, tabs on the right, Promote). *Added by §7 (A4c):*
  Brain Map's one idea — the loop's stages counted, with measured arrows between them — becomes the Atlas's Overview,
  and its page retires; the rail's **Org** page (promoted findings: an empty store, one writer, one deep-analysis
  reader) retires into the Atlas (the bird's-eye view it was meant to be) and into Promote (a finding promoted becomes a
  draft Definition, which every answer reads).
- **A5 · Review by Area → one "Needs you"** (§3.4, widened by §7.8). The review queue regrouped by Area across
  connections and rolled up to the parent Area, with the plan's new kinds (*new Definition*, *Definition edit*); then the
  same view over every queue that waits on a person — staged proposals (today on 7 surfaces), the deep analyses'
  recommendations (today "Decide ▸ Inbox"), monitor and agent alerts (two stores, one badge) — by Area and by person,
  with read state per person. **Inbox** becomes that view; **Notifications** (outbound channels: Slack, webhook, Jira)
  is renamed **Delivery** and moves under Operations' settings; **Actions** stays what agents may do (the ontology's
  declared actions).
- **A6 · Relationships by Area** (§3.5, widened by §7.5): today's Business Atlas inside an Area, zones = Areas, joins
  from the organisation's ontology; the Ontology switch's Domain and Org (every connection's entity map) become
  Relationships across connections; the **Graph** page's Explore / Tour / Review become Relationships' "one thing and
  its neighbours" view. The graph's store stays: it is what every answer reads (§7.5).
- **A7 · More to learn from** (each an organisation setting): query history on a schedule rather than by hand; our own
  dashboards, Data Canvases and saved SQL mined into learned items — the SQL read without a model. *Added by §7:* the
  traces' unread parts (A1b) — joins an agent chose that ran become join candidates beside the warehouse's query log's;
  a failure and the fix after it become a learned "watch for this"; `trace.feedback` verdicts join the thumbs-down
  cluster (A5).
- **A8 · Across connections, and agents read the map** (widened by §7.1): a Definition placed in an Area may hold for
  every connection the Area spans; the organisation's ontology reaches the answer path; **the Areas themselves reach
  every agent** — the answer path and the coworker's MCP get "which Area is this question in, who answers for it, what
  is governed there" (today the Atlas is read by its page alone). *Added by §7.10:* one meaning of "off target" — a
  metric's target, kept on the metric, is what a monitor watches and what Health shows on the Area.

## 5 · Decisions this plan needs from the user

1. **The Atlas's first screen** — the organisation's Areas (this plan), or keep the connection's Atlas first and add
   the Area map beside it.
2. **Bubble size** — answers that drew on the Area (needs A1 first; until then sized by what it holds, said), or what
   it holds, always.
3. **What "governed reach" counts** — approved metrics, published Definitions and approved trusted queries; or those
   plus certified tables and documents.
4. **Order** — A0 → A1 → A2 → A3 → A4 … as written, or the map first (A4 on today's counts) and the counting after.

## 6 · The mockup

A private design canvas: three screens on theLook's real figures as of 2026-11-25 — the organisation's Areas, the
Area *Orders & sales* with its fan-out and a learned item open, and its Review — stickies marking every figure that is
not counted yet and every example: https://claude.ai/artifact/48XsayxW6tAoJAVdfar1kU (private until shared).

## 7 · One organism — every surface on one loop (2026-11-25, late)

The user, mid-build: *"rethink the relationship between Ontology (the unified context layer that gives AI agents a
business-aware map of the organization — very important definition), Memory, Metrics, Brain Map, Graph, Org, how traces
are used, notifications vs Inbox and Actions, Evals, Health & Monitor"* — and *"there is a lot repetitive features …
living in silos; the platform and the coworker should work as an organism."* Surveyed in code and live (GET only) the
same evening; every count below is from that survey.

### The loop

**Act** (answers, investigations, agents — their traces) → **Learn** (what a trace teaches) → **Review** (people decide,
in one queue) → **Govern** (the ontology: Areas, metrics, Definitions, actions, one standing) → **Serve** (every agent —
the platform's and the coworker's — reads the same layer through the same doors) → **Measure** (use, evals, health say
whether it worked) → Act. A surface is a window onto one stage; a surface with its own copy of a stage is a silo. The
coworker has no features of its own: its tools are the platform's doors (one coworker, two places, 11-20).

### The ten, placed

| # | Surface | Stage | What it is, measured | Verdict | Phase |
|---|---|---|---|---|---|
| 7.1 | **Ontology** | Govern + Serve | The context layer's page: Areas (default), Org, Domain, Connection. Agents read the connection's ontology heavily (semantic block, framing, synonyms, MCP `describe_entity`) — but **no agent reads the Areas map**; Areas reach answers only through two clarify paths. | Stays the one page of the layer; its switch becomes **Areas · Relationships**; the map reaches every agent. | A6, A8 |
| 7.2 | **Memory** | Learn | Readings (11: 5 probes, 4 people, 2 verdicts — served 46 times), 2 trusted queries, 13 verdicts, few-shot (69 SQL, 214 investigations), a training corpus of 0 SFT / 0 DPO. Read by the answer path. | Merge with the learned list (it holds answers, findings, usage — not readings or verdicts): **one learned list**; corpus to the AI Factory. | A3b |
| 7.3 | **Metrics** | Govern | 71 metrics (59 approved), one store, read by every answer and MCP `get_metric`; shown in six places, as views. No rail row. | Keep: one store, many views is right. Edited on the Semantic Layer; seen in an Area's fan (A4b). | — |
| 7.4 | **Brain Map** | (Measure) | Nine boxes counted from other stores; no store, no reader but its page, backend untouched since history began; its "facts" box is the Graph's node count. | Retire the page; its idea — the loop counted, with measured arrows — becomes the Atlas's Overview. | A4c |
| 7.5 | **Graph** | Serve | The context graph: a projection of ontology, glossary, readings, claims, findings and receipts — **read by every answer** (the graph slice) and MCP `search_graph`. The page is a map centred on one node. | Keep the store (it is what agents read) and project the Areas into it; the page folds into Relationships. | A6, A8 |
| 7.6 | **Org** (rail) | (Learn) | Findings promoted to the organisation: 0 items, one writer button (Profile), read only by a deep analysis's synthesis, no MCP. "Org" also names an Ontology view. | Retire into the Atlas (the bird's-eye view) and Promote (a draft Definition every answer reads). | A4c |
| 7.7 | **Traces** | Act → Learn | 14 days kept. Read back: few-shot memory, graph findings, learned items, framing misses, clarifications, run labels (1 good, 19 bad, 80 unlabelled of 100), suggestions, use. **Never read back:** SQL that failed and the fix, joins chosen, columns picked, unanswered clarifications, `trace.feedback`. Self-checks are counted as people's misses. | Keep what an answer *tried* (A1b) and learn from it (A7); the platform's own runs never stand in for people's signals (A0). | A0, A1b, A7 |
| 7.8 | **Notifications / Inbox / Actions** | Review | "Notifications" is outbound channels (0 triggers, 336 sends all failed); "Inbox" is deep-analysis recommendations, while the Automations tab's "Inbox" is staged proposals — one proposal shows on up to 7 surfaces; "Actions" is declared actions and their outbox. Monitor and agent alerts sit in two stores, one badge. No per-person read state anywhere. | One **Needs you** view over every queue, by Area and person, with read state; Inbox = it; Notifications → **Delivery**; Actions = what agents may do. | A5 |
| 7.9 | **Evals** | Measure | The page runs one target (each case's own SQL replayed, no model); last run 2026-08-15; results feed only flag graduation — and there are no flags since 10-28. Four more eval surfaces don't share its store (agent goldens nightly, the pack gate, semantic benchmarks, the AI Factory's held-out set). | Evals test the **context layer**: questions drawn from each published Definition, certified metric and trusted query, and from corrected answers, run nightly through the real answer path; results earn the measured tier (A2b) and file *Definition edit* rows (A5). One store. | A2b, A5 |
| 7.10 | **Health & Monitor** | Measure | Health scores metrics with a target, live per visit — 0 targeted metrics on 7 connections, so empty everywhere. Monitors: 5, 58 alerts (24 open). A metric's target and a monitor's threshold are two unlinked meanings of "off target"; three alert stores. | One meaning: the target lives on the metric; monitors watch it; Health is shown on the Area and the metric; alerts go to Needs you. | A5, A8 |

### What moves where (nothing is dropped)

- Brain Map's nine counts → the Atlas Overview (answers, governed reach, coverage, learned, waiting; departures and
  owners on Now and the Areas' contacts). Its page goes when every count shows in the Atlas — listed and checked then.
- Org's list (and its remove) → Promote and the Record; its "domain" grouping → Areas.
- Graph's Explore, Tour, Review and lineage → Relationships; `?tab=graph&table=` keeps opening the same thing.
- Memory's readings, verdicts, trusted queries (with Needs you) → the one learned list; datasets and export → AI Factory.
- Decide ▸ Inbox's recommendation outcomes (accept, implemented, verified, rejected, execute) → Needs you, a lane of it.
- Notifications' triggers, test and send log → Delivery, unchanged.
- Health's per-metric score and "ask why" → the metric and its Area.

### Decisions this section needs from the user

1. Retire **Brain Map** and the rail's **Org** page once their parts show in the Atlas (A4c)?
2. **Inbox** = the one Needs-you view, and **Notifications** renamed **Delivery**?
3. Evals rebuilt around the context layer, and the flag-graduation half retired?

