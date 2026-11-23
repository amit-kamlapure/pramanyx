"""A conversation's answer offers its next questions, as the coworker's does (2026-11-23).

Seen live: the Ask panel's and a Data Canvas's answers folded "Follow-ups" with no questions in it — the conversation
dropped every tool's `followups` frame — while the coworker's answers offered three. Held here, the model never called:

* the questions a tool already made (`answer_question`'s quick pipeline) are offered under the turn's answer;
* a turn that ran its own query gets one call over that query's artifact; a turn that read no rows gets none;
* the call never holds the turn open: past its wait, the turn ends without them.
"""
from __future__ import annotations

import asyncio
import json
import time
from types import SimpleNamespace

from pramanyx.routers.investigations import AskRequest

SQL = "SELECT status, COUNT(*) AS orders FROM thelook_ecommerce.orders GROUP BY 1"


def _ask(monkeypatch, frames_from_tools: list[tuple[str, dict]], *, said=None, slow: float = 0.0) -> tuple[list, dict]:
    from pramanyx.routers import investigations as inv
    held: dict = {"calls": 0, "user": ""}
    route = SimpleNamespace(depth="quick", forced=None, mode="", shape="describe",
                            to_event=lambda: {"depth": "quick", "why": "asked quickly"})
    monkeypatch.setattr("pramanyx.agent.ask_router.decide_ask_route", lambda *a, **k: route)
    monkeypatch.setattr(inv, "_converse_eligible", lambda req, r: True)
    monkeypatch.setattr(inv, "_analyst_eligible", lambda req, r: False)
    monkeypatch.setattr(inv, "_overview_eligible", lambda req: False)
    monkeypatch.setattr(inv, "_insight_budget", lambda conn: None)
    monkeypatch.setattr(inv, "build_history_section", lambda h: "")
    monkeypatch.setattr(inv, "resolve_prior_answers", lambda *a, **k: [])
    monkeypatch.setattr(inv, "build_prior_answers_section", lambda a: "")
    monkeypatch.setattr(inv, "save_chat_turn", lambda **k: "t1")
    monkeypatch.setattr(inv, "FOLLOWUPS_WAIT_S", 0.3)
    monkeypatch.setattr("pramanyx.briefing.compose.sources.known_context", lambda *a, **k: "")
    monkeypatch.setattr("pramanyx.agent.converse_tools.ground_answer_numbers",
                        lambda answer, rows, question="": (answer, None))

    async def metered(gen, budget=None):
        async for ev in gen:
            yield ev
    monkeypatch.setattr(inv, "_metered_stream", metered)

    class _Narrator:
        def complete(self, *, system, user, response_model):
            held["calls"] += 1
            held["user"] = user
            if slow:
                time.sleep(slow)
            return response_model(questions=said or [])
    monkeypatch.setattr("pramanyx.llm.provider.get_provider", lambda role="coder": _Narrator())

    def _loop(conn, q, *, tool_emit=None, **k):
        for kind, payload in frames_from_tools:
            tool_emit(kind, payload)
        return SimpleNamespace(answer="Most orders are complete.", steps=[], stop_reason="answered",
                               injected_chars=0, reinjection_ratio=0.0)
    monkeypatch.setattr("pramanyx.agent.converse_tools.converse", _loop)
    req = AskRequest(question="How many orders are there by status?", connection_id="8233e4fd", depth="quick")

    async def run() -> list[str]:
        return [ev async for ev in inv._stream_ask(req, None, "8233e4fd")]
    frames = [json.loads(ev[6:]) for ev in asyncio.run(run()) if ev.startswith("data: ")]
    return frames, held


QUERY = [("sql", {"sql": SQL}), ("columns", {"columns": ["status", "orders"]}),
         ("rows", {"rows": [["Complete", 31000], ["Shipped", 30000]]})]


def _next(frames: list) -> list:
    return [f.get("questions") for f in frames if f.get("type") == "followups"]


def test_the_questions_a_tool_made_are_offered_under_the_answer_with_no_second_call(monkeypatch):
    frames, held = _ask(monkeypatch, [*QUERY, ("followups", {"questions": ["By month?", "Which country?"]})])
    assert _next(frames) == [["By month?", "Which country?"]] and held["calls"] == 0
    assert [f["type"] for f in frames].index("followups") < [f["type"] for f in frames].index("done")


def test_a_turn_that_ran_its_own_query_gets_them_from_that_query(monkeypatch):
    frames, held = _ask(monkeypatch, QUERY, said=["Break it out by month", "Which status grew?", "By country", "x"])
    assert _next(frames) == [["Break it out by month", "Which status grew?", "By country"]]
    assert held["calls"] == 1 and SQL in held["user"] and "status" in held["user"]


def test_a_turn_that_read_no_rows_offers_none(monkeypatch):
    frames, held = _ask(monkeypatch, [], said=["anything"])
    assert _next(frames) == [] and held["calls"] == 0


def test_a_slow_call_never_holds_the_turn_open(monkeypatch):
    started = time.monotonic()
    frames, held = _ask(monkeypatch, QUERY, said=["late"], slow=1.5)
    assert _next(frames) == [] and any(f["type"] == "done" for f in frames)
    assert time.monotonic() - started < 1.4, "the turn waited for its next questions past the wait"
