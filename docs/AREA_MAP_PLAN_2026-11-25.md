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
call or reads outside data is an organisation setting, off by default).

- **A0 · Defects** (§2's four): MCP findings confirmed-only; one name per Area wherever it is said; learned items
  deduplicated by statement; `ontology/ranking.py` kept for A2 (§2, defect 4).
- **A1 · What an answer used, recorded when it is made.** Every answer path (`/chat`, `/investigate`, the coworker's
  MCP reads on a person's behalf) records what it **considered** and what it **chose** — metrics, Definitions, learned
  items, trusted queries, documents, tables — as edges on the receipt (the Ledger's lineage table, beside the tables
  and columns it already holds) and a `thing.used` per thing chosen (`discover/usage.py`, today trusted queries only).
  No new store. Gives every "used in N answers", the governed reach, and citations under an answer that show both.
- **A2 · One standing.** One order for everything an answer may draw on — approved > published > certified > learned
  by its standing, then use, then recency, then who stands behind it — replacing the six; each learned item gets a
  standing a reader can read ("why trusted").
- **A3 · Learned knowledge on a page.** The learned list in the rail and the right panel; **Promote → a draft
  Definition**; learned items placed in an Area (147 of theLook's sit in none).
- **A4 · The Atlas, by Area** (§3.1–3.3): the organisation canvas, an Area's fan-out, kinds and tabs — over
  Discover's per-Area counts (`discover/service.py`), which already cross connections.
- **A5 · Review by Area** (§3.4) over `knowledge/review.py`, regrouped and rolled up.
- **A6 · Relationships by Area** (§3.5): today's Atlas inside an Area, zones = Areas, joins from the organisation's
  ontology.
- **A7 · More to learn from** (each an organisation setting): query history on a schedule rather than by hand; our
  own dashboards, Data Canvases and saved SQL mined into learned items — the SQL read without a model; a sentence
  written for it only where the organisation allows model work it did not ask for.
- **A8 · Across connections**: a Definition placed in an Area may hold for every connection the Area spans (the
  connection becomes optional); the organisation's ontology reaches the answer path.

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
