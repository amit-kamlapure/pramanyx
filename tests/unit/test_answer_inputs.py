"""What an answer was given, recorded as it is made (2026-11-25, the Atlas-by-Area plan's A1). Nothing recorded what
an answer was given, so no Definition, document or trusted query could say how many answers drew on it — the figure
the ontology study of 2026-11-25 found on every governed thing elsewhere. The answer path starts a record, each retriever that picks for the
question notes what it put in front of the model, and the receipt carries it and counts the uses."""
from __future__ import annotations

import contextvars
import uuid
from types import SimpleNamespace as NS

from pramanyx.trust import answer_inputs as AI


def test_nothing_is_noted_when_no_answer_is_recording():
    AI._GIVEN.set(None)
    AI.note_given("definition", "c1/Revenue/")
    assert AI.consume() == {}


def test_a_record_keeps_each_thing_once_and_is_emptied_when_consumed():
    AI.start_recording()
    AI.note_given("definition", "c1/Revenue/", "Revenue")
    AI.note_given("definition", "c1/Revenue/", "Revenue")
    AI.note_given("document", "doc-1", "Returns policy")
    AI.note_given("", "x")
    got = AI.consume()
    assert got == {"definition": {"c1/Revenue/": "Revenue"}, "document": {"doc-1": "Returns policy"}}
    assert AI.consume() == {}, "a later answer in this context is never credited with this one's"
    assert AI.lineage_rows(got) == [("given", "definition:c1/Revenue/", "Revenue"), ("given", "document:doc-1", "Returns policy")]
    assert AI.summary(got) == {"definition": ["Revenue"], "document": ["Returns policy"]}


def test_a_retriever_on_a_worker_thread_is_heard_by_the_answer_that_started_the_record():
    """The answer path fans its retrievals out on a pool that copies the context: the copy holds the same record, so
    its notes reach the receipt — where a ContextVar.set in a worker never would."""
    from pramanyx.kernel.concurrency import ContextThreadPoolExecutor
    AI.start_recording()
    with ContextThreadPoolExecutor(max_workers=2) as pool:
        pool.submit(AI.note_given, "trusted_query", "c1/tq1", "Revenue by month").result()
    contextvars.copy_context().run(AI.note_given, "definition", "c1/AOV/", "AOV")
    assert set(AI.consume()) == {"trusted_query", "definition"}


def test_the_definitions_picked_for_a_question_are_noted_as_discover_names_them(monkeypatch):
    from pramanyx.semantic import connection_kb as K
    entries = [NS(id="revenue", title="Revenue", area="orders_sales", body="Net of returns", kind="note", tags=[],
                  standing={"tier": "approved"}, connection_id="c1"),
               NS(id="aov", title="AOV", area="", body="Revenue over orders", kind="note", tags=[],
                  standing={"tier": "declared"}, connection_id="c1")]
    monkeypatch.setattr(K, "_relevant_entries", lambda q, c, k=None: list(entries))
    monkeypatch.setattr(K, "_behind", lambda e, c: (0, 0))
    monkeypatch.setattr(K, "_render_block", lambda es, header=None, home="": "BLOCK")
    monkeypatch.setattr("pramanyx.semantic.areas.rival_meanings", lambda q, c: [])
    AI.start_recording()
    K.retrieve_for_question("what is revenue", "c1")
    assert AI.consume()["definition"] == {"c1/Revenue/orders_sales": "Revenue", "c1/AOV/": "AOV"}
    # one an Area gives this connection from another (A8) is noted under the connection it was written on
    entries.append(NS(id="repeat", title="Repeat buyer", area="orders_sales", body="Two orders or more", kind="note",
                      tags=[], standing={"tier": "approved"}, connection_id="c2"))
    AI.start_recording()
    K.retrieve_for_question("who is a repeat buyer", "c1")
    assert AI.consume()["definition"]["c2/Repeat buyer/orders_sales"] == "Repeat buyer"


def test_the_trusted_queries_put_in_front_of_the_model_are_noted_on_either_answer_path():
    from pramanyx.discover.items import trusted_query_id
    from pramanyx.semantic.trusted_queries import TrustedQuery, build_trusted_block
    tq = TrustedQuery(id="tq1", connection_id="c1", question="Revenue by month", sql="SELECT 1", tables=["orders"],
                      status="approved", source="api", verified_by="user:bo")
    AI.start_recording()
    build_trusted_block([(tq, 0.9)])
    assert AI.consume() == {"trusted_query": {f"c1/{trusted_query_id('c1', tq)}": "Revenue by month"}}


def test_the_documents_whose_passages_reach_the_prompt_are_noted(monkeypatch):
    from pramanyx.knowledge import indexer as X
    monkeypatch.setattr("pramanyx.custom_agents.context.agent_doc_ids", lambda: None)
    monkeypatch.setattr(X, "canvas_doc_ids", lambda canvas_id: [])
    monkeypatch.setattr(X, "_document_marks", lambda: {"old": {"status": "deprecated"}})
    monkeypatch.setattr(X, "search_documents", lambda q, top_k, connection_id=None: [
        {"doc_id": "d1", "title": "Returns policy", "text": "Returns within 30 days", "chunk_index": 0, "filename": "r.pdf"},
        {"doc_id": "old", "title": "Old policy", "text": "Returns within 14 days", "chunk_index": 0, "filename": "o.pdf"}])
    AI.start_recording()
    assert X.build_external_context_section("returns policy", top_k=2, connection_id="c1")
    assert AI.consume() == {"document": {"d1": "Returns policy"}}, "a deprecated document is not handed over, nor noted"


def test_the_receipt_carries_what_the_answer_was_given_and_counts_each_use(monkeypatch):
    from pramanyx.discover.usage import USED, opens
    from pramanyx.kernel.ledger import Ledger
    from pramanyx.routers.investigations import _write_answer_receipt
    conn = "c" + uuid.uuid4().hex[:8]
    AI.start_recording()
    AI.note_given("definition", f"{conn}/Revenue/", "Revenue")
    AI.note_given("trusted_query", f"{conn}/tq1", "Revenue by month")
    AI.note_given("finding", "f1", "Orders peak on Mondays")
    out = _write_answer_receipt(kind="chat_answer", natural_key=f"chat:{conn}:inv1", question="revenue by month",
                                sqls=["SELECT SUM(amount) FROM orders"], headline="Revenue rose", schema="",
                                connection_id=conn)
    rcpt = Ledger.default().receipt_by_id(out["receipt_id"])
    art = rcpt["artifact"]
    rows = {(r["relation"], r["ref"]) for r in rcpt["lineage"]}
    assert {("given", f"definition:{conn}/Revenue/"), ("given", f"trusted_query:{conn}/tq1"), ("given", "finding:f1")} <= rows
    assert art["payload"]["given"]["definition"] == ["Revenue"]
    used = {(u["kind"], u["ref"]) for u in opens(kind=USED)}
    assert {("definition", f"{conn}/Revenue/"), ("trusted_query", f"{conn}/tq1")} <= used
    assert not any(k == "finding" for k, _ in used), "what every answer is given alike is not counted as a use"
    assert AI.consume() == {}


def test_discover_says_the_answers_that_drew_on_a_thing_apart_from_its_opens():
    from pramanyx.discover.usage import OPENED, USED, score, use_of
    from pramanyx.kernel.ledger import Ledger
    ref = "c1/" + uuid.uuid4().hex[:6] + "/"
    Ledger.default().emit(OPENED, {"kind": "definition", "ref": ref, "connection_id": "c1", "by": "user:ana"}, conn_id="c1")
    for _ in range(2):
        Ledger.default().emit(USED, {"kind": "definition", "ref": ref, "connection_id": "c1", "by": "user:bo"}, conn_id="c1")
    item = NS(kind="definition", id=ref, name="Revenue", connection_id="c1")
    use, _said = use_of([item])
    assert (use[ref]["measured"], use[ref]["count"], use[ref]["answers"]) == ("opens", 1, 2)
    assert score(use[ref]) == 3


def test_every_answer_path_starts_its_record_before_it_fans_out():
    """A path that never starts a record notes nothing, silently — its empty receipt looks just like an answer given
    nothing. Each one that writes a user-facing answer starts it ahead of its retrievals: the quick answer before its
    prelude pool, the deep run and its resume before the graph's copied context."""
    import inspect

    from pramanyx.routers import investigations as I
    core = inspect.getsource(I._answer_core)
    assert 0 <= core.index("start_recording()") < core.index("ContextThreadPoolExecutor(")
    for fn in (I._stream_investigation, I._stream_resume):
        src = inspect.getsource(fn)
        assert 0 <= src.index("start_recording()") < src.index("_investigation_stream(agent.stream(")
