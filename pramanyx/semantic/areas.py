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


def rival_meanings(question: str, connection_id: str) -> list[dict]:
    """The words of ``question`` that mean one thing in one area of the business and another in the next — each
    ``{term, meanings: [{area, area_name, text, standing}], chosen}``, where ``chosen`` is the area the question itself
    names ("" when it names none of them: then the person is asked, or each meaning is answered and named). A word with
    one meaning, or meanings no one has written, is no rival. Reads what is stored; no model."""
    from pramanyx.record.writers import definition_term, definitions
    q = f" {re.sub(r'[^a-z0-9]+', ' ', (question or '').lower())} "
    groups: dict[str, list] = {}
    for c in definitions(connection_id):
        if c.tier in ("approved", "declared") and (c.extra.get("area") or "").strip():
            groups.setdefault(definition_term(c.extra.get("term", "")), []).append(c)
    if not any(len({c.extra.get("area") for c in g}) > 1 for g in groups.values()):
        return []
    try:
        names = {a["id"]: a["name"] for a in areas_for(connection_id)}
    except Exception as exc:  # noqa: BLE001 — unread, an area is said by its id
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the areas could not be read; rival meanings are said by area id", counter="areas.rivals")
        names = {}

    def said(word: str) -> bool:
        w = re.sub(r"[^a-z0-9]+", " ", (word or "").lower()).strip()
        # the word as written, or its plural ("active customers")
        return bool(w) and re.search(rf"(?<![a-z0-9]){re.escape(w)}(?:s|es)?(?![a-z0-9])", q) is not None

    out: list[dict] = []
    for group in groups.values():
        if len({c.extra.get("area") for c in group}) < 2:
            continue
        words = {group[0].extra.get("term", "")} | {a for c in group for a in (c.extra.get("aliases") or [])}
        if not any(said(w) for w in words):
            continue
        meanings = [{"area": c.extra.get("area"), "area_name": names.get(c.extra.get("area"), c.extra.get("area")),
                     "text": c.statement.text, "standing": "published" if c.tier == "approved" else "draft"}
                    for c in sorted(group, key=lambda c: (c.tier != "approved", c.extra.get("area")))]
        named = [m["area"] for m in meanings if said(m["area_name"]) or said(str(m["area"]).replace("_", " "))]
        out.append({"term": group[0].extra.get("term", ""), "meanings": meanings, "chosen": named[0] if len(named) == 1 else ""})
    return out


def rival_meanings_block(rivals: list[dict]) -> str:
    """The rival meanings, said to the planner: the one the question chose, or each one to be answered and named."""
    if not rivals:
        return ""
    lines = ["WORDS WITH MORE THAN ONE MEANING HERE — each area of the business means its own:"]
    for r in rivals:
        each = "; ".join(f"in {m['area_name']} ({m['standing']}): {m['text']}" for m in r["meanings"])
        lines.append(f"  • “{r['term']}” — {each}")
        if r["chosen"]:
            name = next(m["area_name"] for m in r["meanings"] if m["area"] == r["chosen"])
            lines.append(f"    The question is about {name}: use {name}'s meaning, and say so.")
        else:
            lines.append("    The question does not say which area: answer for each meaning, each named with its area, "
                         "or ask the person which they mean — never pick one silently.")
    return "\n".join(lines)
