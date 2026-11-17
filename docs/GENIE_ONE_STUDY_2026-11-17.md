# Genie One against the coworker — a second study (2026-11-17)

The user, 2026-11-17: *"go study Genie One again in terms of what all it can do, how it does it and then compare with
our harness on what it does and what is pending."*

**Sources.** Genie One: Databricks' own pages only, read 2026-11-17. Almost every docs page was updated between 2 and 16
November 2026. They are the product page, the `genie-one/` and `genie-agents/` docs, the Genie Ontology, Pages,
traces, budgets and MCP governance docs, the November release notes and ten blog posts; the URL list is at the end.
Third-party coverage was not used. Ours: the code on `claude/after-pr-23` (4e336f6, live), `coworker/README.md` (the
coworker's own ledger of what is on, off and not done), the MCP server's tools, and the first study
(`docs/GENIE_ONE_STUDY_2026-11-12.md` in the old repo, with its §7 build log to 2026-11-15) and the 2026-09-08 verdict.

**Two corrections to the first study.** The "introducing Genie One / Ontology / Agents" post is dated 16 June 2026 (Data
+ AI Summit), not 26 April. "Skip to a faster answer", noted from a screenshot on 11-14, is on no Databricks page; the
documented control is Genie Agents' **Answer now**, which stops the reasoning and answers from what it has.

Status words: **Have** · **Partial** · **Pending** · **Refused** (decided against, with the reason). Genie's own
statuses: GA, Public Preview, Beta, or *announced* when no docs page exists.

## 1 · What Genie One is now, in one paragraph

A home for every employee (web, desktop, Chrome new tab, mobile, Slack, Teams, and inside ChatGPT, Claude, Copilot and
Grok through its MCP server). A question goes first to a matching **Genie Agent** (a scoped space of up to 50 tables,
with Chat, Agent and Flash modes), else to a search of data assets. Knowledge has two parts: modelled knowledge (metric
views, **Pages** of governed definitions, certification, domains) always outranks learned **snippets** (from
dashboards, SQL including dbt, notebooks and agents). The learned snippets are ranked by an authority score (source,
use, freshness); on a conflict Genie One asks. Documents come from a search index that carries each source's ACLs
(Drive, Confluence, Jira, Workday). Live tools are MCP connectors on per-user OAuth (Gmail and M365 draft only, Slack
send, Calendar, Jira, GitHub, custom MCP). Write tools pause for **Allow once / Always in this chat / Reject**, or an
AI classifier auto-approves in-scope actions. Around it sit **skills** (SKILL.md folders, created by an interview,
invoked with "/", publishable to Unity Catalog), **scheduled tasks** (time-based in the docs), documents and artifact
decks, a Beta code sandbox, private memory, and governance through Unity Gateway: acts as the user, OpenTelemetry
traces, per-user budget thresholds, audit tables. Free to users until 31 January 2027.

## 2 · Side by side

### Surfaces
| Genie One | Ours | State |
|---|---|---|
| Web home: Discover, search, For you, Domains, starter questions, Schedules; admin brand, logo, welcome, pinned assets | First screen: suggested questions per connection, questions asked lately, a person's own agents; Schedules in the sidebar | **Partial**: no Discover, For you, Domains or admin branding |
| Desktop (macOS GA 11-12, Windows Beta), Chrome new tab (Beta) | None | **Pending** (low) |
| Mobile, with push when a task runs | None | **Pending** (low) |
| Slack and Teams (GA 11-09), as the asking user, per-asker tool approval | The platform's Slack bot and a Teams door, each to a custom agent (Arc AO-5c). Not to the coworker | **Partial** |
| MCP server for other assistants (GA), plugins for ChatGPT, Claude, Copilot, Grok | The platform's MCP server: 26 tools, plus one per custom agent and one per declared action. The coworker reaches the platform through it alone. No packaged plugin, no per-user OAuth on it | **Partial**: the server exists; the packaging does not |
| API, SSE streaming (Beta) | `/ask` and its stream | **Have** |

### The conversation
| Genie One | Ours | State |
|---|---|---|
| Routes to a matching agent first, else searches assets | A conversation is **held** to its connection by a tool guard (a boundary, not an instruction). A custom agent is asked by its own tool, never chosen automatically | **Partial**: no routing to the right agent |
| Chat, Agent (plans many queries, cited report, PDF), Flash; **Answer now**; steering while it answers | Quick and Agent. Agent starts **helpers** (sub-agents) by need, with one output. Stop is the shell's | **Partial**: no Answer now; Quick uses the same model as Agent (no fast role); steering mid-turn not verified |
| File upload: CSV/Excel, PDF, images, Office files; 100 per conversation (GA 10-16) | The platform takes CSV/Excel (Sheets) and documents. In the coworker the shell's file panel is on, but the agent has no file tools and nothing hands a file to the platform | **Pending**: the first thing people will try |
| History: pin, rename, search, download; **recall past conversations** (own only, cited) | The shell's list: rename, archive, delete, one newest-first list | **Partial**: no recall, download or pin; conversations are not yet separated per person |
| Share a conversation, read-only | None | **Pending** |
| Web search, cited (Beta) | Built: an organisation setting, off by default, cited, never a figure. No provider configured here | **Have** (off) |
| Starter questions from metadata only | Suggested questions per connection; the first read costs a model call | **Have** |
| Workspace instructions file, group-aware | Per-connection `AGENTS.md` written at start; declared definitions reach the answer | **Partial**: no organisation-wide instructions a person edits |

### The answer
| Genie One | Ours | State |
|---|---|---|
| Text, tables, charts; snippet citations; an Ontology panel (source, author, domains, lineage) | Headline, the platform's own narrative, the exhibit (chart editor, table with totals, SQL). A mark per metric, sheet and ontology object opens the app's own page beside the conversation. **Why this number** opens the receipt | **Have**: deeper provenance (the approved definition, who approved it, whether the answer used it as approved) |
| Thumbs (memories); Genie Agents: Yes / Fix it / Request review | Right / Wrong to `/chat/feedback` and a verdict; a Right raises the answer's claim to `approved`, a Wrong withdraws it | **Have**: never pressed on a live answer yet; a helpers question's close has none |
| ••• menu: **Create agent** (the only documented item) | None | **Pending** (the endpoint `POST /agents/custom/propose` exists) |
| Save as skill | Data Canvas has it for a deep run; the coworker does not | **Partial** |
| Schedule a task (Slack/Teams button) | **Schedule from a sentence**: the platform's designer drafts the whole chain | **Have** |
| Documents drafted into a canvas pane: citations, versions, comments, sharing | None | **Pending** |
| Artifacts and slides: decks with a data snapshot, presenter view (Beta 11-12) | Export of an answer to PDF, PowerPoint, Word, Excel, built from the stored rows; dashboards in the app | **Partial**: no deck built from a conversation |
| Excel, Word, PowerPoint from Genie One itself: not documented | **Have** (from the stored answer, never from model-written code) | **Ahead** |

### Agents
| Genie One | Ours | State |
|---|---|---|
| Create an agent from a prompt in chat; edit it in plain words | `POST /agents/custom/propose` and the app's form; not from the coworker | **Partial** |
| Configure, Monitor (question log, weekly digest), Benchmarks (500 questions, gold-SQL match, LLM judge) | Agent Ops, per agent: Overview, Runs, Doors, Map, Alerts, Quality, Spend, Setup; golden sets with paired runs | **Have** (in the app) |
| An agent's MCP tools: read tools run, write tools pause for Allow once / Always / Reject | The platform's MCP client behind five gates, for automations; the coworker cannot add an MCP server | **Partial** |
| Document volumes per agent, page-level citations (Public Preview) | The document index (Confluence, Notion), cited; not per agent | **Partial** |

### Skills
| Genie One | Ours | State |
|---|---|---|
| A skill is a SKILL.md folder. Made by an interview, invoked with "/" or loaded when relevant, chained, run on a schedule, published to Unity Catalog and shared (Beta, 11-16) | The shell's skill tool is on and reads a skill folder. Data Canvas saves a deep run as a skill; a learned-skills store exists | **Partial**: no interview to make one in the coworker, no "/" to a platform skill, no publishing. When built, a skill must say which approved metrics it is held to, which Genie's does not |

### Knowledge
| Genie One | Ours | State |
|---|---|---|
| Modelled: metric views, **Pages** (owner, synonyms, domain, certify), certified and deprecated tags, domains | Approved metrics (draft → proposed → approved → deprecated). **Definitions** are Record claims approved by their owner only. Domains are labels; narrowing was measured as not needed at today's model size | **Have** (domains **Partial**) |
| Learned snippets from dashboards, SQL (dbt), notebooks, agents; inherit source permissions | Explorer findings, trusted queries, query-history `usage` claims, **formulas executed against the live data** (unverified ones demoted). A finding is ground only once a person confirmed it | **Have**, stricter |
| Authority ranking (source, use, freshness); modelled wins; asks on a conflict | A deterministic order by soundness, match, coverage, warrant and recency; a person's declaration beats any score | **Partial**: use is not a sort key; no "ask on conflict" |
| Ontology Manager review queue, gap alerts for often-asked concepts with no definition | The actions inbox, unordered; divergence review has no screen | **Pending**. Genie's is "coming soon in Beta" and gap alerts are announced only, so nobody has shipped it yet |
| Power BI semantic models as snippets (Beta) | None | **Pending** (low) |

### Sources
| Genie One | Ours | State |
|---|---|---|
| Unity Catalog data as the user, with row filters and column masks | Connections queried through the governed path, with the connection's credentials. Sensitive values are off, redacted or blocked per agent | **Partial**: the warehouse does not see the person |
| Search index with ACLs: Drive, Confluence, Jira, Workday; SharePoint Beta | Confluence and Notion with page permissions (11-14); Slack channels readable by their members (11-15) | **Partial**: Drive, Gmail and Jira are not indexed |
| Live MCP connectors on per-user OAuth: Gmail and M365 (draft), Calendar, Atlassian, Asana, Slack, GitHub, Glean, custom | Gmail send (the person's click), Slack posts (the bot, held until allowed); the Google grant is the organisation's | **Partial**: no Calendar, Jira or GitHub; tokens are not per person |
| People from a Workday report | A people directory from a CSV (email, name, title, team, manager) | **Have** (CSV); a provider import is **Pending** |

### Actions and approvals
| Genie One | Ours | State |
|---|---|---|
| Write tools behind Allow once / Always / Reject | `draft_email`: only the person's click sends. A Slack post waits for a person until "always allow". Declared ontology actions are `propose_<action>`, into the approvals inbox. The departure gate checks what leaves | **Have**, stricter |
| An AI classifier auto-approves in-scope actions | None | **Refused**: only a person's own click approves |
| Admin approval policies per call (Beta) | The organisation's agent policy (read, run, act; act by default), the departure gate, email probation | **Have** |

### Proactive work
| Genie One | Ours | State |
|---|---|---|
| Scheduled tasks from chat; results in a chat thread and by email with a PDF; email others (11-12); run now; **time-based only** in the docs | A schedule from a sentence becomes a platform automation. Its runs show in the conversation's card (the last three); an email step carries the analysis as PDF, Excel, Word or PowerPoint; run now on the Automations page | **Have**. **Pending**: nothing notifies the person when a run lands |
| Triggers on the data (a metric dip): announced only | Automations fire on the data as well as the clock; monitors; the Briefing | **Ahead** |
| Inbox, always-on jobs that check in, noticing repeated work, watching email and Slack, day prep: announced 11-11, no docs | The daily Briefing, the continuous explorer, monitors and the actions inbox are in the app, not in the coworker. Noticing repeated work and watching email or Slack: none | **Partial** |

### Code, memory, personalisation
| Genie One | Ours | State |
|---|---|---|
| Code sandbox (Beta) | None | **Refused**: no user code; every figure comes from the governed path |
| Memory: "Remember that…", private, cited; suggested memories need approval (GA 9-29) | None in the coworker | **Pending**: fits as a person's own approved claim |
| Activity signals: teammates weighted higher (blog only) | Verdicts name their person since 11-15; no weighting | **Pending**: needs months of named verdicts first |

### Governance
| Genie One | Ours | State |
|---|---|---|
| Acts as the user; no separate permission system | A short-lived delegation for whoever opened the coworker from the app; every platform call and verdict carries it. Opened directly, it is the local operator | **Partial** |
| OpenTelemetry traces: prompt, response, cited assets, tool calls; **Genie Agents not traced**; best-effort | One question is one trace in Agent Ops: the turn, each tool call, the platform's work for it, every helper, every model call (tokens, cost) | **Have**, ahead |
| Per-user budget thresholds (email, webhook, block); "not an absolute cap" | Usage caps checked at the model door before each call, per organisation and per user | **Have** |
| Audit tables | One append-only audit log; the departure journal | **Have** |
| No model choice; OpenAI and Anthropic on Databricks | Roles (narrator, coder, fast) bound by an admin to any chat-completions provider | **Have**. Anthropic's own API is not on that wire yet |

## 3 · Where we are ahead, and why it matters

- **An answer's figures are checked against its rows** (the departure gate's reading, `govern/gathered.py`), and the
  rows against the question first (the result gate). Genie One describes neither.
- **Formulas are executed against the live data**; an unverified one is demoted. Genie ranks snippets by use and
  authority; we refuse to let popularity stand in for being right.
- **What a figure stood on is the thing itself**: the approved definition, who approved it, and whether the answer
  used it as approved. Genie shows a snippet's source and author.
- **Every model call is traced, including helpers'**; Genie Agents are not traced.
- **Triggers on the data**, a governed send gate, and **one definition of "yesterday"** on the person's clock.
- **Office files from the stored answer**, not from model-written code.

## 4 · Pending, in the order I would build it

1. **Files into a conversation.** CSV and Excel become a Sheet, a PDF or Office file a document, each through the
   stores the platform already has, and the answer is held to them. People will try this first.
2. **A run that lands reaches the person.** An unread mark on the conversation and, when asked, an email. Today a
   scheduled run shows only the next time the conversation is drawn.
3. **The ••• menu under an answer:** Create agent (`POST /agents/custom/propose`), Save as skill (Canvas already does
   it for a deep run). Each is a turn in the conversation. A skill names the approved metrics it is held to.
4. **Memory and recall**: "remember that…" as the person's own approved claim, cited when used; recall of the
   person's own past conversations. Needs conversations separated per person first (the delegation exists).
5. **Share a conversation**, read-only.
6. **The promotion queue**, ordered by use and by complaints, and **gap alerts** ("asked often, no definition").
   Genie has announced both and shipped neither.
7. **Drive, Gmail and Jira in the search index** with their permissions; Calendar and Jira as live actions behind the
   same approvals.
8. **Answer now**, and Quick on the fast role.
9. **Documents**: an answer as an editable document with versions.
10. **Surfaces**: the Slack and Teams doors to the coworker (they exist for custom agents), and a packaged MCP plugin
    for Claude and ChatGPT. Desktop, Chrome and mobile last.

Still open in our own ledger and not about Genie: Right and Wrong never pressed live; a helpers question's close has
no Right/Wrong; a column's unit (€, %) not carried over MCP; a deep analysis has no card of its own.

## 5 · Refused, and still refused

- **The code sandbox.** A business figure comes from the governed path, never from code a model ran.
- **The auto-approval classifier.** Only a person's own click approves an action or sends.
- **A vendor's benchmark as our target.** Our golden sets are the instrument (Lux 50/60, theLook 26/30 on 11-15).

## Sources

Docs base `https://docs.databricks.com/aws/en/`: `genie-one/` (overview, chat, code-execution, documents,
artifacts, slides, external-sources, search, people, desktop, mobile, chrome-extension, customize-genie-homepage,
account-only-user-access, api, genie-slack), `integrations/msft-teams`, `agents/mcp-tools/genie-mcp`,
`genie/genie-ontology/` (with search-index, external-knowledge-sources, connect-people-source), `uc-semantics/pages`,
`genie-agents/` (set-up, monitor, external-tools, agent-mode, talk-to-genie, volumes), `ai-gateway/genie-traces`,
`genie/budgets`, `genie/monitor-cost`, `ai-gateway/govern-mcp-service`, `ai-gateway/govern-skills`,
`databricks-ai/partner-powered`, `ai-bi/release-notes/2026`, `release-notes/product/2026/november` and `/october`.
Product page `https://www.databricks.com/product/genie/one`. Blogs under `https://www.databricks.com/blog/`:
introducing-genie-one-genie-ontology-and-genie-agents (16 June), new-genie-autonomous-ai-complex-enterprise-work,
genie-one-ai-cowork-home-everyone, announcing-ga-genie-ontology, enterprise-context-action-genie-agents-now-analyze-more-data-sources-transform-your-work,
bring-your-business-context-chatgpt-claude-microsoft-copilot-cowork-and-grok-bot, genie-one-mcp-now-generally-available,
unity-catalog-pages-governed-home-your-business-knowledge-genie-ontology, teach-genie-one-your-workflows-ultimate-guide-skills-genie-one,
openai-and-databricks-enterprise-ai-your-governed-data. Not read: the pricing table (rendered as "Loading…") and the
11-11 "always-on Genie" press release (not found on databricks.com).
