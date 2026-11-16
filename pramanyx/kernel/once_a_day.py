"""A daily job runs once a UTC day — and a restart does not make it a new day (2026-11-16).

Found looking into a slow Catalog: the platform's daily housekeeping — the settling reading, the re-check of past
answers, the agents' nightly evaluation, the Briefing recall — each kept "already ran today" in a module variable,
which a restart forgets. So every restart of the API ran the day's work again: the settling reading's warehouse
queries (three minutes of BigQuery on one connection, measured, with the Catalog's own small reads waiting behind
them) and the nightly evaluation's model calls, paid each time.

The day is claimed in the ledger instead, by one insert that two processes cannot both win
(`Ledger.kv_put_if_absent`, as a send claims itself in `notifications/sent_once.py`). The module variable stays as
each job's cheap first answer; this is the one a restart cannot lose.
"""
from __future__ import annotations

STORE = "daily_runs"
#: Claims kept: a few jobs a day for about a year; the oldest go first.
KEEP = 2000


def first_today(job: str, day: str) -> bool:
    """True when ``job`` has not yet run on ``day`` (an ISO date, UTC) in this install — and records that it now has.

    A claim that cannot be recorded lets the job run, as before this existed: a day's work missed is worse than a
    day's work done twice."""
    try:
        from pramanyx.kernel.ledger import Ledger
        from pramanyx.util.time import now_iso_z
        return Ledger.default().kv_put_if_absent(STORE, f"{job}|{day}", {"at": now_iso_z()}, max_entries=KEEP)
    except Exception as exc:  # noqa: BLE001 — the ledger unreadable is no reason to skip the day's work
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "a daily job's claim could not be recorded; it runs, as before", counter="kernel.once_a_day")
        return True
