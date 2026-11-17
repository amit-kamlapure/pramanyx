"""The Briefing on data that has ENDED (the Olist run, 2026-10-22; decided on the mockup 2026-10-23; the period rule
replaced 2026-11-17).

Olist's orders run from 2016-09-04 to 2018-10-17. From 2026-10-23 every edition read as if today were the day after
the data's last row. Since 2026-11-17 there is one definition of a period (`kernel/clock.py`, the user: "Yesterday means
day before current date.. if no data exists, it should say so"): a person's edition reads the period it names, counted
from today. Over data that ended, the data holds all of it (read, final), part of it (read to the data's last day, not
compared) or none of it (said, no figure, no other period in its place). A scheduled send says it once and then pauses
until new rows arrive. The platform's own settled readers — a monitor's baseline, the explorer's watch — still read the
data's last periods, anchored to its last row. Live data is unchanged.
"""
from __future__ import annotations

import contextlib
from datetime import date

import duckdb
import pytest

from pramanyx.briefing import ranges

TODAY = date(2026, 10, 23)                                  # a Friday
LAST, FIRST = date(2018, 10, 17), date(2016, 9, 4)          # Olist's last and first purchase day
ENDED = {"through": LAST, "from": FIRST, "held_by": ["orders"], "tables": {"orders": LAST}, "why": ""}
#: A dataset that stopped in the middle of last month (38 days before TODAY), held from 2019.
MID = {"through": date(2026, 9, 15), "from": date(2019, 1, 1), "held_by": ["orders"],
       "tables": {"orders": date(2026, 9, 15)}, "why": ""}


def _ended(preset, edge=ENDED, **kw):
    spec, why = ranges.resolve_range(preset, today=TODAY, edge=edge, lag_days=2, **kw)
    assert spec is not None, why
    return spec


# ── a person's edition: the period it names, counted from today ───────────────────────────────

@pytest.mark.parametrize("preset, start, last_day, previous_start, previous_end", [
    ("yesterday", date(2026, 10, 22), date(2026, 10, 22), date(2026, 10, 15), date(2026, 10, 16)),
    ("last_week", date(2026, 10, 12), date(2026, 10, 18), date(2026, 10, 5), date(2026, 10, 12)),
    ("last_month", date(2026, 9, 1), date(2026, 9, 30), date(2026, 8, 1), date(2026, 9, 1)),
    ("last_year", date(2025, 1, 1), date(2025, 12, 31), date(2024, 1, 1), date(2025, 1, 1)),
    ("month_to_date", date(2026, 10, 1), date(2026, 10, 22), date(2026, 9, 1), date(2026, 9, 23)),
    ("year_to_date", date(2026, 1, 1), date(2026, 10, 22), date(2025, 1, 1), date(2025, 10, 23)),
    ("current_month", date(2026, 10, 1), date(2026, 10, 22), date(2026, 9, 1), date(2026, 9, 23)),
    ("previous_month", date(2026, 9, 1), date(2026, 9, 30), date(2026, 8, 1), date(2026, 9, 1)),
])
def test_each_edition_reads_the_period_it_names_and_says_the_ended_data_holds_none_of_it(
        preset, start, last_day, previous_start, previous_end):
    spec = _ended(preset)
    assert (spec.start, spec.last_day, spec.previous_start, spec.previous_end) == (
        start, last_day, previous_start, previous_end)
    # the same period it reads on live data — the data's end never moves it
    live, _ = ranges.resolve_range(preset, today=TODAY, lag_days=1)
    assert (live.start, live.end) == (spec.start, spec.end)
    assert (spec.data_ended, spec.no_data, spec.lag_days, spec.lag_source) == (True, True, 0, "data_ended")
    assert spec.as_of == TODAY and spec.data_through == LAST and spec.data_from == FIRST
    assert spec.compare_withheld == "the data ended on 2018-10-17, before it"
    assert spec.edge_note == f"No data for {ranges.phrases(spec)['covers']}: the data ended on 2018-10-17 (Wednesday)."


def test_the_edition_says_there_is_no_data_in_its_own_words():
    month = _ended("last_month")
    assert month.edge_note == "No data for September 2026: the data ended on 2018-10-17 (Wednesday)."
    assert "arrived yet" not in month.edge_note             # a live source's words, false of data that stopped
    covers = ranges.phrases(_ended("month_to_date"))["covers"]
    assert covers.startswith("October 2026 to date") and "data's last day" not in covers
    assert ranges.phrases(_ended("last_year"))["compared_with"] == (
        "no earlier period (the data ended on 2018-10-17, before it)")
    block = ranges.range_block(month)
    assert (block["data_ended"], block["no_data"], block["data_through"]) == (True, True, "2018-10-17")


def test_a_period_the_data_holds_part_of_is_read_to_its_last_day_and_not_compared():
    month = _ended("last_month", edge=MID)
    assert (month.start, month.last_day, month.no_data) == (date(2026, 9, 1), date(2026, 9, 30), False)
    assert month.compare_withheld == "the data ended on 2026-09-15, part-way through it"
    assert month.edge_note == "The data ended on 2026-09-15 (Tuesday), part-way through September 2026: it is read to that day."
    assert (month.lag_days, month.last_year_start) == (0, None)


def test_a_period_the_data_holds_all_of_is_read_final_and_compared():
    year = _ended("last_year", edge=MID)
    assert (year.start, year.last_day, year.no_data, year.compare_withheld) == (
        date(2025, 1, 1), date(2025, 12, 31), False, "")
    assert (year.previous_start, year.lag_days, year.edge_note) == (
        date(2024, 1, 1), 0, "The data ended on 2026-09-15 (Tuesday).")
    flow = {"tables": ["orders"], "sql": "COUNT(*)", "time_kind": "flow", "label": "Orders"}
    assert ranges.range_status(flow, year) == "final"


def test_a_comparison_the_data_only_partly_covers_is_withheld_and_says_why():
    """2017 against a 2016 the data holds from September read +13,558% on Olist's raw files."""
    year = _ended("last_year", edge={**MID, "from": date(2024, 3, 1)})
    assert year.compare_withheld == "the data starts on 2024-03-01, so 2024 holds only part of its days"
    assert ranges.phrases(year)["compared_with"] == f"no earlier period ({year.compare_withheld})"
    assert ranges.compared_word(year) == "no earlier period"
    block = ranges.range_block(year)
    assert block["data_ended"] is True and block["no_data"] is False and block["data_from"] == "2024-03-01"
    assert block["compare_withheld"] == year.compare_withheld


@pytest.mark.parametrize("age, ended", [(31, False), (32, True)])
def test_data_ends_only_when_its_newest_day_is_more_than_a_month_old(age, ended):
    """Live data — theLook settles 29 days late — is never "ended"; the line is STOPPED_DAYS."""
    from datetime import timedelta
    through = TODAY - timedelta(days=age)
    spec = _ended("last_month", edge={**ENDED, "through": through, "tables": {"orders": through}})
    assert spec.data_ended is ended
    assert spec.start == date(2026, 9, 1)                   # the month asked, ended or not
    if not ended:
        assert spec.lag_days == 2                           # exactly as before


def test_a_custom_range_over_ended_data_is_final_and_cut_at_the_last_row():
    """Gap 38: "the range ends 2 days before today because of a 2-day settling lag", of August 2018."""
    aug = _ended("custom", start=date(2018, 8, 1), end=date(2018, 8, 31))
    assert (aug.start, aug.last_day, aug.lag_days, aug.data_ended, aug.no_data) == (
        date(2018, 8, 1), date(2018, 8, 31), 0, True, False)
    assert aug.edge_note == "The data ended on 2018-10-17 (Wednesday)."
    past = _ended("custom", start=date(2018, 10, 1), end=date(2018, 10, 31))
    assert past.last_day == LAST
    assert past.edge_note.startswith("Asked to 2018-10-31, read to 2018-10-17. The data ended on")


def test_the_narrator_is_told_there_is_no_data_and_never_another_period():
    from pramanyx.knowledge.period_brief import period_note
    note = period_note(ranges.range_block(_ended("last_month")), today=TODAY)
    assert "The data ended on 2018-10-17, before this month: there are no rows for it" in note
    assert "state no figure for it" in note and "settling" not in note and "final" not in note
    aug = period_note(ranges.range_block(_ended("custom", start=date(2018, 8, 1), end=date(2018, 8, 31))), today=TODAY)
    assert "every figure in this range is final" in aug and "settling lag" not in aug
    year = period_note(ranges.range_block(_ended("last_year", edge={**MID, "from": date(2024, 3, 1)})), today=TODAY)
    assert "It is not compared with an earlier period, because the data starts on 2024-03-01" in year
    assert "compares it with" not in year


def test_the_sent_markdown_and_the_narrator_context_say_no_data_or_final():
    from pramanyx.briefing.delivery import render_period_markdown
    from pramanyx.knowledge.brief_context import _period_lines
    block = ranges.range_block(_ended("last_year"))
    md = render_period_markdown(block, [], 0)
    assert "*Not compared: the data ended on 2018-10-17, before it." in md and "there is no data for it" in md
    assert "settling" not in md and "final" not in md
    said = " ".join(_period_lines(block))
    assert "the data ended on 2018-10-17, before it, so there is no data for this period" in said
    aug = ranges.range_block(_ended("custom", start=date(2018, 8, 1), end=date(2018, 8, 31)))
    assert "every figure here is final" in render_period_markdown(aug, [], 0)
    assert "the data ended on 2018-10-17, so every figure is final" in " ".join(_period_lines(aug))


# ── the platform's settled readers: the data's last periods, anchored to its last row ──────────

@pytest.mark.parametrize("preset, start, last_day, previous_start, previous_end, withheld", [
    ("yesterday", date(2018, 10, 17), date(2018, 10, 17), date(2018, 10, 10), date(2018, 10, 11), False),
    ("last_week", date(2018, 10, 8), date(2018, 10, 14), date(2018, 10, 1), date(2018, 10, 8), False),
    ("last_month", date(2018, 9, 1), date(2018, 9, 30), date(2018, 8, 1), date(2018, 9, 1), False),
    ("last_year", date(2017, 1, 1), date(2017, 12, 31), date(2016, 1, 1), date(2017, 1, 1), True),
    ("month_to_date", date(2018, 10, 1), date(2018, 10, 17), date(2018, 9, 1), date(2018, 9, 18), False),
    ("year_to_date", date(2018, 1, 1), date(2018, 10, 17), date(2017, 1, 1), date(2017, 10, 18), False),
    ("current_month", date(2018, 10, 1), date(2018, 10, 17), date(2018, 9, 1), date(2018, 9, 18), False),
    ("previous_month", date(2018, 9, 1), date(2018, 9, 30), date(2018, 8, 1), date(2018, 9, 1), False),
])
def test_a_settled_reader_reads_as_if_today_were_the_day_after_the_last_row(preset, start, last_day, previous_start,
                                                                           previous_end, withheld):
    spec = _ended(preset, settled=True)
    assert (spec.start, spec.last_day, spec.previous_start, spec.previous_end) == (
        start, last_day, previous_start, previous_end)
    assert (spec.data_ended, spec.no_data, spec.lag_days, spec.lag_source, spec.still_moving) == (
        True, False, 0, "data_ended", ())
    assert spec.as_of == TODAY and spec.data_through == LAST and spec.data_from == FIRST
    assert bool(spec.compare_withheld) is withheld


def test_a_settled_reader_names_the_data_s_last_day_and_withholds_a_partial_comparison():
    month = _ended("last_month", settled=True)
    assert month.edge_note == ("The data ended on 2018-10-17 (Wednesday). Each edition reads as if today "
                               "were the day after, so this one covers September 2018.")
    words = ranges.phrases(_ended("month_to_date", settled=True))
    assert words["covers"] == "October 2018 to the data's last day, 2018-10-01 to 2018-10-17"
    assert "so far" not in ranges.phrases(_ended("current_month", settled=True))["covers"]
    year = _ended("last_year", settled=True)
    assert year.compare_withheld == "the data starts on 2016-09-04, so 2016 holds only part of its days"
    # a month whose year-earlier range starts before the data loses that comparison too
    oct16 = _ended("last_month", edge={**ENDED, "through": date(2017, 10, 20)}, settled=True)
    assert (oct16.start, oct16.last_year_start) == (date(2017, 9, 1), None)


# ── measuring ───────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def olist(monkeypatch, tmp_path):
    """One order a day worth 100 from Olist's first day to its last, and an approved revenue."""
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(tmp_path / "metrics.instance.json"))
    from pramanyx.semantic.metrics import MetricDefinition, save_metric
    save_metric(MetricDefinition(name="gmv", connection="c1", label="GMV", sql="SUM(amount)", tables=["orders"],
                                 unit="BRL", status="approved", approved_by="test",
                                 time_kind="flow", time_column="orders.created_at"))   # dated, as Olist's GMV is
    monkeypatch.setattr("pramanyx.tools.profile_cache.latest_profile_entry", lambda cid: {
        "tables": {"orders": {"primary_timestamp": "created_at"}},
        "columns": {f"orders.{c}": {"table": "orders", "column": c, "dtype": d}
                    for c, d in (("created_at", "TIMESTAMP"), ("amount", "DOUBLE"))}})
    c = duckdb.connect()
    c.execute("""CREATE TABLE orders AS SELECT d::TIMESTAMP + INTERVAL 9 HOUR AS created_at, 100.0 AS amount
                 FROM range(DATE '2016-09-04', DATE '2018-10-18', INTERVAL 1 DAY) t(d)""")

    @contextlib.contextmanager
    def runner():
        def run_sql(sql):
            try:
                cur = c.execute(sql)
                return [d[0] for d in cur.description], cur.fetchall(), None
            except Exception as exc:  # noqa: BLE001
                return [], [], str(exc)
        yield run_sql, "duckdb"
    ranges._EDGE_CACHE.clear()
    yield runner
    c.close()


def test_the_edge_reads_where_the_data_starts_as_well_as_where_it_ends(olist):
    edge = ranges.data_edge("c1", today=TODAY, runner=olist)
    assert (edge["through"], edge["from"]) == (LAST, FIRST)


def test_a_period_with_no_data_has_no_figure_and_names_where_the_data_ended(olist):
    """Never a 0: a count over no rows answers 0, and a 0 is a figure."""
    with olist() as (run_sql, dialect):
        got = ranges.measure_range("c1", _ended("last_month"), run_sql=run_sql, dialect=dialect)
    assert got["measured"] == []
    [u] = got["unmeasured"]
    assert (u["metric"], u["reason"], u["data_ends"]) == ("gmv", "its data ends 2018-10-17, before this range",
                                                          "2018-10-17")


def test_a_withheld_comparison_is_measured_without_its_earlier_value_and_says_why(olist):
    with olist() as (run_sql, dialect):
        year = ranges.measure_range("c1", _ended("last_year", settled=True), run_sql=run_sql, dialect=dialect)
        month = ranges.measure_range("c1", _ended("last_month", settled=True), run_sql=run_sql, dialect=dialect)
    [y] = year["measured"]
    assert y["current"] == 36500.0 and y["previous"] is None and y["rel"] is None
    line = ranges.metric_line(y, ranges.range_block(_ended("last_year", settled=True)), "BRL")
    assert line.endswith("it is not compared, because the data starts on 2016-09-04, so 2016 holds only "
                         "part of its days."), line
    assert "has no rows" not in line                       # the earlier range is not empty: it is partial
    [m] = month["measured"]
    assert (m["current"], m["previous"], m["compare_withheld"]) == (3000.0, 3100.0, "")
    assert m["rel"] == pytest.approx(-100 / 3100)


def test_nothing_is_predicted_after_the_data_ended():
    from pramanyx.briefing.expected import expected_next
    got = expected_next("c1", _ended("last_month"), today=TODAY)
    assert got == {"target": None, "items": [],
                   "why": "the data ended on 2018-10-17: no later range will have rows to predict"}


def test_what_each_edition_covers_lists_six_each_saying_it_has_no_data(olist, monkeypatch):
    monkeypatch.setattr(ranges, "data_edge", lambda conn_id, schema=None, today=None: ENDED)
    got = ranges.edition_covers("c1", runner=olist, today=TODAY)
    assert (got["data_ended"], got["data_through"], got["data_from"]) == (True, "2018-10-17", "2016-09-04")
    assert got["metric"] == {"name": "gmv", "label": "GMV"}
    rows = {r["preset"]: r for r in got["editions"]}
    assert [r["label"] for r in got["editions"]] == ["Day", "Week", "Month", "Year", "Month to date", "Year to date"]
    assert rows["yesterday"]["start"] == rows["yesterday"]["last_day"] == "2026-10-22"
    assert rows["last_month"]["covers"] == "September 2026"
    for r in got["editions"]:
        assert r["compare_withheld"] == "the data ended on 2018-10-17, before it", r
        assert (r["current_text"], r["rel"]) == (None, None), r
        assert r["why"] == "its data ends 2018-10-17, before this range", r


# ── the send and Now ────────────────────────────────────────────────────────────────────────

def _sub(**kw):
    from pramanyx.briefing.models import BriefSubscription
    return BriefSubscription(id="s1", conn_id="c1", name="Olist daily", period="day", content="briefing",
                             trigger_id="t1", schema_name="olist", **kw)


LIVE = {**ENDED, "through": date(2026, 10, 21), "tables": {"orders": date(2026, 10, 21)}}


@pytest.mark.parametrize("edge, sent, paused", [
    (ENDED, "2026-10-22T07:00:00Z", True),     # told once since the data read as ended: the repeats pause
    (ENDED, None, False),                      # never sent: the first goes, and says there is no data
    (MID, "2026-10-10T07:00:00Z", False),      # sent before the data read as ended (10-17): not told yet
    (MID, "2026-10-17T07:00:00Z", True),
    (LIVE, "2026-10-22T07:00:00Z", False),     # live data: every morning
])
def test_a_scheduled_send_over_ended_data_says_so_once_then_pauses(monkeypatch, edge, sent, paused):
    """Every period after the data ended holds no rows: the first send says so, the later ones pause, and the send
    resumes by itself when new rows move the edge."""
    from pramanyx.briefing import delivery
    asked: dict = {}

    def resolve_for(conn_id, preset, *, workspace_id=None, schema=None, **_):
        asked.update(preset=preset, schema=schema)
        return ranges.resolve_range(preset, today=TODAY, edge=edge, lag_days=2)
    monkeypatch.setattr(ranges, "resolve_for", resolve_for)
    monkeypatch.setattr("pramanyx.briefing.deliveries.last_sent", lambda conn_id, sub_id: sent)
    why = delivery._paused_on_ended_data(_sub())
    assert asked == {"preset": "yesterday", "schema": "olist"}         # the subscription's own dataset
    assert bool(why) is paused
    if paused and edge is ENDED:
        assert why == ("paused: the data ended on 2018-10-17, so there is no data for 2026-10-22 (Thursday); the "
                       "Briefing sent on 2026-10-22 said the data had ended, and sending resumes when new rows arrive")


def test_a_paused_send_builds_nothing_and_records_why(monkeypatch):
    from pramanyx.briefing import delivery
    monkeypatch.setattr(delivery, "_paused_on_ended_data", lambda sub: "paused: the data ended on 2018-10-17")
    monkeypatch.setattr(delivery, "_turned_off", lambda sub: "")
    monkeypatch.setattr("pramanyx.knowledge.period_brief.refusal", lambda period: "")
    monkeypatch.setattr(delivery, "build_period_departure",
                        lambda sub: (_ for _ in ()).throw(AssertionError("a paused send built a Briefing")))
    result: dict = {"status": "failed", "error": None}
    delivery._deliver_period(_sub(), None, result)
    assert result == {"status": "paused", "error": "not sent — paused: the data ended on 2018-10-17"}


def test_now_names_what_the_kept_edition_covers_and_where_the_data_ended(monkeypatch):
    from pramanyx.briefing import organisation
    monkeypatch.setattr(organisation, "_visible_connections", lambda: [{"id": "c1", "name": "Olist"}])
    monkeypatch.setattr(organisation, "latest_kept", lambda cid: {"id": "a1", "version": 1, "payload": {
        "as_of": "2026-10-23", "briefing": {"narrative": "September GMV fell.", "period": {
            "covers": "September 2018", "data_ended": True, "data_through": "2018-10-17"}}}})
    [row] = organisation.organisation_briefing()["briefings"]
    assert (row["covers"], row["data_ended"], row["data_through"]) == ("September 2018", True, "2018-10-17")


# theLook, unrefreshed since 2026-10-29: read as ended from 11-30.
PAUSED = {"through": date(2026, 10, 29), "from": date(2019, 1, 1), "held_by": ["orders"],
          "tables": {"orders": date(2026, 10, 29)}}
FLOW = {"tables": ["orders"], "sql": "COUNT(*)", "time_kind": "flow", "label": "Orders"}


def test_a_source_still_moving_when_it_stopped_has_paused_and_is_not_final():
    """Read final with its newest days still inflated, every figure the guard holds back would have come back as news. A
    dataset that really ended has nothing moving, and stays final."""
    today = date(2026, 11, 30)
    october = {"start": date(2026, 10, 1), "end": date(2026, 10, 7)}
    for preset, kw in (("custom", october), ("last_week", {"settled": True})):
        spec, why = ranges.resolve_range(preset, today=today, lag_days=29, lag_source="beyond_horizon",
                                         still_moving=("orders",), rewrites=("orders",), edge=PAUSED, **kw)
        assert spec is not None and spec.data_ended and not spec.no_data, why
        assert spec.still_moving == ("orders",) and spec.rewrites == ("orders",)
        status = ranges.range_status(FLOW, spec)
        assert status == "provisional" and ranges.equal_age(FLOW, status, spec)["equal"] is False
    ended, _ = ranges.resolve_range("custom", today=today, lag_days=29, edge=PAUSED, **october)
    assert ranges.range_status(FLOW, ended) == "final"
    # a person's last week (23–29 Nov) is after the data: no data, never October's week in its place
    week, _ = ranges.resolve_range("last_week", today=today, lag_days=29, still_moving=("orders",), edge=PAUSED)
    assert (week.start, week.no_data) == (date(2026, 11, 23), True)


def test_a_pause_is_not_sent_or_narrated_as_final():
    from pramanyx.briefing.delivery import render_period_markdown
    from pramanyx.knowledge.period_brief import period_note
    today = date(2026, 11, 30)
    spec, _ = ranges.resolve_range("custom", start=date(2026, 10, 1), end=date(2026, 10, 7), today=today, lag_days=29,
                                   lag_source="beyond_horizon", still_moving=("orders",), edge=PAUSED)
    block = ranges.range_block(spec)
    md = render_period_markdown(block, [], 0)
    assert "every figure here is final" not in md and "No data has arrived since 2026-10-29" in md and "may still move" in md
    note = period_note(block, today)
    assert "every figure in" not in note and "do not call any of them final" in note


def test_a_live_source_still_moving_is_said_provisional_and_never_moves_the_period():
    from pramanyx.briefing.delivery import render_period_markdown
    today = date(2026, 11, 4)
    moving, _ = ranges.resolve_range("last_week", today=today, lag_days=29, lag_source="beyond_horizon", still_moving=("orders",))
    assert moving.start == date(2026, 10, 26)               # the week before this one, not the one 29 days back
    md = render_period_markdown(ranges.range_block(moving), [], 0)
    assert "settling as late rows arrive" not in md and "provisional" in md
    learned, _ = ranges.resolve_range("last_week", today=today, lag_days=8, lag_source="learned")
    said = render_period_markdown(ranges.range_block(learned), [], 0)
    assert "Its newest 8 days are still being revised as late rows arrive, a lag the platform measured: their figures are provisional." in said
