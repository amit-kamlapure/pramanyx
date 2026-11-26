"""The deep path must not turn a failure into a report (diagnosed 2026-08-15).

A deep-analysis run on a 23-table canvas produced a formal report whose headline was **8**
— the row count of `aircraft_types`, the alphabetically-first table in the schema text.
Nobody asked for it. The structured-output call had failed twice, and the planner-failure
fallback emitted `SELECT COUNT(*) AS row_count FROM "<first table>"`. Downstream a row
count is indistinguishable from a real result, so every guard trusted the shape, the
chain kept walking, and synthesis wrote a report around it — filing its OWN failure under
"Data quality notes: aircraft_types: Only row count returned" and recommending the user
run the queries the system had failed to run.

These tests pin the shared marker that makes that report impossible: a planner failure
produces NO SQL, and it stays legible downstream as a failure, never as evidence.
"""

from pramanyx.agent.state import (
    PLANNER_FAILURE,
    SubQuestionAnswer,
    is_planner_failure,
    planner_failure_result,
)


def _answer(**over):
    """One builder for every SubQuestionAnswer these tests need — the model requires the
    full field set, and repeating it per fixture buries the one field each test is about."""
    base = dict(subq_id="Q1", question="q", purpose="drill_down", sql="", columns=[],
                rows=[], row_count=0, error=None, answer="", insight="", refinement=None)
    base.update(over)
    return SubQuestionAnswer(**base)


def _failed_answer(sid="Q2", question="Which entities are unusual?"):
    return _answer(subq_id=sid, question=question, answer=f"{sid} FAILED",
                   error=planner_failure_result(sid, "the planner call failed").error)


def _ok_answer(sid="Q1"):
    return _answer(subq_id=sid, question="What is the delay distribution?",
                   purpose="landscape", sql="SELECT 1", columns=["n"], rows=[[3]],
                   row_count=1, answer="delays are flat")


# ── 1. the planner failure never becomes SQL ─────────────────────────────────


def test_no_table_name_from_the_schema_leaks_into_the_failure():
    # The old fallback named whichever table came first in the schema text, which is how
    # `aircraft_types` — a table nobody asked about — became the subject of the report.
    r = planner_failure_result("Q2", "the planner returned an empty query plan")
    assert "aircraft_types" not in r.error
    assert "COUNT(" not in r.error
    assert r.rows == [] and r.row_count == 0


# ── 2. the failure stays legible as a failure ────────────────────────────────


def test_is_planner_failure_is_precise():
    assert not is_planner_failure(_ok_answer())
    assert is_planner_failure(_failed_answer())
    # A genuine SQL error is a different thing and must not be swept in.
    assert not is_planner_failure(_answer(subq_id="Q3", sql="SELECT 1",
                                          error="Binder Error: no such column"))


# ── 4. an all-failed chain is reported as a failure, with no narrator call ───


def test_marker_prefix_is_stable():
    # Every consumer keys off this prefix; renaming it silently unguards them all.
    assert planner_failure_result("Q1", "why").error.startswith(PLANNER_FAILURE)
