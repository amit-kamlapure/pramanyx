"""The areas of the business, as the organisation declares them (the ontology study, Phase 1, 2026-11-17).

An AREA is a part of the business a reader runs (`docs/GLOSSARY.md`): an industry package declares its map
(`semantic/metric_map.py`, `packs/*/areas.yaml`), and tables and metrics are placed in it by evidence
(`semantic/metric_coverage.py`). This adds what a governed ontology needs on top, and stores nothing new of its own:

- **Declared areas and owners** — the organisation's settings (`orgsettings.models.AreaDeclaration`), a curator's: a new
  area, or a package's own given a business and a technical owner, and a place under another (at most five levels).
- **A person's placement** — a governed tag ``area=<id>`` on a table or a metric (``metric:<connection>/<name>``: a metric
  is named on its connection) on the tag plane (`govern/tag_store.py`):
  set by a person, never a model, and it outranks every placement by evidence. Kept apart from the grant-bearing
  ``domain`` tag on purpose: placing a table in an area says what it means, and never widens who may read it.
- **Inheritance** — a tag on a connection (``catalog:<id>``) places every table on it that has none of its own.

A read of what is stored; no model, no warehouse.
"""
from __future__ import annotations

import re
from typing import Optional

KEY = "area"
MAX_DEPTH = 5


def area_id(name: str) -> str:
    """An id from a name: lowercase words joined by underscores, as the packages write theirs."""
    return re.sub(r"[^a-z0-9]+", "_", (name or "").strip().lower()).strip("_")[:60]


def declarations(workspace_id: Optional[str] = None) -> list:
    from pramanyx.orgsettings.store import effective_settings
    return list(getattr(effective_settings(workspace_id), "areas", None) or [])


def areas_for(connection_id: str, schema_name: Optional[str] = None, *, workspace_id: Optional[str] = None) -> list[dict]:
    """Every area a connection is read by — its industry map's, in its order, then the organisation's own — each with
    its owners, its place and where it came from (``package`` or ``organisation``)."""
    from pramanyx.semantic.metric_map import map_for
    mmap = map_for(connection_id, schema_name)
    declared = {d.id: d for d in declarations(workspace_id)}
    out: list[dict] = []
    for a in mmap.areas:
        if a.generic:
            continue
        d = declared.pop(a.id, None)
        out.append({"id": a.id, "name": (d.name if d and d.name else a.name), "question": (d.question if d and d.question else a.question),
                    "parent": d.parent if d else "", "business_owners": list(d.business_owners) if d else [],
                    "technical_owners": list(d.technical_owners) if d else [], "source": "package", "pack_id": a.pack_id})
    for d in declared.values():
        out.append({"id": d.id, "name": d.name or d.id, "question": d.question, "parent": d.parent,
                    "business_owners": list(d.business_owners), "technical_owners": list(d.technical_owners),
                    "source": "organisation", "pack_id": ""})
    return out


def unknown_area(connection_id: str, area: str) -> str:
    """Why ``area`` is not one of the connection's areas, or "" when it is (or is empty: everywhere). A definition, a
    placement and a question read areas by id, so a typed name that is no area is refused, never kept as a stray."""
    if not (area or "").strip():
        return ""
    ids = {a["id"] for a in areas_for(connection_id)}
    return "" if area in ids else f"{area!r} is no area of this connection; declare it first, or choose one of {', '.join(sorted(ids)) or 'none'}"


def check_declarations(decls: list, known: Optional[set[str]] = None) -> list[str]:
    """What is wrong with a set of declarations, in words: a parent that is no area, a cycle, more than five levels, a
    new area with no name, an id twice. ``[]`` when they stand."""
    problems: list[str] = []
    ids = [d.id for d in decls]
    for i in {x for x in ids if ids.count(x) > 1}:
        problems.append(f"the area {i!r} is declared twice")
    every = set(ids) | set(known or ())
    parent = {d.id: d.parent for d in decls if d.parent}
    for d in decls:
        if not d.id or area_id(d.id) != d.id:
            problems.append(f"{d.id!r} is not an area id (lowercase words joined by underscores)")
        if d.parent and d.parent not in every:
            problems.append(f"{d.id} sits under {d.parent}, which is no area")
        if known is not None and d.id not in known and not d.name.strip():
            problems.append(f"the new area {d.id} needs a name")
        seen, cur, depth = {d.id}, d.id, 1
        while parent.get(cur):
            cur = parent[cur]
            depth += 1
            if cur in seen:
                problems.append(f"{d.id} sits under itself")
                break
            seen.add(cur)
        if depth > MAX_DEPTH:
            problems.append(f"{d.id} is {depth} levels deep; an area is at most {MAX_DEPTH}")
    return sorted(set(problems))


def place(kind: str, ref: str, area: str, *, by: str, connection_id: str, schema_name: str = "") -> Optional[str]:
    """A person places a table (or a whole connection) or a metric in an area — ``area`` ``""`` takes it out. Returns
    the area it now stands in, or None."""
    from pramanyx.govern.tag_store import clear_tag, set_tag
    from pramanyx.metastore.models import catalog_securable, table_securable, thing_securable
    kind = (kind or "").strip().lower()
    if not (by or "").strip():
        raise ValueError("a placement says who made it")
    if kind == "table":
        securable = table_securable(connection_id, schema_name or "", ref.split(".")[-1])
    elif kind == "connection":
        securable = catalog_securable(connection_id)
    elif kind == "metric":
        # a metric is named on its connection: two connections' `gmv` are two metrics, placed apart
        securable = thing_securable("metric", f"{connection_id}/{ref}")
    else:
        raise ValueError("a table, a connection or a metric is placed in an area")
    if not area:
        clear_tag(securable, KEY, cleared_by=by)
        return None
    set_tag(securable, KEY, area, set_by=by)
    return area


def placed_by_people(connection_id: str) -> dict:
    """``{"tables": {bare: (area, by)}, "metrics": {name: (area, by)}, "connection": (area, by) | None}`` — what people
    placed, for coverage to read before any evidence."""
    from pramanyx.govern.tag_store import list_tags
    out: dict = {"tables": {}, "metrics": {}, "connection": None}
    for t in list_tags(key=KEY, securable_prefix=f"table:{connection_id}.", limit=5000):
        out["tables"][t.securable.rsplit(".", 1)[-1].lower()] = (t.value, t.set_by)
    for t in list_tags(key=KEY, securable_prefix=f"metric:{connection_id}/", limit=5000):
        out["metrics"][t.securable.split("/", 1)[1]] = (t.value, t.set_by)
    for t in list_tags(key=KEY, securable_prefix=f"catalog:{connection_id}", limit=5):
        if t.securable == f"catalog:{connection_id}":
            out["connection"] = (t.value, t.set_by)
    return out
