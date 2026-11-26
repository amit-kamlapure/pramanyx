"""A Definition placed in an Area holds for every connection the Area spans (the Atlas plan's A8, 2026-11-25): a
published one written on another connection, in an Area this connection is in, is given to this connection's answers —
never a draft, never one placed in no Area, never over this connection's own word for the same thing."""
from __future__ import annotations

import uuid

import pytest

from pramanyx.record import writers as W
from pramanyx.semantic import connection_kb as K


@pytest.fixture
def two(monkeypatch):
    here, there = "c" + uuid.uuid4().hex[:8], "c" + uuid.uuid4().hex[:8]
    areas = {here: [{"id": "orders_sales"}, {"id": "other"}], there: [{"id": "orders_sales"}, {"id": "inventory"}]}
    monkeypatch.setattr("pramanyx.semantic.areas.areas_for", lambda c, schema=None, workspace_id=None: areas.get(c, []))
    return here, there


def _publish(conn, term, area, text):
    """Written by its owner, then published by them — tier "approved"; one written and not published is a draft."""
    W.write_definition(connection_id=conn, term=term, text=text, by="user:ana", area=area)
    assert W.approve_definition(connection_id=conn, term=term, by="user:ana", area=area)


def test_a_published_definition_in_an_area_both_span_is_given_to_the_other_connection(two):
    here, there = two
    _publish(there, "Repeat buyer", "orders_sales", "A customer with two orders or more.")
    _publish(there, "Stock cover", "inventory", "Days of demand on hand.")              # an Area `here` is not in
    _publish(there, "Margin", "", "Revenue less cost.")                                  # in no Area: stays home
    W.draft_definition_for(connection_id=there, term="Churned", text="No order in 90 days.", person="user:ana")
    W.write_definition(connection_id=there, term="Basket", text="What one order holds.", by="user:ana",
                       area="orders_sales")                                              # written, not published
    got = {(e.title, e.connection_id) for e in K.area_entries(here)}
    assert got == {("Repeat buyer", there)}
    assert K.area_entries(there) == [] or all(e.connection_id != there for e in K.area_entries(there))


def test_this_connection_s_own_word_stands_over_one_its_area_gives_it(two):
    here, there = two
    _publish(there, "Repeat buyer", "orders_sales", "Two orders or more.")
    _publish(here, "Repeat buyer", "orders_sales", "Three orders or more, here.")
    assert K.area_entries(here) == []


def test_an_answer_on_this_connection_finds_a_definition_its_area_gives_it(two, monkeypatch):
    here, there = two
    _publish(there, "Repeat buyer", "orders_sales", "A customer with two orders or more.")
    monkeypatch.setattr("pramanyx.semantic.vector_store.collection_count", lambda name: 0)   # the words alone
    found = K._relevant_entries("how many repeat buyers did we have", here)
    assert [(e.title, e.connection_id) for e in found] == [("Repeat buyer", there)]
    block = K._render_block(found, home=here)
    assert "defined on another connection, for every connection its Area spans" in block
