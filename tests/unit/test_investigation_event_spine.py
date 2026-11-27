"""T3 kernel-leverage — investigation lifecycle on the event spine + boot reconcile.

Investigations used to be invisible to the kernel journal (only the explorer
emitted). Each lifecycle transition now journals an `investigation.*` event at
the single point it flows through (the history-store functions), and a fresh
boot reconciles every orphaned 'running' row (failing it + journaling), instead
of leaving it stuck until the periodic 60-min supervisor sweep.
"""
import inspect

import pytest

import pramanyx.db.history as history


class _StubLedger:
    def __init__(self):
        self.events = []

    def emit(self, kind, payload=None, *, conn_id=None, canvas_id=None, job_id=None):
        self.events.append({"kind": kind, "payload": payload or {},
                            "conn_id": conn_id, "canvas_id": canvas_id})
        return len(self.events)


@pytest.fixture
def hist(monkeypatch, tmp_path):
    """history store pointed at a throwaway DB, with a recording Ledger stub."""
    monkeypatch.setattr(history, "_DB_PATH", tmp_path / "history.db")
    import pramanyx.kernel.ledger as ledger_mod
    stub = _StubLedger()
    monkeypatch.setattr(ledger_mod.Ledger, "default", classmethod(lambda cls: stub))
    return stub


def _kinds(stub):
    return [e["kind"] for e in stub.events]


# ── lifecycle transitions journal ─────────────────────────────────────────────

def test_create_emits_created(hist):
    inv_id = history.create_investigation("why did revenue drop?", "conn1", canvas_id="cv1")
    ev = [e for e in hist.events if e["kind"] == "investigation.created"]
    assert len(ev) == 1
    assert ev[0]["conn_id"] == "conn1"
    assert ev[0]["canvas_id"] == "cv1"
    assert ev[0]["payload"]["investigation_id"] == inv_id
    assert "revenue" in ev[0]["payload"]["question"]


def test_fail_emits_failed_with_status_and_scope(hist):
    inv_id = history.create_investigation("q", "conn2")
    hist.events.clear()
    history.fail_investigation(inv_id, status="timed_out")
    ev = [e for e in hist.events if e["kind"] == "investigation.failed"]
    assert len(ev) == 1
    assert ev[0]["payload"]["status"] == "timed_out"
    assert ev[0]["conn_id"] == "conn2"          # scope looked up from the row


def test_pause_emits_paused(hist):
    inv_id = history.create_investigation("q", "conn3")
    hist.events.clear()
    history.pause_investigation(inv_id)
    assert _kinds(hist) == ["investigation.paused"]
    assert hist.events[0]["conn_id"] == "conn3"


def test_complete_emits_completed(hist):
    inv_id = history.create_investigation("q", "conn4")
    hist.events.clear()
    history.complete_investigation(
        inv_id, report={"headline": "Revenue fell 12%"}, hypotheses=[],
        query_history=[], question="q", connection_id="conn4", skip_index=True,
    )
    ev = [e for e in hist.events if e["kind"] == "investigation.completed"]
    assert len(ev) == 1
    assert ev[0]["conn_id"] == "conn4"
    assert "Revenue fell" in ev[0]["payload"]["headline"]


# ── boot reconciliation ───────────────────────────────────────────────────────

def test_reconcile_fails_all_running_and_emits(hist):
    a = history.create_investigation("a", "conn5")
    b = history.create_investigation("b", "conn5", canvas_id="cv9")
    # one already-complete row must be left untouched
    done = history.create_investigation("c", "conn5")
    history.complete_investigation(done, report={"headline": "ok"}, hypotheses=[],
                                   query_history=[], skip_index=True)
    hist.events.clear()

    n = history.reconcile_orphaned_investigations()
    assert n == 2                                          # only the two 'running' ones

    assert history.get_investigation(a)["status"] == "failed"
    assert history.get_investigation(b)["status"] == "failed"
    assert history.get_investigation(done)["status"] == "complete"   # untouched

    failed = [e for e in hist.events if e["kind"] == "investigation.failed"]
    assert len(failed) == 2
    assert {e["conn_id"] for e in failed} == {"conn5"}
    assert all(e["payload"]["reason"] == "server restart (orphaned)" for e in failed)
    # canvas scope preserved for the canvas-scoped orphan
    assert any(e["canvas_id"] == "cv9" for e in failed)


def test_reconcile_noop_when_nothing_running(hist):
    done = history.create_investigation("c", "conn6")
    history.complete_investigation(done, report={"headline": "ok"}, hypotheses=[],
                                   query_history=[], skip_index=True)
    hist.events.clear()
    assert history.reconcile_orphaned_investigations() == 0
    assert not hist.events


def test_the_deep_engine_ends_an_interrupted_run_in_its_row():
    """Tripwire for the client-disconnect orphan bug: Starlette cancels the SSE coroutine with asyncio.CancelledError (a
    BaseException), which slips past every `except Exception` handler, and the run orphans in 'running' with no terminal
    event (the 27dcd642 class). The analyst — the one deep engine since 2026-11-27 — catches BaseException around its
    turn and ends a still-running row with why. The CancelledError path can't run in the unit suite, so the source
    guard is asserted — brittle by design."""
    from pramanyx.agent import analyst
    src = inspect.getsource(analyst.run_analyst)
    assert "except BaseException" in src and "_say_how_it_stopped(" in src
    assert "fail_if_running(" in inspect.getsource(analyst._say_how_it_stopped)


def test_stale_sweep_emits_per_row(hist):
    """The periodic supervisor sweep is a terminal transition too — it must journal
    each swept row (it used to do a silent bulk UPDATE, so the DB and the event
    spine disagreed for stale rows)."""
    a = history.create_investigation("a", "conn7")
    history.create_investigation("b", "conn7")   # also running
    hist.events.clear()
    # max_age_minutes=0 → both 'running' rows are "stale" (started before now)
    n = history.sweep_stale_running(max_age_minutes=0)
    assert n == 2
    failed = [e for e in hist.events if e["kind"] == "investigation.failed"]
    assert len(failed) == 2
    assert all(e["payload"]["reason"] == "stale sweep (orphaned)" for e in failed)
    assert history.get_investigation(a)["status"] == "failed"
