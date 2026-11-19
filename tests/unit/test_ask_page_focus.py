"""The Ask panel's page as a question's focus: a table open in the Catalog, or the statement open in the SQL Editor."""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

import pramanyx.routers.investigations as I


def _ask(**focus):
    return SimpleNamespace(focus=I.AskFocus(**focus))


def test_the_statement_in_the_editor_is_handed_over_as_the_readers_own_words():
    said = I._focus_prose_for(_ask(kind="query", sql="SELECT type, COUNT(*) FROM netflix_titles GROUP BY 1"), "sheets")
    assert "SQL Editor" in said and "SELECT type, COUNT(*) FROM netflix_titles GROUP BY 1" in said
    assert "not yet checked or run" in said


def test_a_table_in_the_catalog_is_described_as_the_reader_may_read_it(monkeypatch):
    import pramanyx.agent.converse_tools as C
    seen = {}
    monkeypatch.setattr(C, "describe_table", lambda conn, args, **kw: seen.update(conn=conn, **args) or {"table": "main.orders", "columns": ["id"]})
    said = I._focus_prose_for(_ask(kind="table", id="orders"), "workspace")
    assert seen == {"conn": "workspace", "table": "orders"}
    assert "main.orders" in said and "describe_table" in said


def test_a_table_no_longer_there_is_said(monkeypatch):
    import pramanyx.agent.converse_tools as C
    monkeypatch.setattr(C, "describe_table", lambda conn, args, **kw: {"table": "gone", "error": "no such table"})
    assert "does not hold" in I._focus_prose_for(_ask(kind="table", id="gone"), "workspace")


def test_a_table_that_cannot_be_read_leaves_the_turn_a_plain_conversation(monkeypatch):
    import pramanyx.agent.converse_tools as C
    def broken(*a, **k):
        raise RuntimeError("down")
    monkeypatch.setattr(C, "describe_table", broken)
    assert I._focus_prose_for(_ask(kind="table", id="orders"), "workspace") == ""


def test_each_names_what_it_is_about():
    with pytest.raises(ValidationError):
        I.AskFocus(kind="table")
    with pytest.raises(ValidationError):
        I.AskFocus(kind="query", sql="   ")
