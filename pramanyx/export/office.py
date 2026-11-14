"""An answer as an Excel workbook or a Word document (the Genie One study, 2026-11-15).

The shell the coworker runs on can write Office files, by running code the model writes. That was switched off on
purpose: a figure must never pass through code a model wrote. These two renderers are the platform's own way to the
same files, built from the answer's stored report — the same `ExportDoc` the PDF and the deck are drawn from, so the
four formats say the same thing.

* **Excel** carries the answer's rows themselves, every one stored and as values (a number stays a number), where
  the PDF and the deck show a preview of 8 or 25. Sheets: the answer (headline, question, summary, figures, where it
  came from), the data, and the query.
* **Word** is the document a person keeps and edits: headings, paragraphs, figures, the chart as drawn, the table,
  the query, and the line saying where every figure came from.
"""
from __future__ import annotations

import io
import re
from typing import Any

from .document import Block, ExportDoc

_SHEET_BAD = re.compile(r"[\[\]:*?/\\]")
_MAX_CELL = 32_000


def _cell(v: Any) -> Any:
    """A value as a cell: numbers and booleans as they are, everything else as text (bounded: Excel's own limit)."""
    if v is None or isinstance(v, (bool, int, float)):
        return v
    s = str(v)
    return s if len(s) <= _MAX_CELL else s[:_MAX_CELL] + "…"


def _sheet_name(name: str, taken: set[str]) -> str:
    base = (_SHEET_BAD.sub(" ", name).strip() or "Sheet")[:31]
    out, n = base, 2
    while out.lower() in taken:
        suffix = f" ({n})"
        out, n = base[:31 - len(suffix)] + suffix, n + 1
    taken.add(out.lower())
    return out


def render_xlsx(doc: ExportDoc, report: dict | None = None) -> bytes:
    """The workbook. ``report`` is the answer's stored report: its full ``columns``/``rows`` and ``sql``, read in
    preference to the document's previews."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font

    rep = report or {}
    wb = Workbook()
    taken: set[str] = set()
    ws = wb.active
    ws.title = _sheet_name("Answer", taken)
    bold = Font(bold=True)
    ws.append([doc.title])
    ws["A1"].font = Font(bold=True, size=14)
    if doc.subtitle:
        ws.append([doc.subtitle])
    for m in doc.meta:
        ws.append([m])
    ws.append([])
    for b in doc.blocks:
        if b.kind == "heading":
            ws.append([b.text])
            ws.cell(row=ws.max_row, column=1).font = bold
        elif b.kind in ("prose", "finding") and b.text:
            ws.append([b.text])
            ws.cell(row=ws.max_row, column=1).alignment = Alignment(wrap_text=True, vertical="top")
        elif b.kind == "bullets":
            for it in b.items:
                ws.append([f"• {it}"])
        elif b.kind == "keynums":
            for k in b.keynums:
                ws.append([k.label, k.value, k.context or ""])
        elif b.kind == "recs":
            for r in b.recs:
                ws.append([f"• {r.get('title') or r.get('text') or ''}"])
    if doc.source_text():
        ws.append([])
        ws.append([doc.source_text()])
        if doc.source_url:
            ws.cell(row=ws.max_row, column=1).hyperlink = doc.source_url
    ws.column_dimensions["A"].width = 100

    tables: list[tuple[str, list, list]] = []
    if rep.get("columns") and rep.get("rows") is not None:
        tables.append(("Data", list(rep["columns"]), list(rep["rows"])))
    else:
        tables += [(b.caption or "Data", b.columns, b.rows) for b in doc.blocks if b.kind == "table" and b.columns]
    for title, columns, rows in tables:
        t = wb.create_sheet(_sheet_name(title, taken))
        t.append([str(c) for c in columns])
        for c in t[1]:
            c.font = bold
        for row in rows:
            values = row if isinstance(row, (list, tuple)) else [row.get(c) for c in columns] if isinstance(row, dict) else [row]
            t.append([_cell(v) for v in values])
        t.freeze_panes = "A2"
        for i, c in enumerate(columns, start=1):
            t.column_dimensions[t.cell(row=1, column=i).column_letter].width = max(10, min(40, len(str(c)) + 4))

    sql = rep.get("sql") or next((b.text for b in doc.blocks if b.kind == "code" and b.text), "")
    if sql:
        q = wb.create_sheet(_sheet_name("Query", taken))
        for line in str(sql).splitlines():
            q.append([line])
        q.column_dimensions["A"].width = 120

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def render_docx(doc: ExportDoc) -> bytes:
    """The Word document: what the answer says, in the order the PDF says it."""
    from docx import Document
    from docx.shared import Inches, Pt

    d = Document()
    d.add_heading(doc.title, level=0)
    if doc.subtitle:
        d.add_paragraph(doc.subtitle).italic = True
    if doc.meta:
        d.add_paragraph(" · ".join(doc.meta)).runs[0].font.size = Pt(9)
    pending_caption = ""
    for b in doc.blocks:
        pending_caption = _docx_block(d, b, pending_caption, Inches, Pt)
    if doc.source_text():
        p = d.add_paragraph(doc.source_text())
        p.runs[0].font.size = Pt(9)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def _docx_block(d, b: Block, pending_caption: str, Inches, Pt) -> str:
    if b.kind == "heading":
        d.add_heading(b.text, level=1)
    elif b.kind in ("prose", "finding") and b.text:
        d.add_paragraph(b.text)
    elif b.kind == "bullets":
        for it in b.items:
            d.add_paragraph(it, style="List Bullet")
    elif b.kind == "keynums" and b.keynums:
        for k in b.keynums:
            p = d.add_paragraph()
            p.add_run(f"{k.value}  ").bold = True
            p.add_run(k.label + (f" — {k.context}" if k.context else ""))
    elif b.kind == "recs":
        for r in b.recs:
            d.add_paragraph(str(r.get("title") or r.get("text") or ""), style="List Bullet")
    elif b.kind == "chart" and b.png:
        d.add_picture(io.BytesIO(b.png), width=Inches(6))
        if b.caption:
            d.add_paragraph(b.caption).runs[0].font.size = Pt(9)
    elif b.kind == "chart":
        return b.caption or pending_caption                     # the table that follows carries its title
    elif b.kind == "table" and b.columns:
        caption = b.caption or pending_caption
        if caption:
            d.add_paragraph(caption).runs[0].bold = True
        table = d.add_table(rows=1, cols=len(b.columns))
        table.style = "Light Grid Accent 1"
        for i, c in enumerate(b.columns):
            table.rows[0].cells[i].text = str(c)
        for row in b.rows:
            cells = table.add_row().cells
            for i, v in enumerate(list(row)[:len(b.columns)]):
                cells[i].text = "" if v is None else str(v)
        return ""
    elif b.kind == "code" and b.text:
        p = d.add_paragraph()
        run = p.add_run(b.text)
        run.font.name = "Courier New"
        run.font.size = Pt(9)
    return pending_caption if b.kind != "table" else ""
