"""Ask again runs the question afresh; an answer whose figures no query read goes back once (2026-11-23).

Seen live in the Ask panel beside the Olist orders sheet: "How many orders are there by order status?" was answered
right (one query, eight counts); Ask again ran nothing, wrote the eight counts from what the conversation already held,
and the grounding check after the loop struck them — the person read "The data shows a total of 99441 orders, but does
not provide a breakdown by order status". Two fixes, held here with the model never called:

* the loop's stop check hands back a draft that states figures no query in this turn read, while a query can still run;
* "Ask again" is said to the conversation, which is not handed earlier answers to repeat.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

from pramanyx.agent.converse_tools import figures_no_query_read
from pramanyx.routers.investigations import AskRequest

BREAKDOWN = ("Of the 99,441 orders in the sheet, the breakdown by status is: delivered 96,477 (97.0%), shipped 1,108 "
             "(1.1%), canceled 625 (0.6%), unavailable 609 (0.6%).")


def test_a_breakdown_no_query_read_goes_back_once_saying_which_figures():
    why = figures_no_query_read(BREAKDOWN, [])
    assert why is not None and "96,477" in why and "Run the query" in why


def test_figures_a_query_in_this_turn_read_are_left_to_the_check_after_the_loop():
    ran = [{"sql": {"sql": "SELECT order_status, COUNT(*) FROM o GROUP BY 1"},
            "rows": {"rows": [["delivered", 96477], ["shipped", 1108]]}}]
    assert figures_no_query_read(BREAKDOWN, ran) is None


def test_one_figure_and_a_sheets_own_counts_are_not_a_breakdown_from_memory(monkeypatch):
    assert figures_no_query_read("The reviews table holds 99,224 rows.", []) is None   # a count read from the listing
    monkeypatch.setattr("pramanyx.sheets.answer.citable_counts", lambda ref: [[99441]])
    assert figures_no_query_read("The sheet holds 99,441 orders: 96,477 delivered, 1,108 shipped.", [], sheet="s1:v") is not None
    assert figures_no_query_read("The sheet holds 99,441 orders.", [], sheet="s1:v") is None


def _ask(monkeypatch, purpose: str) -> dict:
    """One `/ask` turn through the real `_stream_ask` and `_stream_converse`, the model's loop stood in for: what the
    loop was HANDED, and whether earlier answers were looked up."""
    from pramanyx.routers import investigations as inv
    held: dict = {"context": None, "prior": 0}
    route = SimpleNamespace(depth="quick", forced=None, mode="", shape="describe",
                            to_event=lambda: {"depth": "quick", "why": "asked quickly"})
    monkeypatch.setattr("pramanyx.agent.ask_router.decide_ask_route", lambda *a, **k: route)
    monkeypatch.setattr(inv, "_converse_eligible", lambda req, r: True)
    monkeypatch.setattr(inv, "_analyst_eligible", lambda req, r: False)
    monkeypatch.setattr(inv, "_overview_eligible", lambda req: False)
    monkeypatch.setattr(inv, "_insight_budget", lambda conn: None)
    monkeypatch.setattr(inv, "build_history_section", lambda h: "")

    def _prior(*a, **k):
        held["prior"] += 1
        return []
    monkeypatch.setattr(inv, "resolve_prior_answers", _prior)
    monkeypatch.setattr(inv, "build_prior_answers_section", lambda a: "")
    monkeypatch.setattr("pramanyx.briefing.compose.sources.known_context", lambda *a, **k: "")
    monkeypatch.setattr("pramanyx.agent.converse_tools.ground_answer_numbers",
                        lambda answer, rows, question="": (answer, None))

    async def metered(gen, budget=None):
        async for ev in gen:
            yield ev
    monkeypatch.setattr(inv, "_metered_stream", metered)

    def _loop(conn, q, *, extra_context=None, **k):
        held["context"] = extra_context or ""
        return SimpleNamespace(answer="An answer.", steps=[], stop_reason="answered", injected_chars=0,
                               reinjection_ratio=0.0)
    monkeypatch.setattr("pramanyx.agent.converse_tools.converse", _loop)
    req = AskRequest(question="How many orders are there by order status?", connection_id="c0ffee00",
                     depth="quick", purpose=purpose)

    async def run() -> list[str]:
        return [ev async for ev in inv._stream_ask(req, None, "c0ffee00")]
    asyncio.run(run())
    return held


def test_ask_again_is_said_and_earlier_answers_are_not_handed_over(monkeypatch):
    held = _ask(monkeypatch, "ask_again")
    assert "ASKED AGAIN" in held["context"] and held["prior"] == 0


def test_a_question_asked_the_first_time_is_handed_earlier_answers_as_before(monkeypatch):
    held = _ask(monkeypatch, "")
    assert "ASKED AGAIN" not in (held["context"] or "") and held["prior"] == 1
