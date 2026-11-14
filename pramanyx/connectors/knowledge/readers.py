"""Who may read a page, in the words its source gives — the records a knowledge connector writes.

A connector is platform code and cannot import the agent's `pramanyx/knowledge`; the shapes it writes live here, and
`pramanyx.knowledge.access` reads them. See that module for the rules of reading.
"""
from __future__ import annotations

from typing import Iterable

ORG = "org"
CHOSEN = "chosen"

def org_wide(why: str, source: str) -> dict:
    return {"sharing": ORG, "shared_with": [], "why": why, "source": source}


def chosen(people: Iterable[str], groups: Iterable[str], why: str, source: str) -> dict:
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for kind, ids in (("person", people), ("group", groups)):
        for raw in ids:
            ident = str(raw or "").strip()
            key = (kind, ident.lower())
            if ident and key not in seen:
                seen.add(key)
                out.append({"kind": kind, "id": ident})
    return {"sharing": CHOSEN, "shared_with": out, "why": why, "source": source}


def source_audience(meta: dict, *, what: str) -> dict:
    """Who may read a page its source places no restriction on, as the person who connected the source set it.

    ``audience`` on the source: empty — only the person who connected it; ``org`` — everyone in the organisation;
    otherwise group ids, comma-separated, plus that person. Never wider than they said."""
    owner = str(meta.get("connected_by") or "").strip()
    said = str(meta.get("audience") or "").strip()
    if said.lower() == ORG:
        return org_wide(f"{what}; the person who connected the source opened it to the organisation",
                        "source-audience")
    groups = [g.strip() for g in said.split(",") if g.strip()]
    whom = "the person who connected the source" + (" and the groups they named" if groups else "")
    return chosen([owner] if owner else [], groups, f"{what}; readable by {whom}", "source-audience")
