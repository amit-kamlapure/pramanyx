"""Punch list 87 (2026-11-18): the areas the model suggests wait for a curator. The ontology's enricher labels each
entity's business area (`entity.domain`); a label no area of the connection answers to is suggested — in the Review list
and on the coverage card — and is an area only when a curator declares it. One a curator said is not an area is not
suggested again."""
from __future__ import annotations

from types import SimpleNamespace as NS

import pytest

from pramanyx.semantic import areas as A


@pytest.fixture()
def labelled(monkeypatch):
    entities = {
        "Order": NS(domain="Logistics", source_tables=["shop.orders", "shop.shipments"]),
        "Shipment": NS(domain="logistics", source_tables=["shop.carriers"]),
        "Customer": NS(domain="Customers", source_tables=["shop.customers"]),
        "Review": NS(domain="Marketing", source_tables=["shop.reviews"]),
        "Untagged": NS(domain="", source_tables=["shop.misc"]),
    }
    monkeypatch.setattr("pramanyx.ontology.store.load_latest_ontology", lambda c, s=None: NS(entities=entities))
    monkeypatch.setattr(A, "areas_for", lambda c, s=None, workspace_id=None: [{"id": "customers", "name": "Customers"}])
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda c, s=None: NS(areas=[]))
    said = {"not_areas": []}
    monkeypatch.setattr("pramanyx.orgsettings.store.effective_settings", lambda ws=None: NS(**said))
    return said


def test_a_label_no_area_answers_to_is_suggested_with_its_tables(labelled):
    got = A.suggested_areas("c1")
    assert [s["label"] for s in got] == ["Logistics", "Marketing"]          # the busiest first
    assert got[0]["tables"] == ["carriers", "orders", "shipments"] and got[0]["id"] == "logistics"
    assert all(s["label"] != "Customers" for s in got)                       # an area already answers to it


def test_one_a_curator_said_is_not_an_area_is_not_suggested_again(labelled):
    labelled["not_areas"] = ["marketing"]
    assert [s["label"] for s in A.suggested_areas("c1")] == ["Logistics"]


def test_the_review_list_carries_each_suggestion_to_the_areas(labelled, monkeypatch):
    from pramanyx.knowledge import review as R
    rows = R._suggested_areas("c1", R._links("c1"))
    assert [r["title"] for r in rows] == ["“Logistics” as an area", "“Marketing” as an area"]
    assert rows[0]["kind"] == "candidate" and rows[0]["count"] == 3
    assert "The model labelled 3 tables so (carriers, orders, shipments). Not an area until a curator declares it." \
        == rows[0]["detail"]
    assert rows[0]["resolve"] == {"href": "/?tab=semantic&conn=c1", "action": "Declare it, or say it is not one"}


def test_only_a_curator_says_a_suggestion_is_not_an_area_and_never_an_agent(monkeypatch):
    from fastapi import HTTPException

    from pramanyx.mcp.client import AGENT_HEADER, AGENT_MARK
    from pramanyx.routers import metrics as M
    saved = {}
    monkeypatch.setattr("pramanyx.orgsettings.store.load_org_settings", lambda: NS(
        not_areas=["Old"], model_copy=lambda update: NS(**update)))
    monkeypatch.setattr("pramanyx.orgsettings.store.save_org_settings", lambda s: saved.setdefault("s", s))
    curator = NS(headers={}, state=NS(principal="admin"))
    monkeypatch.setattr("pramanyx.rbac.resolver.has_permission", lambda p, perm: p == "admin")
    assert M.put_not_an_area("c1", M.NotAnAreaIn(label="Marketing"), curator) == {"not_areas": ["Old", "Marketing"]}
    assert M.put_not_an_area("c1", M.NotAnAreaIn(label="old", not_an_area=False), curator) == {"not_areas": []}
    with pytest.raises(HTTPException) as e:
        M.put_not_an_area("c1", M.NotAnAreaIn(label="Marketing"), NS(headers={}, state=NS(principal="ana")))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        M.put_not_an_area("c1", M.NotAnAreaIn(label="Marketing"),
                          NS(headers={AGENT_HEADER: AGENT_MARK}, state=NS(principal="admin")))
    assert e.value.status_code == 403 and "person's own call" in e.value.detail
