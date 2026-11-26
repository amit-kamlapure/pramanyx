"""The Areas of the business as an agent reads them (the Atlas plan's A8, 2026-11-25): the Atlas's own facts — who answers
for an Area, what is governed in it, what waits in it — trimmed for a question, every count kept, what was not read said;
and the two MCP tools that hand them over, through the API."""
from __future__ import annotations

import asyncio

from pramanyx.mcp import area_views as V

ATLAS = {
    "connections": [{"id": "c1", "name": "theLook"}, {"id": "c2", "name": "PostgreSQL"}],
    "areas": [{"id": "orders_sales", "name": "Orders & sales", "question": "How much did we sell?", "connections": ["c1", "c2"],
               "business_owners": ["user:ana"], "technical_owners": [], "counts": {"metric": 4, "table": 3}, "total": 7,
               "answers": 105, "review": {"gap": 2, "candidate": 8, "conflict": 0}, "learned": 228}],
    "quiet": [{"id": "promotions", "name": "Promotions", "question": ""}],
    "everything_else": {"id": "other", "name": "Everything else", "total": 76, "answers": 12},
    "figures": {"answers": 610, "governed": 120}, "said": ["Not read: what was learned on DuckDB."],
}


def test_every_area_says_who_answers_for_it_what_it_holds_and_what_waits():
    out = V.areas_for_agents(ATLAS)
    [a] = out["areas"]
    assert a["contacts"] == {"business": ["user:ana"], "technical": []}
    assert a["connections"] == ["theLook", "PostgreSQL"], "connections by name, as a person says them"
    assert (a["answers_this_month"], a["holds"], a["learned"]) == (105, {"metric": 4, "table": 3}, 228)
    assert out["hold_nothing_yet"] == ["Promotions"] and out["in_no_area"] == {"things": 76, "answers_this_month": 12}
    assert out["said"] == ["Not read: what was learned on DuckDB."], "what was not read is said, never dropped"


def test_one_area_lists_what_is_governed_the_most_used_first_and_what_waits_the_busiest_first():
    item = lambda n, **k: {"name": n, "state": "approved", "connection_name": "theLook", "certification": None, "use": None, **k}  # noqa: E731
    page = {"area": {"id": "orders_sales", "name": "Orders & sales", "question": "q", "business_owners": [], "technical_owners": ["user:bo"],
                     "connections": ["c1"]},
            "children": [{"id": "returns", "name": "Returns", "total": 2}],
            "kinds": [{"kind": "metric", "title": "Metrics", "count": 12,
                       "items": [item("Revenue", use={"measured": "opens", "count": 3, "answers": 12})]
                       + [item(f"M{n}") for n in range(11)]},
                      {"kind": "table", "title": "Tables", "count": 1, "items": [item("orders", certification={"status": "certified"})]}],
            "said": []}
    review = {"total": 3, "within": ["returns"], "said": ["as read at 10:00"],
              "items": [{"source": "framing_miss", "title": "What is a repeat buyer?", "connection_name": "theLook", "count": 12,
                         "complaints": 0}]}
    out = V.area_for_agents(page, review)
    metrics = out["holds"][0]
    assert metrics["count"] == 12 and len(metrics["first"]) == V.FIRST, "the first few, the count says how many"
    assert metrics["first"][0] == {"name": "Revenue", "state": "approved", "connection": "theLook",
                                   "use_this_month": {"measured": "opens", "count": 3, "answers": 12}}
    assert out["holds"][1]["first"][0]["certification"] == "certified"
    assert out["sub_areas"] == [{"id": "returns", "name": "Returns", "holds": 2}]
    assert out["waiting"]["total"] == 3 and out["waiting"]["first"][0]["weight"] == {"count": 12, "complaints": 0}
    assert out["said"] == ["as read at 10:00"]


def test_the_tools_reach_the_atlas_through_the_api_under_the_caller(monkeypatch):
    from pramanyx.mcp.client import PramanyxClient
    asked = []

    async def get(self, path, params=None):
        asked.append((path, params))
        if path == "/discover/atlas":
            return ATLAS
        if path.startswith("/discover/areas/"):
            return {"area": {"id": "orders_sales", "name": "Orders & sales"}, "children": [], "kinds": [], "said": []}
        return {"total": 0, "items": [], "within": [], "said": []}
    monkeypatch.setattr(PramanyxClient, "_get", get)
    client = PramanyxClient.__new__(PramanyxClient)
    assert asyncio.run(client.list_areas())["areas"][0]["name"] == "Orders & sales"
    assert asyncio.run(client.describe_area("orders & sales"))["name"] == "Orders & sales"
    assert asked[1:] == [("/discover/areas/orders%20%26%20sales", {"by_use": True}),
                         ("/discover/atlas/review", {"area": "orders & sales"})]


def test_the_ask_panel_reads_the_areas_in_process_with_the_same_bodies(monkeypatch):
    """A8 (2026-11-26): the Ask panel's tools run in-process; its list_areas and describe_area are the MCP tools' own
    bodies (`mcp.area_views`) over the Atlas read directly, so the two places cannot disagree about the Areas."""
    from pramanyx.agent import platform_tools as P
    from pramanyx.discover import atlas as AT
    from pramanyx.discover import service as S
    from pramanyx.mcp import area_views as V
    seen = {}
    monkeypatch.setattr("pramanyx.db.registry.list_connections", lambda: [{"id": "c1", "name": "theLook"}])
    monkeypatch.setattr("pramanyx.security.authz.org_visible_conn_ids", lambda: None)
    monkeypatch.setattr(AT, "atlas", lambda scope: seen.setdefault("atlas", scope) and {"areas": []} or {"areas": []})
    monkeypatch.setattr(V, "areas_for_agents", lambda atlas: {"areas": ["via the MCP body"], "read": atlas})
    assert P.list_areas("c1", {})["areas"] == ["via the MCP body"]
    assert seen["atlas"].connections == {"c1": "theLook"}
    monkeypatch.setattr(S, "area_page", lambda scope, area, by_use_first=False: None if area == "nowhere" else {"area": {"id": area}})
    monkeypatch.setattr(AT, "review_in", lambda scope, area: {"total": 2})
    monkeypatch.setattr(V, "area_for_agents", lambda page, review: {"area": page["area"]["id"], "waiting": review["total"]})
    assert P.describe_area("c1", {"area": "orders_sales"}) == {"area": "orders_sales", "waiting": 2}
    assert "no Area 'nowhere'" in P.describe_area("c1", {"area": "nowhere"})["error"]
    assert "which Area" in P.describe_area("c1", {})["error"]
    names = [t.name for t in P.platform_tools("c1")]
    assert {"list_areas", "describe_area"} <= set(names)
