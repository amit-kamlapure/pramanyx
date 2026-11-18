"""A dashboard as a file (the dashboards study's R22): written out as JSON, and read back into a connection.

The file holds the spec and the cards it places, each with where it came from. Reading one back is all or nothing: every card
must say where it came from, every table it reads must be on this connection, and every metric, image, question or sheet the
dashboard names must resolve here. What does not is refused by name and nothing is made. A value a card last read never travels:
the cards read their own rows again where they land.
"""
from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pramanyx.dashboards.home import Home, new_id

FORMAT = "pramanyx.dashboard"
FORMAT_VERSION = 1
#: The most cards a file may bring: as many as a dashboard may place, with room for a person's own limits to say the rest.
MAX_CARDS = 200
#: What a card's source may be (`cards.models.StoredCard.source`).
SOURCES = ("insight", "query_builder", "authored", "watch")


def _placed(spec: dict) -> list[str]:
    seen: list[str] = []
    for el in (spec.get("elements") or {}).values():
        card = str(((el or {}).get("props") or {}).get("card") or "") if isinstance(el, dict) and el.get("type") == "Card" else ""
        if card and card not in seen:
            seen.append(card)
    return seen


def export_of(home: Home) -> Optional[dict]:
    """The dashboard as it stands, as a file's contents; None when there is none to write out."""
    from pramanyx.dashboards import cards, versions

    kept = versions.latest(home)
    if kept is None or kept.get("retired") or not kept.get("spec"):
        return None
    held = {c.id: c for c in cards.cards_of(home)}
    written = []
    for card_id in _placed(kept["spec"]):
        card = held.get(card_id)
        if card is None:
            continue
        written.append({"id": card.id, "title": card.title, "kind": card.kind, "source": card.source, "sql": card.sql,
                        "render": card.render, "thresholds": card.thresholds, "body": card.body,
                        "provenance": card.provenance.model_dump(mode="json"), "shared": card.scope != cards.OWN})
    return {"format": FORMAT, "format_version": FORMAT_VERSION, "exported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "title": versions.title_of(kept["spec"]) or home.cockpit_id,
            "from": {"connection": home.connection_id, "dashboard": home.cockpit_id, "version": kept.get("version")},
            "spec": kept["spec"], "cards": written}


def _tables_here(connection_id: str) -> Optional[tuple[set[str], str]]:
    """Every table this connection holds, by its bare name and as ``schema.table``, and the dialect it speaks; None when they
    cannot be read."""
    from pramanyx.db.connection import open_connection_for
    from pramanyx.db.schema_render import sqlglot_schema
    from pramanyx.kernel.errors import tolerate
    from pramanyx.routers._shared import get_schema_cached

    try:
        db = open_connection_for(connection_id)
    except Exception as exc:  # noqa: BLE001 — said as a refusal: a file is never read in unchecked
        tolerate(exc, "a dashboard file could not be checked against its connection", counter="dashboard.import_schema")
        return None
    try:
        schema = sqlglot_schema(get_schema_cached(connection_id, db)) or {}
        dialect = str(getattr(db, "dialect", "") or "duckdb")
    except Exception as exc:  # noqa: BLE001 — as above
        tolerate(exc, "a dashboard file could not read its connection's tables", counter="dashboard.import_schema")
        return None
    finally:
        try:
            db.close()
        except Exception as exc:  # noqa: BLE001
            tolerate(exc, "a connection did not close after a dashboard file was checked", counter="dashboard.db_close")
    return _names_in(schema), dialect


def _names_in(schema: dict, prefix: str = "") -> set[str]:
    """``{table: {column: type}}``, however deep its schemas nest, as bare and qualified names in lower case."""
    out: set[str] = set()
    for name, held in schema.items():
        said = f"{prefix}{name}".lower()
        if isinstance(held, dict) and held and all(isinstance(v, dict) for v in held.values()):
            out |= _names_in(held, f"{said}.")
        else:
            out |= {said, said.split(".")[-1], ".".join(said.split(".")[-2:])}
    return out


def _unread_tables(sql: str, here: set[str], dialect: str = "duckdb") -> list[str]:
    from pramanyx.semantic.metric_statement import statement_tables

    flat = not any("." in h for h in here)                  # a connection of bare tables: a schema a statement names is its own
    wanted = [str(t).replace('"', "").replace("`", "").lower() for t in statement_tables(sql, dialect)]
    return sorted({t for t in wanted if (t.split(".")[-1] if flat else ".".join(t.split(".")[-2:])) not in here})


def _metric_here(get_metric: Any, name: str, connection_id: str) -> Any:
    """The metric of that name on this connection, or None: one that cannot be read is one not to build on."""
    try:
        return get_metric(name, connection_id=connection_id)
    except Exception:  # noqa: BLE001 — refused by name by the caller
        return None


def problems(doc: Any, connection_id: str) -> list[str]:
    """Every reason this file cannot be read into this connection, each naming what it is about."""
    from pramanyx.dashboards import cards as held_cards
    from pramanyx.dashboards import images
    from pramanyx.semantic.metrics import get_metric

    if not isinstance(doc, dict) or doc.get("format") != FORMAT:
        return ["This is not a dashboard file: it does not say it is one."]
    if doc.get("format_version") != FORMAT_VERSION:
        return [f"This file is format {doc.get('format_version')}, and this platform reads format {FORMAT_VERSION}."]
    spec, listed = doc.get("spec"), doc.get("cards")
    if not isinstance(spec, dict) or not isinstance(spec.get("elements"), dict) or not isinstance(listed, list):
        return ["This file holds no dashboard to read."]
    if len(listed) > MAX_CARDS:
        return [f"This file brings {len(listed):,} cards, and a dashboard takes at most {MAX_CARDS:,}."]
    read = _tables_here(connection_id)
    if read is None:
        return ["This connection's tables could not be read, so the file cannot be checked against them. Nothing was made."]
    here, dialect = read
    said: list[str] = []
    brought = {str(c.get("id")): c for c in listed if isinstance(c, dict)}
    on_connection = {c.id for c in held_cards.shared(connection_id)}
    for card_id in _placed(spec):
        card = brought.get(card_id)
        if card is None:
            if card_id not in on_connection:
                said.append(f"The dashboard places a card ({card_id}) that the file does not hold and this connection does not have.")
            continue
        name = str(card.get("title") or card_id)
        if card.get("shared") and card_id in on_connection:
            continue
        if card.get("source") not in SOURCES or not isinstance(card.get("provenance"), dict):
            said.append(f'The card "{name}" does not say where it came from.')
            continue
        metric = str((card.get("provenance") or {}).get("metric") or "").strip()
        if metric and _metric_here(get_metric, metric, connection_id) is None:
            said.append(f'The card "{name}" is made from the metric {metric}, which this connection does not have.')
        missing = _unread_tables(str(card.get("sql") or ""), here, dialect) if str(card.get("sql") or "").strip() else []
        if missing:
            said.append(f'The card "{name}" reads {", ".join(missing)}, which this connection does not have.')
    said.extend(images.not_held(connection_id, spec))
    moved = str((doc.get("from") or {}).get("connection") or "") != connection_id
    for el in spec["elements"].values():
        kind = el.get("type") if isinstance(el, dict) else ""
        if moved and kind == "Question":
            said.append(f'The question "{(el.get("props") or {}).get("first") or "on this dashboard"}" belongs to the connection it was asked on.')
        if moved and kind == "AddRow":
            said.append("The dashboard adds rows to a sheet of the connection it came from.")
    return said


def import_into(connection_id: str, owner: str, doc: Any, *, approved_by: str) -> dict:
    """Read a file into this person's dashboards: ``{"imported": True, "cockpit_id", "title", "version"}`` or
    ``{"imported": False, "sentences": [...]}`` with nothing made."""
    from pramanyx.cards.models import CardProvenance, StoredCard
    from pramanyx.cards.store import delete_card, upsert_card
    from pramanyx.dashboards import cards as held_cards
    from pramanyx.dashboards import versions
    from pramanyx.dashboards.propose import with_card_ids
    from pramanyx.kernel.errors import tolerate

    title = str((doc or {}).get("title") or "Imported dashboard")[:120] if isinstance(doc, dict) else "Imported dashboard"
    home = Home(connection_id, owner, new_id(title))
    said = problems(doc, connection_id)
    if said:
        return {"imported": False, "sentences": said}
    on_connection = {c.id for c in held_cards.shared(connection_id)}
    ids: dict[str, str] = {}
    made: list[str] = []

    def undo() -> None:
        for cid in made:
            try:
                delete_card(cid)
            except Exception as exc:  # noqa: BLE001
                tolerate(exc, f"an imported card ({cid}) could not be removed again", counter="dashboard.import_undo")

    origin = doc.get("from") or {}
    try:
        for card in doc["cards"]:
            old = str(card.get("id"))
            if old not in _placed(doc["spec"]) or (card.get("shared") and old in on_connection):
                continue
            fresh = upsert_card(StoredCard(
                id=uuid.uuid4().hex[:8], connection_id=connection_id, scope=held_cards.OWN, scope_ref=owner, source=card["source"],
                kind=str(card.get("kind") or "kpi"), title=str(card.get("title") or ""), sql=str(card.get("sql") or ""),
                render=dict(card.get("render") or {}), thresholds=dict(card.get("thresholds") or {}), body=str(card.get("body") or ""),
                provenance=CardProvenance.model_validate(card["provenance"]), links=[f"imported:{old}"], author=owner))
            ids[old] = fresh.id
            made.append(fresh.id)
    except Exception as exc:  # noqa: BLE001 — all or nothing: what was made goes, and the reason is said
        undo()
        tolerate(exc, "a dashboard file could not be read in; what was made was removed", counter="dashboard.import")
        return {"imported": False, "sentences": [f"The file could not be read in: {exc}. Nothing was kept."]}
    kept = versions.keep(home, with_card_ids(copy.deepcopy(doc["spec"]), ids), approved_by=approved_by,
                         source=f'imported from a file of "{title}", version {origin.get("version")} on {origin.get("connection")}',
                         written_by_model=False, stamps_are_ours=True)
    if not kept.kept:
        undo()
        return {"imported": False, "sentences": list(kept.sentences) or ["The dashboard in the file was refused."]}
    return {"imported": True, "cockpit_id": home.cockpit_id, "title": title, "version": kept.version}
