"""Triangulation — independent-path agreement (Bet 0, increment 0-III, 2026-06-27).

A raw-COUNT rate over a join is trustworthy only if its COUNT(DISTINCT) twin agrees.
count_distinct_variant builds the twin; rate_columns_diverge compares the rate column;
the verification manifest surfaces the outcome and divergence tanks data_trust.
See pramanyx/sql/fanout.py, pramanyx/agent/explore.py.
"""
from pramanyx.sql.fanout import count_distinct_variant

SWISS = ("SELECT COUNT(r.refund_id) / NULLIF(COUNT(t.ticket_id), 0) AS refund_rate "
         "FROM tickets t LEFT JOIN refunds r ON t.ticket_id = r.ticket_id")


def test_variant_wraps_both_counts_in_distinct():
    out = count_distinct_variant(SWISS)
    assert out is not None
    low = out.lower()
    assert "count(distinct r.refund_id)" in low.replace(" ", "").replace("count(distinct", "count(distinct ") or "distinct" in low
    assert low.count("distinct") >= 2


def test_variant_none_when_no_count_ratio():
    assert count_distinct_variant("SELECT SUM(x) FROM t") is None


def test_already_distinct_is_not_rewritten():
    sql = ("SELECT COUNT(DISTINCT a) / NULLIF(COUNT(DISTINCT b), 0) AS rate "
           "FROM t JOIN u ON t.id = u.tid")
    assert count_distinct_variant(sql) is None


