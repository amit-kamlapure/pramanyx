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

import contextvars
import re
import time
from contextlib import contextmanager
from typing import Iterable, Iterator, Optional

KEY = "area"
MAX_DEPTH = 5
#: The most an Area's page puts first, and the longest description it keeps (Discover D4).
MAX_FEATURED = 12
MAX_DESCRIPTION = 2000

#: The kinds Discover lists that a person places in an Area on the tag store, each under the artifact kind its tag is
#: written as (`artifact:<kind>:<ref>`, read back by `discover.items._placed_tags`; a schedule is an automation there).
ARTIFACT_KINDS = {"dashboard": "dashboard", "canvas": "canvas", "agent": "agent", "schedule": "automation",
                  "document": "document", "sheet": "sheet", "trusted_query": "trusted_query"}
#: What an Area may put first: anything Discover lists.
FEATURABLE = ("table", "metric", "definition", *ARTIFACT_KINDS)


def area_id(name: str) -> str:
    """An id from a name: lowercase words joined by underscores, as the packages write theirs."""
    return re.sub(r"[^a-z0-9]+", "_", (name or "").strip().lower()).strip("_")[:60]


def declarations(workspace_id: Optional[str] = None) -> list:
    from pramanyx.orgsettings.store import effective_settings
    return list(getattr(effective_settings(workspace_id), "areas", None) or [])


#: How long the install's one name per Area is kept before it is read again: connections and packages change rarely,
#: and every page over several connections asks for it.
NAMES_FRESH_S = 60.0
_names_read: dict = {"at": None, "names": {}}


def install_names() -> dict[str, tuple[str, str]]:
    """``area id → (name, question)``: one name for each package Area across the install (2026-11-25, the Atlas-by-Area
    plan's A0). Packages share an Area's id, but an industry's package names it in its own words — retail's "Inventory
    & merchandising" is analytics-base's "Inventory" — and a page over several connections named it after whichever
    connection it read first (seen live: Discover said "Inventory", theLook's review queue "Inventory & merchandising").
    The name most of the install's connections give it; a tie, the shorter — the more general — then the first in
    order. The organisation's own name for it, where it set one, stands over this (`areas_for`)."""
    now = time.monotonic()
    if _names_read["at"] is not None and now - _names_read["at"] < NAMES_FRESH_S:
        return _names_read["names"]
    from collections import Counter

    from pramanyx.kernel.errors import tolerate
    from pramanyx.semantic.metric_catalogue import industry_packages
    from pramanyx.semantic.metric_map import map_of
    try:
        from pramanyx.db.registry import list_connections
        connections = [str(c["id"]) for c in list_connections()]
    except Exception as exc:  # noqa: BLE001 — unread, each page names an Area as its own connection's package does
        tolerate(exc, "the install's connections could not be read; Areas keep their packages' names",
                 counter="areas.install_names")
        connections = []
    maps: dict[tuple, list] = {}
    said: dict[str, Counter] = {}
    asked: dict[tuple[str, str], str] = {}
    for conn in connections:
        try:
            packages = industry_packages(conn, None)
            key = tuple(sorted(p.pack_id for p in packages))
            if key not in maps:
                maps[key] = [a for a in map_of(packages).areas if not a.generic]
        except Exception as exc:  # noqa: BLE001 — one connection unread: the others still name its Areas
            tolerate(exc, f"the Areas of {conn} could not be read for their one name", counter="areas.install_names")
            continue
        for a in maps[key]:
            said.setdefault(a.id, Counter())[a.name] += 1
            asked.setdefault((a.id, a.name), a.question)
    names: dict[str, tuple[str, str]] = {}
    for area, counted in said.items():
        name = min(counted, key=lambda n: (-counted[n], len(n), n))
        names[area] = (name, asked[(area, name)])
    _names_read.update(at=now, names=names)
    return names


def one_name(area_id: str, name: str, question: str) -> tuple[str, str]:
    """A package Area's name and question as the whole install says them (`install_names`); its own, unread."""
    try:
        return install_names().get(area_id, (name, question))
    except Exception as exc:  # noqa: BLE001 — a page still names it, as its package does
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the install's one name for an Area could not be read", counter="areas.one_name")
        return name, question


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
        name, question = one_name(a.id, a.name, a.question)
        out.append({"id": a.id, "name": (d.name if d and d.name else name), "question": (d.question if d and d.question else question),
                    "parent": d.parent if d else "", "business_owners": list(d.business_owners) if d else [],
                    "technical_owners": list(d.technical_owners) if d else [], "source": "package", "pack_id": a.pack_id,
                    "icon": (d.icon if d and d.icon else getattr(a, "icon", "")), **_curated(d)})
    for d in declared.values():
        # A declaration with no name of its own annotates a package's Area (its owners, its description, what it
        # features — check_declarations refuses a NEW area without one): it belongs where that package's map has the
        # Area, never as an organisation's Area of its own on a connection without it. Listed there, it stood on every
        # other connection as "returns", source organisation, and Discover showed that one (seen live, 2026-11-24).
        if not (d.name or "").strip():
            continue
        out.append({"id": d.id, "name": d.name or d.id, "question": d.question, "parent": d.parent,
                    "business_owners": list(d.business_owners), "technical_owners": list(d.technical_owners),
                    "source": "organisation", "pack_id": "", "icon": d.icon, **_curated(d)})
    return out


def _curated(d) -> dict:
    """What an Area's curators wrote for its page: its description and what it puts first."""
    return {"description": (getattr(d, "description", "") or "") if d else "",
            "featured": [{"kind": f.kind, "ref": f.ref} for f in (getattr(d, "featured", None) or [])] if d else []}


def curates(area: dict, person: str, *, admin: bool) -> bool:
    """Whether ``person`` may change ``area`` — its description, owners and what it puts first — and place anything in
    it: its business and technical owners, and whoever administers the organisation (the user's call, 2026-11-23: no
    new role). An agent never does; its doors refuse it before this is asked."""
    if admin:
        return True
    me = _who(person)
    return bool(me) and me in {_who(o) for o in [*(area.get("business_owners") or []), *(area.get("technical_owners") or [])]}


#: The fields of an Area its curators may change from its page.
EDITABLE = ("name", "question", "description", "business_owners", "technical_owners", "featured", "icon")


def edit_area(area_id: str, changes: dict, *, by: str, known: set[str]) -> dict:
    """Change one Area as its curators write it — its words, its owners, what it puts first — and keep who changed what,
    when, in the ledger (an Area's declaration is published on save; its history is that record). A package's Area is
    annotated under its own id; an Area no connection has is refused. Raises ``ValueError`` with every problem said."""
    from pramanyx.orgsettings.models import AreaDeclaration, FeaturedThing
    from pramanyx.orgsettings.store import load_org_settings, save_org_settings
    if not (by or "").strip():
        raise ValueError("a change to an Area says who made it")
    unknown = sorted(set(changes) - set(EDITABLE))
    if unknown:
        raise ValueError(f"an Area's page changes its {', '.join(EDITABLE)}; not {', '.join(unknown)}")
    settings = load_org_settings()
    decls = list(settings.areas)
    at = next((i for i, d in enumerate(decls) if d.id == area_id), None)
    if at is None and area_id not in known:
        raise ValueError(f"{area_id!r} is no Area; declare it first")
    before = decls[at] if at is not None else AreaDeclaration(id=area_id)
    update: dict = {}
    for k in ("name", "question"):
        if k in changes:
            update[k] = str(changes[k] or "").strip()[:200]
    if "icon" in changes:
        icon = str(changes["icon"] or "").strip().lower()
        if icon and not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", icon):
            raise ValueError("an Area's icon is one of the app's icon names")
        update["icon"] = icon
    if "description" in changes:
        text = str(changes["description"] or "").strip()
        if len(text) > MAX_DESCRIPTION:
            raise ValueError(f"a description is at most {MAX_DESCRIPTION} characters")
        update["description"] = text
    for k in ("business_owners", "technical_owners"):
        if k in changes:
            update[k] = list(dict.fromkeys(str(o).strip() for o in (changes[k] or []) if str(o).strip()))
    if "featured" in changes:
        featured, seen = [], set()
        for f in changes["featured"] or []:
            kind, ref = str((f or {}).get("kind") or "").strip(), str((f or {}).get("ref") or "").strip()
            if kind not in FEATURABLE or not ref:
                raise ValueError(f"a featured thing is a kind ({', '.join(FEATURABLE)}) and its id")
            if (kind, ref) not in seen:
                seen.add((kind, ref))
                featured.append(FeaturedThing(kind=kind, ref=ref))
        if len(featured) > MAX_FEATURED:
            raise ValueError(f"an Area puts at most {MAX_FEATURED} things first")
        update["featured"] = featured
    after = before.model_copy(update=update)
    decls = decls[:at] + [after] + decls[at + 1:] if at is not None else [*decls, after]
    problems = check_declarations(decls, known=known)
    if problems:
        raise ValueError("; ".join(problems))
    save_org_settings(settings.model_copy(update={"areas": decls}))
    _journal_area(area_id, before.model_dump(), after.model_dump(), by)
    return after.model_dump()


def _journal_area(area_id: str, before: dict, after: dict, by: str) -> None:
    """Who changed which of an Area's fields, from what to what. Best effort: the settings file is the authority and the
    change has landed; an unrecorded change is said in the log, never undone."""
    changed = {k: {"from": before.get(k), "to": after.get(k)} for k in EDITABLE if before.get(k) != after.get(k)}
    if not changed:
        return
    try:
        from pramanyx.kernel.ledger import Ledger
        Ledger.default().emit("area.changed", {"area": area_id, "by": by, "changed": changed})
    except Exception as exc:  # noqa: BLE001 — see the docstring
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, f"the change to the Area {area_id} was saved but not journalled", counter="areas.journal")


def _who(person: str) -> str:
    who = (person or "").strip().lower()
    return who[5:] if who.startswith("user:") else who


def area_of_tables(tables: list[str], connection_id: str) -> str:
    """The area a set of tables is read in: where a person placed one of them, else the area whose words name one."""
    from pramanyx.semantic.metric_map import best_areas, map_for
    placed = placed_by_people(connection_id)
    people, qualified = placed.get("tables") or {}, placed.get("tables_qualified") or {}
    named = [a for a in map_for(connection_id).areas if not a.generic]
    for t in tables:
        parts = str(t).lower().split(".")
        bare = parts[-1]
        under = ".".join(parts[-2:]) if len(parts) > 1 else ""
        if under and under in qualified:
            return qualified[under][0]
        if bare in people:
            return people[bare][0]
        hits = best_areas(bare, named)
        if hits:
            return hits[0][0].id
    return ""


def standing(person: str, area: str, connection_id: str) -> tuple[int, int]:
    """A person's standing in an area of the business (punch list 86, 2026-11-18): ``(owner, right)`` — 1 when they
    are a declared owner of the area (its business or technical owners), and how many answers in it they said were
    right (their own Right verdicts on answers drawn from the area's tables). Compared as a tuple, so an owner stands
    above any count. Used ONLY to order knowledge of the same tier: popularity never lifts a draft over a published
    definition. ``(0, 0)`` for no one, or no area."""
    who = _who(person)
    if not who or not area:
        return (0, 0)
    owner = 0
    for a in areas_for(connection_id):
        if a["id"] == area and who in {_who(p) for p in [*a.get("business_owners", []), *a.get("technical_owners", [])]}:
            owner = 1
            break
    right = 0
    try:
        from pramanyx.db.history import get_investigation
        from pramanyx.feedback.verdicts import accepted_by
        for v in accepted_by(who, connection_id):
            inv = get_investigation(v["investigation_id"]) or {}
            report = inv.get("report") if isinstance(inv.get("report"), dict) else {}
            tables = list((report or {}).get("tables_used") or inv.get("tables_used") or [])
            if tables and area_of_tables(tables, connection_id) == area:
                right += 1
    except Exception as exc:  # noqa: BLE001 — unread, the owner's word still stands
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "a person's verdicts could not be read for their standing", counter="areas.standing")
    return (owner, right)


def _plain(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def said_not_an_area(said: Optional[dict], connection_id: str) -> list[str]:
    """What a curator said is not an area on ``connection_id``: its own word, and what was said for every connection
    (``"*"``, before 2026-11-25)."""
    said = said or {}
    return [*said.get(connection_id, []), *said.get("*", [])]


_SUGGESTED: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar("pramanyx_suggested_shared", default=None)


@contextmanager
def suggestions_read_once() -> Iterator[None]:
    """Each connection's suggestions are read once inside this, whoever asks (the Atlas's background reading keeps them,
    and the review queue it reads asks for them too). Reading them decodes every saved ontology, a long stretch the
    interpreter holds; a page load that read them beside a reading waited nine seconds (measured 2026-11-25). Nothing is
    kept after."""
    token = _SUGGESTED.set({})
    try:
        yield
    finally:
        _SUGGESTED.reset(token)


def still_suggested(connection_id: str, suggestions: list[dict], declared: Iterable[dict]) -> list[dict]:
    """Suggestions read earlier — the Atlas keeps them with its background reading — less any an Area declared since
    answers to, or a curator has since said is none: taking or refusing one shows on the next load, not ten minutes on."""
    from pramanyx.orgsettings.store import effective_settings
    gone = {_plain(x) for a in declared for x in (a.get("id", ""), a.get("name", ""))}
    gone |= {_plain(x) for x in said_not_an_area(getattr(effective_settings(None), "not_areas", None), connection_id)}
    return [s for s in suggestions if _plain(s.get("label", "")) not in gone and _plain(s.get("id", "")) not in gone]


def suggested_areas(connection_id: str, schema_name: Optional[str] = None) -> list[dict]:
    """Areas the model suggests from its own labels for the data, each ``{label, id, tables}`` — what the ontology's
    enricher called the business area of each entity (``entity.domain``) where no area of the connection already
    answers to it and a curator has not said it is none (punch list 87, 2026-11-18). A suggestion is only that: an area
    is declared by a curator (`PUT /areas`), never by the model. Reads what is stored; no model. Read once per
    connection inside :func:`suggestions_read_once`."""
    shared = _SUGGESTED.get()
    if shared is None:
        return _suggested_areas(connection_id, schema_name)
    if (connection_id, schema_name) not in shared:
        shared[(connection_id, schema_name)] = _suggested_areas(connection_id, schema_name)
    return [dict(s) for s in shared[(connection_id, schema_name)]]


def _suggested_areas(connection_id: str, schema_name: Optional[str] = None) -> list[dict]:
    from pramanyx.ontology.store import load_latest_ontology
    from pramanyx.semantic.metric_map import best_areas, map_for
    from pramanyx.orgsettings.store import effective_settings
    graph = load_latest_ontology(connection_id, schema_name or None)
    # Named none, the latest graph is one dataset's: its labels are read against that dataset's Areas, which its
    # package's map holds. Read against the connection's own, Workspace suggested "Catalog" from olist's labels, an
    # Area olist's package has (2026-11-25).
    schema_name = schema_name or getattr(graph, "schema_name", None) or None
    tables: dict[str, set[str]] = {}
    names: dict[str, str] = {}
    for e in (getattr(graph, "entities", None) or {}).values():
        label = str(getattr(e, "domain", "") or "").strip()
        if not label:
            continue
        key = _plain(label)
        names.setdefault(key, label)
        tables.setdefault(key, set()).update(str(t).split(".")[-1] for t in (getattr(e, "source_tables", None) or []))
    if not tables:
        return []
    known = {_plain(a["id"]) for a in areas_for(connection_id, schema_name)} | {
        _plain(a["name"]) for a in areas_for(connection_id, schema_name)}
    industry = [a for a in map_for(connection_id, schema_name).areas if not a.generic]
    said_not = {_plain(x) for x in said_not_an_area(getattr(effective_settings(None), "not_areas", None), connection_id)}
    out = []
    for key, label in names.items():
        if key in known or key in said_not or best_areas(label, industry):
            continue
        out.append({"label": label, "id": key.replace(" ", "_")[:60], "tables": sorted(t for t in tables[key] if t)})
    return sorted(out, key=lambda s: (-len(s["tables"]), s["label"].lower()))


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


def place(kind: str, ref: str, area: str, *, by: str, connection_id: str = "", schema_name: str = "") -> Optional[str]:
    """A person places a table (or a whole connection), a metric, or anything else Discover lists (``ARTIFACT_KINDS``)
    in an area — ``area`` ``""`` takes it out. Returns the area it now stands in, or None."""
    from pramanyx.govern.tag_store import clear_tag, set_tag
    from pramanyx.metastore.models import artifact_securable, catalog_securable, table_securable, thing_securable
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
    elif kind in ARTIFACT_KINDS:
        if not (ref or "").strip():
            raise ValueError(f"which {kind} is placed")
        securable = artifact_securable(ARTIFACT_KINDS[kind], ref)
    else:
        raise ValueError(f"a table, a connection, a metric or one of {', '.join(ARTIFACT_KINDS)} is placed in an area")
    if not area:
        clear_tag(securable, KEY, cleared_by=by)
        return None
    set_tag(securable, KEY, area, set_by=by)
    return area


def placed_by_people(connection_id: str) -> dict:
    """``{"tables": {bare: (area, by)}, "tables_qualified": {"schema.table": (area, by)}, "metrics": {name: (area, by)},
    "connection": (area, by) | None}`` — what people placed, for coverage to read before any evidence.

    A table is placed under its schema (``table:<connection>.<schema>.<table>``). Read by its bare name only while that
    name is placed in one area: two schemas' ``orders`` placed in two areas leave the bare name out, and each is read
    under its schema (2026-11-23: keyed by the bare name alone, the last one read silently stood for both)."""
    from pramanyx.govern.tag_store import list_tags
    out: dict = {"tables": {}, "tables_qualified": {}, "metrics": {}, "connection": None}
    prefix = f"table:{connection_id}."
    areas_of_bare: dict[str, set[str]] = {}
    for t in list_tags(key=KEY, securable_prefix=prefix, limit=5000):
        qualified = t.securable[len(prefix):].lower().lstrip(".")
        bare = qualified.rsplit(".", 1)[-1]
        out["tables_qualified"][qualified] = (t.value, t.set_by)
        areas_of_bare.setdefault(bare, set()).add(t.value)
        out["tables"][bare] = (t.value, t.set_by)
    for bare, areas in areas_of_bare.items():
        if len(areas) > 1:
            out["tables"].pop(bare, None)
    for t in list_tags(key=KEY, securable_prefix=f"metric:{connection_id}/", limit=5000):
        out["metrics"][t.securable.split("/", 1)[1]] = (t.value, t.set_by)
    for t in list_tags(key=KEY, securable_prefix=f"catalog:{connection_id}", limit=5):
        if t.securable == f"catalog:{connection_id}":
            out["connection"] = (t.value, t.set_by)
    return out


def _rival_claims(connection_id: str) -> tuple[list[list], dict[str, str]]:
    """The published Definitions of each word defined in two or more areas, and the areas' names."""
    from pramanyx.record.writers import definition_term, definitions
    groups: dict[str, list] = {}
    for c in definitions(connection_id):
        if c.tier in ("approved", "declared") and (c.extra.get("area") or "").strip():
            groups.setdefault(definition_term(c.extra.get("term", "")), []).append(c)
    rivals = [g for g in groups.values() if len({c.extra.get("area") for c in g}) > 1]
    if not rivals:
        return [], {}
    try:
        names = {a["id"]: a["name"] for a in areas_for(connection_id)}
    except Exception as exc:  # noqa: BLE001 — unread, an area is said by its id
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the areas could not be read; rival meanings are said by area id", counter="areas.rivals")
        names = {}
    return rivals, names


def _meanings(group: list, names: dict[str, str]) -> list[dict]:
    return [{"area": c.extra.get("area"), "area_name": names.get(c.extra.get("area"), c.extra.get("area")),
             "text": c.statement.text, "standing": "published" if c.tier == "approved" else "draft"}
            for c in sorted(group, key=lambda c: (c.tier != "approved", c.extra.get("area")))]


def rival_groups(connection_id: str) -> list[dict]:
    """Every word published with one meaning in one area and another in the next — ``{term, meanings}`` — with no
    question: the review queue's conflicts (Phase 3, 2026-11-17). `rival_meanings` narrows them to a question's words."""
    rivals, names = _rival_claims(connection_id)
    return sorted(({"term": g[0].extra.get("term", ""), "meanings": _meanings(g, names)} for g in rivals),
                  key=lambda r: str(r["term"]).lower())


def _asker(person: Optional[str]) -> str:
    if person is not None:
        return person
    from pramanyx.db.history import person_now
    return person_now()


def _kept(connection_id: str, person: str) -> dict[str, str]:
    if not person:
        return {}
    try:
        from pramanyx.semantic.ambiguity_ledger import kept_meanings
        return kept_meanings(connection_id, person)
    except Exception as exc:  # noqa: BLE001 — unread, the person is asked as before
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "a person's kept meanings could not be read; they are asked which they mean",
                 counter="areas.kept_meanings")
        return {}


def rival_meanings(question: str, connection_id: str, person: Optional[str] = None) -> list[dict]:
    """The words of ``question`` that mean one thing in one area of the business and another in the next — each
    ``{term, meanings: [{area, area_name, text, standing}], chosen, kept}``, where ``chosen`` is the area the question
    itself names, else the one the asker chose when asked before (``kept`` True; punch list 83), else "" — then the
    person is asked, or each meaning is answered and named. A word with one meaning, or meanings no one has written,
    is no rival. ``person`` is the asker (the request's own when None). Reads what is stored; no model."""
    q = f" {re.sub(r'[^a-z0-9]+', ' ', (question or '').lower())} "
    rivals, names = _rival_claims(connection_id)
    if not rivals:
        return []
    kept: Optional[dict[str, str]] = None

    def said(word: str) -> bool:
        w = re.sub(r"[^a-z0-9]+", " ", (word or "").lower()).strip()
        # the word as written, or its plural ("active customers")
        return bool(w) and re.search(rf"(?<![a-z0-9]){re.escape(w)}(?:s|es)?(?![a-z0-9])", q) is not None

    out: list[dict] = []
    for group in rivals:
        words = {group[0].extra.get("term", "")} | {a for c in group for a in (c.extra.get("aliases") or [])}
        if not any(said(w) for w in words):
            continue
        meanings = _meanings(group, names)
        term = group[0].extra.get("term", "")
        named = [m["area"] for m in meanings if said(m["area_name"]) or said(str(m["area"]).replace("_", " "))]
        chosen, from_before = (named[0] if len(named) == 1 else ""), False
        if not chosen:
            if kept is None:
                kept = _kept(connection_id, _asker(person))
            area = kept.get(str(term).strip().lower(), "")
            if area and any(m["area"] == area for m in meanings):
                chosen, from_before = area, True
        out.append({"term": term, "meanings": meanings, "chosen": chosen, "kept": from_before})
    return out


def keep_pick(question: str, reading: str, connection_id: str, person: Optional[str] = None) -> Optional[dict]:
    """The asker answered "which do you mean?" for a word of ``question`` with ``reading`` ("in Finance", as the ask
    offers it): kept as theirs (`ambiguity_ledger.keep_meaning`). ``{term, area}`` kept, or None when the reading names
    no area of the word the question was asked about."""
    who = _asker(person)
    if not who:
        return None
    said = re.sub(r"^\s*in\s+", "", (reading or "").strip(), flags=re.I).strip().lower()
    for r in rival_meanings(question, connection_id, person=""):
        if r["chosen"]:
            continue
        area = next((m["area"] for m in r["meanings"]
                     if said in (str(m["area_name"]).lower(), str(m["area"]).lower().replace("_", " "))), "")
        if area:
            from pramanyx.org.context import current_org_id
            from pramanyx.semantic.ambiguity_ledger import keep_meaning
            keep_meaning(connection_id, r["term"], area, person=who, org_id=current_org_id() or "")
            return {"term": r["term"], "area": area}
    return None


def rival_meanings_block(rivals: list[dict]) -> str:
    """The rival meanings, said to the planner: the one the question chose, or each one to be answered and named."""
    if not rivals:
        return ""
    lines = ["WORDS WITH MORE THAN ONE MEANING HERE — each area of the business means its own:"]
    for r in rivals:
        each = "; ".join(f"in {m['area_name']} ({m['standing']}): {m['text']}" for m in r["meanings"])
        lines.append(f"  • “{r['term']}” — {each}")
        if r["chosen"] and r.get("kept"):
            name = next(m["area_name"] for m in r["meanings"] if m["area"] == r["chosen"])
            lines.append(f"    The person asking chose {name}'s meaning when asked before: use it, say so, and say they "
                         "can name another area for its meaning.")
        elif r["chosen"]:
            name = next(m["area_name"] for m in r["meanings"] if m["area"] == r["chosen"])
            lines.append(f"    The question is about {name}: use {name}'s meaning, and say so.")
        else:
            lines.append("    The question does not say which area: answer for each meaning, each named with its area, "
                         "or ask the person which they mean — never pick one silently.")
    return "\n".join(lines)
