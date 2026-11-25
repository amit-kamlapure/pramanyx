"""An uploaded document can say which connection it is about (2026-11-25). Seen live on the first answer A1 recorded:
the "Superstore Metrics Handbook" — "DuckDB, schema `main`, table `main.superstore`" — was handed to a theLook question
on repeat buyers, its Repeat Customer Rate over Superstore's columns the closest passage by meaning. A schema doc was
already kept to its connection; an upload had no way to say. Its owner says, else an admin; never an agent.

Hermetic like `test_document_access.py`, whose fixtures it borrows.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import pramanyx.knowledge.indexer as idx
from pramanyx.knowledge import access as A
from tests.unit.test_document_access import ANA, BEN, _ids, corpus, identity  # noqa: F401 — fixtures

PLAIN = SimpleNamespace(headers={}, state=SimpleNamespace(principal=None))


@pytest.fixture()
def install(monkeypatch):
    monkeypatch.setattr("pramanyx.db.registry.list_connections", lambda: [{"id": "duckdb"}, {"id": "thelook"}])


def test_an_upload_about_one_connection_reaches_its_answers_alone(corpus, monkeypatch):  # noqa: F811
    monkeypatch.delenv("PRAMANYX_REQUIRE_IDENTITY", raising=False)
    monkeypatch.setattr("pramanyx.security.authz.tenant_scope", lambda: None)
    corpus("superstore-handbook")
    corpus("house-style")
    idx.set_document_about("superstore-handbook", "duckdb", by="user:amit")
    assert _ids(idx.search_documents("repeat buyers", connection_id="thelook")) == ["house-style"]
    assert _ids(idx.search_documents("repeat buyers", connection_id="duckdb")) == ["house-style", "superstore-handbook"]
    assert _ids(idx.search_documents("repeat buyers")) == ["house-style", "superstore-handbook"], \
        "a read on no connection — the Documents list — still sees it"
    idx.set_document_about("superstore-handbook", None, by="user:amit")
    assert _ids(idx.search_documents("repeat buyers", connection_id="thelook")) == ["house-style", "superstore-handbook"]


def test_a_reindex_keeps_which_connection_it_is_about(corpus):  # noqa: F811
    corpus("superstore-handbook")
    idx.set_document_about("superstore-handbook", "duckdb", by="user:amit")
    idx._register("superstore-handbook", "f", "t", 1, "2026-11-25T00:00:00Z")
    assert idx.about_connection(idx.get_document("superstore-handbook")) == "duckdb"


def test_its_owner_says_else_an_admin_never_an_agent_nor_for_a_schema_doc(corpus, identity, install, monkeypatch):  # noqa: F811
    from pramanyx.mcp.client import AGENT_HEADER, AGENT_MARK
    from pramanyx.routers import knowledge as K
    corpus("upload-ana", A.upload_access(ANA))
    corpus("org-handbook")
    admin = {"on": False}
    monkeypatch.setattr(K, "_administers", lambda request: admin["on"])
    identity(BEN)
    with pytest.raises(HTTPException) as e:
        K.say_document_about("upload-ana", K.DocumentAbout(connection_id="duckdb"), request=PLAIN)
    assert e.value.status_code == 403 and ANA in e.value.detail
    with pytest.raises(HTTPException) as e:
        K.say_document_about("org-handbook", K.DocumentAbout(connection_id="duckdb"), request=PLAIN)
    assert e.value.status_code == 403 and "only an admin" in e.value.detail
    identity(ANA)
    agent = SimpleNamespace(headers={AGENT_HEADER: AGENT_MARK}, state=SimpleNamespace(principal=None))
    with pytest.raises(HTTPException) as e:
        K.say_document_about("upload-ana", K.DocumentAbout(connection_id="duckdb"), request=agent)
    assert e.value.status_code == 403 and "an agent cannot say it" in e.value.detail
    with pytest.raises(HTTPException) as e:
        K.say_document_about("upload-ana", K.DocumentAbout(connection_id="nowhere"), request=PLAIN)
    assert e.value.status_code == 422
    out = K.say_document_about("upload-ana", K.DocumentAbout(connection_id="duckdb"), request=PLAIN)
    assert out["about"]["connection_id"] == "duckdb" and out["about"]["by"] == ANA
    identity(BEN)
    admin["on"] = True
    assert K.say_document_about("org-handbook", K.DocumentAbout(connection_id="thelook"), request=PLAIN)["about"]["by"] == BEN
    assert K.say_document_about("org-handbook", K.DocumentAbout(connection_id=None), request=PLAIN)["about"] is None
    corpus("doctree::duckdb::main")
    with pytest.raises(HTTPException) as e:
        K.say_document_about("doctree::duckdb::main", K.DocumentAbout(connection_id="thelook"), request=PLAIN)
    assert e.value.status_code == 422


def test_the_list_says_what_each_upload_is_about_and_who_may_say(corpus, identity, monkeypatch):  # noqa: F811
    from pramanyx.knowledge import blobs
    from pramanyx.routers import knowledge as K
    monkeypatch.setattr(blobs, "info", lambda doc_id: {})
    monkeypatch.setattr(K, "_administers", lambda request: False)
    corpus("upload-ana", A.upload_access(ANA))
    idx.set_document_about("upload-ana", "duckdb", by=ANA)
    identity(ANA)
    rows = {r["doc_id"]: r for r in K.list_documents_endpoint()}
    assert rows["upload-ana"]["about"]["connection_id"] == "duckdb" and rows["upload-ana"]["may_say_about"] is True
    identity(BEN)
    assert {r["doc_id"]: r for r in K.list_documents_endpoint()}.get("upload-ana", {}).get("may_say_about") in (None, False)
