"""A schedule is never held back by the platform's housekeeping (found live, 2026-11-15).

The one-minute tick ran every due schedule and THEN the hourly and daily work; after a restart the daily settling
reading ran past five minutes, and every tick in that time was skipped ("maximum number of running instances"), so a
person's every-five-minutes schedule did not fire. The two now run as two jobs."""
from __future__ import annotations

from pramanyx.automations import scheduler as S


def test_the_schedules_tick_does_no_housekeeping(monkeypatch):
    called = []
    monkeypatch.setattr("pramanyx.automations.store.list_automations", lambda enabled_only=True: [])
    monkeypatch.setattr("pramanyx.automations.adopt.list_adopted_automations", lambda: [])
    monkeypatch.setattr(S, "housekeeping_once", lambda: called.append("housekeeping") or {})
    monkeypatch.setattr(S, "run_due_reviews_hourly", lambda **k: called.append("reviews") or 0)
    S.tick_schedules_once()
    assert called == []


def test_an_outside_clock_still_gets_both(monkeypatch):
    monkeypatch.setattr(S, "tick_schedules_once", lambda: {"automations": 2})
    monkeypatch.setattr(S, "housekeeping_once", lambda: {"reviews": 1})
    assert S.tick_once() == {"automations": 2, "reviews": 1}


def test_the_heartbeat_and_the_housekeeping_are_two_jobs(monkeypatch):
    added = {}

    class _Sched:
        def add_job(self, fn, trigger=None, id=None, name=None, replace_existing=False):
            added[id] = fn

        def start(self):
            pass
    monkeypatch.setattr(S, "_scheduler", _Sched())
    monkeypatch.setattr(S, "_started", False)
    S.start()
    assert added == {"automation_heartbeat": S.tick_schedules_once, "automation_housekeeping": S.housekeeping_once}
