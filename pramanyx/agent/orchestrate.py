"""How the Ask panel's conversation works a request of several parts (Stage 4 of "one coworker, two places", 2026-11-20).

The coworker app has a plan, helpers and hand-offs from its shell; the panel's conversation had none, so a request such as
"Our revenue dropped yesterday. Investigate why, create a monitoring dashboard, and notify the team if it happens again"
was one long turn with nothing to show for its parts. Two abilities here, each a row of `pramanyx/abilities.py`:

  - ``plan`` writes the plan of a request with several parts, shown to the person above the work and kept as the work
    goes; each step is marked done as it is finished. It changes nothing.
  - ``ask_in_parallel`` hands two or three questions that do not depend on each other to helpers, which answer them side
    by side through the governed answer pipeline, as `answer_question` does one.

A part handed on is an ability of its own: a deep analysis (`deep_analysis`), a new dashboard drafted by the dashboard
drafter (`make_dashboard`), a monitor and its alert (`draft_monitor`), a person's saved agent (`delegate_task`). Continuing past the step limit is Keep going (Stage A).
"""
from __future__ import annotations

import contextvars
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional

from pramanyx.agent.tool_loop import ToolSpec

logger = logging.getLogger(__name__)

Emit = Callable[[str, dict], None]

#: The most steps a plan holds, and the most helpers asked at once.
MAX_PLAN_STEPS = 8
MAX_HELPERS = 3

_PLAN_PARAMS = {
    "type": "object",
    "properties": {
        "steps": {"type": "array", "maxItems": MAX_PLAN_STEPS, "items": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "The step in a few plain words, as the person would say it."},
                "done": {"type": "boolean", "description": "True once the step is finished."},
            },
            "required": ["text"],
        }, "description": "Every step of the request, in order, each time: the plan as it stands now."},
    },
    "required": ["steps"],
}

_HELPER_PARAMS = {
    "type": "object",
    "properties": {
        "questions": {"type": "array", "minItems": 2, "maxItems": MAX_HELPERS, "items": {"type": "string"},
                      "description": "Two or three whole questions, in plain words, none needing another's answer."},
    },
    "required": ["questions"],
}


def plan_steps(args: Any) -> list[dict]:
    """The steps a call gives, cleaned: a few plain words each, at most ``MAX_PLAN_STEPS``."""
    steps = (args or {}).get("steps") if isinstance(args, dict) else None
    out: list[dict] = []
    for s in steps if isinstance(steps, list) else []:
        text = " ".join(str((s or {}).get("text") or "").split())[:160] if isinstance(s, dict) else ""
        if text:
            out.append({"text": text, "done": bool(s.get("done"))})
    return out[:MAX_PLAN_STEPS]


def plan_tool(emit: Optional[Emit] = None) -> ToolSpec:
    def run(args: dict) -> dict:
        steps = plan_steps(args)
        if not steps:
            return {"shown": False, "said": "A plan names at least one step."}
        if emit is not None:
            emit("plan", {"steps": steps})
        left = [s["text"] for s in steps if not s["done"]]
        return {"shown": True, "steps_left": left,
                "next": ("The plan is shown to the person above the work. Work the steps in order, and call plan again "
                         "with each one marked done as you finish it. A step that waits on the person — a change staged "
                         "for their Allow — is done once it is staged: say it waits for them. Do not stop while a step "
                         "is left unless it needs the person; then say which, and why."
                         if left else "Every step is done. Answer the person: what each step found or staged.")}

    return ToolSpec(
        name="plan",
        description=(
            "Write the plan of a request with several parts — find out why something happened, then build something, then "
            "set an alert — before doing it: each step in a few plain words. It is shown to the person above the work and "
            "kept as the work goes. Call it again with each step marked done as you finish it. Not for a single question."),
        parameters=_PLAN_PARAMS,
        run=run,
    )


def _brief(question: str, out: Any) -> dict:
    """One helper's answer, as the conversation reads it back: the answer, how many rows, and what went wrong if it did."""
    out = out if isinstance(out, dict) else {}
    said = {"question": question, "answer": str(out.get("headline") or "")[:600]}
    if out.get("row_count") is not None:
        said["rows"] = out.get("row_count")
    if out.get("error"):
        said["error"] = str(out["error"])[:300]
    return said


def helpers_tool(connection_id: str, *, session_id: str = "", canvas_id: Optional[str] = None,
                 schema_scope: Optional[str] = None, answer: Optional[Callable[..., dict]] = None) -> ToolSpec:
    """``answer`` stands in for `converse_tools.answer_question` in tests."""

    def run(args: dict) -> dict:
        asked = [" ".join(str(q or "").split())[:500] for q in ((args or {}).get("questions") or [])]
        questions = [q for q in asked if q][:MAX_HELPERS]
        if len(questions) < 2:
            return {"answered": False,
                    "said": "Helpers take two or three questions that do not depend on each other; ask one with answer_question."}
        if answer is None:
            from pramanyx.agent.converse_tools import answer_question as one
        else:
            one = answer
        # each helper runs as the person asking, on its own thread: the context is copied here, where the person is known
        contexts = [contextvars.copy_context() for _ in questions]

        def ask(pair: tuple) -> dict:
            context, question = pair
            try:
                return context.run(one, connection_id, {"question": question}, emit=None, session_id=session_id,
                                   canvas_id=canvas_id, user_question=question, schema_scope=schema_scope)
            except Exception as exc:  # noqa: BLE001 — one helper's failure is its answer, not the turn's
                logger.debug("a helper's question failed", exc_info=True)
                return {"error": f"{type(exc).__name__}: {exc}"[:300]}

        with ThreadPoolExecutor(max_workers=len(questions), thread_name_prefix="ask-helper") as pool:
            outs = list(pool.map(ask, zip(contexts, questions)))
        return {"answered": True, "answers": [_brief(q, o) for q, o in zip(questions, outs)],
                "next": "Each helper answered one question through the governed pipeline. Say what they found together."}

    return ToolSpec(
        name="ask_in_parallel",
        description=(
            "Hand two or three questions that do not depend on each other to helpers, who answer them side by side through "
            "the governed answer pipeline — e.g. revenue yesterday by state, by category, and by payment type, to see "
            "where a drop came from. Use it instead of asking them one after another; use answer_question for one."),
        parameters=_HELPER_PARAMS,
        run=run,
    )


# ── a request of several parts, recognised (seen live 2026-11-20) ────────────────────────────────────────────────────
#
# On the acceptance test ("Our revenue dropped yesterday. Investigate why, create a monitoring dashboard, and notify the
# team if it happens again") the conversation wrote no plan and handed nothing to a specialist: it worked the "why" by
# hand, seven queries, and spent every step before the dashboard or the alert. The tools' own descriptions were not
# enough, so the door says what it can see in the words: which parts were asked for, and which ability each is for.

#: The kinds of part a request can hold, each with the ability made for it. Matched on the person's words.
PART_KINDS: tuple[tuple[str, "re.Pattern[str]", str], ...] = (
    ("why", re.compile(r"\b(investigate|find out why|work out why|why (?:did|has|is|was|are)|root cause|what (?:caused|drove))\b", re.I),
     "deep_analysis"),
    ("dashboard", re.compile(r"\b(create|build|make|set up|draft)\b[^.]{0,40}\bdashboard\b", re.I), "make_dashboard"),
    ("alert", re.compile(r"\b(notify|alert|warn|tell|let)\b[^.]{0,60}\b(team|me|us|someone|channel)\b|\bif it happens again\b|\bmonitor\b", re.I),
     "draft_monitor"),
)


def parts_of(question: str) -> list[tuple[str, str]]:
    """The kinds of part a request asks for, with the ability for each — empty unless there are two or more, since a
    single question needs no plan."""
    q = str(question or "")
    found = [(kind, ability) for kind, pattern, ability in PART_KINDS if pattern.search(q)]
    return found if len(found) >= 2 else []


def parts_note(question: str) -> str:
    """The conversation's note on a request of several parts, or '' for a single question."""
    found = parts_of(question)
    if not found:
        return ""
    words = {"why": "finding out why (hand it the person's question as they asked it; do not work it out by hand with "
                    "queries)", "dashboard": "a new dashboard", "alert": "an alert for when it happens again"}
    lines = [f"- {words[kind]}: {ability}" for kind, ability in found]
    return ("## This request has several parts\n"
            "The person asked for several things at once:\n" + "\n".join(lines) + "\n"
            "Write the plan first (plan), then work each part in order, handing it to the ability named for it. A part "
            "staged for the person's Allow is done once it is staged. If the data cannot answer a part — a day it holds "
            "no rows for — say so plainly and go on with the rest.")


#: Steps more for every part of a request after the first.
STEPS_PER_PART = 4


def steps_for(question: str, provider: Any) -> Optional[int]:
    """The step budget of a turn: None (the model's own, as the loop reads it) for a single question; for a request of
    several parts, that budget and ``STEPS_PER_PART`` more for every part after the first."""
    found = parts_of(question)
    if not found:
        return None
    from pramanyx.llm.profile import profile_for
    return profile_for(provider.role).tool_loop_steps + STEPS_PER_PART * (len(found) - 1)


def found_lines(results: list[dict], most: int = 8) -> list[str]:
    """What a turn's queries found, a line each — the SQL, how many rows, and the first row — so a turn that goes on
    (Keep going) starts from what was found, not only from which tools ran (seen live 2026-11-20: told only the tools, the
    next turn ran the same exploration again)."""
    import json
    out: list[str] = []
    for i, r in enumerate((results or [])[-most:], 1):
        sql = r.get("sql")
        sql = sql.get("sql") if isinstance(sql, dict) else sql
        cols = list((r.get("columns") or {}).get("columns") or []) if isinstance(r.get("columns"), dict) else []
        rows = list((r.get("rows") or {}).get("rows") or []) if isinstance(r.get("rows"), dict) else []
        line = f"{i}. {' '.join(str(sql or '').split())[:220]} → {len(rows)} rows"
        if rows:
            first = rows[0]
            shown = dict(zip(cols, first)) if cols and isinstance(first, (list, tuple)) else first
            line += f"; first: {json.dumps(shown, default=str)[:240]}"
        out.append(line)
    return out
