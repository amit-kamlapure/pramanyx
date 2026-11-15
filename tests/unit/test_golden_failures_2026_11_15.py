"""What the theLook golden set's six failures of 2026-11-14 were, each held at its cause.

* The result shown was the last query run, not the one the answer stood on (t09, t11): `answering_result`.
* A share stated next to a row's label read as that row's count, so every share worked out from a breakdown was
  rewritten away or withheld (t03, t13, and LuxExperience l05): `grounding._counts_at`.
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


# ── the grounding check's false alarms, read from the receipts of 2026-11-15 ──────────────────────────────────

def test_a_total_the_platform_computed_is_citable():
    from pramanyx.agent.converse_tools import citable_totals, ground_answer_numbers
    res = [{"sql": {"sql": "SELECT category, SUM(q * p) AS revenue FROM order_items GROUP BY 1"},
            "columns": {"columns": ["category", "revenue"]},
            "rows": {"rows": [["womenswear", 23511200.0], ["menswear", 7200100.0], ["shoes", 26270600.0]]}}]
    rows = res[0]["rows"]["rows"]
    answer = "Womenswear leads with €23.51M of the €56.98M total."
    said, receipt = ground_answer_numbers(answer, rows + citable_totals(res), question="revenue by category",
                                          provider=_Never())
    assert said == answer and receipt is None


def test_a_number_belongs_to_the_label_nearest_it_and_a_year_is_not_a_count():
    from pramanyx.explorer.grounding import ungrounded_label_values
    status = [["shipped", 12145], ["returned", 11861], ["cancelled", 989]]
    assert ungrounded_label_values("only a cancelled order is not completed. So it counts the 12,145 shipped", status) == []
    assert ungrounded_label_values("7,528 orders placed in fiscal year 2025 went to Europe", [["Europe", 7528]]) == []
    assert ungrounded_label_values("Cancelled: 19,000 orders.", status) == ["cancelled=19000"]


def test_the_rewrite_is_shown_each_rows_label():
    from pramanyx.explorer.grounding import rows_block
    assert rows_block([["Greece", 261694.35], ["Denmark", 255336.0]]) == "Greece | 261694.35\nDenmark | 255336.0"


class _Never:
    def complete(self, **kw):
        raise AssertionError("no rewrite should be asked for a grounded answer")


# ── one figure asked, a breakdown shown (l03, l07, l09, lb08, lc01; t03, t13) ─────────────────────────────────

def _res(rows):
    return {"sql": {"sql": "SELECT 1"}, "columns": {"columns": ["k", "n"]}, "rows": {"rows": rows}}


def test_a_breakdown_under_a_one_figure_question_is_handed_back():
    from pramanyx.agent.converse_tools import breakdown_where_one_figure_was_asked as check
    by_condition = _res([["resellable", 69049], ["minor_refurbish", 12007], ["reject", 5351]])
    why = check("How many returns were rejected at inspection?", [by_condition], "5,351 returns were rejected.")
    assert why and "breakdown of 3 rows" in why
    assert check("How many returns were rejected at inspection?", [by_condition, _res([[5351]])],
                 "5,351 returns were rejected.") is None                      # the filtered count, run after
    assert check("How many returns by condition?", [by_condition], "Resellable leads with 69,049.") is None


def test_the_one_figure_reading():
    from pramanyx.sql.grain_intent import asks_one_figure
    assert asks_one_figure("What was YNAP's total GMV in fiscal year 2025?")
    assert asks_one_figure("How many orders were destined for EU markets? Count every order, cancelled ones included.")
    assert not asks_one_figure("Which three EU markets had the highest GMV?")
    assert not asks_one_figure("For each platform, what is the average order value?")


# ── a declared rule reaches the conversation (lb05, lb06, lb07, lb10) ─────────────────────────────────────────

def test_the_conversation_is_given_the_questions_declared_definitions(monkeypatch):
    from pramanyx.agent import converse_tools as C
    seen = {}

    def frame(question, connection_id, *, schema_name="", dialect="duckdb"):
        seen.update(question=question, dialect=dialect)
        return 'QUESTION FRAME\n- "EU markets" → Order.ship_country is one of Austria, Belgium, …\n\n'
    monkeypatch.setattr("pramanyx.agent.grounding.question_frame", frame)
    prompt = C.converse_system_prompt("conn-1", question="How many orders went to EU markets?")
    assert '"EU markets" → Order.ship_country is one of' in prompt and seen["question"].endswith("EU markets?")
    monkeypatch.setattr("pramanyx.agent.grounding.question_frame", lambda *a, **k: "")
    assert "QUESTION FRAME" not in C.converse_system_prompt("conn-1", question="How many orders?")


# ── a scheduled summary's total leaves the install (the departure gate, 2026-11-15) ───────────────────────────

def test_the_gate_counts_an_analysis_total_as_measured_and_still_holds_a_wrong_one(monkeypatch):
    from datetime import datetime, timezone

    from pramanyx.govern import departure as D
    from pramanyx.govern import departure_basis as B
    record = {"connection_id": "", "completed_at": datetime.now(timezone.utc).isoformat(),
              "report": {"phases": [{"findings": [{
                  "sql": "SELECT platform, SUM(gmv_eur) AS gmv FROM orders WHERE fiscal_year = 2027 GROUP BY 1",
                  "columns": ["platform", "gmv"], "row_count": 4,
                  "rows": [["Mytheresa", 1190000.12], ["NET-A-PORTER", 970000.30], ["YOOX", 480000.10],
                           ["MR PORTER", 431674.18]]}]}]}}
    monkeypatch.setattr(B, "_analysis_record", lambda inv_id: record)
    measured = B.measurement_for_analysis("abcdef12")
    ok = D._remeasure("FY2027 GMV to 14 November: €3,071,674.70 across the four platforms.", measured, False)
    assert ok.outcome != D.HOLDS, ok
    wrong = D._remeasure("FY2027 GMV to 14 November: €3,500,000.00 across the four platforms.", measured, False)
    assert wrong.outcome == D.HOLDS


# ── the rewrite never worsens a right answer (lc01, 2026-11-15) ───────────────────────────────────────────────

def test_a_doubted_number_the_turn_measured_is_kept_not_rewritten():
    from pramanyx.agent.converse_tools import ground_answer_numbers
    rows = [["cancelled", 5872], ["shipped", 72618], ["returned", 68212],      # all years, by status
            [801]]                                                             # the turn's filtered count
    answer = "801 orders were cancelled in fiscal year 2025."
    said, receipt = ground_answer_numbers(answer, rows, question="How many orders were cancelled in FY2025?",
                                          provider=_Never())
    assert said == answer and receipt["action"] == "kept the answer"


def test_a_number_in_no_cell_is_still_rewritten():
    from pramanyx.agent.converse_tools import ground_answer_numbers

    class _Rewriter:
        def complete(self, **kw):
            from types import SimpleNamespace
            return SimpleNamespace(answer="5,872 orders were cancelled.")
    said, receipt = ground_answer_numbers("6,400 orders were cancelled.", [["cancelled", 5872]],
                                          question="How many cancelled?", provider=_Rewriter())
    assert said == "5,872 orders were cancelled." and receipt["action"] == "rewrote the answer"
