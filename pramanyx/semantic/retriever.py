"""Schema vector index — built from the glossary, one point per table and column.

Its reader (retrieval of the relevant tables per hypothesis) belonged to the retired graph
engine and was removed with it; the index is still built after a schema load.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

SCHEMA_COLLECTION = "pramanyx_schema"


def scope_key(connection_id: str | None = "", schema_name: str | None = "") -> str:
    """Which connection+schema a point belongs to. ``""`` when neither is known.

    One collection holds every scope's points, and until this existed they carried no
    owner at all: point ids were ``{table}.{column}``, so two connections that both have
    ``analytics.orders`` wrote the SAME point and the later index silently replaced the
    earlier one's embedding — retrieval for one connection then ranked by the other's
    descriptions. Searches were unfiltered too, so foreign tables consumed top-k slots and
    were dropped later by the schema filter, quietly returning fewer tables than asked for.
    """
    conn = (connection_id or "").strip()
    sch = (schema_name or "").strip()
    return f"{conn}|{sch}" if (conn or sch) else ""


# ── Index building ────────────────────────────────────────────────────────────

def build_schema_index(path=None, connection_id: str = "", schema_name: str = "") -> int:
    """
    Embed all table/column entries from the merged glossary and upsert to Qdrant.
    Called after every schema load so the index stays fresh.
    Returns the number of points indexed, 0 on failure.

    ``connection_id`` / ``schema_name`` stamp each point with its owner so one
    connection's index can neither overwrite nor answer for another's.
    """
    try:
        return _build(path, scope_key(connection_id, schema_name), connection_id)
    except Exception:
        return 0


def _build(path=None, scope: str = "", connection_id: str = "") -> int:
    from pramanyx.semantic.glossary import load_merged_glossary
    from pramanyx.semantic.embedder import embed
    from pramanyx.semantic.vector_store import ensure_collection, upsert

    tables = load_merged_glossary(path, connection_id=connection_id or None).get("tables", {})   # its words only
    if not tables:
        return 0

    texts: list[str] = []
    metas: list[dict] = []

    for table_name, meta in tables.items():
        # Table-level point: description + grain
        t_text = f"{table_name}: {meta.get('description', table_name)}"
        if meta.get("grain"):
            t_text += f". Grain: {meta['grain']}"
        texts.append(t_text)
        metas.append({"type": "table", "table": table_name, "scope": scope})

        # Column-level points
        for col_name, col_meta in (meta.get("columns") or {}).items():
            c_text = f"{table_name}.{col_name}: {col_meta.get('description', col_name)}"
            if col_meta.get("values"):
                c_text += f". Values: {col_meta['values']}"
            texts.append(c_text)
            metas.append({"type": "column", "table": table_name,
                          "column": col_name, "scope": scope})

    if not texts:
        return 0

    ensure_collection(SCHEMA_COLLECTION)
    vectors = embed(texts)
    points = [
        {
            # Scope leads the id: without it two connections holding the same qualified
            # table name resolved to one point, so indexing either overwrote the other.
            "id": f"{scope}|{m['table']}.{m.get('column', '__table__')}",
            "vector": v,
            "payload": m,
        }
        for m, v in zip(metas, vectors)
    ]
    upsert(SCHEMA_COLLECTION, points)
    return len(points)
