"""Who to name, as a person types (2026-11-25): an Area's Business and Technical contacts "pop up if they exist as
users type name/email". `GET /people` offers the person asking, the organisation's directory and the people already
named — names and emails only, matched on any part of either, each once.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pramanyx.orgsettings.models import AreaDeclaration, OrgSettings
from pramanyx.rbac import directory as D
from pramanyx.rbac import store as S

ORG = "default"
CSV = """Email,Name,Job Title,Department,Manager
ana@example.com,Ana Rao,CFO,Finance,
ben@example.com,Ben Ito,Analyst,Finance,ana@example.com
"""


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "_DB_PATH", tmp_path / "rbac.db")
    D.apply_import(ORG, CSV)
    settings = OrgSettings(areas=[
        AreaDeclaration(id="orders_sales", business_owners=["user:cai@example.com", "user:ana@example.com"],
                        technical_owners=["group:data-eng"]),
    ])
    monkeypatch.setattr("pramanyx.orgsettings.store.load_org_settings", lambda: settings)
    monkeypatch.setattr("pramanyx.security.authz.caller", lambda: "amit")
    from pramanyx.routers import roles
    app = FastAPI()
    app.include_router(roles.router)
    return TestClient(app)


def test_the_directory_is_offered_on_a_part_of_a_name_or_an_email(client):
    by_name = client.get("/people", params={"q": "ito"}).json()
    assert by_name == [{"ref": "user:ben@example.com", "name": "Ben Ito", "email": "ben@example.com",
                        "source": "directory"}]
    assert [p["ref"] for p in client.get("/people", params={"q": "ANA@"}).json()] == ["user:ana@example.com"]


def test_the_person_asking_comes_first_then_the_directory_then_people_already_named(client):
    got = client.get("/people").json()
    assert [(p["ref"], p["source"]) for p in got] == [
        ("user:amit", "you"), ("user:ana@example.com", "directory"), ("user:ben@example.com", "directory"),
        ("user:cai@example.com", "named"), ("group:data-eng", "named")]
    # Ana is named on the Area too, and is offered once — as the directory knows her, by her name
    assert [p["name"] for p in got if p["ref"] == "user:ana@example.com"] == ["Ana Rao"]


def test_someone_named_but_not_in_the_directory_is_still_offered(client):
    assert client.get("/people", params={"q": "cai"}).json() == [
        {"ref": "user:cai@example.com", "name": "cai@example.com", "email": "", "source": "named"}]


def test_nobody_matching_is_an_empty_list_and_the_limit_holds(client):
    assert client.get("/people", params={"q": "zed"}).json() == []
    assert len(client.get("/people", params={"limit": 2}).json()) == 2
    assert client.get("/people", params={"limit": 0}).status_code == 422


def test_a_member_of_the_organisation_in_no_directory_is_offered_by_the_name_they_sign_in_with(client):
    """2026-11-26, on a copy with sign-in on: a comment's @ could not reach the organisation's owner, who held a role
    and was in no directory — the people a thing's sharing lists are offered here too."""
    S.assign_role(ORG, "dana", "owner")
    S.assign_role(ORG, "ben@example.com", "analyst")
    got = client.get("/people", params={"q": "dan"}).json()
    assert got == [{"ref": "user:dana", "name": "dana", "email": "", "source": "member"}]
    assert [p["source"] for p in client.get("/people", params={"q": "ben"}).json()] == ["directory"], "listed once"
