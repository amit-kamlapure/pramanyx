"""A daily job runs once a UTC day, and a restart does not make it a new day (2026-11-16).

Each of the four daily jobs kept "already ran today" in a module variable, which a restart forgets: every restart of
the API ran the settling reading's warehouse queries and the agents' nightly evaluation's model calls again. The day
is claimed in the ledger now (`kernel.once_a_day`); a restart is simulated here by forgetting the module variable.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pramanyx.kernel.once_a_day import first_today

DAY = datetime(2031, 3, 4, 9, 0, tzinfo=timezone.utc)


def test_a_day_is_claimed_once():
    assert first_today("a_test_job", "2031-03-04") is True
    assert first_today("a_test_job", "2031-03-04") is False
    assert first_today("a_test_job", "2031-03-05") is True
    assert first_today("another_test_job", "2031-03-04") is True


def test_the_settling_reading_is_not_taken_again_after_a_restart(monkeypatch):
    from pramanyx.settling import sampler
    read: list = []
    monkeypatch.setattr("pramanyx.db.registry.list_connections", lambda: [{"id": "c1"}])
    monkeypatch.setattr(sampler, "time_tables", lambda cid: [("t", "ts", 1)])
    monkeypatch.setattr("pramanyx.db.measure.run_sql_for", lambda cid, **kw: (lambda sql: (["d", "n"], [], None)))
    monkeypatch.setattr(sampler, "sample_connection", lambda cid, run_sql, today=None: read.append(cid) or {"sampled": ["t"], "errors": {}})
    monkeypatch.setattr(sampler, "_last_sample_day", "")
    assert sampler.run_settling_samples_daily(now=DAY) == 1
    monkeypatch.setattr(sampler, "_last_sample_day", "")           # the process restarted
    assert sampler.run_settling_samples_daily(now=DAY) == 0
    assert sampler.run_settling_samples_daily(now=DAY, force=True) == 1      # an outside clock may still force it
    assert sampler.run_settling_samples_daily(now=DAY + timedelta(days=1)) == 1
    assert read == ["c1", "c1", "c1"]


def test_the_agents_nightly_evaluation_is_not_paid_for_again_after_a_restart(monkeypatch):
    from pramanyx.custom_agents import learning
    monkeypatch.setattr(learning, "_allowed", lambda: True)
    monkeypatch.setattr(learning, "_last_nightly_day", None)
    monkeypatch.setattr("pramanyx.custom_agents.store.list_agents", lambda *a, **k: [])
    first = learning.nightly(now=DAY)
    assert first["day"] == "2031-03-04" and first["ran"] == []      # it ran (no agent had goldens)
    monkeypatch.setattr(learning, "_last_nightly_day", None)        # the process restarted
    assert learning.nightly(now=DAY) == {"skipped": "already ran today"}


def test_the_rechecks_and_the_briefing_recall_are_not_run_again_after_a_restart(monkeypatch):
    from pramanyx.answer import recheck
    from pramanyx.briefing import recall
    monkeypatch.setattr("pramanyx.db.history.recent_chat_answers", lambda since, limit=200: [])
    monkeypatch.setattr(recheck, "_last_run_day", None)
    assert "skipped" not in recheck.run_rechecks_daily(now=DAY, runner=lambda conn: None)
    monkeypatch.setattr(recheck, "_last_run_day", None)
    assert recheck.run_rechecks_daily(now=DAY, runner=lambda conn: None) == {"skipped": "already ran today"}
    monkeypatch.setattr(recall, "_last_run_day", None)
    first = recall.run_recall_daily(now=DAY, runner=lambda: None)
    assert first.get("skipped") != "already ran today"
    monkeypatch.setattr(recall, "_last_run_day", None)
    assert recall.run_recall_daily(now=DAY, runner=lambda: None) == {"skipped": "already ran today"}
