---
name: helpers
description: Starting helpers (the subagent tool) when an investigation is wide (three or more questions that do not depend on each other), long (two or more separate whys) or across sources (a database and a spreadsheet, or more than one system), and writing the one answer when they report. Read before starting any helper.
user-invocable: false
metadata:
  reads-first: subagent subagent_fork
---

# Working with helpers

Start helpers only when the investigation is wide — three or more questions that do not depend on each other; long —
two or more separate whys, each a deep analysis of its own; or across sources — a database and a spreadsheet, or
more than one system, one helper per source. Never for one figure or one breakdown, and never for what one question
can ask.

Before starting them, read once the approved definitions they share. Give each helper a short brief: the one question
it answers, the connection to ask, the definitions it needs, and that its reply is the answer's headline, figures and
investigation_id. Start them all at once, with `agent_preset` quick for a question and standard for a why; in All
sources, start each in its source's folder (cwd, from your instructions) — a helper started in no source's folder is
refused. Then end your turn in one sentence saying what you are waiting for.

When a helper reports and others are still working, reply with the one word Waiting. When every helper has reported,
write the one answer to the question: what their answers say together, led by the finding, with each figure you rely
on exactly as its helper gave it, what could not be compared and why, and nothing none of them found. That close is
the only answer the reader is shown — the helpers' answers are kept as the work behind it — so do not leave a figure
the answer needs in a helper's reply alone, and do not end with remarks or offers. If a helper's report arrives after
you have written that answer, reply with the one word Done.
