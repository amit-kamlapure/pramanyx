# The ontology to Genie's shape, and the coworker as a two-way door — a study and a plan (2026-11-17)

The user, 2026-11-17: *"Complementary changes to be made in the platform itself wherever necessary so that the core
stays strong.. especially the ontology part.. this must be as per Genie Ontology.. lets study that too in deep..
Second, Deepseek harness may already have much features that would help us build a more robust and wider product than
Genie one.. something like e.g. a map in the conversations (based on whats in the connection/database/documents)..
lets use what it has and comply as per our platform architecture on the document uploads, etc. It should be coherent
end to end flow either way.. meaning harness can inject data into platform and read anything from the platform."*

Three studies were read for this, each from primary material:
1. **Genie Ontology**: Databricks' docs (`genie/genie-ontology/`, `uc-semantics/` pages, domains, metric views,
   certification), its API reference (Pages, asset links, domains) and seven blogs, read 2026-11-17.
2. **The DeepSeek Harness**: the 331 installed packages (dsh 0.2.2-rc.1) and our overlay.
3. **Our own knowledge layer**: on `claude/after-pr-23`, read only.

The companion study of Genie One as a whole is `docs/GENIE_ONE_STUDY_2026-11-17.md`. Four claims from the code study
were checked again by hand (marked ✔).

## 1 · How Genie Ontology works

**Two kinds of knowledge, and modelled always wins.**

- **Modelled knowledge.** People write it.
  - **Metric views**: a YAML source of measures, dimensions, many-to-one joins, synonyms and windows.
  - **Pages**: a governed definition of a term, with one owner, one domain, up to 50 synonyms, a Markdown body that
    tags assets with `@`, and links to tables, dashboards, queries, notebooks, apps, agents, people and URLs. A Page
    is DRAFT or PUBLISHED. Anyone may suggest an edit as a batch. A manager publishes, a curator certifies or
    deprecates, comments are kept, and every change is audited.
  - **Certification**: one tag, `system.certification_status` (`certified` or `deprecated`), on any asset, a Page
    included.
  - **Domains**: a hierarchy of up to five levels with business and technical owners. An asset joins a domain by a
    tag, or inherits it from its catalog or schema. A domain Genie suggests waits for a curator.
- **Learned knowledge: "snippets".** Calculations, business rules and relationships extracted from dashboards, SQL
  (dbt included), notebooks, pipelines, agents and metric views.
  - Each snippet shows a description, its source asset, an author, domains and lineage.
  - It **inherits its source's permissions** and **cannot be edited**: to change one, a person changes the source or
    models the concept as a Page.
- **Ranking.** Authority comes from the source, how often a snippet is used, how fresh it is, certification, the
  author's standing, and closeness to the asker (teammates weigh more).
  - Modelled knowledge, certified assets and curated agents take precedence.
  - When Genie cannot settle a conflict, **it asks the person**.
  - Domains pick the meaning of a term that fits the question's business area.
  - Order of retrieval: data assets, then Pages, then a few snippets, then live sources over MCP, then SQL.
- **Not shipped.**
  - The **Ontology Manager** (a review queue to promote learned knowledge into Pages, gap alerts, coverage per domain,
    a graph view) is "coming soon".
  - No feedback path into the ontology is documented. Genie Agents' own docs say behaviour "does not change based on
    user feedback alone".
- **Around it.**
  - A search index of Drive, Confluence, Jira and Workday, with each document's ACL enforced and rechecked at query
    time.
  - People from Workday: email, manager and title.
  - Power BI semantic models as snippets, in Beta.

## 2 · Where our knowledge layer stands against it

| Genie | Ours | State |
|---|---|---|
| Metric views | Metrics with a lifecycle and gates; approved = "use exactly", retired = "do not use", on both answer paths | **Have**. Approval is by anyone with the define capability, not only the owner |
| Pages | **Definitions**: a Record claim, approved by its owner only, opened at `/definitions/<term>` | **Partial**: no synonyms, domain, linked assets, draft/published, suggested edits or certification. ✔ The prompt shows neither tier nor owner (`semantic/connection_kb.py:90`) |
| Certification of any asset | Metrics have statuses. Tables have Layer, Off and Retiring; a governed-tag plane exists (`govern/tags.py`) with no route to set it | **Absent** for tables, queries, dashboards, documents. Never a ranking signal |
| Domains with owners | `entity.domain` written by a model; organisation domains not read by chat | **A label** |
| Snippets with source, author, domains, lineage, inherited permission | Findings, trusted queries, `usage` claims, verdicts, corrections, documents. Record claims carry warrants, tier, author, `as_of`. Permission is inherited at read from the tables beneath (three hops); documents carry their source's ACL | **Have**, stricter (a finding is ground only when a person confirmed it). Two MCP reads skip the permission trim (findings, trusted queries) |
| Authority ranking, asks on conflict | The graph slice is ordered by soundness, match, coverage, warrant and recency. ✔ `ontology/authority.py` (verified > certified > use > source > author > recency, and "a person has to settle this one") is called only by the provenance panel; ✔ `ontology/ranking.py` only by its test. Asking happens for vague words, never for rival definitions | **Partial**: the order exists and is not on the answer path |
| Review queue, gap alerts, coverage | Six separate queues (actions inbox, ontology recommendations, divergences, graph review, coverage proposals, intake candidates); framing misses counted with no wording | **Partial**: none ordered by use or complaints; no "asked often, no definition" |
| Feedback into the ontology | Right raises an answer's claims to `approved`; Wrong withdraws them, teaches corrections and the ambiguity ledger. A chat 👎 changes nothing | **Have**, ahead of what Genie documents |
| Search index with ACLs; people | Confluence, Notion, Slack with readers; a CSV directory with managers | **Partial**: no Drive or Jira; no weighting by person |
| External semantic models | dbt descriptions only; metric dictionaries; Ossie | **Partial**: no dbt metrics, LookML or Power BI |
| What only we have | Formulas executed against live data; tiers and warrants on every fact; the result gate and answer check; people's verdicts named | — |

**Defects found on the way** (each confirmed by reading the code):

1. ✔ **An outside agent can post a fact the planner calls person-confirmed.** `record/claims.py:162` lets a non-person
   post tier `approved` or `declared` if any `attestation` warrant is attached, and nothing checks that the warrant
   names a real verdict. `post_claim` over MCP leads there. Once the graph rebuilds, the claim is shown to the planner
   under "Findings a person has confirmed".
2. ✔ **A Definition's approval is invisible to the model.** The prompt block has no tier and no owner.
3. ✔ **Explorer findings nobody confirmed still reach the quick answer**, through "What the platform already knows"
   (`briefing/compose/sources.py:579`), while the graph slice withholds them. Two decisions of the user meet here: 10-30,
   "these pieces become the whole context", and 11-13, "not ground unless a person confirmed it". Which one rules is the
   user's call.
4. **Uploaded documents have no owner and are readable by the whole organisation** (`knowledge/access.py:38`).
5. **Two MCP reads skip the permission trim**: explorer findings and trusted queries.

## 3 · What the harness gives us, and what it does not

**It has** (with where it is):

- **Right-pane tab types and file renderers.** `ctx.sidebarRightTabs`, `ctx.documentPreviews`.
- **Document preview.** Markdown, PDF, Word and PowerPoint (converted to PDF), Excel and CSV in a sheet view (16 MiB,
  250k cells).
- **Sandboxed HTML and JS.** A Blob iframe, `sandbox="allow-scripts"`.
- **Attachments of any type and size**, kept by content hash under the coworker's home.
- **Hooks**:
  - `session/event` sees every message, including an attached file's block;
  - `agent/pre-step` can change what a step is given;
  - `tools/pre-execute` can make any tool **ask the person** first.
- **Agent tools**: ask-the-person questions (on), plan mode, goals, to-dos, sub-agents, skills.
- **Action cards** under an answer (`propose_action`).
- **Off by default**: session search, voice input (a local model), the agent team.
- **For running coworker turns from the platform**: ACP, a headless profile and an SDK.

**It does not have:**

- Any chart or map library. Our card brings Vega.
- A path for an MCP tool's structured result: only text and images are kept, which is why units and chart settings
  do not reach the card.
- MCP-app UIs.
- An upload event.

An attached CSV reaches the agent as a path "to read with file tools", which our profile turns off, so **today an
attached file is dead weight**.

**Still on in our profile and reaching the host** (to turn off):

- the terminal service (its page is off);
- workspace-file reads outside the workspace;
- the shell's checkout path in the agent's context (`includeRuntimeContext`);
- `cordis-host-runner`, `ptc-runtime`, open-in-app, the directory picker.

**Maps: what we already have.**

- Vega forms for a country choropleth (218 shapes) and a latitude/longitude point map.
- Profiling that recognises latitude, longitude, ISO countries, US states and US ZIP codes.
- A map piece on dashboards and a map block in the Briefing.

Missing:

- sub-national shapes (Indian states and districts, US states);
- city detection;
- any geocoding of addresses.

The prompt already promises region and state names that no shape can match.

## 4 · The one architecture: the platform holds, the coworker carries

Every write from the coworker enters through one of the platform's own doors, as the person, and lands as a draft,
a proposal or a person's record. Every read comes back as a platform object with an id the app can open.

| Direction | What | Door | Lands as |
|---|---|---|---|
| In | A file attached in the conversation | Host hook on `session/event` → `POST /sheets/files` (CSV, TSV, Excel, Parquet, JSON) or the document upload (PDF, Word, PowerPoint, Markdown, text) | A **sheet** or a **document** owned by the person, private until shared; the conversation is then held to it |
| In | "Remember that X means Y", "that's wrong, it should be Z" | A tool | A **Definition draft** or a **suggested edit**, at the person's word; the owner publishes |
| In | "Save this as a skill", "make an agent from this", "keep this on a dashboard" | Action cards under the answer → existing endpoints (`/agents/custom/propose`, skill save, dashboard keep) | A draft the person confirms |
| In | Right / Wrong | Already built | A verdict named to the person |
| In | A schedule | Already built | An automation |
| Out | Answers, definitions, certification, domains, sheets, documents, dashboards, the Briefing, runs | MCP reads, each with the person's permission trim | Platform objects, opened beside the conversation as the app's own pages |
| Out | A map | The answer's grid → the platform's Vega map forms, in the card; shapes shipped with the install | An exhibit like a chart |

Rules that hold the whole way:

- **An agent never writes a person's tier.** It may propose; only a person's click publishes, approves, certifies or
  sends.
- **A file never becomes a figure through model-written code.** It becomes a sheet or a document, and the governed
  path reads it.
- **Every side effect the coworker starts asks first in the conversation** (`tools/pre-execute` "ask"), and the
  answer is recorded as the person's.

## 5 · The plan, in order

**Phase 0: close what the studies found.** Small, and each is a defect.

1. Refuse a non-person `approved`/`declared` claim unless its attestation names a real verdict by the person it
   claims to be (fix at `record/claims.py:162` and the ledger route).
2. Give an uploaded document an owner, and make it private until shared.
3. Apply the permission trim to the findings and trusted-query reads over MCP.
4. Turn off the host-reaching rows still on in the coworker's profile.
5. Show a Definition's tier and owner to the planner.

**Phase 1: the ontology to Genie's shape (platform).**

1. **Definitions become Pages**:
   - synonyms that drive matching;
   - one domain;
   - a body that links assets (tables, metrics, dashboards, documents, people);
   - draft and published;
   - suggested edits from anyone, published by the owner;
   - an API, and MCP reads and writes.
2. **Certified and deprecated on every asset** (tables, metrics, Definitions, trusted queries, dashboards, documents),
   set by an owner or a curator through the governed-tag plane. "Deprecated" is said to the planner as "do not use".
3. **Domains people declare**: a hierarchy, owners, membership by tag (inherited from a connection or schema), and
   model-suggested domains that wait for a curator. A term with two meanings resolves by the question's domain.
4. **One authority order on the answer path**: wire `ontology/authority.py` into metric and Definition choice and the
   graph slice. Verified first, then certified, modelled, person-confirmed, use, freshness and author. **When rivals
   remain, ask the person** (the shell's question tool in the coworker, the clarify step in the app), and keep the
   choice as a Definition draft. Verification still outranks every popularity signal.
5. **Learned items read as one kind**: source asset, author, domains, lineage, freshness and use count, with permission
   inherited at read, behind one retrieval. No new store.

**Phase 2: the coworker as a two-way door.**

1. **Files in**: the upload hook. A sheet or document is made as the person; the answer is held to it; it opens in the
   right pane, where the shell's preview already draws Excel, CSV, PDF and Office files.
2. **Knowledge in**: "remember" and "correct" become Definition drafts and suggested edits.
3. **The menu under an answer** as action cards: Create agent, Save as skill (naming the approved metrics it is held
   to), Keep on a dashboard, Schedule. Each one asks first.
4. **Maps in the conversation** (decided 2026-11-17, below):
   - **MapLibre GL JS, bundled** with the coworker's card. No CDN, as the card already bundles Vega.
   - **Base map: OpenFreeMap's vector tiles.** Free and MIT-licensed, with no API key and no limits on views or
     requests, and its access logs keep no IP addresses. Data is © OpenStreetMap, and the attribution is shown, as
     MapLibre adds it.
     - What leaves the install is only which map squares are viewed. The answer's points and shapes are drawn in the
       browser from the platform's rows and never leave.
     - An organisation setting chooses the base map: OpenFreeMap's public tiles, the install's own tile server
       (OpenFreeMap self-hosts the planet in about 170 GB and publishes weekly MBTiles/PMTiles), or none (shapes on a
       blank ground).
   - **What is drawn comes from the connection**:
     - latitude/longitude columns as points;
     - country, state and district names or codes as filled shapes, matched against shapes shipped with the install:
       countries as today, plus Indian states and districts and US states, from an openly licensed source checked
       before it ships;
     - cities, once profiling detects them.
     The same map in the app, the coworker and an export.
   - **Geocoding** (an address to a point): OpenFreeMap provides none. It would be a self-hosted geocoder, or an
     outside one behind an organisation setting, off by default, since the addresses themselves would leave.
   - A `.geojson` file opens as a map in the right pane.
5. **What the card cannot see today**: carry column units and the chart's settings over MCP. Our own MCP server
   writes them into the text the card parses, since the shell keeps no structured result.
6. **Asking before a side effect**: `tools/pre-execute` asks the person for schedules, file intake and drafts.

**Phase 3: what Genie has announced and not shipped.**

1. **One review queue**, the Ontology Manager:
   - gaps ("asked N times, no definition", from framing misses and the receipts' undefined metrics);
   - learned candidates (confirmed findings, `usage` claims, divergences, Wrongs, 👎);
   - conflicts.
   It is ordered by use and complaints and routed to each domain's owner, with a coverage view per domain.
2. **dbt metrics and semantic models, LookML, Power BI** → metric and Definition candidates.
3. **Session search and per-person conversations**; then recall of a person's own past conversations.
4. **Weighting by a person's standing in a domain**, once months of named verdicts exist.

## 6 · Decided by the user, 2026-11-17

1. **Findings: confirmed only, everywhere.** An explorer finding nobody has confirmed reaches no answer path, the quick
   answer's "what the platform already knows" included; it is still shown in the app, where a person can confirm it.
   This supersedes the 10-30 framing for findings; decisions, discussions and deep analyses stay in that block.
2. **Maps: "Why not integrate free maps available as plugin and ship it with harness? … something like
   openfreemap.org?"** Yes, as written in Phase 2.4. MapLibre is bundled and OpenFreeMap's tiles are the base map.
   What leaves is only which map squares are viewed. The setting can point to a self-hosted tile server or to none.
   Geocoding stays off by default.
3. **An uploaded file is private to the person until they share it.**
4. **Anyone may draft a Definition or suggest an edit**, the coworker included on a person's behalf. Only the owner
   publishes.
