"""Wave R3 — duplicate-collapse evidence rendering.

One policy, lossless by construction: the identical table is still in the block, once.
The tests prove it only ever collapses a genuine duplicate.

(The stale-stub sibling was deleted 2026-08-01 in the flag endgame — it dropped rows.)
"""
from __future__ import annotations

from pramanyx.agent import evidence_budget as EB
from pramanyx.control_plane.contracts.execution import QueryResult
from pramanyx.tools.executor import format_result_for_llm


def _result(step, sql, n_rows=40, error=None):
    rows = [[i, f"seg{i}", i * 100] for i in range(n_rows)]
    return QueryResult(hypothesis_id=step, sql=sql, columns=["i", "segment", "value"],
                       rows=rows, row_count=len(rows), error=error)


# ── dedup is lossless ─────────────────────────────────────────────────────────

def test_an_identical_query_collapses_to_a_pointer():
    a, b = _result("H1", "SELECT x FROM t"), _result("H2", "select   X from T")
    parts, info = EB.render_history([a, b], full_renderer=format_result_for_llm,
                                    collapse_duplicates=True)
    assert info["duplicates"] == 1
    assert "identical to the query already shown for H1" in parts[1]
    assert "seg0" in parts[0]                                  # the data is still there, once


def test_a_different_query_is_never_collapsed():
    parts, info = EB.render_history(
        [_result("H1", "SELECT x FROM t"), _result("H2", "SELECT y FROM t")],
        full_renderer=format_result_for_llm, collapse_duplicates=True)
    assert info["duplicates"] == 0 and info["full"] == 2


def test_a_failed_duplicate_is_kept_in_full():
    """Two attempts at the same SQL where one errored are a repair story, not a repeat —
    and the error text is the part the narrator needs."""
    ok = _result("H1", "SELECT x FROM t")
    bad = _result("H2", "SELECT x FROM t", error="no such column: x")
    parts, info = EB.render_history([ok, bad], full_renderer=format_result_for_llm,
                                    collapse_duplicates=True)
    assert info["duplicates"] == 0 and "no such column: x" in parts[1]
