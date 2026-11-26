"""R14 — query popularity: per-table and per-column usage mined from real history.

What people actually query is a notability signal the whole platform should
share. The pieces existed but were disconnected — ``query_log_miner`` computes
``column_usage`` per schema build and throws it away; ``tables_used`` is stored
per chat turn and never aggregated. This module mines the history ONCE into a
small persisted counter store and serves it to four consumers:

  • R11 column-config defaults — a queried column is protected from default
    hiding (popularity never hides; it only keeps visible);
  • R8 doc-tree — table facts carry ``query_popularity`` (Merkle-tracked) and
    the schema summary ranks by it before row_count;
  • overview seed priority — merged into the existing learned-prior fold
    (``overview/drills`` shape: the same saturating, capped boost);
  • starter-question relevance — a "most-queried tables" block for /suggestions.

Sources mined (each best-effort; whichever exists contributes):
  A. the SQL-examples vector store (successful executed SQL, via
     ``query_log_miner.collect_logged_sql``);
  B. ``task_history`` span inputs (flag ``obs.task_table``) — raw SQL captured
     in the ``input`` column by the telemetry sink.

Store mirrors ``overview/drills.py``: one tiny SQLite table keyed
(connection_id, kind, key), env-overridable path (``PRAMANYX_POPULARITY_DB``) so
tests stay hermetic. All consumption is gated by the ``obs.popularity`` flag
(default-off, byte-identical when off); mining runs from the R12 birth job.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

_DEFAULT_DB = Path(__file__).parent.parent.parent / "data" / "popularity.db"

# Bound the mining pass — history stores are unbounded; the signal saturates fast.
_MAX_SQLS = 5000


def _db_path() -> str:
    # Through the shared resolver, so a migrated data home (IN-4) reaches it too.
    from pramanyx.db.sqlite_util import resolve_db_path
    return str(resolve_db_path("PRAMANYX_POPULARITY_DB", _DEFAULT_DB))


@dataclass
class PopularitySignal:
    """One connection's mined usage counts."""
    connection_id: str
    table_counts: dict[str, int] = field(default_factory=dict)     # bare table -> n
    column_counts: dict[str, int] = field(default_factory=dict)    # "table.column" -> n
    n_queries: int = 0
    mined_at: float = 0.0


# ── store (the overview_drills pattern: tiny, keyed, replace-on-refresh) ─────

def _connect() -> sqlite3.Connection:
    from pramanyx.db.backend import connect_store
    con = connect_store(_db_path())
    con.execute(
        "CREATE TABLE IF NOT EXISTS popularity ("
        " connection_id TEXT NOT NULL,"
        " kind TEXT NOT NULL,"            # 'table' | 'column'
        " key TEXT NOT NULL,"
        " count INTEGER NOT NULL DEFAULT 0,"
        " PRIMARY KEY (connection_id, kind, key))"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS popularity_meta ("
        " connection_id TEXT PRIMARY KEY,"
        " mined_at REAL NOT NULL,"
        " n_queries INTEGER NOT NULL)"
    )
    return con


def save_popularity(sig: PopularitySignal) -> None:
    """Replace the connection's counts with a fresh mining pass. Best-effort."""
    try:
        con = _connect()
        with con:
            con.execute("DELETE FROM popularity WHERE connection_id = ?", (sig.connection_id,))
            con.executemany(
                "INSERT INTO popularity (connection_id, kind, key, count) VALUES (?,?,?,?)",
                [(sig.connection_id, "table", k, v) for k, v in sig.table_counts.items()]
                + [(sig.connection_id, "column", k, v) for k, v in sig.column_counts.items()],
            )
            con.execute(
                "INSERT OR REPLACE INTO popularity_meta (connection_id, mined_at, n_queries) "
                "VALUES (?,?,?)",
                (sig.connection_id, sig.mined_at or time.time(), sig.n_queries),
            )
        con.close()
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "popularity save is best-effort",
                 counter="obs.popularity", conn_id=sig.connection_id or None)


def purge_connection(connection_id: str) -> int:
    """Forget a connection's mined counts (idea 1 — a delete leaves nothing behind; the
    table and column names a deleted connection's queries read are its schema). Returns the
    rows removed. Raises: the purge cascade counts a failure, it does not swallow one."""
    con = _connect()
    with con:
        n = con.execute("DELETE FROM popularity WHERE connection_id = ?", (connection_id,)).rowcount
        n += con.execute("DELETE FROM popularity_meta WHERE connection_id = ?",
                         (connection_id,)).rowcount
    con.close()
    return max(n, 0)


def load_popularity(connection_id: str) -> dict[str, dict[str, int]]:
    """Read-only counts: ``{"table": {t: n}, "column": {"t.c": n}}``; {} buckets on any error."""
    out: dict[str, dict[str, int]] = {"table": {}, "column": {}}
    try:
        # The missing-file short-circuit is a sqlite-only optimization; on Postgres
        # there is no file and the store's schema answers (or errors into the
        # best-effort catch below).
        from pramanyx.db.backend import is_postgres
        if not is_postgres() and not Path(_db_path()).exists():
            return out
        con = _connect()
        rows = con.execute(
            "SELECT kind, key, count FROM popularity WHERE connection_id = ?",
            (connection_id,),
        ).fetchall()
        con.close()
        for kind, key, count in rows:
            if kind in out:
                out[kind][key] = int(count)
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "popularity load is best-effort",
                 counter="obs.popularity", conn_id=connection_id or None)
    return out


# ── mining ───────────────────────────────────────────────────────────────────

def _sqls_from_task_history(connection_id: str, limit: int) -> list[str]:
    """Raw SQL captured in task_history span inputs (flag ``obs.task_table``).
    The sink lifts a span's ``sql``/``query`` attribute into the ``input`` column;
    a non-SQL input (a question, a JSON blob) is filtered by a cheap looks-like-SQL
    test — the miner's parser is the real gate anyway."""
    try:
        from pramanyx.kernel.ledger import Ledger
        rows = Ledger.default().task_history(limit=limit)
    except Exception:
        return []
    out: list[str] = []
    for r in rows:
        raw = (r.get("input") or "").strip()
        if not raw.startswith(("{", "[")) and raw[:30].upper().lstrip().startswith(
                ("SELECT", "WITH")):
            labels = r.get("labels")
            if connection_id and isinstance(labels, str):
                try:
                    lbl_conn = json.loads(labels).get("connection_id") or connection_id
                except Exception:
                    lbl_conn = connection_id   # unparseable labels → keep the row
                if lbl_conn != connection_id:
                    continue
            out.append(raw)
    return out


def mine_popularity(connection_id: str, *, dialect: str = "duckdb",
                    sqls: list[str] | None = None) -> PopularitySignal:
    """Mine the history sources into a PopularitySignal (pure given ``sqls``).

    Table counts come from ``sql/tables.extract_tables`` (scope-aware, CTEs
    excluded); column counts from the miner's ``column_usage`` — the counter that
    was previously computed and discarded every schema build."""
    if sqls is None:
        sqls = []
        try:
            from pramanyx.sql.query_log_miner import collect_logged_sql
            sqls.extend(collect_logged_sql(connection_id, limit=_MAX_SQLS))
        except Exception:
            logger.debug("popularity: vector-store SQL source unavailable", exc_info=True)
        if len(sqls) < _MAX_SQLS:
            sqls.extend(_sqls_from_task_history(connection_id, _MAX_SQLS - len(sqls)))
    sqls = sqls[:_MAX_SQLS]

    sig = PopularitySignal(connection_id=connection_id, mined_at=time.time())
    if not sqls:
        return sig

    from pramanyx.sql.query_log_miner import mine_query_log
    facts = mine_query_log(sqls, dialect=dialect)
    sig.n_queries = facts.n_parsed
    sig.column_counts = {k: int(v) for k, v in facts.column_usage.items()}

    from pramanyx.sql.tables import extract_tables
    table_counts: dict[str, int] = {}
    for sql in sqls:
        try:
            refs = extract_tables(sql, dialect)
        except Exception:
            refs = set()   # un-enumerable SQL contributes nothing
        for ref in refs:
            bare = getattr(ref, "table", "") or ""
            if bare:
                table_counts[bare] = table_counts.get(bare, 0) + 1
    sig.table_counts = table_counts
    return sig


def refresh_popularity(connection_id: str, *, dialect: str = "duckdb") -> PopularitySignal:
    """Mine + persist in one call — the R12 birth-job step body."""
    sig = mine_popularity(connection_id, dialect=dialect)
    save_popularity(sig)
    return sig


# ── consumer helpers ─────────────────────────────────────────────────────────

def merge_popularity_into_priors(priors: dict, connection_id: str) -> dict:
    """Fold query popularity into the overview's learned-prior dict (the
    ``{"lens": {...}, "table": {...}}`` shape from ``overview/drills``). Additive:
    drill counts and query counts sum per table; ``_prior_boost``'s saturation +
    cap keep the nudge bounded no matter how hot a table is. Returns a NEW dict;
    the input is never mutated. No-op (input returned) when nothing was mined."""
    pop = load_popularity(connection_id)
    if not pop.get("table"):
        return priors
    merged = dict((priors or {}).get("table") or {})
    for t, n in pop["table"].items():
        merged[t] = merged.get(t, 0) + n
    out = dict(priors or {})
    out["table"] = merged
    return out


def most_queried_block(connection_id: str, *, top: int = 6) -> str:
    """A compact 'what people actually query' block for the /suggestions prompt.
    Empty string when nothing was mined (caller appends nothing)."""
    pop = load_popularity(connection_id)
    tables = sorted(pop.get("table", {}).items(), key=lambda kv: -kv[1])[:top]
    if not tables:
        return ""
    lines = ["MOST-QUERIED TABLES (from real query history — favor these in suggestions):"]
    lines += [f"  {t}  ({n} queries)" for t, n in tables]
    return "\n".join(lines)


# ── a column's use in the warehouse's own history (the user, 2026-11-25) ──────────────────────────────────────────────
#
# The counts above are mined from what Pramanyx ran. A column's use on its Catalog page is read from the warehouse's
# own query history — what people ran there, Pramanyx's own statements left out and counted apart — through the
# connection's door (`db.query_history`), and only while the organisation allows that read. The user chose it
# (2026-11-25): "used in N queries in the warehouse's history, as of <date>", worded apart from a table's reads,
# which count Pramanyx's own.

#: Where each connection's last reading of its history is kept (the kernel ledger's kv), and how long it stands.
HISTORY_USE_STORE = "column_use_history.v2"   # v2: every run counted, the window said
HISTORY_USE_FRESH_S = 6 * 3600

_history_lock = threading.Lock()
_history_reading: set[str] = set()


def read_history_use(connection_id: str) -> dict:
    """Read the warehouse's query history once and mine it for each column's use; keep and return what was read —
    ``{"at", "engine", "source", "hours", "supported", "said", "statements", "calls", "ours", "columns"}``, where
    ``columns`` is ``{"table.column": runs}`` and ``said`` is why nothing was counted, when nothing was."""
    from datetime import datetime, timezone

    from pramanyx.db.connection import connection_traits, open_connection_for
    from pramanyx.db.query_history import check_query_history, read_query_history
    from pramanyx.db.registry import get_conn_type
    from pramanyx.sql.query_log_miner import mine_query_log
    db = open_connection_for(connection_id)
    try:
        history = read_query_history(db)
        said = ""
        if not history.supported or history.error:
            said = check_query_history(db).sentence()     # the engine's own refusal, with the admin's step
    finally:
        db.close()
    # An aggregate (Postgres' pg_stat_statements) counts runs since its statistics were last reset and says so of
    # itself (`rows_from_result`'s aggregate note); a log reads the last `hours` and says nothing when it has rows.
    aggregate = bool(history.rows) and bool(history.note)
    days = max(1, round((history.hours or 24) / 24))
    out: dict = {"at": datetime.now(timezone.utc).isoformat(), "engine": history.engine, "source": history.source,
                 "hours": history.hours, "supported": history.supported and not history.error, "said": said,
                 "window": "since the engine's statistics were last reset" if aggregate
                           else f"in the last {'day' if days == 1 else f'{days} days'}",
                 "statements": 0, "calls": 0, "ours": history.ours, "columns": {}}
    if out["supported"]:
        # Every run counts: the miner's cap (`CALLS_CAP`) keeps one hot statement from drowning its patterns, but a
        # count of the queries that named a column is the runs themselves.
        sqls, weights = history.statements_and_weights(cap=2 ** 31)
        dialect = connection_traits(get_conn_type(connection_id)).get("dialect") or "duckdb"
        # Each statement counts a column once, however often it names it, as many times as it was run: "used in N
        # queries". The miner's own count is of mentions (a column selected and grouped by counts twice).
        columns: dict[str, int] = {}
        for sql, runs in zip(sqls, weights):
            for key in mine_query_log([sql], dialect=dialect, weights=[runs]).column_usage:
                columns[key] = columns.get(key, 0) + runs
        out.update(statements=len(sqls), calls=sum(weights), columns=columns)
    from pramanyx.kernel.ledger import Ledger
    Ledger.default().kv_put(HISTORY_USE_STORE, connection_id, out)
    return out


def _read_in_background(connection_id: str) -> None:
    try:
        read_history_use(connection_id)
    except Exception as exc:  # noqa: BLE001 — unread, the page says it is being read and reads it again next time
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, f"popularity: {connection_id}'s query history could not be read", counter="popularity.history")
    finally:
        with _history_lock:
            _history_reading.discard(connection_id)


def column_use(connection_id: str, table: str, *, wait: bool = False) -> dict:
    """How often each of ``table``'s columns is used in the warehouse's history, from what is kept — read again on a
    thread of its own when it is older than six hours (``wait`` reads it here). ``{"columns": {column: runs}, "as_of",
    "hours", "statements", "ours", "source", "said": [why nothing is counted, or that it is being read]}``."""
    import contextvars
    from datetime import datetime, timezone

    from pramanyx.orgsettings.allows import WHERE, allows
    if not allows("read_query_history"):
        return {"columns": {}, "said": [f"Reading the warehouse's query history is off for this organisation; an admin "
                                        f"turns it on under {WHERE} ('Read each warehouse's own query history')."]}
    from pramanyx.kernel.ledger import Ledger
    kept = Ledger.default().kv_get(HISTORY_USE_STORE, connection_id)
    kept = kept if isinstance(kept, dict) and isinstance(kept.get("columns"), dict) else None
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(str(kept["at"]))).total_seconds() if kept else None
    except (TypeError, ValueError):
        age = None
    if age is None or age > HISTORY_USE_FRESH_S:
        if wait:
            kept = read_history_use(connection_id)
        else:
            with _history_lock:
                start = connection_id not in _history_reading
                _history_reading.add(connection_id)
            if start:
                threading.Thread(target=contextvars.copy_context().run, args=(_read_in_background, connection_id),
                                 daemon=True, name=f"column-use-{connection_id}").start()
    if kept is None:
        return {"columns": {}, "said": ["How often its columns are used is being read from the warehouse's history; "
                                        "it shows on the next visit."]}
    bare = (table or "").split(".")[-1].strip().strip('`"').lower()
    columns = {k.split(".", 1)[1]: n for k, n in kept["columns"].items()
               if "." in k and k.split(".", 1)[0].strip('`"').lower() == bare}
    return {"columns": columns, "as_of": kept.get("at"), "hours": kept.get("hours"), "window": kept.get("window") or "",
            "statements": kept.get("statements"),
            "ours": kept.get("ours") or {}, "source": kept.get("source") or "",
            "said": [kept["said"]] if kept.get("said") else []}
