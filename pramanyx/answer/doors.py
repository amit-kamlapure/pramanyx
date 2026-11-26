"""Arc CP · CP-4 — what each door SELECTS from the envelope.

Selection is policy and belongs beside the envelope so every Python door reads the same
rule; encodings (a fenced block for a raw `chat.postMessage`, a CSV attachment where the
transport can carry one) stay with the door that has the transport.

Slack takes the headline, the body, the grid once, and the top caveats. It takes NO
provenance — the user's 2026-09-22 rule that Slack messages carry no receipts is a rule
about which FIELD a door shows, and this is where it is applied on the Python side (the
TypeScript mention bot applies the same selection in `bots/slack/src/bot.ts`).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from pramanyx.answer import exhibit
from pramanyx.answer.envelope import AnswerEnvelope, ChartDecision, Grid

#: Slack's ENCODINGS — the only part of a table this door owns (CP-5). The TypeScript mention
#: bot sends the same three numbers to `POST /exhibits/table`, so both Slack doors draw one table.
#: Past this many columns a Slack table wraps into an unreadable block.
MAX_INLINE_COLS = 6
#: Past this many rows a thread turns into a spreadsheet nobody scrolls.
MAX_INLINE_ROWS = 10
#: How much of an oversized grid to preview.
PREVIEW_ROWS = 5
#: A thread reads two caveats; the rest are in the report.
MAX_CAVEATS = 2


def worth_showing(grid: Optional[Grid]) -> bool:
    """A one-number result is already in the sentence above it (`exhibit.worth_showing`)."""
    return grid is not None and exhibit.worth_showing(grid.columns, grid.rows)


def render_grid_markdown(grid: Grid, *, money_symbol: str = "") -> str:
    """The grid for a thread, by the one table builder — whole when narrow and short, a
    captioned preview when long, a caption alone when wide."""
    if grid.empty:
        return ""
    return exhibit.reader_table(grid.columns, grid.rows, max_cols=MAX_INLINE_COLS,
                                max_rows=MAX_INLINE_ROWS, preview_rows=PREVIEW_ROWS,
                                rest="the full result is in the report",
                                money_symbol=money_symbol).markdown


@dataclass
class SlackSelection:
    text: str
    table: str = ""
    caveats: list[str] = field(default_factory=list)
    grid: Optional[Grid] = None
    chart: Optional[ChartDecision] = None


def figures_line(env: AnswerEnvelope) -> str:
    """The figures the answer rests on, in one line — `label value (note) · …` — as the canvas
    shows them in its figure row. Empty for an answer that stated none."""
    parts = []
    for f in env.figures:
        if not f.value.strip():
            continue
        head = f"{f.label.strip()} {f.value.strip()}".strip()
        parts.append(f"{head} ({f.note.strip()})" if f.note.strip() else head)
    return " · ".join(parts)


def select_for_slack(env: AnswerEnvelope, *, money_symbol: str = "") -> SlackSelection:
    """Headline + the figures line + body + what was left unanswered + the grid once + the top
    caveats. Nothing else. P6 (2026-10-15): the grid is the first result the answer cites,
    captioned by its claim, so a thread reads the exhibit the canvas draws first."""
    text = "\n\n".join(p for p in (env.headline.strip(), figures_line(env), env.body.strip(), env.gaps.strip()) if p)
    if env.error and not text:
        text = f"⚠️ {env.error}"
    grid = env.grid if worth_showing(env.grid) else None
    return SlackSelection(
        text=text,
        table=render_grid_markdown(grid, money_symbol=money_symbol) if grid is not None else "",
        caveats=list(env.caveats[:MAX_CAVEATS]),
        grid=grid,
        chart=env.chart if grid is not None else None,
    )


def slack_message(env: AnswerEnvelope, *, money_symbol: str = "") -> str:
    """One string for a door that posts raw text (`post_as_bot`). Slack renders no
    markdown table, so the grid rides in a fenced block — an encoding, local to this door —
    under the claim the reader takes from it, when the grid is a cited exhibit."""
    sel = select_for_slack(env, money_symbol=money_symbol)
    parts = [sel.text]
    if sel.table:
        caption = (sel.grid.caption or "").strip() if sel.grid is not None else ""
        parts.append((f"{caption}\n" if caption else "") + f"```\n{sel.table}\n```")
    parts.extend(f"⚠️ {c}" for c in sel.caveats)
    return "\n\n".join(p for p in parts if p).strip()


# ── the path an answer took, in words ─────────────────────────────────────────

#: How a question's kind, the engine that answered it and its depth read to a person: the receipt's words
#: (`web/components/WhyThisNumber.tsx`), and the coworker card's (`coworker/plugins/answer-card/src/envelope.js`).
PATH_KIND_WORDS = {"survey": "An open question", "describe": "A figure", "diagnose": "A why", "check": "A check"}
PATH_ENGINE_WORDS = {"analyst": "the analyst", "converse": "the conversation", "quick core": "the quick answer",
                     "deep graph": "the older deep engine"}


def path_words(path: object) -> str:
    """The path an answer took (`provenance.path`), in words — "A why · the analyst · deep" — or '' when no route was
    streamed. A kind or an engine these tables do not know is said as the wire spells it, never dropped."""
    p = path if isinstance(path, dict) else {}
    kind, engine, depth = (str(p.get(k) or "").strip() for k in ("kind", "engine", "depth"))
    return " · ".join(x for x in (PATH_KIND_WORDS.get(kind, kind), PATH_ENGINE_WORDS.get(engine, engine), depth) if x)


# ── Teams ─────────────────────────────────────────────────────────────────────

#: Teams' encodings: a reply reads ten rows and eight columns before it is a spreadsheet.
TEAMS_MAX_COLS = 8
TEAMS_MAX_ROWS = 10
#: The longest statement a reply shows in its SQL block.
TEAMS_SQL_CHARS = 1500


def teams_message(env: AnswerEnvelope, *, money_symbol: str = "", sql: str = "", receipt_id: str = "",
                  rows_in_all: Optional[int] = None) -> str:
    """The answer envelope as Teams markdown, in the order every door reads it: the headline, the figures it rests
    on, the body, what it could not settle, the grid once (under its claim, when it is a cited result), the caveats,
    how it was answered, the questions to ask next — and then, as this door always carried them, the SQL that ran and
    the receipt. Teams shows the record a Slack thread leaves out; the selection is otherwise Slack's. ``rows_in_all``
    is the grid's count when the door was handed fewer rows than it had (`envelope.capped`), said under the table."""
    parts = [p for p in (env.headline.strip(), figures_line(env), env.body.strip(), env.gaps.strip()) if p]
    if not parts:
        parts = [f"⚠️ {env.error}" if env.error else "No answer."]
    grid = env.grid
    if grid is not None and not grid.empty:
        table = exhibit.reader_table(grid.columns, grid.rows, max_cols=TEAMS_MAX_COLS, max_rows=TEAMS_MAX_ROWS,
                                     preview_rows=TEAMS_MAX_ROWS, rest="the rest are not shown here",
                                     money_symbol=money_symbol)
        caption = (grid.caption or "").strip()
        parts.append((f"{caption}\n\n" if caption else "") + table.markdown)
        if rows_in_all and rows_in_all > len(grid.rows) and table.shown == table.total:
            parts.append(f"_… {rows_in_all} rows in all_")
    parts.extend(f"⚠️ {c}" for c in env.caveats)
    path = path_words(env.provenance.path)
    if path:
        parts.append(f"_How it was answered: {path}_")
    if env.follow_ups:
        parts.append("Ask next:\n" + "\n".join(f"- {q}" for q in env.follow_ups))
    statement = sql or (env.provenance.sql[-1] if env.provenance.sql else "")
    if statement:
        parts.append(f"```sql\n{statement[:TEAMS_SQL_CHARS]}\n```")
    receipt = receipt_id or env.provenance.receipt_id
    if receipt:
        parts.append(f"_receipt {receipt}_")
    return "\n\n".join(parts)
