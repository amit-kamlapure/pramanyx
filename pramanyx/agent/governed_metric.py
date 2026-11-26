"""A governed metric as the answer's starting point — the metric engine where answers are actually made.

The metric-views plan's M5 offered `query_metric` to the conversation, and the bar measured it on theLook: the tool was
offered on all nine questions and called on none (2026-11-26) — the conversation hands every analytical question to
`answer_question`, whose core writes its SQL in one shot and never sees a tool. So the engine meets the answer there:
when a question names a governed metric written as parts, the core is handed that metric compiled by the engine for
this question — grouped by the dimensions it names, over the period it names (the one reading of a period,
`kernel/clock.period_named`), by a grain it asks — as its starting point, as the semantic compiler's reference query
is. The model may add what the question asks that the statement lacks; it is told not to re-derive the formula.

Offered only where the bar is met (`evals/metric_bar.offered`), and the bar's arm with it is the answers given this
reference: whether an answer adopted it is said on the stream (``governed_metric``), so the bar counts the answers that
used it. Deterministic; no model.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

#: Words that ask for a figure broken down by something.
_GROUPING = re.compile(r"\b(by|per|each|every|across|for\s+all|breakdown|broken\s+down|split)\b", re.I)
_GRAIN = {"day": r"daily|per\s+day|by\s+day|each\s+day", "week": r"weekly|per\s+week|by\s+week|each\s+week",
          "month": r"monthly|per\s+month|by\s+month|each\s+month|month\s+by\s+month|over\s+time|trend",
          "quarter": r"quarterly|per\s+quarter|by\s+quarter", "year": r"yearly|annual|per\s+year|by\s+year"}
#: The most dimensions a question is read as grouping by.
MOST_BY = 2


@dataclass
class Reference:
    metric: str
    label: str
    sql: str
    by: list[str] = field(default_factory=list)
    grain: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    caveats: list[str] = field(default_factory=list)
    #: the metric's own measure and filters — what an answer must keep to have started from it
    measure: str = ""
    filters: list[str] = field(default_factory=list)
    #: what it measures, in its owners' words, its unit and the date it is counted by — so a name that reads like
    #: another thing ("placed to shipped" read as days, not a share) cannot turn it into one
    means: str = ""
    unit: str = ""
    dated_by: str = ""
    #: the question asks for this metric and nothing else — no breakdown, no grain, no condition of its own — so the
    #: platform runs the definition itself and the model only says what it found (2026-11-26)
    plain: bool = False

    def prompt(self) -> str:
        cut = ", ".join(x for x in (f"by {', '.join(self.by)}" if self.by else "", f"by {self.grain}" if self.grain else "",
                                     f"from {self.start} up to {self.end}" if self.start else "") if x)
        about = " ".join(x for x in (f"It measures: {self.means}." if self.means else "",
                                     f"Its unit: {self.unit}." if self.unit else "",
                                     f"A period is counted by {self.dated_by}." if self.dated_by else "") if x)
        return ("GOVERNED METRIC QUERY — the question asks for “" + self.label + "”, an approved metric. "
                + (about + " " if about else "") + "This statement is its definition compiled by the platform"
                + (f" ({cut})" if cut else "") + ": its measure, its filters, joins only through the ontology's links. "
                "The figure the question asks for is THIS query's — whatever its name suggests. Run it as written; "
                "change it only to add what the question asks that it lacks (a further filter, an order, a limit, "
                "renamed columns). Never re-derive the metric's formula, keep its filters, and keep the date its "
                "period is counted by. This takes precedence over any other reference query below:\n"
                + self.sql + "\n\n")

    def adopted_by(self, final_sql: str) -> bool:
        """Whether the answer started from it: its statement run as written or wrapped, or — rewritten, as a model may
        lift the engine's joins out of the wrapper (theLook, 2026-11-26) — the metric's measure and every one of its
        filters kept. An answer that changed the formula or dropped a filter did not."""
        def norm(s: str) -> str:
            return re.sub(r"\s+", "", re.sub(r"/\*.*?\*/", "", s or "", flags=re.S)).lower().rstrip(";")
        if not self.sql:
            return False
        said = norm(final_sql)
        if norm(self.sql) in said:
            return True
        if not self.measure:
            return False
        from pramanyx.semantic.enforcement import bare_signature
        keep = [bare_signature(norm(self.measure))] + [bare_signature(norm(f)) for f in self.filters]
        return all(k and k in said for k in keep)

    def frame(self, final_sql: str) -> dict:
        return {"metric": self.metric, "label": self.label, "by": self.by, "grain": self.grain, "start": self.start,
                "end": self.end, "adopted": self.adopted_by(final_sql)}


def _words(text: str) -> set[str]:
    out = set()
    for w in re.findall(r"[a-z0-9]+", (text or "").lower()):
        out.add(w)
        if len(w) > 3 and w.endswith("s"):
            out.add(w[:-1])
    return out


def dimensions_asked(question: str, dims: list[dict]) -> list[str]:
    """The dimension paths ``question`` groups by — only when it asks for a breakdown — each a dimension whose name's
    words all appear in it; the metric's own source's before a linked one's, the longest name first."""
    if not _GROUPING.search(question or ""):
        return []
    said = _words(question)
    hits: list[tuple[int, int, str]] = []
    taken: set[str] = set()
    for d in dims:
        last = str(d["path"]).split(".")[-1]
        words = [w for w in re.split(r"[_\W]+", last.lower()) if w]
        if not words or not all(w in said for w in words):          # an id is grouped by only when its "id" is said
            continue
        hits.append((0 if not d.get("via") else 1, -len(words), d["path"]))
    out = []
    for _, _, path in sorted(hits):
        reach = path.split(".")[-1]
        if reach not in taken:
            taken.add(reach)
            out.append(path)
    return out[:MOST_BY]


def grain_asked(question: str) -> Optional[str]:
    for grain, pattern in _GRAIN.items():
        if re.search(rf"\b(?:{pattern})\b", question or "", re.I):
            return grain
    return None


def reference(question: str, connection_id: str, *, schema_scope: Optional[str] = None, dialect: str = "duckdb",
              clock: str = "") -> Optional[Reference]:
    """The governed metric ``question`` names, compiled for it — or None: not offered on this connection, no governed
    metric named, one not written as parts, or one the engine does not compile as asked."""
    from pramanyx.evals.metric_bar import offered
    if not offered(connection_id):
        return None
    from pramanyx.kernel.clock import period_named, person_clock
    from pramanyx.routers.ontology import served_ontology_graph
    from pramanyx.semantic import metric_engine as E
    from pramanyx.semantic.metric_structure import structured
    from pramanyx.semantic.metrics import get_metric, metrics_named_in
    named = [m for m in metrics_named_in(question, connection_id) if getattr(m, "status", "") == "approved"]
    if not named:
        return None
    m = named[0]
    # the metric's own name is not the question's breakdown or grain: "Daily Active Users" is not asked by day
    question = _without_name(question, m)
    plain = plain_ask(question)
    if not structured(m):
        ref = _statement_reference(m, question, dialect=dialect, clock=clock or person_clock())
        if ref is not None:
            ref.plain = plain
        return ref
    graph = served_ontology_graph(connection_id, schema_scope)
    if graph is None:
        return None
    resolve = lambda ref: get_metric(ref, connection_id=connection_id)  # noqa: E731
    by = dimensions_asked(question, E.dimensions(m, graph, resolve))
    grain = grain_asked(question)
    span = period_named(question, clock or person_clock())
    start, end = (span[0].isoformat(), span[1].isoformat()) if span else (None, None)
    try:
        compiled = E.compile_metric(m, graph, dialect=dialect, resolve=resolve, by=by, grain=grain, start=start, end=end,
                                    limit=1000)
    except E.NotCompiled:
        return None
    return Reference(metric=m.name, label=m.label or m.name, sql=_named(compiled, m.name, dialect), by=by, grain=grain,
                     start=start, end=end, caveats=list(compiled.caveats), measure=str(m.measure or ""),
                     filters=[str(f) for f in (m.filters or [])],
                     means=" ".join(str(m.caveats or "").split("\n\n")[0].split())[:300], unit=str(m.unit or ""),
                     dated_by=str(m.time_column or "") if start else "", plain=plain and not by and not grain)


def _without_name(question: str, m) -> str:
    """``question`` with the metric's label and name taken out — what is left says how it is cut."""
    out = question or ""
    label = str(m.label or "")
    names = {label, re.sub(r"\s*\([^)]*\)", "", label), str(m.name or ""), str(m.name or "").replace("_", " ")}
    for n in sorted(names, key=len, reverse=True):
        if n.strip():
            out = re.sub(re.escape(n), " ", out, flags=re.I)
    return out


#: Words that ask for a figure without changing it: the question's grammar, a period, a politeness.
_PLAIN = set("""what was is were are the a an our my me show tell give please how much many value figure number
current overall so far to date ytd mtd qtd over in during for of last past previous prior this that these recent
recently today yesterday day days week weeks month months quarter quarters year years period periods it its""".split())


def plain_ask(rest: str) -> bool:
    """Whether what is left of a question once the metric's name is taken out asks only for its figure — the
    question's grammar, a period, numbers — and nothing that cuts or conditions it."""
    words = re.findall(r"[a-z]+", (rest or "").lower())
    return all(w in _PLAIN for w in words)


def _statement_reference(m, question: str, *, dialect: str, clock: str) -> Optional[Reference]:
    """A governed metric kept as a statement (its joins not split into parts): its own statement as the starting point —
    over the period the question names, cut by the same window the Briefing measures it in (`metric_time.measure_sql`),
    or whole when no period is named. Never for a breakdown or a grain: a statement is one figure (2026-11-26:
    LuxExperience's email rates were answered from other tables while their statements sat unused)."""
    from pramanyx.kernel.clock import period_named
    from pramanyx.semantic import metric_time as mt
    if _GROUPING.search(question or "") or grain_asked(question):
        return None
    span = period_named(question, clock)
    statement = str(m.sql or "").strip().rstrip(";")
    if not statement:
        return None
    start = end = None
    if span:
        if not mt.declared(m):
            return None
        cut, _why = mt.measure_sql(m, [mt.Window("current", span[0], span[1])], dialect=dialect)
        if not cut:
            return None
        statement = f"SELECT _v AS {m.name} FROM ({cut}) AS governed"
        start, end = span[0].isoformat(), span[1].isoformat()
    return Reference(metric=m.name, label=m.label or m.name, sql=statement, start=start, end=end,
                     means=" ".join(str(m.caveats or "").split("\n\n")[0].split())[:300], unit=str(m.unit or ""),
                     dated_by=str(m.time_column or "") if start else "")


def _named(compiled, name: str, dialect: str) -> str:
    """The engine's statement with its figure's column named for the metric, so the answer's table reads as the metric."""
    import sqlglot
    from sqlglot import exp
    cols = [exp.alias_(exp.column(c), name) if c == compiled.value else exp.column(c) for c in compiled.columns]
    return exp.select(*cols).from_(exp.Subquery(this=sqlglot.parse_one(compiled.sql, read=dialect),
                                                alias=exp.TableAlias(this=exp.to_identifier("governed")))).sql(dialect=dialect)
