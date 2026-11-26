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

from typing import Any, Optional

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


def compile_metric(metric: Any, graph: Any, *, dialect: str = "duckdb", **ask) -> Any:
    """The compiled statement (`CompiledObjectQuery`: ``sql`` in the connection's dialect, the ``links`` it joined
    through and how, its ``caveats``) — or :class:`NotCompiled` with the compiler's own reason."""
    from pramanyx.semantic.object_query import ObjectQueryRefused, compile_object_query
    g, query = plan(metric, graph, **ask)
    try:
        return compile_object_query(query, g, dialect=dialect)
    except ObjectQueryRefused as e:
        raise NotCompiled(str(e)) from e


def dimensions(metric: Any, graph: Any) -> list[dict]:
    """What ``metric`` may be grouped by: every property of its source's entity, and of each entity one to-one link
    away that the compiler may join — ``{path, label, type, via}``. Empty where it cannot be grouped."""
    from pramanyx.semantic.metric_structure import structured
    from pramanyx.semantic.object_query import link_problem, object_links
    if not structured(metric) or graph is None:
        return []
    try:
        ent = entity_of(metric, graph)
    except NotCompiled:
        return []

    def _label(e: Any, p: Any) -> str:
        return p.display_name or p.name

    out = [{"path": name, "label": _label(ent, p), "type": p.data_type or "", "via": ""}
           for name, p in sorted((ent.properties or {}).items())]
    for link in object_links(graph, ent):
        if not link.to_one or link_problem(link):
            continue
        for name, p in sorted((link.target.properties or {}).items()):
            out.append({"path": f"{link.name}.{name}", "label": f"{link.target.display_name or link.target.id} · {_label(link.target, p)}",
                        "type": p.data_type or "", "via": link.name})
    return out
