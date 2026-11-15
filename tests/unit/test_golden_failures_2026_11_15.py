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
