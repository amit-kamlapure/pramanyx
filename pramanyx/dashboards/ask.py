"""A dashboard from an area a person names, and a change to one they keep, asked for in words
(Arc CT, CT-9; ROADMAP §3.50, §6 item 36(j); the canvas, docs/COCKPIT_CANVAS_2026-10-08.md).

In the Briefing a person says what the dashboard is for — "returns", "pricing and discounts" —
and a model drafts it. Not in a chat: the canvas is for investigation, and a dashboard is not an
answer. The model is given ONE tool, the drafting tool bound to the dashboard, and a budget of a
few steps. It reads what the connection may make a dashboard of, drafts, repairs what is refused,
and stops. What comes back is one staged proposal the person keeps or not.

Since the canvas the same door takes a change to a dashboard that stands — "add the finding about
returns by category", "make the net sales card bigger", "take my note off", "share this with
the sales team" — as an edit against the version on screen, or a publish. A note's words and
an image are never the model's: it may move, resize or take off either, and nothing else.

**Nothing the model writes reaches the person as fact.** When a draft is staged, what the
person reads is the platform's summary of it. When none is, they read the platform's reasons —
the last refusal's own sentences — and the model's words only if they state no figure.
"""
from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import threading
from collections.abc import AsyncIterator
from typing import Any, Callable, Optional

from pramanyx.dashboards.home import Home, new_id

logger = logging.getLogger(__name__)

#: Told each thing the platform did while a draft is made, for the person watching it.
Hear = Callable[[dict], None]

#: Steps the model may take: options, a draft, and repairs.
MAX_STEPS = 6
#: The longest description of a dashboard a person may write. It is read as the ask, and a limit is set only where
#: it names one. The page holds a person to this before they send it.
MAX_AREA = 1500
#: The longest change a person may ask for in words.
MAX_WORDS = 400

SYSTEM = (
    "You draft ONE dashboard for a person's Briefing, for the area of the business they name. "
    "Call draft_dashboard with op options first. Then call it with op new: the whole spec, and the "
    "cards it creates. Title the dashboard after the area in a few of the person's words. Choose only records "
    "that bear on the area. When nothing the connection offers measures it, draft nothing and say "
    "so in one sentence. When a draft is refused, repair every point and draft again. When one is "
    "staged, stop."
)

SYSTEM_EDIT = (
    "You change ONE dashboard a person keeps, exactly as they ask in words, and nothing else. "
    "Call draft_dashboard with op options first: it returns the dashboard as it stands, the cards the "
    "person has, what a new card may be made of, and who the dashboard may be published to. Then call "
    "it ONCE with what the words ask for: op edit, with RFC 6902 operations against the dashboard as it "
    "stands and the cards to create if they ask for a figure the dashboard lacks — or op publish, with "
    "the group or role they name. A note or an image on the dashboard is the person's: move it, give it "
    "a size or take it off when asked; never add one, write one or choose one. An element's size is "
    'one of small, wide, tall, large, full, hero; "bigger" is the next of these. '
    "When what they ask cannot be done with what the dashboard may be made of, draft nothing and say "
    "so in one sentence. When a draft is refused, repair every point and draft again. When one is "
    "staged, stop."
)


#: Where a change asked for in words is traced.
EDIT_SITE = "cockpit.edit"

#: Asked of one piece (the study's R19): the same law, held to the element chosen.
SYSTEM_PIECE = SYSTEM_EDIT + (
    " The person chose one element of the dashboard and asks about it alone: change that element and nothing else. "
    "Every patch's path begins /elements/<its key>/. Do not publish."
)


def outside_piece(args: dict, target: str) -> list[str]:
    """Why a draft reaches past the one piece it was asked about, in sentences for the model to repair; none when it stays."""
    if (args or {}).get("op") not in ("new", "edit", "publish"):
        return []
    if args.get("op") != "edit":
        return [f"Only the element {target} may be changed, so draft op edit alone."]
    home = f"/elements/{target}"
    reach = [str(p.get(side)) for p in args.get("patches") or [] if isinstance(p, dict) for side in ("path", "from") if p.get(side)]
    past = sorted({r for r in reach if r != home and not r.startswith(f"{home}/")})
    if past:
        return [f"Only the element {target} may be changed; these reach past it: {', '.join(past)}."]
    return [] if reach else [f"The draft changes nothing of the element {target}."]


class _Left(Exception):
    """The person watching a draft left, so the model is asked nothing more."""


def _found(offered: dict) -> dict:
    """What the connection offers a draft, counted, for the person watching."""
    gone = offered.get("not_shown") or {}
    return {"type": "read", **{name: len(offered.get(name) or []) + int(gone.get(name) or 0)
                               for name in ("metrics", "trusted_queries", "findings")}}


def _pieces(spec: Any) -> list[dict]:
    """Where a draft places its pieces, as far as what the model wrote can be read. Nothing here is checked yet."""
    from pramanyx.dashboards.versions import outline_of
    try:
        return [{k: v for k, v in piece.items() if k not in ("w", "h") or isinstance(v, int)}
                for piece in outline_of(spec, cards=True)]
    except (AttributeError, TypeError):
        return []


def _run(home: Home, system: str, ask: str, *, said: str, schema: Optional[str], provider: Any,
         site: str, nothing: str, target: Optional[str] = None, hear: Optional[Hear] = None,
         stop: Optional[threading.Event] = None) -> dict:
    """Run the model once with the drafting tool bound to ``home``. Returns what became of it —
    ``staged`` with the proposal, or not, with the reasons as sentences. ``hear`` is told what the platform does as it
    does it, in its own counts and the titles of cards it has checked, never the model's words. Once ``stop`` is set the
    run ends at its next step."""
    from pramanyx.agent.dashboard_tool import drafting_tool
    from pramanyx.agent.tool_loop import ToolSpec, run_tool_loop

    if provider is None:
        from pramanyx.agent.converse_tools import binding_calls_tools
        if not binding_calls_tools():
            return _not("The model this install drafts with cannot call tools, so it cannot draft a "
                        "dashboard. Choose one that can in the model settings.")
        from pramanyx.llm.provider import get_provider
        provider = get_provider("coder")

    staged: list[dict] = []
    results: list[dict] = []
    tool = drafting_tool(home, said=said, schema=schema, told=hear,
                         emit=lambda kind, payload: staged.append(payload) if kind == "proposal_staged" else None)

    def run(args: dict) -> dict:
        if stop is not None and stop.is_set():        # what the model wrote after the person left is not drafted
            return {"staged": False, "summary": "The person stopped this draft."}
        op = (args or {}).get("op")
        if hear and op in ("new", "edit"):
            hear({"type": "checking", "round": len(results) + 1, "cards": len((args or {}).get("cards") or []),
                  "outline": _pieces((args or {}).get("spec"))})
        out = attempt(args)
        if hear and op == "options" and isinstance(out, dict):
            hear(_found(out))
        elif hear and op in ("new", "edit") and isinstance(out, dict) and not out.get("staged"):
            hear({"type": "sent_back", "round": len(results), "points": len(out.get("refused") or [])})
        return out

    def attempt(args: dict) -> dict:
        past = outside_piece(args, target) if target else []
        if past:
            out = {"staged": False, "refused": past, "error": " ".join(past),
                   "summary": "Nothing staged. Repair every point in `refused`, then draft it again."}
            results.append(out)
            return out
        out = tool.run(args)
        if (args or {}).get("op") in ("new", "edit", "publish"):
            results.append(out if isinstance(out, dict) else {})
        return out

    def stepped(_step: Any) -> None:
        if stop is not None and stop.is_set():
            raise _Left

    result = run_tool_loop(
        provider, system, ask,
        [ToolSpec(name=tool.name, description=tool.description, parameters=tool.parameters, run=run)],
        max_steps=MAX_STEPS, conn_id=home.connection_id, site=site, on_step=stepped)

    rounds = len(results)
    if staged:
        last = next((r for r in reversed(results) if r.get("staged")), {})
        return {"staged": True, "proposal_id": staged[-1]["proposal_id"], "cockpit_id": home.cockpit_id,
                "summary": str(last.get("summary") or ""), "rounds": rounds,
                "stop_reason": result.stop_reason, "sentences": []}

    refused = list((results[-1] if results else {}).get("refused") or [])
    said_ = (result.answer or "").strip()
    from pramanyx.dashboards.validate import stated_figures
    if said_ and not stated_figures(said_):
        refused = [said_[:400], *refused] if not refused else refused
    if not refused:
        refused = [nothing]
    return {"staged": False, "proposal_id": "", "cockpit_id": "", "summary": "", "rounds": rounds,
            "stop_reason": result.stop_reason, "sentences": refused}


def draft_for_area(connection_id: str, owner: str, area: str, *, schema: Optional[str] = None,
                   provider: Any = None, hear: Optional[Hear] = None, stop: Optional[threading.Event] = None) -> dict:
    """Run the model once for this area. Returns what became of it — ``staged`` with the
    proposal and the dashboard it would be, or not, with the reasons as sentences."""
    area = " ".join((area or "").split())[:MAX_AREA]
    if not area:
        return _not("Name the area this dashboard is for — returns, pricing, marketing.")
    home = Home(connection_id, owner, new_id(area))
    return _run(home, SYSTEM, f"Draft a dashboard for this area: {area}", said=area, schema=schema,
                provider=provider, site="cockpit.draft", hear=hear, stop=stop,
                nothing="The model drafted no dashboard for this area, and gave no reason.")


async def _told(run: Callable[[Hear, threading.Event], dict]) -> AsyncIterator[str]:
    """A model run as a stream of `data:` records, so a person can see the work happening (the user, 2026-11-18: "user needs
    to have a clear visual that the dashboard request is actually happening"). The run has a thread of its own, reading as
    the person who asked. When they leave or press Stop, this is cancelled and the model is asked nothing more. Every stream
    ends with an ``end`` record, so one cut short can be told from a whole one."""
    loop = asyncio.get_running_loop()
    heard: asyncio.Queue[Optional[dict]] = asyncio.Queue()
    stop = threading.Event()
    who = contextvars.copy_context()

    def push(frame: dict) -> None:
        loop.call_soon_threadsafe(heard.put_nowait, frame)

    def work() -> None:
        try:
            push({"type": "done", "result": run(push, stop)})
        except _Left:
            logger.info("a dashboard draft was left before it finished")
        except Exception:
            logger.exception("drafting a dashboard failed")
            push({"type": "failed", "sentences": ["The draft stopped before it finished. Nothing was kept."]})
        finally:
            push({"type": "end"})
            loop.call_soon_threadsafe(heard.put_nowait, None)

    running = asyncio.ensure_future(asyncio.to_thread(who.run, work))
    try:
        while True:
            frame = await heard.get()
            if frame is None:
                break
            yield f"data: {json.dumps(frame, default=str)}\n\n"
        await running
    finally:
        stop.set()


def draft_frames(connection_id: str, owner: str, area: str, *, schema: Optional[str] = None,
                 provider: Any = None) -> AsyncIterator[str]:
    """A new dashboard's draft, told as it is made."""
    return _told(lambda hear, stop: draft_for_area(connection_id, owner, area, schema=schema, provider=provider,
                                                   hear=hear, stop=stop))


def change_frames(connection_id: str, owner: str, dashboard_id: str, words: str, *, schema: Optional[str] = None,
                  target: Optional[str] = None, provider: Any = None) -> AsyncIterator[str]:
    """A change to a dashboard that stands, told as it is drafted. What comes back still waits for the person's own Allow."""
    return _told(lambda hear, stop: edit_in_words(connection_id, owner, dashboard_id, words, schema=schema, provider=provider,
                                                  target=target, hear=hear, stop=stop))


def edit_in_words(connection_id: str, owner: str, cockpit_id: str, words: str, *, schema: Optional[str] = None,
                  provider: Any = None, target: Optional[str] = None, hear: Optional[Hear] = None,
                  stop: Optional[threading.Event] = None) -> dict:
    """Run the model once for a change to the dashboard ``cockpit_id`` the person keeps, as they ask
    for it in words. What comes back is a staged edit or publish, or the reasons none was. With ``target``, the
    element the person chose, the change is held to that element alone."""
    from pramanyx.dashboards import versions
    words = " ".join((words or "").split())[:MAX_WORDS]
    if not words:
        return _not("Say what to change — add a finding, move a card, make one bigger, share it with a team.")
    home = Home(connection_id, owner, cockpit_id)
    live = versions.latest(home)
    if live is None or live["retired"] or not live.get("spec"):
        return _not("There is no dashboard here to change.")
    title = versions.title_of(live["spec"]) or cockpit_id
    if target:
        element = (live["spec"].get("elements") or {}).get(target)
        if not isinstance(element, dict):
            return _not("That piece is no longer on the dashboard.")
        if element.get("type") in ("Note", "Image"):
            return _not("A note or an image is yours to change by hand.")
        return _run(home, SYSTEM_PIECE, f'Of their dashboard "{title}", about the element "{target}" alone '
                    f'(a {element.get("type")}), the person asks: {words}', said=words, schema=schema, provider=provider,
                    site=EDIT_SITE, nothing="The model drafted no change for this, and gave no reason.", target=target,
                    hear=hear, stop=stop)
    return _run(home, SYSTEM_EDIT, f'Of their dashboard "{title}", the person asks: {words}', said=words,
                schema=schema, provider=provider, site=EDIT_SITE, hear=hear, stop=stop,
                nothing="The model drafted no change for this, and gave no reason.")


def _not(sentence: str) -> dict:
    return {"staged": False, "proposal_id": "", "cockpit_id": "", "summary": "", "rounds": 0,
            "stop_reason": "", "sentences": [sentence]}
