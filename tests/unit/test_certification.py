"""Certified and deprecated (the ontology study, Phase 1, 2026-11-17): the organisation vouching for a table, a document
or a dashboard, or warning off it — one governed tag, set by a curator (a document's owner for their own), never an
agent; read by the planner under the table's own name, and by the documents block, which leaves a deprecated document
out and says so. A metric, a trusted query and a Definition keep their own lifecycles."""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx.govern import certification as K


def _conn() -> str:
    return "c" + uuid.uuid4().hex[:8]


def test_a_table_is_certified_or_deprecated_by_a_person_and_a_deprecation_says_why():
    conn = _conn()
    orders = K.securable_for("table", "orders", connection_id=conn, schema="shop")
    assert orders == f"table:{conn}.shop.orders"
    now = K.set_certification(orders, "certified", by="user:ana", why="reconciled with finance")
    assert (now["status"], now["by"], now["why"]) == ("certified", "user:ana", "reconciled with finance")
    with pytest.raises(ValueError, match="says why"):
        K.set_certification(K.securable_for("table", "orders_v1", connection_id=conn), "deprecated", by="user:ana")
    K.set_certification(K.securable_for("table", "orders_v1", connection_id=conn), "deprecated", by="user:ana",
                        why="replaced by orders")
    assert {t: m["status"] for t, m in K.tables_of(conn).items()} == {"orders": "certified", "orders_v1": "deprecated"}
    assert K.set_certification(orders, "", by="user:ana") is None and "orders" not in K.tables_of(conn)
    for bad in (("metric", "gmv"), ("definition", "churn"), ("trusted_query", "t1")):
        with pytest.raises(ValueError, match="their own lifecycle"):
            K.securable_for(*bad, connection_id=conn)
    with pytest.raises(ValueError, match="says who"):
        K.set_certification(orders, "certified", by="")


def test_the_planner_reads_the_mark_under_the_table_and_nothing_is_removed(monkeypatch):
    from pramanyx.agent import schema_annotators as A
    conn = _conn()
    K.set_certification(K.securable_for("table", "orders", connection_id=conn), "certified", by="user:ana")
    K.set_certification(K.securable_for("table", "orders_v1", connection_id=conn), "deprecated", by="user:ana",
                        why="replaced by orders")
    base = "TABLE: shop.orders\n  id INT\nTABLE: shop.orders_v1\n  id INT\nTABLE: shop.items\n  id INT"
    out = A._certification(SimpleNamespace(_connection_id=conn), base)
    lines = out.split("\n")
    assert lines[1] == "  -- CERTIFIED by ana — the organisation vouches for it; prefer it"
    assert lines[4] == "  -- DEPRECATED by ana: replaced by orders — do not use it unless the question names it, and say so if you do"
    assert "TABLE: shop.orders_v1" in out and out.count("TABLE:") == 3                  # still there, marked
    assert A._certification(SimpleNamespace(_connection_id=_conn()), base) == base         # nothing said: byte-identical


def test_a_deprecated_document_is_left_out_of_an_answer_and_a_certified_one_says_so(monkeypatch):
    from pramanyx.knowledge import indexer as idx
    hits = [{"doc_id": "d-old", "chunk_index": 0, "title": "Old pricing", "text": "price list 2019", "filename": "old.pdf"},
            {"doc_id": "d-new", "chunk_index": 0, "title": "Pricing", "text": "price list 2026", "filename": "new.pdf"}]
    monkeypatch.setattr(idx, "search_documents", lambda q, top_k=4, connection_id=None: [dict(h) for h in hits])
    monkeypatch.setattr("pramanyx.custom_agents.context.agent_doc_ids", lambda: None)
    monkeypatch.setattr(idx, "canvas_doc_ids", lambda canvas_id: [])
    monkeypatch.setattr(idx, "matched_by_words", lambda h: "")
    monkeypatch.setattr(idx, "_document_marks", lambda: {"d-old": {"status": "deprecated"}, "d-new": {"status": "certified"}})
    section = idx.build_external_context_section("price list")
    assert "price list 2019" not in section and "price list 2026" in section
    assert "(new.pdf; CERTIFIED by the organisation)" in section
    assert "(1 passage from deprecated documents was left out.)" in section


@pytest.fixture()
def client():
    from pramanyx.routers import governance as G
    app = FastAPI()
    app.include_router(G.router)
    return TestClient(app)


def test_only_a_curator_certifies_and_never_through_an_agent(client, monkeypatch):
    from pramanyx.mcp.client import AGENT_HEADER, AGENT_MARK
    from pramanyx.routers import governance as G
    conn = _conn()
    body = {"kind": "table", "ref": "orders", "connection_id": conn, "status": "certified", "why": "reconciled"}
    agent = client.put("/governance/certification", json=body, headers={AGENT_HEADER: AGENT_MARK})
    assert agent.status_code == 403 and "person's own call" in agent.json()["detail"]
    ok = client.put("/governance/certification", json=body)                 # identity off: the install's owner
    assert ok.status_code == 200 and ok.json()["certification"]["status"] == "certified"
    assert client.get("/governance/certification", params={"kind": "table", "connection_id": conn}).json()["by_ref"]["orders"]["status"] == "certified"
    monkeypatch.setattr("pramanyx.rbac.resolver.has_permission", lambda principal, perm: False)
    refused = client.put("/governance/certification", json={**body, "status": "deprecated", "why": "old"})
    assert refused.status_code == 403 and "curator" in refused.json()["detail"]
    # a document's owner certifies their own
    monkeypatch.setattr("pramanyx.knowledge.indexer.get_document", lambda ref: {"doc_id": ref, "access": {
        "sharing": "chosen", "shared_with": [{"kind": "person", "id": "operator"}], "owner": "operator"}})
    monkeypatch.setattr("pramanyx.security.authz.acting_person", lambda principal: "user:operator")
    mine = client.put("/governance/certification", json={"kind": "document", "ref": "d1", "status": "certified"})
    assert mine.status_code == 200, mine.text
    assert G._curator_or_owner("document", "d1", "user:someone-else", None) is False
    monkeypatch.setattr("pramanyx.rbac.resolver.has_permission", lambda principal, perm: True)
    bad = client.put("/governance/certification", json={"kind": "metric", "ref": "gmv", "status": "certified"})
    assert bad.status_code == 422 and "own lifecycle" in bad.json()["detail"]


def test_a_table_certified_under_its_schema_reads_back_under_it(client):
    """2026-11-23: the table page certified under the table's schema and read the mark back without one, so a certified
    table read as uncertified the next time its page opened."""
    conn = _conn()
    body = {"kind": "table", "ref": "orders", "connection_id": conn, "schema": "thelook", "status": "certified",
            "why": "reconciled"}
    assert client.put("/governance/certification", json=body).status_code == 200
    read = client.get("/governance/certification",
                      params={"kind": "table", "ref": "orders", "connection_id": conn, "schema": "thelook"}).json()
    assert read["certification"]["status"] == "certified"
    assert read["certification"]["securable"] == f"table:{conn}.thelook.orders"
