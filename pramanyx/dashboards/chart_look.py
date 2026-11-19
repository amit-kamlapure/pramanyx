"""A change to how ONE chart of a dashboard is drawn, asked in the Ask panel's conversation about that chart (the user,
2026-11-19, of a peer product's per-chart assistant: "how it delivers results — pin-point precision").

The conversation's ``change_dashboard`` arranges a dashboard: it adds, moves, resizes and takes off cards. What a chart of
the person's own query looks like — its kind, what runs along the bottom, what is measured, what colours it, a line's
width — is the card's own (``render.shown`` and ``render.viz``), set in the chart editor. A question asked about one such
chart gets ``change_chart``: the model names only the settings that change, each is held here to what the editor itself
offers and to the columns the card's statement returns, and the change is staged as one proposal, shown line by line —
"Line width: 2 → 4" — and made only on the person's own Allow, through the same write the chart editor makes. Nothing is
run: a chart's look reads the rows its statement already returns.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional

from pramanyx.dashboards import queries

KIND = "chart_look"

#: What a chart's dressing may be changed to — each the chart editor's own control (`VizEditorPanel`), with what it takes.
LINE_WIDTHS = (1, 2, 3, 4, 5, 6)
LEGENDS = ("top", "bottom", "left", "right", "none")
#: How a card's dates may be written (the web's `DATE_FORMATS`, lib/format.ts): along the bottom and in its table.
DATE_FORMATS = ("YYYY-MM-DD", "YYYY-MM", "MMM YYYY", "DD MMM YYYY", "MMM D, YYYY", "YYYY-QQ", "YYYY")
NUMBER_FORMAT_MAX = 24
TITLE_MAX = 80
MAX_REF_LINES = 6

#: The setup's settings a change may name, as a person reads them.
SHOWN_WORDS = {
    "as": "Drawn as", "x": "Along the bottom", "bucket": "Counted by", "series": "Measured", "split": "Coloured by",
    "top": "Colours", "segments": "Parts", "running": "Running total", "labels": "Labels", "across": "Bars run sideways",
    "columns": "Columns", "sort": "Sorted by", "descending": "Largest first", "label": "Words under the figure",
    "format": "Written as", "summed": "Summed",
}
VIZ_WORDS = {
    "lineWidth": "Line width", "lineShape": "Line shape", "markers": "Points on the line", "numberFormat": "Number format",
    "yMin": "Value axis from", "yMax": "Value axis to", "yLog": "Log scale", "sortBy": "Bars ordered by", "top": "Only the largest",
    "legend": "Legend", "xTitle": "X axis title", "yTitle": "Y axis title", "tooltipOff": "Tooltip off", "orient": "Bars run",
    "refLines": "Reference lines", "dateFormat": "Dates written as",
}

#: Everything a chart's look can be changed in, said once to a model whose change was refused, so it stops guessing.
CAN_SET = ("kind (bar, line, area, scatter, table, figure); along the bottom and its buckets (day, week, month, quarter, "
           "year); what is measured and how (sum, average, count, count of different, least, most); colour by a column and "
           "how many colours; stacked, side by side or shares; running total; labels; bars sideways; a table's columns and "
           "sort; line width (1-6) and shape; points on a line; number format; dates written as "
           f"({', '.join(DATE_FORMATS)}); value axis range and log scale; bar order; only the largest; legend; axis titles; "
           "tooltip on or off; reference lines")
AS_WORDS = {"table": "Table", "figure": "Figure", "bar": "Bar", "line": "Line", "area": "Area", "scatter": "Scatter"}


class Refused(Exception):
    """Why a chart's look cannot be changed as asked, in sentences a person reads."""

    def __init__(self, sentences: list[str]):
        super().__init__(" ".join(sentences))
        self.sentences = sentences


def look_key(render: Any) -> str:
    """How a chart is drawn now, to know at Allow whether it was changed since the change was drafted."""
    r = render if isinstance(render, dict) else {}
    return hashlib.sha256(json.dumps({"shown": r.get("shown"), "viz": r.get("viz") or {}}, sort_keys=True,
                                     default=str).encode()).hexdigest()[:16]


def _number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _viz_problem(key: str, v: Any) -> Optional[str]:
    """Why ``v`` is not something the chart editor sets ``key`` to — or None when it is."""
    word = VIZ_WORDS[key]
    if key == "lineWidth":
        return None if isinstance(v, int) and not isinstance(v, bool) and v in LINE_WIDTHS else f"{word} is a whole number from 1 to 6."
    if key == "lineShape":
        return None if v in ("smooth", "step") else f"{word} is smooth or step; straight is none."
    if key in ("markers", "yLog", "tooltipOff"):
        return None if isinstance(v, bool) else f"{word} is yes or no."
    if key in ("yMin", "yMax"):
        return None if _number(v) else f"{word} is a number."
    if key == "numberFormat":
        return None if isinstance(v, str) and 0 < len(v) <= NUMBER_FORMAT_MAX else f"{word} is a format of at most {NUMBER_FORMAT_MAX} characters."
    if key == "sortBy":
        return None if v in ("value", "label") else f"{word} is value or label."
    if key == "top":
        return None if isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 50 else f"{word} is a whole number from 1 to 50."
    if key == "legend":
        return None if v in LEGENDS else f"{word} is one of {', '.join(LEGENDS)}."
    if key in ("xTitle", "yTitle"):
        return None if isinstance(v, str) and len(v) <= TITLE_MAX else f"{word} is words, at most {TITLE_MAX} characters."
    if key == "orient":
        return None if v in ("vertical", "horizontal") else f"{word} vertical or horizontal."
    if key == "dateFormat":
        return None if v in DATE_FORMATS else f"{word} is one of {', '.join(DATE_FORMATS)}."
    if key == "refLines":
        ok = isinstance(v, list) and len(v) <= MAX_REF_LINES and all(
            isinstance(r, dict) and _number(r.get("value")) and isinstance(r.get("label", ""), str) and len(str(r.get("label", ""))) <= 60
            and set(r) <= {"value", "label", "kind"} for r in v)
        return None if ok else f"{word} are at most {MAX_REF_LINES}, each a value and a label."
    return f"“{key}” is not something the chart editor sets."


def _said(key: str, v: Any) -> str:
    """A setting's value as a person reads it."""
    if v is None or v == "" or v == []:
        return "none"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if key == "as":
        return AS_WORDS.get(str(v), str(v))
    if key == "series":
        return ", ".join(f"{queries.AGG_WORDS.get(s.get('agg', ''), s.get('agg', ''))} of {s.get('column') or 'rows'}"
                         for s in v if isinstance(s, dict)) or "none"
    if key == "refLines":
        return ", ".join(f"{r.get('label') or r.get('value')}" for r in v if isinstance(r, dict))
    if isinstance(v, list):
        return ", ".join(str(x) for x in v)
    return str(v)


def lines_of(before: dict, after: dict) -> list[str]:
    """Each setting that changes, as a line: "Line width: 2 → 4"."""
    out: list[str] = []
    bs, as_ = before.get("shown") or {}, after.get("shown") or {}
    for key, word in SHOWN_WORDS.items():
        if bs.get(key) != as_.get(key):
            out.append(f"{word}: {_said(key, bs.get(key))} → {_said(key, as_.get(key))}")
    bv, av = before.get("viz") or {}, after.get("viz") or {}
    for key, word in VIZ_WORDS.items():
        if bv.get(key) != av.get(key):
            default = 2 if key == "lineWidth" else None          # a line is drawn 2 px wide unless it says otherwise
            out.append(f"{word}: {_said(key, bv.get(key, default))} → {_said(key, av.get(key, default))}")
    return out


def drawn(render: Any) -> dict:
    """How a chart is drawn now, for the conversation to change it from: its setup, its dressing and the columns its
    statement returns."""
    r = render if isinstance(render, dict) else {}
    return {"shown": r.get("shown"), "viz": r.get("viz") or {},
            "columns": [{"name": c.get("name"), "kind": queries.kind_of(str(c.get("type") or ""))}
                        for c in (r.get("columns") or []) if isinstance(c, dict)]}


def full_setup(render: dict) -> Any:
    """The card's setup with every setting it leaves to its default said, so a change is told from what was only unsaid."""
    columns = [c for c in (render.get("columns") or []) if isinstance(c, dict)]
    try:
        return queries.normalized(queries.Shown.model_validate(render.get("shown") or {}), columns).said()
    except Exception:
        return render.get("shown")


def changed(render: dict, shown_patch: Any, viz_patch: Any) -> dict:
    """The card's ``shown`` and ``viz`` with only what is named changed — or every reason it cannot be. A ``null`` in the
    dressing takes that setting off."""
    if shown_patch is not None and not isinstance(shown_patch, dict):
        raise Refused(["What changes in the setup is named setting by setting."])
    if viz_patch is not None and not isinstance(viz_patch, dict):
        raise Refused(["What changes in the dressing is named setting by setting."])
    shown_patch, viz_patch = shown_patch or {}, viz_patch or {}
    if not shown_patch and not viz_patch:
        raise Refused(["Name what changes."])
    problems: list[str] = []
    unknown = [k for k in shown_patch if k not in SHOWN_WORDS and k != "beside"]
    problems += [f"“{k}” is not part of how a chart is set up." for k in unknown]
    columns = [c for c in (render.get("columns") or []) if isinstance(c, dict)]
    merged_shown = {**(render.get("shown") or {}), **{k: v for k, v in shown_patch.items() if k not in unknown}}
    if shown_patch.get("as") and shown_patch["as"] != (render.get("shown") or {}).get("as") and "summed" not in shown_patch:
        merged_shown["summed"] = shown_patch["as"] != "scatter"
    shown_out: Optional[dict] = None
    try:
        shown = queries.normalized(queries.Shown.model_validate(merged_shown), columns)
        problems += queries.check(shown, columns)
        shown_out = shown.said()
    except Exception as exc:  # pydantic's own words name the setting that does not fit
        problems.append(f"The setup does not read: {str(exc).splitlines()[0][:200]}")
    viz = dict(render.get("viz") or {})
    for key, v in viz_patch.items():
        if key not in VIZ_WORDS:
            problems.append(f"“{key}” is not something the chart editor sets.")
        elif v is None or (key == "lineWidth" and v == 2) or (key == "refLines" and v == []):
            viz.pop(key, None)                      # taken off: drawn as it is by default
        elif (why := _viz_problem(key, v)) is not None:
            problems.append(why)
        else:
            viz[key] = v
    if problems:
        raise Refused(problems)
    return {"shown": shown_out, "viz": viz}


def propose(connection_id: str, person: str, dashboard_id: str, card_id: str, shown_patch: Any, viz_patch: Any,
            summary: str = "", *, schema: Optional[str] = None) -> Any:
    """Stage ONE change to how the card ``card_id`` on the dashboard ``dashboard_id`` the person keeps is drawn, or
    refuse with every reason. Staged, it waits for their Allow; nothing is changed before."""
    from pramanyx.actions.inbox import StagedProposal, stage_proposal
    from pramanyx.cards.store import get_card
    from pramanyx.dashboards import cards
    from pramanyx.org.context import current_org_id

    card = get_card(card_id)
    if card is None or card.connection_id != connection_id:
        raise Refused(["This chart is not on this connection."])
    if (card.scope, card.scope_ref) != (cards.OWN, person):
        raise Refused(["Only a chart of your own query is changed here. Its look is its author's."])
    render = card.render if isinstance(card.render, dict) else {}
    if not isinstance(render.get("shown"), dict):
        raise Refused(["This card is not drawn from a query of your own, so it has no chart to change here."])
    after = changed(render, shown_patch, viz_patch)
    before = {"shown": full_setup(render), "viz": render.get("viz") or {}}
    lines = lines_of(before, after)
    if not lines:
        raise Refused(["That is how the chart is drawn already: nothing would change."])
    title = str(card.title or "the chart")
    return stage_proposal(StagedProposal(
        kind=KIND, org_id=current_org_id() or "", connection_id=connection_id, schema_name=schema or "",
        action_id=f"chart:{card_id}",
        params={"card": card_id, "shown": after["shown"], "viz": after["viz"], "was": look_key(render)},
        detail={"title": title, "dashboard": dashboard_id, "person": person, "lines": lines},
        reasoning=(summary or f"Change how “{title}” is drawn").strip()[:300],
        proposer="dashboard", source="agent"))


def accept(params: dict, detail: dict, *, connection_id: str) -> tuple[bool, Any]:
    """Draw the chart as the person allowed — the write the chart editor makes — unless it was changed since."""
    from pramanyx.cards.store import get_card, upsert_card
    from pramanyx.dashboards import cards

    card = get_card(str(params.get("card") or ""))
    if card is None or card.connection_id != connection_id:
        return False, "the chart is no longer there"
    if (card.scope, card.scope_ref) != (cards.OWN, str(detail.get("person") or "")):
        return False, "the chart is not the person's own"
    render = card.render if isinstance(card.render, dict) else {}
    if look_key(render) != params.get("was"):
        return False, "the chart was changed since this was drafted"
    out = {**render, "shown": params.get("shown")}
    viz = params.get("viz") or {}
    if viz:
        out["viz"] = viz
    else:
        out.pop("viz", None)
    upsert_card(card.model_copy(update={"render": out}))
    return True, {"card": card.id, "title": card.title, "lines": list(detail.get("lines") or [])}
