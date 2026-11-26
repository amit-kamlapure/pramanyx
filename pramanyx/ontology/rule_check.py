"""Does a statement keep to a business rule the question's frame declared? — the deep analyst's check, shared with the
quick answer path (the grounding audit, 2026-11-26: only the analyst refused a statement that read a declared rule off
another table; the quick path and the conversation had the rule as prompt text alone).

Q3 (2026-10-03): the frame read "completed orders" as rule completed_orders — orders.status in ('Complete') — and the
analyst's second query filtered order_items.status = 'Complete', dated by the items. A statement that filters the
rule's own table too keeps to it; a column it cannot place is left alone. Deterministic; the statement and the frame.
"""
from __future__ import annotations


def rule_misread(frame: dict, sql: str, dialect: str = "") -> str:
    """Why ``sql`` reads a rule ``frame`` declared off another table, or ""."""
    frame = frame or {}
    start = frame.get("start") or {}
    table = str(start.get("table") or "").split(".")[-1].lower()
    rules = [r for r in frame.get("rules") or [] if r.get("usable") and r.get("entity") == start.get("entity")]
    if not sql or not table or not rules:
        return ""
    try:
        import sqlglot
        from sqlglot import exp
        tree = sqlglot.parse_one(sql, read=dialect or None)
    except Exception:                     # noqa: BLE001 — a statement that does not parse is the guards' to refuse
        return ""
    ctes = {c.alias_or_name.lower() for c in tree.find_all(exp.CTE)}

    def table_of(col) -> str:
        sel = col.find_ancestor(exp.Select)
        tables = [t for t in (sel.find_all(exp.Table) if sel else []) if t.find_ancestor(exp.Select) is sel
                  and t.name.lower() not in ctes]
        if col.table:
            return next((t.name.lower() for t in tables if t.alias_or_name.lower() == col.table.lower()), "")
        return tables[0].name.lower() if len(tables) == 1 else ""

    for r in rules:
        for f in r.get("filters") or []:
            path, values = str(f.get("path") or ""), {str(v).lower() for v in f.get("values") or []}
            if not path or "." in path or not values:
                continue
            on: set = set()
            for node in [*tree.find_all(exp.EQ), *tree.find_all(exp.In)]:
                col = node.this if isinstance(node.this, exp.Column) else None
                lits = list(node.expressions) if isinstance(node, exp.In) else [node.expression]
                if col is not None and col.name.lower() == path.lower() and any(
                        isinstance(v, exp.Literal) and v.is_string and v.this.lower() in values for v in lits):
                    on.add(table_of(col))
            others = sorted(on - {"", table})
            if others and table not in on:
                listed = ", ".join(f"'{v}'" for v in f.get("values") or [])
                return (f'This statement filters {others[0]}.{path}, but the question\'s "{r.get("matched") or r.get("label")}" '
                        f"is the declared rule {r.get('id')}: {table}.{path} in ({listed}) — {r.get('words')}. Filter "
                        f"{table}.{path} (join {table} if the measure lives on another table) and run it again.")
    return ""


