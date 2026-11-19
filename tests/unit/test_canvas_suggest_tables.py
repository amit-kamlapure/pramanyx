"""Start by describing it: the tables a model proposes for a canvas are held to the tables the page offers."""
from __future__ import annotations

from pramanyx.routers.canvas import MAX_PROPOSED_TABLES, proposed_tables

OFFERED = ["sales.orders", "sales.returns", "people.users", "ops.orders_archive"]


def test_a_name_is_kept_as_the_page_spells_it():
    assert proposed_tables(["SALES.ORDERS", "returns", '"users"'], OFFERED) == ["sales.orders", "sales.returns", "people.users"]


def test_a_table_the_page_does_not_offer_is_never_proposed():
    assert proposed_tables(["secrets.salaries", "sales.orders"], OFFERED) == ["sales.orders"]


def test_a_bare_name_that_could_mean_two_tables_is_left_out():
    assert proposed_tables(["orders"], ["sales.orders", "archive.orders"]) == []


def test_each_table_is_proposed_once_in_the_order_named():
    assert proposed_tables(["returns", "sales.returns", "orders"], ["sales.orders", "sales.returns"]) == ["sales.returns", "sales.orders"]


def test_a_proposal_is_capped():
    many = [f"t{i}" for i in range(MAX_PROPOSED_TABLES + 5)]
    assert len(proposed_tables(many, many)) == MAX_PROPOSED_TABLES
