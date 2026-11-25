"""What the platform has learned about a connection, read as one kind (the ontology study, Phase 1, 2026-11-17).

A governed ontology's learned knowledge is one shape — what it says, where it came from, who wrote it, the area of the
business it is about, how it stands, how fresh it is, what it rests on — whatever store it lives in. Here it lives in
four, each with its own lifecycle, and this module stores nothing: it reads them into that one shape.

- The explorer's findings and an answer's claims (the Record, kind ``finding`` / ``observation``): MEASURED by a run,
  CONFIRMED once a person said so; only a confirmed one is ground for an answer (2026-11-17).
- What people's own queries show (the Record, kind ``usage``): MINED from the warehouse's query history, read only
  when a first answer was inconclusive.
- Trusted queries (`semantic/trusted_queries.py`): APPROVED by the person (or eval suite) that verified them.

Each is held to the reader's clearance by the tables it rests on (`govern/retrieval_trim.py`), as the graph slice is;
what was withheld is counted. Placed in an area by what a person placed its tables in, else by its tables' names. How
often each was used is not counted yet, and is said so — never a number made up. No model, no warehouse.

One thing learned is one item (2026-11-25, the Atlas-by-Area plan's A0): the same statement booked twice, and one
re-check's restatement booked under each answer it moved, are folded into one — said with how many times, every ref
kept in ``also`` — never listed as several things the platform knows.
"""
from __future__ import annotations

import json
import re
from typing import Optional

#: How each store's word is said. The ORDER is the one standing's (`trust.standing`, A2): a person's word on a measured
#: result, then the data's, then a person's alone, then mined, then said — and `why` says where each stands.
SAID = {"approved": "confirmed by a person", "declared": "confirmed by a person", "trusted": "approved as a trusted query",
        "measured": "measured by a run", "mined": "mined from people's own queries", "said": "said, never measured"}
#: A person's word on what a run measured, as a reader is told it.
BOTH_SAID = {"approved": "confirmed by a person, measured by a run", "declared": "confirmed by a person, measured by a run",
             "trusted": "approved as a trusted query, and run"}


def _tables_of(sql: str) -> list[str]:
    from pramanyx.govern.retrieval_trim import tables_of_sql
    return tables_of_sql(sql)


def _item(*, kind: str, text: str, source: str, author: str, standing: str, as_of: str, tables: list[str],
          lineage: list[str], ref: str, measured: bool = False, uses: Optional[int] = None) -> dict:
    from pramanyx.trust.standing import Standing, tier_of
    said = SAID.get(standing, standing)
    stands = Standing(tier=tier_of(standing, measured=measured), uses=uses, as_of=as_of)
    return {"kind": kind, "text": text, "source": source, "author": author, "standing": standing, "standing_said": said,
            # where it stands in the one order, and why — a reader's words (A2)
            "why": stands.why(BOTH_SAID.get(standing, said) if stands.tier == "both" else said),
            "as_of": as_of, "tables": sorted({t.rsplit(".", 1)[-1] for t in tables if t}), "lineage": lineage, "ref": ref,
            "area": "", "uses": uses, "times": 1, "also": [], "_same": (kind, " ".join(text.lower().split())),
            "_standing": stands}


#: How a re-check's restatement ends: the answer it moved, named by that answer's own first words (`record.writers`).
FIRST_SAID = " First said: "


def _fold(items: list[dict]) -> list[dict]:
    """One item per thing learned, the first of each kept — the list comes in authority order, so the best-standing,
    newest one speaks for the rest — with how many times it was booked and the others' refs."""
    kept: dict = {}
    for i in items:
        same = kept.get(i["_same"])
        if same is None:
            kept[i["_same"]] = i
            continue
        same["times"] += 1
        same["also"].append(i["ref"])
    out = list(kept.values())
    for i in out:
        if i["times"] > 1 and i["_same"][0] == "restated":
            # one restatement under several answers: what changed, not one of the answers it moved
            i["text"] = i["text"].split(FIRST_SAID, 1)[0]
        i.pop("_same", None)
    return out


def learned_items(connection_id: str, *, about: str = "", limit: int = 50) -> dict:
    """``{"items": [...], "withheld": {...} | None, "uses_counted": False}`` — the learned knowledge of one connection in
    one shape, in the one authority order (confirmed and approved, then measured, then mined; the newest first among
    equals), optionally narrowed to items whose words or tables share a word with ``about``."""
    from pramanyx.record import claims as C
    items: list[dict] = []
    for kind in ("finding", "observation"):
        for c in C.list_claims(kind=kind, conn_id=connection_id, limit=2000):
            if c.state == "withdrawn":
                continue
            run = next((w for w in c.warrants if w.kind == "run"), None)
            tables = list(c.extra.get("tables") or []) or _tables_of(run.detail if run else "")
            item = _item(kind="finding" if c.extra.get("writer") == "explorer" else "answer",
                         text=c.statement.text, source=("the explorer" if c.extra.get("writer") == "explorer" else "an answer"),
                         author=c.extra.get("approved_by") or c.author, standing=c.tier, as_of=c.as_of,
                         tables=tables, lineage=[f"{w.kind}:{w.ref}" for w in c.warrants], ref=c.id,
                         measured=run is not None)
            if c.extra.get("restated_by") and c.extra.get("changes"):
                # the same numbers moved under several answers by one re-check: one thing learned
                item["_same"] = ("restated", json.dumps(c.extra["changes"], sort_keys=True, default=str))
            items.append(item)
    for c in C.list_claims(kind="usage", conn_id=connection_id, limit=2000):
        if c.state == "withdrawn":
            continue
        items.append(_item(kind="usage", text=c.statement.text, source="the warehouse's query history", author=c.author,
                           standing="mined", as_of=c.as_of, tables=_tables_of(str(c.extra.get("proposal") or "")),
                           lineage=[f"{w.kind}:{w.ref}" for w in c.warrants], ref=c.id))
    try:
        from pramanyx.discover.items import trusted_query_id
        from pramanyx.discover.usage import answers_of
        from pramanyx.semantic.trusted_queries import list_trusted
        for q in list_trusted(connection_id):
            run = bool(getattr(q, "last_executed_at", "") or (getattr(q, "verification", None) or {}).get("ok"))
            items.append(_item(kind="trusted_query", text=q.question, source=q.source or "a trusted query",
                               author=q.verified_by or q.proposed_by, standing="trusted",
                               as_of=(q.verified_at or q.proposed_at or "")[:10], tables=list(q.tables) or _tables_of(q.sql),
                               lineage=[f"sql:{q.sql[:160]}"], ref=q.id, measured=run,
                               # the answers it guided this month (A1) — counted for a trusted query, not yet the rest
                               uses=answers_of("trusted_query", f"{connection_id}/{trusted_query_id(connection_id, q)}")))
    except Exception as exc:  # noqa: BLE001 — unread, said by the count of what was read
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "trusted queries could not be read into the learned view", counter="learned.trusted")

    if about.strip():
        words = {w for w in re.findall(r"[a-z0-9]{3,}", about.lower())}
        items = [i for i in items if words & set(re.findall(r"[a-z0-9]{3,}", f"{i['text']} {' '.join(i['tables'])}".lower()))]

    from pramanyx.govern.retrieval_trim import trim_by_tables
    trimmed = trim_by_tables(items, lambda i: i["tables"], connection_id=connection_id)
    items = trimmed.kept
    _place(items, connection_id)
    # the one standing's order (A2), then the ref, so a tie is still one order
    items.sort(key=lambda i: (i["_standing"].key(), i["ref"]))
    booked = len(items)
    items = _fold(items)
    for i in items:
        i.pop("_standing", None)
    return {"items": items[:limit], "total": len(items), "folded": booked - len(items),
            "withheld": trimmed.to_dict() if trimmed.trimmed else None, "uses_counted": False}


def _place(items: list[dict], connection_id: str) -> None:
    """Each item's area: where a person placed its tables, else the area whose words name a table of it."""
    try:
        from pramanyx.semantic.areas import placed_by_people
        from pramanyx.semantic.metric_map import best_areas, map_for
        people = placed_by_people(connection_id)["tables"]
        named = [a for a in map_for(connection_id).areas if not a.generic]
    except Exception as exc:  # noqa: BLE001 — unplaced, said as such
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the learned view could not place items in areas", counter="learned.areas")
        return
    for i in items:
        for t in i["tables"]:
            if t.lower() in people:
                i["area"] = people[t.lower()][0]
                break
            hits = best_areas(t, named)
            if hits:
                i["area"] = hits[0][0].id
                break


def learned_line(item: dict) -> str:
    """One item as a reader is told it: what it says, and how it stands, where it came from and when."""
    area = f" · {item['area']}" if item.get("area") else ""
    times = f" · booked {item['times']} times" if item.get("times", 1) > 1 else ""
    return f"{item['text']} — {item['standing_said']}, from {item['source']}{area}, {item['as_of'] or 'undated'}{times}"


def area_filter(items: list[dict], area: Optional[str]) -> list[dict]:
    return [i for i in items if not area or i.get("area") == area]
