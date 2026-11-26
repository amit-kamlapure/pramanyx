"""One definition of "today" and "yesterday", for the platform and the coworker (2026-11-17).

The user, after a scheduled "yesterday" on theLook was answered for 19 Oct: "there cannot be disagreement.. it has to
be one stop shop for this.. Yesterday means day before current date.. based on the users time setting.. if no data
exists, it should say so" — "applicable to entire ecosystem: harness and the platform".
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace

from fastapi.testclient import TestClient

from pramanyx.kernel import clock as C

#: 01:30 on 17 Nov in Kolkata — still the 16th in UTC.
JUST_AFTER_MIDNIGHT = datetime(2026, 11, 16, 20, 0, tzinfo=timezone.utc)


def _no_settings(monkeypatch, mine: str = "", ours: str = ""):
    import pramanyx.db.user_prefs as prefs
    import pramanyx.orgsettings.store as org
    monkeypatch.setattr(prefs, "preferred_timezone", lambda: mine)
    monkeypatch.setattr(org, "load_org_settings", lambda: SimpleNamespace(timezone=ours))


def test_the_persons_clock_is_one_order_named_then_their_own_then_where_they_are_then_the_org(monkeypatch):
    _no_settings(monkeypatch)
    assert C.person_clock() == ""                                        # nothing known: UTC
    token = C.set_clock_here("Asia/Calcutta")
    try:
        assert C.person_clock() == "Asia/Calcutta"                       # the browser this request came from
        _no_settings(monkeypatch, ours="Europe/Berlin")
        assert C.person_clock() == "Asia/Calcutta"                       # where they are, before the organisation
        _no_settings(monkeypatch, mine="America/New_York", ours="Europe/Berlin")
        assert C.person_clock() == "America/New_York"                    # their own setting, before the browser
        assert C.person_clock("Europe/London") == "Europe/London"        # a zone they named, before all
        assert C.person_clock("Mars/Olympus") == "America/New_York"      # one nobody can read is passed over
    finally:
        C.reset_clock_here(token)
    assert C.set_clock_here("not a zone") and C.clock_here() == ""


def test_yesterday_is_the_day_before_today_on_the_persons_clock_not_on_utcs():
    p = C.periods("Asia/Calcutta", JUST_AFTER_MIDNIGHT)
    assert (p.today, p.yesterday) == (date(2026, 11, 17), date(2026, 11, 16))
    assert p.last_week == (date(2026, 11, 9), date(2026, 11, 15))
    assert p.last_month == (date(2026, 10, 1), date(2026, 10, 31))
    assert C.periods("", JUST_AFTER_MIDNIGHT).yesterday == date(2026, 11, 15)   # UTC's own, only when nothing is set
    line = C.clock_line("Asia/Calcutta", JUST_AFTER_MIDNIGHT)
    assert line.startswith("TODAY: Tuesday 2026-11-17 in Asia/Calcutta.")
    assert "yesterday is 2026-11-16 (as UTC instants, 2026-11-15T18:30Z up to 2026-11-16T18:30Z)" in line
    assert "never moved" in line and "say so plainly and do not answer for another period instead" in line


def test_a_source_still_revising_its_days_makes_them_provisional_and_moves_nothing():
    said = C.provisional_line(29, "Asia/Calcutta", JUST_AFTER_MIDNIGHT)
    assert "figures for days after 2026-10-19 are provisional" in said and "still answer for the period asked" in said
    assert C.provisional_line(1) == "" and C.provisional_line(0) == ""


def test_every_prompt_gets_the_same_clock_and_the_quick_path_gets_one_at_all(monkeypatch):
    from pramanyx.agent.sql_context import clock_block, sql_context
    _no_settings(monkeypatch)
    token = C.set_clock_here("Asia/Calcutta")
    try:
        block = clock_block(settle_days=29)
        assert "in Asia/Calcutta" in block and "keeps revising its most recent 29 days" in block
        assert sql_context(None, settle_days=29).endswith(block)
    finally:
        C.reset_clock_here(token)
    from pathlib import Path
    quick = (Path(__file__).resolve().parents[2] / "pramanyx" / "routers" / "investigations.py").read_text()
    assert "_clock_block(settle_days=_learned_settle(connection_id))" in quick
    from pramanyx.agent.prompts import CHAT_PROMPT
    assert "never the data's latest month" in CHAT_PROMPT


def test_the_api_reads_the_browsers_clock_on_every_request(monkeypatch):
    from pramanyx.api import app
    _no_settings(monkeypatch)
    client = TestClient(app)
    here = client.get("/me/clock", headers={C.CLOCK_HEADER: "Asia/Calcutta"}).json()
    assert here["zone"] == "Asia/Calcutta" and here["source"] == "your browser"
    assert client.get("/me/clock").json()["zone"] == "UTC"
    assert client.get("/me/clock", headers={C.CLOCK_HEADER: "Mars/Olympus"}).json()["zone"] == "UTC"


def test_the_coworkers_mcp_client_sends_the_clock_its_page_said(tmp_path, monkeypatch):
    from pramanyx.mcp.client import CURRENT_CALLER, PramanyxClient
    kept = tmp_path / "clock"
    kept.write_text("Asia/Calcutta\n")
    monkeypatch.setenv("PRAMANYX_CLOCK_FILE", str(kept))
    client = PramanyxClient(base_url="http://x")
    assert client._headers()[C.CLOCK_HEADER] == "Asia/Calcutta"
    kept.write_text("not a zone")
    assert C.CLOCK_HEADER not in client._headers()
    kept.write_text("Asia/Calcutta")
    token = CURRENT_CALLER.set(("outside-agent", "key"))
    try:
        assert C.CLOCK_HEADER not in client._headers()                   # an outside caller is its own principal
    finally:
        CURRENT_CALLER.reset(token)


def test_a_scheduled_run_counts_from_its_schedules_own_clock():
    from pramanyx.automations.temporal import scheduled_grounding
    auto = SimpleNamespace(id="a1", timezone="Asia/Calcutta",
                           conditions=[SimpleNamespace(kind="schedule", config={"cron": "0 8 * * *"})])
    said = scheduled_grounding(auto, {}, now=JUST_AFTER_MIDNIGHT, learned_lag=29)
    assert "TODAY: Tuesday 2026-11-17 in Asia/Calcutta" in said
    assert "If the question names no period, observe 2026-11-16, yesterday (Asia/Calcutta)." in said
    assert "figures for days after 2026-10-19 are provisional" in said                 # 29 days: said, not moved


def test_the_last_n_days_have_one_reading_said_in_every_prompt():
    """2026-11-26: two answers to one eval read "the last 30 days" as 27 Oct–25 Nov and 28 Oct–26 Nov."""
    from datetime import date, datetime, timezone

    from pramanyx.kernel.clock import clock_line, period_named
    now = datetime(2026, 11, 26, 10, tzinfo=timezone.utc)
    assert period_named("What was revenue over the last 30 days?", "UTC", now) == (date(2026, 10, 27), date(2026, 11, 26))
    assert "the last 30 days: 2026-10-27 to 2026-11-25" in clock_line("UTC", now)
    assert period_named("orders last month", "UTC", now) == (date(2026, 10, 1), date(2026, 11, 1))
    assert period_named("past 3 months", "UTC", now) == (date(2026, 8, 1), date(2026, 11, 1))
    assert period_named("revenue yesterday", "UTC", now) == (date(2026, 11, 25), date(2026, 11, 26))
    assert period_named("total revenue ever", "UTC", now) is None


def test_the_fiscal_year_is_one_reading_for_prompts_and_periods(monkeypatch):
    """The grounding audit, 2026-11-26: the fiscal year reached only the narrator, after the SQL was written, and four
    compilers were told January."""
    from datetime import date, datetime, timezone

    from pramanyx.kernel import clock
    monkeypatch.setattr(clock, "fiscal_start", lambda: 4)
    now = datetime(2026, 11, 26, 10, tzinfo=timezone.utc)
    assert clock.period_named("revenue this fiscal year", "UTC", now) == (date(2026, 4, 1), date(2026, 11, 27))
    assert clock.period_named("revenue last fiscal year", "UTC", now) == (date(2025, 4, 1), date(2026, 4, 1))
    assert "fiscal year starts on the 1st of April" in clock.clock_line("UTC", now)
    monkeypatch.setattr(clock, "fiscal_start", lambda: 1)
    assert "fiscal" not in clock.clock_line("UTC", now)
