"""One authority order on the answer path, and the person asked when a word has rival meanings (the ontology study,
Phase 1, 2026-11-17).

A word the organisation defines differently in two areas of the business is said with the area the question chose, or
the app asks which (the clarify step) and the platform's own answer path answers each meaning, named — never one picked
silently. Of what reaches the planner: a published definition before a draft, a certified table before one nobody
marked, a deprecated one last and said to be deprecated."""
from __future__ import annotations

import uuid

import pytest

from pramanyx.record import writers as W
from pramanyx.semantic import areas as A


def _conn() -> str:
    return "c" + uuid.uuid4().hex[:8]


@pytest.fixture()
def rivals(monkeypatch):
    conn = _conn()
    monkeypatch.setattr(A, "areas_for", lambda c, schema=None, workspace_id=None: [
        {"id": "finance", "name": "Finance"}, {"id": "marketing", "name": "Marketing"}])
    W.write_definition(connection_id=conn, term="Active customer", area="finance", text="Paid in the last 30 days.",
                       by="user:ana", aliases=["paying customer"])
    W.approve_definition(connection_id=conn, term="Active customer", area="finance", by="user:ana")
    W.write_definition(connection_id=conn, term="Active customer", area="marketing", text="Opened an email in 90 days.",
                       by="user:bo")
    W.write_definition(connection_id=conn, term="Churn", text="No order in 180 days.", by="user:ana")   # one meaning
    return conn


def test_a_word_with_two_meanings_is_found_and_the_area_the_question_names_is_chosen(rivals):
    [r] = A.rival_meanings("How many active customers did we have last month?", rivals)
    assert r["term"] == "Active customer" and r["chosen"] == ""
    assert [(m["area_name"], m["standing"]) for m in r["meanings"]] == [("Finance", "published"), ("Marketing", "draft")]
    [chosen] = A.rival_meanings("How many active customers in marketing last month?", rivals)
    assert chosen["chosen"] == "marketing"
    assert A.rival_meanings("How many paying customers last month?", rivals)[0]["term"] == "Active customer"   # its other name
    assert A.rival_meanings("What is churn?", rivals) == []                                       # one meaning: no rival


def test_the_app_asks_which_area_with_each_as_a_choice(rivals):
    from pramanyx.agent.clarify import assess_clarification
    d = assess_clarification("How many active customers did we have last month?", rivals)
    assert d.should_ask and d.source == "rival_meanings" and d.options == ["in Finance", "in Marketing"]
    assert d.question == "“Active customer” means one thing in Finance and Marketing here. Which do you mean?"
    assert not assess_clarification("How many active customers in Finance last month?", rivals).should_ask
    assert not assess_clarification("How many orders last month?", rivals).should_ask


def test_the_planner_is_told_the_rivals_first_and_reads_a_published_definition_before_a_draft(rivals, monkeypatch):
    from types import SimpleNamespace

    from pramanyx.semantic import connection_kb as KB
    entries = [SimpleNamespace(render=lambda: "draft entry", standing={"tier": "declared"}),
               SimpleNamespace(render=lambda: "said entry", standing={"tier": "said"}),
               SimpleNamespace(render=lambda: "published entry", standing={"tier": "approved"})]
    monkeypatch.setattr(KB, "_relevant_entries", lambda q, c, top_k=4: entries)
    block = KB.retrieve_for_question("How many active customers last month?", rivals)
    assert block.startswith("WORDS WITH MORE THAN ONE MEANING HERE")
    assert "in Finance (published): Paid in the last 30 days.; in Marketing (draft): Opened an email in 90 days." in block
    assert "answer for each meaning, each named with its area, or ask the person which they mean" in block
    assert block.index("published entry") < block.index("draft entry") < block.index("said entry")
    chose = KB.retrieve_for_question("active customers in marketing", rivals)
    assert "The question is about Marketing: use Marketing's meaning, and say so." in chose


def test_the_graph_slice_leads_with_a_certified_table_and_says_a_deprecated_one(monkeypatch, tmp_path):
    from pramanyx.govern.certification import securable_for, set_certification
    from pramanyx.ontology import context_graph_search as search_mod
    from pramanyx.ontology import context_graph_store as store
    from pramanyx.ontology.context_graph import ContextGraph, GraphNode, Provenance
    from pramanyx.ontology.context_graph_readback import build_graph_prior
    monkeypatch.setattr(search_mod, "_vector_search", lambda *a, **k: [])
    monkeypatch.setattr(store, "_ROOT", tmp_path / "context_graph")
    conn = _conn()
    cg = ContextGraph(org_id="o", connection_id=conn, schema_name="main")
    for name in ("orders_legacy", "orders_clean", "orders_raw"):
        cg.add_node(GraphNode(id=f"table:{name}", kind="table", label=name.replace("_", " ").capitalize(),
                              provenance=Provenance(source="ontology.entity"), data={"source_tables": [name]}))
    store.save_graph(cg)
    set_certification(securable_for("table", "orders_legacy", connection_id=conn), "deprecated", by="user:ana", why="use orders_clean")
    set_certification(securable_for("table", "orders_clean", connection_id=conn), "certified", by="user:ana")
    section = build_graph_prior("orders by month", conn, org_id="o").section
    line = next(x for x in section.split("\n") if x.strip().startswith("Relevant entities"))
    assert line.index("Orders clean (certified)") < line.index("Orders raw") < line.index("Orders legacy (deprecated")
