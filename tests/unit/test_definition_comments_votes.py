"""Definitions, together (the user, 2026-11-25: "comments and votes on Definitions"; a vote says "This is right" only).

A comment is a said claim about the Definition, in the commenter's name, kept through every rewording; its writer may
take it back, its words kept beneath it. A vote is a journal event, the count folded from each person's latest. Both are
a person's own: an agent is refused.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace as NS

import pytest
from fastapi import HTTPException

from pramanyx.record import definition_comments as Cm
from pramanyx.record import definition_votes as V
from pramanyx.record import writers as W


@pytest.fixture
def word():
    conn = f"talk-{uuid.uuid4().hex[:8]}"
    W.write_definition(connection_id=conn, term="Repeat buyer", text="A customer with more than one order.",
                       by="user:ana", area="Customers")
    return conn


def test_a_comment_is_kept_in_its_writers_name_with_who_it_mentions(word):
    said = Cm.comment(word, "repeat buyer", "Customers", "  Does a return count?  @bo, and @cy@example.com  ",
                      by="user:dee")
    assert said["text"] == "Does a return count? @bo, and @cy@example.com" and said["by"] == "user:dee"
    assert said["mentions"] == ["bo", "cy@example.com"]
    Cm.comment(word, "Repeat buyer", "Customers", "Only completed orders.", by="user:ana")
    assert [c["text"] for c in Cm.comments(word, "Repeat buyer", "Customers")] == [
        "Does a return count? @bo, and @cy@example.com", "Only completed orders."]
    assert Cm.comments(word, "Repeat buyer", "") == []                  # another Area's word is another Definition


def test_comments_stay_with_the_definition_through_a_rewording(word):
    Cm.comment(word, "Repeat buyer", "Customers", "Should this include returns?", by="user:dee")
    W.write_definition(connection_id=word, term="Repeat buyer", text="Two or more completed orders.", by="user:ana",
                       area="Customers")
    assert len(Cm.comments(word, "Repeat buyer", "Customers")) == 1


def test_only_its_writer_takes_a_comment_back_and_its_words_are_kept(word):
    said = Cm.comment(word, "Repeat buyer", "Customers", "Typo in the body.", by="user:dee")
    with pytest.raises(Cm.NotTheirs):
        Cm.take_back(word, "Repeat buyer", "Customers", said["id"], by="user:ana")
    assert Cm.take_back(word, "Repeat buyer", "Customers", said["id"], by="user:DEE")
    assert Cm.comments(word, "Repeat buyer", "Customers") == []
    assert Cm.take_back(word, "Repeat buyer", "Customers", said["id"], by="user:dee") is None


def test_a_comment_needs_words_and_a_definition():
    with pytest.raises(ValueError):
        Cm.comment("nowhere", "Repeat buyer", "", "   ", by="user:dee")
    with pytest.raises(Cm.NoSuchDefinition):
        Cm.comment("nowhere", "Repeat buyer", "", "Hello", by="user:dee")


def test_a_vote_counts_each_persons_latest(word):
    V.vote(word, "Repeat buyer", "Customers", by="user:ana")
    V.vote(word, "Repeat buyer", "Customers", by="user:bo")
    V.vote(word, "repeat buyer", "customers", by="user:ana")           # again: still one person
    assert V.votes(word, "Repeat buyer", "Customers", me="user:ana") == {"right": 2, "by": ["ana", "bo"], "mine": True}
    V.vote(word, "Repeat buyer", "Customers", by="user:ana", right=False)
    assert V.votes(word, "Repeat buyer", "Customers", me="user:ana") == {"right": 1, "by": ["bo"], "mine": False}
    assert V.votes(word, "Repeat buyer", "", me="user:bo")["right"] == 0


def test_an_agent_neither_comments_nor_votes(word, monkeypatch):
    from pramanyx.mcp.client import AGENT_HEADER, AGENT_MARK
    from pramanyx.routers import record as R
    agent = NS(headers={AGENT_HEADER: AGENT_MARK}, state=NS(principal=None))
    with pytest.raises(HTTPException) as e:
        R.comment_on_definition(R.DefinitionComment(connection_id=word, term="Repeat buyer", area="Customers",
                                                    text="hi"), None, agent)
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        R.vote_on_definition(R.DefinitionVote(connection_id=word, term="Repeat buyer", area="Customers"), None, agent)
    assert e.value.status_code == 403
