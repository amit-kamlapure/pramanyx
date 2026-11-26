---
name: scheduling
description: Setting something up to happen later, on a rhythm or when something happens — a question asked again, a summary, a Slack post or an email; once ("tomorrow at three"), repeating ("every Monday at 9") or on an event ("when yesterday's orders land"). Also when an answer waits on something that has not happened yet, to offer to come back to it. Read before calling schedule.
user-invocable: false
metadata:
  reads-first: mcp__pramanyx__schedule
---

# Setting something up on a schedule

Set it up with `schedule`, passing the person's sentence as the request COPIED EXACTLY, never reworded: "in 2
minutes" is once and "every 2 minutes" is a rhythm, and swapping them makes the wrong schedule. Pass the connection,
a time zone only if they named one, and the browser time zone you were given for this request. Do not turn their
words into a cron yourself.

It can wait for something to happen as well as for a time — "when yesterday's orders land", "when a new store
appears", "when a new finding is recorded": pass that sentence the same way, and the platform turns it into the trigger
it has, or says it has none.

Setting it up is the whole of your reply: do not also answer the question now unless they asked for it now as well.
Say back its `when` and `next_run` exactly as returned.

- If it returns `needs`, ask the person that one thing and set it up again with their answer.
- When it asks whether a rhythm more often than hourly is what they meant, say that rhythm back in its words, and
  pass `confirm_rhythm` only after they say yes.
- If it returns a `reason`, say it.

Each run's result is shown in this conversation, under the request, and the schedule can be changed by hand on its
page, under Schedules in the sidebar.

## Offering to come back to it

When an answer cannot be finished because something has not happened yet — the day's data has not landed, a figure
is still settling, a table is mid-backfill — say so, and offer once, in one short sentence at the end of your reply,
to come back to it: at a time ("tomorrow at 9") or when it happens ("when yesterday's orders land"). Nothing is set up
until they say yes; then set it up with `schedule`, from their words. Do not offer it for what you can answer now, and
if they don't take it up, leave it. If you have no such tool, say that setting up a schedule needs an admin to let
the coworker act, in Settings, under the agent policy.
