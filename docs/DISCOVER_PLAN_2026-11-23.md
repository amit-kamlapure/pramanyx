# Discover — a plan (2026-11-23)

The user, 2026-11-23, after reading Databricks' Discover docs beside our platform: *"just check this deeply — each page
under discover … Do we not have something similar?"*, then, on the comparison: *"Yes, plan it here"*.

**Sources.** Databricks' own pages, read 2026-11-23: the five pages of the `discover/` section (Discover data, Discover
page, Explore storage and find data files, Explore database objects, View table insights and popularity, Sample
datasets) and the two the Discover page rests on (`uc-semantics/domains`, `uc-semantics/pages`). URLs at the end. Ours:
the code at `claude/three-places-one-answer` 0dfe852, two read-only surveys of it (every claim below that carries a
path was re-checked by hand), and the running app on theLook (Catalog, Ontology › Business Atlas, Semantic Layer ›
Areas).

Status words: **Have** · **Partial** · **Missing** · **Later** (not in this plan, with the reason).

## 1 · What Databricks Discover is, in one paragraph

One page in the sidebar where anyone finds the data and AI assets they may open — tables, metric views, dashboards,
Genie Agents, queries, notebooks and Pages (governed business terms) — without knowing the catalog's hierarchy. It
leads with **domains**: business areas (Finance, Sales…) a curator creates on a governed tag, nested up to five levels,
each with a subtitle, description, business and technical owner, a draft-then-publish state, and its own page.
Assets join a domain by tag (a catalog or schema tag passes to its tables) or by "Add to domain". Below the domains:
sections per asset type with **View all**, **Certified** assets and **AI-suggested** ones, and curated sections a
curator defines as a saved search (auto-ranked by relevance and use, with pinned items) or a hand-ordered list.
Genie suggests new domains; a curator publishes them. Search covers names, columns and comments, by keyword or by
meaning, filtered by domain, and shows only what the person may see. Three personas: curator, page manager,
consumer. Around it: Catalog Explorer (tree, sample, details, history, ERD, request access, "ask the sample"), table
insights (30-day use, frequent users/queries/dashboards, popularity of tables and columns), file previews in volumes,
and sample datasets.

## 2 · What we already have

| Databricks | Ours | State |
|---|---|---|
| Discover page | No page browses every kind of asset. The Catalog home, the Business Atlas and Profile each cover a part. Our 11-17 Genie One study already lists "no Discover, For you, Domains" (`docs/GENIE_ONE_STUDY_2026-11-17.md:40`) | **Missing** |
| Domains, subdomains | **Areas**: name, question, parent, business and technical owners (`pramanyx/orgsettings/models.py:39-48`), nested up to five levels (`pramanyx/semantic/areas.py:23`), placed by the governed tag `area=<id>` — a connection's tag reaches its tables (`areas.py:181-219`), model-suggested areas a person declares (`GET /areas/{conn}/suggested`, no model call), "Everything else" as the General area. Seen live: Orders & sales, Returns, Fulfilment, Customers… | **Partial**: no description, no Area page, only tables, metrics and connections can be placed (`areas.py:196`) |
| Curated sections | Favorites and Recent in the browser; the Dashboards home's Certified and Favorited chips; `dashboard_stars` on the server (`pramanyx/db/user_prefs.py:225,253`) | **Missing** |
| AI-recommended assets | Popularity per table and column is mined from query history (`pramanyx/sql/popularity.py`), used only by agents and the Briefing; reads per object type over a window (`AuditLogger.reads_within`, `GET /object-types/uses`) | **Partial**: nothing shown to a person |
| Pages | **Definitions**: area, owner, ≤50 synonyms, text, links to tables, metrics, dashboards, documents; draft → published by the owner; suggested edits accepted or declined; versions; drafted from documents into review; answers cite them (`pramanyx/record/writers.py:577-828`, `web/app/definitions/[term]/page.tsx`) | **Partial**: no comments, votes, rich body with @-mentions, sources field, or index page — **Later**, see §7 |
| Personas | Viewer, Editor, Owner (`pramanyx/rbac/roles.py`); "curator" = an organisation admin (`ADMIN_MANAGE_ORG`) | **Partial** — the user's call in §3 settles it without a new role |
| Search | Keyword + meaning search over tables, columns, comments, metrics, Definitions and findings, trimmed by clearance (`pramanyx/ontology/context_graph_search.py`), one connection at a time, reachable only by agents (MCP `search_graph`, `GET /knowledge/{conn}/graph/search`, which no page calls). In the app the catalog filter and ⌘K match table names of one connection | **Partial** — the sharpest gap |
| Catalog Explorer | Catalog → schema → table; tabs Overview, Columns, Preview (200 rows), Lineage, Usage, Findings, Business mapping, Docs, Activity (`web/components/catalog/CatalogTable.tsx:239-249`); the Diagram tab's ERD; "Ask about it" | **Have** (no table history, no request access — **Later**) |
| Descriptions, AI-written | The model writes table and column descriptions, a person's text wins (`pramanyx/semantic/autoseed.py`); edited in the Docs tab | **Partial**: the app never says which ones the model wrote |
| Table insights | Usage tab: the latest 500 audited statements by surface | **Partial**: no 30-day view, no frequent users |
| Certification | certified / deprecated with who, why, when on tables, documents, dashboards, canvases (`pramanyx/govern/certification.py`); answers prefer certified tables and withhold deprecated documents | **Have** (not shown in lists; not on agents, sheets) |
| Files, sample datasets | Volumes and Documents (pdf, txt, md, csv preview); a built-in samples database and two demo packs | **Have**, basic — **Later** for more previews |
| Account-wide scope | One tree over every connection of the workspace | **Partial** — across workspaces is **Later** |

So the parts exist under other names. What is missing is the **layer on top**: one page that browses every kind of
asset by Area, a search a person can use, and the Area as a place you can open and curate.

## 3 · The user's calls (2026-11-23)

1. **Where:** Data, first row — the Data destination reads **Discover · Catalog · Profile · Documents**. The rail stays;
   this adds one row (the rail allows eight per destination, `web/lib/navDestinations.test.ts:57`).
2. **Who curates an Area:** its **business and technical owners**, already recorded on each Area, plus organisation
   admins for every Area. No new role. Anyone who can edit may still place **their own** dashboard, canvas or other
   asset in an Area, as tables and metrics can be placed today.
3. **First version lists everything one can open:** tables, metrics, Definitions, dashboards, Data Canvases, agents,
   documents, spreadsheets, trusted queries and schedules.
4. **The coworker shows Discover too:** a sidebar entry that shows the platform's Discover page, and an item can be
   asked about in the conversation.

## 4 · The design

### 4.1 The page

A browse page, not a dashboard (the user, 2026-10-13: a page leads with what it is for). Full width.

- **Top:** the search box, wide, with filters beside it — Area, kind, Certified, connection, Mine.
- **Areas:** one card per Area the person can see anything in — its name, its question as the line under it
  ("How much did we sell?"), its owners, and how many things it holds by kind. Model-suggested Areas show to their
  curators only, marked suggested, with **Declare** and **Not an area** (the flow that exists under Semantic Layer
  today, moved where people see Areas).
- **Certified:** what curators marked certified, newest first.
- **Most used this month:** from what was read (§4.5), never a model's guess.
- **One section per kind:** Tables, Metrics, Definitions, Dashboards, Data Canvases, Agents, Documents, Spreadsheets,
  Trusted queries, Schedules — up to six each, with **View all**, which opens the same page filtered to that kind.
- **A row** says the kind, the name, one line (description, question or purpose), the Area, the certified or
  deprecated mark, the owner, when it changed, and how often it was used this month. A click opens the thing's own
  page; **Ask about it** opens the Ask panel on it (the panel's existing subject, `lib/askSubject.ts`).
- **Withheld is said:** a kind the person may not list, or items trimmed by clearance, are counted and named as
  withheld, never left out silently.
- The tab reads **Discover**, or the Area's name on an Area's page (`lib/tabTitle.ts`).

### 4.2 An Area's page

The Area's name, its question, a description (new — §4.4), its owners; its sub-areas as cards; **Featured** — the
items its curators picked, in their order; then what it holds, by kind, the same rows as Discover. Its Definitions
are listed here too, which gives Definitions the index page they lack. Curators see **Add to this Area** (a picker
over every kind) and **Edit** (description, featured items, owners).

### 4.3 Search a person can use

`GET /discover/search?q&area&kind&connection&certified` — one ranked list across every connection the person may read
and every kind:

- **Meaning and keywords** from the context graph (`context_graph_search`) on each connection, with the query
  **embedded once** and that one vector reused for every connection's collection (today it embeds per call; the
  default embedder is local Ollama, and no language model is called).
- **Names and descriptions** of the kinds the graph does not hold (dashboards, canvases, agents, documents, sheets,
  schedules), matched from their own list stores.
- Merged by rank fusion, de-duplicated (a table under two connections is said once, as the Catalog already does),
  trimmed by each store's own permission check and by clearance, with what was withheld said.
- The Discover box uses it, and ⌘K gains **Search everything** that opens Discover with the query.

### 4.4 Areas, made whole

- **Description** on an Area (`AreaDeclaration.description`); its `question` stays the line under its name.
- **Every kind can be placed.** `place()` and `PlacementIn` take dashboard, canvas, agent, document, sheet, trusted
  query and schedule, on the securable spellings the tag store already accepts (`pramanyx/metastore/models.py:143-172`).
- **An unplaced asset still has an Area:** the Area of the tables it reads — where a person placed one, else the Area
  whose words name it (`areas._area_of_tables`, used by `knowledge/learned.py` today) — shown as *read from its tables*,
  apart from a placement a person made.
- **Who may change what** (the user's call 2): declaring an Area, its description, owners and featured items — that
  Area's owners or an admin; placing an asset — its own owner, that Area's owners, or an admin; agents never.
- **Featured items** live on the Area's declaration (`featured: [{kind, ref}]`, in order) — the store that already
  holds Areas, so no new store.
- **Declared is published.** A suggested Area is the draft; declaring it publishes it to everyone. Changes keep their
  history (who, when), as the tag store's journal does (`govern/tag_store.py`).

### 4.5 Use, read from what happened

- **Tables and metrics:** reads in the last 30 days and how many people read them, from the audit log
  (`AuditLogger.reads_within`), which replaces the all-time popularity count where a person sees it.
- **Dashboards, canvases, documents, sheets, agents, schedules:** measure first which opens and runs are already
  audited; add an audited "opened" where one is missing, on each thing's own read route. No new store.
- **Recently opened by you** from the same log, filtered to the person.

### 4.6 The coworker

- A **Discover** entry in the coworker's sidebar (as Agents and Schedules are, `coworker/plugins/home`) shows the
  platform's Discover page in its main area, served as a page of its own (`web/app/discover/page.tsx`, as
  `/chart/<id>` is) in the coworker's light or dark (`lib/frameTheme.ts`).
- **Ask about it** there begins a question in the conversation ("Ask about the Orders dashboard: "), sent only when
  the person sends it — the coworker's rule for anything begun on a person's behalf.

### 4.7 Words

**Discover** joins the glossary as the page's name. **Area** stays the word (the user, 2026-11-17; "domain" already
means the organisation ontology's scope). **Featured**, not "pinned" (pinned already means three other things). Not
**Curator** — that is one of the six built-in agents; say *the Area's owners*.

## 5 · Phases

Each is shown working on theLook before the next, with its tests and the gates. No feature flags.

| | What | Size |
|---|---|---|
| **D0** | **A mockup first** — Discover, a search, an Area's page and the Data rail with its new row, at 1600 px, on theLook's real data, shown to the user before anything is built (the user, 2026-10-05: a change of navigation is shown before it is built). Made 2026-11-23 as a private design canvas: https://claude.ai/artifact/5V8n24p287evJgFZuvPDvv | S |
| **D1** | **The read.** `GET /discover`, `GET /discover/areas/{id}`, `GET /discover/items?kind&area&certified&connection&q&cursor` — one adapter per kind over its existing list route and permission check; Area per item (placed, else read from its tables); certification joined; the missing deep links added (a custom agent, a document, a trusted query, a table). Fix the defects in §6. | M |
| **D2** | **The page** in the app (§4.1, §4.2), Data's first row, the tab's name. | M |
| **D3** | **Search** for people (§4.3), the Discover box and ⌘K's Search everything. | M |
| **D4** | **Curation** (§4.4): description, every kind placeable, owners-or-admin checks, Featured, Add to this Area, suggested Areas declared from Discover. | M |
| **D5** | **Use** (§4.5): 30-day reads and readers, opened events where missing, Most used, Recently opened, popularity sort in the Catalog. | M |
| **D6** | **The coworker** (§4.6): sidebar entry, `/discover` page, Ask about it. | S |

## 6 · Defects found while planning (D1)

1. **Fixed.** Reading one table's certification ignores its schema (`routers/governance.py:299-300`;
   `web/lib/certification.ts` sends none) while a write with a schema stores `table:<conn>.<schema>.<t>` — a certified
   table can read as not. Both now carry the schema (`test_a_table_certified_under_its_schema_reads_back_under_it`).
2. **Fixed.** Placements are read back by bare table name (`areas.placed_by_people`), so two schemas' `orders` collide.
   They are read under `schema.table` first; a bare name placed in two Areas is no longer answered by either
   (`test_one_table_name_in_two_schemas_is_read_under_its_schema`).
3. **Decided, nothing to change.** A canvas is spelled two ways: `artifact:canvas:<id>` for certification,
   `canvas:<id>` for grants. They are two securables for two things — what is said OF the canvas (its mark, its Area)
   and who it is shared WITH — and Discover reads each from its own (`discover/items.py`'s docstring says so).
4. **Open.** Area declarations are install-wide (`data/org_settings.json`) while placements are per organisation
   (`govern_tags`, keyed by org) — say which is meant before a second organisation declares Areas. D4's.

D1 also added the four missing deep links (`web/lib/addressOnce.ts`): `?tab=agents&agent=<id>&kind=custom` opens a
custom agent, `?tab=documents&doc=<id>` a document's preview, `?tab=memory&trusted=<id>` a trusted query, and
`?tab=catalog&conn=&schema=&table=` a table. Each is read once on arrival and taken off the address; a page kept
mounted behind another tab reads it only when it mounts, so D2's links open by navigation, not by a tab switch alone.

**D1 live on theLook, 2026-11-23** (API restarted on the branch's tip; every read over HTTP, no model, no warehouse):
`/discover?connection_id=8233e4fd` answers in ~1.1 s — nine Areas holding something (Orders & sales 14: 4 metrics,
3 tables, 2 dashboards, 5 schedules), six quiet, "Everything else" 21; 23 metrics, 7 tables, 3 dashboards, 3 canvases,
2 agents, 8 schedules, 3 documents, 6 sheets; no Definitions, trusted queries or certification marks exist there (each
checked at its own route). All eight connections: ~2.7 s. Reading it live found six things, each fixed before this
was called done: another connection's schema documents listed (out of view now, and named by the connection's name);
every spreadsheet listed twice, once as a table of the Sheets connection, past its sharing; Areas read from
descriptions ("returns the top five" in Returns) — names only now, the placing word said; a table link dropped because
the address loses `?conn=` while the page loads; a schema document's link landing on a folded group; and a shared
dashboard linked by a word the page never reads (`shared:<owner>:<id>` now). Opened in the browser: a table, a custom
agent, a document, a trusted query and a dashboard each open on the thing itself.

**D2 live, 2026-11-23** (`components/discover/DiscoverPage.tsx`, `lib/discover.ts`, `styles/discover.css`): Discover is
Data's first row (`navDestinations.ts`), so Data opens on it. No title bar (the user, 2026-09-26): the search and its
filters (Area, kind, Certified, Mine — who owns it, new on `/discover/items` — and connection) lead; then the Areas as
cards opening their page at `?tab=discover&id=<area>` (page.tsx's `id`, as the Record's readers use it: Back and a reload
keep it), the empty ones and the model's suggestions (Declare / Not an area, as the Semantic Layer does them) each a
click away; Certified, or that nothing is; each kind's first six with View all. A row is a real link; a table, dashboard
or spreadsheet has Ask about it (the Ask panel's own subjects — the other kinds have none yet, so none is offered). The
tab reads Discover, or the Area's name. Seen live at 1600 px on the default workspace (6 connections, 14 Areas holding
something). Reading it live found: four reads before the workspace was known, across every connection (now read once,
under the workspace, kept 20 s); ten suggestions crowding the Areas (folded); long "how" words squeezing names (cut,
whole on hover); and the dev server's Turbopack cache serving the old stylesheet after the checkout move (cleared, the
user's call). Not in D2: Featured, an Area's description and Add/Edit (D4), Most used (D5), meaning search (D3).

**Links, made robust, 2026-11-23** (the user, on a spreadsheet that opened with no rail and no bar: it "must connect
very well and in a very robust manner"). Every kind links to its home INSIDE the app (`discover/items._href`; a guard reads
every link): a metric and a Definition to the Semantic Layer (the Definition page — `components/definitions/DefinitionView`
— now shown there as well as at `/definitions/<word>`), a spreadsheet to Spreadsheets, a schedule to Agent Ops'
Automations, a trusted query to Memory, a dashboard to Dashboards, a canvas to the Data Canvas, a table to the Catalog,
an agent to the Roster, a document to Documents. Opened in place (`lib/addressOnce.openInApp`): the shell's words go on
the address, the link's own are handed to the page (Next's router writes back what a `pushState` gave it, so a word put
there stayed); each page reads them on mount AND while open (`useFromAddress`). Seen live, each kind, cold and warm.

**D3 live, 2026-11-23** (`pramanyx/discover/search.py`, `GET /discover/search`; the Discover box; ⌘K's Search everything).
The question is embedded once and that one vector read against every connection's graph — its word rank and the nodes
near enough in meaning (cosine ≥ 0.52, measured: what a question meant scored 0.6–0.76, a nonsense question's nearest
0.478) — kept to the kinds Discover lists (theLook's many revenue findings had crowded out its Revenue metric); a graph's
business object maps through its source tables (`table:Order` → orders), a column to its table. Words are matched on every
item. Fused by rank, each connection by its own; a table on two connections said once with "also on". Seen live: "who buys
again" → Repeat Purchase Rate, the conversion rate and the buyers' tables by user_id; "late deliveries" → the delivery
columns and metrics; nonsense → nothing; 0.6–1.8 s. Not in D3: findings as results (not a Discover kind).

**The Definition as a Page, live 2026-11-23** (the user, showing a catalog's Page beside ours: "Dont know what this is").
`components/definitions/DefinitionView.tsx` lays a Definition out as a Page: name, state and actions on one row (Cancel /
Save as draft / Publish for its owner, Suggest this edit for anyone else); Area, Owner, Synonyms and Description a row
each; the body in Markdown under a toolbar (`lib/definitionBody.ts`), a new one opening on Definition and Business use,
drawn when read (`DefinitionBody.tsx`); related assets picked from anything Discover lists, by name or meaning; sources —
a web address or a document. The store gained a description, sources, and related assets of every Discover kind with
their in-app address (`record/writers.py`). Begun from the Semantic Layer's "Add a definition" (its quick entry moved to
the card's tools) and Discover's "Write a Definition" / "New". Seen live: filled in, picked "Repeat Purchase Rate" by
"who buys again", previewed, cancelled — nothing written. Differences kept: the body is Markdown with a preview rather
than typed in place; the owner is whoever writes it first (no handing it to another yet); no images; no model writes the
description.

## 7 · Not in this plan

- **Across workspaces** (Databricks' account scope) — **Later**: nothing spans workspaces yet.
- **Saved-search sections** — **Later**: Featured is the hand-picked list, and each kind's section is the automatic one.
- **Definitions' collaboration** — comments, votes, a rich body with @-mentions, sources, certify/deprecate (left out
  on purpose: a Definition has its own lifecycle, `govern/certification.py:4-6,32`) — a plan of its own.
- **Catalog extras** — table history, request access, which descriptions the model wrote, column popularity, more file
  previews — each small, none needed for Discover.

## Sources

- https://docs.databricks.com/aws/en/discover/
- https://docs.databricks.com/aws/en/discover/discover-page
- https://docs.databricks.com/aws/en/discover/files
- https://docs.databricks.com/aws/en/discover/database-objects
- https://docs.databricks.com/aws/en/discover/table-insights
- https://docs.databricks.com/aws/en/discover/databricks-datasets
- https://docs.databricks.com/aws/en/uc-semantics/domains
- https://docs.databricks.com/aws/en/uc-semantics/pages

**The look, 2026-11-23.** The user, with the reference Page beside our Discover: "This light grey on dark bluish grey is
painful to the eyes.. Also check the Discover page.. it just has the outlines..". The palette was already the
reference's; the difference was each card filled with the frame's gray 3. A dark card is now gray 2 with a gray-5
hairline, and the rail's words are bright (`tokens-v2.css`, kit `CARD`, `styles/discover.css`). The "outlines" a reader
sees first are the page waiting on its read: about 82 requests go out as the app opens, and `/discover` takes about 8 s
among them against 2.6 s alone. That start-up rush is the app's, not Discover's, and is its own piece of work.

**The start-up rush, fixed the same day** (the user: "Yes, fix it here"). A cold load of Discover read 127 times and its
data arrived at 12.2 s. Now it reads 28 times and the data arrives at 2.3 s:
- the conversations behind every page (the Ask screen's, and each remembered Ask panel tab) are drawn the first time
  they are shown, not at load;
- the schema is read by the component that asks for it, not by the provider round every page;
- the top bar's strip reads the agents' runs alone (`runners=false`), not a day of automation runs too;
- Discover makes each connection's coverage matrix and Area map once per read (3.4 s → 1.2 s warm).
