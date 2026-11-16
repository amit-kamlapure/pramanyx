"""The board study (2026-11-16) — a dashboard's focus: a reader clicks a bar, "channel = Search", and every card on the
dashboard is asked again with it.

What a click stands for is read off the statement of the card it was made on, never guessed: the column it shows is traced
to the table and column it is read from (`sql.lineage`), against the connection's columns when they are in hand. A column
worked out rather than read (``SUM(x) AS total``), a count or a constant, one whose table the statement does not name
among several, or one read from two places, is refused by name — a click on it filters nothing, and says so.

A card is cut by a focus when it reads the focus's table: the table is replaced, inside the card's own statement, by itself
filtered to the value (`metric_statement.scoped_statement`), so the card's arithmetic runs over those rows only. The value
is written by the SQL parser as a literal of the statement's dialect — quoted and escaped by it, never pasted into the
text. The table's column is known to exist: the focus was traced to it from a card that ran. A card that reads none of the
focus's tables is not cut, and says why in its own place (withheld is said, never implied).
"""
from __future__ import annotations

from typing import Any, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

#: The most a focus holds at once — beyond it a dashboard is a query, not a view.
MAX_FOCUS = 6


class Focus(BaseModel):
    """One chosen value: the table and column it is read from, and the value."""
    model_config = ConfigDict(extra="forbid")
    table: str = Field(min_length=1, max_length=200)
    column: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    value: Union[str, int, float, bool]


def bare(name: str) -> str:
    """A table as a statement names it, without its schema or quotes: ``"thelook"."order_items"`` → ``order_items``."""
    return str(name or "").split(".")[-1].strip('"`[] ').lower()


def field_of(sql: str, column: str, dialect: Optional[str], schema: Optional[dict] = None) -> dict[str, Any]:
    """The table and column an output ``column`` of ``sql`` is read from — ``{"table", "column", "confidence"}`` — or
    ``{"refused": why}``. ``schema`` (the connection's columns, as sqlglot takes them) lets a column the statement does
    not name the table of be traced to the one it is; without it, such a column is said, never guessed."""
    from pramanyx.sql.lineage import column_lineage

    lin = column_lineage(sql, dialect=dialect, schema=schema)
    edges = [e for e in lin.edges() if e.get("role") == "output" and e.get("as") == column]
    if not edges:
        if lin.level == "table":
            return {"refused": f"Where {column} is read from could not be told ({lin.note}), so a click on it filters nothing."}
        return {"refused": f"The card's query returns no column {column}, so a click on it filters nothing."}
    read = [e for e in edges if e.get("table") and e.get("column")]
    if not read:
        if _reads_a_column(sql, column, dialect):
            return {"refused": f"Which table {column} is read from could not be told — the query does not name it — "
                               f"so a click on it filters nothing."}
        return {"refused": f"{column} is a count or a constant, not a column of a table, so a click on it filters nothing."}
    direct = [e for e in read if e.get("direct")]
    if not direct:
        return {"refused": f"{column} is worked out from its table, not read from one, so a click on it filters nothing."}
    # a "possible" column — the statement reads one source and does not name it — is that source's: the statement ran,
    # so the column is there. Two sources it might be from never reach here: the trace leaves such a column untold.
    places = {(bare(e["table"]), e["column"]) for e in direct}
    if len(places) > 1:
        names = ", ".join(sorted(f"{t}.{c}" for t, c in places))
        return {"refused": f"{column} is read from more than one place ({names}), so a click on it filters nothing."}
    table, col = next(iter(places))
    return {"table": table, "column": col, "confidence": direct[0]["confidence"]}


def _reads_a_column(sql: str, column: str, dialect: Optional[str]) -> bool:
    """Whether the expression the statement returns as ``column`` reads any column at all — a count or a constant does not."""
    import sqlglot
    from sqlglot import exp

    from pramanyx.sql.lineage import sqlglot_dialect
    try:
        q = sqlglot.parse_one(sql, read=sqlglot_dialect(dialect))
    except Exception:  # noqa: BLE001 — a statement the tracer could not read is said as untold, never as a constant
        return True
    select = q if isinstance(q, exp.Select) else q.find(exp.Select)
    for e in (select.expressions if select is not None else []):
        if e.alias_or_name == column:
            return e.find(exp.Column) is not None
    return True


def condition(column: str, value: Any) -> Any:
    """``column = value`` as the parser holds it: the value a literal, which the parser quotes and escapes as it writes
    the statement out."""
    from sqlglot import exp
    if isinstance(value, bool):
        lit: exp.Expression = exp.Boolean(this=value)
    elif isinstance(value, (int, float)):
        lit = exp.Literal.number(value)
    else:
        lit = exp.Literal.string(str(value))
    return exp.EQ(this=exp.column(column), expression=lit)


def predicate(column: str, value: Any, dialect: Optional[str]) -> str:
    """``column = value`` as written in ``dialect`` — what a cut statement says."""
    from pramanyx.sql.lineage import sqlglot_dialect
    return condition(column, value).sql(dialect=sqlglot_dialect(dialect))


def words(f: Focus) -> str:
    return f"{f.column} = {f.value}"


def cut_statement(sql: str, focus: list[Focus], dialect: Optional[str]) -> tuple[str, dict[str, Any]]:
    """``sql`` cut by every focus it can be — each table it reads replaced by itself filtered to the value — and the
    verdict: ``{"applied": bool, "why": str}``, ``why`` naming each focus it could not be cut by."""
    from pramanyx.semantic.metric_statement import scoped_statement, statement_tables

    tables = {bare(t) for t in statement_tables(sql, dialect or "duckdb")}
    applied: list[str] = []
    not_cut: list[str] = []
    for f in focus:
        if bare(f.table) not in tables:
            not_cut.append(f"Not cut by {words(f)}: it reads no {bare(f.table)}.")
            continue
        cut, why, _ = scoped_statement(sql, bare(f.table), condition(f.column, f.value), dialect=dialect or "duckdb")
        if cut is None:
            not_cut.append(f"Not cut by {words(f)}: {why}.")
            continue
        sql = cut
        applied.append(words(f))
    return sql, verdict(applied, not_cut)


def verdict(applied: list[str], not_cut: list[str]) -> dict[str, Any]:
    """Applied when the card was cut by every focus; otherwise what it was cut by and why not the rest."""
    return {"applied": not not_cut and bool(applied), "by": applied, "why": " ".join(not_cut)}


def parsed(raw: list[dict[str, Any]]) -> list[Focus]:
    """A run's focus, each held to its shape; too many is refused by `ValueError`."""
    if len(raw) > MAX_FOCUS:
        raise ValueError(f"A dashboard is filtered by at most {MAX_FOCUS} values at once.")
    return [Focus.model_validate(f) for f in raw]
