"""Org-settings + workspace-override API routes.

Calls the route handlers directly (stores path-isolated) — the persistence/resolution
is covered by test_orgsettings; here we assert the thin request->store->response wiring:
PUT validates via the OrgSettings model, GET round-trips, /effective merges a workspace
override, and the workspace router threads settings_override through create/update.
"""
import pytest

from pramanyx.orgsettings import store as S
from pramanyx.orgsettings.models import OrgSettings
from pramanyx.routers import orgsettings as R
from pramanyx.routers import workspace as WR
from pramanyx.workspace import store as WS


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "_PATH", tmp_path / "org_settings.json")
    monkeypatch.setattr(WS, "_DB_PATH", tmp_path / "workspaces.db")


class TestOrgSettingsRoutes:
    def test_get_defaults(self):
        body = R.get_org_settings()
        assert body["currency_code"] == "" and body["fiscal_year_start_month"] == 1

    def test_put_then_get_round_trip(self):
        out = R.put_org_settings(OrgSettings(company_name="Acme", currency_code="gbp"))
        assert out["company_name"] == "Acme" and out["currency_code"] == "GBP"  # validated+normalized
        assert R.get_org_settings()["currency_code"] == "GBP"

    def test_put_rejects_bad_currency(self):
        with pytest.raises(Exception):
            OrgSettings(currency_code="POUND")  # model validation guards the PUT body

    def test_effective_no_workspace_is_app(self):
        R.put_org_settings(OrgSettings(currency_code="EUR"))
        assert R.get_effective_settings(None)["currency_code"] == "EUR"

    def test_effective_with_workspace_override(self):
        R.put_org_settings(OrgSettings(currency_code="USD"))
        ws = WR.create_workspace_endpoint(
            WR.CreateWorkspaceRequest(name="UK", settings_override={"currency_code": "GBP"})
        )
        assert R.get_effective_settings(ws["id"])["currency_code"] == "GBP"


class TestWorkspaceOverrideRoute:
    def test_create_with_override(self):
        ws = WR.create_workspace_endpoint(
            WR.CreateWorkspaceRequest(name="WS", settings_override={"timezone": "Europe/London"})
        )
        assert ws["settings_override"] == {"timezone": "Europe/London"}

    def test_update_sets_override(self):
        ws = WR.create_workspace_endpoint(WR.CreateWorkspaceRequest(name="WS"))
        updated = WR.update_workspace_endpoint(
            ws["id"], WR.UpdateWorkspaceRequest(settings_override={"industry": "Freight"})
        )
        assert updated["settings_override"] == {"industry": "Freight"}


class TestOneAllowAtATime:
    """The offer to read a warehouse's query history, made where a connection is added, answers that one choice and
    leaves every other setting as it was. An admin's to answer."""

    def _client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        app = FastAPI()
        app.include_router(R.router)
        return TestClient(app)

    def test_an_admin_answers_one_choice_and_the_rest_stand(self):
        S.save_org_settings(OrgSettings(currency_code="EUR", share_aggregates=True))
        r = self._client().put("/org-settings/allows/read_query_history", json={"allowed": True})
        assert r.status_code == 200 and r.json() == {"key": "read_query_history", "allowed": True, "set": True}
        saved = S.load_org_settings()
        assert saved.read_query_history is True and saved.currency_code == "EUR" and saved.share_aggregates is True
        assert self._client().put("/org-settings/allows/read_query_history", json={"allowed": False}).json()["allowed"] is False
        assert S.load_org_settings().read_query_history is False                      # a no is kept: not asked again

    def test_a_key_that_is_not_a_choice_is_not_found(self):
        assert self._client().put("/org-settings/allows/currency_code", json={"allowed": True}).status_code == 404

    def test_a_person_without_the_admin_permission_is_refused(self, monkeypatch):
        from pramanyx.security.authz import Principal
        monkeypatch.setattr("pramanyx.security.authz.get_principal", lambda request: Principal(user_id="ben", org_id="default"))
        monkeypatch.setattr("pramanyx.rbac.resolver.maybe_bootstrap_owner", lambda p: None)
        monkeypatch.setattr("pramanyx.rbac.resolver.has_permission", lambda p, perm: perm.value != "admin.manage_org")
        assert self._client().put("/org-settings/allows/read_query_history", json={"allowed": True}).status_code == 403
        assert S.load_org_settings().read_query_history is None
