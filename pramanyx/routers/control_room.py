"""Wave CR3/CR4 — the fleet overview and the needs-a-human list.

Both endpoints are VIEWS (J10/J12): every number is folded at read time from a
store that already exists — jobs, charters+governance, personas, the session
log's usage rollup, the kinetic inbox, investigation history and automation
runs. Nothing here writes, and there is no control-room store to drift.

Honesty rules the fleet table is built on (each earned by a measurement):

- **Charter ≠ persona.** One table, but every row is labelled with its kind —
  the collision was dodged twice in Wave H and stays dodged.
- **Two spend sources, never one measurement.** Charter spend rides job-row
  metering (`jobs.metrics`, works with the session log off); persona spend
  rides H2's `agent_id` axis over the session log. They are reported under
  different keys with different caveats.
- **NULL metrics is not zero spend.** ~44% of live job rows carry no metrics
  (orphaned restarts never reach the metering flush) — those are counted as
  `unmetered_runs`, never as 0 tokens.
- **An orphaned restart is not an agent error.** The error-rate tile excludes
  interrupted runs (`JobState.INTERRUPTED`) and reports them separately. That used
  to be an error-string match, which silently never fired for jobs — the string it
  compared against is the investigations wording.
- **Concurrency is what the kernel actually has**: one global cap plus an
  exemption set (`concurrency_policy()`), not per-agent knobs.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter

# The error string boot recovery writes on rows a process restart orphaned —
# imported from the producer so the exact-equality match below can never drift blind.
from pramanyx.db.history import ORPHAN_REASON as _ORPHAN_ERROR
from pramanyx.kernel.ledger import Ledger

logger = logging.getLogger(__name__)
router = APIRouter(tags=["control-room"])

_ACTIVE_STATES = ["PENDING", "RUNNING", "PAUSED"]


def _parse_ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# The accumulators a fold keeps for itself; `_fold_columns` settles them into the row.
_FOLD_PRIVATE = ("kinds", "_dur_sum", "_dur_n")


def _empty_fold(spark_buckets: int) -> dict:
    """A charter or runner with no job in the window: every shared column at rest."""
    return {
        "runs": 0, "succeeded": 0, "failed": 0, "orphaned": 0, "tokens": 0, "queries": 0,
        "metered_runs": 0, "unmetered_runs": 0, "last_run_at": None,
        "spark": [0] * spark_buckets, "kinds": set(), "_dur_sum": 0.0, "_dur_n": 0,
    }


def _fold_columns(fold: dict) -> dict:
    """The shared columns of a fleet row, from its fold. The private accumulators go, and
    the mean run duration is settled: `avg_duration_ms` is None when no job in the window
    finished with both timestamps, never 0 — an unmeasured run is not a fast one."""
    n = int(fold.get("_dur_n") or 0)
    out = {k: v for k, v in fold.items() if k not in _FOLD_PRIVATE}
    out["avg_duration_ms"] = round(float(fold.get("_dur_sum") or 0.0) / n) if n else None
    return out


def _pct(values: list[float], q: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int(len(ordered) * q))], 1)


#: A runner named for what it IS, rather than for the fact that no charter claimed it.
#: "Unassigned kinds" described the lookup that produced the row; a reader wants to know
#: it is the automations engine.
_RUNNER_NAMES = {
    "automation": "Automations",
    "eval_experiment": "Evals",
}


def _runner_role(kinds: list[str], fold: dict) -> str:
    """One line saying what this runner does and how much of it is nothing.

    The automation engine records a job PER TICK, including the overwhelming majority
    that evaluate and fire nothing — so "1,291 runs" is a heartbeat, not work, and the
    row has to say so or it reads as the busiest agent on the fleet.
    """
    if kinds == ["automation"]:
        runs = int(fold.get("runs") or 0)
        return (f"scheduled · one evaluation tick per minute · {runs:,} ticks in window, "
                f"no model calls")
    if kinds == ["eval_experiment"]:
        return "eval experiments · run on demand"
    return "job kinds with no charter: " + (", ".join(kinds) or "none")


def _window_cost(win) -> dict:
    """What the window's model calls cost, with the share nothing could price.

    Priced from the provider's own published catalogue (never a hardcoded rate), and a
    figure that cannot be completed says so: `unpriced_calls` is the number that stops a
    small total reading as a cheap day.
    """
    from pramanyx.obs.session_log import refused
    from pramanyx.obs.usage import cost_of_call
    try:
        scanned = Ledger.default().session_events(
            kind="llm_call", since=win.since, until=win.until, limit=20000)
    except Exception:
        logger.warning("fleet: window cost scan failed", exc_info=True)
        return {"usd": None, "unpriced_calls": None, "is_complete": False, "calls": 0}
    # A refused attempt (no model ran) costs nothing and is not a call made: said apart.
    rows = [e for e in scanned if not refused(e)]
    usd, unpriced = 0.0, 0
    for e in rows:
        call_usd, priced = cost_of_call(e)
        usd += call_usd
        unpriced += 0 if priced else 1
    return {"usd": round(usd, 4), "unpriced_calls": unpriced,
            "is_complete": unpriced == 0, "calls": len(rows), "refused_calls": len(scanned) - len(rows)}


# ── CR3: the fleet overview ──────────────────────────────────────────────────────

@router.get("/control-room/fleet")
def fleet_overview(window_minutes: int = 60, spark_hours: int = 24,
                   range: str = "", since: str = "", until: str = "",
                   include_runners: bool = False):
    """KPI tiles + the fleet table, over ONE window shared with every other panel.

    `range` (or explicit `since`/`until`) is the shared time axis; `window_minutes` /
    `spark_hours` remain for callers that predate it. The tiles and the row sparklines
    now bucket through the SAME window — they used to disagree by construction, the
    tiles counting a 60-minute window while the sparks drew 24 hourly buckets.

    **Runners are not agents.** Job kinds no charter claims — the automation engine's
    every-minute evaluation tick, eval experiments — come back in `runners`, never in
    `rows`, and never inside the tile counts unless `include_runners` is set. Measured
    2026-08-17 that tick was 1,291 of 1,316 jobs in twenty-four hours, so folding it in
    turns every agent metric into a rounding error on a cron and makes runs/min a
    heartbeat reading.

    Cost IS here now (roadmap decision 2, 2026-08-17), priced from the provider's own
    catalogue and always carrying its unpriced share; `GET /usage` keeps the full ledger
    behind billing RBAC.
    """
    from pramanyx.kernel.agents import is_enabled as charter_enabled
    from pramanyx.kernel.agents import charter_for_kind, list_charters
    from pramanyx.kernel.jobs import concurrency_policy
    from pramanyx.obs.timeseries import (JOB_READ_LIMIT, bucket_edges, job_rows,
                                       resolve_window)
    from pramanyx.custom_agents.store import list_agents as list_personas

    ledger = Ledger.default()
    now = datetime.now(timezone.utc)
    if range or since or until:
        win = resolve_window(range, since=since, until=until)
    else:
        win = resolve_window(since=(now - timedelta(minutes=max(1, int(window_minutes))))
                             .isoformat(), until=now.isoformat())
    window_start = win.since_dt
    window_minutes = max(1, int((win.until_dt - win.since_dt).total_seconds() // 60))
    spark_start = window_start

    # ONE bounded read, shared with the chart, split BY KIND in the query. `active` is
    # deliberately unbounded by time — a job running since yesterday is running NOW.
    #
    # This used to be a single capped read that was classified afterwards, and the cap
    # was the bug: the tick outnumbers agent work ~45:1, so the newest 5,000 rows were
    # almost all tick and the agent runs fell off the end. Measured on a real store over
    # seven days it reported 143 agent runs where there were 250 — a 43% undercount, with
    # the chart beside it drawing the true number, because it read with a larger cap.
    # `job_rows` now issues one read per side, so neither can starve the other, and says
    # when a cap was actually reached.
    agent_rows, runner_rows, truncated = job_rows(win, limit=JOB_READ_LIMIT)
    active = ledger.jobs_where(states=_ACTIVE_STATES, limit=500)

    # ── tiles, from the jobs table ────────────────────────────────────────────
    # Every job carries its charter from the read, so "is this an agent or a runner" is
    # decided in ONE place and the tiles, the sparks and the table cannot disagree.
    jobs = agent_rows + runner_rows
    for j in jobs:
        j["_charter"] = j.get("charter_id") or charter_for_kind(j.get("kind")).id
    runner_jobs = runner_rows
    agent_jobs = jobs if include_runners else agent_rows

    in_window: list[dict] = []
    durations_ms: list[float] = []
    failed = orphaned = succeeded = 0
    tokens = 0
    metered = unmetered = 0
    for j in agent_jobs:
        created = _parse_ts(j.get("created_at"))
        if created is None or created < window_start:
            continue
        in_window.append(j)
        started, finished = _parse_ts(j.get("started_at")), _parse_ts(j.get("finished_at"))
        if started and finished:
            durations_ms.append((finished - started).total_seconds() * 1000)
        state = j.get("state")
        if state == "INTERRUPTED":
            orphaned += 1
        elif state == "FAILED":
            # The legacy string match stays for rows written before INTERRUPTED
            # existed. It never matched a JOB even then — `_ORPHAN_ERROR` is the
            # *investigations* wording, while an orphaned job says "lease lapsed
            # (orphaned)" — so every restart-killed job has been counted as an agent
            # error, which is exactly what this split exists to prevent. The status
            # is now the authority; a key that must equal a sentence is how a guard
            # goes blind.
            if (j.get("error") or "") == _ORPHAN_ERROR:
                orphaned += 1
            else:
                failed += 1
        elif state == "SUCCEEDED":
            succeeded += 1
        metrics = j.get("metrics") or {}
        if isinstance(metrics, dict) and metrics.get("total_tokens") is not None:
            metered += 1
            tokens += int(metrics.get("total_tokens") or 0)
        elif state not in _ACTIVE_STATES:
            unmetered += 1

    finished_in_window = failed + orphaned + succeeded
    tiles = {
        "active_jobs": len(active),
        "window_minutes": int(window_minutes),
        "runs_started": len(in_window),
        "runs_per_min": round(len(in_window) / max(1, int(window_minutes)), 2),
        "p95_duration_ms": _pct(durations_ms, 0.95),
        "p50_duration_ms": _pct(durations_ms, 0.50),
        # Agent errors only; an orphaned restart is an infrastructure fact.
        "error_rate": (round(failed / finished_in_window, 3)
                       if finished_in_window else None),
        "failed_runs": failed,
        "orphaned_runs": orphaned,
        "tokens": {"total": tokens, "metered_runs": metered,
                   "unmetered_runs": unmetered,
                   "per_hour": round(tokens / max(int(window_minutes) / 60, 1e-9))
                   if metered else None},
        "concurrency": concurrency_policy(),
        # What was left OUT of every number above, stated rather than implied. A reader
        # who sees "24 runs" while the machine did 1,315 things is owed the difference.
        "runner_runs": len(runner_jobs),
        "include_runners": bool(include_runners),
        # True when a read filled its cap: every count here is then a floor, not a total.
        "truncated": bool(truncated),
        "window": win.as_dict(),
    }
    tiles["cost"] = _window_cost(win)

    # ── charter rows, from job metering ──────────────────────────────────────
    # Sparks bucket through the SHARED window, so a row's bars and the tiles above it
    # describe the same span. They used to be independent (60-minute tiles, 24 hourly
    # bars) — two time bases in one table, which is a chart that cannot be read.
    spark_buckets = win.bucket_count
    bucket_seconds = win.bucket_seconds
    by_charter: dict[str, dict] = {}
    for j in jobs:
        charter = charter_for_kind(j.get("kind"))
        row = by_charter.setdefault(charter.id, _empty_fold(spark_buckets))
        row["runs"] += 1
        row["kinds"].add(j.get("kind") or "")
        if j.get("state") == "INTERRUPTED":
            row["orphaned"] += 1
        elif j.get("state") == "FAILED":
            row["orphaned" if (j.get("error") or "") == _ORPHAN_ERROR else "failed"] += 1
        elif j.get("state") == "SUCCEEDED":
            row["succeeded"] += 1
        # How long a run took, from its own timestamps — a failed run took time too, so
        # every finished pair counts, whatever the state.
        started, finished = _parse_ts(j.get("started_at")), _parse_ts(j.get("finished_at"))
        if started and finished:
            row["_dur_sum"] += (finished - started).total_seconds() * 1000
            row["_dur_n"] += 1
        metrics = j.get("metrics") or {}
        if isinstance(metrics, dict) and metrics.get("total_tokens") is not None:
            row["metered_runs"] += 1
            row["tokens"] += int(metrics.get("total_tokens") or 0)
            row["queries"] += int(metrics.get("query_count") or 0)
        elif j.get("state") not in _ACTIVE_STATES:
            row["unmetered_runs"] += 1
        created = _parse_ts(j.get("created_at"))
        if created:
            if row["last_run_at"] is None or str(j["created_at"]) > row["last_run_at"]:
                row["last_run_at"] = str(j["created_at"])
            if created >= spark_start:
                bucket = min(spark_buckets - 1,
                             int((created - spark_start).total_seconds() // bucket_seconds))
                row["spark"][bucket] += 1

    rows: list[dict] = []
    for charter in list_charters():
        fold = by_charter.pop(charter.id, None) or _empty_fold(spark_buckets)
        rows.append({
            "kind": "charter", "id": charter.id, "name": charter.name,
            "role": charter.role, "icon": charter.icon, "lane": charter.lane,
            "enabled": charter_enabled(charter.id),
            "job_kinds": list(charter.job_kinds),
            "spend_source": "job_metering",
            **_fold_columns(fold),
        })
    # Job kinds no charter claims are RUNNERS, not agents — the automation engine's
    # every-minute evaluation tick, eval experiments. They used to fold into one row
    # called "Unassigned kinds" sitting in the agent table, where the tick's 1,291 runs
    # per day dwarfed every real agent and set the shape of every sparkline on the page.
    # They come back in their own list now: still counted, still visible (spend nobody
    # can see is the reason the row was invented), never mixed into the agents.
    runners: list[dict] = []
    for worker_id, fold in by_charter.items():
        kinds = sorted(k for k in fold["kinds"] if k)
        runners.append({
            "kind": "runner", "id": worker_id,
            "name": _RUNNER_NAMES.get(kinds[0] if len(kinds) == 1 else "", "Background runners"),
            "role": _runner_role(kinds, fold),
            "icon": "gear", "lane": "background", "enabled": True,
            "job_kinds": kinds, "spend_source": "job_metering",
            **_fold_columns(fold),
        })

    # ── persona rows, from H2's agent axis over the session log ──────────────
    # Personas are a permanent surface (flag endgame Wave 2, 2026-08-06) — the
    # fleet table always lists user-defined agents; an empty roster is honest.
    personas_on = True
    # A custom agent's work is CALLS in the session log, not jobs in the kernel — it
    # answers inside a request rather than submitting a run. Folding those calls into
    # the same columns the charters use (runs, spark, tokens, last run) is what lets one
    # table hold both without half its cells reading "—", and the `spend_source` on every
    # row keeps the two populations legible rather than silently summed.
    events_by_agent: dict[str, list[dict]] = {}
    from pramanyx.obs.session_log import refused
    try:
        for e in ledger.session_events(kind="llm_call", since=win.since, until=win.until,
                                       limit=20000):
            # The agent's CALLS: an attempt the provider refused ran no model and is not one of them
            # (its row stays in the log, counted apart on the usage page).
            if e.get("agent_id") and not refused(e):
                events_by_agent.setdefault(e["agent_id"], []).append(e)
    except Exception:
        logger.warning("fleet: custom-agent event scan failed", exc_info=True)
    # AO-3 (2026-10-03): the row's calls and tokens are rolled up from the SAME windowed
    # scan the spark and "last run" read — not from `usage_report`, which read the newest
    # 5,000 calls of any age and gave the row an all-time number beside a windowed spark.
    persona_usage: dict[str, Any] = {}
    if personas_on and events_by_agent:
        try:
            from pramanyx.obs.usage import rollup
            report = rollup([e for rows in events_by_agent.values() for e in rows],
                            axes=("agent_id",))
            persona_usage = {r.key.get("agent_id"): r for r in report.rows}
        except Exception:
            logger.warning("fleet: custom-agent usage rollup failed", exc_info=True)
    for persona in (list_personas() if personas_on else []):
        usage_row = persona_usage.get(persona.id)
        if usage_row is None:
            spend = {"measured": True, "calls": 0, "total_tokens": 0,
                     "failure_rate": None}
        else:
            spend = {"measured": True, "calls": usage_row.calls,
                     "total_tokens": usage_row.total_tokens,
                     "failure_rate": (round(usage_row.failures / usage_row.calls, 3)
                                      if usage_row.calls else None)}
        mine = events_by_agent.get(persona.id, [])
        spark = [0] * spark_buckets
        for e in mine:
            idx = win.index_of(e.get("at") or "")
            if idx is not None:
                spark[idx] += 1
        # A custom agent's run is a TRACE. It succeeded when none of its calls failed, and
        # it took the sum of its calls' durations — model time, which is what the session
        # log records; the answer's wall time (SQL, tools) is longer and is not claimed.
        traces: dict[str, dict] = {}
        for e in mine:
            tid = e.get("trace_id")
            if not tid:
                continue
            t = traces.setdefault(tid, {"ok": True, "ms": 0.0, "timed": False})
            if e.get("ok") is False:
                t["ok"] = False
            if e.get("duration_ms") is not None:
                t["ms"] += float(e.get("duration_ms") or 0.0)
                t["timed"] = True
        timed = [t["ms"] for t in traces.values() if t["timed"]]
        rows.append({
            "kind": "persona", "id": persona.id, "name": persona.name,
            "enabled": persona.enabled, "connection_id": persona.connection_id,
            "last_eval": persona.last_eval, "eval_basis": persona.eval_basis,
            "spend_source": "session_log",
            "spend": spend,
            # The shared columns, from the agent's own calls.
            "runs": len({e.get("trace_id") for e in mine if e.get("trace_id")}),
            "succeeded": sum(1 for t in traces.values() if t["ok"]),
            "failed": sum(1 for e in mine if e.get("ok") is False),
            "avg_duration_ms": round(sum(timed) / len(timed)) if timed else None,
            "orphaned": 0,
            "tokens": sum(int(e.get("total_tokens") or 0) for e in mine),
            "metered_runs": sum(1 for e in mine if e.get("total_tokens") is not None),
            "unmetered_runs": sum(1 for e in mine if e.get("total_tokens") is None),
            "queries": 0,
            "spark": spark,
            "last_run_at": max((str(e.get("at") or "") for e in mine), default=None),
        })

    return {"tiles": tiles, "rows": rows, "runners": runners,
            "window": win.as_dict(), "edges": bucket_edges(win),
            "session_log_recording": True}


# ── CR4: needs a human ───────────────────────────────────────────────────────────

#: How many of each source the needs-human counts read, whatever ``limit`` trims the rows to.
_COUNT_SCAN = 500


@router.get("/control-room/needs-human")
def needs_human(limit: int = 100):
    """One derived list over the five real sources — a VIEW, never a queue.

    Each row deep-links to its native resolve surface, so resolving anywhere
    removes it everywhere by construction (one store per source, no copies).
    `count` equals the sum of the per-source counts at read time — that
    equality is the CR4 gate. The derivation is `record.needs_you.waiting`, which the Inbox reads too; this route
    alone sweeps first — lapsed proposals expired, the runs parked behind them released (RC-3, DS-8).
    """
    from pramanyx.record.needs_you import waiting

    # `limit` trims the ROWS returned, never what is counted: the counts read up to `_COUNT_SCAN` of each source (the
    # Agent Ops badge asks for one row, and once counted at most one of each, 2026-10-13).
    got = waiting(sweep=True, scan=max(int(limit), _COUNT_SCAN))
    return {
        "count": sum(got["sources"].values()),
        "sources": got["sources"],
        "rows": got["rows"][: max(1, int(limit))],
        "unread": got["unread"],
    }
