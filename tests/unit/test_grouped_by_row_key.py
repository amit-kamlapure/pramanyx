"""A total asked "by <dimension>" must not also be grouped by a row's own key.

Receipt 2026-11-13 (LuxExperience): "What is total GMV by order status?" → `GROUP BY order_id, status`,
500 rows, one per order. The detector feeds the repair round the lint already runs.
"""
from __future__ import annotations

import pytest

from pramanyx.sql.grain_intent import grouped_by_a_row_key as check

_RECEIPT = ("SELECT order_id, status, ROUND(SUM(gmv_eur), 2) AS total_gmv_eur FROM orders "
            "GROUP BY order_id, status ORDER BY total_gmv_eur DESC")


def test_the_receipt_is_caught_and_the_repair_says_what_to_group_by():
    said = check("What is total GMV by order status?", _RECEIPT)
    assert said and "also groups by order_id" in said and "Group by status only" in said


@pytest.mark.parametrize("question, sql", [
    # the breakdown IS the entity: its key beside its name is right
    ("What are total sales by customer?", "SELECT customer_id, name, SUM(amount) FROM orders GROUP BY customer_id, name"),
    ("Total revenue by store and month", "SELECT store_id, month, SUM(x) FROM t GROUP BY store_id, month"),
    # the question asks per row
    ("What is the total per order by status?", _RECEIPT),
    ("Total GMV for each order by status", _RECEIPT),
    # the key is named
    ("What is total GMV by order id and status?", _RECEIPT),
    # no key in the grouping
    ("What is total GMV by order status?", "SELECT status, SUM(gmv_eur) FROM orders GROUP BY status"),
    ("What is total GMV by platform and status?", "SELECT platform, status, SUM(g) FROM orders GROUP BY platform, status"),
    # not an aggregate question, or no aggregate in the SQL
    ("List orders by status", _RECEIPT),
    ("What is total GMV by order status?", "SELECT order_id, status FROM orders GROUP BY order_id, status"),
    # positions and expressions are not this detector's to judge
    ("What is total GMV by order status?", "SELECT order_id, status, SUM(g) FROM orders GROUP BY 1, 2"),
    ("What is total GMV by order status?", "SELECT DATE_TRUNC('month', d), order_id, SUM(g) FROM o GROUP BY DATE_TRUNC('month', d), order_id"),
    ("", _RECEIPT), ("What is total GMV by order status?", ""),
])
def test_what_it_leaves_alone(question, sql):
    assert check(question, sql) is None


@pytest.mark.parametrize("question, sql, key", [
    ("What is the average basket by customer segment?", "SELECT customer_id, segment, AVG(b) FROM c GROUP BY customer_id, segment", "customer_id"),
    ("How many returns by product category?", "SELECT p.product_id, p.category, COUNT(*) FROM r JOIN p USING (product_id) GROUP BY p.product_id, p.category", "p.product_id"),
    ("Total amount by status", "SELECT id, status, SUM(amount) FROM payments GROUP BY id, status", "id"),
])
def test_other_breakdowns_grouped_by_a_key_are_caught(question, sql, key):
    said = check(question, sql)
    assert said and f"also groups by {key}" in said


def test_the_chat_path_asks_it_where_a_repair_is_re_checked():
    """Asked only as a lint before the run, the mistake came back in a later repair and was adopted. It is part of
    the breakdown-grain check, which both starts a repair and is asked again of every repair."""
    from pramanyx.routers import investigations as I
    assert "also groups by order_id" in I._breakdown_grain_hint("What is total GMV by order status?", _RECEIPT)
    assert I._checks_still_firing(_RECEIPT, {"grain"}, question="What is total GMV by order status?", dialect="duckdb",
                                  full_cols={}, schema_cols={}) == ["grain"]
    good = "SELECT status, ROUND(SUM(gmv_eur), 2) AS total FROM orders GROUP BY status"
    assert I._breakdown_grain_hint("What is total GMV by order status?", good) == ""
    assert I._checks_still_firing(good, {"grain"}, question="What is total GMV by order status?", dialect="duckdb",
                                  full_cols={}, schema_cols={}) == []
    # the first shape still fires as it did
    assert "BREAKDOWN GRAIN MISMATCH" in I._breakdown_grain_hint(
        "top product categories by revenue", "SELECT product_id, SUM(x) FROM t GROUP BY product_id")


def test_a_repair_is_asked_every_check_not_only_the_ones_that_asked_for_it():
    """Receipt 2026-11-14 (LuxExperience): the first query was right — `GROUP BY status`, 3 rows. A repair asked for
    by another check regrouped it by order_id and status (146,621 rows) and was adopted: grain had not fired on the
    original, so it was not asked of the repair. Asked of every repair, it is caught."""
    from pramanyx.routers import investigations as inv

    question = "What is total GMV by order status?"
    original = "SELECT status, ROUND(SUM(gmv_eur), 2) AS total_gmv_eur FROM orders GROUP BY status"
    ask = dict(question=question, dialect="postgres", full_cols={}, schema_cols={})
    assert "grain" in inv._REPAIR_CHECKS
    assert inv._checks_still_firing(original, set(inv._REPAIR_CHECKS), **ask) == []      # the original passes
    assert inv._checks_still_firing(_RECEIPT, set(inv._REPAIR_CHECKS), **ask) == ["grain"]
    # What the old re-check asked: only what had fired on the original — nothing, here.
    assert inv._checks_still_firing(_RECEIPT, set(), **ask) == []
    # The path asks all of them, and a check the original passed stops the repair being adopted.
    import inspect
    src = inspect.getsource(inv)
    assert "set(_REPAIR_CHECKS)" in src and "which the original did not" in src


# ── the result, against what was asked (the gate between the rows and the headline) ──────────────────────────────

from pramanyx.sql.grain_intent import result_finer_than_asked as shape  # noqa: E402

_Q = "What is total GMV by order status?"
_PER_ORDER = [[i, s, 10.0] for i, s in enumerate(["shipped", "returned", "cancelled"] * 4)]


def test_the_receipts_result_is_caught_and_said_two_ways():
    got = shape(_Q, ["order_id", "status", "total_gmv_eur"], _PER_ORDER)
    assert got and (got.rows, got.distinct, got.asked, got.also) == (12, 3, ["status"], ["order_id"])
    assert "group by status only" in got.diagnosis                                  # for the model that repairs
    assert got.said == ("The question asks for a total by order status. This result has 12 rows for 3 distinct "
                        "status, because it is also broken down by order_id.")     # for the person reading


@pytest.mark.parametrize("question, columns, rows", [
    # one row per value of what was asked: right
    (_Q, ["status", "sum_gmv_eur"], [["shipped", 1.0], ["returned", 2.0], ["cancelled", 3.0]]),
    # extra MEASURES beside the dimension are not a finer breakdown
    ("What is the return rate by platform?", ["platform", "items", "returned_items", "rate"], [["a", 5, 1, 0.2], ["b", 9, 3, 0.33]]),
    # two dimensions asked, both present, each combination once
    ("Total revenue by store and month", ["store", "month", "revenue"], [["s1", "jan", 1], ["s1", "feb", 2], ["s2", "jan", 3]]),
    # the question asks per row
    ("What is the total for each order by status?", ["order_id", "status", "total"], _PER_ORDER),
    # the extra column is asked for elsewhere in the question
    ("Monthly revenue by channel", ["month", "channel", "revenue"], [["jan", "web", 1], ["feb", "web", 2], ["jan", "store", 3]]),
    ("Total sales by region for each segment", ["region", "segment", "sales"], [["n", "a", 1], ["n", "b", 2]]),
    ("Total sales by region, split by segment too", ["region", "segment", "sales"], [["n", "a", 1], ["n", "b", 2]]),
    # the key is asked for by name
    ("Total GMV of orders by order id and status", ["order_id", "status", "total"], _PER_ORDER),
    # the dimension is not among the columns by that name: not this check's call
    ("Total GMV by shop", ["platform", "gmv"], [["a", 1], ["a", 2]]),
    # no aggregate asked, no breakdown named, or a single row
    ("List orders by status", ["order_id", "status"], [[1, "x"], [2, "x"]]),
    ("What is total GMV?", ["status", "gmv"], [["x", 1], ["x", 2]]),
    (_Q, ["status", "gmv"], [["shipped", 1.0]]),
])
def test_what_is_right_or_not_this_checks_call_passes(question, columns, rows):
    assert shape(question, columns, rows) is None


def test_the_answer_path_asks_it_of_the_first_result_of_a_repair_and_of_what_is_shown():
    """Wiring guard: a check nothing calls is the gap this closes. Asked three times — of the first result (to ask
    for a repair), of the repair's result (to adopt it or not), and of the rows about to be shown (to say so)."""
    import inspect

    from pramanyx.routers import investigations as inv
    src = inspect.getsource(inv._answer_core)
    assert src.count("_finer_than_asked(question,") == 3
    assert '"said_not_as_asked"' in src and "NOT_AS_ASKED_HEADLINE" in src
    assert 'emit("inspect_warning", {"issues": [_not_as_asked.said]' in src


def test_naming_the_entity_that_is_counted_is_not_asking_for_a_row_each():
    """Found by running the answer path for real: "how many orders are there by status" names orders, and the first
    version took that as asking for the order_id column."""
    assert shape("how many orders are there by status", ["order_id", "status", "orders"], _PER_ORDER) is not None
