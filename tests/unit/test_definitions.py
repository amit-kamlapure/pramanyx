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


def test_anyone_else_s_wording_is_a_suggestion_and_the_published_one_stands_until_its_owner_accepts():
    """Until 2026-11-17 a new wording from anyone replaced the owner's approved one at once, unapproved, and the planner
    lost the approved definition. Now it is a suggested edit: the owner accepts or declines it."""
    conn = _conn()
    W.write_definition(connection_id=conn, term="GMV", text="Gross merchandise value, before returns.", by="user:ana")
    W.approve_definition(connection_id=conn, term="GMV", by="user:ana")
    with pytest.raises(W.NotTheOwner, match="suggested edit"):
        W.write_definition(connection_id=conn, term="gmv", text="Gross merchandise value, net of cancellations.", by="user:cai")
    s = W.suggest_definition_edit(connection_id=conn, term="gmv", by="user:cai",
                                  text="Gross merchandise value, net of cancellations.", why="finance nets them")
    now = C.latest(W.definition_key(conn, "GMV"))
    assert (now.tier, now.owner, now.statement.text) == ("approved", "user:ana", "Gross merchandise value, before returns.")
    assert [p["id"] for p in now.extra["suggestions"]] == [s["id"]] and now.extra["suggestions"][0]["by"] == "user:cai"
    with pytest.raises(W.NotTheOwner):
        W.decide_definition_suggestion(connection_id=conn, term="GMV", suggestion_id=s["id"], by="user:cai", accept=True)
    W.decide_definition_suggestion(connection_id=conn, term="GMV", suggestion_id=s["id"], by="user:ana", accept=True)
    now = C.latest(W.definition_key(conn, "GMV"))
    assert (now.tier, now.statement.text) == ("approved", "Gross merchandise value, net of cancellations.")
    assert now.extra["suggestions"] == [] and now.extra["accepted"][0]["by"] == "user:cai"
    assert "Gross merchandise value, before returns." in [v.statement.text for v in C.versions(now.key)]   # kept
    # declined: kept beside it, the wording unchanged
    s2 = W.suggest_definition_edit(connection_id=conn, term="GMV", by="user:cai", aliases=["gross sales"])
    W.decide_definition_suggestion(connection_id=conn, term="GMV", suggestion_id=s2["id"], by="user:ana", accept=False,
                                   why="not what finance calls it")
    now = C.latest(W.definition_key(conn, "GMV"))
    assert now.extra["aliases"] == [] and now.extra["declined"][0]["declined_why"] == "not what finance calls it"


def test_its_owner_edits_it_directly_and_a_published_one_stays_published():
    conn = _conn()
    W.write_definition(connection_id=conn, term="Churn", text="No order in 180 days.", by="user:ana")
    assert C.latest(W.definition_key(conn, "Churn")).tier == "declared"                  # a draft
    W.approve_definition(connection_id=conn, term="Churn", by="user:ana")
    W.write_definition(connection_id=conn, term="Churn", text="No order in 120 days.", by="user:ana",
                       aliases=["lapsed"], links=[{"kind": "metric", "ref": "churn_rate", "label": "Churn rate"}])
    now = C.latest(W.definition_key(conn, "Churn"))
    assert (now.tier, now.statement.text, now.extra["aliases"]) == ("approved", "No order in 120 days.", ["lapsed"])
    assert now.extra["links"] == [{"kind": "metric", "ref": "churn_rate", "label": "Churn rate"}]
    W.unpublish_definition(connection_id=conn, term="Churn", by="user:ana")
    assert C.latest(W.definition_key(conn, "Churn")).tier == "declared"
    with pytest.raises(ValueError, match="links to a"):
        W.write_definition(connection_id=conn, term="Churn", text="x", by="user:ana", links=[{"kind": "spaceship", "ref": "x"}])


def test_one_word_can_mean_one_thing_in_one_area_and_another_in_the_next():
    conn = _conn()
    W.write_definition(connection_id=conn, term="Active customer", area="Finance", text="Paid in the last 30 days.", by="user:ana")
    W.write_definition(connection_id=conn, term="Active customer", area="Marketing", text="Opened an email in 90 days.", by="user:bo")
    both = W.definitions_of(conn, "active customer")
    assert sorted((c.extra["area"], c.owner) for c in both) == [("Finance", "user:ana"), ("Marketing", "user:bo")]
    assert W.definition_key(conn, "Active customer", "Finance") != W.definition_key(conn, "Active customer", "Marketing")
    assert W.definition_key(conn, "GMV") == W.definition_key(conn, "GMV", "")             # no area: the key it always had


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


def test_the_doors_file_anyone_else_s_change_as_a_suggestion_and_refuse_an_agent(monkeypatch):
    from pramanyx.mcp.client import AGENT_HEADER, AGENT_MARK
    from pramanyx.routers import record as R
    conn = _conn()
    monkeypatch.setattr(R, "_visible", lambda c: True)
    monkeypatch.setattr(R, "_refresh_definitions", lambda c: None)
    monkeypatch.setattr("pramanyx.semantic.areas.areas_for", lambda c, schema=None, workspace_id=None: [{"id": "Finance"}])
    app = FastAPI()
    app.include_router(R.router)
    client = TestClient(app)
    monkeypatch.setattr(R, "_who", lambda principal: "user:ana")
    assert client.post("/record/definitions", json={"connection_id": conn, "term": "x", "text": "y", "area": "Nowhere"}).status_code == 422
    body = {"connection_id": conn, "term": "Active customer", "area": "Finance", "text": "Paid in 30 days.",
            "aliases": ["paying customer"], "links": [{"kind": "metric", "ref": "active_customers", "label": "Active customers"}]}
    wrote = client.post("/record/definitions", json=body).json()
    assert (wrote["state"], wrote["area"], wrote["owner"], wrote["suggested"]) == ("draft", "Finance", "user:ana", None)
    assert client.post("/record/definitions/approve", json={"connection_id": conn, "term": "Active customer", "area": "Finance"}).json()["state"] == "published"
    monkeypatch.setattr(R, "_who", lambda principal: "user:cai")
    theirs = client.post("/record/definitions", json={**body, "text": "Paid in 60 days.", "why": "quarterly payers"}).json()
    assert theirs["statement"]["text"] == "Paid in 30 days." and theirs["state"] == "published"        # it stands
    assert theirs["suggested"]["by"] == "user:cai" and theirs["suggestions"][0]["why"] == "quarterly payers"
    monkeypatch.setattr(R, "_who", lambda principal: "user:ana")
    agent = client.post("/record/definitions/unpublish", json={"connection_id": conn, "term": "Active customer", "area": "Finance"},
                        headers={AGENT_HEADER: AGENT_MARK})
    assert agent.status_code == 403 and "person's own act" in agent.json()["detail"]
    decided = client.post("/record/definitions/suggestions/decide", json={"connection_id": conn, "term": "Active customer",
                          "area": "Finance", "suggestion_id": theirs["suggested"]["id"], "accept": True}).json()
    assert decided["statement"]["text"] == "Paid in 60 days." and decided["state"] == "published" and decided["suggestions"] == []
    listed = client.get("/record/definitions", params={"connection_id": conn, "term": "active customer"}).json()
    assert [d["area"] for d in listed] == ["Finance"]


def test_the_coworker_drafts_for_a_person_and_never_writes_their_word(monkeypatch):
    """2026-11-17: "remember that active means paid in 30 days" — a draft only said, owned by the person it was drafted
    for, used by no answer until they publish it; a word already defined becomes a suggested edit marked as the agent's.
    The one definition door an agent may use."""
    from pramanyx.mcp.client import AGENT_HEADER, AGENT_MARK
    from pramanyx.routers import record as R
    conn = _conn()
    monkeypatch.setattr(R, "_visible", lambda c: True)
    monkeypatch.setattr(R, "_refresh_definitions", lambda c: None)
    monkeypatch.setattr(R, "_who", lambda principal: "user:ana")
    app = FastAPI()
    app.include_router(R.router)
    client = TestClient(app)
    agent = {AGENT_HEADER: AGENT_MARK}
    made = client.post("/record/definitions/draft", json={"connection_id": conn, "term": "Active", "text": "Paid in 30 days."},
                       headers=agent).json()
    assert (made["made"], made["state"], made["owner"], made["tier"], made["drafted_by_agent"]) == (
        "draft", "draft", "user:ana", "said", True)
    assert made["author"] == "agent:coworker" and made["publish_at"] == f"/definitions/Active?conn={conn}"
    # the agent still cannot publish it, nor write a person's draft
    assert client.post("/record/definitions/approve", json={"connection_id": conn, "term": "Active"}, headers=agent).status_code == 403
    assert client.post("/record/definitions", json={"connection_id": conn, "term": "Other", "text": "x"}, headers=agent).status_code == 403
    # the person publishes it: their word now
    published = client.post("/record/definitions/approve", json={"connection_id": conn, "term": "Active"}).json()
    assert (published["state"], published["tier"], published["drafted_by_agent"]) == ("published", "approved", False)
    again = client.post("/record/definitions/draft", json={"connection_id": conn, "term": "Active", "text": "Paid in 60 days.",
                                                          "why": "quarterly payers"}, headers=agent).json()
    assert again["made"] == "suggestion" and again["statement"]["text"] == "Paid in 30 days."           # it stands
    assert again["suggestions"][0]["by_agent"] is True and again["suggestions"][0]["by"] == "user:ana"
    monkeypatch.setattr(R, "_who", lambda principal: "")
    assert client.post("/record/definitions/draft", json={"connection_id": conn, "term": "X", "text": "y"},
                       headers=agent).status_code == 422


# ── the Page (2026-11-23, Databricks' Page editor): a description, sources, and related assets of any kind ──────────


def test_a_definition_carries_its_description_sources_and_related_assets_of_any_kind_and_keeps_them():
    conn = _conn()
    W.write_definition(connection_id=conn, term="Repeat buyer", text="## Definition\nOrdered twice or more.", by="user:ana",
                       description="  A customer   who comes back.  ",
                       sources=[{"kind": "url", "ref": "https://wiki.example/repeat", "label": "Finance wiki"},
                                {"kind": "document", "ref": "doc123", "label": "KPI handbook"}],
                       links=[{"kind": "canvas", "ref": "d52cdcd4", "label": "The Look Analytics",
                               "href": "/?tab=canvas-workspace&canvas=d52cdcd4"},
                              {"kind": "metric", "ref": "repeat_purchase_rate", "href": "javascript:alert(1)"}])
    c = C.latest(W.definition_key(conn, "Repeat buyer"))
    assert c.extra["description"] == "A customer who comes back."
    assert [s["kind"] for s in c.extra["sources"]] == ["url", "document"]
    assert c.extra["links"][0] == {"kind": "canvas", "ref": "d52cdcd4", "label": "The Look Analytics",
                                   "href": "/?tab=canvas-workspace&canvas=d52cdcd4"}
    assert "href" not in c.extra["links"][1]                     # only the app's own address is kept as one
    W.write_definition(connection_id=conn, term="Repeat buyer", text="Ordered twice or more, in a year.", by="user:ana")
    c = C.latest(W.definition_key(conn, "Repeat buyer"))
    assert c.extra["description"] == "A customer who comes back." and len(c.extra["sources"]) == 2   # kept when not sent


@pytest.mark.parametrize("bad", [{"kind": "file", "ref": "x"}, {"kind": "url", "ref": "ftp://x"}])
def test_a_source_is_a_web_address_or_a_document(bad):
    with pytest.raises(ValueError):
        W.write_definition(connection_id=_conn(), term="X", text="y", by="user:ana", sources=[bad])


def test_a_suggested_description_and_sources_reach_the_definition_when_its_owner_accepts():
    conn = _conn()
    W.write_definition(connection_id=conn, term="AOV", text="Revenue over orders.", by="user:ana")
    s = W.suggest_definition_edit(connection_id=conn, term="AOV", by="user:cai", description="Average order value",
                                  sources=[{"kind": "url", "ref": "https://wiki.example/aov"}])
    assert C.latest(W.definition_key(conn, "AOV")).extra.get("description", "") == ""        # stands until accepted
    W.decide_definition_suggestion(connection_id=conn, term="AOV", suggestion_id=s["id"], by="user:ana", accept=True)
    now = C.latest(W.definition_key(conn, "AOV"))
    assert now.extra["description"] == "Average order value" and now.extra["sources"][0]["ref"] == "https://wiki.example/aov"


def test_the_door_writes_and_reads_the_page_s_fields(monkeypatch):
    from pramanyx.routers import record as R
    conn = _conn()
    monkeypatch.setattr(R, "_visible", lambda c: True)
    monkeypatch.setattr(R, "_who", lambda principal: "user:ana")
    monkeypatch.setattr(R, "_refresh_definitions", lambda c: None)
    app = FastAPI()
    app.include_router(R.router)
    client = TestClient(app)
    wrote = client.post("/record/definitions", json={
        "connection_id": conn, "term": "Late delivery", "text": "Delivered after its promise.",
        "description": "When an order arrives after the date it was promised",
        "sources": [{"kind": "url", "ref": "https://ops.example/sla", "label": "SLA"}],
        "links": [{"kind": "schedule", "ref": "a1", "label": "Dispatch promise watch",
                   "href": "/?tab=agentic-ops&layer=automations&automation=a1"}]})
    assert wrote.status_code == 201
    got = client.get("/record/definitions", params={"connection_id": conn, "term": "late delivery"}).json()[0]
    assert got["description"].startswith("When an order arrives")
    assert got["sources"][0]["label"] == "SLA" and got["links"][0]["kind"] == "schedule"
    refused = client.post("/record/definitions", json={"connection_id": conn, "term": "Y", "text": "z",
                                                      "sources": [{"kind": "url", "ref": "not an address"}]})
    assert refused.status_code == 422
