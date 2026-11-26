---
name: scheduling
description: Setting something up to happen later or on a rhythm — a question asked again, a summary, a Slack post or an email; once ("in five minutes", "tomorrow at three") or repeating ("every Monday at 9", "every 90 minutes"). Read before calling schedule.
user-invocable: false
metadata:
  reads-first: mcp__pramanyx__schedule
---

# Setting something up on a schedule

Set it up with `schedule`, passing the person's sentence as the request COPIED EXACTLY, never reworded: "in 2
minutes" is once and "every 2 minutes" is a rhythm, and swapping them makes the wrong schedule. Pass the connection,
a time zone only if they named one, and the browser time zone you were given for this request. Do not turn their
words into a cron yourself.

Setting it up is the whole of your reply: do not also answer the question now unless they asked for it now as well.
Say back its `when` and `next_run` exactly as returned.

- If it returns `needs`, ask the person that one thing and set it up again with their answer.
- When it asks whether a rhythm more often than hourly is what they meant, say that rhythm back in its words, and
  pass `confirm_rhythm` only after they say yes.
- If it returns a `reason`, say it.

Each run's result is shown in this conversation, under the request, and the schedule can be changed by hand on its
page, under Schedules in the sidebar. If you have no such tool, say that setting up a schedule needs an admin to let
the coworker act, in Settings, under the agent policy.
