"""The confirmation loop: a person's word on an answer reaches the claim the answer booked, and the graph.

Measured 2026-11-14, before this: 1,036 finding nodes across four connections, none a person's; 11 verdicts, 8 of them
"right", none of which had changed anything the planner is shown. The graph's read-back shows the planner only what
a person stands behind (`ontology/context_graph_readback.py`), so the learned layer was empty by rule.
"""
from __future__ import annotations

import uuid

import pytest

from pramanyx.feedback import verdicts as V
from pramanyx.ontology import context_graph_build as B
from pramanyx.ontology.graph_warrant import _BY_RECORD_TIER
from pramanyx.record import claims as C
from pramanyx.record import writers as W

SQL = "SELECT status, SUM(gmv_eur) FROM orders GROUP BY 1"


def _conn():
    return "conn-" + uuid.uuid4().hex[:6]


def _answer(conn: str, inv: str, headline: str = "Shipped orders lead GMV") -> str:
    return W.book_answer_observation(kind="chat_answer", natural_key=f"chat:{conn}:{inv}", receipt_id="rcpt-1",
                                     connection_id=conn, question="GMV by status?", headline=headline, sql=SQL)


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(V, "_DB_PATH", tmp_path / "verdicts.db", raising=False)
    refreshed: list = []
    monkeypatch.setattr(V, "_refresh_graphs_behind", lambda conn, org: refreshed.append(conn))
    monkeypatch.setattr(V, "_turn_record", lambda inv: {})
    return refreshed


def test_a_right_raises_the_answers_claim_to_the_tier_a_persons_word_carries(store):
    conn = _conn()
    first = _answer(conn, "a1")
    said = V.record_verdict(conn, "a1", "accept", note="helpful (chat)")
    now = C.latest(W.observation_key(conn, "a1"))
    assert now.tier == "approved" and now.supersedes == first and said["claims"] == [now.id]
    assert now.statement.text == "Shipped orders lead GMV"               # the statement is the one that was approved
    assert [w.kind for w in now.warrants] == ["run", "attestation"]      # the run is kept; the verdict is named
    assert now.warrants[1].ref == f"verdict:{said['id']}" and now.extra["verdict_id"] == said["id"]
    assert C.get(first).tier == "measured"                               # the earlier version is kept as it was
    assert store == [conn]                                               # the graph is rebuilt from the Record


def test_the_graph_shows_an_approved_claim_and_reads_it_as_a_persons(store):
    conn = _conn()
    _answer(conn, "a1")
    _answer(conn, "a2", "Returned orders are 11% of GMV")
    V.record_verdict(conn, "a1", "accept")
    by_inv = {f["investigation_id"]: f for f in B.load_record_findings(conn)}
    assert by_inv["a1"]["tier"] == "approved" and by_inv["a2"]["tier"] == "measured"
    assert _BY_RECORD_TIER["approved"] == "human" and _BY_RECORD_TIER["measured"] != "human"


def test_a_wrong_withdraws_the_claim_and_its_receipt_does_not_bring_it_back(store):
    conn = _conn()
    first = _answer(conn, "a1")
    said = V.record_verdict(conn, "a1", "reject", note="grouped per order, not per status")
    now = C.latest(W.observation_key(conn, "a1"))
    assert now.state == "withdrawn" and now.statement.text.startswith("Withdrawn: ")
    assert now.extra["withdrawn_reason"] == "grouped per order, not per status" and said["claims"] == [now.id]
    assert C.get(first).statement.text == "Shipped orders lead GMV"      # kept, never deleted
    assert B.load_record_findings(conn) == []
    # The answer's receipt is still in the ledger and would be read as a legacy finding of the same investigation.
    legacy = [{"id": "rcpt-1", "investigation_id": "a1", "text": "Shipped orders lead GMV"},
              {"id": "rcpt-9", "investigation_id": "older", "text": "kept"}]
    kept = B.merge_finding_sources([], legacy, withdrawn=B.withdrawn_investigations(conn))
    assert [f["investigation_id"] for f in kept] == ["older"]


def test_a_second_right_and_a_right_on_nothing_change_nothing(store):
    conn = _conn()
    _answer(conn, "a1")
    V.record_verdict(conn, "a1", "accept")
    once = C.latest(W.observation_key(conn, "a1"))
    assert V.record_verdict(conn, "a1", "accept")["claims"] == []         # already a person's
    assert C.latest(W.observation_key(conn, "a1")).id == once.id
    assert V.record_verdict(conn, "never-answered", "accept")["claims"] == []


def test_a_number_that_moves_after_it_was_approved_is_measured_again(store):
    conn = _conn()
    _answer(conn, "a1", "1,744 orders a day")
    V.record_verdict(conn, "a1", "accept")
    entry = {"checked_at": "2026-11-15T06:00:00Z", "status": "changed", "reason": "", "compared": 6, "missing_rows": 0,
             "new_rows": 1, "cause": "late_rows", "lag_days": 3, "changed": 1,
             "changes": [{"column": "orders", "label": {}, "old": 1744.0, "new": 1902.0, "rel": 0.09, "cause": "late_rows"}]}
    W.restate_answer_observation({"id": "a1", "connection_id": conn, "report": {"sql": SQL}}, entry, text="Restated: 1,902")
    now = C.latest(W.observation_key(conn, "a1"))
    # A person approved 1,744. This is 1,902: theirs to approve again, never approved for them.
    assert now.tier == "measured" and [w.kind for w in now.warrants] == ["run"]
    assert "approved_by" not in now.extra and now.extra["approval_lapsed"]


def test_a_deep_analysiss_findings_follow_the_same_word(store):
    conn = _conn()
    for n in ("e1", "e2"):
        C.book(C.Claim(kind="finding", tier="measured", statement=C.Statement(text=f"finding {n}"), as_of="2026-11-14",
                       warrants=[C.Warrant(kind="run", ref="rcpt-d", detail=SQL)], extra={"investigation_id": "d1"}),
               key=W.finding_key(conn, "d1", n), conn_id=conn)
    C.book(C.Claim(kind="finding", tier="measured", statement=C.Statement(text="another run's"), as_of="2026-11-14",
                   warrants=[C.Warrant(kind="run", ref="rcpt-x", detail=SQL)], extra={"investigation_id": "d2"}),
           key=W.finding_key(conn, "d2", "e1"), conn_id=conn)
    assert len(V.record_verdict(conn, "d1", "accept")["claims"]) == 2
    tiers = {c.extra["investigation_id"]: c.tier for c in C.list_claims(kind="finding", conn_id=conn)}
    assert tiers == {"d1": "approved", "d2": "measured"}
