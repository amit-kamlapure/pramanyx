"""What the theLook golden set's six failures of 2026-11-14 were, each held at its cause.

* The result shown was the last query run, not the one the answer stood on (t09, t11): `answering_result`.
* A share stated next to a row's label read as that row's count, so every share worked out from a breakdown was
  rewritten away or withheld (t03, t13, and LuxExperience l05): `grounding._counts_in`.
* A reference rounded to one place failed a correct two-place answer (t15): `quality._coarser`.
"""
from __future__ import annotations

from pramanyx.agent.converse_tools import answering_result, converse_system_prompt
from pramanyx.custom_agents.quality import results_match
from pramanyx.explorer.grounding import ungrounded_label_values

STATUS = [["Shipped", 37589], ["Complete", 31293], ["Processing", 25001], ["Cancelled", 18380], ["Returned", 12566]]


def test_the_result_shown_is_the_one_the_answer_stands_on_not_the_last_run():
    by_center = {"rows": [["Memphis TN", 41210], ["Chicago IL", 40877], ["Houston TX", 33104]]}
    check = {"rows": [[488788, 307680, 181108, 0, 0]]}
    answer = "Memphis TN holds 41,210 unsold items, Chicago IL 40,877 and Houston TX 33,104."
    assert answering_result(answer, [by_center, check]) == 0
    assert answering_result("Nothing in particular.", [by_center, check]) == 1      # no evidence: the latest, as before
    assert answering_result("x", [check]) == 0 and answering_result("x", []) == -1


def test_a_share_next_to_a_label_is_not_read_as_that_rows_count():
    assert ungrounded_label_values("Cancelled orders were 14.72% of all orders.", STATUS) == []
    assert ungrounded_label_values("The cancelled share is 14.72 %.", STATUS) == []
    assert ungrounded_label_values("Cancelled: 19,000 orders.", STATUS) == ["cancelled=19000"]   # a wrong count still is


def test_a_reference_rounded_to_one_place_is_compared_at_that_place():
    assert results_match([["F", 40.9], ["M", 40.9]], [["F", 50171, 40.94, 12, 70], ["M", 49829, 40.89, 12, 70]])
    assert not results_match([["F", 40.9]], [["F", 41.06]])
    assert not results_match([["F", 40]], [["F", 40.4]])                         # an integer may be a count


def test_the_conversation_is_told_to_compute_a_share_in_the_query():
    import inspect
    source = " ".join(inspect.getsource(converse_system_prompt).replace('"', " ").split())
    assert "asks for a share, a percentage, a rate or a ratio, compute it in the query" in source


# ── an agent's working notes are never its answer (found live, 2026-11-15) ────────────────────────────────────

LIVE = ("The user is asking for two things: 1. The approved definition of GMV. 2. The fiscal year definition. From the "
        "previous tool calls: the fiscal year starts on 2026-07-01. Wait, my standing instructions say: use the approved "
        "metric definitions. I have one tool call left. Let me try a targeted search.")


def test_working_notes_are_recognised_and_answers_are_not():
    from pramanyx.agent.converse_tools import working_notes
    assert working_notes(LIVE)
    assert working_notes("The user wants GMV by platform.")
    for answer in ("Mytheresa leads fiscal 2027 GMV at €1,205,163.43, ahead of NET-A-PORTER at €980,229.52.",
                   "Let me know if you want it by month. GMV is SUM(orders.gmv_eur) for non-cancelled orders.",
                   "I couldn't find a GMV definition in the handbook; the fiscal year runs 1 July to 30 June."):
        assert working_notes(answer) is None, answer


def test_the_loop_hands_working_notes_back_once():
    from pramanyx.agent.tool_loop import run_tool_loop
    from pramanyx.llm.provider import ToolTurn
    replies = iter([ToolTurn(text=LIVE), ToolTurn(text="The fiscal year runs 1 July to 30 June.")])

    class _P:
        def complete_with_tools(self, system, user, tools, history=None, **kw):
            return next(replies)
    from pramanyx.agent.converse_tools import working_notes
    got = run_tool_loop(_P(), "sys", "q", [], max_steps=6, stop_check=working_notes)
    assert got.answer == "The fiscal year runs 1 July to 30 June."
    assert any(s.tool == "(answer held)" for s in got.steps)
