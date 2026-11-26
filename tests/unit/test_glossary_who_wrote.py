"""Which words the model wrote (the user, 2026-11-25, "Catalog extras: … which descriptions the model wrote").

A description the model wrote says so where it is read, and stops saying so when a person writes it. Found while
planning: a person's write to the model's entry stayed in the model's layer, marked as the model's — and the drift
re-seed rewrites exactly those entries, so a person's words were the model's to overwrite. And a table's page read
only the glossary's top level, which holds none of what the model wrote for one connection: theLook's six
model-written tables said "no description" in the Catalog.
"""
from __future__ import annotations

from types import SimpleNamespace as NS

import pytest
import yaml

from pramanyx.semantic import glossary as G


@pytest.fixture
def gpath(tmp_path):
    return tmp_path / "glossary.yaml"


def _models_orders():
    return {"description": "Orders placed.", "grain": "one row per order",
            "columns": {"status": {"description": "Where the order is."}}, "auto_generated": True}


def _sidecar_tables(gpath, connection=None):
    p = G.generated_path(gpath)
    doc = (yaml.safe_load(p.read_text()) or {}) if p.exists() else {}
    if connection:
        return ((doc.get(G.CONNECTIONS_KEY) or {}).get(connection) or {}).get("tables") or {}
    return doc.get("tables") or {}


def test_every_word_of_the_models_entry_is_the_models():
    assert G.model_wrote(_models_orders()) == ["description", "grain", "columns.status.description"]
    assert G.model_wrote({"description": "a person's"}) == []


def test_a_persons_write_makes_the_entry_theirs_and_says_which_words_are_still_the_models(gpath):
    G.save_glossary({"tables": {"shop.orders": _models_orders()}}, gpath)
    G.update_table("orders", description="Every order a customer placed.", schema="shop", path=gpath)
    assert "shop.orders" in yaml.safe_load(gpath.read_text())["tables"]
    assert "shop.orders" not in _sidecar_tables(gpath)          # out of the layer the re-seed rewrites
    entry = G.load_glossary(gpath)["tables"]["shop.orders"]
    assert entry["description"] == "Every order a customer placed." and not entry.get("auto_generated")
    assert G.model_wrote(entry) == ["grain", "columns.status.description"]
    G.update_column("orders", "status", description="Placed, shipped or returned.", schema="shop", path=gpath)
    assert G.model_wrote(G.load_glossary(gpath)["tables"]["shop.orders"]) == ["grain"]
    G.update_table("orders", grain="one row per order", schema="shop", path=gpath)
    assert "model_wrote" not in G.load_glossary(gpath)["tables"]["shop.orders"]


def test_a_person_naming_an_owner_takes_the_entry_out_of_the_models_layer_too(gpath):
    G.save_glossary({"tables": {"shop.orders": _models_orders()}}, gpath)
    G.update_table("orders", owner="ana@example.com", schema="shop", path=gpath)
    entry = G.load_glossary(gpath)["tables"]["shop.orders"]
    assert entry["owner"] == "ana@example.com" and not entry.get("auto_generated")
    assert G.model_wrote(entry) == ["description", "grain", "columns.status.description"]


def test_a_models_write_to_a_persons_entry_says_so_and_to_its_own_changes_nothing(gpath):
    G.save_glossary({"tables": {"shop.orders": {"description": "A person's words."},
                                "shop.users": {"description": "Users.", "auto_generated": True}}}, gpath)
    G.update_column("orders", "status", caveats="NULL until shipped.", schema="shop", path=gpath, by="model")
    G.update_column("users", "email", caveats="Masked.", schema="shop", path=gpath, by="model")
    tables = G.load_glossary(gpath)["tables"]
    assert G.model_wrote(tables["shop.orders"]) == ["columns.status.caveats"]
    assert tables["shop.users"].get("auto_generated") is True and "model_wrote" not in tables["shop.users"]


def test_a_write_for_a_connection_lands_in_its_own_entry_and_reads_back_as_it_reads(gpath):
    G.save_glossary({"tables": {}, G.CONNECTIONS_KEY: {"c1": {"tables": {"shop.orders": _models_orders()}}}}, gpath)
    before = G.connection_glossary("c1", gpath)["tables"]["shop.orders"]
    assert before["model_wrote"] == ["description", "grain", "columns.status.description"]
    G.update_table("orders", description="Every order a customer placed.", schema="shop", path=gpath, connection="c1")
    assert "shop.orders" not in _sidecar_tables(gpath, "c1")
    after = G.connection_glossary("c1", gpath)["tables"]["shop.orders"]
    assert after["description"] == "Every order a customer placed."
    assert after["grain"] == "one row per order"                 # the model's other words are kept, not shadowed
    assert after["model_wrote"] == ["grain", "columns.status.description"]
    assert "shop.orders" not in G.connection_glossary("c2", gpath)["tables"]
    assert "shop.orders" not in (G.load_glossary(gpath).get("tables") or {})   # not written for every connection


def test_the_doors_say_who_wrote_and_an_agents_write_is_the_models(monkeypatch):
    from pramanyx.mcp.client import AGENT_HEADER, AGENT_MARK
    from pramanyx.routers import knowledge as K
    heard = []
    monkeypatch.setattr(K, "update_table", lambda *a, **k: heard.append(("table", k["by"], k["connection"])))
    monkeypatch.setattr(K, "update_column", lambda *a, **k: heard.append(("column", k["by"], k["connection"])))
    person = NS(headers={}, state=NS(principal=None))
    agent = NS(headers={AGENT_HEADER: AGENT_MARK}, state=NS(principal=None))
    K.put_table_glossary("orders", K.UpdateTableRequest(description="x"), person, schema="shop", connection_id="c1")
    K.put_column_glossary("orders", "status", K.UpdateColumnRequest(caveats="y"), agent, schema="shop")
    assert heard == [("table", "person", "c1"), ("column", "model", None)]
    monkeypatch.setattr("pramanyx.semantic.glossary.connection_glossary", lambda c: {"read": c})
    assert K.get_glossary(connection_id="c1") == {"read": "c1"}
