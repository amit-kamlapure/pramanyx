"""The answer path's governed metric read — the metric-views plan's M5 (`docs/METRIC_VIEWS_PLAN_2026-11-25.md` §4.5
item 4).

`query_metric` hands the model a governed metric grouped by dimensions, by a grain over a period, as the metric engine
compiles it (`semantic/metric_engine.py`): the platform's own figure, never a formula the model re-derives. It is offered
ONLY where the engine met the bar (`evals/metric_bar.py`): on the connection's golden metric-by-dimension questions, the
answers with this tool matched or beat the answers without it. Its forerunner — the object compiler offered as
`query_objects` — was deleted on 2026-10-04 after it lost to the model's own path (10 of 16 against 16 of 16): no compiled
path reaches answers on faith.
"""
from __future__ import annotations

from typing import Optional

from pramanyx.agent.tool_loop import ToolSpec

#: The most rows handed back to the model — the groups a metric-by-dimension answer reads.
ROWS_HANDED = 200

_PARAMS = {
    "type": "object",
    "properties": {
        "metric": {"type": "string", "description": "The governed metric's name, as the Semantic Layer keeps it"},
        "by": {"type": "array", "items": {"type": "string"},
               "description": "Dimensions to group by: the metric source's columns, or one a link reaches (`user.country`)"},
        "grain": {"type": "string", "enum": ["day", "week", "month", "quarter", "year"]},
        "start": {"type": "string", "description": "ISO date the period starts on (inclusive)"},
        "end": {"type": "string", "description": "ISO date the period ends before (exclusive)"},
        "filters": {"type": "array", "items": {"type": "object"},
                    "description": "Further conditions on top of the metric's own: {path, op, value} — op is one of "
                                   "=, !=, in, not_in, >, >=, <, <="},
    },
    "required": ["metric"],
}


def query_metric(connection_id: str, args: dict, *, schema_scope: Optional[str] = None) -> dict:
    """One governed metric, grouped and cut as asked — its rows, the statement it ran, its unit and the links it joined
    through — or why the engine does not compile it (the model then writes its own SQL, as it always could)."""
    from pramanyx.routers.ontology import served_ontology_graph
    from pramanyx.semantic import metric_engine as E
    from pramanyx.semantic.metrics import get_metric
    from pramanyx.semantic.object_query import ObjectQueryRefused
    name = str(args.get("metric") or "").strip()
    m = get_metric(name, connection_id=connection_id) if name else None
    if m is None:
        return {"refused": f"no metric named {name!r} on this connection"}
    try:
        graph = served_ontology_graph(connection_id, schema_scope)
    except Exception as exc:  # noqa: BLE001 — an unbuilt ontology is said, and the model writes its own SQL
        return {"refused": f"this connection's ontology could not be read ({type(exc).__name__})"}
    if graph is None:
        return {"refused": "this connection has no ontology yet — write the SQL instead"}
    resolve = lambda ref: get_metric(ref, connection_id=connection_id)  # noqa: E731
    try:
        with E.runner(connection_id, schema_scope, graph) as run:
            compiled, columns, rows = run(m, resolve=resolve, by=list(args.get("by") or []), grain=args.get("grain") or None,
                                          start=args.get("start") or None, end=args.get("end") or None,
                                          filters=list(args.get("filters") or []), limit=ROWS_HANDED)
    except (E.NotCompiled, ObjectQueryRefused) as e:
        return {"refused": f"the engine does not compile it: {e} — write the SQL instead"}
    except RuntimeError as e:
        return {"error": str(e)[:500]}
    unit, unit_why = E.unit_of(m, resolve)
    return {"metric": m.name, "label": m.label, "unit": unit, "unit_note": unit_why,
            "columns": [m.name if c == compiled.value else c for c in columns], "rows": rows[:ROWS_HANDED],
            "sql": compiled.sql, "said": compiled.caveats,
            "joined_through": [f"{ln.get('link')} ({ln.get('cardinality')})" for ln in compiled.links]}


def metric_tools(connection_id: str, *, schema_scope: Optional[str] = None) -> list[ToolSpec]:
    """``[query_metric]`` where the engine met the bar on this connection, else none — a tool the model can see is one
    it will spend a turn on, so one not proven is not shown."""
    from pramanyx.evals.metric_bar import offered
    if not offered(connection_id):
        return []
    return [ToolSpec(
        name="query_metric",
        description=(
            "Read a GOVERNED metric grouped by dimensions, by a period: the platform compiles it from the metric's "
            "approved definition — its measure, its filters, joins only through the ontology's links — so the figure is "
            "the one every page shows. Use it when a question is a defined metric by a dimension (\"revenue by "
            "country\", \"orders per month\"); add `filters` for the question's own conditions. If it is refused, write "
            "the SQL with run_sql."),
        parameters=_PARAMS,
        run=lambda a: query_metric(connection_id, a, schema_scope=schema_scope),
    )]

