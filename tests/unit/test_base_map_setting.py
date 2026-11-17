"""The map under a map answer is the organisation's choice, none by default (the maps step, 2026-11-17).

A base map is fetched square by square from a tile server, so which squares a person views leave for it. Unset, no
tile server is named and the shapes are drawn on a blank ground; OpenFreeMap's public tiles and an own tile server are
each a saved choice. Tested both ways, as every setting about what leaves the install is.
"""
import pytest
from pydantic import ValidationError

from pramanyx.orgsettings import store as S
from pramanyx.orgsettings.models import OrgSettings
from pramanyx.routers import orgsettings as R


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "_PATH", tmp_path / "org_settings.json")


def test_unset_names_no_tile_server_and_says_where_to_choose_one():
    out = R.get_base_map()
    assert out["kind"] == "none" and out["light"] == "" and out["dark"] == ""
    assert "blank ground" in out["says"] and "Settings ▸ Organization" in out["says"]


def test_openfreemap_when_chosen_with_what_leaves_said():
    R.put_org_settings(OrgSettings(base_map="openfreemap"))
    out = R.get_base_map()
    assert out["kind"] == "openfreemap"
    assert out["light"] == "https://tiles.openfreemap.org/styles/positron"
    assert out["dark"] == "https://tiles.openfreemap.org/styles/dark"
    assert "OpenStreetMap" in out["says"] and "never leave" in out["says"]


def test_own_tile_server_by_its_style_url():
    R.put_org_settings(OrgSettings(base_map="own", base_map_url=" https://tiles.example.org/styles/basic "))
    out = R.get_base_map()
    assert out == {"kind": "own", "light": "https://tiles.example.org/styles/basic",
                   "dark": "https://tiles.example.org/styles/basic", "says": out["says"]}


def test_own_chosen_without_a_url_draws_none_and_says_so():
    R.put_org_settings(OrgSettings(base_map="own"))
    out = R.get_base_map()
    assert out["kind"] == "none" and "no style URL is set" in out["says"]


@pytest.mark.parametrize("url", ["javascript:alert(1)", "file:///etc/passwd", "tiles.example.org/style.json"])
def test_only_a_web_address_is_a_style(url):
    with pytest.raises(ValidationError):
        OrgSettings(base_map="own", base_map_url=url)


def test_an_unknown_base_map_is_refused():
    with pytest.raises(ValidationError):
        OrgSettings(base_map="google")
