"""Who may read a document — carried from its source, and asked of every read.

A Confluence page can be restricted to a few people; a Notion page is shared with whom its owner chose. Until
2026-11-14 neither connector asked: every page an integration could see was indexed for the whole organisation, and
retrieval, the Documents list, the chat's search and the by-id doors all handed it to anyone in it. The gap is closed
at the cause — what a page's source says is recorded on its registry row when it is synced (``access``), and the one
scope check every read path already passes (`knowledge.indexer.in_scope`, and the by-id door guard) asks it.

An ``access`` record::

    {"sharing": "org" | "chosen",
     "shared_with": [{"kind": "person" | "group", "id": "<email or user id | group id>"}],
     "why": "<the sentence a reader is told>",
     "source": "confluence-restrictions" | "notion-connector" | "source-audience" | "upload"}

* ``org`` — everyone in the document's organisation may read it (an upload, today, and a source its admin opened).
* ``chosen`` — only the people and groups listed. Fails CLOSED: what could not be read or matched is not a reader.

With identity off (``PRAMANYX_REQUIRE_IDENTITY`` unset) one person owns the install and every check passes, so a
single-user install reads exactly what it read before. With identity on, a request that names no person (a scheduled
run, a service principal, the MCP default) reads only what is shared with the whole organisation.
"""
from __future__ import annotations

from typing import Optional

from pramanyx.connectors.knowledge.readers import CHOSEN, ORG, chosen, org_wide, source_audience  # noqa: F401 — re-exported

#: Document ids a knowledge connector writes (`connectors/knowledge/*`): `<kind>_<connection>_<page>`.
_CONNECTOR_PREFIXES = ("confluence_", "notion_")


def is_connector_document(doc_id: str) -> bool:
    return str(doc_id or "").startswith(_CONNECTOR_PREFIXES)


def access_of(entry: dict) -> dict:
    """The access a registry row carries. A row without one is the organisation's (an upload, a schema doc) —
    except a connector page synced before access was recorded, which no one but a single-user install may read
    until its source is synced again: it was never asked who may read it."""
    access = entry.get("access")
    if isinstance(access, dict) and access.get("sharing") in (ORG, CHOSEN):
        return access
    if is_connector_document(entry.get("doc_id", "")):
        return chosen([], [], "synced before its source's permissions were recorded; sync the source again",
                      "unrecorded")
    return org_wide("the organisation's", "upload")


def _reader_groups(reader: str) -> set[str]:
    try:
        from pramanyx.metastore.models import user_principal
        from pramanyx.org.context import current_org_id
        from pramanyx.rbac.groups import groups_of
        return {g.lower() for g in groups_of(current_org_id(), user_principal(reader))}
    except Exception as exc:  # noqa: BLE001 — a reader whose groups cannot be read is a reader with none
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "a reader's groups could not be read; they read as a member of none",
                 counter="documents.access.groups")
        return set()


def may_read(entry: dict, reader: Optional[str] = None) -> bool:
    """May the asking person read this document? ``reader`` defaults to the request's person."""
    from pramanyx.security.authz import require_identity_enabled
    if not require_identity_enabled():
        return True
    access = access_of(entry)
    if access["sharing"] == ORG:
        return True
    if reader is None:
        from pramanyx.org.context import current_user_id
        reader = current_user_id()
    who = str(reader or "").strip().lower()
    if not who:
        return False
    listed = access.get("shared_with") or []
    if any(s.get("kind") == "person" and str(s.get("id", "")).strip().lower() == who for s in listed):
        return True
    groups = {str(s.get("id", "")).strip().lower() for s in listed if s.get("kind") == "group"}
    return bool(groups) and bool(groups & _reader_groups(who))


def refusal(entry: dict) -> str:
    """What a reader who may not read a document is told — the source's rule, never the content."""
    return f"This document is not shared with you: {access_of(entry).get('why') or 'its source restricts it'}."
