# What Discover left out — a plan (2026-11-25)

The user, 2026-11-25, of the three things the Discover plan set aside (`docs/DISCOVER_PLAN_2026-11-23.md` §7):
*"One done, finish this too: … search across workspaces, and saved-search sections; comments and votes on Definitions;
Catalog extras: table history, request access, which descriptions the model wrote, column popularity, more file
previews"* — then, asked how: **plan first, then build here**, in the order Catalog extras, Definitions, search.

**Sources.** Three read-only surveys of `claude/discover-d4-d5-rest` at 7543143 (Catalog; Definitions; Discover search
and workspaces). Every claim below that a design rests on was re-read by hand; the one defect found that way is §6.1.

Status words: **Have** · **Partial** · **Missing** · **Later** (not in this plan, with the reason).

## 1 · What each is

- **Catalog extras** — on a table's page: what changed about it and when (**history**); a way to **ask for access**
  where the app now only says no; **which descriptions the model wrote**, said beside them; how often each **column**
  is read; and **previews** of more of the files people keep.
- **Definitions, together** — people other than the owner **comment** on a Definition, **@-mention** someone, and
  **vote** that it is right; the owner sees both.
- **Search, wider** — one search over **every workspace** a person may read, each result saying where it lives; and
  **saved searches**, a person's own, one click from the Discover box.

## 2 · What we already have

| Extra | Ours | State |
|---|---|---|
| Table history | Entity edits are versioned (`GET /ontology/history`, `ontology/history.py:64,108`), but no table or column kind; column notes keep a `note_history` (`ontology/column_config.py:134`). Profile snapshots keep row counts and types (`tools/profile_cache.py:380`), but the fingerprint is the table's name and column count (`tools/profiler.py:92`), so a type or row-count change overwrites a snapshot. Graph freshness works out added and removed tables against the one previous graph, into a sentence (`kernel/freshness.py:121-128`). A glossary description edit keeps no who or when (`semantic/glossary.py:656`). | **Missing** |
| Request access | Refusals that name nothing to do: a dashboard card ("You may not see this card", `DashboardTile.tsx:774`), the metastore ("No access", `MetastorePanels.tsx:178`), a Data Canvas ("Ask {maker} to share it with you" — a name, no button, `canvas/sharing.py:56`). The decision explains itself (`rbac/access.py:140` `may`); owners link to principals (`rbac/owners.py:122`); grants exist (`metastore/store.py:160`); a proposal inbox exists (`actions/inbox.py:193`, Decide ▸ Inbox). Discover's withheld counts carry no ids, by design. | **Missing** |
| Descriptions the model wrote | Autoseed marks its glossary entries `auto_generated` (`semantic/autoseed.py:356`) and keeps them in a sidecar (`glossary.py:78`); `GET /glossary` returns the flag; a person's or dbt's entry wins the merge (`glossary.py:536`). The web type drops the flag (`web/lib/api.ts:10068`) and the Catalog shows every description alike (`CatalogTable.tsx:317`). Column notes say human or agent (`GlossaryPanel.tsx:192`). | **Partial** + the defect in §6.1 |
| Column popularity | Per-column counts mined from query history (`sql/popularity.py:56`, `load_popularity` :119), refreshed at setup and by the explorer (`routers/_shared.py:442`, `explorer/continuous.py:339`) — read only by agents (`agent/schema_annotators.py:197`, `agent/spotlight_tools.py:256`). No route serves them. | **Partial** |
| File previews | Uploaded tables preview as rows. Documents frame `.pdf .txt .md .markdown .csv` (`DocumentUploader.tsx:44`, `DocumentsPage.tsx:597-631`), everything else as its converted Markdown; volume objects only download (`MetastorePanels.tsx:119`), though the server sends their type (`routers/volumes.py:50`). | **Partial** |
| Definition comments | Sheet rows already take comments as `said` claims about an object (`sheets/record.py:137-168`: `About(kind="object", key=…)`, one claim per comment, read with `list_claims`). The same claim carries Google comments onto decisions and Slack replies. Definitions have suggested edits inside the claim's `extra` (≤20), not comments. | **Missing** (the store is **Have**) |
| @-mentions | A people list for admins (`GET /rbac/directory`, `routers/roles.py:108`; DefinitionView uses it for Hand to…); empty for anyone else. No mention is parsed anywhere; no per-person notice exists (the Inbox holds action proposals). | **Missing** |
| Votes | Nothing records "this is right" per person per object: verdicts are per answer, thumbs are events per turn, certification refuses Definitions (`govern/certification.py:31-34`). Discover's use counts are folds of journal events (`discover/usage.py`). | **Missing** |
| Across workspaces | A workspace is a list of connections plus settings (`workspace/models.py:10-35`), with **no members**: permission is per connection and per item, and an item's id comes from its connection, so a union cannot collide (`discover/items.py:253…454`). The coworker's Discover already reads every connection the organisation can see, unlabelled. | **Partial** |
| Saved searches | A per-person preference store with list keys (`db/user_prefs.py:225-269`, `GET/PUT /me/preferences/{key}`); Discover's filters are one type (`DiscoverPage.tsx:39-41`). Nothing saves a search. | **Missing** |

## 3 · The user's calls (2026-11-25)

1. **Plan first, then build here**, on `claude/discover-d4-d5-rest`, in the order **Catalog extras → Definitions →
   search**.
2. **Votes say "This is right" only** — one per person, taken back at will. Disagreement is a comment or a suggested
   edit, which already exist.
3. **A mention reaches the person as an item in Decide ▸ Inbox** — "Ana mentioned you on Repeat buyer", opening the
   Definition, read once opened.
4. **Access is decided by the thing's owner, else an admin.**
5. **A column's count comes from the warehouse's query history** — the counts already mined — worded apart from a
   table's reads, which count Pramanyx's own: "used in N queries in the warehouse's history, as of <date>".

## 4 · The design

### 4.1 Catalog extras

**Which descriptions the model wrote (C1).** A description the model wrote says so where it is read — "Written by the
model" beside it on the table's Overview, in its Columns and in Docs — and stops saying so the moment a person edits it.
First the defect (§6.1): a person's write clears `auto_generated` and moves the entry to the authored layer, so the
re-seed never touches it again. The web reads the flag `GET /glossary` already returns.

**Column popularity (C2).** `GET /catalog/{conn}/columns/usage?schema&table` serves `load_popularity`'s column counts
with when they were mined; the Columns list shows "read N times in the warehouse's history, as of <date>" and sorts by
it. Before building, measure that theLook and Lux have mined counts at all (the store is read over HTTP once the route
exists; until then the explorer's log says what it mined) — a route over an empty store is not the feature.

**Table history (C3).** One record per change of a table, never per look: when a profile is saved and a table's columns,
their types or its row count differ from its last record, a `table.changed` event goes to the journal (registered in
`kernel/events.CATALOGUE`) with what changed; a glossary description edit records who and when the same way. The
table's Activity tab reads them newest first: "3 columns added", "type of `price` changed from STRING to NUMERIC",
"row count 124,452 → 125,080", "description edited by …". The profile fingerprint (§6.4) is left alone — the journal is
the history, the snapshot store stays a cache.

**More file previews (C4).** Images (`png jpg gif webp`) draw as images and `json tsv` as text, for documents and for
volume objects alike — one list of what a browser draws safely, read by both. HTML and SVG stay downloads: drawn on the
app's own origin they would run script (§7).

**Request access (C5).** Where the app says no and knows what was refused — a dashboard card, a Data Canvas, a
metastore object — it offers **Ask for access**: a short reason, sent as an `access_request` proposal to the thing's
owner (`linked_principal`), else to the organisation's admins, in Decide ▸ Inbox. Accepting shares the canvas or
dashboard, or adds the grant; declining says why to the asker. Discover's withheld counts stay counts: a thing a person
may not see is not named to them.

### 4.2 Definitions, together

**Comments (P1).** A comment is a `said` claim about the Definition (`definition:<conn>/<area>/<term>`), exactly as a
sheet row's — one store for "what people said about a thing". The Definition's page shows the thread after Suggested
edits, oldest first, each with who and when; a person may take back their own (superseded, history kept); the owner
sees how many are new since they last looked. People only, never an agent (`_persons_own`). Reading them by object key
needs an index or a key-prefix read, not `list_claims`' scan-and-filter (`record/claims.py:278-296`).

**@-mentions (P1).** Typing `@` offers the people of the organisation; a mention is kept on the comment as the
principal it names and reaches that person (§3, the open call). The people list needs a reader-safe variant of the
directory — names only — since today a non-admin's is empty.

**Votes (P2).** One vote per person per Definition, changed or taken back at will, counted beside its owner and on
Discover's rows ("4 people say this is right"). A vote is a journal event folded like Discover's use, so the count
and who voted are read from what happened, not kept as a number.

### 4.3 Search, wider

**Across workspaces (S1).** Discover's search gains **This workspace · Every workspace**. Every workspace is the union
of the workspaces' connections that the organisation may see, run once outside the request's workspace
(`workspace_scope(None)`), still one embedding; each result names the workspace(s) it lives in, and opening one from
another workspace switches to it first (§6.2). Areas are the organisation's declarations, so one result has one Area;
a workspace's own Area overrides read where the result lives.

**Saved searches (S2).** "Save this search" when any filter is set; a person's own, up to 20, in the preference store
(`discover_searches`: name, words, kind, Area, connection, certified, mine, workspace). They show as chips under the
Discover box; one click sets the filters. A saved search is not a live section: each would cost a full read of every
kind and an embedding per visit.

## 5 · Phases

Each is shown working on theLook (Lux where theLook has no such thing) before the next, with its tests and the gates.
No feature flags.

| | What | Size |
|---|---|---|
| **C1** | Descriptions the model wrote: §6.1 fixed, the mark on Overview, Columns, Docs | S |
| **C2** | Column popularity: measured first, then the route and the Columns list | S |
| **C3** | Table history: `table.changed` from profile saves and description edits, the Activity tab | M |
| **C4** | File previews: images and text for documents and volume objects | S |
| **C5** | Request access: the proposal kind, the button on three refusals, accept and decline | M |
| **P1** | Definition comments and @-mentions | M |
| **P2** | Definition votes | S |
| **S1** | Search across workspaces, §6.2 fixed | M |
| **S2** | Saved searches | S |

## 6 · Defects found while planning

1. **A person's edit to a model-written description stays the model's.** `update_table` and `update_column`
   (`semantic/glossary.py:656-698`) never clear `auto_generated`: the edited entry stays in the gitignored sidecar,
   labelled the model's, and the drift re-seed (`semantic/autoseed.py:284-292`) re-seeds exactly those entries when a
   table's columns change — so a person's words can be overwritten by the model's. Fixed in C1.
2. **A Discover result from another workspace opens on the wrong connection** — the page snaps the selection back to
   the current workspace's connections (`web/app/page.tsx:1876-1886`). Today only the coworker's Discover reaches it;
   S1 makes it common. Fixed in S1.
3. **Workspaces have no members, and `GET /workspaces` lists every organisation's** (`workspace/store.py:127-134`, its
   own note at :248-250). One organisation per install today, so nothing leaks; named, not fixed here.
4. **A profile snapshot's fingerprint is the table's name and column count** (`tools/profiler.py:92`): a type change
   or a new row count overwrites the snapshot. C3 does not depend on it; named.
5. **An Area curated in a workspace that overrides `areas` is hidden there** — `edit_area` writes the organisation's
   (`semantic/areas.py:105-106`), the workspace's override wins the read (`orgsettings/store.py:53-74`). Named.

## 7 · Not in this plan

- **Word, PowerPoint and Excel files drawn as themselves** — they read as their converted Markdown; drawing them needs
  a renderer per format. **Later.**
- **HTML and SVG previews** — on the app's origin they run script; a sandboxed origin is a project of its own. **Later.**
- **Which ontology descriptions the enricher wrote** — `OntologyEntity.description` carries no provenance
  (`ontology/models.py:392`); the Catalog shows the glossary's. **Later.**
- **Sections an Area's owners define as a saved search** — a person's own saved searches first. **Later.**
- **A per-person inbox of everything** — mentions reach a person (§3); other notices keep their channels. **Later.**
- **Workspace membership** (§6.3) — a decision about tenancy, not about search. **Later.**
