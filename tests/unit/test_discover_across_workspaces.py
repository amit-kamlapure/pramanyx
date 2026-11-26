"""Search across every workspace (the user, 2026-11-25, "search across workspaces").

A workspace has no members of its own: what a person may read is decided per connection and per thing, as in one. So
"every workspace" is the union of the organisation's workspaces' connections, read once outside the request's own, and
each result names the workspaces it lives in; another organisation's workspace is never searched.
"""
from __future__ import annotations

from types import SimpleNamespace as NS

from pramanyx.discover import search as S
from pramanyx.discover.items import Found, Item, Scope
from pramanyx.routers import discover as R

WORKSPACES = [NS(id="default", name="Default", org_id="org-a"), NS(id="lux", name="Luxeperience GmbH", org_id="org-a"),
              NS(id="theirs", name="Another org", org_id="org-b")]
HOLDS = {"default": {"8233e4fd", "workspace"}, "lux": {"dcc63d83", "8233e4fd"}, "theirs": {"secret"}}


def _patch(monkeypatch):
    monkeypatch.setattr("pramanyx.workspace.store.list_workspaces", lambda: WORKSPACES)
    monkeypatch.setattr("pramanyx.metastore.accessible_catalog_ids", lambda ws: HOLDS.get(ws, set()) if ws else None)
    monkeypatch.setattr("pramanyx.org.context.current_org_id", lambda: "org-a")
    monkeypatch.setattr("pramanyx.db.registry.list_connections", lambda: [
        {"id": c, "name": c} for c in ("8233e4fd", "workspace", "dcc63d83", "secret")])
    monkeypatch.setattr("pramanyx.security.authz.org_visible_conn_ids", lambda: None)
    monkeypatch.setattr("pramanyx.security.authz.get_principal", lambda request: None)
    monkeypatch.setattr("pramanyx.security.authz.acting_person", lambda principal: "user:ana")
    monkeypatch.setattr("pramanyx.rbac.resolver.has_permission", lambda p, perm: False)


def test_every_workspace_is_the_organisations_workspaces_each_connection_named_by_where_it_lives(monkeypatch):
    _patch(monkeypatch)
    assert R._every_workspace() == {"8233e4fd": ["Default", "Luxeperience GmbH"], "workspace": ["Default"],
                                    "dcc63d83": ["Luxeperience GmbH"]}


def test_the_scope_across_reads_every_workspaces_connections_and_one_reads_its_own(monkeypatch):
    _patch(monkeypatch)
    across = R.scope_of(None, "default", None, across=True)
    assert set(across.connections) == {"8233e4fd", "workspace", "dcc63d83"} and across.workspace_id is None
    assert across.homes["dcc63d83"] == ["Luxeperience GmbH"]
    one = R.scope_of(None, "default", None)
    assert set(one.connections) == {"8233e4fd", "workspace"} and one.homes is None


def test_a_result_names_its_workspaces_only_when_the_search_spans_them(monkeypatch):
    item = Item(kind="table", id="dcc63d83/luxexperience/orders", name="orders", connection_id="dcc63d83",
                connection_name="PostgreSQL")
    monkeypatch.setattr(S, "gather", lambda scope: {"table": Found(items=[item])})
    monkeypatch.setattr(S, "_graph_hits", lambda scope, q, items: ([], False, [], 0, {}))
    across = Scope(None, "user:ana", {"dcc63d83": "PostgreSQL"}, homes={"dcc63d83": ["Luxeperience GmbH"]})
    (hit,) = S.search(across, "orders")["items"]
    assert hit["workspaces"] == ["Luxeperience GmbH"]
    (alone,) = S.search(Scope(None, "user:ana", {"dcc63d83": "PostgreSQL"}), "orders")["items"]
    assert "workspaces" not in alone
