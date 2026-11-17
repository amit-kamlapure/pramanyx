"""DS-15 — conversation authors the canvas: describe an outcome, get a drawn chain.

The shape is the one this platform already uses for every governed write: **a proposal,
never an execution**. The model drafts, the same validators a save runs refuse a draft
that could not be saved, a dry run shows what it WOULD do, and a human arms it. A grant
here is permission to propose — which is what the rest of this codebase already means by
one, so this wave adds a new author rather than a new kind of authority.

Three things make the draft honest rather than plausible:

* **It is offered only what THIS deployment has.** The prompt carries the palette's own
  answer about which kinds work here and why the others do not, plus the real ids — the
  Slack bots that exist, the metrics that are defined, the vetted queries that are stored.
  A model that is never shown a channel it cannot post to cannot propose posting to it.
* **It is refused by the same code a save is refused by.** The draft is constructed as an
  `Automation`, so every model validator and `validate_chain` runs: an unknown effect
  kind, a missing required key, a binding onto a step that does not exist, a fan-out over
  something that is not a list. A proposal that would not save is not drawn.
* **It fails CLOSED, with a reason.** `actions/propose.py` fails open to `[]` because
  proposing an action garnishes an answer somebody already asked for. Here the proposal IS
  the request, so answering "nothing" to "build me a chain" would be a silent no — the
  caller gets a refusal that names what went wrong instead.

Nothing here writes. The one thing this module must never learn to do is save what it
drafted; the human who reads the dry run is the whole point.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

#: The chain a model may draft. Deliberately the AUTHORING shape and no more: no id, no
#: `enabled`, no `exposed_as_tool`, no schedule state. A draft that could arrive already
#: armed, or already exposed as an MCP tool, would be a proposal that had made a decision
#: the human is being asked to make.
class ProposedStep(BaseModel):
    kind: str = ""
    alias: str = ""
    config: dict = Field(default_factory=dict)
    when: list[dict] = Field(default_factory=list)
    when_logic: str = "all"
    else_of: str = ""
    for_each: Optional[dict] = None


class ProposedTrigger(BaseModel):
    kind: str = ""
    config: dict = Field(default_factory=dict)


class ProposedChain(BaseModel):
    """What the model returns. Prose fields included, because a chain a person has to arm
    needs a name and a sentence they can judge it by."""

    name: str = ""
    description: str = ""
    conditions: list[ProposedTrigger] = Field(default_factory=list)
    condition_logic: str = "all"
    effects: list[ProposedStep] = Field(default_factory=list)
    #: The model's own account of what it could not do. Asked for explicitly, because the
    #: alternative is a chain that quietly drops the half of the request it could not
    #: express — and a person reading a drawn canvas has no way to notice the absence.
    notes: str = ""


@dataclass
class ChainProposal:
    """A staged chain, or a refusal that says why. Never a saved automation."""

    verdict: str                       # "proposed" | "refused"
    reason: str = ""
    draft: Optional[dict] = None       # the CreateAutomationRequest-shaped payload
    dry_run: dict = field(default_factory=dict)
    notes: str = ""
    #: SP-7 — the choices the request did not make, left OPEN in ``draft`` rather than guessed.
    to_fill: list[str] = field(default_factory=list)
    #: SP-7 — when the first run would be if the draft were accepted now (ISO UTC), read by the
    #: scheduler's own trigger; "" for a chain with no schedule.
    first_run: str = ""


_SYS = """\
You design AUTOMATION CHAINS for Pramanyx. A chain has TRIGGERS (when it runs) and STEPS
(what it does, in order). You will be given exactly what this deployment can do; propose a
chain using ONLY that.

Rules that decide whether your proposal is accepted at all:
- Use only the trigger and step kinds listed as AVAILABLE. A kind listed as unavailable
  cannot be used no matter how well it fits — say so in `notes` instead.
- Every kind's required config keys must be present, with real ids from the lists given.
  Never invent a bot id, a metric name, a query id or an action id.
- A step may read an earlier step with {"$from": "<alias>.<key>"}, using only the keys that
  step PUBLISHES. Give a step an `alias` when a later step reads it.
- A binding is an OBJECT in the config, never text inside a string. Correct:
  {"message": {"$from": "summary.answer"}}. WRONG: {"message": "{\"$from\": \"summary.answer\"}"}
  — that posts the literal characters. A field is EITHER a whole binding or a plain
  string; a binding cannot be embedded in a sentence.
- Only a key marked as a list may be used as a `for_each` source.
- A Slack channel is the person's to name. If the request names none, leave `channel`
  empty — never pick one. When more than one Slack bot could send it and the request
  names none, leave `bot_id` empty too. An empty choice is shown to the person to fill.
- If the request cannot be built from what is available, return no effects and explain in
  `notes`. A partial chain that silently drops half the request is worse than a refusal.

Prefer the smallest chain that does what was asked. Name it in the user's words.

A QUESTION a step asks (an `investigate` step's `question`) is what the person wants found, for which
period — as they would ask it: "Top 5 product categories by revenue yesterday". Never tell the analysis
how to report: no "state the date range or source you used", no "explain", no caveats to add, no format.
Keep a period as the person said it — "yesterday", "last week", "this month": each run reads it afresh
from its own day. Never turn it into a calendar date the person did not say; a daily schedule asking
about one fixed date would answer the same day forever.
Each answer keeps its own record of how it was answered, shown beside it, and the platform says itself
whether a figure may still change.

WHEN IT RUNS — a `schedule` trigger's `cron` holds one of two things:
- a five-field cron for a rhythm: "0 9 * * 1" is Mondays at 09:00, "0 8 * * 1-5" weekdays at 08:00,
  "*/15 * * * *" every 15 minutes;
- for what a cron cannot say, a recurrence of two lines — a start, then the rule — written with a real
  newline between them. Once: "DTSTART:20261116T150000\nRRULE:FREQ=DAILY;COUNT=1". Every 90 minutes
  from a start: "DTSTART:20261116T090000\nRRULE:FREQ=MINUTELY;INTERVAL=90". Every second Monday:
  "DTSTART:20261116T090000\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO". The first Monday of each month,
  six times: "DTSTART:20261207T090000\nRRULE:FREQ=MONTHLY;BYDAY=1MO;COUNT=6".
Times are the person's own clock, given below with the time NOW: "in 5 minutes", "tomorrow at three" and
"tonight" are worked out from it, and a one-off is a recurrence with COUNT=1. Never write a start that has
already passed.
"""


def the_clock(named: str = "", here: str = "") -> str:
    """The clock a sentence's times are read in — the person's clock, one order for the whole platform
    (`kernel.clock.person_clock`): a zone they named; else their own; else where they are (``here``, else the browser
    zone this request carried); else the organisation's; else "" — UTC."""
    from pramanyx.kernel.clock import person_clock
    return person_clock(named, here)


def _time_section(clock: str) -> str:
    """What time it is, in the clock the draft's times are read in: a request said as "in five minutes" or "tomorrow
    at three" is worked out from it (2026-11-16 — the proposer was never told the time, so it could draft only a
    rhythm)."""
    from zoneinfo import ZoneInfo
    now_utc = datetime.now(timezone.utc)
    try:
        here = now_utc.astimezone(ZoneInfo(clock)) if clock else now_utc
    except Exception:  # noqa: BLE001 — an unknown clock is read as UTC, and said so below
        here, clock = now_utc, ""
    return (f"NOW: {here:%A %Y-%m-%d %H:%M} in {clock or 'UTC'} (that is {now_utc:%Y-%m-%d %H:%M} UTC). "
            f"Write every time in {clock or 'UTC'}.")


#: Said to the proposer when the request comes from a conversation (the coworker), whose card shows each run.
_FROM_A_CONVERSATION = (
    "THE PERSON ASKED IN A CONVERSATION. What each run finds is shown in that conversation, under the request: "
    "\"here\", \"to me\", \"show me\" and \"let me know\" need no sending step — do not add one. Add a Slack "
    "post or an email only when the request names one.")


def _deployment_section(conn_id: str) -> str:
    """Everything the model is allowed to use, in the deployment's own words.

    Built from the SAME sources the canvas reads — the palette for what is placeable and
    why, the dataflow tables for what each kind publishes and may bind, the registry for
    the real objects. A prompt assembled from a second, hand-written list of kinds would
    drift from the one the save enforces, and the drift would show up as a proposal that
    validates in the prompt and is refused by the code.
    """
    from pramanyx.automations.dataflow import BINDABLE_FIELDS, LIST_PUBLISHED, PUBLISHED_KEYS
    from pramanyx.automations.models import required_keys
    from pramanyx.automations.palette import entries

    lines: list[str] = ["AVAILABLE TRIGGERS AND STEPS ON THIS DEPLOYMENT:"]
    for row in entries(conn_id):
        family = "trigger" if row["group"] == "trigger" else "effect"
        need = ", ".join(required_keys(row["kind"], family=family)) or "no required keys"
        if row["availability"] != "ready":
            lines.append(f"- {row['kind']} — UNAVAILABLE: {row['reason']}")
            continue
        pub = row["publishes"]
        publishes = ("anything that operation returns" if pub is None
                     else ", ".join(pub) or "nothing")
        listy = LIST_PUBLISHED.get(row["kind"], ())
        bit = f" (a list: {', '.join(listy)})" if listy else ""
        lines.append(
            f"- {row['kind']} — {row['label']}. {row['description']} "
            f"Requires: {need}. Publishes: {publishes}{bit}. "
            f"Bindable: {', '.join(BINDABLE_FIELDS.get(row['kind'], ())) or 'nothing'}")

    # Guard against a table that grew a kind the palette does not offer: the model must
    # never be told about a kind it cannot place, but a kind it CAN place must never be
    # missing either.
    offered = {r["kind"] for r in entries(conn_id)}
    for kind in PUBLISHED_KEYS:
        if kind not in offered:
            logger.debug("kind %s is not offered by the palette; not proposed", kind)

    lines.append("")
    lines.append(_objects_section(conn_id))
    return "\n".join(lines)


def _objects_section(conn_id: str) -> str:
    """The REAL ids a step may name. Without these the model invents plausible ones, and a
    plausible id is the failure mode that looks most like success."""
    from pramanyx.components.registry import components

    by_family: dict[str, list[str]] = {}
    try:
        for c in components(conn_id):
            if c.family in ("trigger", "effect"):
                continue                      # the kinds are listed above, not here
            label = f"{c.kind} ({c.label})" if c.label and c.label != c.kind else c.kind
            if c.availability != "ready" and c.reason:
                label += f" [{c.reason}]"
            by_family.setdefault(c.family, []).append(label)
    except Exception as exc:                  # a roster that cannot be read is not fatal
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "component roster is advisory for the chain proposer",
                 counter="chain_propose.roster")

    _title = {"metric": "GOVERNED METRICS (use the name as `metric`)",
              "trusted_query": "TRUSTED QUERIES (use the id as `query_id`)",
              "declared_action": "DECLARED ACTIONS (use the id as `action_id`)",
              "connector": "CONNECTOR TYPES", "platform_tool": "PLATFORM TOOLS",
              "mcp_tool": "MCP TOOLS"}
    out = ["REAL OBJECTS ON THIS CONNECTION — never invent an id:"]
    for family, items in by_family.items():
        if family in ("connector", "platform_tool", "mcp_tool"):
            continue                          # not addressable from a chain step
        out.append(f"{_title.get(family, family)}: " + ("; ".join(items) or "none"))
    out.append(_bots_section())
    return "\n".join(out)


def _bots_section() -> str:
    """The Slack bots that actually exist, by id — `slack_post` names one."""
    try:
        from pramanyx.slackbots.store import list_bots
        bots = [f"{b.id} ({b.name})" for b in list_bots() if getattr(b, "enabled", True)]
    except Exception:
        bots = []
    return "SLACK BOTS (use the id as `bot_id`): " + ("; ".join(bots) or "none configured")


def _as_binding(value: Any) -> Any:
    """A string that IS a binding, turned into one. Anything else untouched.

    Found by driving it live: the model returned `"{\"$from\": \"step.key\"}"` — a STRING
    holding the JSON of a binding — and nothing refused it, because a string is a legal
    literal. The chain validated, dry-ran clean, and would have posted those characters to
    Slack. A well-formed wrong answer, which this codebase treats as worse than an
    exception.

    Only an EXACT match is repaired: the whole value must parse to an object whose single
    key is `$from`. A binding embedded in a sentence is left alone deliberately — the
    engine cannot interpolate one, so guessing at what the author meant would replace a
    visible mistake with an invisible one.
    """
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not (text.startswith("{") and "$from" in text):
        return value
    try:
        import json
        parsed = json.loads(text)
    except ValueError:
        return value
    if isinstance(parsed, dict) and set(parsed) == {"$from"} and isinstance(parsed["$from"], str):
        return parsed
    return value


def _repair_bindings(drafted: "ProposedChain") -> None:
    """Walk a draft's step configs and un-stringify any binding the model wrote as text."""
    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            return {k: walk(_as_binding(v)) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(_as_binding(v)) for v in node]
        return node

    for step in drafted.effects:
        step.config = walk(step.config)


#: How an open choice reads to a person, by the key it leaves empty.
_CHOICE_WORDS = {"channel": "a Slack channel", "bot_id": "a Slack bot to send it"}


def _named_in(text: str, value: str) -> bool:
    """Does the request itself name ``value`` — a channel with or without its ``#``, or a bot
    by its name or id? Whole words only, so ``#general`` is not named by "generally"."""
    v = (value or "").strip().lstrip("#").strip().lower()
    if not v:
        return False
    return re.search(rf"(?<![\w-])#?{re.escape(v)}(?![\w-])", (text or "").lower()) is not None


def _enabled_bots() -> list[tuple[str, str]]:
    """``(id, name)`` of every enabled Slack bot — the senders a ``slack_post`` could name."""
    try:
        from pramanyx.slackbots.store import list_bots
        return [(str(b.id), str(getattr(b, "name", "") or "")) for b in list_bots()
                if getattr(b, "enabled", True)]
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the bot roster is advisory for whether a sender is ambiguous",
                 counter="chain_propose.bots")
        return []


def _open_unnamed_choices(drafted: "ProposedChain", outcome: str) -> list[tuple[int, str, str]]:
    """SP-7 — blank, in place, every deployment choice the REQUEST did not make.

    Found in the user's own staged draft: asked for "anomalies to slack every morning at
    9am", the model posted to ``#general`` as whichever bot it saw first, and nothing could
    refuse either — both are legal values, and the approver would have had to notice the
    channel was invented. So the rule is deterministic rather than prompted: a Slack channel
    stays only if the request names it, and a sender stays only if the request names it or it
    is the one bot there is. Returns ``(action number, key, why)`` for each blanked key.
    """
    opened: list[tuple[int, str, str]] = []
    bots = _enabled_bots()
    for i, step in enumerate(drafted.effects, start=1):
        if step.kind != "slack_post":
            continue
        cfg = step.config
        if not _named_in(outcome, str(cfg.get("channel") or "")):
            cfg["channel"] = ""
            opened.append((i, "channel", "the request names no Slack channel"))
        chosen = str(cfg.get("bot_id") or "")
        if len(bots) == 1:
            cfg["bot_id"] = bots[0][0]          # one sender: nothing to choose
        elif len(bots) > 1 and not any(
                chosen == bid and (_named_in(outcome, name) or _named_in(outcome, bid))
                for bid, name in bots):
            cfg["bot_id"] = ""
            opened.append((i, "bot_id",
                           "more than one Slack bot could send it and the request names none"))
    return opened


#: The step kinds a model-drafted chain holds for a person: a declared warehouse write,
#: and an OUTBOUND SEND — a Slack post reaches a real channel and real people, so a chain
#: a model drafted from a sentence must not fire it unattended on its first run either
#: (the custody gap a live 9am tick surfaced 2026-09-16: the hold covered warehouse writes
#: only, and a drafted anomaly chain would have posted to Slack with nobody having said so).
#: `notify` is deliberately NOT here — it fires a preconfigured incoming webhook a PERSON
#: already stood up and pointed somewhere, which is that person's standing decision.
def _drafted_held_kinds() -> tuple[str, ...]:
    from pramanyx.automations.dataflow import DECLARED_WRITE_KIND
    return (DECLARED_WRITE_KIND, "slack_post")


def _hold_drafted_writes(drafted: "ProposedChain") -> list[int]:
    """SP-7 — a write or an outbound send a model drafts into a chain waits for a person.

    The approval switch (``PRAMANYX_ACTION_APPROVAL``) was opt-in until 2026-10-04 — with it
    off, a drafted write inside an armed chain ran unattended — and is on by default since;
    this hold never depended on it either way. A chain a PERSON builds by hand is
    that person's decision; one a model drafted from a sentence is not, so each of its held
    steps carries ``require_approval`` and the dispatcher asks a human — on the first run,
    and on every run until a person clicks "always allow" and mints a standing send-grant
    (SP-12b). Returns the action numbers held.
    """
    held_kinds = _drafted_held_kinds()
    held: list[int] = []
    for i, step in enumerate(drafted.effects, start=1):
        if step.kind in held_kinds:
            step.config["require_approval"] = True
            held.append(i)
    return held


def _first_run(conditions: list, now: datetime, timezone: str = "") -> str:
    """The earliest next fire of the draft's schedule triggers (ISO UTC), or "".
    Evaluated in the draft's own clock (SP-13) — `next_fire_utc` normalizes back to
    UTC, so the Z this stamps stays true whatever zone the cron is read in."""
    from pramanyx.automations.engine import next_fire_utc
    times = []
    for c in conditions:
        if c.get("kind") != "schedule":
            continue
        t = next_fire_utc(str((c.get("config") or {}).get("cron") or ""), now, timezone)
        if t is not None:
            times.append(t)
    return min(times).strftime("%Y-%m-%dT%H:%M:%SZ") if times else ""


#: A schedule set up from a conversation that would run more often than this is not made until the person says the rhythm
#: is what they meant (2026-11-17, found testing the merged coworker: "In 2 minutes, show me …" reached the designer as
#: "every 2 minutes, show …", and an analysis every two minutes, with no end, was made and armed).
CONFIRM_MORE_OFTEN_THAN_MINUTES = 60


def rhythm_to_confirm(draft: dict, now: Optional[datetime] = None) -> str:
    """The open choice a sub-hourly rhythm leaves, in words the person can answer — or "" when the draft runs once, or no
    more often than hourly. Read by the scheduler's own clock (`next_fire_utc`): the two next runs, and the gap between."""
    from datetime import timedelta

    from pramanyx.automations.engine import next_fire_utc
    from pramanyx.automations.recurrence import RecurrenceError, is_recurrence, parse, said_when
    now = now or datetime.now(timezone.utc)
    clock = str(draft.get("timezone") or "")
    for c in draft.get("conditions") or []:
        if c.get("kind") != "schedule":
            continue
        cron = str((c.get("config") or {}).get("cron") or "")
        first = next_fire_utc(cron, now, clock)
        second = next_fire_utc(cron, first + timedelta(seconds=1), clock) if first else None
        if first is None or second is None:
            continue
        minutes = int((second - first).total_seconds() // 60)
        if minutes >= CONFIRM_MORE_OFTEN_THAN_MINUTES:
            continue
        try:
            read = parse(cron, clock) if is_recurrence(cron) else None
        except RecurrenceError:
            read = None                         # a cron, or a rule its trigger already read: no end it can name
        ends = bool(draft.get("expires_at")) or bool(read and (read.count or read.until))
        every = "every minute" if minutes <= 1 else f"every {minutes} minutes"
        return (f"How often: as drafted it runs {every}{'' if ends else ', with no end'} ({said_when(cron, clock)}) — "
                "more often than once an hour. Say that rhythm back to the person in those words and ask whether it is "
                "what they meant; set it up again with confirm_rhythm only if they say yes, or with their own words for "
                "when it should run.")
    return ""


def propose_chain(outcome: str, *, conn_id: str, provider: Any = None, timezone_name: str = "",
                  clock_here: str = "", from_conversation: bool = False) -> ChainProposal:
    """Draft a chain for ``outcome``, validate it, dry-run it. Never saves.

    ``provider`` is injectable so the suite can exercise every path here without spending a
    token — this repo has already paid once for tests that reached a live model.

    ``timezone_name`` is a clock the person named; ``clock_here`` the clock where they are (the browser's). Which one
    the times are read in is `the_clock`'s order. ``from_conversation`` says the request came from a
    conversation, which shows each run itself (2026-11-16: a sentence is THE way to schedule anything — the user,
    after seeing the agent shell's scheduler take "deliver me AI news in the next 5 minutes here")."""
    from pramanyx.automations.models import Automation

    if not (outcome or "").strip():
        return ChainProposal(verdict="refused", reason="describe what the chain should do")

    # SP-13 — the clock the draft's times are read in (`the_clock`); "" keeps UTC, the platform's default and every
    # pre-SP-13 chain's clock.
    draft_tz = the_clock(timezone_name, clock_here)
    try:
        prov = provider
        if prov is None:
            # The strong reasoner, for the reason the action proposer states one file over:
            # this is high-stakes JUDGMENT — pick kinds, wire aliases, satisfy required
            # keys — and the fast tier proposes chains that do not validate.
            from pramanyx.llm.provider import get_provider
            prov = get_provider("coder")
        system = "\n\n".join([_SYS, _time_section(draft_tz), *([_FROM_A_CONVERSATION] if from_conversation else []),
                               _deployment_section(conn_id)])
        drafted = prov.complete(system=system, user=outcome, response_model=ProposedChain, temperature=0.1)
    except Exception as exc:
        logger.warning("chain proposer failed: %s", exc)
        return ChainProposal(
            verdict="refused",
            reason=f"the proposer could not draft a chain: {exc}")

    if not drafted.effects:
        # The model was asked to say so rather than invent a chain it could not build.
        return ChainProposal(verdict="refused", notes=drafted.notes,
                             reason=drafted.notes or "nothing on this deployment can do that")

    # DS-19 / §6 item 26 (d) — a model may NEVER author SQL. Refused, not stripped: a
    # silently emptied step would fail the save with a confusing message about a missing
    # `query_id`, and this deployment would never learn its proposer had tried.
    #
    # The user's argument, 2026-09-19, which is why the line is absolute rather than
    # cautious: *"Never — thats the whole point. Investigate node exists separately to
    # form its own SQL, etc"*. A node whose job is "a model writes the SQL" already ships
    # — governed, spanned, grounded and repaired by the writer's own loop — so a second
    # one carrying none of that machinery has no reason to exist. The two nodes are not
    # competing shapes of one idea; they are the model's path and the person's, and each
    # is already whole.
    authored = [i for i, step in enumerate(drafted.effects, start=1)
                if step.kind == "trusted_query" and (step.config or {}).get("sql")]
    if authored:
        return ChainProposal(
            verdict="refused", notes=drafted.notes,
            reason=("a proposed chain may not carry SQL: step "
                    + ", ".join(str(i) for i in authored)
                    + " wrote its own. A trusted query step names a query a person "
                      "authored and verified; to have a model write SQL, use Investigate."))

    _repair_bindings(drafted)
    opened = _open_unnamed_choices(drafted, outcome)
    held = _hold_drafted_writes(drafted)

    payload = {
        "conn_id": conn_id,
        "name": drafted.name or "Proposed chain",
        **({"timezone": draft_tz} if draft_tz else {}),
        "description": drafted.description or "",
        "conditions": [c.model_dump() for c in drafted.conditions],
        "condition_logic": drafted.condition_logic or "all",
        "effects": [e.model_dump(exclude_none=True) for e in drafted.effects],
    }

    # The SAME refusal a save performs. A draft that could not be saved must not be drawn:
    # a canvas showing a chain the Save button will reject is worse than a refusal, because
    # it looks like work that is nearly done.
    # SP-7 — only the choices opened above are placeholder-filled for validation; any OTHER
    # missing key is still the model's failure and still refuses, exactly as before. The draft
    # a person sees keeps its open choices empty.
    checked = {**payload, "effects": [dict(e, config=dict(e.get("config") or {}))
                                      for e in payload["effects"]]}
    for number, key, _why in opened:
        checked["effects"][number - 1]["config"][key] = "…"
    try:
        automation = Automation(**checked)
    except Exception as exc:
        return ChainProposal(verdict="refused", notes=drafted.notes,
                             reason=f"the drafted chain is not valid here: {exc}",
                             draft=payload)

    try:
        from pramanyx.automations.engine import run_automation
        run = run_automation(automation, dry_run=True)
        dry = run.model_dump()
    except Exception as exc:
        # A draft that validates but cannot even be previewed is still worth returning —
        # the human can fix it on the canvas — but it is returned WITHOUT a receipt rather
        # than with a fabricated one.
        logger.warning("dry run of a proposed chain failed: %s", exc)
        dry = {}

    to_fill = [f"Action {number} needs {_CHOICE_WORDS.get(key, key)} — {why}"
               for number, key, why in opened]
    held_note = ("" if not held else
                 f"Action {', '.join(str(n) for n in held)} waits for a person on every run: a "
                 f"write drafted from a sentence is never unattended. ")
    return ChainProposal(verdict="proposed", draft=payload, dry_run=dry,
                         notes=held_note + (drafted.notes or ""),
                         to_fill=to_fill,
                         first_run=_first_run(payload["conditions"], datetime.now(timezone.utc),
                                              draft_tz))
