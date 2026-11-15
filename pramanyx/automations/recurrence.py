"""A schedule's recurrence — what a five-field cron cannot say (2026-11-15).

The user, 2026-11-15: "the scheduler needs to be one across the platform … flexibility & functionality is the core of
scheduler function". Measured that day against the agent shell's own scheduler, which the coworker carried beside
this one. Ours fires on eight kinds of trigger and runs fifteen kinds of governed step, keeps every run, retries, has
an owner; theirs delivers a sentence into a chat at a time. But theirs could say three things about TIME that a cron
cannot:

* **once**, at an instant — a cron repeats, so "once at three" was being faked here as "every five minutes, expiring
  in six" (the day's own test automations);
* **every N from a start** — every 90 minutes, every second week: a cron's ``*/45`` restarts at the top of each hour;
* **an ordinal or a number of runs** — the first Monday of the month, five times, until a date.

The shell's scheduler is off in the coworker and those three are said here, in the notation it used (RFC 5545: one
``DTSTART`` line and one ``RRULE`` line), so the one scheduler loses nothing by being the only one.

A schedule trigger's expression is a cron OR a recurrence, in the same field, read by the same door
(`engine.cron_trigger`): text that starts with ``DTSTART`` is a recurrence. One field and one reading, because a second key
would be a second thing every reader of a schedule has to know about, and this repo has paid for that three times.

A BOUNDED profile, refused at the save door with a sentence rather than half-honoured:

* ``FREQ`` is MINUTELY, HOURLY, DAILY, WEEKLY, MONTHLY or YEARLY (the tick is a minute; there is no SECONDLY).
* MINUTELY and HOURLY take ``INTERVAL``, ``COUNT`` and ``UNTIL`` only, and are stepped in elapsed time from the start
  — exact arithmetic, so asking is free however long the recurrence has run. "Every 15 minutes in office hours on
  weekdays" is a cron's sentence and stays one.
* DAILY and coarser are read by ``dateutil``, in the recurrence's own clock, DST included.

A floating ``DTSTART`` (no ``Z``, no ``TZID``) is read in the automation's own timezone, as its cron would be.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone as _timezone
from functools import lru_cache
from typing import Any, Optional

UTC = _timezone.utc

_FREQS = ("MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY")
_STEPPED = ("MINUTELY", "HOURLY")
_PARTS = ("FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "BYHOUR", "BYMINUTE",
          "WKST")
_START = re.compile(r"^DTSTART(?:;TZID=(?P<zone>[A-Za-z0-9_+\-/]+))?:(?P<day>\d{8})T(?P<time>\d{6})(?P<z>Z)?$", re.I)
_UNTIL = re.compile(r"^(?P<day>\d{8})(?:T(?P<time>\d{6})(?P<z>Z)?)?$", re.I)
_BYDAY = re.compile(r"^(?P<nth>[+-]?\d{1,2})?(?P<day>MO|TU|WE|TH|FR|SA|SU)$")
_DAYS = {"MO": "Mon", "TU": "Tue", "WE": "Wed", "TH": "Thu", "FR": "Fri", "SA": "Sat", "SU": "Sun"}
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_NTH = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", -1: "last", -2: "second-to-last"}
_UNIT = {"MINUTELY": "minute", "HOURLY": "hour", "DAILY": "day", "WEEKLY": "week", "MONTHLY": "month", "YEARLY": "year"}


class RecurrenceError(ValueError):
    """A recurrence this scheduler does not read, said as the sentence a person can act on."""


def is_recurrence(expression: Any) -> bool:
    """Whether a schedule's expression is a recurrence rather than a cron."""
    return str(expression or "").lstrip().upper().startswith("DTSTART")


def _zone(name: str):
    from zoneinfo import ZoneInfo
    try:
        return ZoneInfo(name)
    except Exception as exc:  # noqa: BLE001 — a typo'd clock, whatever the lookup raised
        raise RecurrenceError(f"unknown timezone {name!r} in the recurrence — an IANA name like Europe/Berlin") from exc


def _instant(day: str, time: str, tz) -> datetime:
    try:
        return datetime(int(day[:4]), int(day[4:6]), int(day[6:8]),
                        int(time[:2]), int(time[2:4]), int(time[4:6]), tzinfo=tz)
    except ValueError as exc:
        raise RecurrenceError(f"{day}T{time} is not a date and time ({exc})") from exc


@dataclass(frozen=True)
class Recurrence:
    """One parsed recurrence. ``start`` carries the clock the recurrence is read in; ``until`` is UTC."""
    text: str
    start: datetime
    zone: str
    freq: str
    interval: int
    count: Optional[int]
    until: Optional[datetime]
    parts: dict = field(compare=False, hash=False, repr=False, default_factory=dict)
    _steps: Any = field(compare=False, hash=False, repr=False, default=None)

    @property
    def once(self) -> bool:
        return self.count == 1

    def at_or_after(self, moment: datetime) -> Optional[datetime]:
        """The first occurrence at or after ``moment`` (UTC), or None when the recurrence has no run left."""
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=UTC)
        if self.freq in _STEPPED:
            step = timedelta(minutes=self.interval) if self.freq == "MINUTELY" else timedelta(hours=self.interval)
            begin = self.start.astimezone(UTC)
            k = 0 if moment <= begin else -((begin - moment) // step)          # ceiling, on whole timedeltas
            if self.count is not None and k >= self.count:
                return None
            found = begin + k * step
            return None if (self.until is not None and found > self.until) else found
        found = self._steps.after(moment.astimezone(self.start.tzinfo), inc=True)
        return found.astimezone(UTC) if found is not None else None

    # ── in words ─────────────────────────────────────────────────────────────────
    def _clock(self) -> str:
        return f"{self.start.hour:02d}:{self.start.minute:02d} {self.zone}"

    def _day(self, at: Optional[datetime] = None) -> str:
        at = at or self.start
        return f"{_DAYS[('MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU')[at.weekday()]]} {at.day} {_MONTHS[at.month - 1]} {at.year}"

    def _every(self) -> str:
        unit = _UNIT[self.freq]
        return f"Every {unit}" if self.interval == 1 else f"Every {self.interval} {unit}s"

    def said(self) -> str:
        """The recurrence as a person would say it, its clock named. A shape this cannot say is quoted, never guessed."""
        if self.once:
            return f"Once, on {self._day()} at {self._clock()}"
        named = {k for k in self.parts if k.startswith("BY")}
        tail = ""
        if self.count:
            tail = f", {self.count} times"
        elif self.until is not None:
            tail = f", until {self._day(self.until.astimezone(self.start.tzinfo))}"
        since = f", from {self._day()}"
        if self.freq in _STEPPED:
            return f"{self._every()}{since} at {self._clock()}{tail}"
        if self.freq == "DAILY" and not named:
            return f"{self._every()} at {self._clock()}{since if self.interval > 1 else ''}{tail}"
        if self.freq == "WEEKLY" and named <= {"BYDAY"}:
            days = [d.strip().upper() for d in self.parts.get("BYDAY", "").split(",") if d.strip()]
            if all(d in _DAYS for d in days):
                on = ", ".join(_DAYS[d] for d in days) or self._day().split(" ")[0]
                return f"{self._every()} on {on} at {self._clock()}{since if self.interval > 1 else ''}{tail}"
        if self.freq == "MONTHLY" and len(named) == 1:
            which = "every month" if self.interval == 1 else f"every {self.interval} months"
            if "BYDAY" in named:
                m = _BYDAY.match(self.parts["BYDAY"].strip().upper())
                if m and m.group("nth") and int(m.group("nth")) in _NTH:
                    return f"On the {_NTH[int(m.group('nth'))]} {_DAYS[m.group('day')]} of {which} at {self._clock()}{tail}"
            if "BYMONTHDAY" in named and re.fullmatch(r"-?\d{1,2}", self.parts["BYMONTHDAY"].strip()):
                day = int(self.parts["BYMONTHDAY"])
                on = "the last day" if day == -1 else f"day {day}"
                return f"On {on} of {which} at {self._clock()}{tail}"
        if self.freq == "MONTHLY" and not named:
            which = "every month" if self.interval == 1 else f"every {self.interval} months"
            return f"On day {self.start.day} of {which} at {self._clock()}{tail}"
        if self.freq == "YEARLY" and not named:
            return f"{self._every()} on {self.start.day} {_MONTHS[self.start.month - 1]} at {self._clock()}{tail}"
        return f"On the recurrence {self.text.splitlines()[1]}, from {self._day()} at {self._clock()}"


def _until(raw: str, tz) -> datetime:
    m = _UNTIL.match(raw.strip())
    if not m:
        raise RecurrenceError(f"UNTIL={raw} is not a date (20261231) or a date and time (20261231T170000Z)")
    if m.group("time") is None:
        # A day with no time is the whole of that day, in the recurrence's own clock.
        return _instant(m.group("day"), "235959", tz).astimezone(UTC)
    return _instant(m.group("day"), m.group("time"), UTC if m.group("z") else tz).astimezone(UTC)


@lru_cache(maxsize=512)
def parse(expression: str, timezone: str = "") -> Recurrence:
    """Read a recurrence, or say why not. ``timezone`` is the automation's own clock: a floating start is read in it."""
    lines = [line.strip() for line in str(expression or "").replace("\\n", "\n").splitlines() if line.strip()]
    if len(lines) != 2 or not lines[1].upper().startswith("RRULE:"):
        raise RecurrenceError("a recurrence is two lines: DTSTART:20261116T090000 and RRULE:FREQ=WEEKLY;BYDAY=MO")
    head = _START.match(lines[0])
    if not head:
        raise RecurrenceError(f"{lines[0]!r} is not a start — DTSTART:20261116T090000, with Z for UTC or "
                        ";TZID=Europe/Berlin before the colon for another clock")
    if head.group("z") and head.group("zone"):
        raise RecurrenceError("a start names its clock once: Z for UTC, or TZID, not both")
    zone = "UTC" if head.group("z") else (head.group("zone") or timezone or "UTC")
    tz = UTC if zone == "UTC" else _zone(zone)
    start = _instant(head.group("day"), head.group("time"), tz)

    parts: dict[str, str] = {}
    for piece in lines[1][len("RRULE:"):].split(";"):
        if not piece.strip():
            continue
        key, _, value = piece.partition("=")
        key, value = key.strip().upper(), value.strip().upper()
        if key not in _PARTS or not value:
            raise RecurrenceError(f"{piece.strip()!r} is not part of a recurrence this scheduler reads — it reads "
                            + ", ".join(_PARTS))
        if key in parts:
            raise RecurrenceError(f"{key} is given twice")
        parts[key] = value
    freq = parts.get("FREQ", "")
    if freq not in _FREQS:
        raise RecurrenceError("FREQ must be one of " + ", ".join(_FREQS) + " — the scheduler looks once a minute")

    def whole(key: str, least: int = 1) -> Optional[int]:
        if key not in parts:
            return None
        if not re.fullmatch(r"\d{1,6}", parts[key]) or int(parts[key]) < least:
            raise RecurrenceError(f"{key}={parts[key]} must be a whole number of at least {least}")
        return int(parts[key])

    interval = whole("INTERVAL") or 1
    count = whole("COUNT")
    if count is not None and "UNTIL" in parts:
        raise RecurrenceError("a recurrence ends by COUNT or by UNTIL, not both")
    until = _until(parts["UNTIL"], tz) if "UNTIL" in parts else None
    if until is not None and until < start.astimezone(UTC):
        raise RecurrenceError("UNTIL is before the start, so the recurrence would never run")

    steps = None
    if freq in _STEPPED:
        extra = sorted(k for k in parts if k not in ("FREQ", "INTERVAL", "COUNT", "UNTIL"))
        if extra:
            raise RecurrenceError(f"a {freq.lower()} recurrence takes INTERVAL, COUNT and UNTIL only, not {', '.join(extra)} — "
                            "hours and weekdays within a day are a cron's to say (*/15 9-17 * * 1-5)")
    else:
        from dateutil.rrule import rrulestr
        written = dict(parts)
        if until is not None:
            written["UNTIL"] = until.strftime("%Y%m%dT%H%M%SZ")
        try:
            steps = rrulestr("RRULE:" + ";".join(f"{k}={v}" for k, v in written.items()), dtstart=start, cache=True)
        except (ValueError, TypeError) as exc:
            raise RecurrenceError(f"the recurrence could not be read: {exc}") from exc

    # Written back the one way: the start as it was read (its clock named as it was named), the parts upper-case.
    moment = f"{head.group('day')}T{head.group('time')}"
    first = (f"DTSTART:{moment}Z" if head.group("z")
             else f"DTSTART;TZID={head.group('zone')}:{moment}" if head.group("zone") else f"DTSTART:{moment}")
    text = f"{first}\nRRULE:" + ";".join(f"{k}={v}" for k, v in parts.items())
    return Recurrence(text=text, start=start, zone=zone, freq=freq, interval=interval, count=count, until=until,
                parts=parts, _steps=steps)


class RecurrenceTrigger:
    """A recurrence behind the one method the engine asks of a cron trigger, so every reader of a schedule's next time
    (`engine.next_fire_utc`, `engine._schedule_fired`, the drafts' first run) reads both through one door."""

    def __init__(self, expression: str, timezone: str = ""):
        self.recurrence = parse(str(expression or "").strip(), timezone or "")

    def get_next_fire_time(self, previous_fire_time, now):  # noqa: ARG002 — the cron trigger's own signature
        return self.recurrence.at_or_after(now)


def said(expression: str, timezone: str = "") -> str:
    """A recurrence in words, or "" for text that is not one (a cron is worded by its own readers)."""
    if not is_recurrence(expression):
        return ""
    try:
        return parse(str(expression).strip(), timezone or "").said()
    except RecurrenceError:
        return ""


_CRON_DAYS = {"0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu", "5": "Fri", "6": "Sat", "7": "Sun",
              "sun": "Sun", "mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu", "fri": "Fri", "sat": "Sat"}


def said_when(expression: str, timezone: str = "") -> str:
    """A schedule's expression in words, its clock named: a recurrence by its own reading, a cron by the shapes a person
    states (hourly, daily, weekly, monthly — the app's `cronWords`, in the same words), and any other cron quoted
    rather than guessed at."""
    text = str(expression or "").strip()
    if is_recurrence(text):
        return said(text, timezone) or f"On a recurrence that could not be read: {text.splitlines()[0]}"
    clock = timezone or "UTC"
    quoted = f"On the cron schedule {text} ({clock})" if text else ""
    fields = text.split()
    if len(fields) != 5:
        return quoted
    minute, hour, day, month, weekday = fields
    whole = lambda value, top: value.isdigit() and int(value) <= top          # noqa: E731
    if whole(minute, 59) and hour == day == month == weekday == "*":
        return f"Every hour at minute {int(minute)}"
    if not (whole(minute, 59) and whole(hour, 23)) or month != "*":
        return quoted
    at = f"{int(hour):02d}:{int(minute):02d} {clock}"
    if day == "*" and weekday == "*":
        return f"Every day at {at}"
    if day == "*":
        names = [_CRON_DAYS.get(piece.strip().lower(), "") for piece in weekday.split(",")]
        return f"Every {', '.join(names)} at {at}" if all(names) else quoted
    if weekday == "*" and day.isdigit() and 1 <= int(day) <= 31:
        return f"Monthly on day {int(day)} at {at}"
    return quoted


def once_at(when: datetime) -> str:
    """The recurrence for one run at ``when``. A naive moment stays floating: it is read in the automation's own clock."""
    if when.tzinfo is not None:
        return f"DTSTART:{when.astimezone(UTC):%Y%m%dT%H%M%S}Z\nRRULE:FREQ=DAILY;COUNT=1"
    return f"DTSTART:{when:%Y%m%dT%H%M%S}\nRRULE:FREQ=DAILY;COUNT=1"
