"""Metric view YAML in and out — the metric-views plan's M6 (`docs/METRIC_VIEWS_PLAN_2026-11-25.md` §4.7; the user's
call 4, 2026-11-25: "Metric view YAML in and out").

A Databricks metric view (`version: 1.1`) maps onto the structured metric (M1–M4): its `source` → each metric's source,
its `filter` → filters, its `fields` (`dimensions` in 0.1) → dimensions, each of its `measures` → a metric (one that
reads `MEASURE(other)` → a metric built from metrics, M3), its `window` → the window, its `display_name`, `format`,
`synonyms` and `comment` → the same. Its `joins` are not copied onto metrics — joins live in the ontology's links (call
2) — they are PROPOSED as links for a person to accept, the YAML's cardinality the claim and the platform's own count the
check. Whatever does not map is said, by name, never dropped silently: `parameters`, `materialization`, `rely`, a
source written as a query, a field that is an expression.

Export writes the same shape from a connection's structured metrics, one document per source: each metric's own
filters inside its measure (`FILTER (WHERE …)`), the filters every metric shares as the view's, its joins read from the
links its dimensions go through. A statement is not a metric view, and is said so. Deterministic; no model.

A metric view's expressions are Databricks SQL; a metric's are its connection's own. Export translates each one into the
former and import back into the latter (`_translate`), so a BigQuery `SAFE_DIVIDE` goes out as `TRY_DIVIDE` and comes
back as it was. A measure whose every aggregate carries the same `FILTER (WHERE c)` comes in as the measure with `c`
among its filters — where export put it from — and one whose aggregates are filtered differently has each written as the
aggregate over `CASE WHEN c THEN … END`, which every engine runs (BigQuery has no `FILTER`).
"""
from __future__ import annotations

import re
from typing import Any, Optional

import sqlglot
from sqlglot import exp

#: Keys a metric view may carry that the structured metric does not take, and why.
NOT_TAKEN = {"parameters": "a metric is queried with its dimensions and a period, not as a function with arguments",
             "materialization": "the result cache stands in; materialization is its own plan (the plan's call 3)"}
_FORMATS = {"number": "number", "currency": "currency", "percentage": "percent", "percent": "percent"}


#: The SQL a metric view's expressions are written in.
VIEW_DIALECT = "databricks"


def _translate(expr: str, read: Optional[str], write: Optional[str]) -> str:
    """An expression from one engine's SQL into another's; as written when they are the same, either is unknown, or it
    does not parse (the metric's own run check then says what is wrong with it)."""
    if not expr or not read or not write or read == write:
        return expr
    try:
        return sqlglot.transpile(expr, read=read, write=write)[0]
    except Exception:  # noqa: BLE001 — an expression sqlglot cannot read is kept as written; its run check says why
        return expr


def _conjuncts(cond: str, dialect: Optional[str]) -> list[str]:
    """A condition in the view's SQL as the connection's filters, one per part of a top-level AND — export joins a
    metric's several filters into one condition, and they come back as several."""
    if not cond:
        return []
    try:
        node = sqlglot.parse_one(cond, read=VIEW_DIALECT)
    except Exception:  # noqa: BLE001 — kept whole, as written; the metric's run check says what is wrong with it
        return [cond]
    parts = list(node.flatten()) if isinstance(node, exp.And) else [node]
    return [_translate((p.this if isinstance(p, exp.Paren) else p).sql(dialect=VIEW_DIALECT), VIEW_DIALECT, dialect)
            for p in parts]


def _measure_in(expr: str, dialect: Optional[str]) -> tuple[str, list[str]]:
    """A metric view measure as a metric's: ``(measure, its own filters)`` in the connection's SQL. The same `FILTER`
    on every aggregate is lifted into the filters; differing ones become `CASE WHEN` inside each aggregate."""
    try:
        node = sqlglot.parse_one(expr, read=VIEW_DIALECT)
    except Exception:  # noqa: BLE001 — kept as written; the metric's run check says what is wrong with it
        return expr, []
    aggs = [n for n in node.find_all(exp.AggFunc) if not isinstance(n.parent, exp.Filter)] + \
        [f.this for f in node.find_all(exp.Filter)]
    conds = {f.expression.this.sql(dialect=VIEW_DIALECT) for f in node.find_all(exp.Filter) if isinstance(f.expression, exp.Where)}
    filtered = list(node.find_all(exp.Filter))
    if not filtered:
        return _translate(expr, VIEW_DIALECT, dialect), []
    if len(conds) == 1 and len(filtered) == len(aggs):
        cond = filtered[0].expression.this
        lifted = node.transform(lambda n: n.this if isinstance(n, exp.Filter) else n)
        return lifted.sql(dialect=dialect or VIEW_DIALECT), _conjuncts(cond.sql(dialect=VIEW_DIALECT), dialect)

    def case(n: exp.Expression) -> exp.Expression:
        if not (isinstance(n, exp.Filter) and isinstance(n.expression, exp.Where)):
            return n
        agg, cond = n.this.copy(), n.expression.this
        arg = agg.this
        if isinstance(arg, exp.Distinct):
            arg.set("expressions", [exp.Case(ifs=[exp.If(this=cond.copy(), true=e)]) for e in arg.expressions])
        else:
            inner = exp.Literal.number(1) if arg is None or isinstance(arg, exp.Star) else arg
            agg.set("this", exp.Case(ifs=[exp.If(this=cond.copy(), true=inner)]))
        return agg
    return node.transform(case).sql(dialect=dialect or VIEW_DIALECT), []


def looks_like_metric_view(doc: Any) -> bool:
    return isinstance(doc, dict) and isinstance(doc.get("measures"), list) and bool(doc.get("source"))


def _slug(name: Any) -> str:
    out = re.sub(r"[^a-z0-9]+", "_", str(name or "").strip().lower()).strip("_")
    return out if out and not out[0].isdigit() else f"m_{out}"


def _table(source: str) -> tuple[str, str]:
    """The table a source names, as this connection reads it, and what was taken off: a Unity Catalog three-part name
    keeps its table; its catalog and schema are the connection's."""
    parts = [p.strip("`\"") for p in source.split(".") if p.strip()]
    if len(parts) <= 1:
        return source.strip("`\""), ""
    return parts[-1], ".".join(parts[:-1])


def _plain_column(expr: str) -> Optional[str]:
    try:
        node = sqlglot.parse_one(expr)
    except Exception:  # noqa: BLE001 — an expression that does not parse is not a plain column; said by the caller
        return None
    return node.name if isinstance(node, exp.Column) else None


def _window(spec: Any) -> tuple[Optional[dict], str]:
    """One measure's window list → the structured metric's window, and what was not taken."""
    items = spec if isinstance(spec, list) else ([spec] if isinstance(spec, dict) else [])
    if not items:
        return None, ""
    w = items[0] if isinstance(items[0], dict) else {}
    extra = f"; {len(items) - 1} more window(s) not taken — a metric runs one" if len(items) > 1 else ""
    if w.get("semiadditive") in ("first", "last"):
        return {"kind": w["semiadditive"]}, extra
    rng = str(w.get("range") or "").strip().lower()
    if rng == "cumulative":
        return {"kind": "cumulative"}, extra
    m = re.match(r"(trailing|leading)\s+(\d+)\s+(\w+)", rng)
    if m and m.group(1) == "trailing":
        return {"kind": "trailing", "n": int(m.group(2))}, extra + f" (a trailing window counts periods of the grain asked: {m.group(3)})"
    off = re.match(r"\s*-?(\d+)", str(w.get("offset") if w.get("offset") is not None else ""))
    if off:                                            # "-1 month", 1: the periods back, of the grain asked
        return {"kind": "offset", "n": int(off.group(1))}, extra
    return None, f"its window ({rng or w}) is not one a metric runs"


def _format(spec: Any) -> Optional[dict]:
    if not isinstance(spec, dict):
        return None
    kind = _FORMATS.get(str(spec.get("type") or "").lower())
    if not kind:
        return None
    places = spec.get("decimal_places")
    decimals = places.get("places") if isinstance(places, dict) else places if isinstance(places, int) else None
    return {"format": kind, "currency": str(spec.get("currency_code") or "").upper(), "decimals": decimals,
            "compact": str(spec.get("abbreviation") or "").lower() == "compact"}


def map_metric_view(doc: dict, *, dialect: Optional[str] = None) -> tuple[dict, list[str], list[dict]]:
    """``(sections, said, joins)``: the bundle's metrics, each line of what was not taken, and the joins to propose as
    links (``{left_table, left_col, right_table, right_col, claim}``). ``dialect`` is the connection's SQL, the one its
    expressions are translated into (none: kept as written)."""
    said: list[str] = []
    source_raw = str(doc.get("source") or "").strip()
    if source_raw.lower().startswith(("select", "with", "(")):
        return {}, ["its source is a query, not a table — its measures are not taken: write them over a table"], []
    source, dropped = _table(source_raw)
    if dropped:
        said.append(f"its source {source_raw} is read as {source} on this connection (the catalog and schema are the connection's)")
    for key, why in NOT_TAKEN.items():
        if doc.get(key):
            said.append(f"`{key}` is not taken — {why}")
    top = _conjuncts(str(doc.get("filter") or "").strip(), dialect)
    dims: list[str] = []
    for f in doc.get("fields") or doc.get("dimensions") or []:
        if not isinstance(f, dict):
            continue
        col = _plain_column(str(f.get("expr") or f.get("name") or ""))
        if col:
            dims.append(col)
        else:
            said.append(f"the field {f.get('name')} is an expression ({f.get('expr')}), not taken as a dimension — group "
                        "by its columns")
    names = {str(m.get("name")): _slug(m.get("name")) for m in doc.get("measures") or [] if isinstance(m, dict)}
    metrics: list[dict] = []
    for m in doc.get("measures") or []:
        if not isinstance(m, dict) or not m.get("expr"):
            continue
        name = names[str(m.get("name"))]
        expr = str(m["expr"]).strip()
        refs = re.findall(r"MEASURE\(\s*`?([A-Za-z0-9_ ]+?)`?\s*\)", expr, flags=re.I)
        for ref in refs:
            expr = re.sub(rf"MEASURE\(\s*`?{re.escape(ref)}`?\s*\)", f"MEASURE({names.get(ref, _slug(ref))})", expr, flags=re.I)
        own: list[str] = []
        if not refs:
            expr, own = _measure_in(expr, dialect)
        metric: dict[str, Any] = {"name": name, "label": str(m.get("display_name") or m.get("name")), "measure": expr,
                                  "dimensions": [] if refs else list(dims)}
        if not refs:
            metric.update(source=source, filters=top + own)
        if m.get("comment"):
            metric["caveats"] = str(m["comment"])
        window, why = _window(m.get("window"))
        if window:
            metric["window"] = window
        if why:
            said.append(f"the measure {m.get('name')}: {why.lstrip('; ')}")
        fmt = _format(m.get("format"))
        if fmt:
            metric["format"] = fmt
        elif m.get("format"):
            said.append(f"the measure {m.get('name')}'s format ({m['format']}) is not one a metric shows")
        if m.get("synonyms"):
            metric["synonyms"] = [str(s) for s in m["synonyms"]][:10]
        metrics.append(metric)
    joins: list[dict] = []
    for j in doc.get("joins") or []:
        if not isinstance(j, dict):
            continue
        right, _ = _table(str(j.get("source") or ""))
        alias = str(j.get("name") or right)
        pairs = []
        if j.get("using"):
            pairs = [(c, c) for c in (j["using"] if isinstance(j["using"], list) else [j["using"]])]
        else:
            # YAML 1.1 reads a bare `on` as the boolean True (PyYAML does): the join's condition is under either key
            on = j.get("on", j.get(True))
            for eq in re.split(r"\s+AND\s+", str(on or ""), flags=re.I):
                left_side, _, right_side = eq.partition("=")
                lc, rc = left_side.strip().split(".")[-1], right_side.strip().split(".")[-1]
                if not right_side.strip().startswith(f"{alias}.") and left_side.strip().startswith(f"{alias}."):
                    lc, rc = rc, lc
                if lc and rc:
                    pairs.append((lc, rc))
        for lc, rc in pairs:
            joins.append({"left_table": source, "left_col": lc, "right_table": right, "right_col": rc,
                          "claim": str(j.get("cardinality") or "many_to_one")})
        if (j.get("rely") or {}).get("at_most_one_match") if isinstance(j.get("rely"), dict) else j.get("rely"):
            said.append(f"the join {alias}'s `rely` is not taken — the platform counts the link itself")
        if j.get("joins"):
            said.append(f"the joins nested under {alias} are not taken — propose them from their own view")
    return ({"metrics": metrics} if metrics else {}), said, joins


def propose_joins(connection_id: str, joins: list[dict], *, came_from: str, schema_name: str = "") -> int:
    """Book each join as a usage claim a person confirms — the link it would be, the YAML's cardinality as the claim
    and, where the connection answers, the platform's own count as the check. The claims booked."""
    if not joins:
        return 0
    from pramanyx.ontology.candidates import Candidate
    from pramanyx.record.writers import book_usage_claims
    candidates = []
    for j in joins:
        counted = _count(connection_id, j)
        evidence = f"the metric view claims {j['claim'].replace('_', ' ')}" + (f"; counted on the data: {counted}" if counted else "")
        candidates.append(Candidate(connection_id=connection_id, kind="join", subject=j["left_table"],
                                    proposal=f"{j['left_table']}.{j['left_col']} = {j['right_table']}.{j['right_col']}",
                                    origin="metric view YAML", source_rank="mined", evidence=evidence, bound=True))
    return int(book_usage_claims(connection_id=connection_id, candidates=candidates, source="a metric view YAML",
                                 schema_name=schema_name, came_from=came_from) or 0)


def _count(connection_id: str, j: dict) -> str:
    """The join's cardinality as the data has it — each side unique or not — or "" when the connection does not answer."""
    from types import SimpleNamespace as NS

    from pramanyx.db.connection import open_connection_for
    from pramanyx.ontology.cardinality import measure_relationship
    db = None
    try:
        db = open_connection_for(connection_id)
        claimed = {"many_to_one": "N:1", "one_to_many": "1:N", "one_to_one": "1:1", "many_to_many": "N:N"}.get(j["claim"], "")
        rel = NS(from_table=j["left_table"], from_col=j["left_col"], to_table=j["right_table"], to_col=j["right_col"],
                 id=f"{j['left_table']}->{j['right_table']}", cardinality=claimed)
        got = measure_relationship(db, rel)
        if not got.measured:
            return f"not counted ({got.note})"
        agrees = "as claimed" if got.measured == claimed else f"not {claimed} as claimed"
        return f"{got.measured}, {agrees}"
    except Exception as exc:  # noqa: BLE001 — the claim is booked without a count, and the count is said missing
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "metric view import: a join could not be counted", counter="intake.metric_view")
        return ""
    finally:
        if db is not None:
            try:
                db.close()
            except Exception as exc:  # noqa: BLE001
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "metric view import: the connection could not be released", counter="intake.metric_view")


# ── export ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def _with_filters(measure: str, filters: list[str], dialect: Optional[str] = None) -> str:
    """A measure with its own filters inside each aggregate, as a metric view writes a per-measure condition — in the
    view's SQL, read from the connection's."""
    if not filters:
        return _translate(measure, dialect, VIEW_DIALECT)
    cond = " AND ".join(f"({f})" for f in filters)
    try:
        node = sqlglot.parse_one(measure, read=dialect)
        where = sqlglot.parse_one(cond, read=dialect)
    except Exception:  # noqa: BLE001 — kept as written; whoever reads the view runs it and says what is wrong
        return measure

    def wrap(n: exp.Expression) -> exp.Expression:
        if isinstance(n, exp.AggFunc) and not isinstance(n.parent, exp.Filter):
            return exp.Filter(this=n, expression=exp.Where(this=where.copy()))
        return n
    return node.transform(wrap).sql(dialect=VIEW_DIALECT)


def _format_out(fmt: Optional[dict]) -> Optional[dict]:
    if not fmt or not fmt.get("format"):
        return None
    kind = {"number": "number", "currency": "currency", "percent": "percentage", "compact": "number"}[fmt["format"]]
    out: dict[str, Any] = {"type": kind}
    if kind == "currency" and fmt.get("currency"):
        out["currency_code"] = fmt["currency"]
    if fmt.get("decimals") is not None:
        out["decimal_places"] = {"type": "exact", "places": int(fmt["decimals"])}
    if fmt.get("compact") or fmt["format"] == "compact":
        out["abbreviation"] = "compact"
    return out


def _window_out(window: Optional[dict], time_col: str) -> Optional[list]:
    if not window or not time_col:
        return None
    kind = window.get("kind")
    if kind in ("first", "last"):
        return [{"order": time_col, "semiadditive": kind, "range": "current"}]
    if kind == "cumulative":
        return [{"order": time_col, "range": "cumulative"}]
    if kind == "trailing":
        return [{"order": time_col, "range": f"trailing {int(window.get('n') or 1)} month"}]
    if kind == "offset":
        return [{"order": time_col, "range": "current", "offset": f"-{int(window.get('n') or 1)} month"}]
    return None


def _joins_out(connection_id: str, source: str, paths: list[str], said: list[str]) -> tuple[list[dict], list[dict]]:
    """The joins a source's linked dimensions go through, read from the ontology's links — a to-one link each, named
    for its target — and the fields they give. A path no link of the served ontology reaches is said."""
    if not paths:
        return [], []
    try:
        from pramanyx.routers.ontology import served_ontology_graph
        from pramanyx.semantic.metric_engine import entity_of
        from pramanyx.semantic.object_query import object_links
        graph = served_ontology_graph(connection_id, None)
        links = {ln.name: ln for ln in object_links(graph, entity_of({"source": source}, graph))} if graph else {}
    except Exception as exc:  # noqa: BLE001 — the linked dimensions are said, not written
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "metric view export: the ontology's links could not be read", counter="intake.metric_view")
        links = {}
    joins: dict[str, dict] = {}
    fields: list[dict] = []
    for path in paths:
        name, _, column = path.partition(".")
        ln = links.get(name)
        if ln is None or not ln.to_one or "." in column:
            said.append(f"the dimension {path} reaches no to-one link this export can write — not written")
            continue
        target = getattr(getattr(ln.target, "backing", None), "table", None) or (ln.target.source_tables or [""])[0]
        alias = _slug(ln.target.id)
        joins.setdefault(alias, {"name": alias, "source": target, "on": f"source.{ln.local_col} = {alias}.{ln.remote_col}",
                                 "cardinality": "many_to_one"})
        fields.append({"name": f"{alias}_{column}", "expr": f"{alias}.{column}"})
    return list(joins.values()), fields


def export_metric_views(connection_id: str, *, dialect: Optional[str] = None) -> tuple[str, list[str]]:
    """``(yaml, said)``: one metric view document per source of the connection's structured metrics, every expression
    translated from ``dialect`` (the connection's SQL) into the view's."""
    import yaml

    from pramanyx.ontology.vocabulary import metric_words, read_vocabulary
    from pramanyx.semantic.metric_structure import composed, measure_refs, structured
    from pramanyx.semantic.metrics import list_metrics
    own = [m for m in list_metrics(connection_id=connection_id) if m.connection == connection_id]
    said = [f"{m.name} is one whole query — a metric view holds measures over a source, not statements"
            for m in own if not structured(m)]
    words = metric_words(connection_id)
    formats = dict((read_vocabulary(connection_id) or {}).get("formats") or {})
    by_name = {m.name: m for m in own}
    groups: dict[str, list] = {}
    for m in own:
        if structured(m) and not composed(m):
            groups.setdefault(str(m.source), []).append(m)
    for m in own:
        if composed(m):
            sources = {str(getattr(by_name.get(r), "source", "") or "") for r in measure_refs(str(m.measure))}
            if len(sources) == 1 and next(iter(sources)) in groups:
                groups[next(iter(sources))].append(m)
            else:
                said.append(f"{m.name} is built from metrics over more than one source — one metric view reads one")
    docs = []
    for source, ms in sorted(groups.items()):
        plain = [m for m in ms if not composed(m)]
        shared = set.intersection(*[set(m.filters or []) for m in plain]) if plain else set()
        dims = sorted({d for m in plain for d in (m.dimensions or []) if "." not in d})
        doc: dict[str, Any] = {"version": "1.1", "source": source}
        if shared:
            doc["filter"] = _translate(" AND ".join(f"({f})" for f in sorted(shared)), dialect, VIEW_DIALECT)
        joins, linked = _joins_out(connection_id, source, sorted({d for m in plain for d in (m.dimensions or []) if "." in d}), said)
        if joins:
            doc["joins"] = joins
        if dims or linked:
            doc["fields"] = [{"name": d, "expr": d} for d in dims] + linked
        measures = []
        for m in ms:
            time_col = str(m.time_column or "").split(".")[-1]
            entry: dict[str, Any] = {"name": m.name, "expr": _translate(str(m.measure), dialect, VIEW_DIALECT) if composed(m)
                                     else _with_filters(str(m.measure), [f for f in (m.filters or []) if f not in shared], dialect)}
            if m.label and m.label != m.name:
                entry["display_name"] = m.label
            if m.caveats:
                entry["comment"] = m.caveats
            fmt = _format_out(formats.get(f"metric:{m.name}"))
            if fmt:
                entry["format"] = fmt
            if words.get(m.name):
                entry["synonyms"] = words[m.name][:10]
            win = _window_out(m.window, time_col)
            if win:
                entry["window"] = win
            measures.append(entry)
        doc["measures"] = measures
        docs.append(doc)
    text = "\n---\n".join(yaml.safe_dump(d, sort_keys=False, allow_unicode=True) for d in docs)
    if docs and dialect and dialect != VIEW_DIALECT:
        said.append(f"its expressions are written in the view's SQL, translated from this connection's ({dialect}); "
                    "importing the file here translates them back")
    return text, said
