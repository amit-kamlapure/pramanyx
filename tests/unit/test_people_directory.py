"""People, step two: the directory (2026-11-15). There was no person record; groups had no members.

A CSV names people by their sign-in email; a team is a function group; a person a full import leaves out is
deactivated, never deleted; an import is shown before it is applied.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx.rbac import directory as D
from pramanyx.rbac import groups as G
from pramanyx.rbac import store as S

ORG = "default"
CSV = """Email,Name,Job Title,Department,Manager
ana@example.com,Ana Rao,CFO,Finance,
ben@example.com,Ben Ito,Analyst,Finance,ana@example.com
cy@example.com,Cy Moe,Planner,Supply Chain,ana@example.com
"""


@pytest.fixture(autouse=True)
def rbac(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "_DB_PATH", tmp_path / "rbac.db")


def test_a_dry_run_says_what_would_change_and_changes_nothing():
    plan = D.plan_import(ORG, CSV)
    assert [a["email"] for a in plan.add] == ["ana@example.com", "ben@example.com", "cy@example.com"]
    assert plan.teams_new == ["finance", "supply-chain"]
    assert D.people(ORG) == [] and G.list_groups(ORG) == []


def test_an_import_makes_people_and_puts_each_in_their_teams_group():
    D.apply_import(ORG, CSV)
    ben = D.person(ORG, "user:BEN@example.com")
    assert (ben.name, ben.title, ben.team, ben.manager) == ("Ben Ito", "Analyst", "finance", "ana@example.com")
    assert G.list_members(ORG, "finance") == ["user:ana@example.com", "user:ben@example.com"]
    assert G.get_group(ORG, "supply-chain").name == "Supply Chain"
    assert G.groups_of(ORG, "user:cy@example.com") == ["supply-chain"]


def test_a_move_between_teams_leaves_the_old_group_and_a_person_left_out_is_deactivated_not_deleted():
    D.apply_import(ORG, CSV)
    G.add_member(ORG, "finance", "user:dee@example.com")              # someone an admin added by hand
    moved = CSV.replace("ben@example.com,Ben Ito,Analyst,Finance", "ben@example.com,Ben Ito,Analyst,Supply Chain")
    moved = "\n".join(line for line in moved.splitlines() if not line.startswith("cy@"))
    plan = D.apply_import(ORG, moved)
    assert plan.change == [{"email": "ben@example.com", "fields": {"team": ["finance", "supply-chain"]}}]
    assert plan.deactivate == ["cy@example.com"]
    assert G.list_members(ORG, "finance") == ["user:ana@example.com", "user:dee@example.com"]
    assert G.list_members(ORG, "supply-chain") == ["user:ben@example.com"]
    assert [p.email for p in D.people(ORG)] == ["ana@example.com", "ben@example.com"]
    assert D.person(ORG, "cy@example.com").active is False


def test_a_partial_import_adds_and_changes_but_deactivates_no_one():
    D.apply_import(ORG, CSV)
    plan = D.apply_import(ORG, "email,name\neve@example.com,Eve\n", full=False)
    assert plan.deactivate == [] and len(D.people(ORG)) == 4


def test_bad_lines_are_refused_with_why_and_the_rest_stand():
    rows, refused = D.parse_csv("email,manager\nnot-an-email,\nana@example.com,boss\nana@example.com,\n")
    assert [p.email for p, _ in rows] == ["ana@example.com"] and rows[0][0].manager == ""
    assert [r["line"] for r in refused] == [2, 3, 4]
    assert D.parse_csv("name\nAna\n")[1][0]["reason"].startswith("no email column")


def test_the_door_dry_runs_by_default_and_applies_when_told():
    from pramanyx.routers import roles
    app = FastAPI()
    app.include_router(roles.router)
    client = TestClient(app)
    first = client.post("/rbac/directory/import", json={"csv": CSV}).json()
    assert first["applied"] is False and len(first["add"]) == 3 and client.get("/rbac/directory").json() == []
    assert client.post("/rbac/directory/import", json={"csv": CSV, "dry_run": False}).json()["applied"] is True
    assert [p["email"] for p in client.get("/rbac/directory").json()] == [
        "ana@example.com", "ben@example.com", "cy@example.com"]
    assert client.post("/rbac/directory/import", json={"csv": "name\nAna\n"}).status_code == 422


def test_the_directory_is_role_administration():
    from pramanyx.rbac.permissions import Permission as P
    from pramanyx.rbac.policy import POLICY
    assert POLICY[("GET", "/rbac/directory")] == POLICY[("POST", "/rbac/directory/import")] == P.ADMIN_MANAGE_ROLES
