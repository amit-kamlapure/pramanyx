"""A metric written as parts — the metric-views plan's M1 (`docs/METRIC_VIEWS_PLAN_2026-11-25.md` §4.1; the user,
2026-11-25: "A metric is structured").

A structured metric names its SOURCE (a table of its connection), its MEASURE (one aggregate expression over the
source's rows), the FILTERS always applied, and the DIMENSIONS it may be grouped by (empty — every column the source
has or reaches through a to-one link). Its statement is COMPOSED from those parts on every save, never written beside
them, so every reader that runs a metric's `sql` today runs the same figure, and the engine (M2) can group it by any
dimension. A statement-form metric keeps working everywhere it does today, and says it cannot be grouped.

Migration splits a statement only where `measure_of` splits it exactly — one table, one measure, a WHERE — AND both
statements give the same figure on the warehouse, checked by running both; everything else stays a statement, and says
why. Pure here but for the runner a caller hands in: sqlglot in, sqlglot out, no store, no model.
"""
from __future__ import annotations

import math
from typing import Any, Callable, Optional

import sqlglot
from sqlglot import exp

#: Said wherever a grouping is asked of a metric written as one whole query.
NOT_GROUPABLE = "cannot be grouped: it is one whole query"


def _field(m: Any, name: str) -> Any:
    return m.get(name) if isinstance(m, dict) else getattr(m, name, None)


def structured(m: Any) -> bool:
    """Whether ``m`` is written as parts: a source and a measure."""
    return bool(str(_field(m, "measure") or "").strip() and str(_field(m, "source") or "").strip())


def _alias(name: str) -> str:
    out = "".join(c if c.isalnum() or c == "_" else "_" for c in (name or "value").strip().lower()).strip("_")
    return out if out and not out[0].isdigit() else f"m_{out or 'value'}"


def compose(name: str, source: str, measure: str, filters: Optional[list] = None, dialect: Optional[str] = None) -> str:
    """The statement a structured metric computes: its measure over its source's rows, its filters always applied.

    Built as a tree, not by gluing strings, so a measure or a filter that does not parse fails here and not in the
    warehouse; the result reads in the connection's dialect."""
    problem = check_parts(source, measure, filters, dialect)
    if problem:
        raise ValueError(problem)
    select = exp.select(exp.alias_(sqlglot.parse_one(measure, read=dialect), _alias(name), quoted=False)).from_(
        exp.to_table(source.strip(), dialect=dialect))
    conds = [sqlglot.parse_one(f, read=dialect) for f in (filters or []) if str(f or "").strip()]
    if conds:
        select = select.where(exp.and_(*[exp.Paren(this=c) for c in conds]))
    return select.sql(dialect=dialect)


def check_parts(source: str, measure: str, filters: Optional[list] = None, dialect: Optional[str] = None) -> str:
    """What is wrong with these parts, in words — "" when nothing is. Read by the save door before any warehouse."""
    src = str(source or "").strip()
    if not src:
        return "A structured metric names its source: the table its rows come from."
    try:
        table = exp.to_table(src, dialect=dialect)
        if not isinstance(table, exp.Table) or not table.name:
            raise ValueError(src)
    except Exception:
        return f"{src!r} is not a table name — write it as table or schema.table."
    body = str(measure or "").strip()
    if not body:
        return "A structured metric has a measure: one aggregate over its source's rows, e.g. SUM(sale_price)."
    if body.lower().startswith(("select", "with")):
        return ("The measure is the aggregate alone, e.g. SUM(sale_price) — the source and the filters are its "
                "other parts. Write a whole query as a statement instead.")
    try:
        node = sqlglot.parse_one(body, read=dialect)
    except Exception as e:
        return f"The measure does not parse: {str(e).splitlines()[0][:160]}"
    if isinstance(node, (exp.Select, exp.Subquery)) or list(node.find_all(exp.Subquery)):
        return "The measure is one aggregate expression, with no query inside it."
    if not list(node.find_all(exp.AggFunc)) and not _measure_refs(node):
        return (f"{body!r} aggregates nothing — a measure sums, counts or averages the source's rows, "
                "e.g. COUNT(DISTINCT order_id).")
    for f in filters or []:
        text = str(f or "").strip()
        if not text:
            continue
        try:
            cond = sqlglot.parse_one(text, read=dialect)
        except Exception as e:
            return f"The filter {text!r} does not parse: {str(e).splitlines()[0][:160]}"
        if list(cond.find_all(exp.AggFunc)):
            return f"The filter {text!r} aggregates — a filter keeps or drops single rows."
    return ""


def _measure_refs(node: exp.Expression) -> list[str]:
    """The metrics a measure is composed of — ``MEASURE(revenue)`` (§4.3, M3)."""
    return [str(f.expressions[0].name if f.expressions else "") for f in node.find_all(exp.Anonymous)
            if str(f.name).upper() == "MEASURE"]


def groupable(m: Any) -> tuple[bool, str]:
    """Whether the engine may group ``m`` by a dimension, and why not."""
    if structured(m):
        return True, ""
    return False, NOT_GROUPABLE


def split(m: Any, dialect: Optional[str] = None) -> tuple[Optional[dict], str]:
    """A statement's parts — ``({source, measure, filters}, "")`` where `measure_of` splits it exactly — else
    ``(None, why)``. Exactly: one projection over one table, no join, grouping, CTE, subquery or limit."""
    from pramanyx.semantic.metric_statement import is_statement
    from pramanyx.sql.metric_filter_guard import measure_of
    sql = str(_field(m, "sql") or "").strip()
    if structured(m):
        return None, "already written as parts"
    if not is_statement(sql):
        return None, "an expression, not a statement — it is read with its tables as before"
    parts = measure_of(_unaliased(sql, dialect or "duckdb"), dialect or "duckdb")
    if not parts or len(parts.get("tables") or []) != 1:
        return None, ("one whole query — it joins tables, groups, or uses a CTE or a subquery, so no single source "
                      "and measure can be lifted out of it")
    out = {"source": parts["tables"][0], "measure": parts["formula"], "filters": list(parts.get("filters") or [])}
    problem = check_parts(out["source"], out["measure"], out["filters"], dialect)
    return (None, problem) if problem else (out, "")


def _unaliased(sql: str, dialect: str) -> str:
    """A one-table statement with its table's alias and its own name taken off every column — over one table they say
    nothing, and a part lifted out of `FROM orders AS t0` must not still say `t0.` (live, 2026-11-26: six of theLook's
    statements are written so, and their parts did not run). A statement over more tables is returned as it is."""
    try:
        tree = sqlglot.parse_one(sql, read=dialect)
    except Exception:  # noqa: BLE001 — `measure_of` says it does not parse, in its own words
        return sql
    if not isinstance(tree, exp.Select) or tree.args.get("joins"):
        return sql
    source = tree.args.get("from_") or tree.args.get("from")
    table = source.this if source is not None else None
    if not isinstance(table, exp.Table):
        return sql
    names = {n for n in (table.alias, table.name) if n}
    for col in tree.find_all(exp.Column):
        if col.table and col.table in names:
            col.set("table", None)
            col.set("db", None)
            col.set("catalog", None)
    if table.alias:
        table.set("alias", None)
    return tree.sql(dialect=dialect)


def same_figure(a: Any, b: Any) -> bool:
    """Whether two statements' one figure is the same: equal, or within a float's rounding."""
    if a is None or b is None:
        return a is None and b is None
    try:
        x, y = float(a), float(b)
    except (TypeError, ValueError):
        return str(a) == str(b)
    if math.isnan(x) or math.isnan(y):
        return math.isnan(x) and math.isnan(y)
    return math.isclose(x, y, rel_tol=1e-9, abs_tol=1e-9)


def migration_row(m: Any, run: Callable[[str], Any], dialect: Optional[str] = None) -> dict:
    """One metric's migration verdict: split (its parts, both figures the same) or kept (why). ``run`` takes a
    statement and returns its one figure, or raises."""
    name = str(_field(m, "name") or "")
    parts, why = split(m, dialect)
    row = {"name": name, "label": _field(m, "label") or name, "outcome": "kept", "why": why, "parts": None,
           "before": None, "after": None}
    if parts is None:
        return row
    composed = compose(name, parts["source"], parts["measure"], parts["filters"], dialect)
    try:
        before, after = run(str(_field(m, "sql") or "")), run(composed)
    except Exception as e:  # noqa: BLE001 — said on the row: a statement the warehouse could not run is not split
        row["why"] = f"could not be run to compare: {str(e).splitlines()[0][:200]}"
        return row
    row.update(before=before, after=after)
    if not same_figure(before, after):
        row["why"] = f"the parts give {after}, the statement {before} — kept as it is"
        return row
    row.update(outcome="split", why="", parts={**parts, "sql": composed})
    return row
