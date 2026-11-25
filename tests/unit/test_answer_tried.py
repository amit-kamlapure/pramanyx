"""What an answer tried (A1b) and what is learned from it (A7), 2026-11-26: the statement a repair replaced and the one
that ran, kept on the receipt; each failure and its fix a learned "watch for this"; a run's thumbs-down in the same
review cluster as an answer's."""
from __future__ import annotations

import uuid

from pramanyx.kernel.ledger import Ledger
from pramanyx.trust.answer_tried import lineage_rows, tried


def _conn() -> str:
    return "c" + uuid.uuid4().hex[:8]


def test_what_was_tried_is_read_from_the_repair_rounds_own_receipts():
    receipts = [
        {"guard": "numeric grounding", "action": "rewrote", "before": "x"},                       # not a statement
        {"guard": "preflight_repair", "action": "repaired_sql", "detail": "identifiers_repaired",
         "before": "SELECT statuz FROM orders", "after": "SELECT status FROM orders"},
        {"guard": "sql_repair", "action": "repaired_sql", "detail": "the query failed: no such column",
         "before": "SELECT a FROM t", "after": "SELECT b FROM t"},
        {"guard": "repair_recheck", "action": "kept_original", "detail": "the repair trips grain", "before": "S1", "after": "S2"},
        {"guard": "sql_repair", "action": "repaired_sql", "before": "", "after": "S3"},           # nothing before: nothing tried
    ]
    steps = tried(receipts)
    assert [(s["what"], s["before"], s["after"]) for s in steps] == [
        ("repaired_sql", "SELECT statuz FROM orders", "SELECT status FROM orders"),
        ("repaired_sql", "SELECT a FROM t", "SELECT b FROM t"),
        ("kept_original", "S1", "S2")]
    assert lineage_rows(steps)[1] == ("tried_sql", "repaired_sql", "SELECT a FROM t")


def test_the_receipt_keeps_what_was_tried():
    from pramanyx.routers.investigations import _write_answer_receipt
    conn = _conn()
    steps = [{"what": "repaired_sql", "why": "the query failed: no such column", "before": "SELECT a FROM t",
              "after": "SELECT b FROM t"}]
    out = _write_answer_receipt(kind="chat_answer", natural_key=f"chat:{conn}:1", question="q", sqls=["SELECT b FROM t"],
                                headline="h", schema="", connection_id=conn, payload_extra={"tried": steps})
    rid = out["receipt_id"]
    art = Ledger.default().artifact_by_id(rid)
    assert art["payload"]["tried"] == steps
    assert ("tried_sql", "repaired_sql", "SELECT a FROM t") in [r[1:] for r in Ledger.default().lineage_of_many([rid])]


def test_a_failure_and_its_fix_is_learned_once_on_the_datas_word():
    from pramanyx.knowledge.learned import _fixes
    conn = _conn()
    step = {"what": "repaired_sql", "why": "the query failed: column statuz does not exist",
            "before": "SELECT statuz FROM orders", "after": "SELECT status FROM orders"}
    for n in range(2):              # the same fix to the same failure, twice: one thing learned
        Ledger.default().artifact_write("chat_answer", f"chat:{conn}:{n}", {"question": "q", "tried": [step]}, conn_id=conn)
    Ledger.default().artifact_write("chat_answer", f"chat:{conn}:kept", {"question": "q", "tried": [
        {"what": "kept_original", "why": "the repair trips grain", "before": "S1", "after": "S2"}]}, conn_id=conn)
    got = _fixes(conn)
    assert [i["text"] for i in got] == ["Watch for this: the query failed: column statuz does not exist — rewritten, it ran"]
    assert got[0]["kind"] == "fix" and got[0]["standing"] == "measured" and got[0]["tables"] == ["orders"]
    assert got[0]["lineage"][:2] == ["before:SELECT statuz FROM orders", "after:SELECT status FROM orders"]


def test_a_runs_thumbs_down_joins_the_answers_in_review():
    from pramanyx.knowledge import review as R
    conn = _conn()
    Ledger.default().emit("chat.feedback", {"verdict": "unhelpful", "turn_id": "t1", "note": "wrong month"}, conn_id=conn)
    Ledger.default().emit("trace.feedback", {"verdict": "unhelpful", "trace_id": "tr1", "note": "",
                                             "question": "Why did revenue fall?"}, conn_id=conn, trace_id="tr1")
    Ledger.default().emit("trace.feedback", {"verdict": "helpful", "trace_id": "tr2"}, conn_id=conn, trace_id="tr2")
    rows = R._unhelpful(conn, R._links(conn))
    assert sorted(r["title"] for r in rows) == ["A run marked unhelpful: Why did revenue fall?", "An answer marked unhelpful"]


def test_a_runs_feedback_says_its_connection_and_question(monkeypatch):
    from pramanyx.routers import obs
    conn = _conn()
    monkeypatch.setattr(obs.session_log, "recover_session", lambda trace_id, org_id=None: [
        {"kind": "turn", "conn_id": conn, "question": "Why did revenue fall?"}])
    monkeypatch.setattr("pramanyx.obs.session_log.pin_run", lambda trace_id="": None)
    out = obs.post_trace_feedback("tr9", obs._TraceFeedbackRequest(verdict="unhelpful", note="off by a month"))
    assert out["recorded"] is True
    got = [e for e in Ledger.default().events(kind="trace.feedback", conn_id=conn, limit=5)]
    assert got and got[0]["payload"]["question"] == "Why did revenue fall?"
