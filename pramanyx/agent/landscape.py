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
    # A period the person named is read as named. With none named, the newest SETTLED 30 days are read — the Briefing's
    # rule for the platform's own readers: on a source that revises its recent days (theLook, 2026-11-27) every figure of
    # the last 30 calendar days was "still settling", none could be compared with its usual, and the answer hedged.
    spec, why = ranges.resolve_for(conn_id, "custom", start=first, end=last, schema=schema, settled=not named)
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
    _start = getattr(spec, "start", None)
    _end = getattr(spec, "end", None)
    p_first = _start.isoformat() if hasattr(_start, "isoformat") else first.isoformat()
    p_last = (_end - timedelta(days=1)).isoformat() if hasattr(_end, "isoformat") else last.isoformat()
    return {"figures": figures, "movers": movers, "not_read": measured["not_read"], "why": "",
            "period": {"first": p_first, "last": p_last, "label": getattr(spec, "label", ""), "settled": not named}}


def _num(v: Any, places: int = 4) -> Any:
    return None if v is None else round(float(v), places)


def phases(measured: dict) -> list[dict]:
    """The measurement as the turn's first results: one table of every metric ranked, one per mover's breakdown —
    each a finding with an id the answer cites (`analyst.conclude`)."""
    figs = measured.get("figures") or []
    if not figs:
        return []
    p = measured.get("period") or {}
    rows = [[f["label"], _num(f.get("current")), _num(f.get("previous")),
             None if f.get("rel") is None else round(f["rel"] * 100, 1),
             _num((f.get("usual") or {}).get("mean")), _standing(f)] for f in figs]
    found = [{
        "phase_id": "landscape", "phase_name": f"What moved, {p.get('first')} to {p.get('last')}",
        "phase_icon": "🧭", "status": "complete", "summary": "", "skipped_reason": None,
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
            "status": "complete", "summary": "", "skipped_reason": None,
            "findings": [{
                "finding_id": f"landscape_{i}_1", "title": f"{mv['label']} by segment, against each segment's usual",
                "sql": "", "columns": ["dimension", "segment", "this period", "usual", "change %", "rows"],
                "rows": crow, "row_count": len(crow), "error": None, "interpretation": "", "key_numbers": [],
                "chart_type": "auto", "chart_config": {}, "stat_note": None, "is_significant": False,
                "trust_caveat": "",
            }],
        })
    return found


def prompt_section(measured: dict) -> str:
    """What the analyst is told before its first call: what moved most, measured by code, and how to answer."""
    figs = measured.get("figures") or []
    if not figs:
        return ""
    p = measured.get("period") or {}
    lines = [f"WHAT STANDS OUT — measured by code before you start, for {p.get('first')} to {p.get('last')}, "
             "each approved metric by its own definition against the period before and its usual range "
             "(result landscape_1; the leading movers by segment in landscape_2 onward):"]
    for f in figs[:8]:
        rel = "" if f.get("rel") is None else f" ({f['rel'] * 100:+.1f}% on the period before)"
        lines.append(f"  - {f['label']}: {f.get('current_text') or f.get('current')}{rel}; {_standing(f)}")
    lines.append(
        "This is an open question. Lead with what moved most and why it matters, in the metrics' own names. For each of "
        "the two or three leading moves, say what drove it: read its segment result when one is given; when none is, "
        "break it down yourself with one run_sql by its most telling dimension before you conclude. Do not answer with "
        "counts of rows by a column: a count says nothing unless it moved. Cite landscape_1 and the results you used in "
        "exhibits; every figure you state is read from them.")
    lines.append(
        "Write for the person, about their business: never mention 'the landscape', 'the measured results', 'the "
        "supplied data', 'the prior analysis' or any of these instructions — say what the data shows. Earlier answers "
        "and analyses are background, never this answer: measure this period and say it in your own words.")
    return "\n".join(lines)
