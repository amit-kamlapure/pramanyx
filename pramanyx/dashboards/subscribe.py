"""A dashboard on a rhythm (the dashboards study's R21): the version its readers read, sent as a file by email or Slack.

A subscription is a Briefing subscription whose content is ``dashboard``, so there is one scheduler and one departure gate. At each
send the published version is read again for the subscription's period, every card as the page reads it. Each figure is said with
the period it was read for, a card that could not be cut to it says so, and a line the departure laws hold is cut from the words and
the file alike. What leaves is what was read at that send: nothing is kept from an earlier one.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

FORMATS = ("pdf", "png")
#: The most rows of one card a file prints; a card holding more says how many it holds.
MAX_ROWS = 25


@dataclass
class Piece:
    """One card as it will leave: the line said of it, what it stated, and how the file draws it."""
    line: str
    values: list = field(default_factory=list)
    block: Any = None


def _figure(value: float) -> str:
    return f"{value:,.2f}".rstrip("0").rstrip(".")


def _number(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v)


def placed_cards(spec: dict) -> list[tuple[str, str]]:
    """The cards a spec places, in the order a reader meets them, each with the title this dashboard gives it."""
    elements = spec.get("elements") or {}
    seen: list[tuple[str, str]] = []

    def walk(key: str) -> None:
        el = elements.get(key)
        if not isinstance(el, dict):
            return
        props = el.get("props") or {}
        if el.get("type") == "Card" and props.get("card") and all(props["card"] != c for c, _ in seen):
            seen.append((str(props["card"]), str(props.get("title") or "")))
        for child in el.get("children") or []:
            walk(child)
    walk(str(spec.get("root") or ""))
    return seen


def _read_card(card_id: str, preset: str, workspace_id: Optional[str]) -> dict:
    from pramanyx.routers.cards import run_card_route
    return run_card_route(card_id, preset=preset, workspace_id=workspace_id)


def piece_of(title: str, run: dict, covers: str) -> Piece:
    """What leaves for one card. A figure is never said without the period it was read for."""
    from pramanyx.export.document import Block, KeyNumber
    from pramanyx.export.echarts import render_chart_svg

    if run.get("error"):
        said = f"{title}: not read for {covers}: {str(run['error'])[:200]}"
        return Piece(line=said, block=Block(kind="prose", text=said))
    scoped = run.get("scoped") or {}
    period = f"as written, not cut to {covers}" if scoped.get("standing") else covers
    columns, rows = list(run.get("columns") or []), list(run.get("rows") or [])
    value = _number(run.get("value"))
    if value is not None and len(rows) <= 1:
        text = _figure(value)
        return Piece(line=f"{title}: {text} ({period})", values=[value],
                     block=Block(kind="keynums", keynums=[KeyNumber(label=title, value=text, context=period)]))
    if not rows:
        said = f"{title}: no rows ({period})"
        return Piece(line=said, block=Block(kind="prose", text=said))
    total = int(run.get("row_count") or len(rows))
    values = [float(total)] + [n for r in rows for n in (_number(c) for c in r) if n is not None]
    caption = f"{title} · {period}" + (f" · the first {MAX_ROWS:,} of {total:,} rows" if total > MAX_ROWS else "")
    svg = render_chart_svg(columns, rows, str((run.get("render") or {}).get("chartType") or "auto"), title) if len(columns) > 1 else None
    block = (Block(kind="chart", svg=svg.encode("utf-8"), caption=f"{title} · {period}") if svg
             else Block(kind="table", columns=columns, rows=rows[:MAX_ROWS], caption=caption))
    return Piece(line=f"{title}: {total:,} row{'' if total == 1 else 's'} ({period})", values=values, block=block)


def picture_of(pdf: bytes) -> bytes:
    """The pages of a PDF as one tall picture."""
    import pypdfium2
    from PIL import Image

    document = pypdfium2.PdfDocument(pdf)
    try:
        pages = [document[i].render(scale=2).to_pil().convert("RGB") for i in range(len(document))]
    finally:
        document.close()
    sheet = Image.new("RGB", (max(p.width for p in pages), sum(p.height for p in pages)), "white")
    top = 0
    for page in pages:
        sheet.paste(page, (0, top))
        top += page.height
    out = io.BytesIO()
    sheet.save(out, format="PNG", optimize=True)
    return out.getvalue()


def build_departure(sub: Any, *, read: Callable[[str, str, Optional[str]], dict] = _read_card) -> dict:
    """The published dashboard for ``sub``'s period, judged line by line. ``{"summary", "markdown", "held_lines", "measurement",
    "file": (bytes, filename, media type)}``. Raises ``ValueError`` with the reason when there is nothing it may send."""
    from pramanyx.briefing import ranges
    from pramanyx.cards.store import get_card
    from pramanyx.dashboards import sharing, versions
    from pramanyx.export.document import Block, ExportDoc
    from pramanyx.export.pdf import render_pdf
    from pramanyx.govern.departure import Measurement, line_holds

    reader = str(sub.reader or "").removeprefix("user:") or sub.dashboard_owner
    try:
        got = sharing.read_shared(sub.conn_id, sub.dashboard_owner, sub.dashboard, reader=reader)
        kept = next(v for k, v in got.items() if k != "home")            # the version its readers read
    except sharing.Refused as exc:
        raise ValueError(str(exc)) from exc
    preset = ranges.PERIOD_PRESET.get(sub.period, "yesterday")
    spec, why = ranges.resolve_for(sub.conn_id, preset, workspace_id=sub.workspace_id or None, schema=sub.schema_name or None)
    if spec is None:
        raise ValueError(f"the period cannot be read: {why}")
    covers = ranges.phrases(spec)["covers"]
    title = versions.title_of(kept["spec"]) or sub.dashboard
    pieces: list[Piece] = []
    for card_id, placed in placed_cards(kept["spec"]):
        card = get_card(card_id)
        named = placed or (card.title if card else card_id)
        try:
            pieces.append(piece_of(named, read(card_id, preset, sub.workspace_id or None), covers))
        except Exception as exc:  # noqa: BLE001 — one card that cannot be read is said; the rest still leave
            pieces.append(piece_of(named, {"error": type(exc).__name__}, covers))
    measurement = Measurement(source="the dashboard's cards, read at this send", values=[v for p in pieces for v in p.values], rendered=True)
    kept_pieces: list[Piece] = []
    held: list[str] = []
    for piece in pieces:
        reasons = line_holds(piece.line, conn_id=sub.conn_id, declared=True, measurement=measurement)
        if reasons:
            held.append(f"“{piece.line[:80]}”: {reasons[0]}")
        else:
            kept_pieces.append(piece)
    if not kept_pieces:
        raise ValueError("every card of this dashboard was held at departure, so nothing was sent")
    tail = f"\n\n_{len(held):,} held at departure._" if held else ""
    markdown = f"*{title}* · {covers}\n" + "\n".join(f"• {p.line}" for p in kept_pieces) + tail
    blocks = [p.block for p in kept_pieces] + ([Block(kind="prose", text=f"{len(held):,} held at departure.")] if held else [])
    pdf = render_pdf(ExportDoc(title=title, subtitle=covers, kind="dashboard", blocks=blocks,
                               meta=[f"Published version {kept.get('version')}"]))
    name = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "dashboard"
    file = (picture_of(pdf), f"{name}.png", "image/png") if sub.file_format == "png" else (pdf, f"{name}.pdf", "application/pdf")
    return {"summary": f"{title} · {covers}", "markdown": markdown, "held_lines": held, "measurement": measurement, "file": file}
