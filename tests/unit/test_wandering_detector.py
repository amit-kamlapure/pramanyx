"""Wave R3 — the wandering detector.

Two contracts, and the second is the one that keeps this safe to ship:

* **Catch a repeat.** The same query, however it is formatted, is the same query.
* **Never suppress real evidence.** A detector that vetoes a genuinely new query is worse
  than the redundancy it saves — it deletes a finding. Every "must NOT fire" test below is
  load-bearing, especially the repair path, where re-running a failed query is how the fix
  works.
"""
from __future__ import annotations

from pramanyx.agent import wandering as W
from pramanyx.control_plane.contracts.execution import QueryResult


def _result(step, sql, rows=None, cols=("a",), error=None, caveats=()):
    rows = [[1]] if rows is None else rows
    return QueryResult(hypothesis_id=step, sql=sql, columns=list(cols), rows=rows,
                       row_count=len(rows), error=error, caveats=list(caveats))


# ── fingerprints ──────────────────────────────────────────────────────────────

def test_formatting_differences_are_the_same_query():
    """The planner re-emits the same intent with different indentation and case
    constantly. A raw string compare would miss most real repeats."""
    a = W.args_fingerprint("SELECT a, b FROM t WHERE x = 1")
    b = W.args_fingerprint("select   a,\n  b\nfrom t\nwhere x = 1;")
    assert a == b


def test_a_different_query_is_a_different_fingerprint():
    assert W.args_fingerprint("SELECT a FROM t") != W.args_fingerprint("SELECT b FROM t")
    assert W.args_fingerprint("SELECT a FROM t WHERE x=1") != W.args_fingerprint("SELECT a FROM t WHERE x=2")


def test_unparseable_sql_falls_back_conservatively():
    """The fallback collapses whitespace and case ONLY. A fingerprint that is too eager
    would veto a genuinely new query."""
    a = W.args_fingerprint("this is not sql at all {{")
    b = W.args_fingerprint("THIS IS   NOT SQL AT ALL {{")
    assert a == b
    assert a != W.args_fingerprint("this is not sql either {{")


def test_empty_sql_has_no_fingerprint():
    assert W.args_fingerprint("") == "" and W.args_fingerprint(None) == ""


def test_the_same_numbers_under_different_headings_are_a_different_answer():
    """A chain that renamed its output did make progress."""
    assert W.result_fingerprint(["revenue"], [[10]]) != W.result_fingerprint(["margin"], [[10]])
    assert W.result_fingerprint(["a"], [[1], [2]]) == W.result_fingerprint(["a"], [[1], [2]])


# ── signal 1: repeat (the pre-dispatch veto) ──────────────────────────────────

def test_a_repeat_is_caught_before_dispatch():
    history = [_result("Q1", "SELECT region, SUM(rev) FROM sales GROUP BY region")]
    v = W.check_before_dispatch("select REGION, sum(REV) from SALES group by REGION", history)
    assert v.wandering and v.kind == "repeat" and v.prior_step == "Q1"
    assert "Q1" in v.detail


def test_a_new_query_is_never_vetoed():
    history = [_result("Q1", "SELECT region FROM sales")]
    assert not W.check_before_dispatch("SELECT product FROM sales", history).wandering


def test_re_running_a_FAILED_query_is_never_vetoed():
    """The load-bearing exclusion. Re-running a query that errored is how a repair WORKS —
    vetoing it would break the repair path outright, turning a recoverable SQL error into
    a permanently unanswered sub-question."""
    history = [_result("Q1", "SELECT bad FROM t", error="no such column: bad")]
    assert not W.check_before_dispatch("SELECT bad FROM t", history).wandering


def test_a_veto_is_not_itself_evidence_of_a_repeat():
    """A veto echoes the prior result verbatim. Counting it would let one veto cascade into
    terminating a healthy run."""
    prior = _result("Q1", "SELECT a FROM t")
    echo = W.veto_result("Q2", "SELECT a FROM t", prior,
                         W.Verdict("repeat", "already run for Q1.", "Q1"))
    assert W.is_veto(echo) and not W.is_veto(prior)
    assert W._usable([prior, echo]) == [prior]


def test_the_veto_result_carries_the_prior_data_not_an_empty_stand_in():
    """A zero-row stand-in would trip every 'suspicious empty result' heuristic we have and
    read downstream as a finding of ABSENCE — a wrong answer, not a saved request."""
    prior = _result("Q1", "SELECT r, v FROM t", rows=[["eu", 10], ["us", 20]], cols=("r", "v"))
    echo = W.veto_result("Q2", "SELECT r, v FROM t", prior,
                         W.Verdict("repeat", "already run for Q1.", "Q1"))
    assert echo.rows == [["eu", 10], ["us", 20]] and echo.row_count == 2
    assert echo.columns == ["r", "v"] and echo.error is None
    assert echo.hypothesis_id == "Q2"                       # attributed to the step that asked
    assert any(c.startswith(W.VETO_MARKER) for c in echo.caveats)
