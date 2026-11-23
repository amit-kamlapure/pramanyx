"""Discover's three reads (the plan's D1): the page itself, a kind or an Area's things in full, and one Area's page.

Every reader runs side by side (`gather`), each in a copy of the request's context, and one that cannot be read is said
and leaves the rest standing. The Areas are every connection's in view — its industry's map and the organisation's
declarations (`semantic/areas.areas_for`), the same Area on two connections being one — and what no Area holds stands
in "Everything else". An Area that holds nothing in view is listed apart, never dropped.
"""
from __future__ import annotations

import contextvars
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from pramanyx.discover.items import KINDS, OTHER, READERS, TITLES, Found, Item, Scope, who_of

#: How many of each kind the page shows before "View all".
SHOWN = 6

#: How an item's standing orders it within its kind: the vouched-for first, the warned-off last.
_STATE_RANK = {"approved": 0, "published": 0, "on": 0, "": 1, "draft": 2, "proposed": 2, "off": 3, "deprecated": 4}


def gather(scope: Scope, kinds: tuple = KINDS) -> dict[str, Found]:
    """Each kind's reader, side by side. One that raises is said, and its kind is empty."""
    def run(kind: str) -> Found:
        try:
            return READERS[kind](scope)
        except Exception as exc:  # noqa: BLE001 — a kind unread is said; the page still stands
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, f"discover: the {kind} reader failed", counter=f"discover.{kind}")
            return Found(said=[f"{TITLES[kind]} could not be read ({type(exc).__name__})"])
    with ThreadPoolExecutor(max_workers=len(kinds), thread_name_prefix="discover") as pool:
        futures = {k: pool.submit(contextvars.copy_context().run, run, k) for k in kinds}
        return {k: f.result() for k, f in futures.items()}


def order_key(i: Item) -> tuple:
    """Where an item stands among its kind: the vouched-for first, the warned-off last, then its own standing, the newest,
    its name. Search breaks a tie in relevance by it."""
    mark = (i.certification or {}).get("status")
    return (0 if mark == "certified" else 2 if mark == "deprecated" else 1,
            _STATE_RANK.get(i.state, 1), _negated(i.updated_at), i.name.lower())


def _order(items: list[Item]) -> list[Item]:
    return sorted(items, key=order_key)


def _negated(at: str) -> tuple:
    """A timestamp sorted newest first, as a key; the undated last."""
    return (0, tuple(-ord(ch) for ch in at)) if at else (1, ())


def areas_in_view(scope: Scope) -> dict[str, dict]:
    """``id → area`` over every connection in view, the same id on two connections being one Area."""
    from pramanyx.semantic.areas import areas_for
    from pramanyx.semantic.metric_map import OTHER_QUESTION
    out: dict[str, dict] = {}
    for conn in scope.connections:
        try:
            listed = areas_for(conn, workspace_id=scope.workspace_id)
        except Exception as exc:  # noqa: BLE001 — a connection's areas unread: its things stand in Everything else
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "discover: a connection's areas could not be read", counter="discover.areas")
            continue
        for a in listed:
            have = out.setdefault(a["id"], {**a, "connections": []})
            have["connections"].append(conn)
    out[OTHER] = {"id": OTHER, "name": "Everything else", "question": OTHER_QUESTION, "parent": "",
                  "business_owners": [], "technical_owners": [], "source": "platform", "pack_id": "",
                  "connections": list(scope.connections)}
    return out


def all_items(found: dict[str, Found]) -> list[Item]:
    """Every item read, each in an Area — what none holds stands in Everything else."""
    items = [i for f in found.values() for i in f.items]
    for i in items:
        if not i.area:
            i.area = OTHER
    return items


def _area_view(a: dict, held: list[Item]) -> dict:
    counts = Counter(i.kind for i in held)
    return {"id": a["id"], "name": a["name"], "question": a.get("question", ""), "parent": a.get("parent", ""),
            "business_owners": a.get("business_owners", []), "technical_owners": a.get("technical_owners", []),
            "source": a.get("source", ""), "connections": a.get("connections", []),
            "counts": {k: counts[k] for k in KINDS if counts[k]}, "total": len(held),
            "deprecated": sum(1 for i in held if i.state == "deprecated"
                              or (i.certification or {}).get("status") == "deprecated")}


def _kind_view(kind: str, items: list[Item], withheld: int, shown: int = SHOWN) -> dict:
    ordered = _order(items)
    return {"kind": kind, "title": TITLES[kind], "count": len(items), "withheld": withheld,
            "states": dict(Counter(i.state for i in items if i.state)),
            "items": [i.view() for i in ordered[:shown]]}


def home(scope: Scope) -> dict:
    """The page: the Areas that hold something (and apart, those that hold nothing yet), what is certified, each kind
    with its first few, what the person may not open counted, and what could not be read said."""
    found = gather(scope)
    items = all_items(found)
    areas = areas_in_view(scope)
    by_area: dict[str, list[Item]] = {}
    for i in items:
        by_area.setdefault(i.area if i.area in areas else OTHER, []).append(i)
    holding = [_area_view(a, by_area[a_id]) for a_id, a in areas.items() if by_area.get(a_id) and a_id != OTHER]
    holding.sort(key=lambda a: -a["total"])
    if by_area.get(OTHER):
        holding.append(_area_view(areas[OTHER], by_area[OTHER]))
    quiet = [{"id": a_id, "name": a["name"], "question": a.get("question", "")}
             for a_id, a in areas.items() if a_id != OTHER and not by_area.get(a_id)]
    suggested: list[dict] = []
    if scope.curator:
        from pramanyx.semantic.areas import suggested_areas
        for conn, name in scope.connections.items():
            try:
                suggested += [{**s, "connection_id": conn, "connection_name": name} for s in suggested_areas(conn)]
            except Exception as exc:  # noqa: BLE001 — suggestions unread are only fewer suggestions
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "discover: a connection's suggested areas could not be read", counter="discover.suggested")
    certified = _order([i for i in items if (i.certification or {}).get("status") == "certified"])
    by_kind: dict[str, list[Item]] = {k: [] for k in KINDS}
    for i in items:
        by_kind[i.kind].append(i)
    return {
        "connections": [{"id": c, "name": n} for c, n in scope.connections.items()],
        "areas": holding, "quiet_areas": quiet, "suggested": suggested,
        "certified": [i.view() for i in certified[:SHOWN]], "certified_count": len(certified),
        "kinds": [_kind_view(k, by_kind[k], found[k].withheld) for k in KINDS],
        "withheld": {k: found[k].withheld for k in KINDS if found[k].withheld},
        "said": [s for k in KINDS for s in found[k].said],
    }


def _matches(i: Item, q: str) -> bool:
    words = q.lower().split()
    text = f"{i.name} {i.line}".lower()
    return all(w in text for w in words)


def list_items(scope: Scope, *, kind: str = "", area: str = "", certified: bool = False, mine: bool = False,
               q: str = "", cursor: int = 0, limit: int = 50) -> dict:
    """Every thing of a kind, an Area or both, in order, a page at a time — what "View all" opens. ``mine`` keeps what
    the person owns; ``q`` matches the words of a thing's name and line (the meaning search is D3's)."""
    kinds = (kind,) if kind else KINDS
    found = gather(scope, kinds)
    items = all_items(found)
    if area:
        items = [i for i in items if i.area == area]
    if certified:
        items = [i for i in items if (i.certification or {}).get("status") == "certified"]
    if mine:
        me = who_of(scope.person).lower()
        items = [i for i in items if me and who_of(i.owner).lower() == me]
    if q.strip():
        items = [i for i in items if _matches(i, q)]
    ordered = _order(items)
    page = ordered[cursor:cursor + limit]
    nxt = cursor + limit if cursor + limit < len(ordered) else None
    return {"items": [i.view() for i in page], "total": len(ordered), "next_cursor": nxt,
            "withheld": {k: found[k].withheld for k in kinds if found[k].withheld},
            "said": [s for k in kinds for s in found[k].said]}


def area_page(scope: Scope, area_id: str) -> Optional[dict]:
    """One Area's page: the Area, its sub-areas, what it holds by kind. None when no connection in view has it."""
    areas = areas_in_view(scope)
    a = areas.get(area_id)
    if a is None:
        return None
    found = gather(scope)
    items = all_items(found)
    held = [i for i in items if i.area == area_id]
    by_kind: dict[str, list[Item]] = {k: [] for k in KINDS}
    for i in held:
        by_kind[i.kind].append(i)
    children = []
    for c_id, c in areas.items():
        if c.get("parent") == area_id:
            children.append(_area_view(c, [i for i in items if i.area == c_id]))
    return {"area": _area_view(a, held), "children": children,
            "kinds": [_kind_view(k, by_kind[k], 0, shown=len(by_kind[k])) for k in KINDS if by_kind[k]],
            "empty_kinds": [k for k in KINDS if not by_kind[k]],
            "said": [s for k in KINDS for s in found[k].said]}
