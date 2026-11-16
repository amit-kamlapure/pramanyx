"""A gathered answer, checked against the answers it was gathered from (2026-11-16).

A question the coworker works with helpers has one output: the answer its main agent writes once every helper has
reported (the user, 2026-11-16: "one main agent that orchestrates sub-agents, gets feedback from them, synthesises
the entire range of feedbacks and then gives one final output"). Each helper's answer came through the governed
path; the gathered answer is the agent's own words over them, and nothing checked it. The user asked that its
figures be held against the answers it rests on.

This is the departure gate's first law, read over a set of answers instead of one: every figure the text states is
looked for in the rows those answers kept — their cells, an additive column's total, the gap between two figures of
one column of a small result (`departure_basis.measurement_for_analysis`) — at the precision it is written
(`grounding.numeral_matches_measure`). Which figures count is the gate's own reading (`departure.stated_figures`):
dates, clock times, calendar years, and a bare whole number under 1,000 ("719 of them", "3 regions", "top 5") are not
claims — a second reading would flag what the gate passes. One thing differs, and on purpose: a
percentage is looked for too, as a cell or as a fraction's hundredfold, because a share is what a comparison states
and a share column is what the answers it compares hold.

Nothing is re-executed, and nothing is held: the answer has already been shown. What is not found is SAID, beside
the answer, with the clause it was written in — a figure worked out from others is one of those, and should be.
"""
from __future__ import annotations

import re
from typing import Iterable

#: The most answers one gathered answer is checked against: a question has a handful of helpers, each with a few.
MAX_ANSWERS = 40
_CLAUSE = re.compile(r"(?<=[.!?;:])\s+|\n+")


def _clause_of(text: str, token: str) -> str:
    """The clause a figure was written in, so a reader can find it."""
    for clause in _CLAUSE.split(text or ""):
        if token in clause:
            clause = " ".join(clause.split())
            return clause if len(clause) <= 220 else clause[:217] + "…"
    return ""


def check_gathered_answer(text: str, investigation_ids: Iterable[str]) -> dict:
    """Each figure of ``text`` against the rows the named answers kept.

    Returns ``{checked, found, not_found: [{text, clause}], answers, unread}`` — ``answers`` is how many of the named
    answers had rows to check against, ``unread`` how many could not be read (gone, or kept no rows)."""
    from pramanyx.explorer.grounding import numeral_matches_measure
    from pramanyx.govern.departure import stated_figures
    from pramanyx.govern.departure_basis import measurement_for_analysis

    ids = [i for i in dict.fromkeys(str(i).strip() for i in investigation_ids) if i][:MAX_ANSWERS]
    basis: list[list[float]] = []
    unread = 0
    for iid in ids:
        measured = measurement_for_analysis(iid)
        if measured is None or not measured.values:
            unread += 1
            continue
        basis.append([float(v) for v in measured.values])

    def found(numeral) -> bool:
        for values in basis:
            for value in values:
                if numeral_matches_measure(numeral, value):
                    return True
                if numeral.suffix == "%" and abs(value) <= 1.0 and numeral_matches_measure(numeral, value * 100.0):
                    return True
        return False

    figures = stated_figures(text)
    missing = [n for n in figures if not found(n)]
    said: dict[str, dict] = {}                 # a figure written twice is one figure not found
    for n in missing:
        said.setdefault(n.text, {"text": n.text, "clause": _clause_of(text, n.text)})
    return {
        "checked": len(figures),
        "found": len(figures) - len(missing),
        "not_found": list(said.values()),
        "answers": len(basis),
        "unread": unread,
    }
