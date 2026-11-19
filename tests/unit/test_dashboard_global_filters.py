"""Global filters (dashboard format v19): what each way of choosing asks of a card, checked against rows in DuckDB, and what a filter
offers a reader. Nothing here touches a live store."""
from __future__ import annotations

import duckdb
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from pramanyx.dashboards import focus as F
from pramanyx.routers import dashboards as R


@pytest.fixture
def con():
    c = duckdb.connect()
    c.execute("CREATE TABLE titles (id INT, kind VARCHAR, score INT, added TIMESTAMP, name VARCHAR)")
    c.executemany("INSERT INTO titles VALUES (?,?,?,?,?)", [
        (1, "Movie", 10, "2021-09-25 08:00", "Love Story"), (2, "Movie", 50, "2021-09-25 23:30", "War"),
        (3, "TV Show", 70, "2021-10-01 00:00", "O'Brien's love"), (4, "Short", 90, "2022-01-01 00:00", "Rain")])
    return c


def _ids(con, **kw) -> list[int]:
    sql, cut = F.cut_statement("SELECT id FROM titles ORDER BY id", [F.Focus(table="titles", **kw)], "duckdb")
    assert cut["applied"] is True, cut
    return [r[0] for r in con.execute(sql).fetchall()]


@pytest.mark.parametrize("kw, want", [
    ({"column": "kind", "op": "in", "values": ["Movie", "Short"]}, [1, 2, 4]),
    ({"column": "kind", "value": "Movie"}, [1, 2]),
    ({"column": "score", "op": "between", "low": 50, "high": 70}, [2, 3]),
    ({"column": "score", "op": "between", "low": 70}, [3, 4]),
    ({"column": "score", "op": "between", "high": 10}, [1]),
    ({"column": "added", "op": "dates", "low": "2021-09-25", "high": "2021-09-25"}, [1, 2]),      # the whole of that day
    ({"column": "added", "op": "dates", "low": "2021-10-01"}, [3, 4]),
    ({"column": "name", "op": "contains", "value": "LOVE"}, [1, 3]),
    ({"column": "name", "op": "contains", "value": "o'brien"}, [3]),                              # a quote is the parser's to escape
    ({"column": "name", "op": "contains", "value": "100%"}, []) ,
])
def test_each_way_of_choosing_keeps_the_rows_it_says(con, kw, want):
    if not want:
        sql, _ = F.cut_statement("SELECT id FROM titles", [F.Focus(table="titles", **kw)], "duckdb")
        assert con.execute(sql).fetchall() == []
        return
    assert _ids(con, **kw) == want


def test_a_filter_reaches_a_table_the_card_does_not_read_through_a_link(con):
    con.execute("CREATE TABLE views (title_id INT, n INT)")
    con.executemany("INSERT INTO views VALUES (?,?)", [(1, 5), (2, 7), (3, 100), (4, 1000)])
    sql, cut = F.cut_statement("SELECT SUM(n) FROM views", [F.Focus(table="titles", column="kind", op="in", values=["Movie"])], "duckdb",
                               links=lambda: [F.Link("views", "title_id", "titles", "id")])
    assert con.execute(sql).fetchone()[0] == 12
    assert cut["through"] == ["kind in Movie, through views.title_id"]


@pytest.mark.parametrize("kw", [
    {"op": "in"}, {"op": "between"}, {"op": "between", "low": "a"}, {"op": "dates"}, {"op": "dates", "low": "soon"},
    {"op": "contains", "value": "  "}, {"op": "like", "value": "x"},
])
def test_a_filter_is_held_to_what_its_way_of_choosing_reads(kw):
    with pytest.raises(ValidationError):
        F.Focus(table="t", column="c", **kw)


@pytest.mark.parametrize("kw, says", [
    ({"op": "in", "values": ["a", "b"]}, "c in a, b"), ({"op": "between", "low": 1, "high": 2}, "c 1 to 2"),
    ({"op": "dates", "low": "2021-01-01"}, "c from 2021-01-01"), ({"op": "contains", "value": "x"}, "c contains x"),
])
def test_a_card_says_what_it_was_cut_by(kw, says):
    assert F.words(F.Focus(table="t", column="c", **kw)) == says


def test_a_clicked_value_reads_as_it_always_did():
    assert F.words(F.Focus(table="t", column="c", value="x")) == "c = x"


# ── what a filter offers ─────────────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def door(con, monkeypatch):
    tables = {"titles": [("_row", "BIGINT"), ("id", "INTEGER"), ("kind", "VARCHAR"), ("added", "TIMESTAMP"), ("two words", "VARCHAR")]}
    monkeypatch.setattr(R, "_filter_tables", lambda _c: (tables, "duckdb"))
    monkeypatch.setattr(R, "_filter_rows", lambda _c, sql: con.execute(sql).fetchall())


def test_the_fields_say_each_column_s_kind_and_count_what_cannot_be_filtered(door):
    got = R.filter_fields("c")["tables"][0]
    assert [(c["name"], c["kind"]) for c in got["columns"]] == [("id", "number"), ("kind", "text"), ("added", "time")]
    assert got["left_out"] == 1


def test_a_filter_lists_the_commonest_values_with_how_many_hold_each(door):
    got = R.filter_values("c", R.FilterValuesRequest(table="titles", column="kind"))
    assert got == {"values": [{"value": "Movie", "n": 2}, {"value": "Short", "n": 1}, {"value": "TV Show", "n": 1}], "more": False} \
        or got["values"][0] == {"value": "Movie", "n": 2}


def test_a_slider_runs_between_the_least_and_the_most(door):
    assert R.filter_values("c", R.FilterValuesRequest(table="titles", column="id", read="range")) == {"low": 1, "high": 4}


def test_a_column_the_connection_does_not_hold_is_refused_by_name(door):
    with pytest.raises(HTTPException) as got:
        R.filter_values("c", R.FilterValuesRequest(table="titles", column="secret"))
    assert got.value.status_code == 422 and "no column secret on titles" in got.value.detail["refused"][0]


@pytest.mark.parametrize("kw, want", [
    ({"value": "love"}, [1, 3]),
    ({"value": "love", "case_sensitive": True}, [3]),
    ({"value": "love story", "match": "exact"}, [1]),
    ({"value": "Love Story", "match": "exact", "case_sensitive": True}, [1]),
    ({"value": "ove", "match": "starts_with"}, []),
    ({"value": "lo", "match": "starts_with"}, [1]),
])
def test_words_are_matched_the_way_the_filter_says(con, kw, want):
    assert _ids(con, column="name", op="contains", **kw) == want


def test_a_linked_filter_offers_only_what_the_other_filters_leave(door):
    got = R.filter_values("c", R.FilterValuesRequest(table="titles", column="kind", focus=[
        {"table": "titles", "column": "id", "value": "", "op": "between", "low": 2, "high": 2}]))
    assert [(v["value"], v["n"]) for v in got["values"]] == [("Movie", 1)]
    bounds = R.filter_values("c", R.FilterValuesRequest(table="titles", column="id", read="range", focus=[
        {"table": "titles", "column": "kind", "value": "Movie"}]))
    assert (bounds["low"], bounds["high"]) == (1, 2)


def test_a_linked_filter_is_held_to_what_a_filter_may_hold(door):
    with pytest.raises(HTTPException) as refused:
        R.filter_values("c", R.FilterValuesRequest(table="titles", column="kind", focus=[{"table": "titles", "column": "bad name", "value": 1}]))
    assert refused.value.status_code == 422
