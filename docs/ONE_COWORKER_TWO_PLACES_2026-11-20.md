# One coworker, two places — what was built, and whether two runtimes are still worth it

2026-11-20. The decision (the user, the same day): one Pramanyx coworker in two places — the Ask panel beside the work
and the coworker app full screen — sharing its abilities, its approvals, its conversations, memory and trace. Unify
the experience and the orchestration, not the runtime. A Data Canvas keeps its canvases (spaces on chosen tables), and
their conversation is the same one. This note records each stage as built and seen live, and Stage 5: the measurement
of whether two runtimes are still worth keeping.

## What each stage built

| Stage | Built | Seen live |
|---|---|---|
| A — the loop | Dates written as one of seven formats (chart, table, chart prompt); a tool that says no twice is not run a third time; a refusal says what can be changed and never names a setting by its field; a stand-in for what no setting does says so on its card; a turn that spends its steps offers **Keep going** instead of "ask a narrower question"; plain step words. | "Write the months as YYYY-MM": 2 steps, 13.8 s (before: 7 refusals, then a give-up). "Give the line a neon glow": the card opens "Not possible here: a neon glow. This is the closest the chart can do." |
| 2 — one list, one rule | `pramanyx/abilities.py`: one row per ability (step words, what it needs, whether it stages, where it is offered) and ONE rule, `allowed()`: a read goes ahead; a staged change goes ahead to its card, where the person allows it once; anything else that spends or changes asks once unless a written reason says otherwise. `GET /abilities` serves it; the coworker reads it and keeps no list of its own; a staged change shows in the coworker as its card (`GET /kinetic-actions/inbox/<id>/said`, the same lines wherever drawn), allowed through the coworker's own door as the person. | A monitor staged in the coworker without asking first; its card listed what it watches, when it fires and where it posts (a channel still to choose); Reject was recorded as the person. |
| 3 — one record | Each coworker turn is filed in the platform's conversation store under `coworker:<session>`; a question the coworker asks as a step is filed in that same conversation, and holds the coworker's reply when it asked the person's own question; the panel's history and the Data Canvas threads mark the coworker's conversations; the coworker lists the person's conversations in the app ("In the app"); the panel's conversation reads what the person asked to be remembered. Traces were already one store. | "How many rows are in the netflix_titles sheet?" asked in the coworker: one conversation, one turn, the coworker's reply over the step's query, listed in the panel's history as the coworker's. |
| 4 — orchestration in the panel | `plan` (shown above the work, ticked as it goes, kept when the steps fold), `ask_in_parallel` (helpers side by side), `make_dashboard` (handed to the dashboard drafter, staged whole); a request of several parts is recognised and told to plan first and hand each part to the ability made for it, with four more steps per part; Keep going carries what the queries found; a long silent phase keeps the stream open. | See the acceptance test below. |
| Data Canvas | Its Conversation page and an opened canvas take the panel's composer and conversation: no Quick/Agent picker (`/agent`, `/quick`), the same abilities and rule, staged cards, Keep going, plans and helpers, scoped to the canvas's tables. An agent the person arrived talking to is said in the composer and can be let go. | Both places show the panel's composer; the canvas keeps its landing. |

## The acceptance test

"Our revenue dropped yesterday. Investigate why, create a monitoring dashboard, and notify the team if it happens
again." — asked in the Ask panel on the Sheets Olist data, four times, nothing allowed. About 47 model calls in all, on
the install's current model (a free OpenRouter model, up to 100 s a call).

1. Answered by an old rule before the conversation saw it ("Dashboards are drafted in the Briefing"). Fixed: a quick
   turn the conversation serves takes a dashboard request.
2. Eight hand-written queries, no plan, no hand-off; the answer was withheld by the grounding check. Fixed: a request of
   several parts is recognised and told to plan and hand each part on.
3. Planned and ticked; the dashboard was handed to the drafter, which refused: no approved metric, trusted query or
   finding measures revenue on that connection (a dashboard is built from approved records only). Steps ran out before
   the alert; Keep going then planned again and repeated the exploration. Fixed: four more steps per part, the why goes
   to the deep analysis, Keep going carries what the queries found.
4. Planned, and the why handed to the deep analysis — which ran 320 s in one phase without a frame, and the web's fetch
   dropped the stream at six minutes; nothing was filed, and the panel now shows "Answer failed". Fixed: both stream
   bridges send an SSE comment after 20 s of silence. Not run again: the model-call allowance was spent.

What the test still needs to pass end to end on this data: an approved revenue metric (or a trusted query) on the
Sheets connection for the drafter to build from, and a model fast enough for a deep analysis inside a turn.

## Stage 5 — are two runtimes still worth it?

**Abilities (live `GET /abilities`).** 81 in all: 30 offered in both places, 22 in the panel only, 29 in the coworker
only. 7 of the shared ones are written twice (once among the panel's tools, once in the MCP server) rather than declared
once as the Spotlight roster is; 2 pairs are the same work under two names (`answer_question` / `ask`, `platform_help`
/ `platform_guide`). By the one rule: 62 go ahead, 12 are staged for an Allow on their card, 7 ask once.

**A week of model turns (the trace store, 2026-11-13 to 11-20).**

| | App (panel, canvas, Ask) | Coworker |
|---|---|---|
| Turns | 68 | 51 |
| Median time | 34 s | 22 s |
| 90th percentile | 219 s | 189 s |
| Model calls per turn (median) | 4 | 3 |
| Tokens per turn (median) | 35K | 58K |
| Turns with an error | 1 | 4 |

Every call was unpriced, so cost is compared in tokens: a coworker turn reads about two thirds more, most of it the
shell's own context. Turn times overlap; the coworker's median is lower because more of its turns are single reads.

**What only one runtime does.**

- The coworker's shell: helpers as sessions of their own that run while the conversation goes on, a todo list, the
  conversation compacted as it grows, steering and queueing a message mid-turn, attachments as files, its own schedule
  and agents pages, and its own session store.
- The panel's conversation: in-process with the platform — staged cards drawn from the record, a chart or dashboard on
  screen as the subject, Keep going, the plan, the panel's own abilities (changes to a chart or dashboard, a new
  dashboard, rows on a sheet, where a table comes from).

**Recommendation.** Keep both runtimes for now; they no longer drift, because what they can do, how each thing is
allowed, and the record are one. Re-measure when three things are true: the 7 abilities written twice are served from
one declaration (as the Spotlight roster is) and the two same-work pairs are one; the gaps worth closing are closed
(memory, email drafts and web search in the panel; chart and dashboard changes in the coworker); and models are priced,
so a turn's cost can be compared rather than its tokens. Retiring a runtime is the user's decision, not this note's.

## Not done, and known

- Keep going and a plan are not restored after a page reload (neither frame is stored with the turn).
- A turn cut off mid-stream showed "Completed" with nothing under it until reloaded; reloaded, it says "Answer failed".
- The coworker's step words and its staged list are copies held equal to the rows by tests, not read from
  `GET /abilities` at run time.
- The coworker served its plugins from a worktree since 11-13; repointed to the live checkout on 11-20.
