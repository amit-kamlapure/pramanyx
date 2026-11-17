"""What a BI tool already says a business word means, read into the intake lane (Phase 3, 2026-11-17).

Three formats an organisation already keeps its definitions in:

- **dbt's semantic layer** — the ``semantic_models`` and ``metrics`` of a ``manifest.json`` (MetricFlow);
- **LookML** — a ``.lkml`` file's views (dimensions, measures) and explores (joins);
- **Power BI** — a tabular model as ``model.bim`` JSON, or a ``.tmdl`` file of a PBIP project.

Each mapper is deterministic and judges nothing (the lane's rule, `mappers.py`): the same bytes give the same
sections, no model is called, nothing is written. Every object still waits for a person's verdict in the lane, and an
accepted metric lands proposed, never approved.

What a mapper translates, it translates mechanically, or not at all. A dbt simple metric, a LookML sum or count over a
column, become a metric with SQL. A formula the mapper cannot carry over exactly — dbt's derived and cumulative
metrics and its Jinja filters, LookML's Liquid and cross-view references, every DAX expression — comes in as a
Definition of the word, with the tool's own formula quoted in it, and the file's import says which and why. A metric
whose SQL was guessed would be a figure nobody wrote.
"""
from __future__ import annotations

import re
from typing import Any

#: A metric's aggregate, by the name each tool gives it. Anything else is not translated.
_AGG = {
    "sum": "SUM({})", "count": "COUNT({})", "count_distinct": "COUNT(DISTINCT {})", "average": "AVG({})",
    "avg": "AVG({})", "min": "MIN({})", "max": "MAX({})", "sum_boolean": "SUM(CASE WHEN {} THEN 1 ELSE 0 END)",
}
#: Aggregates whose period figures may be summed.
_ADDITIVE = {"sum", "count", "sum_boolean"}


def _slug(name: str) -> str:
    from pramanyx.semantic.metric_catalogue import normalize_name
    return normalize_name(name)


def _words(name: str) -> str:
    """``total_revenue`` → ``Total revenue``: a title for a word a tool named in code."""
    text = re.sub(r"[_\s]+", " ", str(name or "")).strip()
    return text[:1].upper() + text[1:]


def _definition(title: str, body: str, *, aliases: list[str] | None = None) -> dict:
    out: dict[str, Any] = {"title": title.strip()[:200], "body": body.strip()}
    names = [a for a in (aliases or []) if a and a.strip().lower() != title.strip().lower()]
    if names:
        out["aliases"] = sorted(set(names))
    return out


def _sections(metrics: list[dict], definitions: list[dict], joins: list[dict] | None = None,
              glossary: list[dict] | None = None) -> dict:
    out: dict[str, Any] = {}
    if metrics:
        out["metrics"] = metrics
    if definitions:
        out["definitions"] = definitions
    if joins:
        out["joins"] = joins
    if glossary:
        out["glossary"] = glossary
    return out


# ── dbt's semantic layer ─────────────────────────────────────────────────────────────────────────────────────────


def _dbt_table(model: dict) -> tuple[str, str]:
    """A semantic model's table as the platform names tables (``schema.table``), and its schema."""
    rel = model.get("node_relation") or {}
    leaf = str(rel.get("alias") or "").strip().lower()
    schema = str(rel.get("schema_name") or "").strip().lower()
    return (f"{schema}.{leaf}" if schema and leaf else leaf), schema


def _dbt_measure_sql(measure: dict) -> str:
    agg = str(measure.get("agg") or "").lower()
    if agg not in _AGG:
        return ""
    expr = str(measure.get("expr") or "").strip() or str(measure.get("name") or "").strip()
    if agg == "count" and expr in ("1", "*"):
        return "COUNT(*)"
    return _AGG[agg].format(expr)


def map_dbt_semantic(manifest: dict) -> tuple[dict, list[str]]:
    """A dbt manifest's semantic layer → ``(sections, not_translated)``.

    A **simple** metric over one measure with no filter becomes a metric: ``SELECT <agg>(<expr>) FROM <table>``, with
    the model's time dimension as its date. A **ratio** of two such metrics on one model becomes a metric dividing
    one by the other. Every metric with a description, and every metric the mapper does not translate, becomes a
    Definition of its word, quoting how dbt computes it."""
    models = {m.get("name"): m for m in (manifest.get("semantic_models") or {}).values() if isinstance(m, dict)}
    measures: dict[str, tuple[dict, dict]] = {}
    for model in models.values():
        for measure in model.get("measures") or []:
            if isinstance(measure, dict) and measure.get("name"):
                measures[str(measure["name"])] = (measure, model)

    def simple(metric: dict) -> tuple[str, dict, dict] | None:
        """``(sql_of_the_aggregate, measure, model)`` for a filterless simple metric, else None."""
        params = metric.get("type_params") or {}
        ref = params.get("measure") or {}
        if str(metric.get("type") or "").lower() != "simple" or metric.get("filter") or ref.get("filter"):
            return None
        got = measures.get(str(ref.get("name") or ""))
        if not got or got[0].get("non_additive_dimension"):
            return None
        sql = _dbt_measure_sql(got[0])
        return (sql, got[0], got[1]) if sql else None

    by_name = {str(m.get("name")): m for m in (manifest.get("metrics") or {}).values()
               if isinstance(m, dict) and m.get("name")}
    metrics: list[dict] = []
    definitions: list[dict] = []
    not_translated: list[str] = []
    for name, metric in sorted(by_name.items()):
        label = str(metric.get("label") or "").strip() or _words(name)
        description = str(metric.get("description") or "").strip()
        kind = str(metric.get("type") or "").lower()
        params = metric.get("type_params") or {}
        out: dict | None = None
        got = simple(metric)
        if got:
            sql, measure, model = got
            table, schema = _dbt_table(model)
            if table:
                out = {"name": _slug(name), "label": label, "sql": f"SELECT {sql} AS {_slug(name)} FROM {table}",
                       "schema_name": schema, "tables": [table],
                       "additivity": "additive" if str(measure.get("agg")).lower() in _ADDITIVE else "non_additive"}
                time_dim = measure.get("agg_time_dimension") or (model.get("defaults") or {}).get("agg_time_dimension")
                dim = next((d for d in model.get("dimensions") or []
                            if d.get("name") == time_dim and str(d.get("type")).lower() == "time"), None)
                column = str((dim or {}).get("expr") or (dim or {}).get("name") or "").strip()
                if dim and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", column):
                    out.update(time_column=f"{table}.{column.lower()}", time_kind="flow")
        elif kind == "ratio":
            num = by_name.get(str((params.get("numerator") or {}).get("name") or ""))
            den = by_name.get(str((params.get("denominator") or {}).get("name") or ""))
            a, b = (simple(num) if num else None), (simple(den) if den else None)
            if a and b and a[2] is b[2] and not (params.get("numerator") or {}).get("filter") \
                    and not (params.get("denominator") or {}).get("filter"):
                table, schema = _dbt_table(a[2])
                if table:
                    out = {"name": _slug(name), "label": label,
                           "sql": f"SELECT {a[0]} / NULLIF({b[0]}, 0) AS {_slug(name)} FROM {table}",
                           "schema_name": schema, "tables": [table], "additivity": "non_additive"}
        if out:
            if description:
                out["caveats"] = description
            metrics.append(out)
            if description:
                definitions.append(_definition(label, description, aliases=[name]))
            continue
        how = _dbt_how(metric)
        not_translated.append(f"dbt metric {name!r} ({kind or 'unknown type'}): {how} — its definition is offered, "
                              "not a metric")
        definitions.append(_definition(label, (description + "\n\n" if description else "")
                                       + f"In dbt: {how}.", aliases=[name]))
    return _sections(metrics, definitions), not_translated


def _dbt_how(metric: dict) -> str:
    """How dbt computes a metric, in a line: its type, what it reads, its filter."""
    kind = str(metric.get("type") or "").lower()
    params = metric.get("type_params") or {}
    if kind == "simple":
        what = f"a simple metric over the measure {((params.get('measure') or {}).get('name'))!r}"
    elif kind == "ratio":
        what = (f"the ratio of {((params.get('numerator') or {}).get('name'))!r} to "
                f"{((params.get('denominator') or {}).get('name'))!r}")
    elif kind == "derived":
        what = f"derived as {params.get('expr')!r} from {[m.get('name') for m in params.get('metrics') or []]}"
    elif kind == "cumulative":
        what = f"a cumulative total of {((params.get('measure') or {}).get('name'))!r}"
        window = params.get("window") or (params.get("cumulative_type_params") or {}).get("window")
        if window:
            what += f" over {window}"
    else:
        what = f"a {kind or 'metric'} metric"
    filters = [f.get("where_sql_template") for f in ((metric.get("filter") or {}).get("where_filters") or [])
               if isinstance(f, dict)]
    if filters:
        what += f", filtered where {' and '.join(str(f) for f in filters)}"
    return what


# ── LookML ───────────────────────────────────────────────────────────────────────────────────────────────────────


class LookMLError(ValueError):
    pass


#: Keys whose value runs to ``;;`` — LookML's SQL-ish fields.
_SQLISH = re.compile(r"^(sql\w*|html|expression\w*|.*_sql)$")


def parse_lookml(text: str) -> list[tuple[str, str | None, Any]]:
    """LookML → a list of ``(key, name, value)``: a value is a string, a list of strings, or a nested list of the same
    shape. Repeated keys stay repeated (a view has many ``dimension:``)."""
    pos = 0
    n = len(text)

    def skip() -> None:
        nonlocal pos
        while pos < n:
            if text[pos].isspace():
                pos += 1
            elif text[pos] == "#":
                while pos < n and text[pos] != "\n":
                    pos += 1
            else:
                return

    def word() -> str:
        nonlocal pos
        m = re.compile(r"[A-Za-z0-9_.\-+*/:]+").match(text, pos)
        if not m:
            raise LookMLError(f"expected a word at character {pos}")
        pos = m.end()
        return m.group(0)

    def quoted() -> str:
        nonlocal pos
        out = []
        pos += 1
        while pos < n and text[pos] != '"':
            if text[pos] == "\\" and pos + 1 < n:
                pos += 1
            out.append(text[pos])
            pos += 1
        if pos >= n:
            raise LookMLError("a quoted value is not closed")
        pos += 1
        return "".join(out)

    def listed() -> list[str]:
        nonlocal pos
        pos += 1
        items, cur, quote = [], [], False
        while pos < n:
            ch = text[pos]
            if ch == '"':
                quote = not quote
            elif ch == "]" and not quote:
                pos += 1
                tail = "".join(cur).strip()
                if tail:
                    items.append(tail)
                return items
            elif ch == "," and not quote:
                items.append("".join(cur).strip())
                cur = []
                pos += 1
                continue
            cur.append(ch)
            pos += 1
        raise LookMLError("a list is not closed")

    def block() -> list[tuple[str, str | None, Any]]:
        nonlocal pos
        out: list[tuple[str, str | None, Any]] = []
        while True:
            skip()
            if pos >= n or text[pos] == "}":
                return out
            m = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*:").match(text, pos)
            if not m:
                raise LookMLError(f"expected 'key:' at character {pos}: {text[pos:pos + 30]!r}")
            key = m.group(1)
            pos = m.end()
            skip()
            if _SQLISH.match(key):
                end = text.find(";;", pos)
                if end < 0:
                    raise LookMLError(f"{key}: is not closed with ;;")
                out.append((key, None, text[pos:end].strip()))
                pos = end + 2
                continue
            if pos < n and text[pos] == "{":
                pos += 1
                body = block()
                skip()
                pos += 1  # the closing brace
                out.append((key, None, body))
                continue
            if pos < n and text[pos] == '"':
                out.append((key, None, quoted()))
                continue
            if pos < n and text[pos] == "[":
                out.append((key, None, listed()))
                continue
            value = word()
            skip()
            if pos < n and text[pos] == "{":
                pos += 1
                body = block()
                skip()
                if pos >= n or text[pos] != "}":
                    raise LookMLError(f"{key}: {value} is not closed with }}")
                pos += 1
                out.append((key, value, body))
            else:
                out.append((key, None, value))

    parsed = block()
    skip()
    if pos < n:
        raise LookMLError(f"unexpected {text[pos]!r} at character {pos}")
    return parsed


def _first(body: list, key: str, default: Any = None) -> Any:
    return next((v for k, _, v in body if k == key), default)


def _named(body: list, *keys: str) -> list[tuple[str, str, list]]:
    return [(k, name, v) for k, name, v in body if k in keys and name and isinstance(v, list)]


_REF = re.compile(r"\$\{([A-Za-z0-9_.]+)\}")
_LIQUID = re.compile(r"\{%|\{\{")


def map_lookml(text: str) -> tuple[dict, list[str]]:
    """A ``.lkml`` file → ``(sections, not_translated)``.

    A measure of type sum, count, count_distinct, average, min or max over this view's own fields becomes a metric:
    ``SELECT <agg>(<sql>) FROM <sql_table_name> AS <view>``. A plain equality filter on a string field, or a yes/no
    filter, becomes its WHERE. A ``number`` measure over this view's translated measures is divided out the same way.
    Descriptions become Definitions; an explore's ``sql_on`` becomes a join a person can read; a field's description
    on a plain column becomes a glossary note. Liquid, another view's fields and derived tables are not translated."""
    try:
        parsed = parse_lookml(text)
    except LookMLError as exc:
        raise ValueError(f"the LookML could not be read: {exc}") from exc
    metrics: list[dict] = []
    definitions: list[dict] = []
    joins: list[dict] = []
    glossary: list[dict] = []
    not_translated: list[str] = []

    for _, view, body in _named(parsed, "view"):
        table = str(_first(body, "sql_table_name", "") or "").strip().strip("`").strip()
        derived = _first(body, "derived_table") is not None
        fields = {name: (k, b) for k, name, b in _named(body, "dimension", "dimension_group", "measure")}
        columns: dict[str, dict] = {}

        def sql_of(name: str, depth: int = 0) -> str:
            """A field of this view as SQL, its references resolved; "" when it reaches past this view."""
            got = fields.get(name)
            if not got or depth > 4:
                return ""
            kind, b = got
            raw = str(_first(b, "sql", "") or "").strip()
            if not raw:
                raw = "${TABLE}." + name if kind != "measure" else ""
            if not raw or _LIQUID.search(raw):
                return ""
            missing = False

            def sub(m: re.Match) -> str:
                nonlocal missing
                ref = m.group(1)
                if ref == "TABLE":
                    return view
                inner = ref.split(".", 1)[1] if ref.startswith(view + ".") else ref
                if "." in inner:
                    missing = True
                    return ""
                resolved = sql_of(inner, depth + 1)
                if not resolved:
                    missing = True
                return f"({resolved})" if resolved and fields[inner][0] != "measure" else resolved
            out = _REF.sub(sub, raw)
            return "" if missing else out

        def aggregate(name: str, depth: int = 0) -> tuple[str, str]:
            """A measure of this view as an aggregate SQL expression and its WHERE; ``("", why)`` when not translated."""
            kind, b = fields[name]
            mtype = str(_first(b, "type", "count" if kind == "measure" else "") or "").lower()
            if mtype == "number":
                raw = str(_first(b, "sql", "") or "")
                if _LIQUID.search(raw) or depth > 3:
                    return "", "a number measure with Liquid"

                bad: list[str] = []

                def sub(m: re.Match) -> str:
                    ref = m.group(1).split(".", 1)[1] if m.group(1).startswith(view + ".") else m.group(1)
                    if ref not in fields or fields[ref][0] != "measure":
                        bad.append(m.group(1))
                        return ""
                    agg, where = aggregate(ref, depth + 1)
                    if not agg or where:
                        bad.append(m.group(1))
                        return ""
                    return agg
                expr = _REF.sub(sub, raw).strip()
                return (expr, "") if expr and not bad else ("", f"a number measure over {', '.join(bad) or raw!r}")
            if mtype not in _AGG:
                return "", f"a {mtype or 'typeless'} measure"
            inner = sql_of(name) if _first(b, "sql") else ""
            if _first(b, "sql") and not inner:
                return "", "its SQL reaches another view or uses Liquid"
            if not inner and mtype != "count":
                return "", f"a {mtype} measure with no sql"
            agg = "COUNT(*)" if mtype == "count" and not inner else _AGG[mtype].format(inner)
            where: list[str] = []
            for f in _first(b, "filters", []) or []:
                m = re.fullmatch(r'\s*([A-Za-z0-9_.]+)\s*:\s*"([^"]*)"\s*', str(f))
                if not m:
                    return "", f"a filter it does not translate ({f})"
                field, value = m.group(1).split(".")[-1], m.group(2)
                if field not in fields:
                    return "", f"a filter on another view's field ({f})"
                fsql = sql_of(field)
                ftype = str(_first(fields[field][1], "type", "string") or "string").lower()
                if not fsql:
                    return "", f"a filter on a field it cannot read ({f})"
                if ftype == "yesno" and value.lower() in ("yes", "no"):
                    where.append(f"({fsql})" if value.lower() == "yes" else f"NOT ({fsql})")
                elif ftype in ("string", "") and re.fullmatch(r"[A-Za-z0-9 _.\-]+", value):
                    where.append(f"{fsql} = '{value}'")
                else:
                    return "", f"a filter it does not translate ({f})"
            return agg, " AND ".join(where)

        time_groups = [n for n, (k, b) in fields.items() if k == "dimension_group"
                       and str(_first(b, "type", "") or "").lower() == "time"]
        time_column = ""
        if table and len(time_groups) == 1:
            raw = str(_first(fields[time_groups[0]][1], "sql", "") or "").strip()
            m = re.fullmatch(r"\$\{TABLE\}\.([A-Za-z_][A-Za-z0-9_]*)", raw)
            if m:
                time_column = f"{table.lower()}.{m.group(1).lower()}"

        for name, (kind, b) in fields.items():
            label = str(_first(b, "label", "") or "").strip() or _words(name)
            description = str(_first(b, "description", "") or "").strip()
            if kind != "measure":
                raw = str(_first(b, "sql", "") or "").strip()
                m = re.fullmatch(r"\$\{TABLE\}\.([A-Za-z_][A-Za-z0-9_]*)", raw)
                if description and m and table:
                    columns[m.group(1).lower()] = {"description": description}
                continue
            mtype = str(_first(b, "type", "count") or "").lower()
            why = ""
            if not table:
                why = "its view is a derived table" if derived else "its view names no table"
            agg, where = ("", "")
            if not why:
                agg, why = aggregate(name)
                if agg:
                    where, why = why, ""
            if agg:
                slug = _slug(f"{view}_{name}")
                metric: dict[str, Any] = {
                    "name": slug, "label": label,
                    "sql": f"SELECT {agg} AS {slug} FROM {table} AS {view}" + (f" WHERE {where}" if where else ""),
                    "tables": [table.lower()],
                    "additivity": "additive" if mtype in _ADDITIVE else "non_additive",
                }
                if "." in table:
                    metric["schema_name"] = table.lower().rsplit(".", 1)[0].split(".")[-1]
                if time_column:
                    metric.update(time_column=time_column, time_kind="flow")
                fmt = str(_first(b, "value_format_name", "") or "").lower()
                if fmt.startswith(("usd", "gbp", "eur")):
                    metric["unit"] = fmt[:3].upper()
                elif fmt.startswith("percent"):
                    metric["unit"] = "%"
                if description:
                    metric["caveats"] = description
                metrics.append(metric)
                if description:
                    definitions.append(_definition(label, description, aliases=[name]))
                continue
            not_translated.append(f"LookML measure {view}.{name}: {why} — its definition is offered, not a metric")
            raw = str(_first(b, "sql", "") or "").strip()
            definitions.append(_definition(label, (description + "\n\n" if description else "")
                                           + f"In LookML ({view}): a {mtype} measure" + (f" of {raw}" if raw else "")
                                           + "."))
        if columns:
            glossary.append({"table": table.lower(), "columns": columns})

    for _, explore, body in _named(parsed, "explore"):
        for _, joined, jb in _named(body, "join"):
            on = str(_first(jb, "sql_on", "") or "").strip()
            if not on:
                continue
            readable = _REF.sub(lambda m: m.group(1), on)
            relationship = str(_first(jb, "relationship", "") or "").replace("_", " ")
            how = str(_first(jb, "type", "") or "").replace("_", " ")
            frm = str(_first(jb, "from", "") or "")
            joins.append({"title": f"{explore} joins {joined}",
                          "body": f"In LookML's {explore} explore, {joined}" + (f" (the view {frm})" if frm else "")
                                  + f" joins on {readable}"
                                  + (f", {relationship}" if relationship else "") + (f", a {how} join" if how else "")
                                  + "."})
    return _sections(metrics, definitions, joins, glossary), not_translated


# ── Power BI ─────────────────────────────────────────────────────────────────────────────────────────────────────

_DAX_NOTE = ("Power BI's measures are DAX, which is not translated into SQL: each comes in as a Definition of its "
             "word, with its DAX quoted, not as a metric")


def _text(value: Any) -> str:
    """A model's string, which a .bim may write as a list of lines."""
    if isinstance(value, list):
        return "\n".join(str(v) for v in value)
    return str(value or "")


def looks_like_powerbi_model(doc: Any) -> bool:
    return isinstance(doc, dict) and isinstance(doc.get("model"), dict) and "tables" in doc["model"]


def _measure_definition(table: str, name: str, dax: str, description: str) -> dict:
    body = (description.strip() + "\n\n" if description.strip() else "")
    body += f"In Power BI ({table}), DAX: {' '.join(dax.split())}"
    return _definition(name, body)


def _relationship_join(frm: str, to: str, how: str = "") -> dict:
    left, right = frm.split(".", 1)[0], to.split(".", 1)[0]
    return {"title": f"{left} joins {right}",
            "body": f"In the Power BI model, {frm} = {to}" + (f", {how}" if how else "") + "."}


def map_powerbi_model(doc: dict) -> tuple[dict, list[str]]:
    """A ``model.bim`` → ``(sections, not_translated)``: each measure a Definition quoting its DAX, each relationship a
    join a person can read. Table and column names are the model's, which need not be the warehouse's, so no glossary
    is written from them."""
    model = doc.get("model") or {}
    definitions: list[dict] = []
    joins: list[dict] = []
    count = 0
    for table in model.get("tables") or []:
        tname = str(table.get("name") or "")
        for measure in table.get("measures") or []:
            name = str(measure.get("name") or "").strip()
            dax = _text(measure.get("expression")).strip()
            if name and dax:
                count += 1
                definitions.append(_measure_definition(tname, name, dax, _text(measure.get("description"))))
    for rel in model.get("relationships") or []:
        frm = f"{rel.get('fromTable')}.{rel.get('fromColumn')}"
        to = f"{rel.get('toTable')}.{rel.get('toColumn')}"
        if rel.get("fromTable") and rel.get("toTable"):
            joins.append(_relationship_join(frm, to, "inactive" if rel.get("isActive") is False else ""))
    return _sections([], definitions, joins), ([f"{_DAX_NOTE} ({count})."] if count else [])


def _tmdl_name(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("'"):
        end = raw.find("'", 1)
        while end > 0 and raw[end + 1:end + 2] == "'":
            end = raw.find("'", end + 2)
        return raw[1:end].replace("''", "'") if end > 0 else raw.strip("'")
    return raw.split()[0] if raw else ""


def _tmdl_column(raw: str) -> str:
    """``'Sales Orders'.CustomerKey`` → ``Sales Orders.CustomerKey``."""
    raw = raw.strip()
    if raw.startswith("'"):
        table = _tmdl_name(raw)
        rest = raw[len(table.replace("'", "''")) + 2:]
        return f"{table}{rest}"
    return raw


def map_tmdl(text: str) -> tuple[dict, list[str]]:
    """A ``.tmdl`` file (a table's, or the relationships') → ``(sections, not_translated)``, as ``map_powerbi_model``.
    A measure's ``///`` lines are its description; an expression may run on to the lines indented under it."""
    lines = text.replace("\r\n", "\n").split("\n")
    indent = lambda s: len(s) - len(s.lstrip("\t ")) if s.strip() else 10 ** 6  # noqa: E731
    definitions: list[dict] = []
    joins: list[dict] = []
    table = ""
    notes: list[str] = []
    count = 0
    i = 0
    while i < len(lines):
        line = lines[i]
        bare = line.strip()
        if bare.startswith("///"):
            notes.append(bare[3:].strip())
            i += 1
            continue
        m = re.match(r"table\s+(.+)$", bare)
        if m and indent(line) == 0:
            table, notes = _tmdl_name(m.group(1)), []
            i += 1
            continue
        m = re.match(r"measure\s+('(?:[^']|'')*'|[^\s=]+)\s*=\s*(.*)$", bare)
        if m:
            name, first, level = _tmdl_name(m.group(1)), m.group(2).strip(), indent(line)
            body: list[str] = [first] if first else []
            i += 1
            fenced = first.startswith("```")
            while i < len(lines):
                nxt = lines[i]
                if fenced:
                    body.append(nxt.strip())
                    i += 1
                    if nxt.strip().endswith("```"):
                        break
                    continue
                if nxt.strip() and indent(nxt) <= level:
                    break
                # A property of the measure (`formatString: …`) sits one level in; the expression, deeper.
                if nxt.strip() and re.match(r"[A-Za-z]+\s*:", nxt.strip()) and (first or body):
                    break
                if nxt.strip():
                    body.append(nxt.strip())
                i += 1
            dax = "\n".join(b for b in body if b).strip().strip("`").strip()
            if name and dax:
                count += 1
                definitions.append(_measure_definition(table or "the model", name, dax, " ".join(notes)))
            notes = []
            continue
        m = re.match(r"relationship\s+(.+)$", bare)
        if m:
            frm = to = ""
            active = True
            i += 1
            while i < len(lines) and (not lines[i].strip() or indent(lines[i]) > indent(line)):
                prop = lines[i].strip()
                if prop.startswith("fromColumn:"):
                    frm = _tmdl_column(prop.split(":", 1)[1])
                elif prop.startswith("toColumn:"):
                    to = _tmdl_column(prop.split(":", 1)[1])
                elif prop.replace(" ", "") == "isActive:false":
                    active = False
                i += 1
            if frm and to:
                joins.append(_relationship_join(frm, to, "" if active else "inactive"))
            continue
        if bare and not bare.startswith("///"):
            notes = []
        i += 1
    return _sections([], definitions, joins), ([f"{_DAX_NOTE} ({count})."] if count else [])
