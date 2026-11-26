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
    assert "Return rate" in said and "landscape_1" in said and "counts of rows" in said


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
    monkeypatch.setattr(L, "_period", lambda q: (date(2026, 10, 27), date(2026, 11, 25)))

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
