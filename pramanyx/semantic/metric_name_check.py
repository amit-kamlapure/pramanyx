"""Does a metric's formula do what its name says? — read without a model (2026-11-26).

theLook's "Daily Active Users (DAU)" was written by the Explorer, a model, from its name: ``COUNT(DISTINCT user_id)`` over
the period asked — everyone active in thirty days over thirty days, never a daily figure — and approved in one click.
Answers that did what the name says then disagreed with the governed figure. The words of a name promise a shape:

- a period in it ("daily", "weekly", "per day") — the formula measures each period, then over them;
- a rate, a share, a percentage, a conversion — the formula divides;
- an average or a mean — the formula averages or divides;
- "per <thing>" — the formula divides by a count of that thing;
- "number of" or a count — the formula counts.

A mismatch is said in words a person reads ("named daily, but it counts over the whole period asked"). A person may
still approve such a metric — the name can be right and the words wrong — but not in one click: approving it says it
was read. Deterministic; the formula's text and nothing else.
"""
from __future__ import annotations

import re
from typing import Any

_PERIOD = {"daily": "day", "weekly": "week", "monthly": "month", "quarterly": "quarter", "yearly": "year",
           "annual": "year"}
_PER_PERIOD = re.compile(r"\bper\s+(day|week|month|quarter|year)\b", re.I)
#: "margin" alone is an amount ("contribution margin (EUR)"); "margin %", "margin rate" is a ratio
_RATE = re.compile(r"\b(rate|ratio|share|percent(age)?|pct|conversion|penetration)\b|%", re.I)
_AVERAGE = re.compile(r"\b(average|avg|mean)\b", re.I)
_PER_THING = re.compile(r"\bper\s+([a-z]+)", re.I)
_COUNT = re.compile(r"\b(number of|count of|# of)\b", re.I)
_DIVIDES = re.compile(r"/|\bsafe_divide\b|\bdiv\(|\bavg\s*\(", re.I)
_AVERAGES = re.compile(r"\bavg\s*\(|/|\bsafe_divide\b", re.I)
_COUNTS = re.compile(r"\bcount(_if|if)?\s*\(", re.I)
_TRUNC = re.compile(r"\b(date_trunc|timestamp_trunc|trunc|date)\s*\(|\bgroup\s+by\b", re.I)


def _field(m: Any, name: str) -> Any:
    return m.get(name) if isinstance(m, dict) else getattr(m, name, None)


def _formula(m: Any) -> str:
    return str(_field(m, "measure") or _field(m, "sql") or "")


def mismatches(m: Any) -> list[str]:
    """What a metric's name promises that its formula does not do — each in a sentence; [] when they agree."""
    name = " ".join(str(x) for x in (_field(m, "label"), str(_field(m, "name") or "").replace("_", " ")) if x)
    formula = _formula(m)
    if not formula.strip():
        return []
    said: list[str] = []
    low = name.lower()
    period = next((p for w, p in _PERIOD.items() if re.search(rf"\b{w}\b", low)), None)
    m_per = _PER_PERIOD.search(low)
    period = period or (m_per.group(1).lower() if m_per else None)
    window = _field(m, "window") or {}
    if period and not _TRUNC.search(formula) and not window:
        said.append(f"named {('per ' + period) if m_per else next(w for w, p in _PERIOD.items() if p == period)}, but it "
                    "counts over the whole period asked — nothing in it measures each "
                    f"{period} first")
    if _RATE.search(low) and not _DIVIDES.search(formula):
        said.append("named a rate or a share, but nothing in it divides")
    if _AVERAGE.search(low) and not _AVERAGES.search(formula):
        said.append("named an average, but it neither averages nor divides")
    per = _PER_THING.search(low)
    if per and per.group(1).lower() not in _PERIOD.values() and per.group(1).lower() not in ("cent", "percent"):
        thing = per.group(1).lower().rstrip("s")
        denominator = formula.lower().split("/", 1)[1] if "/" in formula else ""
        divides = bool(re.search(r"\bsafe_divide\s*\(", formula, re.I)) or bool(denominator)
        if not divides:
            said.append(f"named per {per.group(1)}, but nothing in it divides by a count of {per.group(1)}s")
        elif (denominator and thing not in denominator and not re.search(r"\bsafe_divide\s*\(", formula, re.I)
              and "measure(" not in denominator):            # a metric's name need not spell the thing it counts
            said.append(f"named per {per.group(1)}, but what it divides by does not count {per.group(1)}s")
    if _COUNT.search(low) and not _COUNTS.search(formula) and "sum(" not in formula.lower():
        said.append("named a count, but nothing in it counts")
    return said


def model_written(m: Any) -> str:
    """Who wrote the definition when a model did — "the Explorer (a model)" — else "" (2026-11-26: a model's proposal,
    accepted from the catalogue, was recorded under the accepting person's name alone)."""
    lineage = [str(x).lower() for x in (_field(m, "lineage") or [])]
    if "explorer" in lineage:
        return "the Explorer (a model)"
    if any(x in lineage for x in ("llm", "model", "pack-draft", "generated")):
        return "a model"
    return ""
