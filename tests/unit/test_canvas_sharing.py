"""A Data Canvas shared, cloned and certified (the user, 2026-11-20: "Let get option to clone it, share it with people
or certify it").

A canvas is shared as a sheet is, by the same rule (`canvas/sharing.py` over `sheets/sharing.py`): the workspace's until
its maker chooses people and groups, each to open it (``view``) or change it (``edit``); only its maker changes who it is
shared with. Each person below is a real request through the real routes, made as the install's operator
(``PRAMANYX_LOCAL_USER``). The falsifier is a person a canvas was not shared with opening it, or changing it.
"""
from __future__ import annotations

import pytest

from pramanyx.canvas.models import CanvasScope


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("PRAMANYX_SYSTEM_DB", str(tmp_path / "system.db"))
    monkeypatch.setenv("PRAMANYX_LOCAL_USER", "ana")
    from pramanyx.rbac import store as rbac_store
    monkeypatch.setattr(rbac_store, "_DB_PATH", tmp_path / "rbac.db")
    # a canvas made through its door starts its "understand this data" job on the app's loop; these tests ask who may
    # open it, not that, and a job left behind on a connection that does not exist reads as a failed agent elsewhere
    from pramanyx.kernel import jobs
    monkeypatch.setattr(jobs, "main_loop", lambda: None)
    yield tmp_path


def _as(monkeypatch, person: str) -> None:
    monkeypatch.setenv("PRAMANYX_LOCAL_USER", person)


def _client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from pramanyx.routers import canvas as canvas_router
    app = FastAPI()
    app.include_router(canvas_router.router)
    return TestClient(app)


def _made(by: str = "user:ana", name: str = "Returns"):
    from pramanyx.canvas.store import create_canvas
    return create_canvas(name=name, description="Orders and returns",
                         scopes=[CanvasScope(connection_id="c1", tables=["main.orders", "main.returns"])], created_by=by)


BO_OPENS_CY_CHANGES = [{"kind": "person", "id": "bo", "level": "view"}, {"kind": "person", "id": "cy", "level": "edit"}]


def _share(canvas, shares=BO_OPENS_CY_CHANGES, by="user:ana"):
    from pramanyx.canvas import sharing
    from pramanyx.canvas.store import get_canvas
    return sharing.set_sharing(get_canvas(canvas.id), "chosen", shares, by=by, curator=False)


# ── who made it ──────────────────────────────────────────────────────────────────────────────────────────────────────

def test_a_canvas_made_through_its_door_keeps_who_made_it_and_is_the_workspaces(env, monkeypatch):
    r = _client().post("/canvases", json={"name": "Returns", "connection_id": "c1", "tables": ["main.orders"]})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["created_by"] == "user:ana"
    assert body["sharing"] == "workspace" and body["shared_with"] == []
    assert body["access"] == "own"
    _as(monkeypatch, "bo")                       # anyone in the workspace opens and changes it, as every canvas did
    assert _client().get(f"/canvases/{body['id']}").json()["access"] == "edit"


def test_a_canvas_made_before_makers_were_kept_is_the_workspaces_and_a_curators_to_share(env):
    from pramanyx.canvas import sharing
    old = _made(by="")
    assert sharing.level_of(old, "user:bo", curator=False).level == "edit"
    assert sharing.level_of(old, "user:bo", curator=True).level == "own"
    with pytest.raises(sharing.NotShared, match="Only a curator"):
        sharing.set_sharing(old, "chosen", BO_OPENS_CY_CHANGES, by="user:bo", curator=False)
    # the curator who first chooses becomes its maker, so a canvas shared with chosen people never shuts them out
    kept = sharing.set_sharing(old, "chosen", [{"kind": "person", "id": "cy", "level": "view"}], by="user:dee", curator=True)
    assert kept.created_by == "user:dee"
    assert sharing.level_of(kept, "user:dee", curator=False).level == "own"


# ── shared with chosen people ────────────────────────────────────────────────────────────────────────────────────────

def test_a_canvas_shared_with_chosen_people_is_theirs_to_open_or_change_and_said_to_the_rest(env, monkeypatch):
    canvas = _made()
    kept = _share(canvas)
    assert kept.sharing == "chosen" and [(s.id, s.level) for s in kept.shared_with] == [("bo", "view"), ("cy", "edit")]

    _as(monkeypatch, "dan")                      # not shared with: listed and said, never read
    c = _client()
    r = c.get(f"/canvases/{canvas.id}")
    assert r.status_code == 403 and r.json()["detail"] == '"Returns" is not shared with you. Ask ana to share it with you.'
    assert c.get(f"/canvases/{canvas.id}/instructions").status_code == 403
    listed = [x for x in c.get("/canvases").json() if x["id"] == canvas.id]
    assert listed and listed[0]["access"] == "" and listed[0]["description"] == ""
    assert listed[0]["refusal"].startswith('"Returns" is not shared with you')

    _as(monkeypatch, "bo")                       # shared to open: opens, asks, cannot change
    c = _client()
    assert c.get(f"/canvases/{canvas.id}").json()["access"] == "view"
    r = c.put(f"/canvases/{canvas.id}", json={"name": "Mine now"})
    assert r.status_code == 403 and "but not change it" in r.json()["detail"]

    _as(monkeypatch, "cy")                       # shared to change: changes it, but not who it is shared with
    c = _client()
    assert c.put(f"/canvases/{canvas.id}", json={"description": "Orders, returns and refunds"}).status_code == 200
    r = c.put(f"/canvases/{canvas.id}/sharing", json={"sharing": "workspace"})
    assert r.status_code == 403 and r.json()["detail"].startswith("Only ana, who made")
    assert c.delete(f"/canvases/{canvas.id}").status_code == 403

    _as(monkeypatch, "ana")                      # its maker shares it back with the workspace
    r = _client().put(f"/canvases/{canvas.id}/sharing", json={"sharing": "workspace"})
    assert r.status_code == 200 and r.json()["sharing"] == "workspace" and r.json()["may_change"] is True
    _as(monkeypatch, "dan")
    assert _client().get(f"/canvases/{canvas.id}").status_code == 200


def test_sharing_says_what_was_wrong(env):
    r = _client().put(f"/canvases/{_made().id}/sharing", json={"sharing": "chosen", "shared_with": []})
    assert r.status_code == 422 and "choose at least one person or group" in r.json()["detail"]
    r = _client().put(f"/canvases/{_made().id}/sharing", json={"sharing": "everyone"})
    assert r.status_code == 422 and r.json()["detail"].startswith('a canvas is shared with "workspace" or "chosen"')


# ── clone ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_a_clone_is_a_new_canvas_with_its_tables_documents_and_instructions_made_by_who_cloned_it(env, monkeypatch):
    from pramanyx.canvas.store import get_canvas, update_canvas
    from pramanyx.semantic.instructions import canvas_instructions, set_canvas_instructions
    canvas = _made()
    update_canvas(canvas.id, doc_ids=["doc-1"])
    set_canvas_instructions(canvas.id, "Revenue excludes canceled orders.")
    _share(canvas, [{"kind": "person", "id": "bo", "level": "view"}])

    _as(monkeypatch, "bo")                       # opening it is enough to clone it
    r = _client().post(f"/canvases/{canvas.id}/clone", json={})
    assert r.status_code == 201, r.text
    copy = r.json()
    assert copy["id"] != canvas.id and copy["name"] == "Returns (copy)"
    assert copy["scopes"][0]["tables"] == ["main.orders", "main.returns"]
    assert copy["description"] == "Orders and returns" and copy["doc_ids"] == ["doc-1"]
    assert copy["created_by"] == "user:bo" and copy["sharing"] == "workspace" and copy["access"] == "own"
    assert canvas_instructions(copy["id"]) == "Revenue excludes canceled orders."
    assert get_canvas(canvas.id).created_by == "user:ana"          # the original is untouched

    _as(monkeypatch, "dan")                      # not shared with: no clone
    assert _client().post(f"/canvases/{canvas.id}/clone", json={}).status_code == 403


# ── certify ──────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_a_canvas_is_certified_as_a_dashboard_is(env):
    from pramanyx.govern.certification import KINDS, securable_for
    assert "canvas" in KINDS
    assert securable_for("canvas", "cv1") == "artifact:canvas:cv1"
