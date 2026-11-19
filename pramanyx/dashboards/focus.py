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
focus's tables is cut through the links the connection's ontology holds (the study's R16): a table it reads keeps only the rows
that belong to the value, ``user_id IN (SELECT id FROM users WHERE traffic_source = 'Search')``, which can never count a row
twice. A link is followed only from the many side to the one, where a row belongs to exactly one value; two equally short ways
to the table are refused by name, as is a card no link reaches, and a card cut this way says which column it used.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import date
from typing import Any, Literal, NamedTuple, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

#: The most a focus holds at once — beyond it a dashboard is a query, not a view.
MAX_FOCUS = 12
#: The most values one filter holds.
MAX_FOCUS_VALUES = 200
#: The most links a cut follows. Further than this a value says little about the row it reaches.
MAX_HOPS = 3


class Link(NamedTuple):
    """A step from a table to the one its column points at: each row of ``table`` belongs to one row of ``to_table``."""
    table: str
    column: str
    to_table: str
    to_column: str


class Focus(BaseModel):
    """What a reader chose on a column: one value clicked on a mark (``eq``), or what a global filter holds — several values
    (``in``), a range of numbers (``between``), a range of days (``dates``) or words the column contains (``contains``)."""
    model_config = ConfigDict(extra="forbid")
    table: str = Field(min_length=1, max_length=200)
    column: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    value: Union[str, int, float, bool] = ""
    op: Literal["eq", "in", "between", "dates", "contains"] = "eq"
    values: list[Union[str, int, float, bool]] = Field(default_factory=list, max_length=MAX_FOCUS_VALUES)
    low: Optional[Union[str, int, float]] = None
    high: Optional[Union[str, int, float]] = None
    #: How words are matched (v20): anywhere in the column, the whole of it, or its start; capitals ignored unless asked.
    match: Literal["contains", "exact", "starts_with"] = "contains"
    case_sensitive: bool = False

    @model_validator(mode="after")
    def holds_what_its_op_reads(self) -> "Focus":
        if self.op == "in" and not self.values:
            raise ValueError("a filter of several values holds at least one")
        if self.op in ("between", "dates") and self.low is None and self.high is None:
            raise ValueError("a range says where it starts or where it ends")
        if self.op == "between" and any(isinstance(v, str) for v in (self.low, self.high)):
            raise ValueError("a range of numbers is held by numbers")
        if self.op == "dates":
            for day in (self.low, self.high):
                if day is not None:
                    date.fromisoformat(str(day))
        if self.op == "contains" and not str(self.value).strip():
            raise ValueError("a filter of words holds some words")
        return self


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


def _literal(value: Any) -> Any:
    from sqlglot import exp
    if isinstance(value, bool):
        return exp.Boolean(this=value)
    return exp.Literal.number(value) if isinstance(value, (int, float)) else exp.Literal.string(str(value))


def condition_of(f: Focus) -> Any:
    """What a focus keeps, as the parser holds it: every value a literal the parser quotes and escapes for the dialect."""
    from sqlglot import exp
    col = exp.column(f.column)
    if f.op == "in":
        return col.isin(*[_literal(v) for v in f.values])
    if f.op == "contains":
        said = str(f.value).strip()
        side = exp.cast(col, "TEXT") if f.case_sensitive else exp.Lower(this=exp.cast(col, "TEXT"))
        word = _literal(said if f.case_sensitive else said.lower())
        if f.match == "exact":
            return exp.EQ(this=side, expression=word)
        found = exp.StrPosition(this=side, substr=word)
        return exp.EQ(this=found, expression=exp.Literal.number(1)) if f.match == "starts_with" else exp.GT(this=found, expression=exp.Literal.number(0))
    if f.op in ("between", "dates"):
        side = exp.cast(col, "DATE") if f.op == "dates" else col
        bound = (lambda v: exp.cast(_literal(str(v)), "DATE")) if f.op == "dates" else _literal
        parts = [*([exp.GTE(this=side.copy(), expression=bound(f.low))] if f.low is not None else []),
                 *([exp.LTE(this=side.copy(), expression=bound(f.high))] if f.high is not None else [])]
        return exp.and_(*parts) if len(parts) > 1 else parts[0]
    return condition(f.column, f.value)


def predicate(column: str, value: Any, dialect: Optional[str]) -> str:
    """``column = value`` as written in ``dialect`` — what a cut statement says."""
    from pramanyx.sql.lineage import sqlglot_dialect
    return condition(column, value).sql(dialect=sqlglot_dialect(dialect))


def words(f: Focus) -> str:
    if f.op == "in":
        return f"{f.column} in {', '.join(str(v) for v in f.values[:5])}" + (f" and {len(f.values) - 5} more" if len(f.values) > 5 else "")
    if f.op == "contains":
        how = {"exact": "is exactly", "starts_with": "starts with"}.get(f.match, "contains")
        return f"{f.column} {how} {f.value}"
    if f.op in ("between", "dates"):
        if f.low is not None and f.high is not None:
            return f"{f.column} {f.low} to {f.high}" if f.low != f.high else f"{f.column} = {f.low}"
        return f"{f.column} from {f.low}" if f.low is not None else f"{f.column} up to {f.high}"
    return f"{f.column} = {f.value}"


def links_of(connection_id: str) -> list[Link]:
    """The links of a connection's ontology a cut may follow, each from its many side to its one. A link with no shared
    values, one across two sources and a many-to-many one are not followed."""
    from pramanyx.ontology.store import load_latest_ontology

    graph = load_latest_ontology(connection_id)
    return links_from(graph.relationships.values()) if graph is not None else []


def links_from(relationships: Iterable[Any]) -> list[Link]:
    found: set[Link] = set()
    for r in relationships:
        if getattr(r, "traversal", "join") != "join" or getattr(r, "value_overlap", None) == 0:
            continue
        ahead = Link(bare(r.from_table), r.from_col, bare(r.to_table), r.to_col)
        back = Link(ahead.to_table, ahead.to_column, ahead.table, ahead.column)
        if r.cardinality in ("N:1", "1:1"):
            found.add(ahead)
        if r.cardinality in ("1:N", "1:1"):
            found.add(back)
    return sorted(found)


def ways_to(start: str, goal: str, links: list[Link]) -> list[list[Link]]:
    """Every shortest way from ``start`` to ``goal``, within `MAX_HOPS` links; none when there is none."""
    ways: list[list[Link]] = [[]]
    for _ in range(MAX_HOPS):
        ways = [w + [k] for w in ways for k in links
                if k.table == (w[-1].to_table if w else start) and k.to_table not in {start, *(x.to_table for x in w)}]
        done = [w for w in ways if w[-1].to_table == goal]
        if done or not ways:
            return done
    return []


def _in_table(name: str, like: Any) -> Any:
    """A table the card does not read, named as the card names its neighbours: under the same catalog and schema."""
    from sqlglot import exp
    return exp.Table(this=exp.to_identifier(name), db=like.args.get("db"), catalog=like.args.get("catalog"))


def through(way: list[Link], f: Focus, like: Any) -> Any:
    """``column IN (SELECT key FROM next WHERE …)`` along a way, over the columns of the table it starts from."""
    from sqlglot import exp
    where = condition_of(f)
    for link in reversed(way):
        inner = exp.select(exp.column(link.to_column)).from_(_in_table(link.to_table, like)).where(where)
        where = exp.column(link.column).isin(query=inner)
    return where


def way_words(way: list[Link]) -> str:
    return " then ".join(f"{k.table}.{k.column}" for k in way)


def _read_tables(sql: str, dialect: str) -> dict[str, Any]:
    """Each table a statement reads, by its bare name, as the statement names it."""
    import sqlglot
    from sqlglot import exp

    from pramanyx.sql.lineage import sqlglot_dialect
    tree = sqlglot.parse_one(sql, read=sqlglot_dialect(dialect))
    ctes = {c.alias_or_name.lower() for c in tree.find_all(exp.CTE)}
    return {t.name.lower(): t for t in tree.find_all(exp.Table) if t.name and t.name.lower() not in ctes}


def _sets_of_rows(sql: str, dialect: str) -> bool:
    """Whether a statement adds sets of rows together, where one table left uncut would leave its rows in the figure."""
    import sqlglot
    from sqlglot import exp

    from pramanyx.sql.lineage import sqlglot_dialect
    return sqlglot.parse_one(sql, read=sqlglot_dialect(dialect)).find(exp.SetOperation) is not None


def _cut_through(sql: str, written: str, f: Focus, dialect: str, links: list[Link]) -> tuple[Optional[str], str, list[str]]:
    """``sql`` cut by a focus on a table ``written``, the statement as it stood before any cut, does not read:
    ``(sql, "", ways used)``, or ``(None, why, [])``."""
    from pramanyx.semantic.metric_statement import scoped_statement

    goal = bare(f.table)
    try:
        read = _read_tables(written, dialect)
    except Exception:  # noqa: BLE001 — a statement the parser cannot read is said, never cut by guesswork
        return None, "its statement does not parse", []
    reach = {name: ways_to(name, goal, links) for name in read}
    reached = {name: ways for name, ways in reach.items() if ways}
    if not reached:
        return None, f"it reads no {goal}, and no link leads from what it reads to {goal}", []
    if _sets_of_rows(written, dialect) and len(reached) < len(read):
        left = ", ".join(sorted(set(read) - set(reached)))
        return None, f"it adds {left} to its rows, and no link leads from there to {goal}", []
    for name, ways in sorted(reached.items()):
        if len(ways) > 1:
            return None, f"{name} reaches {goal} by more than one way ({', '.join(sorted(way_words(w) for w in ways))})", []
    used: list[str] = []
    for name, ways in sorted(reached.items()):
        cut, why, _ = scoped_statement(sql, name, through(ways[0], f, read[name]), dialect=dialect)
        if cut is None:
            return None, why, []
        sql = cut
        used.append(way_words(ways[0]))
    return sql, "", used


#: How the dialects a card is written in say "today": the parser's own nodes, and the calls it leaves as they are.
_TODAY_NODES = frozenset({"CurrentDate", "CurrentDatetime", "CurrentTimestamp", "CurrentTimestampLTZ", "CurrentTime"})
_TODAY_CALLS = frozenset({"NOW", "GETDATE", "TODAY", "SYSDATE", "SYSDATETIME", "LOCALTIMESTAMP"})


def _from_today(node: Any) -> bool:
    from sqlglot import exp
    return any(type(n).__name__ in _TODAY_NODES or (isinstance(n, exp.Anonymous) and n.name.upper() in _TODAY_CALLS)
               for n in node.walk())


def _own_window(node: Any) -> bool:
    """A condition bounding a column by a day worked out from today: the window a card draws for itself,
    ``created_at >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 12 MONTH)``."""
    from sqlglot import exp
    if isinstance(node, exp.Paren):
        node = node.unnest()
    return isinstance(node, (exp.GT, exp.GTE, exp.LT, exp.LTE, exp.EQ, exp.Between)) \
        and node.find(exp.Column) is not None and _from_today(node)


def without_own_window(sql: str, dialect: Optional[str]) -> tuple[str, list[str]]:
    """``sql`` with every window it works out from today taken out of its conditions, and those windows as written.

    A dashboard's dates are the window once a reader chooses them (the user, 2026-11-19, on Operations: "check if global
    date filters are working well"). Every card there was written for "the last 12 complete months", so a filter for this
    month, or for any day before that, cut inside a window that held none of it and the card read empty with nothing said.
    Only windows reckoned from today give way; a card's other conditions, and dates it names outright, stay as written."""
    import sqlglot
    from sqlglot import exp

    from pramanyx.sql.lineage import sqlglot_dialect
    d = sqlglot_dialect(dialect or "duckdb")
    try:
        tree = sqlglot.parse_one(sql, read=d)
    except Exception:  # noqa: BLE001 — a statement the parser cannot read keeps its window, said by the cut that reads it
        return sql, []
    taken: list[str] = []
    for where in list(tree.find_all(exp.Where)):
        parts = list(where.this.flatten()) if isinstance(where.this, exp.And) else [where.this]
        own = [p for p in parts if _own_window(p)]
        if not own:
            continue
        taken.extend(p.sql(dialect=d) for p in own)
        keep = [p for p in parts if not any(p is o for o in own)]
        if keep:
            where.set("this", exp.and_(*keep))
        else:
            where.pop()
    return (tree.sql(dialect=d) if taken else sql), taken


def cut_statement(sql: str, focus: list[Focus], dialect: Optional[str],
                  links: Optional[Callable[[], list[Link]]] = None) -> tuple[str, dict[str, Any]]:
    """``sql`` cut by every focus it can be — each table it reads replaced by itself filtered to the value, or, for a table
    it does not read, by the rows that belong to the value along the connection's links — and the verdict:
    ``{"applied": bool, "by": [...], "why": str}``, with ``through`` naming the columns a cut through a link used."""
    from pramanyx.semantic.metric_statement import scoped_statement, statement_tables

    said = dialect or "duckdb"
    written = sql
    tables = {bare(t) for t in statement_tables(sql, said)}
    applied: list[str] = []
    not_cut: list[str] = []
    used: list[str] = []
    known: Optional[list[Link]] = None
    for f in focus:
        if bare(f.table) not in tables:
            if links is None:
                not_cut.append(f"Not cut by {words(f)}: it reads no {bare(f.table)}.")
                continue
            known = links() if known is None else known
            cut, why, ways = _cut_through(sql, written, f, said, known)
            if cut is None:
                not_cut.append(f"Not cut by {words(f)}: {why}.")
                continue
            sql = cut
            applied.append(words(f))
            used.extend(f"{words(f)}, through {w}" for w in ways)
            continue
        cut, why, _ = scoped_statement(sql, bare(f.table), condition_of(f), dialect=said)
        if cut is None:
            not_cut.append(f"Not cut by {words(f)}: {why}.")
            continue
        sql = cut
        applied.append(words(f))
    gave_way: list[str] = []
    if any(f.op == "dates" and words(f) in applied for f in focus):
        # the chosen days are the card's window now: one it worked out from today gives way, and says so
        sql, gave_way = without_own_window(sql, said)
    return sql, verdict(applied, not_cut, used, gave_way)


def verdict(applied: list[str], not_cut: list[str], through_: Optional[list[str]] = None,
            gave_way: Optional[list[str]] = None) -> dict[str, Any]:
    """Applied when the card was cut by every focus; otherwise what it was cut by and why not the rest. ``own_window``
    says the card's own window, reckoned from today, gave way to the days chosen."""
    return {"applied": not not_cut and bool(applied), "by": applied, "why": " ".join(not_cut),
            **({"through": through_} if through_ else {}),
            **({"own_window": "Its own window, reckoned from today, gave way to the days chosen."} if gave_way else {})}


def parsed(raw: list[dict[str, Any]]) -> list[Focus]:
    """A run's focus, each held to its shape; too many is refused by `ValueError`."""
    if len(raw) > MAX_FOCUS:
        raise ValueError(f"A dashboard is filtered by at most {MAX_FOCUS} values at once.")
    return [Focus.model_validate(f) for f in raw]
