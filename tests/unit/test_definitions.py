"""Definitions — what a business word means, written by a person and approved by one (the study's "Pages").

A Record claim of the kind the Record already had and nothing booked (`definition`); measured 2026-11-14: 0 definition
claims and 0 knowledge-base entries live, so nothing moves. Written, it is a person's (tier declared); approved, the
tier a person's word carries most strongly; and either way it is projected into the graph as a term the planner is
shown as ground, which the answer's receipt cites and the coworker opens beside the answer.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx.ontology import context_graph_build as B
from pramanyx.ontology.context_graph import DEFINITION_NODE_PREFIX, ContextGraph, _project_definitions
from pramanyx.ontology.graph_warrant import warrant_for
from pramanyx.record import claims as C
from pramanyx.record import writers as W


def _conn():
    return "conn-" + uuid.uuid4().hex[:6]


def test_a_definition_is_a_persons_and_an_approval_keeps_its_words():
    conn = _conn()
    first = W.write_definition(connection_id=conn, term="Active customer", text="Bought in the last 90 days.",
                               by="user:ana", aliases=["active buyer"])
    c = C.get(first)
    assert (c.kind, c.tier, c.author_kind, c.owner) == ("definition", "declared", "person", "user:ana")
    with pytest.raises(W.NotTheOwner):
        W.approve_definition(connection_id=conn, term="active customer", by="user:ben")     # not ben's
    approved = C.get(W.approve_definition(connection_id=conn, term="active customer", by="user:ana"))
    assert approved.tier == "approved" and approved.statement.text == "Bought in the last 90 days."
    assert approved.extra["approved_by"] == "user:ana" and approved.warrants[-1].kind == "attestation"
    assert W.approve_definition(connection_id=conn, term="Active  Customer!", by="user:ana") is None   # already


def test_a_new_wording_waits_for_approval_again_and_the_earlier_is_kept():
    conn = _conn()
    W.write_definition(connection_id=conn, term="GMV", text="Gross merchandise value, before returns.", by="user:ana")
    W.approve_definition(connection_id=conn, term="GMV", by="user:ana")
    W.write_definition(connection_id=conn, term="gmv", text="Gross merchandise value, net of cancellations.", by="user:cai")
    now = C.latest(W.definition_key(conn, "GMV"))
    assert now.tier == "declared" and now.owner == "user:ana"                      # the owner stays the owner
    assert [v.statement.text for v in C.versions(now.key)][-1] == "Gross merchandise value, before returns."


def test_a_definition_is_a_term_the_planner_is_shown_at_a_persons_warrant():
    conn = _conn()
    W.write_definition(connection_id=conn, term="Active customer", text="Bought in the last 90 days.", by="user:ana")
    defs = B.load_record_definitions(conn)
    assert [d["term"] for d in defs] == ["Active customer"]
    cg = ContextGraph(org_id="o", connection_id=conn)
    _project_definitions(cg, defs)
    (node,) = cg.nodes_of("glossary_term")
    assert node.id == f"{DEFINITION_NODE_PREFIX}active-customer" and node.summary == "Bought in the last 90 days."
    assert warrant_for(node.provenance, node_data=node.data).warrant == "human"


def test_the_doors_write_read_and_approve(monkeypatch):
    from pramanyx.routers import record as R
    conn = _conn()
    monkeypatch.setattr(R, "_visible", lambda c: True)
    monkeypatch.setattr(R, "_who", lambda principal: "user:ana")
    monkeypatch.setattr(R, "_refresh_definitions", lambda c: None)
    app = FastAPI()
    app.include_router(R.router)
    client = TestClient(app)
    wrote = client.post("/record/definitions", json={"connection_id": conn, "term": "Churned", "text": "No order in 180 days."})
    assert wrote.status_code == 201 and wrote.json()["tier"] == "declared"
    assert client.get("/record/definitions", params={"connection_id": conn, "term": "churned"}).json()[0]["term"] == "Churned"
    assert client.get("/record/definitions", params={"connection_id": conn, "term": "nothing"}).json() == []
    monkeypatch.setattr(R, "_who", lambda principal: "user:ben")
    refused = client.post("/record/definitions/approve", json={"connection_id": conn, "term": "Churned"})
    assert refused.status_code == 403 and "user:ana" in refused.json()["detail"]
    monkeypatch.setattr(R, "_who", lambda principal: "user:ana")
    ok = client.post("/record/definitions/approve", json={"connection_id": conn, "term": "Churned"})
    assert ok.status_code == 200 and ok.json()["approved_by"] == "user:ana"
    assert client.post("/record/definitions/approve", json={"connection_id": conn, "term": "Unknown"}).status_code == 404


@pytest.mark.parametrize("missing", ["term", "text", "by"])
def test_a_definition_names_its_word_says_what_it_means_and_is_a_persons(missing):
    args = {"connection_id": _conn(), "term": "x", "text": "y", "by": "user:ana", missing: ""}
    with pytest.raises(ValueError):
        W.write_definition(**args)


# ── the Semantic Layer's knowledge and Definitions are one ───────────────────────────────────────────────────

def test_a_semantic_layer_entry_is_a_definition_and_a_definition_is_an_entry():
    from pramanyx.semantic import connection_kb as KB
    conn = _conn()
    KB.upsert_entry(conn, KB.KnowledgeEntry(id="", title="MRR", body="Sum of active monthly subscriptions.",
                                            kind="metric", tags=["monthly recurring revenue"]))
    c = C.latest(W.definition_key(conn, "MRR"))
    assert c.kind == "definition" and c.tier == "declared" and c.extra["kb_kind"] == "metric"
    assert c.extra["aliases"] == ["monthly recurring revenue"]
    W.write_definition(connection_id=conn, term="Churned", text="No order in 180 days.", by="user:ana")
    assert sorted(e.title for e in KB.load_entries(conn)) == ["Churned", "MRR"]


def test_removing_an_entry_withdraws_its_definition_and_keeps_the_wording():
    from pramanyx.semantic import connection_kb as KB
    conn = _conn()
    entry = KB.upsert_entry(conn, KB.KnowledgeEntry(id="", title="GMV", body="Gross merchandise value."))
    assert KB.delete_entry(conn, entry.id) is True
    assert KB.load_entries(conn) == []
    now = C.latest(W.definition_key(conn, "GMV"))
    assert now.state == "withdrawn" and [v.statement.text for v in C.versions(now.key)][-1] == "Gross merchandise value."


def test_a_renamed_entry_withdraws_the_old_word():
    from pramanyx.semantic import connection_kb as KB
    conn = _conn()
    e = KB.upsert_entry(conn, KB.KnowledgeEntry(id="e1", title="Revenue", body="Net of returns."))
    KB.upsert_entry(conn, KB.KnowledgeEntry(id=e.id, title="Net revenue", body="Net of returns."))
    assert [x.title for x in KB.load_entries(conn)] == ["Net revenue"]
    assert C.latest(W.definition_key(conn, "Revenue")).state == "withdrawn"


def test_an_old_knowledge_file_is_folded_in_once_and_kept_beside(tmp_path, monkeypatch):
    import json as _json

    from pramanyx.semantic import connection_kb as KB
    conn = _conn()
    monkeypatch.setattr(KB, "_DATA_DIR", tmp_path)
    (tmp_path / f"knowledge_{conn}.json").write_text(_json.dumps(
        [{"id": "aov", "title": "AOV", "body": "GMV over orders.", "kind": "metric", "tags": ["basket"]}]))
    assert [(e.id, e.title, e.kind) for e in KB.load_entries(conn)] == [("aov", "AOV", "metric")]
    assert (tmp_path / f"knowledge_{conn}.json.folded").exists() and not (tmp_path / f"knowledge_{conn}.json").exists()
    c = C.latest(W.definition_key(conn, "AOV"))
    assert c.tier == "said" and c.author_kind == "system"                          # no person declared it here
    assert B.load_record_definitions(conn) == []                                    # so the planner is not shown it
