"""An open question answered from the governed metrics first (`agent/landscape.py`, 2026-11-27). theLook's "Show me
interesting trends and facts in the data set" read as a describe; the intake squeezed it into one metric on one table
(web events by browser, then revenue by category) and none of twenty approved metrics was read."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date
from types import SimpleNamespace as NS

import pytest

from pramanyx.agent import landscape as L
from pramanyx.agent.question_shape import question_shape


@pytest.mark.parametrize("q", ["Show me interesting trends and facts in the data set", "What stands out in my data?",
                               "Any insights?", "Give me an overview of the business", "What is happening in sales?"])
def test_an_open_question_is_a_landscape(q):
    assert question_shape(q) == "survey" and L.is_open(q)


@pytest.mark.parametrize("q", ["What was revenue last month?", "Why did revenue fall?", "How many orders by status?"])
def test_a_question_for_one_figure_or_a_cause_is_not(q):
    assert question_shape(q) != "survey" and not L.is_open(q)


def _fig(id_, label, cur, prev, z=None, extreme=None, streak=0):
    return {"id": id_, "label": label, "current": cur, "previous": prev, "rel": (cur - prev) / prev, "z": z,
            "extreme": extreme, "streak": streak, "usual": {"mean": prev}, "equal_age": {"equal": True},
            "current_text": str(cur)}


def test_metrics_are_ranked_by_how_unusual_the_move_is_then_its_size():
    figs = [_fig("a", "Revenue", 110, 100, z=0.4), _fig("b", "Return rate", 0.2, 0.1, z=3.1),
            _fig("c", "Orders", 300, 100, z=None)]
    ranked = sorted(figs, key=L._rank_key, reverse=True)
    assert [f["label"] for f in ranked] == ["Return rate", "Orders", "Revenue"]


def test_the_measurement_becomes_results_the_answer_cites():
    measured = {"period": {"first": "2026-10-27", "last": "2026-11-25"},
                "figures": [_fig("b", "Return rate", 0.2, 0.1, z=3.1, extreme={"which": "highest", "of": 9})],
                "movers": [{"id": "b", "label": "Return rate", "cells": {"category": {"cells": [
                    {"group": "Jeans", "current": 0.4, "usual": 0.1, "rel": 3.0, "n": 400, "thin": False},
                    {"group": "Socks", "current": 0.9, "usual": 0.1, "rel": 8.0, "n": 3, "thin": True}]}}}]}
    ph = L.phases(measured)
    assert [p["phase_id"] for p in ph] == ["landscape", "landscape_2"]
    first = ph[0]["findings"][0]
    assert first["finding_id"] == "landscape_1" and first["rows"][0][0] == "Return rate"
    assert "highest of the last 9" in first["rows"][0][-1] and "3.1 standard deviations above" in first["rows"][0][-1]
    seg = ph[1]["findings"][0]["rows"]
    assert [r[1] for r in seg] == ["Jeans"], "a segment behind too few rows is not called"
    said = L.prompt_section(measured)
    assert "Return rate" in said and "landscape_1" in said and "count of rows" in said


def test_measure_reads_every_approved_metric_and_breaks_down_the_leaders(monkeypatch):
    from pramanyx.briefing import edition as E
    from pramanyx.briefing import guide as G
    from pramanyx.briefing import ranges
    from pramanyx.briefing.compose import write
    m1 = NS(name="revenue", label="Revenue", time_column="order_items.created_at", unit="USD", description="")
    m2 = NS(name="return_rate", label="Return rate", time_column="order_items.returned_at", unit="%", description="")
    undated = NS(name="lifetime_value", label="LTV", time_column=None, unit="", description="")
    monkeypatch.setattr(ranges, "governed_metrics", lambda c, s=None: [m1, m2, undated])
    monkeypatch.setattr(G, "current", lambda c, s=None: (None, None))
    monkeypatch.setattr(G, "measurable", lambda check, by: (by.get(check.metric), ""))
    spec = NS(label="last 30 days", period="custom", windows=lambda: [NS(label="current")])
    monkeypatch.setattr(ranges, "resolve_for", lambda *a, **k: (spec, ""))
    monkeypatch.setattr("pramanyx.orgsettings.figure_currency", lambda c, s=None: "USD")
    seen_checks: list = []

    def fake_edition(conn, sp, guide, **k):
        seen_checks.extend(c.metric for c in guide.checks)
        return {"figures": [_fig("revenue", "Revenue", 105, 100, z=0.2),
                            _fig("return_rate", "Return rate", 0.2, 0.1, z=2.5)], "not_read": []}
    monkeypatch.setattr(E, "measure_edition", fake_edition)
    monkeypatch.setattr(E, "usual_windows", lambda sp, n: [])
    monkeypatch.setattr(E, "_dated_table", lambda m: "order_items")
    monkeypatch.setattr(write, "breakdown_columns", lambda c, t, limit=12: ["category", "brand", "status"])
    cut: list = []
    monkeypatch.setattr(E, "_cells", lambda m, check, w, rs, d, **k: cut.append((m.name, check.dimensions)) or {})
    monkeypatch.setattr(L, "_period", lambda q: (date(2026, 10, 27), date(2026, 11, 25), False))

    @contextmanager
    def runner():
        yield (lambda sql: ([], []), "bigquery")

    out = L.measure("c1", "Show me interesting trends", runner=runner)
    assert seen_checks == ["revenue", "return_rate"], "every approved, dated metric is measured; an undated one is not"
    assert [f["label"] for f in out["figures"]] == ["Return rate", "Revenue"]
    assert cut[0] == ("return_rate", ["category", "brand"])


def test_no_approved_metric_is_said_not_guessed(monkeypatch):
    from pramanyx.briefing import guide as G
    from pramanyx.briefing import ranges
    monkeypatch.setattr(ranges, "governed_metrics", lambda c, s=None: [])
    monkeypatch.setattr(G, "current", lambda c, s=None: (None, None))
    out = L.measure("c1", "anything interesting?")
    assert out["figures"] == [] and "no approved metric" in out["why"]


@pytest.mark.parametrize("depth", ["auto", "quick", "deep"])
def test_an_open_question_takes_one_route_whatever_depth_a_door_pinned(depth):
    """2026-11-27: Teams, agents and a quick-pinned panel never reached the open rule; Agentic sent it to the explore
    graph. One route: the analyst, at every door."""
    from pramanyx.agent.ask_router import decide_ask_route
    r = decide_ask_route("Show me interesting trends and facts in the data set", depth_override=depth,
                         classifier=lambda q: ("direct", None))
    assert (r.depth, r.mode, r.shape) == ("deep", "investigate", "survey")


def test_a_figure_still_takes_the_quick_route():
    from pramanyx.agent.ask_router import decide_ask_route
    r = decide_ask_route("What was revenue last month?", classifier=lambda q: ("direct", None))
    assert (r.depth, r.mode) == ("quick", "direct")


def test_the_profiling_tour_yields_an_open_question_to_the_measured_metrics(monkeypatch):
    from pramanyx.briefing import ranges
    from pramanyx.routers.investigations import _overview_eligible
    from pramanyx.routers.investigations import AskRequest
    req = AskRequest(question="Show me interesting facts in the data", connection_id="c1")
    monkeypatch.setattr(ranges, "governed_metrics", lambda c, s=None: [NS(name="revenue", time_column="o.created_at")])
    assert _overview_eligible(req) is False
    monkeypatch.setattr(ranges, "governed_metrics", lambda c, s=None: [])
    assert _overview_eligible(req) is True, "nothing governed to measure: the tour answers"


def test_the_measured_movers_are_not_read_as_a_flagged_result():
    """Live, 2026-11-27: the movers carried a description in `trust_caveat`, the field a guard's warning lives in; the
    analyst's stop check holds an answer every result of which is flagged, and the open question's answer was held."""
    from pramanyx.agent.analyst import _every_result_warned
    measured = {"period": {"first": "2026-10-27", "last": "2026-11-25"},
                "figures": [_fig("b", "Return rate", 0.2, 0.1, z=3.1)], "movers": []}
    turn = NS(state={"investigation_phases": L.phases(measured)})
    assert all(not f.get("trust_caveat") for p in L.phases(measured) for f in p["findings"])
    assert _every_result_warned(turn) is None


def test_the_measured_movers_count_as_evidence_for_the_report():
    """Live, 2026-11-27: a run that concluded on the movers alone read as "nothing gathered" — the report's floor counts a
    finding only with the SQL that produced it, and the movers carried none."""
    from pramanyx.agent.investigate import _finding_has_rows
    fig = {**_fig("b", "Return rate", 0.2, 0.1, z=3.1), "sql": "SELECT 1"}
    ph = L.phases({"period": {"first": "a", "last": "b"}, "figures": [fig], "movers": []})
    assert _finding_has_rows(ph[0]["findings"][0])


def test_the_data_is_read_in_whole_periods_across_its_span():
    grain, wins = L._buckets(date(2019, 1, 3), date(2026, 11, 25))
    assert grain == "year" and [w.label for w in wins][:2] == ["2019 (part)", "2020"]
    assert wins[-1].label == "2026 (part)" and wins[-1].end == date(2026, 11, 26)
    grain, wins = L._buckets(date(2025, 1, 1), date(2026, 6, 30))
    assert grain == "quarter" and wins[0].label == "2025 Q1" and wins[-1].label == "2026 Q2"
    grain, wins = L._buckets(date(2026, 3, 10), date(2026, 8, 31))
    assert grain == "month" and wins[0].label == "2026-03 (part)" and wins[-1].label == "2026-08"


def _shape_fixture(monkeypatch, rows_for):
    from pramanyx.briefing import edition as E
    from pramanyx.briefing import guide as G
    from pramanyx.briefing import ranges
    from pramanyx.briefing.compose import write
    from pramanyx.semantic import metric_time as mt
    monkeypatch.setattr(ranges, "data_edge", lambda c, s=None, today=None: {"from": date(2023, 1, 1),
                                                                             "through": date(2026, 11, 25)})
    monkeypatch.setattr(G, "measurable", lambda check, by: (by.get(check.metric), ""))
    monkeypatch.setattr(E, "_dated_table", lambda m: "order_items")
    monkeypatch.setattr(write, "breakdown_columns", lambda c, t, limit=12: ["category"])
    monkeypatch.setattr(mt, "measure_sql", lambda m, w, dialect="duckdb", by=None: (f"SELECT {m.name}", ""))
    monkeypatch.setattr(mt, "adds_up", lambda m, dialect="duckdb": m.name == "revenue")
    monkeypatch.setattr(mt, "run_measure", lambda m, w, run, dialect="duckdb", by=None: (rows_for(m, w, by), ""))
    checks = [NS(metric="revenue", label="Revenue", unit="USD"), NS(metric="aov", label="Average order value", unit="USD"),
              NS(metric="stock", label="Inventory", unit="")]
    by_name = {"revenue": NS(name="revenue", time_kind="flow"), "aov": NS(name="aov", time_kind="flow"),
               "stock": NS(name="stock", time_kind="stock")}
    return checks, by_name


def test_the_shape_says_the_long_run_trend_the_peak_and_the_mix(monkeypatch):
    years = {"2023": 100.0, "2024": 180.0, "2025": 300.0, "2026 (part)": 250.0}

    def rows_for(m, wins, by):
        if by:
            return [{"window": "whole span", "group": "Jeans", "value": 600.0}, {"window": "whole span", "group": "Socks",
                    "value": 230.0}, {"window": "last", "group": "Jeans", "value": 150.0},
                    {"window": "last", "group": "Socks", "value": 150.0}]
        return [{"window": w.label, "value": years[w.label] * (1 if m.name == "revenue" else 0.1)} for w in wins]
    checks, by_name = _shape_fixture(monkeypatch, rows_for)
    sh = L.shape("c", None, checks, by_name, None, "bigquery", today=date(2026, 11, 26))
    assert sh["grain"] == "year" and [s["label"] for s in sh["series"]] == ["Revenue", "Average order value"], \
        "a level is not summed over a year"
    rev = sh["series"][0]
    assert rev["first"]["period"] == "2023" and rev["last"]["period"] == "2025", "a part year is never a whole one"
    assert rev["change_pct"] == 200.0 and rev["peak"]["period"] == "2025" and rev["last_vs_before"] == 66.7
    [comp] = sh["composition"]
    assert comp["label"] == "Revenue" and comp["segments"][0] == {"segment": "Jeans", "value": 600.0, "share": 72.3,
                                                                   "share_last": 50.0}
    ph = L._shape_phases(sh)
    ids = [f["finding_id"] for f in ph[0]["findings"]]
    assert ids == ["shape_1", "shape_2", "shape_3"] and all(f["sql"] for f in ph[0]["findings"])
    said = L.prompt_section({"figures": [], "shape": sh, "period": {}})
    assert "THE DATA ACROSS ITS SPAN" in said and "+200.0% from 2023" in said and "Jeans 72.3% (now 50.0%)" in said


def test_recent_moves_not_at_equal_age_are_not_led_with():
    unequal = dict(_fig("u", "Units sold", 173, 100, z=None), equal_age={"equal": False})
    said = L.prompt_section({"figures": [unequal, dict(unequal, id="r", label="Revenue")], "unequal": 2,
                             "period": {"first": "2026-10-27", "last": "2026-11-25"}, "shape": {}})
    assert "not at equal age" in said and "Do not lead with them" in said
    fine = L.prompt_section({"figures": [_fig("r", "Revenue", 110, 100, z=2.4)], "unequal": 0, "period": {}, "shape": {}})
    assert "not at equal age" not in fine


def test_a_prose_stop_is_handed_back_once_when_conclude_is_on_the_roster():
    from pramanyx.agent.analyst import CONCLUDE_PLEASE, _not_concluded
    assert _not_concluded([NS(name="run_sql", concludes=False), NS(name="conclude", concludes=True)]) == CONCLUDE_PLEASE
    assert _not_concluded([NS(name="run_sql", concludes=False)]) is None


def test_a_named_period_of_a_quarter_or_more_is_the_span_read_month_by_month(monkeypatch):
    def rows_for(m, wins, by):
        return [] if by else [{"window": w.label, "value": 10.0} for w in wins]
    checks, by_name = _shape_fixture(monkeypatch, rows_for)
    sh = L.shape("c", None, checks, by_name, None, "bigquery", today=date(2026, 11, 26),
                 within=(date(2025, 11, 26), date(2026, 11, 25)))
    assert sh["grain"] == "month" and sh["first"] == "2025-11-26" and sh["through"] == "2026-11-25"
    assert sh["series"][0]["first"]["period"] == "2025-12" and sh["series"][0]["last"]["period"] == "2026-10"


def test_what_code_measured_is_evidence_whether_or_not_an_exhibit_names_it():
    from pramanyx.agent.investigate import _phases_cited
    phases = [{"phase_id": "landscape", "by_code": True, "findings": [{"finding_id": "landscape_1", "rows": [[5.53]]}]},
              {"phase_id": "adhoc", "findings": [{"finding_id": "adhoc_1", "rows": [[1]]}, {"finding_id": "adhoc_2", "rows": [[2]]}]}]
    kept, uncited = _phases_cited(phases, ["adhoc_1"])
    assert [f["finding_id"] for p in kept for f in p["findings"]] == ["landscape_1", "adhoc_1"]
    assert uncited == [("adhoc_2", "")]


def test_an_open_question_about_a_topic_reads_the_metrics_about_it():
    checks = [NS(metric="gmv", label="GMV", why=""), NS(metric="refunds", label="Refunds on returns", why=""),
              NS(metric="return_rate", label="Item return rate", why="")]
    by_name = {"gmv": NS(description="", tables=["orders"]), "refunds": NS(description="", tables=["returns"]),
               "return_rate": NS(description="", tables=["order_items"])}
    assert [c.metric for c in L.topical("What should I know about our returns?", checks, by_name)] == ["refunds",
                                                                                                       "return_rate"]
    assert L.topical("Show me interesting trends and facts in the data set", checks, by_name) == checks
    assert L.topical("What stands out in our widgets?", checks, by_name) == checks, "no match reads them all"
