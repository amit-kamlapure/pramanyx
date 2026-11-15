"""A result whose last period is still in progress (2026-11-15).

Found reading a coworker answer the same day: monthly GMV by platform, where the answer called November's figures "a
synchronized sharp drop … the standout anomaly" — on the 15th, with half the month still to come. Nothing told the
writer that the last bucket was incomplete, so a half month read as a collapse.

This reads the result itself: a time column (by its name or its values), the period its last value falls in, and
whether that period has ended as of today. When it has not, the result carries a caveat that says so, at the executor
(`sql/executor._attach_caveats`), so every path that writes about the rows — the conversation, the quick answer, a
schedule — is told before it writes. No model call; a result with no time column carries nothing.
"""
from __future__ import annotations

import calendar
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

_GRAIN_BY_NAME = (("month", "month"), ("week", "week"), ("quarter", "quarter"), ("day", "day"), ("date", "day"))
_YM = re.compile(r"^(\d{4})-(\d{2})$")
_YQ = re.compile(r"^(\d{4})[- ]?q([1-4])$", re.I)
_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def _as_date(value: Any) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        m = _ISO.match(value.strip())
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                return None
        m = _YM.match(value.strip())
        if m and 1 <= int(m.group(2)) <= 12:
            return date(int(m.group(1)), int(m.group(2)), 1)
    return None


def _grain(name: str, values: list) -> Optional[str]:
    low = name.lower()
    if "fiscal" in low:
        return None                     # a fiscal period's end is the business's, not the calendar's
    for word, grain in _GRAIN_BY_NAME:
        if word in low:
            if grain == "day":
                break                   # a date column's grain is read from its values below
            return grain
    if all(isinstance(v, str) and _YM.match(v.strip()) for v in values):
        return "month"
    if all(isinstance(v, str) and _YQ.match(v.strip()) for v in values):
        return "quarter"
    dates = sorted({d for d in (_as_date(v) for v in values) if d})
    if len(dates) < 2:
        return None
    if all(d.day == 1 for d in dates):
        return "quarter" if all(d.month in (1, 4, 7, 10) for d in dates) and len(dates) > 1 and \
            all((b.year * 12 + b.month) - (a.year * 12 + a.month) == 3 for a, b in zip(dates, dates[1:])) else "month"
    if all((b - a).days % 7 == 0 for a, b in zip(dates, dates[1:])):
        return "week"
    return "day"


def _period(grain: str, value: Any) -> Optional[tuple[date, date, str]]:
    """(first day, last day, how to say it) of the period ``value`` falls in."""
    if grain == "quarter" and isinstance(value, str) and _YQ.match(value.strip()):
        m = _YQ.match(value.strip())
        year, q = int(m.group(1)), int(m.group(2))
        start = date(year, 3 * q - 2, 1)
    else:
        d = _as_date(value)
        if d is None:
            return None
        if grain == "day":
            return d, d, d.isoformat()
        if grain == "week":
            return d, d + timedelta(days=6), f"the week of {d.isoformat()}"
        if grain == "month":
            last = date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])
            return date(d.year, d.month, 1), last, f"{calendar.month_name[d.month]} {d.year}"
        start = date(d.year, 3 * ((d.month - 1) // 3) + 1, 1)
    end_month = start.month + 2
    end = date(start.year, end_month, calendar.monthrange(start.year, end_month)[1])
    return start, end, f"Q{(start.month - 1) // 3 + 1} {start.year}"


def last_period_in_progress(columns: list, rows: list, today: Optional[date] = None) -> Optional[str]:
    """The caveat for a result whose last period has not ended yet, or None."""
    if not columns or not rows or len(rows) < 2:
        return None
    today = today or datetime.now(timezone.utc).date()
    table = [list(r.values()) if isinstance(r, dict) else list(r or []) for r in rows]
    for i, name in enumerate(columns):
        values = [r[i] for r in table if i < len(r) and r[i] is not None]
        if len(values) < 2:
            continue
        grain = _grain(str(name), values)
        if grain is None:
            continue
        periods = [p for p in (_period(grain, v) for v in values) if p]
        if len(periods) < 2:
            continue
        start, end, said = max(periods, key=lambda p: p[0])
        if start <= today <= end:                         # today itself is not over
            return (f"The last {grain} in these rows, {said}, is still in progress: it runs to {end.isoformat()} and "
                    f"today is {today.isoformat()}. Say its figures are so far, and never compare it with a whole "
                    f"{grain} as a fall or a rise.")
    return None
