"""Query-history findings are Record claims, referred to only when an answer came out inconclusive.

The user, 2026-11-14: "query history findings to become record claims only.. only to be referred when investigation is
non-conclusive". Until then a mined candidate was a card in the actions inbox. Now what binds is booked as a claim of
kind ``usage`` at tier ``mined``, warranted by the history it came from; it is not a node of the graph, the planner is
not shown it, and the one reader is the repair of a first attempt that failed, returned nothing or was not as asked.
"""
from __future__ import annotations

import inspect
import uuid

from pramanyx.ontology import context_graph_build as B
from pramanyx.ontology.candidates import Candidate
from pramanyx.record import claims as C
from pramanyx.record import writers as W
from pramanyx.routers import investigations as inv


def _conn():
    return "conn-" + uuid.uuid4().hex[:6]


def _mined(conn):
    return [Candidate(connection_id=conn, kind="join", subject="orders", origin="query_log", bound=True,
                      proposal="orders.customer_id = customers.id", evidence="seen in 412 statements"),
            Candidate(connection_id=conn, kind="filter", subject="orders", origin="query_log", bound=True,
                      proposal="status <> 'cancelled'", evidence="seen in 97 statements")]


def test_what_was_mined_is_booked_as_a_usage_claim_warranted_by_the_history():
    conn = _conn()
    out = W.book_usage_claims(connection_id=conn, candidates=_mined(conn), source="pg_stat_statements")
    assert len(out["booked"]) == 2 and out["already"] == 0
    c = C.get(out["booked"][0])
    assert (c.kind, c.tier, c.author_kind) == ("usage", "mined", "system")
    assert c.statement.text == "People join orders this way in their own queries: orders.customer_id = customers.id"
    (w,) = c.warrants
    assert w.kind == "query_history" and w.ref.startswith(f"history:{conn}:pg_stat_statements:") and w.content_hash
    assert w.detail == "seen in 412 statements"


def test_a_second_mining_books_nothing_again():
    conn = _conn()
    W.book_usage_claims(connection_id=conn, candidates=_mined(conn))
    again = W.book_usage_claims(connection_id=conn, candidates=_mined(conn))
    assert again == {"booked": [], "already": 2}
    assert len(C.list_claims(kind="usage", conn_id=conn)) == 2


def test_a_usage_claim_is_no_node_of_the_graph_and_no_ground_for_the_planner():
    conn = _conn()
    W.book_usage_claims(connection_id=conn, candidates=_mined(conn))
    assert B.load_record_findings(conn) == [] and B.load_record_definitions(conn) == []
    assert "usage" not in B.RECORD_FINDING_KINDS


def test_it_is_found_for_a_question_or_a_statement_it_bears_on_and_for_no_other():
    conn = _conn()
    W.book_usage_claims(connection_id=conn, candidates=_mined(conn))
    found = W.usage_for(conn, question="How many customers ordered?", sql="SELECT COUNT(*) FROM orders")
    assert {c.extra["candidate_kind"] for c in found} == {"join", "filter"}
    assert W.usage_for(conn, question="What is the weather?", sql="SELECT 1 FROM shipments") == []
    assert W.usage_for(_conn(), question="orders", sql="orders") == []              # another connection's are not read


def test_the_answer_path_reads_it_only_when_the_first_attempt_was_inconclusive():
    """Wiring guard: read in one place, behind the three ways a first attempt is inconclusive."""
    src = inspect.getsource(inv._answer_core)
    assert src.count("usage_for(") == 1
    at = src.index("usage_for(")
    assert "if result.error or _chat_zero_diag or _shape_fix_hint:" in src[at - 600:at]
    assert '"guard": "usage_history", "action": "referred"' in src


def test_the_mining_door_books_claims_and_stages_no_inbox_card():
    from pramanyx.routers import ontology as O
    src = inspect.getsource(O.mine_ontology_candidates)
    assert "book_usage_claims(" in src and "stage_candidates(" not in src
