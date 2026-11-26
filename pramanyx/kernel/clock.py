"""What "today", "yesterday" and "last month" mean — one definition, for the platform and the coworker alike.

The user, 2026-11-17, after a scheduled "yesterday" on theLook was answered for 19 Oct: "there cannot be disagreement..
it has to be one stop shop for this.. Yesterday means day before current date.. based on the users time setting.. if no
data exists, it should say so.. thats it" — "applicable to entire ecosystem: harness and the platform".

Before this, three places each said what "yesterday" was, all in UTC: the scheduled run's note (moved back by the
source's learned settling lag), the SQL prompt's "newest day to read" (counted back from the settled day), and the
model's own reading. Now:

- **The person's clock** is one order (`person_clock`): a zone the person named, else the one they set for themselves,
  else the one they are in (the browser's, sent on every request as ``X-Pramanyx-Clock``), else the organisation's,
  else UTC.
- **A period is counted from today in that clock** (`periods`): yesterday is the day before today; last week the
  Monday–Sunday week before this one; last month the calendar month before this one; the last N days the N whole days
  ending yesterday, today being unfinished (`period_named`, 2026-11-26: two answers to one eval read "the last 30
  days" as 27 Oct–25 Nov and 28 Oct–26 Nov).
- **A period is never moved.** A source that keeps revising its recent days makes their figures provisional — said in
  one line — and never changes the day asked about. When the data holds nothing for the period, the answer says so.
"""
from __future__ import annotations

import re

import contextvars
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional

#: The browser's IANA zone, sent by the app and the coworker on every request to the API.
CLOCK_HEADER = "X-Pramanyx-Clock"

_here: contextvars.ContextVar[str] = contextvars.ContextVar("pramanyx_clock_here", default="")


def readable_zone(name: str) -> str:
    """``name`` when it is an IANA zone this install can read, else ""."""
    name = (name or "").strip()
    if not name or len(name) > 64:
        return ""
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo(name)
        return name
    except Exception:  # noqa: BLE001 — a zone this install cannot read is passed over, never guessed at
        return ""


def set_clock_here(zone: str) -> "contextvars.Token[str]":
    return _here.set(readable_zone(zone))


def reset_clock_here(token: "contextvars.Token[str]") -> None:
    _here.reset(token)


def clock_here() -> str:
    """The zone the person's browser is in, for this request — "" when none was sent."""
    return _here.get()


def person_clock(named: str = "", here: str = "") -> str:
    """The person's clock: a zone they named; else the one they set; else the one they are in (``here``, else this
    request's browser zone); else the organisation's; else "" — UTC."""
    if (zone := readable_zone(named)):
        return zone
    try:
        from pramanyx.db.user_prefs import preferred_timezone
        if (zone := readable_zone(preferred_timezone())):
            return zone
    except Exception as exc:  # noqa: BLE001 — a preference that cannot be read leaves the next clock in the order
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the person's own clock could not be read", counter="kernel.clock.preference")
    if (zone := readable_zone(here) or clock_here()):
        return zone
    try:
        from pramanyx.orgsettings.store import load_org_settings
        return readable_zone(str(load_org_settings().timezone or ""))
    except Exception as exc:  # noqa: BLE001 — the organisation's settings unreadable: UTC, as before any were kept
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the organisation's clock could not be read; UTC", counter="kernel.clock.org")
        return ""


def _zone(clock: str):
    from zoneinfo import ZoneInfo
    return ZoneInfo(readable_zone(clock) or "UTC")


def now_in(clock: str = "", now: Optional[datetime] = None) -> datetime:
    """The moment ``now`` (default: this one) on ``clock``'s wall."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(_zone(clock))


def today_for(clock: str = "", now: Optional[datetime] = None) -> date:
    """Today, on the person's clock."""
    return now_in(clock, now).date()


def day_in_utc(day: date, clock: str = "") -> tuple[datetime, datetime]:
    """The UTC instants a day on ``clock`` runs between: [start, end)."""
    z = _zone(clock)
    start = datetime(day.year, day.month, day.day, tzinfo=z)
    nxt = day + timedelta(days=1)
    end = datetime(nxt.year, nxt.month, nxt.day, tzinfo=z)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def fiscal_start() -> int:
    """The month the organisation's fiscal year starts (1 = January) — one reading for every prompt, period and compiler
    (the grounding audit, 2026-11-26: the setting reached only the narrator, after the SQL was written)."""
    try:
        from pramanyx.orgsettings import effective_settings
        return int(effective_settings(None).fiscal_year_start_month or 1)
    except Exception as exc:  # noqa: BLE001 — unread, calendar years are the documented default
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the organisation's fiscal year could not be read; calendar years", counter="kernel.clock.fiscal")
        return 1


def fiscal_years(today: date, start_month: int) -> tuple[tuple[date, date], tuple[date, date]]:
    """``(this fiscal year, last fiscal year)`` as days ``[start, end)``, the year starting in ``start_month``."""
    y = today.year if today.month >= start_month else today.year - 1
    this = (date(y, start_month, 1), date(y + 1, start_month, 1))
    return this, (date(y - 1, start_month, 1), this[0])


@dataclass(frozen=True)
class Periods:
    """The relative periods a question can name, counted from today on one clock. Ends are inclusive days."""

    clock: str
    today: date
    yesterday: date
    this_week_start: date
    last_week: tuple[date, date]
    this_month_start: date
    last_month: tuple[date, date]
    this_year_start: date
    last_year: tuple[date, date]


def periods(clock: str = "", now: Optional[datetime] = None) -> Periods:
    t = today_for(clock, now)
    week = t - timedelta(days=t.weekday())
    month = t.replace(day=1)
    last_month_end = month - timedelta(days=1)
    year = date(t.year, 1, 1)
    return Periods(clock=readable_zone(clock), today=t, yesterday=t - timedelta(days=1), this_week_start=week,
                   last_week=(week - timedelta(days=7), week - timedelta(days=1)), this_month_start=month,
                   last_month=(last_month_end.replace(day=1), last_month_end), this_year_start=year,
                   last_year=(date(t.year - 1, 1, 1), date(t.year - 1, 12, 31)))


def _iso_z(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%MZ")


def clock_line(clock: str = "", now: Optional[datetime] = None) -> str:
    """The one statement of the date a model is given — the same words wherever it is asked."""
    p = periods(clock, now)
    zone = p.clock or "UTC"
    y0, y1 = day_in_utc(p.yesterday, p.clock)
    utc_note = "" if zone == "UTC" else f" (as UTC instants, {_iso_z(y0)} up to {_iso_z(y1)})"
    return (f"TODAY: {p.today:%A %Y-%m-%d} in {zone}. Every relative period in the question is counted from today on "
            f"this clock: yesterday is {p.yesterday.isoformat()}{utc_note}; last week is "
            f"{p.last_week[0].isoformat()} to {p.last_week[1].isoformat()}; last month is "
            f"{p.last_month[0]:%B %Y}; this month runs from {p.this_month_start.isoformat()} to today; the last N days "
            f"are the N whole days ending yesterday (the last 30 days: {(p.yesterday - timedelta(days=29)).isoformat()} "
            f"to {p.yesterday.isoformat()}); over the last or past year is the 365 days ending yesterday "
            f"({(p.yesterday - timedelta(days=364)).isoformat()} to {p.yesterday.isoformat()}), and last year alone "
            f"is {p.last_year[0].year}. "
            + _fiscal_words(p.today) +
            "A period the question names is never moved: when the data holds no rows for it, say so plainly and do "
            "not answer for another period instead.")


def _fiscal_words(today: date) -> str:
    start = fiscal_start()
    if start == 1:
        return ""
    this, last = fiscal_years(today, start)
    return (f"The fiscal year starts on the 1st of {date(2000, start, 1):%B}: this fiscal year runs from {this[0].isoformat()} "
            f"to today, last fiscal year from {last[0].isoformat()} to {(last[1] - timedelta(days=1)).isoformat()}; "
            "a fiscal quarter is three months from that start. ")


def provisional_line(settle_days: int, clock: str = "", now: Optional[datetime] = None) -> str:
    """What a source that keeps revising its recent days changes about an answer: its figures for those days are
    provisional. Never the day asked about. "" for a source whose days settle the day after."""
    n = int(settle_days or 0)
    if n <= 1:
        return ""
    since = today_for(clock, now) - timedelta(days=n)
    return (f"This source keeps revising its most recent {n} days: figures for days after {since.isoformat()} are "
            "provisional — say so in one short clause, and still answer for the period asked.")


#: A period counted from today — "yesterday", "last month", "the past 6 months", "so far" (moved here 2026-11-17 from
#: `agent/investigate.py`, so the answer path and the answer-divergence detector read one definition).
RELATIVE_PERIOD_RE = re.compile(
    r"\b(today|yesterday|tonight|this\s+(?:day|week|month|quarter|year)|last|past|previous|prior|recent(?:ly)?|"
    r"trailing|so\s+far|to\s+date|mtd|qtd|ytd)\b", re.I)


def names_a_relative_period(question: str) -> bool:
    """True when the question names a period counted from today — "yesterday", "last month", "the past 6 months",
    "recent" — which is read on the person's clock from today and never from the data's last day (the user,
    2026-11-17)."""
    return bool(RELATIVE_PERIOD_RE.search(question or ""))



_LAST_N = re.compile(r"\b(?:last|past|previous|prior|trailing)\s+(\d{1,3})\s+(day|week|month)s?\b", re.I)


def period_named(question: str, clock: str = "", now: Optional[datetime] = None) -> Optional[tuple[date, date]]:
    """The period a question names, as days ``[start, end)`` on the person's clock — the same reading the answer's prompt
    is given (`clock_line`) — or None when it names none this can read. The last N days, weeks or months end yesterday;
    yesterday, today, this and last week, month and year are `periods`'."""
    q = (question or "").lower()
    p = periods(clock, now)
    day = timedelta(days=1)
    m = _LAST_N.search(q)
    if m:
        n, unit = int(m.group(1)), m.group(2).lower()
        days = n * {"day": 1, "week": 7, "month": 30}[unit] if unit != "month" else None
        if days is not None:
            return p.yesterday - timedelta(days=days - 1), p.today
        y, mo = p.today.year, p.today.month - n                 # the last N whole calendar months, this one unfinished
        while mo <= 0:
            mo += 12
            y -= 1
        return date(y, mo, 1), p.this_month_start
    # "over the last year", "in the past year": the year to yesterday, as the last N days are — not the calendar year
    # before this one, which "last year" alone names (theLook, 2026-11-27: "What stands out in our sales over the last
    # year?" was read as 2025 at every door, and the plain model beside them read the twelve months to date)
    if re.search(r"\b(?:over|in|during|across|for|within|through)\s+the\s+(?:last|past)\s+year\b|\bthe\s+past\s+year\b", q):
        return p.yesterday - timedelta(days=364), p.today
    fy = re.search(r"\b(this|current|last|previous|prior)\s+fiscal\s+year\b|\bfiscal\s+year\s+to\s+date\b|\bfytd\b", q)
    if fy:
        this, last = fiscal_years(p.today, fiscal_start())
        if fy.group(1) in ("last", "previous", "prior"):
            return last
        return this[0], p.today + day
    for words, span in (("yesterday", (p.yesterday, p.today)), ("today", (p.today, p.today + day)),
                        ("last week", (p.last_week[0], p.last_week[1] + day)), ("this week", (p.this_week_start, p.today + day)),
                        ("last month", (p.last_month[0], p.last_month[1] + day)),
                        ("this month", (p.this_month_start, p.today + day)),
                        ("last year", (p.last_year[0], p.last_year[1] + day)), ("this year", (p.this_year_start, p.today + day))):
        if re.search(rf"\b{words}\b", q):
            return span
    return None
