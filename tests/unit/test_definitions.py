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
    approved = C.get(W.approve_definition(connection_id=conn, term="active customer", by="user:ben"))
    assert approved.tier == "approved" and approved.statement.text == "Bought in the last 90 days."
    assert approved.extra["approved_by"] == "user:ben" and approved.warrants[-1].kind == "attestation"
    assert W.approve_definition(connection_id=conn, term="Active  Customer!", by="user:ben") is None   # already


def test_a_new_wording_waits_for_approval_again_and_the_earlier_is_kept():
    conn = _conn()
    W.write_definition(connection_id=conn, term="GMV", text="Gross merchandise value, before returns.", by="user:ana")
    W.approve_definition(connection_id=conn, term="GMV", by="user:ben")
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
    ok = client.post("/record/definitions/approve", json={"connection_id": conn, "term": "Churned"})
    assert ok.status_code == 200 and ok.json()["approved_by"] == "user:ana"
    assert client.post("/record/definitions/approve", json={"connection_id": conn, "term": "Unknown"}).status_code == 404


@pytest.mark.parametrize("missing", ["term", "text", "by"])
def test_a_definition_names_its_word_says_what_it_means_and_is_a_persons(missing):
    args = {"connection_id": _conn(), "term": "x", "text": "y", "by": "user:ana", missing: ""}
    with pytest.raises(ValueError):
        W.write_definition(**args)
