"""What changed about a table, and when (the user, 2026-11-25, "Catalog extras: table history").

One record per change, never per look. Whenever the platform builds a connection's rich schema — the Catalog reads it on
every visit, from the schema the connection last read — each table's shape is set against the last one kept: columns
added, taken away or given another type are a change, and so is its row count moving, said at most once a day (a table
that grows by the minute would otherwise be nothing but row counts). A change goes to the journal as ``table.changed``
(`kernel/events.CATALOGUE`); a person's edit of a table's words goes there too, with who. The first shape kept is not a
change: it is when watching began, and the table's page says so.

The shapes are kept in the kernel ledger's kv (``table_shapes``), one record per connection; the journal is the history.
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

#: The journal kind of a change to a table.
CHANGED = "table.changed"
#: Where each connection's last-seen table shapes are kept (the kernel ledger's kv).
SHAPES_STORE = "table_shapes"
#: A row count that moved is said at most this often for one table.
ROWS_EVERY = timedelta(hours=20)

_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _rows(value: Any) -> Optional[int]:
    try:
        return int(str(value).replace(",", "")) if value not in (None, "", "?") else None
    except (TypeError, ValueError):
        return None


def _shape(table: dict) -> dict:
    return {"columns": {str(c.get("name")): str(c.get("type") or "") for c in table.get("columns") or [] if c.get("name")},
            "rows": _rows(table.get("row_count"))}


def _changes(before: dict, after: dict) -> dict:
    """What differs between two shapes' columns: ``{added, removed, retyped}``, each empty when nothing did."""
    b, a = before.get("columns") or {}, after.get("columns") or {}
    return {"added": sorted(set(a) - set(b)), "removed": sorted(set(b) - set(a)),
            "retyped": [{"column": c, "from": b[c], "to": a[c]} for c in sorted(set(a) & set(b))
                        if b[c] and a[c] and b[c].upper() != a[c].upper()]}


def record_shapes(connection_id: str, tables: list[dict], *, now: Optional[datetime] = None) -> list[dict]:
    """Set each of ``tables`` (the rich schema's ``{name, row_count, columns: [{name, type}]}``) against the shape kept
    for it; journal what changed and keep the new shapes. Returns the changes journalled. Best effort: a schema read is
    never refused because its history could not be kept."""
    from pramanyx.kernel.ledger import Ledger
    stamp = (now or _now()).isoformat()
    ledger = Ledger.default()
    changes: list[dict] = []
    with _lock:
        kept = ledger.kv_get(SHAPES_STORE, connection_id)
        kept = kept if isinstance(kept, dict) else {}
        out = dict(kept)
        for table in tables or []:
            name = str(table.get("name") or "")
            if not name:
                continue
            shape = _shape(table)
            last = kept.get(name)
            if not isinstance(last, dict):
                out[name] = {**shape, "since": stamp, "rows_at": stamp}
                continue
            change: dict = {k: v for k, v in _changes(last, shape).items() if v}
            rows_at = str(last.get("rows_at") or last.get("since") or stamp)
            moved = shape["rows"] is not None and last.get("rows") is not None and shape["rows"] != last["rows"]
            try:
                due = (now or _now()) - datetime.fromisoformat(rows_at) >= ROWS_EVERY
            except ValueError:
                due = True
            entry = dict(last)
            entry["columns"] = shape["columns"]
            if moved and due:
                change["rows"] = {"from": last["rows"], "to": shape["rows"]}
                entry.update(rows=shape["rows"], rows_at=stamp)
            elif last.get("rows") is None and shape["rows"] is not None:
                entry.update(rows=shape["rows"], rows_at=stamp)
            out[name] = entry
            if change:
                changes.append({"table": name, **change})
        for change in changes:
            ledger.emit(CHANGED, {"connection_id": connection_id, "by": "", **change}, conn_id=connection_id)
        if out != kept:
            ledger.kv_put(SHAPES_STORE, connection_id, out)
    return changes


def note_shapes(connection_id: str, tables: list[dict]) -> None:
    """:func:`record_shapes`, never in the way of the read that built the schema."""
    try:
        record_shapes(connection_id, tables)
    except Exception as exc:  # noqa: BLE001 — see the docstring
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, f"the shapes of {connection_id}'s tables were not kept", counter="table_history.record")


def note_words(connection_id: str, table: str, fields: list[str], by: str) -> None:
    """A person's edit of a table's words (its description, grain, a column's …), journalled with who. Best effort."""
    if not connection_id or not table or not fields:
        return
    try:
        from pramanyx.kernel.ledger import Ledger
        Ledger.default().emit(CHANGED, {"connection_id": connection_id, "table": table, "words": sorted(fields),
                                        "by": by}, conn_id=connection_id)
    except Exception as exc:  # noqa: BLE001 — the edit is saved whether or not its record is
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, f"an edit of {table}'s words was not journalled", counter="table_history.words")


def _leaf(name: str) -> str:
    return str(name or "").split(".")[-1].strip('`"').lower()


def _same_table(a: str, b: str) -> bool:
    """One table named two ways: ``orders`` is ``thelook.orders``; ``thelook.orders`` is not ``shop.orders``."""
    return _leaf(a) == _leaf(b) and ("." not in a or "." not in b or a.lower() == b.lower())


def history(connection_id: str, table: str, *, limit: int = 50) -> dict:
    """A table's changes, newest first — ``{"changes": [{at, by, added, removed, retyped, rows, words}], "since"}``,
    ``since`` being when its shape was first kept (None: not yet seen)."""
    from pramanyx.kernel.ledger import Ledger
    ledger = Ledger.default()
    out = []
    for e in ledger.events(kind=CHANGED, conn_id=connection_id, limit=5_000):
        p = e.get("payload") or {}
        if p.get("connection_id") == connection_id and _same_table(str(p.get("table") or ""), table):
            out.append({"at": str(e.get("at") or ""), **{k: v for k, v in p.items() if k not in ("connection_id",)}})
    out.sort(key=lambda c: c["at"], reverse=True)
    kept = ledger.kv_get(SHAPES_STORE, connection_id)
    since = next((v.get("since") for k, v in (kept or {}).items() if isinstance(v, dict) and _same_table(k, table)), None)
    return {"changes": out[:limit], "since": since}
