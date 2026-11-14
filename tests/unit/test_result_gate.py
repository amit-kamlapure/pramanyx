"""The gate between the rows and the headline, run for real: the quick body's whole pipeline on the samples
database, with a stub in place of the model.

Receipt 2026-11-14 (LuxExperience): "What is total GMV by order status?" was shown as 500 per-order rows under a
headline about statuses. The platform's own narrative said, lower down, that the rows were not what was asked; nothing
acted on it. Here the model writes that same shape, and the answer must say so where the finding would be.
"""
from __future__ import annotations

from pramanyx.routers import investigations as inv
from tests.unit.test_object_actions import CONN, _Borrowed, db, graph  # noqa: F401 — fixtures by name
from tests.unit.test_object_security_live_receipts import _Coder, _quick, borrowed  # noqa: F401 — fixtures by name

# Grouped by position, so the check that reads the SQL for a key in its GROUP BY does not see it: only the rows say.
PER_ORDER = "SELECT order_id, status, COUNT(*) AS orders FROM ecommerce.orders GROUP BY 1, 2"
BY_STATUS = "SELECT status, COUNT(*) AS orders FROM ecommerce.orders GROUP BY 1"


def _frames(frames, kind):
    return [payload for k, payload in frames if k == kind]


def test_rows_that_are_not_what_was_asked_are_said_so_where_the_finding_would_be(borrowed, db, monkeypatch):  # noqa: F811
    result, frames = _quick(monkeypatch, db, _Coder(PER_ORDER))
    assert result is not None and result.outcome == "answered"
    # The headline is not a finding about statuses: there is none to state.
    assert [f["headline"] for f in _frames(frames, "headline")] == [inv.NOT_AS_ASKED_HEADLINE]
    (said,) = _frames(frames, "inspect_warning")
    assert said["kind"] == inv.NOT_AS_ASKED
    assert "asks for a total by status" in said["issues"][0] and "also broken down by order_id" in said["issues"][0]
    # It is in the answer's receipt, and the rows are still shown: said, never withheld.
    assert any(r.get("guard") == "result_shape" and r.get("action") == "said_not_as_asked" for r in result.guard_receipts)
    assert result.rows and result.headline == inv.NOT_AS_ASKED_HEADLINE


def test_rows_that_are_what_was_asked_pass_without_a_word(borrowed, db, monkeypatch):  # noqa: F811
    result, frames = _quick(monkeypatch, db, _Coder(BY_STATUS))
    assert result is not None and result.outcome == "answered"
    assert _frames(frames, "inspect_warning") == []
    assert _frames(frames, "headline") and _frames(frames, "headline")[0]["headline"] != inv.NOT_AS_ASKED_HEADLINE
    assert not any(r.get("guard") == "result_shape" for r in result.guard_receipts)


# ── what a quick answer's columns are figures of ─────────────────────────────────────────────────────────────────

def test_a_money_column_carries_the_currency_the_statement_names(monkeypatch):
    monkeypatch.setattr("pramanyx.orgsettings.figure_currency", lambda conn, schema=None: "")
    units = inv._quick_column_units("c1", None, "SELECT platform, SUM(gmv_eur) AS total_gmv_eur FROM orders GROUP BY 1",
                                    ["platform", "total_gmv_eur"])
    assert units == {"total_gmv_eur": "currency:EUR"}


def test_else_the_currency_a_person_confirmed_and_never_a_default(monkeypatch):
    sql, cols = "SELECT region, SUM(sales) AS total_sales, COUNT(*) AS orders FROM t GROUP BY 1", ["region", "total_sales", "orders"]
    monkeypatch.setattr("pramanyx.orgsettings.figure_currency", lambda conn, schema=None: "USD")
    assert inv._quick_column_units("c1", None, sql, cols) == {"total_sales": "currency:USD"}
    monkeypatch.setattr("pramanyx.orgsettings.figure_currency", lambda conn, schema=None: "")
    assert inv._quick_column_units("c1", None, sql, cols) == {}          # unconfirmed: a plain amount


def test_a_share_is_not_money_whatever_it_is_a_share_of(monkeypatch):
    monkeypatch.setattr("pramanyx.orgsettings.figure_currency", lambda conn, schema=None: "EUR")
    assert inv._quick_column_units("c1", None, "SELECT 1", ["platform", "revenue_share_pct"]) == {}
