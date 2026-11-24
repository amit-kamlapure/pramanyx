"""Use, read from what happened (Discover D5; docs/DISCOVER_PLAN_2026-11-23.md §4.5).

Two records, and neither is a new store:

- a TABLE's reads: the audited statements of the last thirty days that named it, and how many people the session log
  names for the runs that issued them — the reads the Ontology's drawer shows (`ontology.entity_uses.window_reads`).
  One scan of the statement log is seconds on a big install, so a connection's reads are kept here a few minutes and
  read again off the request: a page never waits for them, and one not read yet is said.
- a thing's OPENS: ``thing.opened`` in the journal, written on each thing's own read route when a person — never an
  agent — reads it (`note_opened`), at most once a person and a thing in ten minutes, so a page read again on a refresh
  is not a second open.

Measured 2026-11-24, the premise: no route recorded an open; the statement log kept no person (it names one since), and
the session log named one only for the runs it kept, so who read a table before then is often not known — said, never
counted as nobody. A metric has no read route of its own, so its page says it was opened; a trusted query's use is the
answers it guided (`note_used`).
"""
from __future__ import annotations

import contextvars
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

#: The journal kind of an open.
OPENED = "thing.opened"
#: The journal kind of a use that is not an open: a trusted query that guided an answer.
USED = "thing.used"
#: "This month": the last thirty days, today included.
WINDOW_DAYS = 30
#: A person reading the same thing again within this long has not opened it again.
AGAIN_AFTER_S = 600
#: How long a connection's table reads are kept before they are read again.
READS_FRESH_S = 600
#: Where the last reading of each connection's table reads is kept across a restart (the kernel ledger's kv).
READS_STORE = "discover_reads"
#: What each kind's use is measured from; a kind not named is not measured.
MEASURED = {"table": "reads", "dashboard": "opens", "canvas": "opens", "agent": "opens", "schedule": "opens",
            "document": "opens", "sheet": "opens", "definition": "opens",
            # a metric has no read route of its own: its page says it was opened (`POST /discover/opened`, 2026-11-24)
            "metric": "opens",
            # a trusted query is used when it guides an answer, which is what it is for (`note_used`)
            "trusted_query": "uses"}

_seen: dict[tuple, float] = {}
_seen_lock = threading.Lock()
#: Whether this process has read the last ten minutes' opens back from the journal (`_seed_seen`).
_seeded = False
_reads: dict[tuple[str, str], tuple[float, dict[str, dict]]] = {}
_reading: set[tuple[str, str]] = set()
_reads_lock = threading.Lock()


def note_opened(request: Any, kind: str, ref: str, connection_id: str = "") -> None:
    """A person opened ``kind`` ``ref`` on its own page: kept in the journal, once a person and a thing in ten minutes.
    An agent's read is not an open. Best effort: the page is read whether or not its open is kept."""
    if not ref or MEASURED.get(kind) != "opens":
        return
    try:
        if request is not None:
            from pramanyx.rbac.agent_gate import is_agent_request
            if is_agent_request(request):
                return
        from pramanyx.security.authz import acting_person, get_principal
        by = acting_person(get_principal(request)) if request is not None else ""
        if not by:
            return
        key = (by, kind, connection_id or "", ref)
        now = time.monotonic()
        with _seen_lock:
            _seed_seen(now)
            if now - _seen.get(key, -AGAIN_AFTER_S - 1) < AGAIN_AFTER_S:
                return
            _seen[key] = now
            if len(_seen) > 20_000:
                for k in [k for k, at in _seen.items() if now - at >= AGAIN_AFTER_S]:
                    _seen.pop(k, None)
        from pramanyx.kernel.ledger import Ledger
        Ledger.default().emit(OPENED, {"kind": kind, "ref": ref, "connection_id": connection_id or "", "by": by},
                              conn_id=connection_id or None)
    except Exception as exc:  # noqa: BLE001 — see the docstring
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, f"an open of the {kind} {ref} was not kept", counter="discover.opened")


def note_used(kind: str, ref: str, connection_id: str = "") -> None:
    """A thing used for what it is for — a trusted query that guided an answer — kept in the journal under who the
    request or the job acts for. Every use counts: an answer is not a page read again. Best effort."""
    if not ref or MEASURED.get(kind) != "uses":
        return
    try:
        from pramanyx.kernel.ledger import Ledger
        from pramanyx.org.context import current_actor
        Ledger.default().emit(USED, {"kind": kind, "ref": ref, "connection_id": connection_id or "",
                                     "by": current_actor()}, conn_id=connection_id or None)
    except Exception as exc:  # noqa: BLE001 — see the docstring
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, f"a use of the {kind} {ref} was not kept", counter="discover.used")


def _seed_seen(now: float) -> None:
    """The opens of the last ten minutes, read back from the journal the first time this process notes one: kept in
    memory alone, a page read again just after a restart was a second open (2026-11-24). Held under ``_seen_lock``.
    Best effort: unread, an open may be counted twice, and nothing else."""
    global _seeded
    if _seeded:
        return
    _seeded = True
    try:
        from pramanyx.kernel.ledger import Ledger
        wall = datetime.now(timezone.utc)
        since = (wall - timedelta(seconds=AGAIN_AFTER_S)).isoformat()
        for e in Ledger.default().events(kind=OPENED, since=since, limit=5_000):
            p = e.get("payload") or {}
            try:
                age = (wall - datetime.fromisoformat(str(e.get("at") or ""))).total_seconds()
            except ValueError:
                continue
            key = (str(p.get("by") or ""), str(p.get("kind") or ""), str(p.get("connection_id") or ""), str(p.get("ref") or ""))
            _seen[key] = max(_seen.get(key, -AGAIN_AFTER_S - 1), now - max(0.0, age))
    except Exception as exc:  # noqa: BLE001 — see the docstring
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the last opens could not be read back from the journal", counter="discover.opened_seed")


def _org() -> Optional[str]:
    from pramanyx.org.context import current_org_id
    return current_org_id() or None


def opens(*, days: int = WINDOW_DAYS, now: Optional[datetime] = None, kind: str = OPENED) -> list[dict]:
    """The opens (or, with ``kind=USED``, the uses) of the last ``days`` days, newest first: ``{kind, ref, by, at}``."""
    from pramanyx.kernel.ledger import Ledger
    since = ((now or datetime.now(timezone.utc)) - timedelta(days=days)).isoformat()
    out = []
    for e in Ledger.default().events(kind=kind, since=since, limit=50_000, org_id=_org()):
        p = e.get("payload") or {}
        if p.get("kind") and p.get("ref"):
            out.append({"kind": str(p["kind"]), "ref": str(p["ref"]), "by": str(p.get("by") or ""),
                        "at": str(e.get("at") or "")})
    return out


def _read_tables(org: Optional[str], connection_id: str, tables: dict[str, list[str]]) -> None:
    from pramanyx.ontology.entity_uses import window_reads
    try:
        got = window_reads(connection_id, tables, days=WINDOW_DAYS)
    except Exception as exc:  # noqa: BLE001 — unread reads stay unread, and are said so
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, f"discover: the reads of {connection_id}'s tables could not be read", counter="discover.reads")
        got = None
    with _reads_lock:
        _reading.discard((org or "", connection_id))
        if got is not None:
            _reads[(org or "", connection_id)] = (time.monotonic(), got)
    if got is not None:
        try:
            from pramanyx.kernel.ledger import Ledger
            Ledger.default().kv_put(READS_STORE, f"{org or ''}:{connection_id}",
                                    {"at": datetime.now(timezone.utc).isoformat(), "reads": got})
        except Exception as exc:  # noqa: BLE001 — kept in memory all the same; a restart reads them again
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, f"discover: the reads of {connection_id}'s tables were not kept", counter="discover.reads_kept")


def _kept_reads(org: Optional[str], connection_id: str) -> Optional[tuple[float, dict]]:
    """The last reading of a connection's table reads kept across a restart, aged as it is: so the first visit after a
    restart shows the last reads while they are read again, rather than saying they are being read (2026-11-24)."""
    try:
        from pramanyx.kernel.ledger import Ledger
        kept = Ledger.default().kv_get(READS_STORE, f"{org or ''}:{connection_id}")
        if not isinstance(kept, dict) or not isinstance(kept.get("reads"), dict):
            return None
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(str(kept.get("at") or ""))).total_seconds()
        return time.monotonic() - max(0.0, age), kept["reads"]
    except Exception:  # noqa: BLE001 — nothing kept is nothing to show; the reads are read again
        return None


def table_reads(tables_by_connection: dict[str, dict[str, list[str]]], *, wait: bool = False) -> tuple[dict[str, dict], list[str]]:
    """Each table item's reads of the last thirty days, by item id, from what is kept — and what is not read yet, said.
    A connection never read, or read more than ten minutes ago, is read again on a thread of its own; ``wait`` reads it
    here (a test, a first read that may block)."""
    org = _org()
    out: dict[str, dict] = {}
    said: list[str] = []
    for conn, tables in tables_by_connection.items():
        if not tables:
            continue
        key = (org or "", conn)
        with _reads_lock:
            missing = key not in _reads
        if missing:
            back = _kept_reads(org, conn)
            if back is not None:
                with _reads_lock:
                    _reads.setdefault(key, back)
        with _reads_lock:
            kept = _reads.get(key)
            stale = kept is None or time.monotonic() - kept[0] > READS_FRESH_S
            start = stale and key not in _reading
            if start:
                _reading.add(key)
        if start:
            if wait:
                _read_tables(org, conn, tables)
            else:
                ctx = contextvars.copy_context()
                threading.Thread(target=ctx.run, args=(_read_tables, org, conn, tables), daemon=True,
                                 name=f"discover-reads-{conn}").start()
        with _reads_lock:
            kept = _reads.get(key)
        if kept is None:
            said.append("How often tables were read this month is being read; it shows on the next visit.")
            continue
        out.update({k: v for k, v in kept[1].items() if k in tables})
    return out, sorted(set(said))


def use_of(items: Iterable[Any], *, wait: bool = False) -> tuple[dict[str, dict], list[str]]:
    """Each item's use this month, by id — reads for a table, opens for the kinds a person opens; none for a kind not
    measured — and what could not be said yet."""
    items = list(items)
    tables: dict[str, dict[str, list[str]]] = {}
    for i in items:
        if i.kind == "table" and i.connection_id:
            tables.setdefault(i.connection_id, {})[i.id] = [i.name]
    reads, said = table_reads(tables, wait=wait)
    opened: dict[tuple[str, str], dict] = {}
    opens_read = True
    try:
        for o in [*opens(), *opens(kind=USED)]:
            row = opened.setdefault((o["kind"], o["ref"]), {"opened": 0, "people": set(), "last": ""})
            row["opened"] += 1
            if o["by"]:
                row["people"].add(o["by"].lower())
            row["last"] = max(row["last"], o["at"])
    except Exception as exc:  # noqa: BLE001 — opens unread are said, not counted as none
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "discover: the journal's opens could not be read", counter="discover.opens")
        said.append("What was opened this month could not be read.")
        opens_read = False
    out: dict[str, dict] = {}
    for i in items:
        how = MEASURED.get(i.kind)
        if how == "reads" and i.id in reads:
            r = reads[i.id]
            out[i.id] = {"measured": "reads", "count": int(r.get("reads") or 0), "people": r.get("readers"),
                         "unattributed": r.get("unattributed"), "last": r.get("last_read") or None}
        elif how in ("opens", "uses") and opens_read:
            o = opened.get((i.kind, i.id))
            out[i.id] = {"measured": how, "count": o["opened"] if o else 0, "people": len(o["people"]) if o else 0,
                         "unattributed": 0, "last": (o["last"] or None) if o else None}
    return out, said


def score(use: Optional[dict]) -> int:
    return int((use or {}).get("count") or 0)


def recently_opened(items: Iterable[Any], person: str, *, limit: int = 6) -> list[Any]:
    """What ``person`` opened lately, newest first, each once — among ``items``, what they may still see."""
    me = (person or "").strip().lower()
    if not me:
        return []
    by_key = {(i.kind, i.id): i for i in items}
    out: list[Any] = []
    seen: set[tuple[str, str]] = set()
    for o in opens():
        k = (o["kind"], o["ref"])
        if o["by"].lower() != me or k in seen or k not in by_key:
            continue
        seen.add(k)
        out.append(by_key[k])
        if len(out) >= limit:
            break
    return out
