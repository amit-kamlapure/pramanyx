"""Certified and deprecated — the organisation vouching for an asset, or warning off it (the ontology study, Phase 1,
2026-11-17).

One governed tag, ``certification`` = ``certified`` | ``deprecated``, on the assets that carry no lifecycle of their
own: a TABLE, a DOCUMENT, a DASHBOARD. A metric and a trusted query are approved or deprecated through their own
lifecycle and a Definition published by its owner, so none takes a second word for the same thing. Why it was certified or
deprecated rides beside it (``certification_why``), with who set it and when — a tag records its author, and a model
never authors one (`govern/tag_store.py`).

What it changes: the planner reads a certified table as one the organisation vouches for and a deprecated one as not
to be used unless the question names it (`agent/schema_annotators.py`); a deprecated document is never handed to an
answer, and a certified one says so (`knowledge/indexer.py`); the app shows the mark wherever the asset is listed. Nothing is hidden by it: a
deprecated table is still in the schema, said to be deprecated. That is a curator's call, not a filter.
"""
from __future__ import annotations

from typing import Optional

from pramanyx.metastore.models import artifact_securable, table_securable

KEY = "certification"
WHY_KEY = "certification_why"
STATUSES = ("certified", "deprecated")
#: The assets this word is said of, and how each is named as a securable.
KINDS = ("table", "document", "dashboard")


def securable_for(kind: str, ref: str, *, connection_id: str = "", schema: str = "") -> str:
    """The securable an asset is: ``table:<connection>.<schema>.<table>`` or ``artifact:<kind>:<id>``."""
    kind = (kind or "").strip().lower()
    if kind not in KINDS:
        raise ValueError(f"certification is said of a {', '.join(KINDS)}; a metric, a trusted query and a definition "
                         "have their own lifecycle")
    if not ref:
        raise ValueError("certification names the asset it is said of")
    if kind == "table":
        if not connection_id:
            raise ValueError("a table is named with its connection")
        return table_securable(connection_id, schema or "", ref.split(".")[-1])
    return artifact_securable(kind, ref)


def set_certification(securable: str, status: str, *, by: str, why: str = "",
                      org_id: Optional[str] = None) -> Optional[dict]:
    """Certify or deprecate an asset (``status`` ``""`` clears it). ``by`` is the person — a curator or the asset's
    owner, decided by the door. Returns what now stands, or None when it was cleared."""
    from pramanyx.govern.tag_store import clear_tag, set_tag
    status = (status or "").strip().lower()
    if not (by or "").strip():
        raise ValueError("a certification says who set it")
    if status and status not in STATUSES:
        raise ValueError(f"an asset is {' or '.join(STATUSES)}, or neither")
    if status == "deprecated" and not (why or "").strip():
        raise ValueError("a deprecation says why — the reader is told, and told what to use instead")
    if not status:
        clear_tag(securable, KEY, cleared_by=by, org_id=org_id)
        clear_tag(securable, WHY_KEY, cleared_by=by, org_id=org_id)
        return None
    set_tag(securable, KEY, status, set_by=by, org_id=org_id)
    if (why or "").strip():
        set_tag(securable, WHY_KEY, why.strip()[:400], set_by=by, org_id=org_id)
    else:
        clear_tag(securable, WHY_KEY, cleared_by=by, org_id=org_id)
    return certification_of(securable, org_id=org_id)


def certification_of(securable: str, *, org_id: Optional[str] = None) -> Optional[dict]:
    """``{status, why, by, at}`` for one asset, or None when nobody has said."""
    from pramanyx.govern.tag_store import tags_for
    tags = {t.key: t for t in tags_for(securable, org_id=org_id)}
    tag = tags.get(KEY)
    if tag is None or tag.value not in STATUSES:
        return None
    why = tags.get(WHY_KEY)
    return {"securable": securable, "status": tag.value, "why": why.value if why else "", "by": tag.set_by,
            "at": tag.set_at}


def of_prefix(prefix: str, *, org_id: Optional[str] = None) -> dict[str, dict]:
    """Every certified or deprecated asset whose securable starts with ``prefix``, keyed by securable."""
    from pramanyx.govern.tag_store import list_tags
    out: dict[str, dict] = {}
    for t in list_tags(key=KEY, securable_prefix=prefix, org_id=org_id, limit=5000):
        if t.value in STATUSES:
            out[t.securable] = {"securable": t.securable, "status": t.value, "why": "", "by": t.set_by, "at": t.set_at}
    if out:
        for t in list_tags(key=WHY_KEY, securable_prefix=prefix, org_id=org_id, limit=5000):
            if t.securable in out:
                out[t.securable]["why"] = t.value
    return out


def tables_of(connection_id: str, *, org_id: Optional[str] = None) -> dict[str, dict]:
    """A connection's certified and deprecated tables, keyed by the bare table name (lowercased)."""
    return {s.rsplit(".", 1)[-1].lower(): c for s, c in of_prefix(f"table:{connection_id}.", org_id=org_id).items()}


def artifacts_of(kind: str, *, org_id: Optional[str] = None) -> dict[str, dict]:
    """The certified and deprecated assets of one artifact kind, keyed by the asset's id."""
    prefix = f"artifact:{kind}:"
    return {s[len(prefix):]: c for s, c in of_prefix(prefix, org_id=org_id).items()}


def words(c: Optional[dict]) -> str:
    """The mark as the planner reads it, or "" when nobody has said."""
    if not c:
        return ""
    who = str(c.get("by") or "").replace("user:", "")
    why = f": {c['why']}" if c.get("why") else ""
    if c["status"] == "certified":
        return f"CERTIFIED by {who}{why} — the organisation vouches for it; prefer it"
    return f"DEPRECATED by {who}{why} — do not use it unless the question names it, and say so if you do"
