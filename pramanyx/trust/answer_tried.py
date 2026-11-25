"""What an answer TRIED, kept on its receipt (the Atlas plan's A1b, 2026-11-26; §7.7: "never read back: SQL that failed
and the fix"). An answer's repair round already said its pair to the page — the statement that failed or tripped a
check, and the one that ran clean (`sql_repair`), or the repair it would not adopt (`repair_recheck`) — and then let it
go: only the trace held it, for 14 days. Kept on the receipt, it is what A7 learns from: a failure and its fix become a
learned "watch for this".

What is kept is what the guard receipts carry — never a model's words about them: the step, why it was taken, the
statement before and the one after.
"""
from __future__ import annotations

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
