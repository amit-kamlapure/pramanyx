"""A Data Canvas is strict (the user, 2026-11-23).

"Data Canvas is more or less restricted to selected tables and queries" was asked as a question, and answered:
strict — a statement reading a table outside the canvas is refused, and the answer says the question is outside the
canvas, as a Genie Agent's chosen tables work. Before, only the schema text was narrowed (`list_tables`,
`describe_table`, the quick body's prompt) and a statement was pinned to the canvas's schema: `run_sql` read any other
table of that schema, or of another one named in full, and the conversation's prompt never said it was on a canvas.

The hold is at the door every statement passes (`db.connection._security_pre`), set for a turn's whole run by its entry
point (`canvas.scope.held_to_its_canvas` on the conversation, the quick pipeline and the analyst; the deep graph's
copied context), so every path a turn can take is held alike.
"""
from __future__ import annotations

import contextvars
import uuid
from types import SimpleNamespace

import duckdb
import pytest

from pramanyx.canvas import scope as S
from pramanyx.db.connection import open_connection
from pramanyx.db.doors import Held, held, held_to


@pytest.fixture
def wh(tmp_path):
    """A warehouse with the same table name in a staging and a business schema."""
    path = tmp_path / "wh.duckdb"
    con = duckdb.connect(str(path))
    con.execute("CREATE SCHEMA stage; CREATE SCHEMA marts")
    con.execute("CREATE TABLE stage.orders AS SELECT 1 AS id")
    con.execute("CREATE TABLE marts.orders AS SELECT 1 AS order_id, 10.0 AS amount, 1 AS customer_id")
    con.execute("CREATE TABLE marts.customers AS SELECT 1 AS customer_id, 'x' AS name")
    con.close()
    return f"wh-{uuid.uuid4().hex[:8]}", str(path)


ORDERS_ONLY = Held(name="Orders desk", tables=("marts.orders",), schema="marts")


def test_a_table_outside_the_canvas_is_refused_saying_which_and_what_the_canvas_reads(wh):
    conn_id, path = wh
    db = open_connection("duckdb", path, schema_name="marts", connection_id=conn_id)
    with held_to(ORDERS_ONLY):
        refused = db.execute("chat", "SELECT * FROM marts.customers")
        assert refused.error.startswith("[OUTSIDE]")
        assert "marts.customers" in refused.error and "'Orders desk'" in refused.error and "orders" in refused.error
        assert "blocked:canvas" in refused.doors
        assert not db.execute("chat", "SELECT SUM(amount) FROM marts.orders").error
        assert not db.execute("chat", "SELECT SUM(amount) FROM orders").error, "an unqualified name is the door's own"
        joined = db.execute("chat", "SELECT * FROM orders o JOIN customers c USING (customer_id)")
        assert joined.error.startswith("[OUTSIDE]") and "customers" in joined.error
        hidden = db.execute("chat", "WITH c AS (SELECT * FROM marts.customers) SELECT * FROM c")
        assert hidden.error.startswith("[OUTSIDE]"), "a CTE hid the outside table from the door"
        assert db.execute("chat", "SELECT * FROM stage.orders").error.startswith("[OUTSIDE]"), \
            "the same name in another schema is another table"


def test_a_canvas_on_a_whole_schema_reads_all_of_it_and_nothing_beside(wh):
    conn_id, path = wh
    db = open_connection("duckdb", path, schema_name="marts", connection_id=conn_id)
    with held_to(Held(name="Marts", schema="marts")):
        assert not db.execute("chat", "SELECT * FROM marts.customers").error
        assert db.execute("chat", "SELECT * FROM stage.orders").error.startswith("[OUTSIDE]")


def test_outside_a_turn_nothing_is_held_and_the_platforms_own_probes_pass(wh):
    conn_id, path = wh
    db = open_connection("duckdb", path, schema_name="marts", connection_id=conn_id)
    assert not db.execute("chat", "SELECT * FROM marts.customers").error
    with held_to(ORDERS_ONLY):
        probe = db.execute("__explorer__", "SELECT COUNT(*) FROM marts.customers", internal=True)
        assert not probe.error, "a platform probe is not the data a turn answers from"
    assert held() is None, "the hold ends with the turn"


def test_the_hold_rides_the_copied_contexts_a_turns_threads_and_helpers_run_in():
    with held_to(ORDERS_ONLY):
        ctx = contextvars.copy_context()
    assert held() is None
    assert ctx.run(held) == ORDERS_ONLY


def test_a_turns_entry_point_holds_its_canvas_read_from_its_own_arguments(monkeypatch):
    canvas = SimpleNamespace(name="Orders desk", primary_connection_id="wh",
                             scopes=[SimpleNamespace(schema_name="marts", tables=["marts.orders"])])
    monkeypatch.setattr("pramanyx.canvas.store.get_canvas", lambda cid: canvas if cid == "cv1" else None)

    @S.held_to_its_canvas
    def entry(connection_id, question, *, canvas_id=None):
        return held()

    assert entry("wh", "q", canvas_id="cv1") == Held(name="Orders desk", tables=("marts.orders",), schema="marts")
    assert entry("wh", "q") is None, "no canvas holds nothing"
    assert entry("wh", "q", canvas_id="gone") is None, "a canvas that cannot be read holds nothing (fail-open)"
    assert held() is None


def test_the_conversations_pipeline_and_analyst_are_each_held():
    from pramanyx.agent import analyst, converse_tools
    from pramanyx.routers import investigations
    for fn in (converse_tools.converse, analyst.run_analyst, investigations._answer_core):
        assert getattr(fn, "__wrapped__", None) is not None, f"{fn.__name__} is not held to its canvas"


def test_the_conversation_is_told_to_answer_inside_the_canvas_or_say_it_is_outside():
    from pramanyx.agent.converse_tools import route_error
    said = route_error(ORDERS_ONLY.refusal(["marts.customers"]))
    assert said["kind"] == "outside" and said["retryable"] is True
    assert "outside this canvas" in said["instruction"]
