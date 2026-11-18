"""The dashboards home's two preferences: how its list is drawn, and the dashboards a person starred."""
from __future__ import annotations

import pytest

from pramanyx.db import user_prefs
from pramanyx.db.user_prefs import ALLOWED_KEYS


def check(key, value):
    return ALLOWED_KEYS[key][0](value)


@pytest.mark.parametrize("view", ["list", "detail", "grid"])
def test_the_home_is_drawn_as_a_list_a_detail_or_a_grid(view):
    assert check("dashboards_view", view) == view


def test_another_way_to_draw_the_home_is_refused():
    with pytest.raises(ValueError, match="list, detail, grid"):
        check("dashboards_view", "board")


def test_stars_are_kept_once_each_in_the_order_given():
    assert check("dashboard_stars", ["sheets:a", " sheets:b ", "sheets:a"]) == ["sheets:a", "sheets:b"]
    assert check("dashboard_stars", []) == []


@pytest.mark.parametrize("value", ["sheets:a", {"a": 1}, [""], ["x" * 301], [f"d{i}" for i in range(user_prefs.MAX_DASHBOARD_STARS + 1)]])
def test_stars_that_name_no_dashboard_are_refused(value):
    with pytest.raises(ValueError):
        check("dashboard_stars", value)
