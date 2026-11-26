"""What stands out — an open question answered from the governed metrics first (2026-11-27).

"Show me interesting trends and facts in the data set" (theLook, 2026-11-26) came back from the Ask panel as three
event counts by browser and traffic source, and from the coworker as nothing: the intake squeezed an open question into
one metric on one table — web events in one run, revenue by category in the next — and none of the twenty approved
metrics, their definitions or their dimensions was read. A count was reported because it was a number, not because it
said anything.

An open question is now measured before the model writes a word, by the measurement every Briefing figure already uses
(`briefing.edition.measure_check`): each approved, dated metric for the period against the one before, a year earlier
and its usual range — how far from usual (``z``), how many periods in a row it moved one way, whether it is the
highest or lowest of the periods read. They are ranked by how unusual the move is (`edition.score`), then by its size;
the leading movers are broken down by the segments of their dated table, each segment against its own usual. The rows
become the turn's first results, cited by the answer like any query's.

What could not be measured is said (``not_read``), and nothing here calls a model.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any, Callable, Optional

#: The movers broken down by segment.
TOP_MOVERS = 3
#: Dimensions a mover is broken down by.
DIMENSIONS = 2
#: The period an open question reads when it names none: the last 30 whole days, ending yesterday.
DEFAULT_DAYS = 30
#: The metrics read across the data's whole span, in the Briefing guide's order (its curated priority).
SHAPE_METRICS = 6
#: Of those, the ones whose composition by segment is read across the whole span.
SHAPE_COMPOSED = 3
#: The most periods a whole-span series holds — the newest are kept.
MAX_BUCKETS = 24
#: The segments of a composition kept, largest first.
MAX_SEGMENTS = 6


def is_open(question: str) -> bool:
    """Whether a question asks for the landscape — what is interesting, notable or trending — rather than a figure.
    One rule, the question's shape's (`question_shape.is_open`)."""
    from pramanyx.agent.question_shape import is_open as _open
    return _open(question)


def _period(question: str) -> tuple[date, date, bool]:
    """``(first, last, named)`` — the days (inclusive) an open question reads: the one it names, else the last 30 days,
    and whether the person named it."""
    from pramanyx.kernel.clock import period_named, periods, person_clock
    named = period_named(question, person_clock())
    if named:
        return named[0], named[1] - timedelta(days=1), True
    p = periods(person_clock())
    return p.yesterday - timedelta(days=DEFAULT_DAYS - 1), p.yesterday, False


def _checks(conn_id: str, schema: Optional[str], metrics: list) -> list:
    """The checks to measure: the published Briefing guide's when it has one, else one per approved, dated metric."""
    from pramanyx.briefing import guide as G
    guide, _rev = G.current(conn_id, schema)
    if guide is not None and guide.checks:
        return [c.model_copy(update={"dimensions": []}) for c in guide.checks]
    out = []
    for m in metrics:
        name = str(getattr(m, "name", "") or "")
        if not name or not getattr(m, "time_column", None):
            continue
        out.append(G.Check(id=re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "metric",
                           label=str(getattr(m, "label", "") or name), metric=name,
                           unit=str(getattr(m, "unit", "") or ""),
                           why=str(getattr(m, "description", "") or "")[:160]))
    return out


def _rank_key(fig: dict) -> tuple:
    """How unusual the move is (the Briefing's `score`: its distance from usual, a run, a high or a low), then its size.
    A metric with too few earlier periods for a usual range ranks by its size alone: a doubling counts as two standard
    deviations, capped at 2.5 — a metric that tripled is never ranked under one that moved a tenth within its
    usual, and never over one measured three deviations from its usual."""
    from pramanyx.briefing.edition import score
    rel = abs(fig.get("rel") or 0.0)
    unusual = score(fig, watched=False) if fig.get("z") is not None else min(2.0 * rel, 2.5)
    return (unusual + (0.5 if fig.get("extreme") else 0.0), min(rel, 5.0))


def _standing(fig: dict) -> str:
    """How the figure stands, in words a person reads: its distance from usual, a run, a high or a low."""
    said: list[str] = []
    z = fig.get("z")
    if z is not None and abs(z) >= 1:
        said.append(f"{abs(z):.1f} standard deviations {'above' if z > 0 else 'below'} its usual")
    ext = fig.get("extreme")
    if ext:
        said.append(f"the {ext['which']} of the last {ext['of']} periods")
    streak = fig.get("streak") or 0
    if abs(streak) >= 3:
        said.append(f"{'up' if streak > 0 else 'down'} {abs(streak)} periods in a row")
    if not (fig.get("equal_age") or {}).get("equal", True):
        said.append("still settling, so its distance from usual is not read")
    return "; ".join(said) or "within its usual range"


def measure(conn_id: str, question: str, *, schema: Optional[str] = None,
            runner: Optional[Callable] = None) -> dict:
    """Every approved metric for the period the question reads, ranked by how unusual its move is; the leading movers
    broken down by segment. ``{"figures", "movers", "period", "not_read", "why"}`` — ``why`` says when nothing could be
    measured. No model call."""
    from pramanyx.briefing import edition as E
    from pramanyx.briefing import guide as G
    from pramanyx.briefing import ranges
    from pramanyx.briefing.compose.write import breakdown_columns
    from pramanyx.knowledge import period_brief
    from pramanyx.orgsettings import figure_currency

    metrics = ranges.governed_metrics(conn_id, schema)
    checks = _checks(conn_id, schema, metrics)
    if not checks:
        return {"figures": [], "movers": [], "period": {}, "not_read": [],
                "why": "this dataset has no approved metric with a date to measure a period by"}
    first, last, named = _period(question)
    spec, why = ranges.resolve_for(conn_id, "custom", start=first, end=last, schema=schema)
    if spec is None:
        return {"figures": [], "movers": [], "period": {}, "not_read": [], "why": why}
    guide = G.BriefingGuide(checks=checks)
    currency = figure_currency(conn_id, schema)
    by_name = {m.name: m for m in metrics}
    with (runner or (lambda: period_brief.connection_runner(conn_id)))() as (run_sql, dialect):
        measured = E.measure_edition(conn_id, spec, guide, published=False, run_sql=run_sql, dialect=dialect,
                                     schema=schema, currency=currency)
        figures = sorted(measured["figures"], key=_rank_key, reverse=True)
        movers = []
        for fig in figures[:TOP_MOVERS]:
            check = guide.check(fig["id"])
            m, _why = G.measurable(check, by_name) if check else (None, "")
            if m is None:
                continue
            dims = breakdown_columns(conn_id, E._dated_table(m))[:DIMENSIONS]
            if not dims:
                continue
            windows = [spec.windows()[0]] + E.usual_windows(spec, guide.news.usual_for(E._period(spec)))
            try:
                cells = E._cells(m, check.model_copy(update={"dimensions": dims}), windows, run_sql, dialect,
                                 name=fig["label"], unit=fig.get("unit") or "", currency=currency)
            except Exception as exc:  # noqa: BLE001 — a breakdown that fails costs only itself; the figure stands
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "a mover's breakdown could not be measured; the figure stands",
                         counter="landscape.cells")
                continue
            movers.append({"id": fig["id"], "label": fig["label"], "cells": cells})
        # The data's whole span: what an open question about "the data set" is about. The recent period alone cannot
        # say it — on theLook no age settles and a table redrawn at each refresh reads as growth (2026-11-04), so
        # every recent figure was "still settling" and the answer had nothing to say (2026-11-27); a plain model given
        # only the schema described eight years of growth, the mix and the leaders, and was the better answer.
        try:
            # a period the person named, of a quarter or more, is the span its shape is read over, month by month
            within = (first, last) if named and (last - first).days >= 89 else None
            shaped = shape(conn_id, schema, checks, by_name, run_sql, dialect, today=spec.as_of, within=within)
        except Exception as exc:  # noqa: BLE001 — the period's figures stand without it, and it says so
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "the data's whole span could not be read; the period's figures stand", counter="landscape.shape")
            shaped = {"grain": "", "series": [], "composition": [], "why": f"it could not be read ({type(exc).__name__})"}
    _start = getattr(spec, "start", None)
    _end = getattr(spec, "end", None)
    p_first = _start.isoformat() if hasattr(_start, "isoformat") else first.isoformat()
    p_last = (_end - timedelta(days=1)).isoformat() if hasattr(_end, "isoformat") else last.isoformat()
    unequal = sum(1 for f in figures if not (f.get("equal_age") or {}).get("equal", True))
    return {"figures": figures, "movers": movers, "not_read": measured["not_read"], "why": "", "shape": shaped,
            # how many of the period's figures are not at equal age with what they are compared with: a change read off
            # them is partly the difference in age, so most of them unequal means the period's moves are not news
            "unequal": unequal,
            "period": {"first": p_first, "last": p_last, "label": getattr(spec, "label", ""), "named": named}}


def _buckets(first: date, through: date) -> tuple[str, list]:
    """``(grain, windows)`` — whole periods spanning ``first``..``through`` (inclusive): years when the data spans three
    or more, quarters over eighteen months, months over three, else weeks. The newest ``MAX_BUCKETS`` are kept. A window
    the data covers only part of is labelled so (``… (part)``) and never read as a whole period."""
    from pramanyx.semantic.metric_time import Window
    days = (through - first).days + 1
    grain = "year" if days >= 3 * 365 else "quarter" if days >= 540 else "month" if days >= 90 else "week"
    end_x = through + timedelta(days=1)

    def nxt(d: date) -> date:
        if grain == "year":
            return date(d.year + 1, 1, 1)
        if grain == "quarter":
            m = ((d.month - 1) // 3 + 1) * 3 + 1
            return date(d.year + 1, 1, 1) if m > 12 else date(d.year, m, 1)
        if grain == "month":
            return date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)
        return d + timedelta(days=7)

    def head(d: date) -> date:
        if grain == "year":
            return date(d.year, 1, 1)
        if grain == "quarter":
            return date(d.year, (d.month - 1) // 3 * 3 + 1, 1)
        if grain == "month":
            return d.replace(day=1)
        return d - timedelta(days=d.weekday())

    def label(d: date) -> str:
        return (str(d.year) if grain == "year" else f"{d.year} Q{(d.month - 1) // 3 + 1}" if grain == "quarter"
                else f"{d.year}-{d.month:02d}" if grain == "month" else f"week of {d.isoformat()}")

    out = []
    s = head(first)
    while s < end_x:
        e = nxt(s)
        lo, hi = max(s, first), min(e, end_x)
        part = lo != s or hi != e
        out.append(Window(label(s) + (" (part)" if part else ""), lo, hi))
        s = e
    return grain, out[-MAX_BUCKETS:]


def _pct(a: Optional[float], b: Optional[float]) -> Optional[float]:
    return None if a is None or b in (None, 0) else round((a / b - 1) * 100, 1)


def shape(conn_id: str, schema: Optional[str], checks: list, by_name: dict, run_sql: Callable, dialect: str, *,
          today: date, within: Optional[tuple[date, date]] = None) -> dict:
    """The data's whole span, by each approved metric's own definition: ``{"grain", "first", "through", "series",
    "composition", "why"}``. ``series`` — per metric, its value in every whole period the data holds, the first and
    last whole period, the change between them and the peak; ``composition`` — for the leading additive metrics, the
    segments of their most telling dimension across the whole span, each one's share, and its share in the last whole
    period (the mix shift). No model call; every figure is read by a statement kept beside it."""
    from pramanyx.briefing import edition as E
    from pramanyx.briefing import guide as G
    from pramanyx.briefing import ranges
    from pramanyx.briefing.compose.write import breakdown_columns
    from pramanyx.semantic import metric_time as mt
    from pramanyx.semantic.metric_time import Window

    edge = ranges.data_edge(conn_id, schema, today=today)
    first, through = edge.get("from"), edge.get("through")
    if within and first and through:
        # the period asked, inside what the data holds (a day before its first or after its last holds nothing)
        first, through = max(first, within[0]), min(through, within[1])
    if not first or not through or through < first:
        return {"grain": "", "series": [], "composition": [], "why": edge.get("why") or "where the data starts is not known"}
    grain, windows = _buckets(first, through)
    series, composition, skipped = [], [], []
    for check in checks:
        if len(series) >= SHAPE_METRICS:
            break
        m, why = G.measurable(check, by_name)
        if m is None or str(getattr(m, "time_kind", "") or "") == "stock":
            continue                       # a level is read as it stands, not summed over a year
        rows, why = mt.run_measure(m, windows, run_sql, dialect=dialect)
        if why:
            skipped.append(f"{check.label}: {why}")
            continue
        sql, _ = mt.measure_sql(m, windows, dialect=dialect)
        val = {r["window"]: r["value"] for r in rows}
        points = [{"period": w.label, "value": val.get(w.label), "part": w.label.endswith("(part)")} for w in windows]
        whole = [p for p in points if not p["part"] and p["value"] is not None]
        if not whole:
            continue
        peak = max(whole, key=lambda p: p["value"])
        series.append({"label": check.label, "unit": check.unit, "points": points, "sql": sql or "",
                       "first": whole[0], "last": whole[-1], "change_pct": _pct(whole[-1]["value"], whole[0]["value"]),
                       "last_vs_before": _pct(whole[-1]["value"], whole[-2]["value"]) if len(whole) > 1 else None,
                       "peak": peak, "adds_up": mt.adds_up(m, dialect=dialect), "metric": m})
    last_whole = next((w for w in reversed(windows) if not w.label.endswith("(part)")), None)
    for sr in [x for x in series if x["adds_up"]][:SHAPE_COMPOSED]:
        m = sr["metric"]
        dims = breakdown_columns(conn_id, E._dated_table(m))[:1]
        if not dims:
            continue
        span = Window("whole span", first, through + timedelta(days=1))
        wins = [span] + ([Window("last", last_whole.start, last_whole.end)] if last_whole else [])
        rows, why = mt.run_measure(m, wins, run_sql, dialect=dialect, by=dims[0])
        if why:
            skipped.append(f"{sr['label']} by {dims[0]}: {why}")
            continue
        sql, _ = mt.measure_sql(m, wins, dialect=dialect, by=dims[0])
        allv = {r["group"]: r["value"] for r in rows if r["window"] == "whole span" and r["value"] is not None}
        lastv = {r["group"]: r["value"] for r in rows if r["window"] == "last" and r["value"] is not None}
        tot, tot_last = sum(allv.values()) or None, sum(lastv.values()) or None
        segs = sorted(allv.items(), key=lambda kv: -kv[1])[:MAX_SEGMENTS]
        composition.append({
            "label": sr["label"], "dimension": dims[0], "sql": sql or "",
            "last_period": last_whole.label if last_whole else "",
            "segments": [{"segment": "" if g is None else str(g), "value": v,
                          "share": None if not tot else round(v / tot * 100, 1),
                          "share_last": None if not tot_last or g not in lastv else round(lastv[g] / tot_last * 100, 1)}
                         for g, v in segs]})
    for sr in series:
        sr.pop("metric", None)
    return {"grain": grain, "first": first.isoformat(), "through": through.isoformat(), "series": series,
            "composition": composition, "why": "" if series else ("; ".join(skipped) or "no approved flow metric to read"),
            "skipped": skipped}


def _num(v: Any, places: int = 4) -> Any:
    return None if v is None else round(float(v), places)


def phases(measured: dict) -> list[dict]:
    """The measurement as the turn's first results: one table of every metric ranked, one per mover's breakdown —
    each a finding with an id the answer cites (`analyst.conclude`)."""
    figs = measured.get("figures") or []
    found = _shape_phases(measured.get("shape") or {})
    if not figs:
        return found
    p = measured.get("period") or {}
    rows = [[f["label"], _num(f.get("current")), _num(f.get("previous")),
             None if f.get("rel") is None else round(f["rel"] * 100, 1),
             _num((f.get("usual") or {}).get("mean")), _standing(f)] for f in figs]
    found += [{
        "phase_id": "landscape", "phase_name": f"What moved, {p.get('first')} to {p.get('last')}",
        "phase_icon": "🧭", "status": "complete", "summary": "", "skipped_reason": None, "by_code": True,
        "findings": [{
            "finding_id": "landscape_1", "title": "Every approved metric against the period before and its usual",
            # the statements that measured them: a finding counts as evidence only with the SQL that produced it, and
            # with none the report's no-data floor read a run that concluded on these rows as "nothing gathered"
            "sql": ";\n\n".join(str(f.get("sql") or "") for f in figs if f.get("sql")), "columns": ["metric", "this period", "period before", "change %", "usual", "standing"],
            "rows": rows, "row_count": len(rows), "error": None, "key_numbers": [],
            "chart_type": "table", "chart_config": {}, "stat_note": None, "is_significant": False,
            # a description, never a warning: a result whose trust_caveat is set reads as one a guard flagged, and the
            # analyst's stop check holds an answer every result of which is flagged (2026-11-27, live: the open
            # question's answer was held and the model left the measured movers for ad-hoc queries)
            "interpretation": "Measured by each metric's approved definition (the Briefing's measurement).",
            "trust_caveat": "",
        }],
    }]
    for i, mv in enumerate(measured.get("movers") or [], start=2):
        crow = []
        for dim, got in (mv.get("cells") or {}).items():
            for c in got.get("cells") or []:
                if c.get("thin"):
                    continue
                crow.append([dim, c["group"], _num(c.get("current")), _num(c.get("usual")),
                             None if c.get("rel") is None else round(c["rel"] * 100, 1), c.get("n")])
        if not crow:
            continue
        found.append({
            "phase_id": f"landscape_{i}", "phase_name": f"Where {mv['label']} moved", "phase_icon": "🧭",
            "status": "complete", "summary": "", "skipped_reason": None, "by_code": True,
            "findings": [{
                "finding_id": f"landscape_{i}_1", "title": f"{mv['label']} by segment, against each segment's usual",
                "sql": "", "columns": ["dimension", "segment", "this period", "usual", "change %", "rows"],
                "rows": crow, "row_count": len(crow), "error": None, "interpretation": "", "key_numbers": [],
                "chart_type": "auto", "chart_config": {}, "stat_note": None, "is_significant": False,
                "trust_caveat": "",
            }],
        })
    return found


def _finding(fid: str, title: str, sql: str, columns: list, rows: list, chart: str = "table") -> dict:
    return {"finding_id": fid, "title": title, "sql": sql, "columns": columns, "rows": rows, "row_count": len(rows),
            "error": None, "key_numbers": [], "chart_type": chart, "chart_config": {}, "stat_note": None,
            "is_significant": False, "interpretation": "Measured by each metric's approved definition.",
            "trust_caveat": ""}


def _shape_phases(sh: dict) -> list[dict]:
    """The data's whole span as results the answer cites: ``shape_1`` one row per metric (first and last whole period,
    the change between them, the peak), ``shape_2`` every period's value, ``shape_3`` onward each composition."""
    series = sh.get("series") or []
    if not series:
        return []
    g = sh.get("grain") or "period"
    summary = [[sr["label"], sr["first"]["period"], _num(sr["first"]["value"]), sr["last"]["period"],
                _num(sr["last"]["value"]), sr.get("change_pct"), sr.get("last_vs_before"), sr["peak"]["period"],
                _num(sr["peak"]["value"])] for sr in series]
    # wide — one row per metric, a column per period — so every period's value is in the evidence the answer is checked
    # against (a long table of metric × period ran past the twenty rows a result shows)
    periods = [pt["period"] for pt in series[0]["points"]]
    wide = [[sr["label"], *[_num(pt["value"]) for pt in sr["points"]]] for sr in series]
    sql = ";\n\n".join(sr["sql"] for sr in series if sr.get("sql"))
    findings = [
        _finding("shape_1", f"Each metric across the data, {sh.get('first')} to {sh.get('through')}, by {g}", sql,
                 ["metric", f"first whole {g}", "value then", f"last whole {g}", "value now",
                  "change first to last %", f"last {g} on the one before %", f"peak {g}", "peak value"], summary),
        _finding("shape_2", f"Every {g}'s value", sql, ["metric", *periods], wide),
    ]
    for i, c in enumerate(sh.get("composition") or [], start=3):
        rows = [[c["dimension"], sg["segment"], _num(sg["value"]), sg.get("share"), sg.get("share_last")]
                for sg in c["segments"]]
        findings.append(_finding(f"shape_{i}", f"{c['label']} by {c['dimension']}, across the data and in "
                                 f"{c.get('last_period') or 'the last whole period'}", c.get("sql") or "",
                                 ["dimension", "segment", "whole span", "share %", f"share in {c.get('last_period')} %"],
                                 rows))
    return [{"phase_id": "shape", "phase_name": f"The data across its span, by {g}", "phase_icon": "🧭",
             "status": "complete", "summary": "", "skipped_reason": None, "by_code": True, "findings": findings}]


def _shape_lines(sh: dict) -> list[str]:
    out = []
    for sr in sh.get("series") or []:
        ch = "" if sr.get("change_pct") is None else f", {sr['change_pct']:+.1f}% from {sr['first']['period']}"
        lb = "" if sr.get("last_vs_before") is None else f"; its last whole {sh.get('grain')} {sr['last_vs_before']:+.1f}% on the one before"
        out.append(f"  - {sr['label']}: {_num(sr['first']['value'], 2)} in {sr['first']['period']} → "
                   f"{_num(sr['last']['value'], 2)} in {sr['last']['period']}{ch}; peak {sr['peak']['period']}{lb}")
    for c in sh.get("composition") or []:
        segs = ", ".join(f"{sg['segment']} {sg['share']}%" + (f" (now {sg['share_last']}%)" if sg.get("share_last") is not None else "")
                         for sg in c["segments"][:4] if sg.get("share") is not None)
        if segs:
            out.append(f"  - {c['label']} by {c['dimension']}: {segs}")
    return out


def prompt_section(measured: dict) -> str:
    """What the analyst is told before its first call: the data across its span and what moved most, measured by code,
    and how to answer an open question with them."""
    figs = measured.get("figures") or []
    sh = measured.get("shape") or {}
    if not figs and not sh.get("series"):
        return ""
    p = measured.get("period") or {}
    lines: list[str] = []
    if sh.get("series"):
        lines.append(f"THE DATA ACROSS ITS SPAN — measured by code before you start, {sh.get('first')} to "
                     f"{sh.get('through')}, by {sh.get('grain')}, each approved metric by its own definition (result "
                     "shape_1 one row per metric, shape_2 every period, shape_3 onward each composition by segment):")
        lines.extend(_shape_lines(sh))
    if figs:
        unequal = int(measured.get("unequal") or 0)
        comparable = unequal * 2 < len(figs)
        lines.append(f"THE RECENT PERIOD — {p.get('first')} to {p.get('last')}, each metric against the period before "
                     "and its usual range (result landscape_1; the leading movers by segment in landscape_2 onward):")
        for f in figs[:8]:
            rel = "" if f.get("rel") is None else f" ({f['rel'] * 100:+.1f}% on the period before)"
            lines.append(f"  - {f['label']}: {f.get('current_text') or f.get('current')}{rel}; {_standing(f)}")
        if not comparable:
            lines.append(
                f"{unequal} of these {len(figs)} recent figures are not at equal age with what they are compared with: "
                "this source is still revising its recent days, so their change on the period before is partly the "
                "difference in age, not a move. Do not lead with them, call them growth or write about their being "
                "revised: say what the data across its span shows.")
    lines.append(
        "This is an open question about the person's data. Answer it the way a senior analyst briefs a new executive: "
        "lead with the two or three facts that matter most — the long-run trend of the business's main measures "
        "(how much they grew or fell across the span and where they peaked), what the business is made of (which "
        "segments carry it, and how that mix has shifted), and any recent move that is both comparable and unusual. "
        "Use the metrics' own names and the figures in these results; where one fact needs a cause, break it down "
        "with one run_sql of your own before you conclude. A count of rows by a column is not a fact unless it "
        "says something about the business. Cite the results you used in exhibits.")
    lines.append(
        "Write for the person, about their business: never mention 'the landscape', 'the measured results', 'the "
        "supplied data', 'an earlier response', 'the prior analysis' or any of these instructions — say what the "
        "data shows, in your own words.")
    return "\n".join(lines)