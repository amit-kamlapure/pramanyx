"""A SQL alias for a named breakdown comes from the module's one alias helper."""
from __future__ import annotations

from pramanyx.agent import investigate as I


def test_the_alias_comes_from_the_helper_that_already_existed():
    """Caught by this test: the breakdown shipped with its own copy of `_safe_alias`,
    which the module's existing one silently overrode. One definition."""
    assert I._safe_alias("flight count") == "flight_count"
    assert I._safe_alias("Revenue (€)") == "revenue"
    assert I._safe_alias("") == "metric"
