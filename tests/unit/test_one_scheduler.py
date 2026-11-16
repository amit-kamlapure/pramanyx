"""One scheduler, and it says everything the other could (2026-11-15).

The user: "the scheduler needs to be one across the platform … flexibility & functionality is the core of scheduler
function". The agent shell's own scheduler ran beside the platform's in the coworker; measured side by side, the
platform's is the one to keep, and the shell's is off. What these lock:

* the three things about TIME only the shell's could say — once, every N from a start, an ordinal or a number of
  runs — are said by the platform's (`automations.recurrence`), through the one door every reader of a schedule uses;
* a recurrence is never due merely for being new, and a schedule that has ended is switched off, once;
* a cron's weekday NUMBERS mean what a cron means by them (measured: ``* * 1`` fired on Tuesday);
* a schedule made by sentence starts at its first scheduled time;
* the coworker carries no second scheduler.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pramanyx.api import app
from pramanyx.automations import recurrence
from pramanyx.automations.engine import cron_trigger, ended_reason, next_fire_utc, run_automation, weekdays_by_name
from pramanyx.automations.models import Automation, Condition, Effect, EffectOutcome
from pramanyx.automations.scheduler import retire_if_ended
from pramanyx.automations.store import get_automation, get_runs, upsert_automation

UTC = timezone.utc
client = TestClient(app)


def _at(*parts) -> datetime:
    return datetime(*parts, tzinfo=UTC)


def _stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _scheduled(expression: str, *, created: datetime, name: str = "a schedule", **kw) -> Automation:
    return upsert_automation(Automation(
        conn_id="conn-one", name=name, created_at=_stamp(created),
        conditions=[Condition(kind="schedule", config={"cron": expression})],
        effects=[Effect(kind="notify", config={"trigger_id": "t1"})], **kw))


def _ran(calls: list):
    def dispatch(effect, automation):
        calls.append(effect.kind)
        return EffectOutcome(kind=effect.kind, status="executed")
    return dispatch


#: A one-off in the PAST. Every engine test here injects its clock; a date still to come would let a guard that
#: read the real clock pass for the wrong reason (and turn red on a calendar day).
ONCE_AT_THREE = "DTSTART:20260105T150000Z\nRRULE:FREQ=DAILY;COUNT=1"


# ── a recurrence says when, exactly ────────────────────────────────────────────────────────────────────────────────────

def test_once_runs_at_its_time_and_never_at_the_moment_it_was_made():
    made = _at(2026, 1, 5, 14, 0)
    a = _scheduled(ONCE_AT_THREE, created=made)
    calls: list = []
    early = run_automation(a, now=made + timedelta(minutes=1), dispatch=_ran(calls))
    assert early.outcome == "not_fired" and not calls            # a new cron fires at once; a recurrence waits for its time
    due = run_automation(a, now=_at(2026, 1, 5, 15, 0, 20), dispatch=_ran(calls))
    assert due.outcome == "fired" and calls == ["notify"]
    after = run_automation(a, now=_at(2026, 1, 5, 15, 1, 20), dispatch=_ran(calls))
    assert after.outcome == "not_fired" and "never" in after.reason and calls == ["notify"]


def test_a_late_tick_still_runs_the_one_occurrence_it_missed():
    a = _scheduled(ONCE_AT_THREE, created=_at(2026, 1, 5, 14, 0))
    calls: list = []
    assert run_automation(a, now=_at(2026, 1, 5, 15, 40), dispatch=_ran(calls)).outcome == "fired"
    assert calls == ["notify"]


def test_every_ninety_minutes_is_stepped_from_its_start_not_from_the_top_of_the_hour():
    stepped = recurrence.parse("DTSTART:20261116T090000Z\nRRULE:FREQ=MINUTELY;INTERVAL=90")
    seen, moment = [], _at(2026, 11, 16, 9, 0)
    for _ in range(4):
        found = stepped.at_or_after(moment)
        seen.append(found.strftime("%H:%M"))
        moment = found + timedelta(seconds=1)
    assert seen == ["09:00", "10:30", "12:00", "13:30"]          # a cron's */90 cannot say this
    # Asked a year on, it is still arithmetic — and still on the grid.
    far = stepped.at_or_after(_at(2027, 11, 16, 9, 1))
    assert (far - _at(2026, 11, 16, 9, 0)) % timedelta(minutes=90) == timedelta(0)


def test_a_number_of_runs_and_an_end_date_are_ends():
    five = recurrence.parse("DTSTART:20261116T090000Z\nRRULE:FREQ=HOURLY;COUNT=3")
    assert five.at_or_after(_at(2026, 11, 16, 11, 0)) == _at(2026, 11, 16, 11, 0)
    assert five.at_or_after(_at(2026, 11, 16, 11, 0, 1)) is None
    until = recurrence.parse("DTSTART:20261116T090000Z\nRRULE:FREQ=DAILY;UNTIL=20261118")
    assert until.at_or_after(_at(2026, 11, 18, 9, 0)) == _at(2026, 11, 18, 9, 0)      # the end day is whole
    assert until.at_or_after(_at(2026, 11, 18, 9, 0, 1)) is None


def test_the_first_monday_and_every_second_week():
    first = recurrence.parse("DTSTART:20261101T090000Z\nRRULE:FREQ=MONTHLY;BYDAY=1MO")
    assert first.at_or_after(_at(2026, 11, 3)) == _at(2026, 12, 7, 9, 0)
    fortnight = recurrence.parse("DTSTART:20261116T090000Z\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO")
    assert fortnight.at_or_after(_at(2026, 11, 17)) == _at(2026, 11, 30, 9, 0)


def test_a_floating_start_is_read_in_the_automations_own_clock_dst_included():
    summer = next_fire_utc("DTSTART:20260706T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO", _at(2026, 7, 1), "Europe/Berlin")
    winter = next_fire_utc("DTSTART:20260706T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO", _at(2026, 11, 10), "Europe/Berlin")
    assert (summer.hour, winter.hour) == (7, 8)                  # 09:00 in Berlin, as a cron there would be
    named = recurrence.parse("DTSTART;TZID=Asia/Kolkata:20261116T090000\nRRULE:FREQ=DAILY;COUNT=1")
    assert named.at_or_after(_at(2026, 11, 15)) == _at(2026, 11, 16, 3, 30)


@pytest.mark.parametrize("bad, why", [
    ("DTSTART:20261116T090000Z\nRRULE:FREQ=SECONDLY", "once a minute"),
    ("DTSTART:20261116T090000Z\nRRULE:FREQ=MINUTELY;BYDAY=MO", "INTERVAL, COUNT and UNTIL only"),
    ("DTSTART:20261116T090000Z\nRRULE:FREQ=DAILY;COUNT=2;UNTIL=20261231", "not both"),
    ("DTSTART:20261116T090000Z\nRRULE:FREQ=DAILY;BYWEEKNO=3", "not part of a recurrence"),
    ("DTSTART:2026-11-16 09:00\nRRULE:FREQ=DAILY", "is not a start"),
    ("DTSTART:20261116T090000Z", "two lines"),
    ("DTSTART;TZID=Mars/Olympus:20261116T090000\nRRULE:FREQ=DAILY", "unknown timezone"),
    ("DTSTART:20261116T090000Z\nRRULE:FREQ=DAILY;UNTIL=20251231", "before the start"),
])
def test_a_rule_this_scheduler_does_not_read_is_refused_with_its_sentence(bad, why):
    with pytest.raises(recurrence.RecurrenceError, match=why):
        recurrence.parse(bad)
    # …and at the model, so it is never stored looking schedulable.
    with pytest.raises(ValueError):
        Condition(kind="schedule", config={"cron": bad})


def test_a_rule_is_said_in_words():
    said = recurrence.said_when
    assert said(ONCE_AT_THREE) == "Once, on Mon 5 Jan 2026 at 15:00 UTC"
    assert said("DTSTART:20261116T090000\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE", "Europe/Berlin") == \
        "Every 2 weeks on Mon, Wed at 09:00 Europe/Berlin, from Mon 16 Nov 2026"
    assert said("DTSTART:20261207T090000Z\nRRULE:FREQ=MONTHLY;BYDAY=1MO;COUNT=6") == \
        "On the first Mon of every month at 09:00 UTC, 6 times"
    assert said("DTSTART:20261116T090000Z\nRRULE:FREQ=MINUTELY;INTERVAL=90") == \
        "Every 90 minutes, from Mon 16 Nov 2026 at 09:00 UTC"
    # A cron in the app's own words; one this cannot say is quoted, never guessed.
    assert said("0 9 * * 1") == "Every Mon at 09:00 UTC"
    assert said("0 9 * * 1-5") == "On the cron schedule 0 9 * * 1-5 (UTC)"
    assert said("30 7 * * *", "Asia/Kolkata") == "Every day at 07:30 Asia/Kolkata"
    # In a run's reason a recurrence is one readable line, not two lines of notation.
    assert Condition(kind="schedule", config={"cron": ONCE_AT_THREE}).describe() == \
        "schedule(Once, on Mon 5 Jan 2026 at 15:00 UTC)"


def test_a_floating_start_is_never_given_a_clock_the_reader_does_not_know():
    """Found live, 2026-11-15: a schedule read in Asia/Kolkata gave its run the reason "…at 23:18 UTC" — the trigger
    alone was asked, and it guessed. A reader holding the automation names ITS clock; one holding only the trigger
    says whose clock it is."""
    floating = "DTSTART:20260105T231800\nRRULE:FREQ=DAILY;COUNT=1"
    a = _scheduled(floating, created=_at(2026, 1, 5, 17, 0), timezone="Asia/Kolkata")
    run = run_automation(a, now=_at(2026, 1, 5, 17, 1), dispatch=_ran([]))
    assert run.reason.startswith("schedule(Once, on Mon 5 Jan 2026 at 23:18 Asia/Kolkata): next due 2026-01-05T17:48")
    assert Condition(kind="schedule", config={"cron": floating}).describe() == \
        "schedule(Once, on Mon 5 Jan 2026 at 23:18 in the automation's clock)"
    assert recurrence.said(floating, "") == "Once, on Mon 5 Jan 2026 at 23:18 UTC"           # "" is UTC, and known


# ── a cron's weekday numbers mean what a cron means ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("field, named", [
    ("1", "mon"), ("0", "sun"), ("7", "sun"), ("1-5", "mon,tue,wed,thu,fri"), ("0,6", "sun,sat"),
    ("5-7", "sun,fri,sat"), ("*/2", "sun,tue,thu,sat"), ("0-6", "*"), ("*", "*"), ("mon-fri", "mon-fri"),
    ("MON", "MON"), ("9", "9"),
])
def test_weekday_numbers_are_turned_into_names(field, named):
    assert weekdays_by_name(field) == named


@pytest.mark.parametrize("cron, days", [
    ("0 9 * * 1", {"Monday"}),                                   # measured before the fix: Tuesday
    ("0 9 * * 1-5", {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday"}),   # was Tuesday to Saturday
    ("0 9 * * 0", {"Sunday"}), ("0 9 * * 7", {"Sunday"}),        # 7 was refused outright
    ("0 9 * * mon", {"Monday"}),
])
def test_a_cron_fires_on_the_weekday_its_number_names(cron, days):
    trigger, moment, seen = cron_trigger(cron), _at(2026, 11, 15, 12, 0), set()
    for _ in range(7):
        moment = trigger.get_next_fire_time(None, moment + timedelta(seconds=1))
        seen.add(moment.strftime("%A"))
    assert seen == days


# ── an ended schedule is switched off, once ──────────────────────────────────────────────────────────────────────

def test_a_schedule_that_ran_its_one_occurrence_is_switched_off():
    a = _scheduled(ONCE_AT_THREE, created=_at(2026, 1, 5, 14, 0))
    run = run_automation(a, now=_at(2026, 1, 5, 15, 0, 20), dispatch=_ran([]))
    assert run.outcome == "fired" and retire_if_ended(a, run) is True
    assert get_automation(a.id).enabled is False
    assert retire_if_ended(a, run) is False                      # said once


def test_a_tick_a_breath_before_its_time_does_not_end_it():
    """The race this is judged against: ended as of the moment the RUN read the clock, never a later one."""
    a = _scheduled(ONCE_AT_THREE, created=_at(2026, 1, 5, 14, 0))
    run = run_automation(a, now=_at(2026, 1, 5, 14, 59, 59), dispatch=_ran([]))
    assert run.outcome == "not_fired" and retire_if_ended(a, run) is False
    assert get_automation(a.id).enabled is True


def test_between_its_time_and_the_tick_that_runs_it_a_schedule_is_due_not_ended():
    """Found live, 2026-11-15: a one-off due at :48:00, read at :48:15 with the tick coming at :48:23, said "ended"
    — its one run still to come. A reader counts runs from the engine's last tick, as the engine does."""
    a = _scheduled(ONCE_AT_THREE, created=_at(2026, 1, 5, 14, 0))
    last_tick, asked = _at(2026, 1, 5, 14, 59, 23), _at(2026, 1, 5, 15, 0, 15)
    assert ended_reason(a, asked) == "its schedule has no run left"          # what the read once concluded
    assert ended_reason(a, asked, since=last_tick) == ""                      # the run is still to come
    assert ended_reason(a, _at(2026, 1, 5, 15, 1), since=_at(2026, 1, 5, 15, 0, 23)) == "its schedule has no run left"
    # A stale "since" never revives an end date: expiry is a fact about now.
    over = _scheduled("*/5 * * * *", created=_at(2026, 1, 5), expires_at="2026-01-05T08:30:00Z")
    assert ended_reason(over, _at(2026, 1, 5, 9, 0), since=_at(2026, 1, 5, 8, 0)).startswith("expired at")


def test_an_expired_schedule_stops_being_asked_every_minute():
    a = _scheduled("*/5 * * * *", created=_at(2026, 11, 15, 8, 0), expires_at="2026-11-15T08:30:00Z")
    run = run_automation(a, now=_at(2026, 11, 15, 8, 31), dispatch=_ran([]))
    assert run.outcome == "gated" and run.reason.startswith("expired at")
    assert retire_if_ended(a, run) is True and get_automation(a.id).enabled is False
    assert len(get_runs(automation_id=a.id)) == 1                # one row saying why, not one a minute for good


def test_a_cron_never_ends_and_a_trigger_that_reads_the_world_never_ends():
    cron = _scheduled("0 9 * * 1", created=_at(2026, 11, 15))
    assert ended_reason(cron, _at(2030, 1, 1)) == ""
    mixed = upsert_automation(Automation(
        conn_id="conn-one", name="a one-off and a webhook", condition_logic="any",
        conditions=[Condition(kind="schedule", config={"cron": ONCE_AT_THREE}), Condition(kind="webhook")],
        effects=[Effect(kind="notify", config={"trigger_id": "t1"})]))
    assert ended_reason(mixed, _at(2030, 1, 1)) == ""


def test_a_parked_or_broken_run_ends_nothing():
    a = _scheduled(ONCE_AT_THREE, created=_at(2026, 1, 5, 14, 0))
    run = run_automation(a, now=_at(2026, 1, 5, 15, 0, 20), dispatch=_ran([]))
    for outcome in ("paused", "error"):
        assert retire_if_ended(a, run.model_copy(update={"outcome": outcome})) is False
    assert get_automation(a.id).enabled is True


# ── the doors ────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setattr("pramanyx.kernel.flags.flag_enabled", lambda n: n == "automations.engine")


def _body(expression: str, **kw) -> dict:
    return {"conn_id": "conn-one", "name": "asked on a schedule",
            "conditions": [{"kind": "schedule", "config": {"cron": expression}}],
            "effects": [{"kind": "investigate", "config": {"question": "gmv by platform"}}], **kw}


def test_a_rule_with_no_run_left_is_refused_at_the_door(flag_on):
    refused = client.post("/automations", json=_body("DTSTART:20200101T090000Z\nRRULE:FREQ=DAILY;COUNT=1"))
    assert refused.status_code == 422 and "no run left" in refused.json()["detail"]
    assert "Once, on Wed 1 Jan 2020" in refused.json()["detail"]


def test_a_schedule_made_by_sentence_starts_at_its_first_scheduled_time(flag_on):
    made = client.post("/automations", json=_body("0 9 * * 1", start_at_first_run=True)).json()
    first = datetime.fromisoformat(made["paused_until"].replace("Z", "+00:00"))
    assert first > datetime.now(UTC) and first.strftime("%A %H:%M") == "Monday 09:00"
    # The canvas's Create does not send it, and is not muted: a person there may want the run that proves it.
    assert client.post("/automations", json=_body("0 9 * * 1")).json()["paused_until"] is None
    # A recurrence needs no mute — it is never due merely for being new.
    later = (datetime.now(UTC) + timedelta(days=2)).strftime("%Y%m%dT%H%M%SZ")
    once = client.post("/automations", json=_body(f"DTSTART:{later}\nRRULE:FREQ=DAILY;COUNT=1", start_at_first_run=True))
    assert once.status_code == 200 and once.json()["paused_until"] is None


def test_the_schedule_read_says_when_in_words_and_where_it_stands(flag_on):
    later = datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)
    made = client.post("/automations", json=_body(f"DTSTART:{later:%Y%m%dT%H%M%S}Z\nRRULE:FREQ=DAILY;COUNT=1")).json()
    read = client.get(f"/automations/{made['id']}/schedule").json()
    assert read["state"] == "on" and read["next_run"] == _stamp(later) and read["said"][0].startswith("Once, on ")
    assert read["steps"] == ["investigate"] and read["timezone"] == "UTC"
    client.post(f"/automations/{made['id']}/enabled", params={"enabled": False})
    off = client.get(f"/automations/{made['id']}/schedule").json()
    assert off["state"] == "off" and off["next_run"] == ""       # a schedule that is off promises no next run
    assert client.get("/automations/nope/schedule").status_code == 404


def test_a_muted_schedule_says_its_first_run_after_the_mute(flag_on):
    made = client.post("/automations", json=_body("0 9 * * 1", start_at_first_run=True)).json()
    read = client.get(f"/automations/{made['id']}/schedule").json()
    assert read["state"] == "muted" and read["next_run"] == made["paused_until"] == read["muted_until"]


# ── the coworker carries no second scheduler ─────────────────────────────────────────────────────────────────────

def test_the_shells_scheduler_is_off_in_the_coworker():
    import yaml
    root = Path(__file__).resolve().parents[2] / "coworker"

    class _Js(yaml.SafeLoader):
        """The profile's `!!js` values are the shell's to evaluate; here they are just text."""
    _Js.add_multi_constructor("tag:yaml.org,2002:js", lambda loader, suffix, node: loader.construct_scalar(node))
    rows = yaml.load((root / "profile.patch.yml").read_text(), Loader=_Js)
    off = {row["id"] for row in rows if isinstance(row, dict) and row.get("disabled") is True}
    assert {"schedule", "ui-schedule"} <= off                    # its store and delivery; its page and clock marks
    assert "dsh-tool-schedule" not in (root / "profile.patch.yml").read_text().replace(
        "`tool-schedule`", "")                                   # and no agent is handed its four tools
    # The sidebar's Schedules entry is the coworker's own and frames the app's page; nothing rewords the shell's.
    home = (root / "plugins" / "home" / "src" / "client.js").read_text()
    assert "/automations" in home and "pramanyx-schedules" in home
    assert "schedule.catalog" not in (root / "plugins" / "brand" / "src" / "client.js").read_text()


def test_the_schedule_read_carries_what_each_run_found_for_the_conversation_that_set_it_up(flag_on):
    """2026-11-16: "deliver it here" — the coworker's card shows each run's result, read with the schedule."""
    from pramanyx.automations.models import AutomationRun, EffectOutcome
    from pramanyx.automations.store import append_run
    made = client.post("/automations", json=_body("0 9 * * 1")).json()
    for i, (outcome, said) in enumerate([("not_fired", ""), ("fired", "GMV led by Mytheresa at €1.2M"),
                                         ("fired", "GMV led by NET-A-PORTER")]):
        append_run(AutomationRun(automation_id=made["id"], outcome=outcome, started_at=f"2026-11-1{i}T09:00:00Z",
                                 effects=[EffectOutcome(kind="investigate", status="executed", investigation_id=f"inv{i}",
                                                        data={"summary": said})] if said else []))
    runs = client.get(f"/automations/{made['id']}/schedule").json()["runs"]
    assert [r["steps"][0]["said"] for r in runs] == ["GMV led by NET-A-PORTER", "GMV led by Mytheresa at €1.2M"]
    assert runs[0]["steps"][0]["investigation_id"] == "inv2"         # a run that did nothing is not shown


def test_a_run_whose_analysis_is_still_running_says_so_and_shows_its_answer_once_kept(flag_on, monkeypatch):
    """Found trying it live, 2026-11-16: a one-off's step handed its analysis to the queue and held only "job <id>",
    so the coworker's card said "it found nothing to say" while the analysis ran. The read follows the job: running,
    it is said to be; done, its answer and the investigation behind it are shown; stopped, the reason is."""
    from pramanyx.automations.models import AutomationRun, EffectOutcome
    from pramanyx.automations.store import append_run
    import pramanyx.db.history as history
    import pramanyx.kernel.ledger as ledger_mod
    from pramanyx.runners.investigation import DISPATCH_EVENT, submitted_job

    assert submitted_job("job 7fb1f967901f") == "7fb1f967901f" and submitted_job("ran inline (caller waited)") == ""
    jobs = {"j-running": {"state": "RUNNING"}, "j-done": {"state": "SUCCEEDED"}, "j-broke": {"state": "FAILED",
                                                                                            "error": "BigQuery timed out"}}
    joined = {"j-done": "inv-done"}

    class _Ledger:
        def events(self, *, kind=None, job_id=None, limit=200, **_):
            assert kind == DISPATCH_EVENT
            return [{"payload": {"investigation_id": joined[job_id]}}] if job_id in joined else []

        def job_get(self, job_id):
            return jobs.get(job_id)
    made = client.post("/automations", json=_body("0 9 * * 1")).json()
    for i, job in enumerate(["j-broke", "j-done", "j-running"]):
        append_run(AutomationRun(automation_id=made["id"], outcome="fired", started_at=f"2026-11-1{i}T09:00:00Z",
                                 effects=[EffectOutcome(kind="investigate", status="executed", message=f"job {job}")]))
    monkeypatch.setattr(ledger_mod.Ledger, "default", classmethod(lambda cls: _Ledger()))
    monkeypatch.setattr(history, "get_investigation", lambda inv_id: {
        "id": inv_id, "headline": "Top categories", "report": {"executive_summary": "Outerwear & Coats led with 4,686.58"}})
    running, done, broke = [r["steps"][0] for r in client.get(f"/automations/{made['id']}/schedule").json()["runs"]]
    assert running["answering"] is True and running["said"] == "" and running["status"] == "executed"
    assert done["said"] == "Outerwear & Coats led with 4,686.58" and done["investigation_id"] == "inv-done"
    assert done["answering"] is False
    assert broke["status"] == "failed" and broke["message"] == "BigQuery timed out" and broke["said"] == ""
