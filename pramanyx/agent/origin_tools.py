"""Stage 2 of the Ask panel (the user, 2026-11-19): the conversation knows the platform and where data comes from.

The question it has to answer well, as the user put it: while designing a dashboard, ask how a table was made, then how
the transformations behind it work, then how its data was brought in — in one conversation. Four reads:

- ``table_dependents`` — what depends on a table (or one column of it): the findings, metrics and Briefings the platform's
  lineage records, and the dashboard cards whose SQL reads it. A dashboard the asker neither keeps nor was shared is
  counted, never named.
- ``table_origin`` — how a table was made, from the three sources the user decided (decision 2): the platform's own record
  of a file or sheet brought in, a dbt manifest's model (its SQL and what it is built from), and the warehouse's query
  history where the organisation allows it. Where none covers a table it says so, and never guesses.
- ``explain_dashboard`` — a dashboard the asker can read: its pages, sections, cards (each with its statement), filters,
  and who it reaches.
- ``explain_definition`` — what a word means here: each current Definition of it, its area, its owner and its standing.

Each is a read, bound to the connection and the asker by closure (as every conversation tool is), and each says what it
did not cover. Nothing here changes anything.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Optional

from pramanyx.agent.tool_loop import ToolSpec

#: Most of each kind a reply lists; the rest are counted.
MOST_LISTED = 25
#: A statement as a reply shows it: enough to read what it does.
SQL_CLIP = 2500
#: Most cards of one dashboard a reply describes.
MOST_CARDS = 30


def _bare(table: str) -> str:
    return str(table or "").strip().strip('"`').split(".")[-1].lower()


def _schema_of(table: str) -> str:
    parts = str(table or "").strip().strip('"`').split(".")
    return parts[-2].lower() if len(parts) >= 2 else ""


def _clip(text: str, most: int = SQL_CLIP) -> str:
    t = str(text or "")
    return t if len(t) <= most else t[:most] + " …(cut)"


# ── what depends on a table ──────────────────────────────────────────────────────────────────────────────────────────

def _reads(sql: str, table: str, dialect: str) -> bool:
    """Whether a statement reads the table by its own name. One whose tables cannot be read is held to every word of it,
    as the sheets' gate holds it: a card listed too many is told; one left out breaks unsaid."""
    from pramanyx.dashboards import queries
    read = queries.tables_of(sql or "", dialect) or re.findall(r"[a-z_][a-z0-9_]*", (sql or "").lower())
    return _bare(table) in read


def dashboards_reading(connection_id: str, table: str, person: str, dialect: str = "duckdb") -> dict:
    """The dashboards holding a card whose statement reads ``table``, as ``person`` may know them: their own and those
    shared with them by title and card, every other one counted with its titles withheld."""
    from pramanyx.cards.store import list_cards
    from pramanyx.dashboards import sharing as dashboard_sharing
    from pramanyx.dashboards import versions
    from pramanyx.dashboards.home import NOBODY_IN_PARTICULAR, owner_of
    from pramanyx.kernel.ledger import Ledger

    reading = {c.id: c for c in list_cards(connection_id=connection_id)
               if not c.provenance.superseded_by and c.sql and _reads(c.sql, table, dialect)}
    shown, withheld = [], 0
    if reading:
        for row in Ledger.default().artifacts_of_kind(versions.KIND, conn_id=connection_id, limit=1000):
            payload = row.get("payload") if versions.is_mine(row) else None
            if not payload or payload.get("retired"):
                continue
            held = [reading[i] for i in payload.get("cards") or [] if i in reading]
            if not held:
                continue
            owner = owner_of(str(row.get("natural_key") or ""), connection_id)
            yours = owner == person
            if yours or dashboard_sharing.reaches(payload.get("published_to"), dashboard_sharing.audience_of(person)):
                shown.append({"dashboard": versions.title_of(payload.get("spec")), "yours": yours,
                              "owner": "" if owner in ("", NOBODY_IN_PARTICULAR) else owner,
                              "cards": [c.title for c in held][:MOST_LISTED]})
            else:
                withheld += 1
    return {"dashboards": shown[:MOST_LISTED], "more_dashboards": max(0, len(shown) - MOST_LISTED),
            "dashboards_not_yours": withheld, "cards_reading": len(reading)}


def table_dependents(connection_id: str, args: dict, *, person: str = "") -> dict:
    """What depends on one table, or one column of it."""
    table = str(args.get("table") or "").strip()
    column = str(args.get("column") or "").strip() or None
    if not table:
        return {"found": False, "summary": "Nothing looked up: name the table."}
    from pramanyx.govern.lineage import dependents_of_table
    report = dependents_of_table(connection_id, table, column=column)
    lineage = [d.to_dict() for d in report.dependents]
    try:
        from pramanyx.dashboards.queries import dialect_of
        from pramanyx.db.connection import open_connection_for
        dialect = dialect_of(open_connection_for(connection_id))
    except Exception:  # noqa: BLE001 — the dialect only sharpens the reading of a statement; the default reads most
        dialect = "duckdb"
    try:
        boards = dashboards_reading(connection_id, table, person, dialect)
    except Exception as exc:  # noqa: BLE001 — a store that cannot be read is said, never posed as nothing reading it
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "table_dependents: the dashboards could not be read", counter="origin_tools.dashboards_unread")
        boards = {"unavailable": "The dashboards could not be read, so the cards over this table are not listed."}
    counts = dict(report.counts_by_kind)
    said = [f"{n} {k}{'' if n == 1 else 's'}" for k, n in sorted(counts.items())]
    if boards.get("cards_reading"):
        said.append(f"{boards['cards_reading']} dashboard card{'' if boards['cards_reading'] == 1 else 's'}")
    return {
        "table": table, "column": column,
        "lineage": {"dependents": lineage[:MOST_LISTED], "more": max(0, len(lineage) - MOST_LISTED),
                    "counts_by_kind": counts, "truncated": report.truncated},
        "dashboard_cards": boards,
        "summary": (f"{', '.join(said)} depend on {table}{'.' + column if column else ''}." if said
                    else f"Nothing the platform records depends on {table}{'.' + column if column else ''}."),
        "covers": ("the findings, metrics and Briefings the platform's lineage records (a column is traced where their "
                   "statements were), and dashboard cards whose statement reads the table (by table, not column)"),
        "does_not_cover": "anything outside Pramanyx that reads the table: other tools, reports and pipelines",
    }


# ── how a table was made ─────────────────────────────────────────────────────────────────────────────────────────────

def _from_sheets(table: str) -> list[dict]:
    """A sheet whose table this is: the file it came from, the rows it was kept from, or that it was started blank. A
    sheet not shared with the asker (as the sheets' sharing knows them) is said to exist, and nothing more."""
    from pramanyx.sheets import model
    from pramanyx.sheets.sharing import NotShared, acting, require
    person = acting()
    out = []
    for sheet in model.list_sheets():
        if sheet.table.lower() != _bare(table):
            continue
        try:
            require(sheet, person)
        except NotShared:
            out.append({"source": "a sheet", "withheld": True,
                        "said": "A sheet not shared with you is this table; who made it can share it."})
            continue
        src = sheet.source
        made = {"source": "a sheet", "sheet": sheet.name, "made_by": sheet.created_by.removeprefix("user:"),
                "made_at": sheet.created_at, "brought_in_as": src.kind}
        if src.kind == "file":
            made.update({"file": src.file, "tab": src.tab, "rows": src.rows, "imported_at": src.imported_at,
                         "sha256": src.sha256[:12], "uploaded_from": src.upload or None})
        elif src.kind == "rows":
            made.update({"kept_from_sql": _clip(src.sql), "ran_on": src.connection_id, "schema": src.schema_name})
        out.append(made)
    return out


def _from_uploads(connection_id: str, table: str) -> tuple[list[dict], str]:
    """A file brought in through the platform that became this table, from the connection's own record of it."""
    from pramanyx.db.connection import open_connection_for
    try:
        db = open_connection_for(connection_id)
    except KeyError:
        return [], "the connection could not be opened"
    if not hasattr(db, "list_files"):
        return [], "this connection holds no files brought in through the platform"
    schema = _schema_of(table)
    out = []
    for f in db.list_files():
        if str(f.get("table_name") or "").lower() != _bare(table):
            continue
        if schema and str(f.get("schema") or "").lower() not in ("", schema):
            continue
        out.append({"source": "a file brought in", "file": f.get("source_file") or f.get("filename"),
                    "format": f.get("format") or f.get("extension"), "schema": f.get("schema"),
                    "brought_in_at": f.get("created_at"), "size_bytes": f.get("size_bytes"),
                    "who": "not recorded: a file's upload does not keep who brought it"})
    return out, ""


def _manifest() -> Optional[dict]:
    path = os.getenv("PRAMANYX_DBT_MANIFEST")
    if not path or not Path(path).exists():
        return None
    return json.loads(Path(path).read_text())


def dbt_model_of(manifest: dict, table: str) -> list[dict]:
    """The dbt models and sources that materialise as ``table`` (by alias or name, and schema when one is named): what
    each is, its SQL as written and as compiled, and what it is built from."""
    nodes = {**(manifest.get("nodes") or {}), **(manifest.get("sources") or {})}

    def name_of(uid: str) -> str:
        n = nodes.get(uid) or {}
        leaf = n.get("alias") or n.get("identifier") or n.get("name") or uid.split(".")[-1]
        return f"{n.get('schema')}.{leaf}" if n.get("schema") else str(leaf)

    want, schema = _bare(table), _schema_of(table)
    out = []
    for uid, n in nodes.items():
        if n.get("resource_type") not in ("model", "seed", "snapshot", "source"):
            continue
        leaf = str(n.get("alias") or n.get("identifier") or n.get("name") or "").lower()
        if leaf != want or (schema and str(n.get("schema") or "").lower() not in ("", schema)):
            continue
        parents = list((n.get("depends_on") or {}).get("nodes") or [])
        out.append({
            "source": "a dbt " + str(n.get("resource_type")), "unique_id": uid, "name": n.get("name"),
            "schema": n.get("schema"), "materialized": (n.get("config") or {}).get("materialized"),
            "description": _clip(n.get("description") or "", 600),
            "sql_as_written": _clip(n.get("raw_code") or n.get("raw_sql") or ""),
            "sql_as_compiled": _clip(n.get("compiled_code") or n.get("compiled_sql") or ""),
            "built_from": [{"unique_id": p, "table": name_of(p), "kind": (nodes.get(p) or {}).get("resource_type")}
                           for p in parents][:MOST_LISTED],
            "loaded_by": (n.get("loader") or "") if n.get("resource_type") == "source" else "",
        })
    return out


def table_origin(connection_id: str, args: dict, *, person: str = "") -> dict:
    """How one table was made, as far as the decided sources reach — and plainly where they stop."""
    table = str(args.get("table") or "").strip()
    if not table:
        return {"found": False, "summary": "Nothing looked up: name the table."}
    found: list[dict] = []
    checked: list[str] = []
    if connection_id == "sheets":
        try:
            found += _from_sheets(table)
        except Exception as exc:  # noqa: BLE001 — said as unread, never as no sheet
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "table_origin: the sheets could not be read", counter="origin_tools.sheets_unread")
            checked.append("the sheets could not be read")
    try:
        uploads, why = _from_uploads(connection_id, table)
        found += uploads
        if why:
            checked.append(why)
    except Exception as exc:  # noqa: BLE001
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "table_origin: the files brought in could not be read", counter="origin_tools.uploads_unread")
        checked.append("the record of files brought in could not be read")
    try:
        manifest = _manifest()
        if manifest is None:
            checked.append("no dbt manifest is configured")
        else:
            models = dbt_model_of(manifest, table)
            found += models
            if not models:
                checked.append("the dbt manifest has no model, seed, snapshot or source for this table")
    except Exception as exc:  # noqa: BLE001 — a manifest that cannot be read is said, never posed as no model
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "table_origin: the dbt manifest could not be read", counter="origin_tools.manifest_unread")
        checked.append("the dbt manifest is configured but could not be read")
    from pramanyx.orgsettings.allows import allows
    history = ("The warehouse's query history is read for the questions asked of the warehouse (its SELECT "
               "statements), not for the statements that create or fill tables, so it cannot say how this one was made."
               if allows("read_query_history")
               else "The organisation does not allow reading the warehouse's query history (an admin's setting).")
    return {
        "table": table, "found": bool(found), "origins": found,
        "not_covered": checked + [history,
                                  "Pipelines run outside Pramanyx (Airflow, Fivetran, warehouse tasks) are not read."],
        "summary": (f"{len(found)} record{'' if len(found) == 1 else 's'} of how {table} was made."
                    if found else f"No source the platform reads says how {table} was made."),
    }


# ── a dashboard, a Definition ────────────────────────────────────────────────────────────────────────────────────────

def explain_dashboard(connection_id: str, args: dict, *, person: str = "") -> dict:
    """A dashboard the asker keeps, by its id or its title: its pages, sections, cards (each with its statement),
    filters, and who it reaches. Another person's is read only where it was published to the asker."""
    from pramanyx.cards.store import get_card
    from pramanyx.dashboards import versions
    want = str(args.get("dashboard") or "").strip()
    mine = [d for d in versions.of_person(connection_id, person) if not d.get("retired")]
    if not want:
        return {"found": False, "dashboards": [{"id": d["dashboard_id"], "title": d["title"]} for d in mine][:MOST_LISTED],
                "summary": "Name the dashboard, by its id or its title."}
    hit = next((d for d in mine if d["dashboard_id"] == want), None) or next(
        (d for d in mine if str(d["title"]).strip().lower() == want.lower()), None)
    if hit is None:
        return {"found": False, "dashboards": [{"id": d["dashboard_id"], "title": d["title"]} for d in mine][:MOST_LISTED],
                "summary": f"None of your dashboards on this connection is {want!r}."}
    from pramanyx.agent.ask_subject import dashboard_spec
    spec, why = dashboard_spec(connection_id, hit["dashboard_id"], "", person)
    if spec is None:
        return {"found": False, "summary": why}
    elements = spec.get("elements") or {}
    pages, sections, filters, cards = [], [], [], []
    for el in elements.values():
        if not isinstance(el, dict):
            continue
        props = el.get("props") or {}
        kind = el.get("type")
        if kind == "Tab":
            pages.append(str(props.get("label") or props.get("name") or ""))
        elif kind == "Section":
            sections.append(str(props.get("title") or ""))
        elif kind == "GlobalFilter":
            filters.append({"title": props.get("title") or props.get("column"), "table": props.get("table"),
                            "column": props.get("column"), "type": props.get("type") or props.get("op")})
        elif kind == "Card" and props.get("card") and len(cards) < MOST_CARDS:
            card = get_card(str(props["card"]))
            if card is not None:
                render = card.render or {}
                shown = render.get("shown") if isinstance(render, dict) else None
                cards.append({"title": str(props.get("title") or card.title),
                              "drawn_as": (render.get("viz") or {}).get("type") if isinstance(render.get("viz"), dict) and (render.get("viz") or {}).get("type")
                              else (shown or {}).get("as") if isinstance(shown, dict) else card.kind,
                              "own_query": bool(shown), "sql": _clip(card.sql or "", 1200),
                              "not_cut_by_filters": props.get("not_filtered") is True})
    return {
        "found": True, "id": hit["dashboard_id"], "title": hit["title"], "version": hit.get("version"),
        "kept_at": hit.get("kept_at"), "published_to": hit.get("published_to") or [],
        "pages": [p for p in pages if p], "sections": [s for s in sections if s], "filters": filters, "cards": cards,
        "more_cards": max(0, sum(1 for e in elements.values() if isinstance(e, dict) and e.get("type") == "Card") - len(cards)),
        "summary": (f"{hit['title']}: {len(cards)} card{'' if len(cards) == 1 else 's'}"
                    f"{f' on {len(pages)} pages' if len(pages) > 1 else ''}, {len(filters)} filter{'' if len(filters) == 1 else 's'}."),
    }


def explain_definition(connection_id: str, args: dict) -> dict:
    """What a word means on this connection: each current Definition of it, the area it holds in, its owner and standing."""
    from pramanyx.record import writers
    term = str(args.get("term") or "").strip()
    if not term:
        return {"found": False, "summary": "Name the word."}
    claims = writers.definitions_of(connection_id, term)
    if not claims:
        known = sorted({str(c.extra.get("term") or "") for c in writers.definitions(connection_id, limit=200)} - {""})
        return {"found": False, "term": term, "known_terms": known[:MOST_LISTED],
                "summary": f"No Definition of {term!r} on this connection."}
    return {
        "found": True, "term": term,
        "definitions": [{"means": c.statement.text if hasattr(c.statement, "text") else str(c.statement),
                         "area": c.extra.get("area") or "", "owner": c.owner or "unresolved", "status": c.status,
                         "version": c.version, "recorded_at": c.recorded_at} for c in claims][:MOST_LISTED],
        "summary": f"{len(claims)} current Definition{'' if len(claims) == 1 else 's'} of {term!r}.",
    }


# ── the tools ────────────────────────────────────────────────────────────────────────────────────────────────────────

_TABLE = {"type": "object", "properties": {
    "table": {"type": "string", "description": "The table, by its name as the schema shows it (schema.table or table)."},
}, "required": ["table"]}
_TABLE_COLUMN = {"type": "object", "properties": {
    "table": {"type": "string", "description": "The table, by its name as the schema shows it (schema.table or table)."},
    "column": {"type": "string", "description": "One column of it, to ask what depends on that column only. Optional."},
}, "required": ["table"]}


def origin_tools(connection_id: str, *, person: str = "") -> list[ToolSpec]:
    """The conversation's reads of where data comes from and what the platform holds over it (Stage 2)."""
    return [
        ToolSpec(
            name="table_dependents",
            description=(
                "What depends on ONE table, or one column of it: the findings, metrics and Briefings the platform's "
                "lineage records, and the dashboards whose cards read it. Use it for 'what uses this table', 'what "
                "breaks if this column changes', 'which cards read it'. Say what it does not cover."),
            parameters=_TABLE_COLUMN,
            run=lambda a: table_dependents(connection_id, a, person=person),
        ),
        ToolSpec(
            name="table_origin",
            description=(
                "How ONE table was made: the file or sheet it was brought in from (who, when, which file), the dbt "
                "model that builds it (its SQL and the tables it is built from — call again on those to go further "
                "back), and what the warehouse's query history can say. Use it for 'where does this table come from', "
                "'how was it made', 'what does its transformation do'. Where it found nothing, say so plainly and "
                "name what was not covered; never guess a table's history."),
            parameters=_TABLE,
            run=lambda a: table_origin(connection_id, a, person=person),
        ),
        ToolSpec(
            name="explain_dashboard",
            description=(
                "One of the person's dashboards on this connection, by id or title: its pages, sections, filters and "
                "cards, each card with what it is drawn as and the SQL it reads. Called with no dashboard, it lists "
                "their dashboards. Use it to explain a dashboard or to find which card reads what."),
            parameters={"type": "object", "properties": {
                "dashboard": {"type": "string", "description": "The dashboard's id or its title."}}},
            run=lambda a: explain_dashboard(connection_id, a, person=person),
        ),
        ToolSpec(
            name="explain_definition",
            description=(
                "What a word means on this connection: each current Definition of it (the business's own meaning, "
                "per area), with its owner and standing. Use it when a question turns on what a term like 'active "
                "customer' means here."),
            parameters={"type": "object", "properties": {
                "term": {"type": "string", "description": "The word or phrase, as the person wrote it."}},
                "required": ["term"]},
            run=lambda a: explain_definition(connection_id, a),
        ),
    ]
