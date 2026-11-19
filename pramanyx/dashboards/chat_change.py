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


def change_tools(connection_id: str, dashboard: Optional[tuple[str, str]], *, emit: Optional[Emit] = None,
                 schema: Optional[str] = None, draft: Any = None, record: Any = None) -> list[ToolSpec]:
    """``dashboard`` is ``(person, dashboard id)`` for a dashboard the person keeps; None gives no tool. ``draft`` stands in
    for `edit_in_words` and ``record`` for the inbox's `get_proposal` in tests."""
    if not dashboard or not all(dashboard):
        return []
    person, dashboard_id = dashboard

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
            from pramanyx.agent.dashboard_tool import _announce
            if record is None:
                from pramanyx.actions.inbox import get_proposal as read
            else:
                read = record
            staged = read(out["proposal_id"])
            if staged is not None:
                _announce(emit, staged)
            return {"staged": True, "proposal_id": out["proposal_id"], "summary": out.get("summary") or "",
                    "next": ("A change is staged and shown to the person with Allow and Reject. Nothing has changed yet. "
                             "Say in one sentence what the change does, and that it waits for their Allow.")}
        return {"staged": False, "said": list(out.get("sentences") or ["No change was drafted."]),
                "next": "Nothing was staged. Tell the person why, in these words."}

    return [ToolSpec(
        name="change_dashboard",
        description=(
            "Change the dashboard the person is asking from, as they ask: arrange, resize, add or take off cards made from "
            "approved metrics, trusted queries and findings, add a page, or publish it. Use it only when they ask for a "
            "change, never to answer a question. It drafts the change and shows it to them to allow; it is not made until "
            "they do, so never say it is done."),
        parameters=_PARAMS,
        run=run,
    )]
