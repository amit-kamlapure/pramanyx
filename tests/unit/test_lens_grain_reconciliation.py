"""Follow-up A — reconcile the WHERE/WHY/WHEN lens grain.

A cross-sectional "why is the rate high" run can compute the SAME rate at two grains across its
concurrent lenses — per order (~40%) vs per line-item (~76%) — so one report contradicts itself.
The metric's own table (intake `metric_table`) is the canonical unit; a scan handed that grain pins
its plan to it and labels its number with it. These tests pin the plan directive and the summary tag.
"""
from __future__ import annotations

import pramanyx.agent.investigate as inv


# ── directive + tag ──────────────────────────────────────────────────────────────

def test_grain_plan_directive_pins_the_denominator():
    d = inv._grain_plan_directive({"table": "shop.order_items", "label": "line item"})
    assert "shop.order_items" in d
    assert "line item" in d
    assert "do NOT collapse" in d           # forbids silently coarsening the grain
    assert inv._grain_plan_directive(None) == ""


def test_grain_summary_tag_format():
    assert inv._grain_summary_tag({"label": "line item"}) == "[per line item]"
    assert inv._grain_summary_tag(None) == ""
    assert inv._grain_summary_tag({}) == ""


# ── the real ada_cross_section injects the directive + tags the summary ───────────


def test_rate_lens_byte_identical_without_grain(monkeypatch):
    captured = {}

    def fake_run(conn, **kw):
        captured["plan_user"] = kw.get("plan_user", "")
        return inv._PhaseRun(ok=True, results=[], results_text="", interpretation=None)

    monkeypatch.setattr(inv, "run_analysis_phase", fake_run)
    state = {"question": "q", "schema_context": "TABLE: shop.orders", "investigation_phases": [],
             "_ada_intake": {"metric_table": "shop.orders", "metric_label": "m",
                             "metric_sql": "SUM(x)", "dimensions": ["shop.orders.channel"]}}

    out = inv.ada_cross_section(state, object())        # no grain → default path
    assert "GRAIN (measure consistently" not in captured["plan_user"]
    assert not out["_cross_section_summary"].startswith("[per ")
