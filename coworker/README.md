# The coworker

Pramanyx in an agent shell: a chat that asks Pramanyx, and shows what Pramanyx answered as Pramanyx gave it.

The shell is [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT), unmodified. Everything
here is composition — it is built on that shell and changes none of its code. One piece of the shell's own
configuration is copied: its `standard` agent preset, which `profile.patch.yml` restates with the host-reaching
tools taken out, under the shell's MIT licence.

| File | What it is |
|---|---|
| `profile.patch.yml` | An overlay on the shell's stock `web` profile: what is turned off, and what is added. |
| `plugins/answer-card/` | Draws a Pramanyx answer: chart, table, SQL, how it was answered. |
| `plugins/brand/` | Pramanyx's mark, name, tab icon, first-screen wording and look. |
| `plugins/home/` | The first screen under the question box, and the read-only relay it reads Pramanyx through. |
| `build.sh` | Bundles each plugin's browser half; the card carries the chart resolver from `web/components/charts/vega`. |
| `start.sh` | Installs the plugins into the shell's profile and serves the page. |

## What is off, and why

- **The agent's shell, file tools, web search and web fetch.** A business answer comes from Pramanyx's guarded
  path. An agent that could run its own query against the warehouse would skip every check Pramanyx makes.
- **The same tools inside the agent preset.** An agent's tools are mounted in its preset, not in the rows that
  provide them: turning the rows off alone left every tool in the agent's hands. The overlay replaces the shell's
  `standard` preset with a copy that has none of them, and turns the other presets off. That copy was taken from
  shell 0.2.2-rc.1 and has to be taken again when the shell is upgraded.
- **The person's terminal, the embedded browser, and installing plugins from the page.** Each is a way back to
  the above.
- **The host services still behind those pages** (2026-11-17): the terminal's service, the workspace file service
  (its reads may name any path on the machine) with the file tree, the document preview and @file mentions that read
  through it, the host folder picker, "Open in…" (it launches the machine's applications), the host runners for plugin
  code and programmatic tool calls, and the context that told the agent this checkout's path and the page's address.
  A file a person brings in is to go to Pramanyx, as theirs, and open there.
- **Everything that reports to the shell's maker**, and the feedback buttons that would feed it.
- **The shell's own account**: its sign-in, its account settings, its session-log export and "Feedback" entry.
  A person here is who Pramanyx says they are.
- **The shell's own scheduler**: its store of timed reminders, its page, its clock marks on a conversation, and the
  four tools that let an agent make one. There is one scheduler and it is Pramanyx's. Measured side by side
  (2026-11-15): the shell's delivers a sentence into a conversation at a time, with no trigger but the clock, no
  record of what the run produced, no owner, and it stops when this process does; Pramanyx's fires on a clock or on
  the data, runs governed steps, keeps every run, retries, and is the list every other surface shows. It held no
  schedules when it was turned off. What it could say about time that Pramanyx's could not — once, every N from a
  start, the first Monday, five times — Pramanyx's now says (`pramanyx/automations/recurrence.py`).

The overlay is passed on the command line, so it outranks the Settings page: a row turned off here cannot be
turned back on from the interface.

## What is on

- **Pramanyx's model door** (`pramanyx/routers/model_door.py`). The coworker has no model key of its own: it asks
  Pramanyx, which asks the organisation's provider, checks the usage caps first and records the call. It asks
  as the narrator role; which model that is, is chosen in Pramanyx. The roles — narrator, coder, fast — are how
  Pramanyx routes its own work, so the shell's model picker and its page of models are off: a person asking a
  question is not shown them. The door is an organisation's setting, off by default; closed, the coworker shows the door's own
  sentence saying so and where an admin opens it.
- **Two ways to answer, in the app's own words.** Above the question box: **Agent**, the default, works the
  question through — reads the approved definitions, asks for each figure, checks what looks off, runs a deep
  analysis for a why. **Quick** puts the question to the governed path once and says what came back. These are
  the two the app's own chat offers ("How to answer": Quick · Agent). A new conversation starts in Agent. Quick
  mounts none of Agent's planning, delegation, schedule or to-do tools.
- **Pramanyx's MCP server** (`python -m pramanyx.mcp`), a thin client of the running API. The agent reaches
  Pramanyx through it and through nothing else.
- **An answer is laid out to be read.** It takes over the display of the `ask` tool, and of each custom agent's
  `ask_<agent>` tool the first time one is seen. First the headline, then the few sentences the platform itself
  wrote from the rows (its own narrative, carried over MCP with what it marked decisive set bold), then the
  exhibit: a title from its columns, the chart — drawn by the same resolver the app, the PDF export and
  `POST /charts/svg` use — and three icons in its corner: download the rows as CSV, show them as a table, edit
  the visualization. Under the chart, "Show the SQL" and the row count. Then "What stands out", when the platform
  named anything. A single row of numbers is shown as figures, with no chart and no table. The table has
  headings named as the app names them, numbers aligned and grouped, a click on a heading sorts, Totals sums
  each column of numbers, Copy and CSV carry the rows as they were answered. The agent is told the answer is
  shown whole and not to write it again, and its own closing remark is not shown when an answer is.
- **What the platform says is wrong with an answer is said under its headline.** The platform checks the rows
  against the question before it writes a headline (the result gate, `pramanyx/sql/grain_intent.py`): a total
  asked "by status" that came back one row per order is repaired once, and if no query answers as asked the
  headline reads "This does not answer the question as asked" with the reason beside it. That is the
  platform's verdict, carried over MCP (`warning`); the coworker draws it and decides nothing.
- **What a sentence stood on is a mark at its end.** Each metric the answer was held to, each spreadsheet and
  each object of the ontology it read is a small chip after the words; it opens the app's own page for it
  beside the conversation. A metric not used as approved says so on its mark.
- **Things open beside the conversation.** The shell has a right-hand pane with tabs, and the coworker adds a kind
  of tab to it. **SQL** opens an answer's query and rows there. The pencil on a chart opens **Edit
  visualization**: what it is drawn as, its X and Y axis, a colour, labels, tooltip and orientation. What is
  offered comes from the app's own chart vocabulary for that grid; a choice redraws the chart in the conversation
  as it is made and is kept for that answer in the browser. A tab stays through a reload.
- **The work, readable.** A turn's steps read down one line: the agent's own sentence, with a dot, then the calls
  made for it as rows named by what they found — "Total GMV by platform, led by the largest shop · 5 rows" for an
  answer, "Read the definition of the metric: gmv" for a read. A row opens to the SQL and the rows, or to what
  came back. The shell's second fold, one per group of calls, is gone; the turn's own fold stays, and folds all
  of it — the calls and what was said between them — down to the answer.
- **A running turn is folded to its latest row.** While an answer is worked on, one row shows — the call still
  running, or the last one made — above the shell's running line, which carries "Show the work" to open it all.
  The shell keeps a running turn wide open; a long one pushed the question off the screen. The next run starts
  folded again.
- **A result with no query in it gets no card.** When a question is declined, or answered in words with nothing
  run, there is no chart, table or SQL to draw. It is a row in the work that reads "no query run" and opens to
  the words; the agent is told to ask again another way and, if that fails, to say so in its reply.
- **One voice.** The coworker is part of the platform and speaks as it: "I checked the approved definition", never
  "I asked Pramanyx" or "Pramanyx flagged". The agent's instructions say so, and say the tools are its own ways
  of working; the cards, the steps and the first screen do not name Pramanyx as another party.
- **Was this right?** Two icons at the foot of an answer, beside Copy, "Why this number" and "How it was
  answered". Both go to Pramanyx as the app's own control sends them:
  the judgement to `/chat/feedback`, and — when a person says what was wrong, or gives the SQL that would have
  been right — a verdict to `/verify/verdict`, which later answers on the connection are given. The page asks its
  own server (`/pramanyx-feedback`, `/pramanyx-verdict`) and the server asks Pramanyx. These are the only writes
  the page can make, and the route is narrow: POST and JSON only, refused when a browser marks the request as
  another site's, ids checked, the body rebuilt from named fields, two fixed destinations. What was said is
  remembered in the browser by the answer's id, so a card opened again says it and does not ask twice.
- **Pramanyx's identity.** The mark and name in the sidebar and over a new conversation, the tab's title and icon,
  the first screen's wording, the app's dark palette, small corners, and a plain ring where the shell draws its
  animal while an answer is worked on.
- **The sidebar.** New conversation, Agents, Schedules, and conversations in one newest-first list. Agents opens a
  page of a person's own agents; asking one begins a new conversation. Schedules opens the app's own page of
  schedules and automations (`/automations`), in a frame: the one list, where a person makes a schedule, changes
  when it runs, mutes it, runs it now and reads what each run did. The one-list view is the shell's own option,
  chosen once on a first visit.
- **Anything on a schedule, from a sentence** (2026-11-16). Asked to have something happen on a schedule — a
  question asked again, a summary, a Slack post, an email; every Monday, or once in five minutes — the agent passes
  the person's own words to `schedule`, and the platform's own designer (the one behind the Automations page's
  sentence box, `automations/propose.py`) drafts the whole chain from what the install has: when it runs, what it
  does, where it goes. The same checks a save runs refuse a draft that could not be saved; a draft that left a
  choice open (a Slack channel the person did not name) is not made, and the agent asks. What is made is one of
  Pramanyx's automations: it starts at its first scheduled time, runs whether or not the coworker is open, is
  listed under Schedules, and opens on the canvas, where a person can change it by hand. Under the turn that made
  it is a card that draws no copy: it reads where the schedule stands each time it is drawn, and **shows each run's
  result here** — "deliver it here" needs no sending step. A Slack post a model drafted waits for a person on each
  run until one says "always allow"; an email from a new schedule is held at departure while it is on probation.
  Its times are read in a zone the person named, else their own saved clock, else their browser's (the shell tells
  the agent which, on every message), else the organisation's, else UTC — the platform's one clock
  (`pramanyx/kernel/clock.py`). The coworker's page tells its host the browser's zone when it loads; the host keeps it
  in `PRAMANYX_CLOCK_FILE` and every call to Pramanyx carries it (`X-Pramanyx-Clock`), so "yesterday" asked here is
  the day before this person's today, counted the same way as in the app — never moved by a source's settling, and
  said to hold no data when it holds none (2026-11-17). Setting one up is an act: the organisation's
  agent policy allows it by default (since 2026-11-16; `run` before), and an admin can lower it. A schedule that
  would run more often than once an hour is not made until the person confirms the rhythm, said back to them in
  words (2026-11-17: the agent once passed "in 2 minutes" on as "every 2 minutes"); the agent copies the person's
  sentence exactly, and setting a schedule up is the whole of its reply.
- **The first screen.** The mark on a tile over a large headline, then the question box. Under it: questions worth
  asking of a chosen connection as plain lines, and two cards — the questions asked lately (each with its
  connection and how long ago) and a person's own agents. Each row writes a question into the box; nothing is
  asked until it is sent. The tile, the headline size and the box's corners restyle the shell's own elements by
  the names its stylesheet gives them, and fall back to the shell's look if it renames them.
- **A workspace per connection.** At start, each Pramanyx connection gets a folder whose `AGENTS.md` names it, and
  a workspace over that folder titled with the connection's name. The shell gives its agent that file before the
  first question, so the shell's own picker above the question box chooses the connection and the agent is told
  it in its instructions, not in the person's question.
- **The way in and the way back: nine dots.** The app's top bar draws nine dots while a coworker is running, and
  they open it in the full window; the same nine dots, in the coworker's corner, lead back. The coworker says
  where it is to the API (`PUT /coworker/address`, at start and every half minute); the API forgets it after two
  minutes, so the app never offers a way in that leads nowhere. Arriving, the coworker opens a new conversation
  on the connection the app's top bar was on and takes the app's light or dark. Those ride in the address's
  fragment: the shell drops a query string on arrival. The dots open the coworker's own entry page
  (`/pramanyx-enter`), not the shell's address: the shell's sign-in is a cookie a browser withholds on an arrival
  from another site, and the entry page makes the move from inside the coworker's address. Here the dots are
  mounted in the shell's overlay and shown in the header's corner, which holds one thing of the shell's already.
- **What a step read opens beside the conversation.** A metric's definition, an object of the ontology, the
  Briefing, earlier findings: each step's result can be opened as a tab and is laid out to be read — facts as
  name and value, SQL as SQL, a list of like things as a grid that sorts.
- **The app's own pages open beside the conversation.** "Why this number" opens the app's receipt page for an
  answer; the mark of each metric the answer was held to opens that metric's page (`/metrics/<name>`, the
  Semantic Layer's provenance panel: where the definition came from, whose it is, what disagrees with it); each
  table it read opens that entity's page (`/ontology/<type>`, the Ontology's own panel). These are the app's
  pages in a frame, not summaries drawn here, so everything on them works. A metric the answer did not use as
  approved says so on its button. An answer over the Sheets connection offers each spreadsheet it read, which
  opens as `/sheets/<id>`: the spreadsheet as a referenced asset — the sheet itself, with what works on it
  (search, filter, sort, copy, download, views), without the row that takes it elsewhere (dashboard, sharing,
  ontology, combine, chat) — and its tab named by the sheet's own name. Past three ontology objects the rest fold behind one
  button. The tab shows only those four kinds of page.
- **A conversation is held to its connection.** The agent is told which connection a conversation is about, and
  that is an instruction, not a boundary. The boundary is the shell's tool guard: a call to one of Pramanyx's
  tools from a connection's workspace that names another connection is refused before it runs, with a sentence
  the agent repeats to the person. A custom agent asked without a connection is refused too, since it would
  answer on its own. A guard can only refuse; nothing later in the shell turns that back into permission.
  `node --test plugins/home/test/held.test.mjs` covers the rule.
- **A turn is recorded where the platform's runs are.** Agent Ops reads one store, and a coworker turn is in it:
  the question, each tool call and its result, and the end of the turn are sent to the platform as they happen
  (`POST /coworker/trace`, from this machine only), under a trace named `cw-<session>-<turn>` that shows as
  "via Coworker". The model calls are not sent: each one tells the platform's model door which turn it was made
  for (two request headers), and the door files its own record of the call — tokens, model, cost — under that
  turn, so spend is counted once. **One question is one trace:** before a call to the governed answer path the
  coworker tells the platform which step of which turn is asking (`PUT /coworker/claim`), and the platform
  records what it does to answer — its model calls, its query, its checks — under the turn's trace and inside
  that step, where it would otherwise open a run of its own. The words stay here: the system prompt, what the
  agent was given and what it said are in the shell's own log, and each event says where (`shell_session`, `seq`).
  `node --test plugins/home/test/trace.test.mjs` covers what is sent and what is not.
- **Helpers, started by need.** In Agent mode the agent works alone unless the investigation needs more: when it
  is wide (three or more questions that do not depend on each other), long (two or more whys, each a deep
  analysis) or across sources (a database and a spreadsheet, or several systems), it starts helpers — the shell's
  sub-agents — all at once, one question each, under Quick for a question and Agent for a why. A helper answers its
  brief on one connection and starts none of its own. **Held:** a helper of a held conversation is held to the same
  connection, whatever folder it is started in, and a held conversation cannot start one in another connection's
  folder. **All sources**, a workspace beside the connections, is held to none: its instructions list each source and
  its folder, a helper must be started in a source's folder, and is then held to that source. The shell makes a
  helper in its parent's folder and moves it a moment later, so a hold may tighten when a conversation moves into a
  connection's folder, and never loosens or changes. **One question, one trace:** a
  helper's tool calls and model calls are written into the question's trace, inside the call that started it, which
  lasts until the helper finishes; the turns its reports start join the same trace, and the question ends when the
  last helper has reported. **One question, one output** (the user, 2026-11-16): the main agent orchestrates its
  helpers, gathers their reports and writes the one answer. The reader sees the question, then "Worked by N helpers"
  — one folded row per helper, opening to what it was answered (each answer's headline, SQL and rows; the host
  half keeps them as they came back, `/pramanyx-helper`) — and then the main agent's close. No helper's answer is a
  card of its own (no follow-ups, what stands out or Right/Wrong per part), nor is any check the main agent ran
  inside the question; the report notices, the "Waiting" and "Done" replies and the turns that held them are not
  shown. The close is the run's fullest reply that is not bookkeeping, shown wherever in its turn it was said.
  `node --test plugins/home/test/*.test.mjs` covers the record and the hold.
- **A read-only relay**, `/pramanyx/…` on the shell's own server, so the page can read Pramanyx without the API's
  allowed origins being changed. It relays the paths the page reads (`/connections`, `/suggestions`,
  `/agents/custom`, `/investigations`, `/sheets`, an answer's export, what was sent from an email draft, and where
  one schedule stands), GET and HEAD only, and answers 404 for anything else.

## Run it

```sh
./start.sh
```

`scripts/start_all.sh`, at the root, starts the API, the web app and the coworker together, each only if it is
not already up; nothing starts by itself after a reboot. Needs Node 24.9+, pnpm, and the Pramanyx API running. Open the address it prints. No model key is asked for: an
admin allows "Let the coworker ask its models through Pramanyx" in Settings ▸ Organization, once.

## What is not done

- When an answer is shown, the agent's closing remark is not: the answer is the output. The remark is still
  written and kept in the conversation's record. The platform's follow-up questions are carried over MCP and not
  yet shown.
- Figures in the words and the chart are as the platform formats them (€17,857,124.67; 17.9M on a bar). The
  shortened form of the mockup (€17.86m) needs a column's unit, which is not carried over MCP.
- The claim that puts the platform's work inside a turn's trace is matched on the question and the connection,
  because a tool call carries nothing else. It covers `ask`; a custom agent's answer and a deep analysis are
  still recorded as runs of their own. The Trajectory tab in the coworker still shows a call to the platform as one row.
- A deep analysis is one named row that opens to what came back. Its own steps — baseline, decomposition, what
  each concluded — are not drawn, and it has no card.
- A Pramanyx tool added since this was written, and each custom agent's, is named from the end of the first turn
  that calls it; until then that one call shows the shell's plain row.
- The chart is drawn from the answer's grid and chart type. The app's own `chart_config` and column units are
  not carried over MCP yet, so a chart the app would have labelled or formatted specially is drawn plainly here.
- The table shows plain numbers: a column's unit (€, %) is not carried over MCP, so nothing is formatted as
  money. The app's editor also offers a transform (period over period, share, rolling, cumulative), an annotation
  and a pivot; those are not here. Nothing but an answer opens in the right-hand pane yet: not an object of the
  ontology, a metric's definition, a document or a sheet.
- The app's pages are found at the address the coworker was reached from, else `http://localhost:3000`. An install
  that serves the app elsewhere and is opened directly shows an empty frame.
- The exhibit, the table and the editor were checked by hand on a live answer (sort, totals against the approved
  figure, pie, labels off, vertical, back to as answered). No test draws them.
- A result longer than the shell's cap reaches the page cut short. The card reads it without its receipt; a
  result cut inside its rows is not drawn.
- **The relay and the two feedback routes answer without the page's sign-in.** The shell does not put a plugin's
  route behind its token. On this machine that is the same reach as the Pramanyx API already has; if the page is
  ever served to other machines, they must check who is asking first — the feedback routes above all, since they
  write.
- Right and Wrong have not been pressed on a live answer. The route is covered by a test against a stand-in
  Pramanyx (what is sent on, and eleven refusals), checked by breaking each guard in turn; the press itself is a
  person's statement and was left to a person.
- A words-only result is told by what it lacks (no SQL, no rows). Pramanyx says which kind of answer it gave in
  its stream; the MCP client does not carry that yet.
- "Show the work" is a button put on the shell's running line by hand, since the shell has no place there. If the
  shell changes that line, the work stays folded while it runs and opens when the turn ends.
- The voice is an instruction to a model, checked on two live answers. The MCP server's own tool descriptions
  still speak of Pramanyx as someone else, because other callers read them.
- A conversation is held to a connection, not to a set of tables: nothing yet fixes one to a Data Canvas's
  tables. A conversation in the folder the shell was started in, and not a connection's workspace, is not held.
  The agent can still list the connections' names.
- **Four things work around the shell rather than through it**, and each falls back to the shell's own if the shell
  changes: the tab title (a literal in the shell's layout), the first screen's wording (written into the shell's
  dictionary, which cannot be added to), the block under the question box (the shell has no place there) and the
  ring (the shell's drawing has no slot).
- A connection added in Pramanyx appears here on the next start. The folder the shell was first started in stays
  in the picker as a workspace of its own; a question asked there names its connection in words.
- Reading the suggested questions is a cached read in Pramanyx; the first read for a connection costs a model call.
- The light theme takes only the accent, the corners and the type. The app's light palette was not measured.
- Source Sans 3 is used when it is installed; it is not bundled.
- Still the shell's wording: "Workspace Write", "Deep diving", "New Session" on an untitled
  conversation, and its preview notice on first open.
- Not built from the target layout: sidebar entries for discovery and a person's own things; day headings in the
  conversation list (the shell's list has no place for them, and replacing its list would drop its per-row
  rename, archive and delete); pinned items.
- Both modes ask as the narrator role. Quick does not use the fast one: a mode has no model of its own here yet.
  Quick's voice paragraphs are a copy of Agent's in `profile.patch.yml`; a change to one is made in both.
- **A helpers question's one output is the agent's words, checked.** Each helper's answers are the platform's; the
  close that puts them together is written by the main agent. When the question ends, its figures are held against
  the rows of every answer the question gathered — the helpers' and the main agent's own checks — by the departure
  gate's own reading (`POST /coworker/answer-check`, `pramanyx/govern/gathered.py`), recorded as a step of the
  question's trace, and said in one line under it: every figure found, or each one not found with the clause it is
  in. A bare whole number under 1,000 is not checked, as the gate does not check one. Nothing is held: the answer is
  already shown. It has no Right/Wrong of its own. A helper's answers are kept on this machine (`$DSH_HOME/helpers`) and are not in Pramanyx's store.
- **A schedule's result is shown, not sent, here.** The shell's scheduler put each run into a chat as a new turn,
  which the agent then answered. Here a run's result appears in the card under the request the next time the
  conversation is drawn: nothing starts a turn or notifies the person when it lands. Only the last three runs are
  shown. A request needing a step the platform has none of — the news from the web — is refused with the reason.
- **A schedule made here spends model calls unattended.** It is a person's own request, so the organisation's
  setting for model work nobody asked for does not apply to it; nothing else caps it but the usage limits.
- The Schedules page opens on the connection last chosen on the first screen, and the frame takes the app's own
  light or dark, not the coworker's.
- The door relays to a provider on the chat-completions wire. An organisation whose roles are bound to one that
  is not (Anthropic's own API today) is told so by name, and the coworker cannot answer until a role is bound to
  one that is.
- The words of a coworker conversation are not kept in Pramanyx's model-call record; the call, its model, its
  tokens and who asked are.
- On an install where Pramanyx does not require identity, a question from here is the local operator's, the same
  as in the app. Where identity is required, every person here is the one principal the MCP server was started
  as.
- A person who opens the coworker's address directly, and not from the app, has no nine dots: there is no
  place known to go back to. Who they are does not carry across: the coworker has the shell's own access, in the
  address the app is given, and not the app's sign-in.
- The API hands the coworker's address, with the shell's access in it, to the app's page. On one machine that is
  the reach the address printed in the terminal has. An install that serves the app to other machines must decide
  who may be given it; the route accepts only an address on its own machine, from its own machine.
- A custom agent's answer has a card, seen live once. It has no Right and Wrong: the agent's answer does not say
  which connection it was for. An agent's turn may run several queries; the card shows the last one's grid and
  SQL, which is what the platform's fold keeps, and that is not always the one the answer is about.
- No test covers the card's drawing or the tool removal. `node --test plugins/answer-card/test/feedback-route.test.mjs`
  covers the feedback routes. The card was checked by eye on three real answers, one of them
  live; the tool removal by asking a fresh session to list its tools.
