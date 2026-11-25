"""A person's own searches on Discover (the user, 2026-11-25, "saved-search sections"): each a name and the filters it
sets, at most twenty, kept in their preferences; a name used again replaces its search."""
from __future__ import annotations

import pytest

from pramanyx.db import user_prefs
from pramanyx.db.user_prefs import ALLOWED_KEYS


def check(value):
    return ALLOWED_KEYS["discover_searches"][0](value)


def test_a_search_is_kept_as_its_name_and_its_filters():
    got = check([{"name": " Returns  tables ", "q": "returns", "kind": "table", "across": 1}])
    assert got == [{"name": "Returns tables", "q": "returns", "kind": "table", "area": "", "conn": "",
                    "certified": False, "mine": False, "across": True}]


def test_a_name_used_again_replaces_its_search_and_keeps_its_place_last():
    got = check([{"name": "Mine", "mine": True}, {"name": "Orders", "q": "orders"}, {"name": "mine", "mine": True, "certified": True}])
    assert [s["name"] for s in got] == ["Orders", "mine"] and got[1]["certified"] is True


@pytest.mark.parametrize("value, said", [
    ("orders", "list"), ([{"q": "orders"}], "a name"), ([{"name": "Nothing"}], "sets nothing"),
    ([{"name": "x" * 61, "q": "a"}], "60 characters"),
    ([{"name": f"s{i}", "q": "a"} for i in range(user_prefs.MAX_DISCOVER_SEARCHES + 1)], "at most 20"),
])
def test_a_search_the_shape_refuses_is_said(value, said):
    with pytest.raises(ValueError, match=said):
        check(value)
