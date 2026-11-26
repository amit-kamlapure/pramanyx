"""What an answer TRIED, kept on its receipt (the Atlas plan's A1b, 2026-11-26; §7.7: "never read back: SQL that failed
and the fix"). An answer's repair round already said its pair to the page — the statement that failed or tripped a
check, and the one that ran clean (`sql_repair`), or the repair it would not adopt (`repair_recheck`) — and then let it
go: only the trace held it, for 14 days. Kept on the receipt, it is what A7 learns from: a failure and its fix become a
learned "watch for this".

What is kept is what the guard receipts carry — never a model's words about them: the step, why it was taken, the
statement before and the one after.

A clarifying question the person was asked and did not answer — "Answer anyway" — is kept the same way (2026-11-26, the
Area map plan's gap): what was asked, the readings offered, its kind, and the question it was about, on the receipt
of the answer that went ahead without it (payload `clarification_left`, lineage `tried_clarification`). The turn
carries it ambiently (`leaving`), so every door that writes the answer's receipt keeps it.
"""
from __future__ import annotations

from contextvars import ContextVar, Token
from typing import Optional

#: The guard receipts that say a statement was replaced, or a replacement refused.
TRIED = ("sql_repair", "repair_recheck", "preflight_repair")
#: How much of each statement is kept.
SQL_KEPT = 2000


def tried(receipts: list[dict]) -> list[dict]:
    """``[{what, why, before, after}]`` — each statement an answer replaced (or would not), in the order it happened."""
    out = []
    for r in receipts or []:
        if not isinstance(r, dict) or r.get("guard") not in TRIED:
            continue
        before, after = str(r.get("before") or ""), str(r.get("after") or "")
        if not before:
            continue
        out.append({"what": str(r.get("action") or r.get("guard")), "why": str(r.get("detail") or "")[:500],
                    "before": before[:SQL_KEPT], "after": after[:SQL_KEPT]})
    return out


def lineage_rows(steps: list[dict]) -> list[tuple]:
    """The receipt's rows for what was tried: ``("tried_sql", "<what>", <the statement before>)``."""
    return [("tried_sql", s["what"], s["before"]) for s in steps]


# ── a clarification left unanswered ─────────────────────────────────────────────────────────────────────────────

_LEFT: ContextVar[Optional[dict]] = ContextVar("clarification_left", default=None)


def clarification_left(asked: str, *, options: Optional[list] = None, source: str = "", subject: str = "") -> Optional[dict]:
    """``{asked, options, source, subject}`` — the clarifying question the person went ahead without — or None when
    nothing was asked."""
    asked = str(asked or "").strip()
    if not asked:
        return None
    return {"asked": asked[:500], "options": [str(o)[:200] for o in (options or []) if str(o).strip()][:8],
            "source": str(source or "")[:60], "subject": str(subject or "")[:500]}


def leave(left: Optional[dict]) -> Token:
    """This turn went ahead without its clarification: every receipt it writes keeps it."""
    return _LEFT.set(left)


def unleave(token: Token) -> None:
    _LEFT.reset(token)


def left_now() -> Optional[dict]:
    return _LEFT.get()


def clarification_row(left: dict) -> tuple:
    """The receipt's row for it: ``("tried_clarification", "<its kind>", <what was asked>)``."""
    return ("tried_clarification", left.get("source") or "clarify", left.get("asked") or "")
