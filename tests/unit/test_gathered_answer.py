"""A question worked by helpers has one answer, and its figures are checked against the answers it gathered
(the user, 2026-11-16). The figures here are the ones the live run of that day wrote: Lux's FY2026 cancellation rate
against the Olist orders sheet's."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx.govern import departure_basis
from pramanyx.govern.departure import Measurement
from pramanyx.govern.gathered import check_gathered_answer
from pramanyx.routers import coworker as C

#: What two answers kept: Lux's status mix (count, share), and Olist's (count, fraction, total orders).
ROWS = {
    "lux-status": [18061.0, 9360.0, 51.82, 7982.0, 44.19, 719.0, 3.98],
    "olist-status": [99441.0, 96478.0, 0.9702, 625.0, 0.0063, 609.0, 0.0061],
    # Another organisation's answer that happens to hold the same figure: never read, so it grounds nothing.
    "someone-elses": [99441.0],
}

CLOSE = ("Lux's order cancellation rate for fiscal year 2026 is 3.98% — 719 cancelled orders out of 18,061. "
         "The Olist orders spreadsheet gives 0.63%, 625 canceled out of 99,441. "
         "If unavailable counts as cancelled, Olist moves to about 1.24%. "
         "Three things to carry before reading that as six times more often; the window runs 2025-07-01 to 2026-06-30.")


@pytest.fixture()
def answers(monkeypatch):
    def measured(iid, conn_id=""):
        return Measurement(source=f"analysis {iid}", values=list(ROWS[iid])) if iid in ROWS else None
    monkeypatch.setattr(departure_basis, "measurement_for_analysis", measured)


def test_every_figure_is_looked_for_in_the_answers_and_one_worked_out_is_named(answers):
    said = check_gathered_answer(CLOSE, ["lux-status", "olist-status"])
    # 3.98%, 18,061, 0.63%, 99,441, 1.24%. Not claims, as the departure gate reads them: the dates, "Three", "six",
    # and a bare whole number under 1,000 (719, 625) — the rule that keeps "3 regions" and "top 5" from being flagged.
    assert said["checked"] == 5 and said["found"] == 4
    assert said["not_found"] == [{"text": "1.24%", "clause": "If unavailable counts as cancelled, Olist moves to about 1.24%."}]
    assert said["answers"] == 2 and said["unread"] == 0


def test_a_share_is_found_as_a_cell_or_as_a_fractions_hundredfold(answers):
    assert check_gathered_answer("Lux 3.98%, Olist 0.63%.", ["lux-status", "olist-status"])["not_found"] == []
    # At the precision written: "0.6%" claims 0.55–0.65, which 0.63 is (a rounding); "3.9%" claims 3.85–3.95, which
    # 3.98 is not (a misquote).
    missing = check_gathered_answer("Lux 3.9%, Olist 0.6%.", ["lux-status", "olist-status"])["not_found"]
    assert [f["text"] for f in missing] == ["3.9%"]


def test_a_figure_is_found_only_in_the_answers_named(answers):
    said = check_gathered_answer(CLOSE, ["lux-status"])
    assert {f["text"] for f in said["not_found"]} == {"0.63%", "99,441", "1.24%"}


def test_an_answer_that_cannot_be_read_is_counted_and_grounds_nothing(answers):
    said = check_gathered_answer("18,061 orders.", ["gone", "lux-status", "gone"])
    assert said["answers"] == 1 and said["unread"] == 1 and said["not_found"] == []
    nothing = check_gathered_answer("18,061 orders.", ["gone"])
    assert nothing["answers"] == 0 and [f["text"] for f in nothing["not_found"]] == ["18,061"]


def test_a_figure_written_twice_is_named_once(answers):
    said = check_gathered_answer("About 1.24%. Again: 1.24%.", ["olist-status"])
    assert said["checked"] == 2 and [f["text"] for f in said["not_found"]] == ["1.24%"]


# ── the door ─────────────────────────────────────────────────────────────────────────────────────────────────────

QUESTION = {"trace_id": "cw-90833665e534ce5a-1", "session": "session-90833665-0e53-4ce5-b95e-d3db8577d910"}


@pytest.fixture()
def door(answers, monkeypatch):
    from pramanyx.obs import session_log
    from pramanyx.org.context import current_session_id
    from pramanyx.security import authz
    seen = []
    monkeypatch.setattr(session_log, "emit", lambda kind, **kw: seen.append({"kind": kind, "session": current_session_id(), **kw}))
    readable = {"lux-status", "olist-status"}
    monkeypatch.setattr(authz, "resolve_ownership",
                        lambda kind, rid, principal: authz.Ownership.OWNED if rid in readable else authz.Ownership.FOREIGN)
    app = FastAPI()
    app.include_router(C.router)
    return TestClient(app, client=("127.0.0.1", 50000)), seen


def test_the_check_is_a_step_of_the_questions_trace(door):
    client, seen = door
    r = client.post("/coworker/answer-check", json={**QUESTION, "text": CLOSE, "investigation_ids": ["lux-status", "olist-status"]})
    assert r.status_code == 200 and r.json()["found"] == 4
    (step,) = seen
    assert step["kind"] == "step" and step["name"] == "answer_check" and step["trace_id"] == QUESTION["trace_id"]
    assert step["ok"] is False and step["payload"]["not_found"] == ["1.24%"]
    assert step["session"] == "coworker:" + QUESTION["session"]


def test_an_answer_the_asker_may_not_read_is_left_out_and_counted(door):
    client, _ = door
    r = client.post("/coworker/answer-check", json={**QUESTION, "text": "18,061 orders, 99,441 orders.",
                                                   "investigation_ids": ["lux-status", "someone-elses", "bad id/"]})
    said = r.json()
    assert said["answers"] == 1 and said["unread"] == 1          # the malformed id is not even asked about
    assert [f["text"] for f in said["not_found"]] == ["99,441"], "a figure in an answer the asker may not read is not found"


def test_only_a_coworker_on_this_machine_asks_and_only_for_its_own_trace(door):
    client, _ = door
    elsewhere = TestClient(client.app, client=("203.0.113.9", 50000))
    assert elsewhere.post("/coworker/answer-check", json={**QUESTION, "text": "x", "investigation_ids": []}).status_code == 403
    assert client.post("/coworker/answer-check", json={**QUESTION, "trace_id": "1d5a621b", "text": "x",
                                                      "investigation_ids": []}).status_code == 422
