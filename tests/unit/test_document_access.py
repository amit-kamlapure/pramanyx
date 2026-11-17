"""The Confluence and Notion permission gap, closed at the cause.

Measured 2026-11-14 by reading: neither connector asked its source who may read a page, and the document registry held
no reader at all, so with sign-in on every page an integration could see was handed to everyone in the organisation —
by retrieval, the Documents list, the chat's search and the by-id doors. Now each page carries who may read it as its
source says (`knowledge/access.py`), and the one scope check every read path passes asks it.

Hermetic like `test_documents_stay_in_scope.py`: the vector store, the embedder and the connection registry are stubbed
at their seams, the registry rides a temp `PRAMANYX_DOCUMENTS_REGISTRY`, and nothing reaches Confluence or Notion.
"""
from __future__ import annotations

import json

import pytest

import pramanyx.knowledge.indexer as idx
from pramanyx.connectors.knowledge.confluence import ConfluenceSync
from pramanyx.connectors.knowledge.notion import NotionSync
from pramanyx.knowledge import access as A
from pramanyx.org.context import reset_user_id, set_user_id

ANA, BEN = "ana@example.com", "ben@example.com"


@pytest.fixture()
def identity(monkeypatch):
    """Sign-in on, one organisation; ``as_(who)`` makes the request ``who``'s."""
    monkeypatch.setenv("PRAMANYX_REQUIRE_IDENTITY", "1")
    monkeypatch.setattr("pramanyx.security.authz.tenant_scope", lambda: None)
    groups = {ANA: {"finance"}, BEN: set()}
    monkeypatch.setattr(A, "_reader_groups", lambda who: groups.get(who, set()))
    tokens = []

    def as_(who: str) -> None:
        tokens.append(set_user_id(who))
    yield as_
    for t in reversed(tokens):
        reset_user_id(t)


@pytest.fixture()
def corpus(monkeypatch, tmp_path):
    registry = tmp_path / "documents.json"
    monkeypatch.setenv("PRAMANYX_DOCUMENTS_REGISTRY", str(registry))
    points: list[dict] = []
    monkeypatch.setattr("pramanyx.semantic.vector_store.search",
                        lambda coll, vector, top_k=10, query_filter=None:
                        [{"payload": p, "score": 0.9} for p in points][:top_k])
    monkeypatch.setattr("pramanyx.semantic.embedder.embed_one", lambda q: [0.0] * 8)
    monkeypatch.setattr("pramanyx.db.registry.get_connection_org", lambda conn: "")

    def add(doc_id: str, access: dict | None = None) -> None:
        points.append({"doc_id": doc_id, "text": f"passage of {doc_id}", "filename": doc_id, "title": doc_id,
                       "chunk_index": 0})
        rows = json.loads(registry.read_text()) if registry.exists() else []
        rows.append({"doc_id": doc_id, "filename": doc_id, "title": doc_id, "chunk_count": 1,
                     "uploaded_at": "2026-11-14T00:00:00Z", "org_id": "",
                     **({"access": access} if access else {})})
        registry.write_text(json.dumps(rows))
    return add


def _ids(hits):
    return sorted(h["doc_id"] for h in hits)


# ── reading ───────────────────────────────────────────────────────────────────────────────────────────────

def test_a_restricted_page_is_read_only_by_whom_its_source_lets_read_it(corpus, identity):
    corpus("upload1")                                                                  # the organisation's
    corpus("confluence_c1_p1", A.chosen([ANA], [], "Confluence restricts it", "confluence-restrictions"))
    corpus("confluence_c1_p2", A.chosen([], ["finance"], "Confluence restricts it", "confluence-restrictions"))
    corpus("notion_c2_p3", A.org_wide("opened to the organisation", "source-audience"))
    identity(ANA)
    assert _ids(idx.search_documents("q", top_k=10)) == ["confluence_c1_p1", "confluence_c1_p2", "notion_c2_p3", "upload1"]
    identity(BEN)
    assert _ids(idx.search_documents("q", top_k=10)) == ["notion_c2_p3", "upload1"]


def test_the_words_search_and_the_list_ask_the_same(corpus, identity, monkeypatch):
    corpus("confluence_c1_p1", A.chosen([ANA], [], "restricted", "confluence-restrictions"))
    corpus("upload1")
    identity(BEN)
    rows = json.loads(open(idx._registry_path()).read())
    assert [r["doc_id"] for r in rows if idx.in_scope(r)] == ["upload1"]          # the Documents list's filter
    monkeypatch.setattr("pramanyx.semantic.embedder.embed_one", lambda q: (_ for _ in ()).throw(RuntimeError("down")))
    monkeypatch.setattr("pramanyx.semantic.vector_store.scroll_points",
                        lambda coll, limit=0, strict=False: [{"payload": {"doc_id": d, "text": "q passage", "title": d}}
                                                             for d in ("confluence_c1_p1", "upload1")])
    assert _ids(idx.search_documents("q passage")) == ["upload1"]


def test_a_request_that_names_no_person_reads_only_what_is_the_organisations(corpus, identity):
    corpus("confluence_c1_p1", A.chosen([ANA], [], "restricted", "confluence-restrictions"))
    corpus("upload1")
    assert _ids(idx.search_documents("q")) == ["upload1"]                           # a scheduled run, an MCP default


def test_a_connector_page_synced_before_permissions_were_recorded_is_withheld_until_synced_again(corpus, identity):
    corpus("notion_c2_old")                                                          # no access on its row
    identity(ANA)
    assert idx.search_documents("q") == []
    assert "sync the source again" in A.refusal({"doc_id": "notion_c2_old"})


def test_with_sign_in_off_one_person_owns_the_install_and_reads_everything(corpus, monkeypatch):
    monkeypatch.delenv("PRAMANYX_REQUIRE_IDENTITY", raising=False)
    monkeypatch.setattr("pramanyx.security.authz.tenant_scope", lambda: None)
    corpus("confluence_c1_p1", A.chosen([ANA], [], "restricted", "confluence-restrictions"))
    corpus("notion_c2_old")
    assert _ids(idx.search_documents("q")) == ["confluence_c1_p1", "notion_c2_old"]


def test_a_reindex_that_is_not_told_who_may_read_keeps_what_it_was(corpus):
    corpus("confluence_c1_p1", A.chosen([ANA], [], "restricted", "confluence-restrictions"))
    idx._register("confluence_c1_p1", "f", "t", 1, "2026-11-14T00:00:00Z")
    assert idx.get_document("confluence_c1_p1")["access"]["shared_with"] == [{"kind": "person", "id": ANA}]


# ── what the sources say ──────────────────────────────────────────────────────────────────────────────────

def _confluence(meta: dict | None = None) -> ConfluenceSync:
    return ConfluenceSync("c1", {"base_url": "https://wiki.example", "username": "u", "api_token": "t",
                                 "connected_by": BEN, **(meta or {})})


def _restricted(users=(), groups=()):
    return {"restrictions": {"read": {"restrictions": {
        "user": {"results": [{"email": e} if e else {"displayName": "no email"} for e in users]},
        "group": {"results": [{"name": g} for g in groups]}}}}}


def test_a_confluence_page_carries_its_read_restriction():
    got = _confluence()._access_of({"id": "1", **_restricted([ANA.upper()], ["finance"])})
    assert got["sharing"] == A.CHOSEN
    assert {(s["kind"], s["id"]) for s in got["shared_with"]} == {("person", ANA), ("group", "finance")}


def test_a_restriction_on_a_page_above_holds_for_the_page_under_it(monkeypatch):
    sync = _confluence()
    monkeypatch.setattr(sync, "_ancestor_restriction", lambda aid: ("ok", ({ANA}, set(), 0)))
    got = sync._access_of({"id": "2", "ancestors": [{"id": "1"}], **_restricted([ANA, BEN])})
    assert [s["id"] for s in got["shared_with"]] == [ANA]                           # readers at EVERY level


def test_an_unreadable_page_above_or_unmatched_readers_leave_it_to_the_person_who_connected_the_source(monkeypatch):
    sync = _confluence()
    monkeypatch.setattr(sync, "_ancestor_restriction", lambda aid: ("unread", "403"))
    assert sync._access_of({"id": "2", "ancestors": [{"id": "1"}]})["shared_with"] == [{"kind": "person", "id": BEN}]
    got = _confluence()._access_of({"id": "3", **_restricted([""])})                 # a reader with no email
    assert got["shared_with"] == [{"kind": "person", "id": BEN}] and "none of its readers" in got["why"]


def test_an_unrestricted_page_is_read_by_the_audience_the_source_was_given():
    assert _confluence()._access_of({"id": "4"})["shared_with"] == [{"kind": "person", "id": BEN}]
    assert _confluence({"audience": "org"})._access_of({"id": "4"})["sharing"] == A.ORG
    got = _confluence({"audience": "finance, ops"})._access_of({"id": "4"})
    assert {s["id"] for s in got["shared_with"]} == {BEN, "finance", "ops"}


def test_a_notion_page_is_read_by_whom_the_person_who_connected_it_chose():
    sync = NotionSync("c2", {"integration_token": "t", "connected_by": BEN})
    assert sync._access["shared_with"] == [{"kind": "person", "id": BEN}]
    assert "Notion does not say" in sync._access["why"]
    assert NotionSync("c2", {"integration_token": "t", "audience": "org"})._access["sharing"] == A.ORG


# ── the doors ─────────────────────────────────────────────────────────────────────────────────────────────

def test_a_by_id_door_refuses_a_page_not_shared_with_the_reader_and_says_why(corpus, identity, monkeypatch):
    from fastapi import HTTPException
    from pramanyx.routers import knowledge as K
    corpus("confluence_c1_p1", A.chosen([ANA], [], "Confluence restricts who may read the page",
                                        "confluence-restrictions"))
    monkeypatch.setattr("pramanyx.security.authz.check_owner", lambda *a, **k: None)
    monkeypatch.setattr("pramanyx.security.authz.get_principal", lambda request: None)
    request = type("R", (), {"path_params": {"doc_id": "confluence_c1_p1"}})()
    identity(BEN)
    with pytest.raises(HTTPException) as refused:
        K._document_owner_guard(request)
    assert refused.value.status_code == 403 and "Confluence restricts" in refused.value.detail
    identity(ANA)
    K._document_owner_guard(request)                                                 # ana opens it


# ── an upload is its uploader's, private until they share it (the user, 2026-11-17) ─────────────────────────────

def test_an_upload_is_read_only_by_its_uploader_until_they_share_it(corpus, identity):
    corpus("upload-ana", A.upload_access(ANA))
    corpus("upload-old")                                       # uploaded before: the organisation's, as it was
    identity(ANA)
    assert _ids(idx.search_documents("q", top_k=10)) == ["upload-ana", "upload-old"]
    identity(BEN)
    assert _ids(idx.search_documents("q", top_k=10)) == ["upload-old"]
    assert A.upload_access(ANA)["owner"] == ANA and "private to them until they share it" in A.upload_access(ANA)["why"]
    assert A.upload_access("")["sharing"] == A.ORG                # nobody named: the organisation's, and said


def test_only_its_owner_shares_an_upload_and_never_through_an_agent(corpus, identity, monkeypatch):
    from types import SimpleNamespace

    from fastapi import HTTPException

    from pramanyx.mcp.client import AGENT_HEADER, AGENT_MARK
    from pramanyx.routers import knowledge as K
    corpus("upload-ana", A.upload_access(ANA))
    plain = SimpleNamespace(headers={}, state=SimpleNamespace(principal=None))
    identity(BEN)
    with pytest.raises(HTTPException) as e:
        K.share_document("upload-ana", K.DocumentSharing(sharing="org"), request=plain)
    assert e.value.status_code == 403 and ANA in e.value.detail
    identity(ANA)
    agent = SimpleNamespace(headers={AGENT_HEADER: AGENT_MARK}, state=SimpleNamespace(principal=None))
    with pytest.raises(HTTPException) as e:
        K.share_document("upload-ana", K.DocumentSharing(sharing="org"), request=agent)
    assert e.value.status_code == 403 and "owner's own choice" in e.value.detail
    out = K.share_document("upload-ana", K.DocumentSharing(sharing="chosen", people=[BEN]), request=plain)
    assert {s["id"] for s in out["access"]["shared_with"]} == {ANA, BEN} and out["access"]["owner"] == ANA
    identity(BEN)
    assert _ids(idx.search_documents("q", top_k=10)) == ["upload-ana"]
    with pytest.raises(HTTPException):
        K.share_document("nothing", K.DocumentSharing(sharing="org"), request=plain)


def test_the_upload_door_stamps_its_uploader(monkeypatch, identity):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from pramanyx.routers import knowledge as K
    seen: dict = {}

    def index_text(**kw):
        seen.update(kw)
        return {"doc_id": "d1", "title": kw["title"], "chunk_count": 1}
    monkeypatch.setattr("pramanyx.knowledge.indexer.index_text", index_text)
    for name in ("put_original", "put_markdown"):
        monkeypatch.setattr(f"pramanyx.knowledge.blobs.{name}", lambda *a, **k: None)
    monkeypatch.setattr("pramanyx.knowledge.blobs.info", lambda doc_id: {})
    identity(ANA)
    app = FastAPI()
    app.include_router(K.router)
    r = TestClient(app).post("/documents/upload", files={"file": ("plan.md", b"# Plan\n\n" + b"The plan for next year. " * 10, "text/markdown")})
    assert r.status_code == 201, r.text
    assert seen["access"]["owner"] == ANA and [s["id"] for s in seen["access"]["shared_with"]] == [ANA]
