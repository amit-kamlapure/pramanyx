"""What statements people and agents ran show the ontology — one door for every source of SQL (Arc NV-3, 2026-11-04;
the Atlas plan's A7, 2026-11-25).

The miner (`ontology/candidates.mine`) reads statements for joins the ontology lacks, recurring filter values and
recurring named formulas; each candidate is bound on the connection (EXPLAIN, a dry run) before it is offered; what binds
is booked in the Record as a usage claim at tier *mined* (`record/writers.book_usage_claims`), said where it came from,
listed with what was learned and waiting for a person to confirm (`knowledge/learned.py`, `knowledge/review.py`) — and
reaching no prompt until a person confirms it. Until A7 one source fed it, by hand: the warehouse's own query history.
Now three, through this one door:

- **The warehouse's history** — what everyone ran there; read only where the organisation allows it
  (`read_query_history`, off by default), as before.
- **The platform's own work** — the SQL of dashboards' and Data Canvases' cards and of saved queries on the connection:
  what people built to be read again. Inside the install; no setting needed.
- **The SQL answers ran** — each answer's receipt keeps the statements it ran (`source_sql`): the joins and formulas
  the agents chose, and that ran. Inside the install.

No model is called; nothing is written but usage claims, and only when asked to book.
"""
from __future__ import annotations

import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

#: Where each source's claims say they came from.
OUR_OWN = "the platform's own dashboards, Data Canvases and saved queries"
ANSWERS = "the SQL answers ran"
#: How far back the answers' SQL is read.
ANSWERS_DAYS = 30


def bind_sql(candidate: Any, db: Any, tables: set[str], connection_id: str = "") -> Optional[str]:
    """The statement whose EXPLAIN decides whether a candidate binds; None when none can be written."""
    import sqlglot
    from sqlglot import exp
    c = candidate
    if c.kind == "join":
        left, right = [side.strip() for side in c.proposal.split("=", 1)]
        lt, rt = left.split(".")[0], right.split(".")[0]
        return f"SELECT COUNT(*) FROM {lt} JOIN {rt} ON {left} = {right}"
    if c.kind == "filter":
        return f"SELECT COUNT(*) FROM {c.subject.split('.')[0]} WHERE {c.proposal}"
    if c.kind == "measure":
        try:
            tree = sqlglot.parse_one(c.proposal, read=getattr(db, "dialect", "duckdb"))
        except Exception as parse_exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(parse_exc, "a mined formula sqlglot cannot parse is refused, never offered",
                     counter="ontology.candidates_unparsed", conn_id=connection_id or None)
            return None
        # The miner resolved the statement's aliases and recorded the tables the formula reads (its subject); the
        # formula's own qualified columns must agree with them, and every one must be this schema's.
        refs = {t.strip() for t in c.subject.split(",") if t.strip()} | {
            col.table for col in tree.find_all(exp.Column) if col.table}
        if not refs or any(r not in tables for r in refs):
            return None
        # A normalised constant ($1) is a hole EXPLAIN cannot plan; NULL stands in it for the bind alone.
        bindable = tree.transform(lambda n: exp.Null() if isinstance(n, (exp.Parameter, exp.Placeholder)) else n)
        return f"SELECT {bindable.sql(dialect=getattr(db, 'dialect', 'duckdb'))} FROM {', '.join(sorted(refs))}"
    return None


def mine_and_book(connection_id: str, graph: Any, db: Any, statements: list[str], weights: list[int], *,
                  source: str, book: bool, schema_name: str = "", came_from: str = "") -> dict:
    """Mine ``statements`` (each weighed by how often it ran) against the connection's ontology, bind every candidate
    on ``db``, and — ``book`` — book what binds as usage claims said to come from ``source``. The report: offered,
    refused, how many were mined, read and weighed."""
    from pramanyx.ontology.candidates import mine
    known = {f"{r.from_table}.{r.from_col} = {r.to_table}.{r.to_col}" for r in graph.relationships.values()}
    tables = {t for e in graph.entities.values() for t in e.source_tables}

    def binder(c):
        sql = bind_sql(c, db, tables, connection_id)
        if sql is None:
            return False, ("the formula reads no table of this schema, or one it does not have; it cannot be bound "
                           "outside its own statement")
        return db.dry_run(sql)

    report = mine(connection_id, query_log=statements, dialect=getattr(db, "dialect", "duckdb"), known_joins=known,
                  binder=binder, query_log_weights=weights)
    out: dict[str, Any] = report.to_dict()
    if book:
        # The user, 2026-11-14: "query history findings to become record claims only" — referred to when an answer
        # comes out inconclusive (`record/writers.usage_for`), listed with what was learned for a person to confirm.
        from pramanyx.record.writers import book_usage_claims
        out["booked"] = book_usage_claims(connection_id=connection_id, candidates=report.offered, source=source,
                                          schema_name=schema_name or graph.schema_name or "", came_from=came_from)
    out.update({"mined": len(report.candidates), "statements": len(statements), "calls": sum(weights),
                "source": source})
    try:
        from pramanyx.kernel.ledger import Ledger
        Ledger.default().emit("ontology.candidates.mined",
                              {"statements": len(statements), "mined": len(report.candidates),
                               "offered": len(report.offered), "refused": len(report.refused), "source": source},
                              conn_id=connection_id)
    except Exception as emit_exc:  # noqa: BLE001 — the journal is best-effort
        from pramanyx.kernel.errors import tolerate
        tolerate(emit_exc, "the candidate mining journal is best-effort", counter="ontology.candidates_journal",
                 conn_id=connection_id)
    return out


def _plain(sql: str) -> str:
    """A statement as one statement: its words, single-spaced, no trailing semicolon — the same SQL twice is once."""
    return re.sub(r"\s+", " ", str(sql or "")).strip().rstrip(";").strip()


def weighed(sqls: list[str]) -> tuple[list[str], list[int]]:
    """Each statement once, weighed by how many hold it — in the order first seen."""
    counts = Counter(s for s in (_plain(x) for x in sqls) if s)
    return list(counts), list(counts.values())


def our_own_statements(connection_id: str) -> tuple[list[str], list[str]]:
    """The SQL of the platform's own work on a connection — dashboards' and Data Canvases' cards, saved queries — and
    what could not be read, said."""
    sqls: list[str] = []
    unread: list[str] = []
    from pramanyx.kernel.errors import tolerate
    try:
        from pramanyx.cards.store import list_cards
        sqls += [c.sql for c in list_cards(connection_id=connection_id) if getattr(c, "kind", "") != "note" and c.sql]
    except Exception as exc:  # noqa: BLE001 — a store unread is said, never taken for empty
        tolerate(exc, "the cards' SQL could not be read for mining", counter="mining.cards", conn_id=connection_id)
        unread.append("dashboards' and Data Canvases' cards")
    try:
        from pramanyx.savedquery.store import list_saved_queries
        sqls += [q.sql for q in list_saved_queries(connection_id) if q.sql]
    except Exception as exc:  # noqa: BLE001
        tolerate(exc, "the saved queries could not be read for mining", counter="mining.saved", conn_id=connection_id)
        unread.append("saved queries")
    return sqls, unread


def answers_statements(connection_id: str, *, now: Optional[datetime] = None) -> list[str]:
    """The SQL the last month's answers ran on a connection, from their receipts (`source_sql` lineage)."""
    from pramanyx.discover.atlas import RECEIPT_KINDS
    from pramanyx.kernel.ledger import Ledger
    since = ((now or datetime.now(timezone.utc)) - timedelta(days=ANSWERS_DAYS)).isoformat()
    led = Ledger.default()
    ids = [a["id"] for a in led.artifacts_since(list(RECEIPT_KINDS), since, conn_ids=[connection_id])]
    return [str(detail or "") for _art, _rel, _ref, detail in led.lineage_of_many(ids, relations=["source_sql"]) if detail]


def history_statements(db: Any, *, hours: int, limit: int) -> tuple[Any, list[str], list[int]]:
    """The warehouse's history, read for mining: the history itself (supported, its error, its source), and its
    statements — the platform's own left out — with how often each ran. None to mine when it could not be read."""
    from pramanyx.db.query_history import not_platform_statement, read_query_history
    history = read_query_history(db, hours=hours, limit=limit)
    if not history.supported or history.error:
        return history, [], []
    sqls, weights = history.statements_and_weights()
    pairs = [(s, w) for s, w in zip(sqls, weights) if not_platform_statement(s)]
    return history, [s for s, _ in pairs], [w for _, w in pairs]


def mine_our_own(connection_id: str, *, book: bool = True, schema_name: Optional[str] = None) -> dict:
    """Mine the platform's own work and the SQL answers ran on a connection (A7) — each source on its own, so each
    claim says where it came from. Opens the connection for the binds; says what it could not read."""
    from pramanyx.db.connection import open_connection_for_with_schema
    from pramanyx.ontology.store import load_latest_ontology
    graph = load_latest_ontology(connection_id, schema_name or None)
    if graph is None:
        return {"connection_id": connection_id, "sources": {}, "said": ["No ontology is built on this connection."]}
    own, unread = our_own_statements(connection_id)
    ran = answers_statements(connection_id)
    out: dict[str, Any] = {"connection_id": connection_id, "schema_name": graph.schema_name, "sources": {},
                           "said": [f"Not read: {', '.join(unread)}."] if unread else []}
    db = open_connection_for_with_schema(connection_id, graph.schema_name)
    try:
        for source, sqls in ((OUR_OWN, own), (ANSWERS, ran)):
            statements, weights = weighed(sqls)
            if not statements:
                out["sources"][source] = {"statements": 0, "mined": 0, "offered": [], "refused": []}
                continue
            out["sources"][source] = mine_and_book(connection_id, graph, db, statements, weights, source=source,
                                                   book=book, schema_name=graph.schema_name, came_from=source)
    finally:
        try:
            db.close()
        except Exception as close_exc:  # noqa: BLE001 — a close that fails is the driver's, not the report's
            from pramanyx.kernel.errors import tolerate
            tolerate(close_exc, "a mining connection did not close", counter="mining.close", conn_id=connection_id)
    return out


#: The warehouse's history the daily mining reads: the last two weeks, the newest two thousand statements — as the
#: candidate door reads it by default.
HISTORY_HOURS = 24 * 14
HISTORY_LIMIT = 2000
_last_day = ""


def _booked(report: dict) -> int:
    return len(((report or {}).get("booked") or {}).get("booked") or [])


def _mine_history(connection_id: str) -> int:
    """The warehouse's own history on a connection, mined and booked; how many claims were booked."""
    from pramanyx.db.connection import open_connection_for_with_schema
    from pramanyx.ontology.store import load_latest_ontology
    graph = load_latest_ontology(connection_id)
    if graph is None:
        return 0
    db = open_connection_for_with_schema(connection_id, graph.schema_name)
    try:
        history, statements, weights = history_statements(db, hours=HISTORY_HOURS, limit=HISTORY_LIMIT)
        if not statements:
            return 0
        return _booked(mine_and_book(connection_id, graph, db, statements, weights, source=history.source or "",
                                     book=True, schema_name=graph.schema_name))
    finally:
        try:
            db.close()
        except Exception as close_exc:  # noqa: BLE001
            from pramanyx.kernel.errors import tolerate
            tolerate(close_exc, "a mining connection did not close", counter="mining.close", conn_id=connection_id)


def run_mining_daily(*, now: Optional[datetime] = None, force: bool = False) -> int:
    """Once a UTC day (A7: "query history on a schedule rather than by hand"): every connection's own work and its
    answers' SQL mined and booked — and, only where the organisation allows it (`read_query_history`, off by default),
    the warehouse's own history. A connection that fails is said in the log and the rest still run. Returns how many
    claims were booked. ``force`` is for an external clock."""
    global _last_day
    today = (now or datetime.now(timezone.utc)).date().isoformat()
    if not force and _last_day == today:
        return 0
    _last_day = today
    from pramanyx.kernel.once_a_day import first_today
    if not force and not first_today("statement_mining", today):
        return 0
    from pramanyx.db.registry import list_connections
    from pramanyx.kernel.errors import tolerate
    from pramanyx.orgsettings.allows import allows
    history = allows("read_query_history")
    booked = 0
    for conn in list_connections():
        cid = str((conn or {}).get("id") or "")
        if not cid:
            continue
        try:
            report = mine_our_own(cid, book=True)
            booked += sum(_booked(r) for r in report.get("sources", {}).values())
            if history:
                booked += _mine_history(cid)
        except Exception as exc:  # noqa: BLE001 — one connection's mining failing leaves the rest to run
            tolerate(exc, "a connection's daily mining failed", counter="mining.daily", conn_id=cid)
    return booked

