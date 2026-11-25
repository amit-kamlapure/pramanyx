"""The Areas of the business, as an agent reads them (the Atlas plan's A8, 2026-11-25: "the Areas themselves reach every
agent").

The Ontology is the unified context layer that gives AI agents a business-aware map of the organisation (the user,
2026-11-25). Its map — the organisation's Areas, who answers for each, what is governed in each — was read by its page
alone. These shape the Atlas's own reads (`GET /discover/atlas`, `GET /discover/areas/{id}`, `GET /discover/atlas/review`)
for an agent: the same facts the page shows, trimmed to what a question needs, every count kept and what could not be
read said. Pure: the MCP tools reach the reads through the API, under the caller's organisation and clearances.
"""
from __future__ import annotations

from typing import Any

#: The most things of one kind, and rows waiting, an agent is handed at once; the counts say how many there are.
FIRST = 8


def areas_for_agents(atlas: dict) -> dict:
    """Every Area in view: what it is, who answers for it, the connections it spans, what it holds, the month's answers
    that drew on it, what waits in it — and what sits in no Area."""
    names = {c["id"]: c["name"] for c in atlas.get("connections") or []}
    other = atlas.get("everything_else") or {}
    return {
        "areas": [{
            "id": a["id"], "name": a["name"], "question": a.get("question") or "",
            "contacts": {"business": a.get("business_owners") or [], "technical": a.get("technical_owners") or []},
            "connections": [names.get(c, c) for c in a.get("connections") or []],
            "holds": a.get("counts") or {}, "answers_this_month": int(a.get("answers") or 0),
            "waiting": a.get("review"), "learned": a.get("learned"),
        } for a in atlas.get("areas") or []],
        "hold_nothing_yet": [q["name"] for q in atlas.get("quiet") or []],
        "in_no_area": {"things": int(other.get("total") or 0), "answers_this_month": int(other.get("answers") or 0)},
        "month": atlas.get("figures") or {},
        "said": list(atlas.get("said") or []),
    }


def _thing(i: dict) -> dict:
    cert = (i.get("certification") or {}).get("status") or ""
    out: dict[str, Any] = {"name": i.get("name"), "state": i.get("state") or "", "connection": i.get("connection_name") or ""}
    if cert:
        out["certification"] = cert
    if i.get("use"):
        out["use_this_month"] = i["use"]
    return out


def area_for_agents(page: dict, review: dict) -> dict:
    """One Area: what it is, who answers for it, its sub-Areas, what it holds by kind (the most used first, each with its
    state and connection), and what waits for review in it — the busiest first."""
    a = page.get("area") or {}
    return {
        "id": a.get("id"), "name": a.get("name"), "question": a.get("question") or "",
        "description": a.get("description") or "",
        "contacts": {"business": a.get("business_owners") or [], "technical": a.get("technical_owners") or []},
        "connections": a.get("connections") or [],
        "sub_areas": [{"id": c.get("id"), "name": c.get("name"), "holds": c.get("total", 0)} for c in page.get("children") or []],
        "holds": [{"kind": k.get("title") or k.get("kind"), "count": k.get("count", 0),
                   "first": [_thing(i) for i in (k.get("items") or [])[:FIRST]]} for k in page.get("kinds") or []],
        "waiting": {"total": int(review.get("total") or 0), "with_sub_areas": review.get("within") or [],
                    "first": [{"what": r.get("source"), "title": r.get("title"), "connection": r.get("connection_name") or "",
                               "weight": {"count": r.get("count"), "complaints": r.get("complaints") or 0}}
                              for r in (review.get("items") or [])[:FIRST]]},
        "said": [*(page.get("said") or []), *(review.get("said") or [])],
    }
