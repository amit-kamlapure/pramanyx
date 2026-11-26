"""The metric-views plan's M0 (`docs/METRIC_VIEWS_PLAN_2026-11-25.md` §6; the user, 2026-11-26: "Yes, start M0"): the
three defects checked by hand.

1. An answer's governed metrics were read from EVERY connection's catalog, then de-duplicated by name — so where two
   connections define a name their own way, the last one in the store was the one used (live, 2026-11-26: seven names
   on more than one connection, `units_sold` theLook's `COUNT(id)` and LuxExperience's `SUM(oi.quantity)`).
2. The coworker's `get_metric` took the first metric of a name from the whole registry, whatever connection it was given.
3. The owner list read a metric's `connection_id`; the field is `connection`, so every metric's owner was listed with
   no connection — and it listed every organisation's metrics.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace as NS

import pytest

import pramanyx.semantic.metrics as M

THELOOK, LUX = "c_thelook_m0", "c_lux_m0"

#: Lux's first, theLook's last: a name de-duplicated across connections keeps the LAST, so Lux was handed theLook's.
ROWS = [
    {"name": "units_sold", "label": "Units sold", "sql": "SUM(quantity)", "connection": LUX, "tables": ["order_items"],
     "status": "approved", "owner": "Bo (merch)"},
    {"name": "units_sold", "label": "Units sold", "sql": "COUNT(id)", "connection": THELOOK, "tables": ["order_items"],
     "status": "approved", "owner": "Ana (ops)"},
    {"name": "line_count", "label": "Lines", "sql": "COUNT(order_id)", "connection": "*", "tables": ["order_items"],
     "status": "approved", "owner": "Data team"},
    {"name": "elsewhere", "label": "Elsewhere", "sql": "COUNT(id)", "connection": "org:another", "tables": ["order_items"],
     "status": "approved", "owner": "Cy (another org)"},
]
#: One schema both formulas can run on, so the schema filter keeps both and only the connection can tell them apart.
SCHEMA = "TABLE: order_items\n  id  INTEGER\n  order_id  INTEGER\n  quantity  INTEGER\n  sale_price  FLOAT\n"


@pytest.fixture
def store(monkeypatch):
    monkeypatch.setattr(M, "_load_raw", lambda path=None: [dict(r) for r in ROWS])
    return monkeypatch


def _sql_of(metrics, name: str) -> list[str]:
    return [getattr(m, "sql", None) for m in metrics if getattr(m, "name", getattr(m, "key", None)) == name]


def test_the_schema_filter_alone_cannot_tell_the_two_apart(store):
    # the premise: both formulas run on this schema, so before M0 the name dedupe chose between connections
    kept = M.filter_metrics_to_schema(M.list_metrics(), SCHEMA, dedupe=False)
    assert sorted(_sql_of(kept, "units_sold")) == ["COUNT(id)", "SUM(quantity)"]


def test_an_answers_governed_metrics_are_its_connections_own(store):
    from pramanyx.semantic.canonical import resolve_contracts
    for conn, sql in ((LUX, "SUM(quantity)"), (THELOOK, "COUNT(id)")):
        got = resolve_contracts(conn, ontology=NS(metrics={}), schema_text=SCHEMA)
        assert [c.sql for c in got if c.key == "units_sold"] == [sql], conn
        keys = {c.key for c in got}
        assert "line_count" in keys, "a global definition still applies to every connection"
        assert "elsewhere" not in keys, "another organisation's definition never does"


def test_the_semantic_context_reads_the_connections_own_metrics(store):
    from pramanyx.semantic.context import resolve
    for conn, sql in ((LUX, "SUM(quantity)"), (THELOOK, "COUNT(id)")):
        got = resolve("How many units sold?", conn, schema_text=SCHEMA).metrics
        assert _sql_of(got, "units_sold") == [sql], conn
        assert "line_count" in {m.name for m in got} and "elsewhere" not in {m.name for m in got}


class _Client:
    """The coworker's client with the API stood in: `/metrics` answers as the route does, scoped when asked."""

    def __init__(self):
        from pramanyx.mcp.client import PramanyxClient
        self.inner = PramanyxClient.__new__(PramanyxClient)
        self.asked: list[tuple[str, dict]] = []

        async def _get(path, params=None):
            self.asked.append((path, dict(params or {})))
            if path == "/metrics":
                conn = (params or {}).get("connection_id")
                rows = [r for r in ROWS if not conn or r["connection"] in (conn, "*")]
                return [dict(r) for r in rows]
            if path.endswith("/value"):
                return {"value": 7, "unit": None, "sql": "…"}
            raise AssertionError(path)
        self.inner._get = _get


def test_the_coworkers_get_metric_reads_the_connection_it_was_given():
    c = _Client()
    got = asyncio.run(c.inner.get_metric(connection=LUX, name="units_sold"))
    assert got["definition"]["sql"] == "SUM(quantity)" and got["value"] == 7
    assert c.asked[0] == ("/metrics", {"connection_id": LUX})
    listed = asyncio.run(c.inner.get_metric(connection=THELOOK))
    assert sorted(m["name"] for m in listed["metrics"]) == ["line_count", "units_sold"]


def test_a_name_on_more_than_one_connection_is_said_not_guessed():
    from pramanyx.mcp.client import PramanyxError
    c = _Client()
    with pytest.raises(PramanyxError, match=r"units_sold.*more than one connection.*c_lux_m0.*c_thelook_m0.*connection"):
        asyncio.run(c.inner.get_metric(name="units_sold"))
    assert asyncio.run(c.inner.get_metric(name="line_count"))["definition"]["connection"] == "*"


def test_the_owner_list_names_each_metrics_connection_and_only_this_organisations(store, monkeypatch):
    import pramanyx.agent.framing as F
    import pramanyx.semantic.glossary as G
    from pramanyx.rbac import owners as OW
    monkeypatch.setattr(G, "load_glossary", lambda path=None, **k: {"tables": {}})
    monkeypatch.setattr(F, "served_graph", lambda cid, schema=None: None)
    inv = {e["owner_key"]: e["uses"] for e in OW.owner_inventory("default", connection_ids=[LUX])}
    assert inv["bo (merch)"] == [{"kind": "metric", "id": "units_sold", "connection_id": LUX}]
    assert inv["data team"] == [{"kind": "metric", "id": "line_count", "connection_id": ""}], "a global one is every connection's"
    assert "ana (ops)" not in inv, "a connection not in view is not listed"
    assert "cy (another org)" not in inv, "another organisation's is never listed"
