"""One metric engine — the metric-views plan's M2 (`docs/METRIC_VIEWS_PLAN_2026-11-25.md` §4.2; the user, 2026-11-26:
"Complete until M6").

``metric × dimensions × time grain × filters × period → SQL``, compiled deterministically by the object compiler that
already holds the join law (`semantic/object_query.py`): joins come from the ontology's links ONLY — a to-one link is
joined, a to-many one is pre-aggregated, an unmeasured or many-to-many one is refused, two paths with none pinned are
refused with both named — fiscal grains, and every dialect. The engine adds nothing to that law; it hands the compiler
the metric as what it already reads: a verified formula on the source's entity, and the metric's filters as a verified
segment of it, on a COPY of the graph (the served graph is never changed).

Coverage-gated: it compiles a metric written as parts whose source is an entity of the connection's ontology, and
otherwise says why — a statement cannot be grouped; a source no entity stands on has no links to join through — so a
caller falls back to the path it had, as the compiler always has.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator, Optional

#: The id the metric is handed to the compiler under, on the graph's copy — never a name a graph metric has.
ENGINE_METRIC_PREFIX = "__metric__"
#: The segment the metric's filters are applied as.
FILTERS_SEGMENT = "__metric_filters__"
GRAINS = ("hour", "day", "week", "month", "quarter", "year")


class NotCompiled(ValueError):
    """The engine does not compile this ask, and the message says why."""


def _f(m: Any, name: str) -> Any:
    return m.get(name) if isinstance(m, dict) else getattr(m, name, None)


def _bare(table: Any) -> str:
    return str(table or "").split(".")[-1].strip('`"[]').lower()


def entity_of(metric: Any, graph: Any):
    """The entity a metric's source stands on — the one whose table it is."""
    source = str(_f(metric, "source") or "").strip()
    for key in (source, _bare(source)):
        ent = graph.entity_for_table(key) if key else None
        if ent is not None:
            return ent
    want = _bare(source)
    for ent in (graph.entities or {}).values():
        backing = getattr(getattr(ent, "backing", None), "table", None)
        if want and want in {_bare(t) for t in [*(ent.source_tables or []), backing] if t}:
            return ent
    raise NotCompiled(f"its source {source} is no entity of this connection's ontology — the engine joins only through "
                      "the ontology's links, so it groups a metric whose source an entity stands on")


def _time_property(metric: Any, entity: Any) -> str:
    from pramanyx.semantic.metric_statement import split_grain
    table, column = split_grain(_f(metric, "time_column"))
    if not column:
        raise NotCompiled("its date is not set — a grain or a period needs the date its rows count on (Dates)")
    if table and _bare(table) != _bare(_f(metric, "source")):
        raise NotCompiled(f"its date is on {table}, not on its source {_f(metric, 'source')} — the engine reads a period "
                          "on the source's own date")
    if column not in (entity.properties or {}):
        raise NotCompiled(f"its date {column} is not a property of {entity.id}")
    return column


def plan(metric: Any, graph: Any, *, by: Optional[list[str]] = None, grain: Optional[str] = None,
         start: Optional[str] = None, end: Optional[str] = None, filters: Optional[list[dict]] = None,
         limit: int = 1000) -> tuple[Any, dict]:
    """``(graph copy, object query)`` measuring ``metric`` grouped ``by`` dimensions (property paths of its source's
    entity, or through its to-one links: ``user.country``), by ``grain`` over ``[start, end)``, with ``filters``
    (the object query's own typed filters) — or :class:`NotCompiled`, saying why."""
    from pramanyx.ontology.models import OntologyMetric, Segment
    from pramanyx.semantic.metric_structure import NOT_GROUPABLE, structured
    if not structured(metric):
        raise NotCompiled(NOT_GROUPABLE)
    if graph is None or not getattr(graph, "entities", None):
        raise NotCompiled("this connection has no ontology yet — the engine joins only through its links")
    if grain and grain not in GRAINS:
        raise NotCompiled(f"a grain is one of {', '.join(GRAINS)}")
    ent = entity_of(metric, graph)
    g = graph.model_copy(deep=True)
    key = f"{ENGINE_METRIC_PREFIX}{_f(metric, 'name')}"
    g.metrics = {**(g.metrics or {}), key: OntologyMetric(
        id=key, display_name=_f(metric, "label") or _f(metric, "name"), entity=ent.id,
        formula_sql=str(_f(metric, "measure")), tables=[str(_f(metric, "source"))], verified=True,
        verification_note="the metric's own measure, approved where its definition is")}
    query: dict = {"object_type": ent.id, "measures": [{"metric": key}], "by": list(by or []), "limit": int(limit)}
    conds = [str(c).strip() for c in (_f(metric, "filters") or []) if str(c).strip()]
    if conds:
        mine = g.entities[ent.id]
        mine.segments = {**(mine.segments or {}), FILTERS_SEGMENT: Segment(
            id=FILTERS_SEGMENT, display_name="The metric's filters",
            filter_sql=" AND ".join(f"({c})" for c in conds), verified=True)}
        query["segment"] = FILTERS_SEGMENT
    if grain or start or end:
        query["time"] = _time_property(metric, ent)
        if grain:
            query["grain"] = grain
        if start:
            query["start"] = start
        if end:
            query["end"] = end
    if filters:
        query["filters"] = list(filters)
    return g, query


@dataclass
class Compiled:
    """One statement the engine made: its SQL in the connection's dialect, its columns (the group keys, ``period`` when
    a grain is asked, then the value), the links it joined through and how, and what it says beside the figures."""
    sql: str
    columns: list[str]
    value: str
    links: list[dict] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)


WINDOWS = ("cumulative", "trailing", "offset", "first", "last")
#: The most rows a part of a composed or windowed statement reads — the groups it is joined or windowed over.
INNER_LIMIT = 10000


def check_window(window: Optional[dict]) -> str:
    """What is wrong with a window, in words — "" when nothing is."""
    if not window:
        return ""
    kind = str(window.get("kind") or "")
    if kind not in WINDOWS:
        return f"a window is one of {', '.join(WINDOWS)}"
    if kind in ("trailing", "offset"):
        n = window.get("n")
        if not isinstance(n, int) or not 1 <= n <= 366:
            return f"a {kind} window counts 1 to 366 periods"
    return ""


def compile_metric(metric: Any, graph: Any, *, dialect: str = "duckdb", resolve: Optional[Callable[[str], Any]] = None,
                   overlay: Any = None, window: Optional[dict] = None, _seen: frozenset = frozenset(), **ask) -> Compiled:
    """The one statement measuring ``metric`` as asked (``by``, ``grain``, ``start``, ``end``, ``filters``, ``limit``):
    over its source for a metric written as parts; each named metric compiled as asked and then combined for one built
    from metrics (§4.3) — never inside one aggregate, so a ratio never cross-multiplies; run across periods when a
    window is declared or asked (§4.4). Or :class:`NotCompiled`, saying why."""
    from pramanyx.semantic.metric_structure import composed
    name = str(_f(metric, "name") or "")
    if name in _seen:
        raise NotCompiled(f"MEASURE({name}) goes round in a circle")
    win = window if window is not None else _f(metric, "window")
    problem = check_window(win)
    if problem:
        raise NotCompiled(problem)
    if win and not ask.get("grain"):
        raise NotCompiled("a window runs across periods — choose a grain")
    if composed(metric):
        base = _compiled_composed(metric, graph, dialect=dialect, resolve=resolve, overlay=overlay,
                                  _seen=_seen | {name}, **{**ask, "limit": INNER_LIMIT if win else ask.get("limit", 1000)})
    else:
        base = _compiled_parts(metric, graph, dialect=dialect, overlay=overlay,
                               **{**ask, "limit": INNER_LIMIT if win else ask.get("limit", 1000)})
    return _windowed(metric, base, win, dialect=dialect, graph=graph, overlay=overlay, ask=ask) if win else base


def _compiled_parts(metric: Any, graph: Any, *, dialect: str, overlay: Any = None, **ask) -> Compiled:
    from pramanyx.semantic.object_query import ObjectQueryRefused, compile_object_query
    g, query = plan(metric, graph, **ask)
    try:
        c = compile_object_query(query, g, dialect=dialect, overlay=overlay)
    except ObjectQueryRefused as e:
        raise NotCompiled(str(e)) from e
    value = f"{ENGINE_METRIC_PREFIX}{_f(metric, 'name')}"
    return Compiled(sql=c.sql, columns=[str(x) for x in (c.columns or [])], value=value,
                    links=list(c.links or []), caveats=list(c.caveats or []))


def _compiled_composed(metric: Any, graph: Any, *, dialect: str, resolve: Optional[Callable[[str], Any]],
                       overlay: Any, _seen: frozenset, **ask) -> Compiled:
    import sqlglot
    from sqlglot import exp

    from pramanyx.semantic.metric_structure import safe_division, measure_refs
    name = str(_f(metric, "name") or "")
    refs = measure_refs(str(_f(metric, "measure")), dialect)
    if resolve is None:
        raise NotCompiled("a metric built from metrics is compiled with its connection's metrics in hand")
    parts: list[tuple[str, Compiled]] = []
    metrics = []
    for ref in refs:
        m = resolve(ref)
        if m is None:
            raise NotCompiled(f"MEASURE({ref}) names no metric of this connection")
        metrics.append(m)
    by = list(ask.get("by") or [])
    reaches = _reaches(metrics[0], graph, resolve, by) if by else []
    for i, (ref, m) in enumerate(zip(refs, metrics)):
        try:
            own = _paths_for(m, graph, resolve, reaches, by) if by else by
            sub = compile_metric(m, graph, dialect=dialect, resolve=resolve, overlay=overlay, _seen=_seen,
                                 **{**ask, "by": own, "limit": INNER_LIMIT})
        except NotCompiled as e:
            raise NotCompiled(f"MEASURE({ref}) {e}") from e
        parts.append((f"m{i}", sub))
    keys = [c for c in parts[0][1].columns if c != parts[0][1].value]
    renamed: dict[str, list[str]] = {}
    for alias, sub in parts[1:]:
        theirs = [c for c in sub.columns if c != sub.value]
        if len(theirs) != len(keys) or (theirs[-1:] == ["period"]) != (keys[-1:] == ["period"]):
            raise NotCompiled(f"the metrics it is built from group differently ({', '.join(keys) or 'one figure'} and "
                              f"{', '.join(theirs) or 'one figure'}) — group them by a dimension both reach")
        if theirs != keys:
            renamed[alias] = theirs              # the same dimension reached by another path: its column takes the first's name
    by_ref = {ref: (alias, sub) for ref, (alias, sub) in zip(refs, parts)}

    def swap(n: exp.Expression) -> exp.Expression:
        if isinstance(n, exp.Anonymous) and str(n.name).upper() == "MEASURE":
            alias, sub = by_ref[str(n.expressions[0].name)]
            return exp.column(sub.value, table=alias)
        return n
    value_expr = safe_division(sqlglot.parse_one(str(_f(metric, "measure")), read=dialect).transform(swap))
    value = f"{ENGINE_METRIC_PREFIX}{name}"
    first = parts[0][0]
    select = exp.select(*[exp.alias_(exp.Coalesce(this=exp.column(k, table=first),
                                                  expressions=[exp.column(k, table=a) for a, _ in parts[1:]]), k)
                          for k in keys], exp.alias_(value_expr, value)).from_(first)
    for alias, _ in parts[1:]:
        if keys:
            # one key column per part, compared as plain equality: BigQuery refuses a FULL JOIN on anything else (seen
            # live, 2026-11-26: `IS NOT DISTINCT FROM` was refused), and "no value" is a group like any other
            select = select.join(alias, on=exp.EQ(this=exp.column(KEY, table=first), expression=exp.column(KEY, table=alias)),
                                 join_type="full outer")
        else:
            select = select.join(alias, join_type="cross")
    if ask.get("limit"):
        select = select.limit(int(ask["limit"]))
    keyed = f", {_key_of(keys, dialect)} AS {KEY}" if keys else ""

    def lined_up(alias: str, sub: Compiled) -> str:
        if alias not in renamed:
            return f"({sub.sql}) AS _{alias}"
        cols = ", ".join([exp.alias_(exp.column(c), k).sql(dialect=dialect) for c, k in zip(renamed[alias], keys)]
                         + [exp.column(sub.value).sql(dialect=dialect)])
        return f"(SELECT {cols} FROM ({sub.sql}) AS _r{alias}) AS _{alias}"
    withs = ", ".join(f"{alias} AS (SELECT *{keyed} FROM {lined_up(alias, sub)})" for alias, sub in parts)
    links = [ln for _, sub in parts for ln in sub.links]
    return Compiled(sql=f"WITH {withs} {select.sql(dialect=dialect)}", columns=[*keys, value], value=value,
                    links=links, caveats=[c for _, sub in parts for c in sub.caveats])


def _reaches(metric: Any, graph: Any, resolve: Optional[Callable[[str], Any]], by: list[str]) -> list[str]:
    """What each of ``by`` reaches from ``metric`` (one entity's property), a path or a reach given."""
    known = {d["path"]: d["reach"] for d in dimensions(metric, graph, resolve)}
    reaches = set(known.values())
    out = []
    for b in by:
        if b in known:
            out.append(known[b])
        elif b in reaches:
            out.append(b)
        else:
            raise NotCompiled(f"{b} is not a dimension its metrics reach")
    return out


def _paths_for(metric: Any, graph: Any, resolve: Optional[Callable[[str], Any]], reaches: list[str], by: list[str]) -> list[str]:
    """Each of ``reaches`` as ``metric``'s own path to it — the shortest, its own property before a linked one's."""
    mine: dict[str, str] = {}
    for d in dimensions(metric, graph, resolve):
        if d["reach"] not in mine or len(d["path"]) < len(mine[d["reach"]]):
            mine[d["reach"]] = d["path"]
    out = []
    for r, b in zip(reaches, by):
        if r not in mine:
            raise NotCompiled(f"{b} is not a dimension {_f(metric, 'name')} reaches")
        out.append(mine[r])
    return out


#: The one column a composed metric's parts are joined on: their group keys, "no value" read as a marker of its own.
KEY = "_group_key"
_NO_VALUE = "\u2205"


def _key_of(keys: list[str], dialect: str) -> str:
    from sqlglot import exp
    parts = [exp.Coalesce(this=exp.Cast(this=exp.column(k), to=exp.DataType.build("TEXT")),
                          expressions=[exp.Literal.string(_NO_VALUE)]) for k in keys]
    node = parts[0] if len(parts) == 1 else exp.Concat(expressions=[p for i, x in enumerate(parts)
                                                                    for p in ([exp.Literal.string("|")] if i else []) + [x]])
    return node.sql(dialect=dialect)


def _windowed(metric: Any, base: Compiled, window: dict, *, dialect: str, graph: Any, overlay: Any, ask: dict) -> Compiled:
    """``base`` run across its periods: a running total or the last N periods (an additive metric only — a running
    total of a rate is not a rate), the figure N periods before, or a stock's first or last reading in each period."""
    from pramanyx.ontology.window_measures import WindowMeasure, compile_measure
    kind, n = window["kind"], window.get("n")
    keys = [c for c in base.columns if c not in (base.value, "period")]
    q = lambda c: f'"{c}"' if dialect not in ("bigquery", "mysql") else f"`{c}`"  # noqa: E731
    parts = ", ".join(q(k) for k in keys)
    v = q(base.value)
    if kind in ("cumulative", "trailing"):
        from pramanyx.semantic.metrics import metric_additivity
        if not metric_additivity(metric):
            raise NotCompiled(f"a {'running total' if kind == 'cumulative' else 'trailing sum'} of a rate or an average is "
                              "not that rate — window the metrics it is built from, or mark it additive if it sums")
        expr = compile_measure(WindowMeasure(expression=f"SUM({v})", order_by="period",
                                             range="cumulative" if kind == "cumulative" else "trailing",
                                             window=n if kind == "trailing" else None,
                                             partition_by=tuple(q(k) for k in keys)))
    elif kind == "offset":
        over = f"PARTITION BY {parts} ORDER BY period" if keys else "ORDER BY period"
        expr = f"LAG({v}, {int(n)}) OVER ({over})"
    else:
        # a stock read at its period's edge: the base by day, then each period's first or last day
        day = compile_metric(metric, graph, dialect=dialect, overlay=overlay, window={},
                             **{**ask, "grain": "day", "limit": INNER_LIMIT})
        from pramanyx.sql.fiscal import fiscal_period_expr
        bucket = fiscal_period_expr(ask["grain"], "period", 1, dialect)
        order = "ASC" if kind == "first" else "DESC"
        over = f"PARTITION BY {', '.join([*(q(k) for k in keys), bucket])} ORDER BY period {order}"
        sql = (f"SELECT {''.join(f'{q(k)}, ' for k in keys)}{bucket} AS period, {q(day.value)} AS {v} FROM ("
               f"SELECT *, ROW_NUMBER() OVER ({over}) AS _edge FROM ({day.sql}) AS _d) AS _e WHERE _edge = 1")
        return Compiled(sql=sql, columns=[*keys, "period", base.value], value=base.value, links=day.links,
                        caveats=[*day.caveats, f"each {ask['grain']}'s {kind} day"])
    sql = (f"SELECT {''.join(f'{q(k)}, ' for k in keys)}period, {expr} AS {v} FROM ({base.sql}) AS _b")
    periods = "period" if n == 1 else f"{n} periods"
    said = {"cumulative": "a running total", "trailing": f"the last {periods} summed",
            "offset": f"the figure {'one period' if n == 1 else periods} before"}
    return Compiled(sql=sql, columns=[*keys, "period", base.value], value=base.value, links=base.links,
                    caveats=[*base.caveats, said[kind]])


def _a_count(unit: str) -> bool:
    u = (unit or "").strip().lower()
    return u in {"count", "#", "n", "number", "items", "units", "rows"} or u.startswith("count")


def unit_of(metric: Any, resolve: Optional[Callable[[str], Any]] = None) -> tuple[Optional[str], str]:
    """A figure's unit: the one it declares; for a metric built from metrics with none declared, derived where it can
    be (§4.3) — two figures in one unit divided are a ratio, with none; a figure in a unit divided by a count keeps
    that unit — and said where it cannot be."""
    import sqlglot
    from sqlglot import exp

    from pramanyx.semantic.metric_structure import composed
    declared = str(_f(metric, "unit") or "").strip()
    if declared or not composed(metric) or resolve is None:
        return declared or None, ""
    node = sqlglot.parse_one(str(_f(metric, "measure")))
    while isinstance(node, exp.Paren):
        node = node.this
    if not isinstance(node, exp.Div) or not all(isinstance(x, exp.Anonymous) and str(x.name).upper() == "MEASURE"
                                                for x in (node.this, node.expression)):
        return None, "its unit is not derived from the metrics it is built from — say it on the metric"
    a, b = (resolve(str(x.expressions[0].name)) for x in (node.this, node.expression))
    # a count's unit is a count: "count", "#", "items" — a figure over it keeps its own unit
    ua, ub = ("" if _a_count(u) else u for u in (str(_f(m, "unit") or "").strip() if m is not None else "" for m in (a, b)))
    if ua and ua == ub:
        return None, f"a ratio of two figures in {ua} — it has no unit"
    if ua and not ub:
        return ua, f"{ua} for each of {_f(b, 'label') or _f(b, 'name')}"
    if not ua and not ub:
        return None, "a ratio of two counts — it has no unit"
    return None, "its unit is not derived from the metrics it is built from — say it on the metric"


@contextmanager
def runner(connection_id: str, schema_name: Optional[str], graph: Any) -> Iterator[Callable[..., tuple]]:
    """``run(metric, resolve=…, **ask) -> (Compiled, columns, rows)`` over the connection, through the object door as
    `POST /objects/query` reads: the accepted edits read as properties, row policies applied by the compiler, the guard
    battery on the statement."""
    from pramanyx.actions.overlay import accepted_object_edits
    from pramanyx.db.connection import open_connection_for_with_schema
    from pramanyx.ontology.security_sql import object_door
    from pramanyx.routers.ontology import resolve_effective_schema
    from pramanyx.sql.executor import execute_guarded
    db = open_connection_for_with_schema(connection_id,
                                         getattr(graph, "schema_name", None) or resolve_effective_schema(connection_id, schema_name))
    overlay = accepted_object_edits(connection_id)
    dialect = getattr(db, "dialect", "") or "duckdb"

    def run(metric: Any, *, resolve: Optional[Callable[[str], Any]] = None, **ask) -> tuple:
        compiled = compile_metric(metric, graph, dialect=dialect, resolve=resolve, overlay=overlay, **ask)
        with object_door():
            result = execute_guarded(db, compiled.sql, query_id="metrics.query")
        if result.error:
            raise RuntimeError(result.error)
        # the door hands SQL NULL back as the text "NULL": a value that is none is none (a dimension's text is its own)
        at = len(compiled.columns) - 1
        rows = [[None if (i == at and c == "NULL") else c for i, c in enumerate(r)] for r in (result.rows or [])]
        return compiled, list(result.columns or []) or compiled.columns, rows
    try:
        yield run
    finally:
        db.close()


def why_not_grouped(metric: Any, graph: Any, resolve: Optional[Callable[[str], Any]] = None) -> str:
    """Why ``metric`` cannot be grouped by the engine — "" when it can."""
    try:
        compile_metric(metric, graph, resolve=resolve, window={}, limit=1)
    except NotCompiled as e:
        return str(e)
    return ""


def dimensions(metric: Any, graph: Any, resolve: Optional[Callable[[str], Any]] = None) -> list[dict]:
    """What ``metric`` may be grouped by: every property of its source's entity, and of each entity one to-one link
    away that the compiler may join — ``{path, label, type, via}``; for a metric built from metrics, the ones every
    metric it names may be grouped by. Empty where it cannot be grouped."""
    from pramanyx.semantic.metric_structure import composed, measure_refs, structured
    from pramanyx.semantic.object_query import link_problem, object_links
    if composed(metric):
        refs = [resolve(r) for r in measure_refs(str(_f(metric, "measure")))] if resolve else []
        if not refs or any(r is None for r in refs):
            return []
        each = [dimensions(r, graph, resolve) for r in refs]
        # shared by what each REACHES — one entity's property — not by the path's words: parts over different sources
        # reach the same property by different paths (2026-11-26; before, only a path spelled alike in both was offered)
        shared = set.intersection(*[{d["reach"] for d in ds} for ds in each]) if each else set()
        return [d for d in each[0] if d["reach"] in shared]
    if not structured(metric) or graph is None:
        return []
    try:
        ent = entity_of(metric, graph)
    except NotCompiled:
        return []

    def _label(e: Any, p: Any) -> str:
        return p.display_name or p.name

    out = [{"path": name, "label": _label(ent, p), "type": p.data_type or "", "via": "", "reach": f"{ent.id}.{name}"}
           for name, p in sorted((ent.properties or {}).items())]
    for link in object_links(graph, ent):
        if not link.to_one or link_problem(link):
            continue
        for name, p in sorted((link.target.properties or {}).items()):
            out.append({"path": f"{link.name}.{name}", "label": f"{link.target.display_name or link.target.id} · {_label(link.target, p)}",
                        "type": p.data_type or "", "via": link.name, "reach": f"{link.target.id}.{name}"})
    return out
