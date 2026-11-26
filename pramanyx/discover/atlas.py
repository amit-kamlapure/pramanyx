"""The Atlas, by Area — the organisation's map (2026-11-25, the Atlas-by-Area plan's A4a —
`docs/AREA_MAP_PLAN_2026-11-25.md` §3.1).

The Ontology page opened on one connection's entities; this is what it opens on now: the organisation's Areas across
every connection in view, each with what it holds (Discover's own reading, `discover.service`), how many of the month's
answers drew on it, and what waits for review in it — and, for the side panel, the month's answers, the share that drew
on governed knowledge, the share placed in an Area, who answers for the Areas, what is used most. Stores nothing.

- **Answers per Area** come from the answers' receipts: each says which tables its SQL read, and each table stands in
  the Area Discover places it in. An answer that read tables in two Areas drew on both. Every answer that ran SQL
  carries a receipt, so the month is counted back thirty days, not from today.
- **Governed reach** — of those answers, the ones that drew on an approved metric (its formula used, the receipt's
  `metric_used`), an approved trusted query (`trusted`), or a published Definition given to it (`given`, recorded since
  `trust.answer_inputs.RECORDED_SINCE` — said so).
- **Area coverage** — of those answers, the ones that read at least one table placed in an Area.
- **Review and learned, per Area** — the review queue and the learned list of each connection, added up. They are slow
  to read (seconds a connection), so they are kept and read again off the request every ten minutes, as Discover keeps
  a connection's table reads (`discover.usage.table_reads`); until the first reading lands the page says so.
- **Suggested Areas** (a curator's) are kept with that reading — reading them decodes every saved ontology, and a load
  that read them beside a reading waited nine seconds (2026-11-25) — and served less any taken or refused since.
"""
from __future__ import annotations

import contextvars
import logging
import re
import threading
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

#: The receipts an answer writes (`routers.investigations._write_answer_receipt`): a quick answer's, a deep run's.
RECEIPT_KINDS = ("chat_answer", "ada_report")
#: "This month": the last thirty days, as Discover counts use.
WINDOW_DAYS = 30
#: How long a reading of the review queues and learned lists is kept before it is read again, off the request.
SLOW_FRESH_S = 600
#: Where the last reading is kept across a restart (the kernel ledger's kv).
SLOW_STORE = "atlas_slow"
#: The most of the month's receipts read — far above a month's answers on any install measured.
MAX_RECEIPTS = 20_000
#: A pause between one connection's reading and the next, so a page load in between is not kept waiting (measured
#: 2026-11-25: a fifteen-second reading took a load from 2.1 s to 3–4 s while it ran).
PAUSE_S = 0.3
#: A reading kept across a restart is served as it is for the first ten minutes after it, rather than read again on
#: the first visit — when every read is cold and a load ran ten seconds (2026-11-25) — unless it is older than this.
KEPT_SERVED_S = 3600
#: A page that took this long says in the API's log which part of it took the time.
SLOW_LOAD_MS = 4000

_log = logging.getLogger(__name__)

_slow: dict[tuple, tuple[float, dict]] = {}
_reading: set[tuple] = set()
_slow_lock = threading.Lock()


def _bare(table: str) -> str:
    """A table as a receipt names it — qualified, quoted — as Discover names it: the last part, lower case."""
    return re.split(r"\.", str(table or "").strip().strip("`\"'"))[-1].strip("`\"'").lower()


def _when(at: Any) -> Optional[datetime]:
    try:
        t = datetime.fromisoformat(str(at or "").replace("Z", "+00:00").replace(" ", "T"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def answers(scope, items: list, *, now: Optional[datetime] = None) -> dict:
    """The month's answers on the connections in view: how many, the month before's, how many drew on governed
    knowledge, how many read a table placed in an Area, and how many drew on each Area."""
    from pramanyx.discover.service import OTHER
    from pramanyx.kernel.ledger import Ledger
    table_area = {(i.connection_id, i.name.lower()): i.area for i in items
                  if i.kind == "table" and i.area and i.area != OTHER}
    approved_metric = {i.id for i in items if i.kind == "metric" and i.state == "approved"}
    published = {i.id for i in items if i.kind == "definition" and i.state == "published"}
    now = now or datetime.now(timezone.utc)
    since, before = now - timedelta(days=WINDOW_DAYS), now - timedelta(days=2 * WINDOW_DAYS)
    recent: list[dict] = []
    previous = 0
    for a in Ledger.default().artifacts_since(list(RECEIPT_KINDS), (before - timedelta(days=1)).isoformat(),
                                              conn_ids=list(scope.connections), limit=MAX_RECEIPTS):
        if a.get("conn_id") not in scope.connections:
            continue
        at = _when(a.get("created_at"))
        if at is None:
            continue
        if at >= since:
            recent.append(a)
        elif at >= before:
            previous += 1
    conn_of = {a["id"]: a.get("conn_id") or "" for a in recent}
    governed: set[str] = set()
    for art_id, relation, ref, _detail in Ledger.default().lineage_of_many(
            list(conn_of), relations=["metric_used", "trusted", "given"]):
        ref = str(ref or "")
        if relation == "trusted":
            governed.add(art_id)
        elif relation == "metric_used" and f"{conn_of.get(art_id, '')}/{ref.removeprefix('metric:')}" in approved_metric:
            governed.add(art_id)
        elif relation == "given" and ref.startswith("definition:") and ref[len("definition:"):] in published:
            governed.add(art_id)
    per_area: Counter = Counter()
    placed = 0
    for a in recent:
        payload = a.get("payload") if isinstance(a.get("payload"), dict) else {}
        drew = {table_area.get((a.get("conn_id"), _bare(t))) for t in (payload.get("tables") or [])} - {None}
        if drew:
            placed += 1
        per_area.update(drew)
    return {"answers": len(recent), "previous": previous, "governed": len(governed), "in_an_area": placed,
            "per_area": dict(per_area)}


def _slow_key(scope) -> tuple:
    from pramanyx.org.context import current_org_id
    return (current_org_id() or "", str(scope.person or ""), tuple(sorted(scope.connections)))


def _read_slow(key: tuple, connections: dict[str, str]) -> None:
    """Each connection's review queue and learned list, added up by Area — kept, and in the ledger across a restart."""
    from pramanyx.kernel.errors import tolerate
    from pramanyx.knowledge.learned import learned_items, read_once
    from pramanyx.knowledge.review import review
    from pramanyx.semantic.areas import suggestions_read_once
    by_area: dict[str, Counter] = {}
    out = {"review_total": 0, "review_unplaced": 0, "learned_total": 0, "learned_unplaced": 0, "unread": [],
           "suggested": {}, "review_items": []}
    try:
        # the review queue reads each learned list and each connection's suggestions too: read once, for both
        with read_once(), suggestions_read_once():
            _read_each(connections, by_area, out, review, learned_items, tolerate)
        out["areas"] = {a: dict(c) for a, c in by_area.items()}
        _keep(key, out)
    finally:
        with _slow_lock:           # never left "being read" by a reading that failed: the next visit reads again
            _reading.discard(key)


def _read_each(connections: dict[str, str], by_area: dict, out: dict, review, learned_items, tolerate) -> None:
    for n, (conn, name) in enumerate(connections.items()):
        if n:
            time.sleep(PAUSE_S)
        try:
            r = review(conn, limit=10_000)
            out["review_total"] += int(r.get("total") or 0)
            out["review_unplaced"] += int(r.get("unplaced") or 0)
            # each row kept for review by Area (A5), with the connection it waits on
            out["review_items"] += [{**i, "connection_id": conn, "connection_name": name} for i in r.get("items") or []]
            for i in r.get("items") or []:
                for a in [x for x in str(i.get("area") or "").split(",") if x]:
                    by_area.setdefault(a, Counter())[str(i.get("kind") or "")] += 1
        except Exception as exc:  # noqa: BLE001 — a connection unread is said, never counted as none
            tolerate(exc, f"the Atlas could not read {conn}'s review queue", counter="atlas.review")
            out["unread"].append(f"what waits for review on {name}")
        try:
            got = learned_items(conn, limit=10_000)
            out["learned_total"] += int(got.get("total") or 0)
            for i in got.get("items") or []:
                if i.get("area"):
                    by_area.setdefault(i["area"], Counter())["learned"] += 1
                else:
                    out["learned_unplaced"] += 1
        except Exception as exc:  # noqa: BLE001
            tolerate(exc, f"the Atlas could not read what was learned on {conn}", counter="atlas.learned")
            out["unread"].append(f"what was learned on {name}")
        from pramanyx.semantic.areas import suggested_areas
        try:
            out["suggested"][conn] = suggested_areas(conn)
        except Exception as exc:  # noqa: BLE001 — suggestions unread are only fewer suggestions, and said
            tolerate(exc, f"the Atlas could not read the Areas suggested on {conn}", counter="atlas.suggested")
            out["unread"].append(f"the Areas suggested on {name}")


def _keep(key: tuple, out: dict) -> None:
    from pramanyx.kernel.errors import tolerate
    out["at"] = datetime.now(timezone.utc).isoformat()
    with _slow_lock:
        _reading.discard(key)
        _slow[key] = (time.monotonic(), out)
    try:
        from pramanyx.kernel.ledger import Ledger
        Ledger.default().kv_put(SLOW_STORE, "|".join([key[0], key[1], ",".join(key[2])]), out)
    except Exception as exc:  # noqa: BLE001 — kept in memory all the same
        tolerate(exc, "the Atlas's reading was not kept across a restart", counter="atlas.kept")


def slow_parts(scope, *, wait: bool = False) -> tuple[Optional[dict], list[str]]:
    """The review queues and learned lists of the connections in view, added up by Area, from what is kept — and what
    is not read yet, said. Read again off the request when older than ten minutes; ``wait`` reads it here (a test)."""
    key = _slow_key(scope)
    with _slow_lock:
        kept = _slow.get(key)
    if kept is None:
        try:
            from pramanyx.kernel.ledger import Ledger
            back = Ledger.default().kv_get(SLOW_STORE, "|".join([key[0], key[1], ",".join(key[2])]))
            if isinstance(back, dict) and isinstance(back.get("areas"), dict):
                age = (datetime.now(timezone.utc) - (_when(back.get("at")) or datetime.now(timezone.utc))).total_seconds()
                # kept across a restart: served as it is for ten minutes from now when under an hour old (it says
                # when it was read), rather than read again on the first, coldest visit
                kept = (time.monotonic() - (0.0 if age < KEPT_SERVED_S else max(0.0, age)), back)
                with _slow_lock:
                    _slow.setdefault(key, kept)
        except Exception as exc:  # noqa: BLE001 — nothing kept is nothing to show; it is read again
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "the Atlas's kept reading could not be read back", counter="atlas.kept_back")
    stale = kept is None or time.monotonic() - kept[0] > SLOW_FRESH_S
    with _slow_lock:
        start = stale and key not in _reading
        if start:
            _reading.add(key)
    if start:
        if wait:
            _read_slow(key, dict(scope.connections))
        else:
            ctx = contextvars.copy_context()
            threading.Thread(target=ctx.run, args=(_read_slow, key, dict(scope.connections)), daemon=True,
                             name="atlas-slow").start()
    with _slow_lock:
        kept = _slow.get(key)
    if kept is None:
        return None, ["What waits for review and what was learned, by Area, is being read; it shows on the next visit."]
    return kept[1], [f"Not read: {', '.join(kept[1]['unread'])}." ] if kept[1].get("unread") else []


def _weight(i: dict) -> int:
    """A review row's weight, as the queue weighs it: how often asked, and twice each complaint."""
    return int(i.get("count") or 1) + 2 * int(i.get("complaints") or 0)


def set_aside_rows() -> set[str]:
    """The review rows a person set aside in the Inbox ("Not now", 2026-11-26), each ``<connection>:<row id>``, until their
    day — off every list of what waits, as Now leaves what was set aside off its own."""
    try:
        from pramanyx.record.set_aside import listing
        return {str(x.get("ref") or "") for x in listing()["active"] if x.get("item_kind") == "review"}
    except Exception as exc:  # noqa: BLE001 — unread, nothing is hidden: a row shows rather than vanish unsaid
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the set-aside review rows could not be read", counter="atlas.set_aside")
        return set()


def review_in(scope, area_id: str = "") -> dict:
    """What waits for review in an Area across the connections in view, its sub-Areas' rolled up into it (the Atlas
    plan's §3.4, A5) — or, ``"none"``, what waits in no Area; ``""`` every row. From the kept reading, never read here:
    the rows are as old as it (``read_at``), and a reading not landed yet is said."""
    from pramanyx.discover.service import areas_in_view, newest_first
    slow, said = slow_parts(scope)
    if slow is None:
        return {"area": area_id, "items": [], "within": [], "by_source": {}, "total": 0, "set_aside": 0, "read_at": None, "said": said}
    areas = areas_in_view(scope)
    within: list[str] = []
    if area_id and area_id != "none":
        within, frontier = [area_id], [area_id]
        while frontier:                       # every Area under it, however deep
            below = [a_id for a_id, a in areas.items() if a.get("parent") in frontier and a_id not in within]
            within += below
            frontier = below
    wanted = set(within)

    def placed(i: dict) -> bool:
        mine = {a for a in str(i.get("area") or "").split(",") if a}
        return (not mine) if area_id == "none" else (not area_id or bool(mine & wanted))
    aside = set_aside_rows()
    here = [i for i in slow.get("review_items") or [] if placed(i)]
    kept = [i for i in here if f"{i.get('connection_id') or ''}:{i['id']}" not in aside]
    rows = sorted(kept,
                  key=lambda i: (-_weight(i), newest_first(str(i.get("at") or "")), i["id"]))
    return {"area": area_id, "items": rows, "within": within[1:], "by_source": dict(Counter(i["source"] for i in rows)),
            "total": len(rows), "set_aside": len(here) - len(kept), "read_at": slow.get("at"),
            "said": [*said, *([] if "review_items" in slow else
                              ["What waits for review is being read again to list it by Area; it shows on the next visit."])]}


def atlas(scope, *, wait: bool = False) -> dict:
    """The organisation's map: every Area in view that holds something or that answers drew on — what it holds, the
    answers that drew on it, what waits for review in it, what was learned in it — the Areas that hold nothing apart,
    the model's suggestions, and the side panel's figures."""
    from pramanyx.discover.service import OTHER, all_items, area_view, areas_in_view, by_use, gather, put_use
    from pramanyx.trust.answer_inputs import RECORDED_SINCE
    took: dict[str, int] = {}
    clock = [time.perf_counter()]

    def step(name: str) -> None:       # how long each part of the page took — so a slow load says which part it was
        now = time.perf_counter()
        took[name] = round(1000 * (now - clock[0]))
        clock[0] = now

    found = gather(scope)
    items = all_items(found)
    step("gather")
    use_said = put_use(items)          # each item's use this month, as Discover reads it — for "used most"
    step("use")
    areas = areas_in_view(scope)
    held: dict[str, list] = {}
    for i in items:
        held.setdefault(i.area if i.area in areas else OTHER, []).append(i)
    step("areas")
    month = answers(scope, items)
    step("answers")
    slow, said = slow_parts(scope, wait=wait)
    step("review_and_learned")
    slow_areas = (slow or {}).get("areas") or {}

    def row(a_id: str, a: dict) -> dict:
        view = area_view(a, held.get(a_id, []))
        waits = slow_areas.get(a_id) or {}
        return {**view, "answers": int(month["per_area"].get(a_id, 0)),
                "review": None if slow is None else {k: int(waits.get(k, 0)) for k in ("gap", "candidate", "conflict")},
                "learned": None if slow is None else int(waits.get("learned", 0))}

    shown = [row(a_id, a) for a_id, a in areas.items()
             if a_id != OTHER and (held.get(a_id) or month["per_area"].get(a_id))]
    shown.sort(key=lambda r: (-r["answers"], -r["total"], r["name"]))
    quiet = [{"id": a_id, "name": a["name"], "question": a.get("question", "")} for a_id, a in areas.items()
             if a_id != OTHER and not held.get(a_id) and not month["per_area"].get(a_id)]
    declared = [a for a_id, a in areas.items() if a_id != OTHER]
    suggested: list[dict] = []
    if scope.curator:
        from pramanyx.semantic.areas import still_suggested, suggested_areas
        kept_suggested = (slow or {}).get("suggested") or {}
        for conn, name in scope.connections.items():
            try:
                # as the reading kept them, less any taken or refused since; read here only when no reading holds them
                # (the first visit, a reading from before they were kept, a connection the reading could not read)
                got = (still_suggested(conn, kept_suggested[conn], declared) if conn in kept_suggested
                       else suggested_areas(conn))
                suggested += [{**s, "connection_id": conn, "connection_name": name} for s in got]
            except Exception as exc:  # noqa: BLE001 — suggestions unread are only fewer suggestions
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "the Atlas: a connection's suggested areas could not be read", counter="atlas.suggested")
    step("suggested")
    most_used = [i.view() for i in by_use(items, ("opens", "uses"))[:6]]
    step("most_used")
    if sum(took.values()) >= SLOW_LOAD_MS:
        _log.info("the Atlas took %d ms: %s", sum(took.values()), took)
    return {
        "connections": [{"id": c, "name": n} for c, n in scope.connections.items()],
        "areas": shown,
        "everything_else": {**area_view(areas[OTHER], held.get(OTHER, [])), "answers": month["answers"] - month["in_an_area"]},
        "quiet": quiet,
        "suggested": suggested,
        "figures": {"answers": month["answers"], "previous": month["previous"], "governed": month["governed"],
                    "in_an_area": month["in_an_area"], "window_days": WINDOW_DAYS, "given_since": RECORDED_SINCE},
        "contacts": {"named": sum(1 for a in declared if a.get("business_owners") or a.get("technical_owners")),
                     "of": len(declared)},
        "most_used": most_used,
        "review": None if slow is None else {"total": slow["review_total"], "unplaced": slow["review_unplaced"]},
        "learned": None if slow is None else {"total": slow["learned_total"], "unplaced": slow["learned_unplaced"]},
        "read_at": (slow or {}).get("at"),
        "said": [*said, *use_said, *[s for k in found for s in found[k].all_said()]],
        "took_ms": took,
    }
