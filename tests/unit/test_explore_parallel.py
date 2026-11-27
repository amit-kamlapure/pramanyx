"""The explore planner's parallel shape: the DAG guidance in the decompose prompt, the
deterministic dependency normalizer, and the wave-schedule metric."""
from __future__ import annotations

import pramanyx.agent.explore as ex
from pramanyx.agent.state import SubQuestion


def _sq(id, purpose="drill_down", depends_on=None):
    return SubQuestion(
        id=id, purpose=purpose, depends_on=depends_on or [],
        question=f"question {id}", expected_output=f"expected {id}",
    )


# ── P-A+ wider waves: DAG guidance + deterministic normalizer + wave-schedule metric ──────

def test_decompose_prompt_byte_identical_when_guidance_empty():
    """Flag off → the {parallelism_guidance} slot collapses with no doubled blank line, so the
    serial decompose prompt is unchanged."""
    from pramanyx.agent.prompts_explore import DECOMPOSE_EXPLORATION_PROMPT
    rendered = DECOMPOSE_EXPLORATION_PROMPT.format(
        question="q", schema="s", scan_section="", constraint_section="c", parallelism_guidance="")
    assert "PARALLELISM" not in rendered
    assert "useless queries.\n\nConstraints from the question" in rendered


def test_plan_exploration_chain_injects_guidance_only_when_parallel(monkeypatch):
    """The wide-DAG guidance + dependency-graph system role appear iff parallel_on — the real
    wiring, captured off the provider call."""
    captured: dict = {}

    class _Plan:
        sub_questions = [SubQuestion(id="Q1", purpose="landscape",
                                     question="scale?", expected_output="a table", depends_on=[])]

    class _LLM:
        def complete(self, system, user, response_model):
            captured["system"], captured["user"] = system, user
            return _Plan()

    monkeypatch.setattr(ex, "get_provider", lambda role: _LLM())
    state = {"question": "why X high", "schema_context": "TABLE t\n  a"}

    ex._plan_exploration_chain(state, "", "no constraints", parallel_on=False)
    assert "PARALLELISM" not in captured["user"]
    assert "sequential investigative chain" in captured["system"]

    ex._plan_exploration_chain(state, "", "no constraints", parallel_on=True)
    assert "PARALLELISM" in captured["user"] and "WIDE, SHALLOW" in captured["user"]
    assert "dependency graph" in captured["system"]


def test_normalize_clears_landscape_depends_on():
    sqs = [_sq("Q1", purpose="landscape", depends_on=["Q0"]),   # a landscape can't depend on a sibling
           _sq("Q2", purpose="relationship", depends_on=["Q1"])]
    out = ex._normalize_depends_on(sqs)
    assert out[0].depends_on == []                              # spurious landscape dep cleared
    assert out[1].depends_on == ["Q1"]                          # a real data dependency is preserved


def test_wave_schedule_chain_is_all_width_one():
    sqs = [_sq("Q1", "landscape", []), _sq("Q2", "relationship", ["Q1"]),
           _sq("Q3", "threshold", ["Q2"]), _sq("Q4", "drill_down", ["Q3"])]
    assert ex._wave_schedule(sqs) == [["Q1"], ["Q2"], ["Q3"], ["Q4"]]   # a deep chain → no parallelism


def test_wave_schedule_wide_dag_parallelizes_independent_cuts():
    # landscape → three independent cuts (each depends only on the landscape) → synthesis over all.
    sqs = [_sq("Q1", "landscape", []),
           _sq("Q2", "relationship", ["Q1"]), _sq("Q3", "relationship", ["Q1"]),
           _sq("Q4", "confounder", ["Q1"]),
           _sq("Q5", "synthesis", ["Q2", "Q3", "Q4"])]
    assert ex._wave_schedule(sqs) == [["Q1"], ["Q2", "Q3", "Q4"], ["Q5"]]   # width-3 middle wave


def test_wave_schedule_terminates_on_cycle():
    sqs = [_sq("Q1", "relationship", ["Q2"]), _sq("Q2", "relationship", ["Q1"])]
    assert ex._wave_schedule(sqs) == [["Q1", "Q2"]]            # unbreakable cycle flushes, never loops


def test_wave_schedule_dangling_ref_treated_satisfied():
    # A dangling dep (id not in the chain) can't block — matches the canonicalized DAG invariant.
    sqs = [_sq("Q1", "landscape", ["Qx"]), _sq("Q2", "relationship", ["Q1"])]
    assert ex._wave_schedule(sqs) == [["Q1"], ["Q2"]]
