"""Ask for access, and a mention that reaches the person — Discover's left-out plan's C5 and P1's last part
(`docs/DISCOVER_LEFT_OUT_PLAN_2026-11-25.md`; the user, 2026-11-26: "Request access on things you're refused, and
@-mentions in comments that notify the person").

A person refused a Data Canvas or a sheet asks its maker (else the admins) with a reason; the ask reaches the maker's
Inbox "For you" lane and nobody else's; accepting shares it with the asker to read, declining tells them why. A comment
that mentions someone reaches them in the same lane, opening the Definition, and leaves it when taken back. Each person
is a real request through the real routes, made as the install's operator (``PRAMANYX_LOCAL_USER``).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from pramanyx.canvas.models import CanvasScope


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("PRAMANYX_SYSTEM_DB", str(tmp_path / "system.db"))
    monkeypatch.setenv("PRAMANYX_LOCAL_USER", "ana")
    from pramanyx.rbac import store as rbac_store
    monkeypatch.setattr(rbac_store, "_DB_PATH", tmp_path / "rbac.db")
    from pramanyx.kernel import jobs
    monkeypatch.setattr(jobs, "main_loop", lambda: None)
    from pramanyx.api import app
    yield TestClient(app)


def _as(monkeypatch, person: str) -> None:
    monkeypatch.setenv("PRAMANYX_LOCAL_USER", person)


def _secret(by: str = "user:ana"):
    from pramanyx.canvas import sharing
    from pramanyx.canvas.store import create_canvas, get_canvas
    c = create_canvas(name="Margins", description="", created_by=by,
                      scopes=[CanvasScope(connection_id="c1", tables=["main.orders"])])
    if not by:                                   # nobody made it here: chosen for it as it was before makers were kept
        from pramanyx.canvas import store
        from pramanyx.canvas.models import CanvasShare
        return store.set_sharing(c.id, "chosen", [CanvasShare(kind="person", id="bo", level="view")])
    return sharing.set_sharing(get_canvas(c.id), "chosen", [{"kind": "person", "id": "bo", "level": "view"}],
                               by=by, curator=False)


def _for_you(client, about: str = "") -> list[dict]:
    """The person's "For you" rows — about one canvas when ``about`` names it (the inbox store outlives a test)."""
    lanes = client.get("/needs-you").json()["lanes"]
    rows = next(lane for lane in lanes if lane["id"] == "for_you")["rows"]
    return [r for r in rows if not about or (r.get("ask") or {}).get("thing_id") == about]


def test_an_ask_reaches_the_maker_alone_and_an_accept_shares_it(env, monkeypatch):
    client = env
    c = _secret()
    _as(monkeypatch, "dan")
    assert client.get(f"/canvases/{c.id}").status_code == 403
    asked = client.post("/access-requests", json={"thing": "canvas", "id": c.id, "reason": "  for the Q3   review "})
    assert asked.status_code == 201, asked.text
    a = asked.json()
    assert (a["asker"], a["to"], a["reason"], a["status"], a["already"]) == ("dan", ["ana"], "for the Q3 review", "pending", False)
    again = client.post("/access-requests", json={"thing": "canvas", "id": c.id, "reason": "please"}).json()
    assert again["id"] == a["id"] and again["already"] is True, "one ask a person and a thing waits at once"
    assert client.get("/access-requests/mine", params={"thing": "canvas", "id": c.id}).json()["pending"]["id"] == a["id"]
    assert _for_you(client, c.id) == [], "the asker's own waiting ask is not theirs to answer"
    assert client.post(f"/access-requests/{a['id']}/answer", json={"accept": True}).status_code == 403

    _as(monkeypatch, "bo")
    assert _for_you(client, c.id) == [], "nobody else's list shows it"
    _as(monkeypatch, "ana")
    rows = _for_you(client, c.id)
    assert [r["source"] for r in rows] == ["access_request"]
    assert rows[0]["title"] == "dan asks to open the Data Canvas “Margins” — for the Q3 review" and rows[0]["read"] is False
    assert not any(r.get("id") == a["id"] for lane in client.get("/needs-you").json()["lanes"] if lane["id"] == "decide"
                   for r in lane["rows"]), "never in everyone's To decide"
    done = client.post(f"/access-requests/{a['id']}/answer", json={"accept": True})
    assert done.status_code == 200 and done.json()["status"] == "executed", done.text
    assert client.post(f"/access-requests/{a['id']}/answer", json={"accept": True}).status_code == 409

    _as(monkeypatch, "dan")
    assert client.get(f"/canvases/{c.id}").status_code == 200, "shared with them to read"
    (told,) = _for_you(client, c.id)
    assert told["source"] == "access_answer" and told["title"] == "ana shared it with you to read — “Margins”"
    assert told["open"] == {"kind": "canvas", "id": c.id}
    assert client.post("/access-requests", json={"thing": "canvas", "id": c.id}).status_code == 409, \
        "a thing they may open is not asked for"


def test_a_decline_tells_the_asker_why_and_they_may_ask_again(env, monkeypatch):
    client = env
    c = _secret()
    _as(monkeypatch, "dan")
    a = client.post("/access-requests", json={"thing": "canvas", "id": c.id}).json()
    _as(monkeypatch, "ana")
    out = client.post(f"/access-requests/{a['id']}/answer", json={"accept": False, "why": "it holds salaries"}).json()
    assert (out["status"], out["why"]) == ("rejected", "it holds salaries")
    _as(monkeypatch, "dan")
    assert client.get(f"/canvases/{c.id}").status_code == 403
    (told,) = _for_you(client, c.id)
    assert told["title"] == "ana did not share it: it holds salaries — “Margins”" and told["open"] is None
    assert client.post("/access-requests", json={"thing": "canvas", "id": c.id}).json()["already"] is False


def test_a_sheet_is_asked_for_the_same_way(env, monkeypatch):
    from pramanyx.record import access_requests as A
    from pramanyx.sheets import model, sharing
    from pramanyx.sheets.model import Sheet
    s = model.save(Sheet(id=model.new_id(), name="Payroll", created_by="user:ana", table="payroll"), what="made", by="user:ana")
    s = sharing.set_sharing(model.get(s.id), "chosen", [{"kind": "person", "id": "bo", "level": "view"}], by="user:ana")
    a = A.ask("sheet", s.id, asker="user:dan", reason="audit")
    assert a["to"] == ["ana"]
    with pytest.raises(A.Refused, match="only ana answers"):
        A.answer(a["id"], by="user:bo", admin=False, accept=True)
    assert A.answer(a["id"], by="user:ana", admin=False, accept=True)["status"] == "executed"
    assert sharing.level_of(model.get(s.id), "user:dan").level == "view"


def test_a_canvas_nobody_made_is_asked_of_the_admins(env, monkeypatch):
    from pramanyx.record import access_requests as A
    c = _secret(by="")
    p = A.ask("canvas", c.id, asker="user:dan", reason="")
    assert (p["to"], p["to_admins"]) == ([], True)
    with pytest.raises(A.Refused, match="only an admin answers"):
        A.answer(p["id"], by="user:bo", admin=False, accept=True)
    assert [x.id for x in A.addressed_to("user:root", admin=True)] == [p["id"]]


def test_a_mention_reaches_the_person_opening_the_definition_and_leaves_when_taken_back(env, monkeypatch):
    from pramanyx.record import definition_comments as DC
    from pramanyx.record import mentions as M
    monkeypatch.setattr(DC, "the_definition", lambda c, t, a: type("D", (), {"extra": {"term": "Repeat buyer", "area": "customers"}})())
    said = DC.comment("c1", "Repeat buyer", "customers", "@bo is this two orders or two days? cc @ana @dan@example.com",
                      by="user:ana")
    assert said["mentions"] == ["bo", "ana", "dan@example.com"]
    (row,) = M.rows_for("user:bo")
    assert row["title"] == "ana mentioned you on “Repeat buyer”" and row["line"].startswith("@bo is this two orders")
    assert row["open"] == {"kind": "definition", "connection_id": "c1", "term": "Repeat buyer", "area": "customers"}
    assert len(M.rows_for("user:dan@example.com")) == 1 and len(M.rows_for("user:dan")) == 0
    assert M.rows_for("user:ana") == [], "mentioning yourself reaches nobody"
    assert M.rows_for("user:bo", connections={"elsewhere"}) == [], "a connection out of view says nothing"
    DC.take_back("c1", "Repeat buyer", "customers", said["id"], by="user:ana")
    assert M.rows_for("user:bo") == []


def test_with_sign_in_on_the_queues_own_accept_refuses_anyone_but_the_maker_without_spending_the_ask(env, monkeypatch):
    from pramanyx.actions.inbox import accept_proposal, get_proposal
    from pramanyx.record import access_requests as A
    c = _secret()
    a = A.ask("canvas", c.id, asker="user:dan", reason="")
    monkeypatch.setenv("PRAMANYX_REQUIRE_IDENTITY", "1")
    result, _ = accept_proposal(a["id"], actor="user:bo")
    assert (result.ok, result.status) == (False, "forbidden") and get_proposal(a["id"]).status == "pending"
    result, _ = accept_proposal(a["id"], actor="user:ana")
    assert result.ok and get_proposal(a["id"]).status == "executed"
