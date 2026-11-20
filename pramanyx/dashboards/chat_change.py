"""A change to the dashboard on screen, asked in the Ask panel's conversation (Stage 1 of the plan, 2026-11-19).

The panel beside a dashboard used to keep asking and changing in two tabs. They are one conversation now: a question asked
about a dashboard its person keeps gets one more tool, ``change_dashboard``, which hands the words to the change the
dashboard's own page drafted with (`dashboards.ask.edit_in_words`) — the same drafting, rules and approval. What it stages
waits for the person's own Allow in the conversation: nothing changes until then, and the model never says it is done.

Only the person's own dashboard gets the tool (the plan's decision 1: it acts only where the person could act themselves).
A shared dashboard, or none, leaves the conversation's tools exactly as they were.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

from pramanyx.agent.tool_loop import ToolSpec

Emit = Callable[[str, dict], None]

_PARAMS = {
    "type": "object",
    "properties": {
        "change": {"type": "string", "description": (
            "The change to the dashboard, in the person's own words: add, move, resize or take off a card, add a page, "
            "publish it to a group. One change request per call.")},
    },
    "required": ["change"],
}


_CHART_PARAMS = {
    "type": "object",
    "properties": {
        "shown": {"type": "object", "description": (
            "Only the setup settings that change: as (table, figure, bar, line, area, scatter), x (a column along the "
            "bottom), bucket (day, week, month, quarter, year), series ([{column, agg}], agg one of count, count_distinct, "
            "sum, avg, min, max; column '' counts rows), split (a column that colours it, '' for none), top (1-12 "
            "colours), segments (stacked, side_by_side, shares), running, labels, across (bars sideways), and for a "
            "table columns, sort, descending.")},
        "viz": {"type": "object", "description": (
            "Only the dressing that changes, null to take one off: lineWidth (1-6, default 2), lineShape (smooth, step; "
            "null is straight), markers, numberFormat (a d3 format such as ',.0f', '$,.2f', '.1%'), dateFormat (how dates "
            "are written along the bottom and in a table: YYYY-MM-DD, YYYY-MM, MMM YYYY, DD MMM YYYY, MMM D, YYYY, YYYY-QQ, "
            "YYYY), yMin, yMax, yLog, sortBy (value, label), top, legend (top, bottom, left, right, none), xTitle, yTitle, "
            "tooltipOff, orient (vertical, horizontal), refLines ([{value, label}]).")},
        "summary": {"type": "string", "description": "What changes, in one sentence of the person's own words."},
        "instead_of": {"type": "string", "description": (
            "Only when the person asked for something no setting of a chart does (a glow, a shadow, 3D) and this change is "
            "the closest: what they asked for, in a few of their own words (\"a neon glow\"). Empty when the change is what "
            "they asked.")},
    },
}


def heard_words(frame: dict) -> str:
    """A step of the drafting, as a line a person reads while it runs — counts and card titles, never the model's words."""
    kind = frame.get("type")
    if kind == "read":
        return (f"Read what the dashboard can be made of: {int(frame.get('metrics') or 0)} metrics, "
                f"{int(frame.get('trusted_queries') or 0)} trusted queries, {int(frame.get('findings') or 0)} findings")
    if kind == "checking":
        n = int(frame.get("cards") or 0)
        return f"Checking a draft{f' with {n} new card' + ('s' if n != 1 else '') if n else ''}"
    if kind == "card" and frame.get("state") == "running":
        return f"Running the card “{frame.get('title') or ''}”"
    if kind == "sent_back":
        n = int(frame.get("points") or 0)
        return f"Repairing {n} point{'s' if n != 1 else ''} the platform sent back"
    return ""


def change_tools(connection_id: str, dashboard: Optional[tuple[str, ...]], *, emit: Optional[Emit] = None,
                 schema: Optional[str] = None, draft: Any = None, record: Any = None) -> list[ToolSpec]:
    """``dashboard`` is ``(person, dashboard id)`` for a dashboard the person keeps — and ``(person, dashboard id, card id)``
    when the question is about one chart of it, which adds ``change_chart`` (`dashboards.chart_look`); None gives no tool.
    ``draft`` stands in for `edit_in_words` and ``record`` for the inbox's `get_proposal` in tests."""
    if not dashboard or len(dashboard) < 2 or not all(dashboard[:2]):
        return []
    person, dashboard_id = dashboard[0], dashboard[1]
    card_id = dashboard[2] if len(dashboard) > 2 else ""

    def run(args: dict) -> dict:
        words = " ".join(str((args or {}).get("change") or "").split())
        if not words:
            return {"staged": False, "said": ["Say what to change."]}
        if draft is None:
            from pramanyx.dashboards.ask import edit_in_words as change
        else:
            change = draft

        def hear(frame: dict) -> None:
            line = heard_words(frame)
            if line and emit is not None:
                emit("status", {"text": line})

        out = change(connection_id, person, dashboard_id, words, schema=schema, hear=hear)
        if out.get("staged"):
            # The card is drawn from the stored proposal, announced as the inbox keeps it — its kind and its action as
            # staged, never spelled again here.
            from pramanyx.agent.dashboard_tool import announce_staged
            if record is None:
                from pramanyx.actions.inbox import get_proposal as read
            else:
                read = record
            staged = read(out["proposal_id"])
            if staged is not None:
                announce_staged(emit, staged)
            # No id goes back to the model: the person sees the change as a card, and a reply naming a proposal or a
            # card by its id reads as the platform's plumbing (seen live 2026-11-19). The drafting's own summary is not
            # handed on either: it is written for the dashboard page's model, names the proposal and any draft it
            # replaces by id, and says the result appears "in the Briefing" (seen live the same day, in Agent mode).
            return {"staged": True,
                    "next": ("A change is staged and shown to the person with Allow and Reject. Nothing has changed yet. "
                             "Say in one sentence what the change does, naming cards by their titles and never by an id, "
                             "and that it waits for their Allow.")}
        return {"staged": False, "said": list(out.get("sentences") or ["No change was drafted."]),
                "next": "Nothing was staged. Tell the person why, in these words."}

    def announced(proposal_id: str) -> None:
        from pramanyx.agent.dashboard_tool import announce_staged
        if record is None:
            from pramanyx.actions.inbox import get_proposal as read
        else:
            read = record
        staged = read(proposal_id)
        if staged is not None:
            announce_staged(emit, staged)

    def chart(args: dict) -> dict:
        from pramanyx.dashboards import chart_look
        a = args or {}
        try:
            staged = chart_look.propose(connection_id, person, dashboard_id, card_id, a.get("shown"), a.get("viz"),
                                        str(a.get("summary") or ""), schema=schema, instead_of=str(a.get("instead_of") or ""))
        except chart_look.Refused as e:
            # what it can change, said with the refusal: a model told only "no" tries other names (seen live 2026-11-20)
            return {"staged": False, "said": e.sentences, "can_set": chart_look.CAN_SET,
                    "next": ("Nothing was staged. Tell the person why in these words, and what can be changed instead (can_set). "
                             "Do not try other names for the same setting.")}
        announced(staged.id)
        stand_in = str((staged.detail or {}).get("stand_in") or "")
        if stand_in:
            # a stand-in is said as one, first (2026-11-20: a thicker line was offered as if it were the glow asked for)
            return {"staged": True, "changes": list((staged.detail or {}).get("lines") or []), "stand_in": stand_in,
                    "next": ("The closest change is staged and shown to the person, with Allow and Reject, under the words "
                             "in stand_in. Nothing has changed yet. Say first that what they asked for is not something a "
                             "chart can do, then in one sentence what the closest change does, and that it waits for their "
                             "Allow. Never say it is made.")}
        return {"staged": True, "changes": list((staged.detail or {}).get("lines") or []),
                "next": ("The change to this one chart is staged and shown to the person, line by line, with Allow and "
                         "Reject. Nothing has changed yet. Say in one sentence what changes and that it waits for their "
                         "Allow. Never say it is made.")}

    tools = [ToolSpec(
        name="change_dashboard",
        description=(
            "Change the dashboard the person is asking from, as they ask: arrange, resize, add or take off cards made from "
            "approved metrics, trusted queries and findings, add a page, or publish it. Use it only when they ask for a "
            "change, never to answer a question. It drafts the change and shows it to them to allow; it is not made until "
            "they do, so never say it is done."),
        parameters=_PARAMS,
        run=run,
    )]
    if card_id:
        tools.append(ToolSpec(
            name="change_chart",
            description=(
                "Change how THE ONE CHART the person is asking about is drawn — its kind, what runs along the bottom, what "
                "is measured, what colours it, its labels, a line's width or shape, its number format, its axes, its "
                "legend, its reference lines. Name only the settings that change, from how it is drawn now (`drawn` in "
                "what is on screen); the rest stay. Use it for any change to this chart's look; use change_dashboard only "
                "to arrange the dashboard. It stages the change for the person to allow; never say it is done. When a "
                "change is not one it makes, say what can be changed in the chart editor's words (line width, dates "
                "written as), never this tool's name nor a setting's field name. Never stage a stand-in as if it were "
                "what they asked: the closest change to something no setting does is staged only with instead_of."),
            parameters=_CHART_PARAMS,
            run=chart,
        ))
    return tools


_NEW_PARAMS = {
    "type": "object",
    "properties": {
        "about": {"type": "string", "description": (
            "What the dashboard is for, in the person's own words and what they want to watch on it — e.g. revenue day "
            "by day and what moves it, with orders and payments beside it.")},
    },
    "required": ["about"],
}


def new_dashboard_tools(connection_id: str, person: str, *, emit: Optional[Emit] = None, schema: Optional[str] = None,
                        draft: Any = None, record: Any = None) -> list[ToolSpec]:
    """``make_dashboard`` (Stage 4 of "one coworker, two places", 2026-11-20): a NEW dashboard for the person, handed off
    to the dashboard drafter the Briefing's "new dashboard" uses (`dashboards.ask.draft_for_area`), which builds it from the
    connection's approved metrics, trusted queries and findings and stages it whole for the person's Allow. None when the
    person asking is not known. ``draft`` stands in for the drafter and ``record`` for the inbox's read in tests."""
    if not person:
        return []

    def run(args: dict) -> dict:
        about = " ".join(str((args or {}).get("about") or "").split())
        if not about:
            return {"staged": False, "said": ["Say what the dashboard is for."]}
        if draft is None:
            from pramanyx.dashboards.ask import draft_for_area as make
        else:
            make = draft

        def hear(frame: dict) -> None:
            line = heard_words(frame)
            if line and emit is not None:
                emit("status", {"text": line})

        out = make(connection_id, person, about, schema=schema, hear=hear)
        if out.get("staged") and out.get("proposal_id"):
            from pramanyx.agent.dashboard_tool import announce_staged
            if record is None:
                from pramanyx.actions.inbox import get_proposal as read
            else:
                read = record
            staged = read(out["proposal_id"])
            if staged is not None:
                announce_staged(emit, staged)
            return {"staged": True,
                    "next": ("A new dashboard is drafted and shown to the person with Allow and Reject. Nothing exists yet. "
                             "Say in one sentence what it would show, naming cards by their titles, and that it waits for "
                             "their Allow. Never name it by an id.")}
        return {"staged": False, "said": list(out.get("sentences") or ["No dashboard was drafted."]),
                "next": "Nothing was staged. Tell the person why, in these words."}

    return [ToolSpec(
        name="make_dashboard",
        description=(
            "Draft a NEW dashboard for the person, for an area they name, to watch day to day — e.g. revenue and what moves "
            "it. A drafter builds it from the connection's approved metrics, trusted queries and findings and stages it "
            "whole for the person's Allow; nothing exists until they allow it. Use it only when they ask for a dashboard; "
            "to change the one they are on, use change_dashboard."),
        parameters=_NEW_PARAMS,
        run=run,
    )]
