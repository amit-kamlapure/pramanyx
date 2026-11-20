"""A staged change in a person's words: what Allow would do, line by line (one coworker, two places, 2026-11-20).

The Ask panel draws a staged change on its card in the conversation; the coworker app draws one too, since the user chose
"Staged card in chat" for it: the person allows a change once, after seeing what changes. The staging tools' own
summaries are written for the model (they name the proposal and "the inbox"), so a person's card reads this instead —
the same lines wherever it is drawn, and never an id.
"""
from __future__ import annotations

from typing import Any

_CLIP = 220


def _clip(value: Any, most: int = _CLIP) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= most else text[: most - 1] + "…"


def _cron_words(cron: str) -> str:
    parts = str(cron or "").split()
    if len(parts) != 5:
        return _clip(cron, 60) or "on a schedule"
    minute, hour, dom, _month, dow = parts
    at = f"{int(hour):02d}:{int(minute):02d} UTC" if hour.isdigit() and minute.isdigit() else ""
    if dom == "*" and dow == "*":
        return f"every day at {at}" if at else "every day"
    if dom == "*" and dow in ("1", "MON", "mon"):
        return f"every Monday at {at}" if at else "every Monday"
    return f"on the schedule {cron}"


def _when(conditions: Any) -> str:
    for c in conditions if isinstance(conditions, list) else []:
        cfg = (c or {}).get("config") or {}
        kind = (c or {}).get("kind")
        if kind == "schedule":
            return _cron_words(str(cfg.get("cron") or ""))
        if kind == "metric":
            return "when its monitor fires"
        if kind:
            return f"on {str(kind).replace('_', ' ')}"
    return ""


_EFFECT_WORDS = {"investigate": "a deep analysis", "ask": "a question answered", "slack_post": "a Slack post",
                 "email": "an email", "webhook": "a call to a web address", "brief": "a brief"}


def _then(effects: Any) -> list[str]:
    out: list[str] = []
    for e in effects if isinstance(effects, list) else []:
        cfg = (e or {}).get("config") or {}
        kind = str((e or {}).get("kind") or "")
        words = _EFFECT_WORDS.get(kind, kind.replace("_", " ") or "a step")
        if kind == "slack_post":
            channel = str(cfg.get("channel") or "").strip()
            words += f" to {channel}" if channel else ", to a channel still to choose"
        elif cfg.get("question"):
            words += f": “{_clip(cfg.get('question'), 140)}”"
        out.append(words)
    return out


def _automation_lines(chain: dict) -> list[str]:
    lines = [f"Name: {_clip(chain.get('name'), 80)}"] if chain.get("name") else []
    when = _when(chain.get("conditions"))
    if when:
        lines.append(f"Runs: {when}")
    for i, step in enumerate(_then(chain.get("effects"))):
        lines.append(f"{'Then' if i == 0 else 'And then'}: {step}")
    return lines


def _number(v: Any) -> str:
    return f"{v:,}" if isinstance(v, (int, float)) and not isinstance(v, bool) else str(v)


def said_of(p: Any) -> dict:
    """``{"asks", "lines", "why", "needs_choices"}`` for a staged proposal: the question its card asks, what Allow would
    do line by line, the reason it was drafted, and whether it has choices still open that only the full card takes."""
    kind = str(getattr(p, "kind", "") or "")
    params = dict(getattr(p, "params", None) or {})
    detail = dict(getattr(p, "detail", None) or {})
    lines: list[str] = []
    asks = "Allow this change?"
    if kind == "chart_look":
        title = str(detail.get("title") or "the chart")
        asks = f"Change how “{title}” is drawn?"
        lines = ([str(detail["stand_in"])] if detail.get("stand_in") else []) + [str(x) for x in detail.get("lines") or []]
    elif kind == "agent_draft":
        asks = "Make this agent?"
        lines = [f"Name: {_clip(params.get('name'), 80)}", f"Instructions: {_clip(params.get('instructions'))}",
                 f"Works on: {params.get('schema_scope') or 'every table of the connection'}",
                 f"Documents: {len(params.get('doc_ids') or []) or 'none attached'}"]
    elif kind == "agent_bundle":
        agent = dict(params.get("agent") or {})
        asks = "Make this agent and its schedule?"
        lines = [f"Agent: {_clip(agent.get('name'), 80)}", f"Instructions: {_clip(agent.get('instructions'))}",
                 *_automation_lines(dict(params.get("automation") or {}))]
    elif kind == "automation_draft":
        asks = "Save this automation?"
        lines = _automation_lines(params)
    elif kind == "automation_state":
        action = str(params.get("action") or "change")
        name = str(getattr(p, "action_id", "") or "").split(":", 1)[-1]
        asks = {"pause": "Pause this automation?", "resume": "Resume this automation?",
                "delete": "Delete this automation?"}.get(action, "Change this automation?")
        lines = [f"{action.capitalize()}: “{_clip(name, 80)}”" + (f" until {params['until']}" if params.get("until") else "")]
        if action == "delete":
            lines.append("A delete cannot be undone.")
    elif kind == "automation_edit":
        asks = f"Change the automation “{_clip(detail.get('automation_name'), 80)}”?"
        lines = [f"{_clip(d.get('field'), 40)}: {_clip(d.get('before'), 80)} → {_clip(d.get('after'), 80)}"
                 for d in detail.get("diff") or [] if isinstance(d, dict)]
    elif kind == "monitor_bundle":
        chain = dict(params.get("automation") or {})
        asks = "Set up this monitor and its alert?"
        lines = [f"Watches: {_clip(detail.get('watches'), 120)}",
                 f"Fires when: it moves more than {detail.get('sigma')}σ from usual" if detail.get("sigma") else "",
                 f"Checked: {detail.get('check_cadence') or 'hourly'}",
                 *[f"Then: {step}" for step in _then(chain.get("effects"))]]
    elif kind == "brief_draft":
        asks = "Send this brief on a schedule?"
        lines = [f"Name: {_clip(params.get('name'), 80)}",
                 f"Sent: {detail.get('send_words') or _cron_words(str(params.get('send_cron') or ''))}"]
    elif kind == "agent_limit":
        asks = "Change this agent's limit?"
        label = str(params.get("label") or params.get("limit") or "limit").lower()
        lines = [f"{_clip(params.get('agent'), 60)}: {label} {_number(params.get('before'))} → "
                 f"{_number(params.get('value'))} {params.get('unit') or ''}".rstrip()]
    elif kind == "agent_grant":
        asks = "Let this agent propose one more action?"
        lines = [f"Action it may propose: {_clip(params.get('action_id'), 80)}",
                 "It may only propose it: a person still allows each one."]
    why = _clip(str(getattr(p, "reasoning", "") or "").split(" OPEN CHOICES:")[0].split(" NOTE:")[0], 300)
    if not lines and why:
        lines = [why]
    return {"asks": asks, "lines": [x for x in lines if x], "why": why,
            "needs_choices": bool(detail.get("open_choices"))}
