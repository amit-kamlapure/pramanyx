"""The board study (2026-11-16) — a dashboard's focus: a click on a mark is traced to the table and column it is read
from, and every card is asked again cut by it — or says why it is not. Checked against the rows themselves, filtered in
Python, on the seeded e-commerce warehouse.
"""
from __future__ import annotations

import uuid

import pytest

from pramanyx.dashboards import focus as F
from tests.unit.test_dashboard_variables import _Borrowed, client, db, rows  # noqa: F401 — the fixtures, by name

JOINED = ("SELECT c.country AS country, SUM(o.total_amount) AS total FROM ecommerce.orders o "
          "JOIN ecommerce.customers c ON c.customer_id = o.customer_id GROUP BY 1")


# ── what a click stands for ──────────────────────────────────────────────────────────────────────────────────────────

def test_a_column_read_from_a_table_is_traced_to_it():
    assert F.field_of(JOINED, "country", "duckdb") == {"table": "customers", "column": "country", "confidence": "certain"}


#: The seeded warehouse's columns, as sqlglot takes them — what the field route reads off the connection.
COLUMNS = {"ecommerce": {"customers": {"customer_id": "INT", "country": "VARCHAR"},
                         "orders": {"order_id": "INT", "customer_id": "INT", "total_amount": "DOUBLE"}}}
BARE = ("SELECT country, SUM(total_amount) AS total FROM ecommerce.orders o "
        "JOIN ecommerce.customers c ON c.customer_id = o.customer_id GROUP BY 1")


@pytest.mark.parametrize("sql, column, says", [
    (JOINED, "total", "worked out from its table"),
    (JOINED, "nope", "returns no column nope"),
    ("SELECT 'x' AS country FROM ecommerce.customers", "country", "is a count or a constant"),
    ("SELECT country FROM ecommerce.customers UNION ALL SELECT country FROM ecommerce.suppliers", "country",
     "read from more than one place (customers.country, suppliers.country)"),
    (BARE, "country", "Which table country is read from could not be told — the query does not name it"),
    ("SELECT * FROM ecommerce.customers", "country", "SELECT * could not be expanded"),
])
def test_a_column_that_is_not_read_from_one_place_filters_nothing_and_says_so(sql, column, says):
    got = F.field_of(sql, column, "duckdb")
    assert "refused" in got and says in got["refused"], got


@pytest.mark.parametrize("sql", [BARE, "SELECT * FROM ecommerce.customers",
                                 "SELECT x.country FROM (SELECT * FROM ecommerce.customers) x"])
def test_with_the_connection_s_columns_a_column_the_statement_does_not_name_the_table_of_is_traced(sql):
    assert F.field_of(sql, "country", "duckdb", COLUMNS) == {
        "table": "customers", "column": "country", "confidence": "likely" if "(SELECT" in sql else "certain"}


def test_a_column_of_the_one_table_a_statement_reads_is_that_table_s():
    got = F.field_of("SELECT country, COUNT(*) AS n FROM ecommerce.customers GROUP BY 1", "country", "duckdb")
    assert got == {"table": "customers", "column": "country", "confidence": "possible"}


def test_a_value_is_written_by_the_parser_never_pasted():
    p = F.predicate("country", "O'Brien'; DROP TABLE orders; --", "duckdb")
    assert p == "country = 'O''Brien''; DROP TABLE orders; --'"
    assert F.predicate("n", 3, "duckdb") == "n = 3"


def test_a_statement_is_cut_by_each_table_it_reads_and_says_which_it_does_not():
    focus = [F.Focus(table="customers", column="country", value="DE"), F.Focus(table="products", column="brand", value="X")]
    sql, cut = F.cut_statement(JOINED, focus, "duckdb")
    assert "country = 'DE'" in sql
    assert cut["applied"] is False and cut["by"] == ["country = DE"]
    assert "Not cut by brand = X: it reads no products." in cut["why"]
    _, whole = F.cut_statement(JOINED, focus[:1], "duckdb")
    assert whole == {"applied": True, "by": ["country = DE"], "why": ""}


def test_a_focus_is_held_to_its_shape_and_its_size():
    with pytest.raises(Exception):
        F.parsed([{"table": "t", "column": "a b", "value": 1}])
    with pytest.raises(ValueError):
        F.parsed([{"table": "t", "column": "c", "value": i} for i in range(F.MAX_FOCUS + 1)])


# ── over HTTP: a card run with the focus ─────────────────────────────────────────────────────────────────────────────

def _card(conn: str, sql: str, kind: str = "kpi"):
    from pramanyx.cards.models import StoredCard
    from pramanyx.cards.store import upsert_card
    return upsert_card(StoredCard(connection_id=conn, source="authored", kind=kind, title=f"t-{uuid.uuid4().hex[:4]}", sql=sql))


def test_a_card_reading_the_table_is_cut_by_the_focus_and_its_figure_is_never_its_standing_one(client, rows):  # noqa: F811 — the fixtures, by name
    from pramanyx.cards.store import get_card
    conn = f"f{uuid.uuid4().hex[:6]}"
    card = _card(conn, "SELECT SUM(o.total_amount) AS revenue FROM ecommerce.orders o "
                       "JOIN ecommerce.customers c ON c.customer_id = o.customer_id")
    focus = [{"table": "customers", "column": "country", "value": "DE"}]
    run = client.post(f"/cards/{card.id}/run", json={"focus": focus}).json()
    want = sum(float(r["total_amount"]) for r in rows if r["country"] == "DE")
    assert run["error"] is None
    assert run["value"] == pytest.approx(want)
    assert run["cut"] == {"applied": True, "by": ["country = DE"], "why": ""}
    assert "country = 'DE'" in run["ran"]["sql"]
    assert get_card(card.id).refresh.last_value is None                     # the reader's, not the card's
    # the same card unfocused reads every country, and keeps that as its standing value
    whole = client.post(f"/cards/{card.id}/run").json()
    assert whole["value"] == pytest.approx(sum(float(r["total_amount"]) for r in rows))
    assert "cut" not in whole


def test_a_card_that_reads_none_of_the_focus_tables_is_not_cut_and_says_why(client, rows):  # noqa: F811 — the fixtures, by name
    conn = f"f{uuid.uuid4().hex[:6]}"
    card = _card(conn, "SELECT SUM(total_amount) AS revenue FROM ecommerce.orders")
    run = client.post(f"/cards/{card.id}/run", json={"focus": [{"table": "customers", "column": "country", "value": "DE"}]}).json()
    assert run["value"] == pytest.approx(sum(float(r["total_amount"]) for r in rows))
    assert run["cut"]["applied"] is False
    assert run["cut"]["why"] == "Not cut by country = DE: it reads no customers."


def test_a_query_of_a_person_s_own_is_cut_by_the_focus_and_its_figure_is_never_its_standing_one(client, rows):  # noqa: F811 — the fixtures, by name
    from pramanyx.cards.store import get_card
    conn = f"f{uuid.uuid4().hex[:6]}"
    sql = ("SELECT o.order_id, c.country, o.total_amount FROM ecommerce.orders o "
           "JOIN ecommerce.customers c ON c.customer_id = o.customer_id")
    fig = {"as": "figure", "series": [{"column": "total_amount", "agg": "sum"}]}
    card = client.post("/dashboards/queries", params={"connection_id": conn}, json={"sql": sql, "shown": fig}).json()["card"]
    run = client.post(f"/cards/{card['id']}/run", json={"focus": [{"table": "customers", "column": "country", "value": "BR"}]}).json()
    assert run["error"] is None, run
    assert run["shown"]["value"] == pytest.approx(sum(float(r["total_amount"]) for r in rows if r["country"] == "BR"))
    assert run["cut"]["applied"] is True
    assert "country = 'BR'" in run["ran"]["sql"]                              # a literal the parser wrote
    assert get_card(card["id"]).refresh.last_value is None


def test_the_field_a_click_stands_for_is_traced_off_the_card_s_own_statement(client):  # noqa: F811 — the fixtures, by name
    conn = f"f{uuid.uuid4().hex[:6]}"
    card = _card(conn, JOINED, kind="chart")
    assert client.post(f"/cards/{card.id}/field", json={"column": "country"}).json() == {
        "table": "customers", "column": "country", "confidence": "certain"}
    assert "worked out" in client.post(f"/cards/{card.id}/field", json={"column": "total"}).json()["refused"]
    # the connection's own columns trace a column the statement does not name the table of
    bare_card = _card(conn, BARE, kind="chart")
    assert client.post(f"/cards/{bare_card.id}/field", json={"column": "country"}).json() == {
        "table": "customers", "column": "country", "confidence": "certain"}


def test_too_wide_a_focus_is_refused(client):  # noqa: F811 — the fixtures, by name
    conn = f"f{uuid.uuid4().hex[:6]}"
    card = _card(conn, "SELECT 1 AS one")
    many = [{"table": "t", "column": "c", "value": i} for i in range(F.MAX_FOCUS + 1)]
    assert client.post(f"/cards/{card.id}/run", json={"focus": many}).status_code == 422


# ── a metric card: cut by one value on the table its dates are on, measured as itself ────────────────────────────────

def test_a_metric_card_is_cut_by_one_value_on_its_own_table_and_says_why_not_the_rest(monkeypatch):
    import contextlib
    from datetime import date
    from types import SimpleNamespace

    import duckdb

    from pramanyx.briefing import ranges
    from pramanyx.cards.models import StoredCard
    from pramanyx.knowledge import period_brief
    from pramanyx.routers.cards import _metric_card_for_range

    con = duckdb.connect()
    con.execute("CREATE TABLE order_items (id INT, created_at TIMESTAMP, status VARCHAR, sale_price DOUBLE)")
    con.executemany("INSERT INTO order_items VALUES (?,?,?,?)", [
        (1, "2026-08-17 10:00", "Complete", 100.0), (2, "2026-08-20 10:00", "Returned", 50.0),
        (3, "2026-08-26 23:00", "Complete", 30.0), (4, "2026-08-21 10:00", "Cancelled", 999.0)])

    def run_sql(sql):
        cur = con.execute(sql)
        return [d[0] for d in cur.description], cur.fetchall(), None

    monkeypatch.setattr(period_brief, "connection_runner",
                        lambda conn_id, **kw: contextlib.nullcontext((run_sql, "duckdb")))
    metric = SimpleNamespace(name="revenue", version=1, status="approved", tables=[], filters=[], time_kind="flow",
                             time_column="order_items.created_at",
                             sql=("WITH ok AS (SELECT * FROM order_items WHERE status <> 'Cancelled') "
                                  "SELECT SUM(sale_price) AS revenue FROM ok"))
    spec, why = ranges.resolve_range("custom", start=date(2026, 8, 17), end=date(2026, 8, 26), today=date(2026, 9, 26))
    assert spec is not None, why
    card = StoredCard(connection_id="m", source="authored", kind="kpi", title="Revenue", sql="SELECT 1")
    focus = [F.Focus(table="order_items", column="status", value="Complete"),
             F.Focus(table="users", column="country", value="DE"),
             F.Focus(table="ecommerce.order_items", column="id", value=2)]

    run = _metric_card_for_range(card, metric, spec, False, focus)
    assert run["value"] == pytest.approx(130.0)                                 # rows 1 and 3: Complete alone
    assert "status = 'Complete'" in run["ran"]["sql"]
    assert run["cut"] == {"applied": False, "by": ["status = Complete"], "why": (
        "Not cut by country = DE: the metric is measured on order_items, not users. "
        "Not cut by id = 2: a metric is cut by one value at a time.")}
    whole = _metric_card_for_range(card, metric, spec, False, [])
    assert whole["value"] == pytest.approx(180.0) and "cut" not in whole        # Cancelled cut by its own CTE


def test_a_focus_is_cut_with_the_range_a_dashboard_always_sends_and_its_comparison_alike(client, rows, monkeypatch):  # noqa: F811 — the fixtures, by name
    """The body the dashboard sends: a range, ``compare``, the values and filters it holds, and the focus. The range is cut
    on the orders' own date after the focus is cut, so the window it is compared with is cut by the focus too."""
    import datetime as dt

    from pramanyx.briefing.ranges import RangeSpec
    from pramanyx.cards.store import get_card
    spec = RangeSpec(preset="custom", start=dt.date(2024, 1, 1), end=dt.date(2025, 1, 1),
                     previous_start=dt.date(2023, 1, 1), previous_end=dt.date(2024, 1, 1),
                     last_year_start=None, last_year_end=None, as_of=dt.date(2025, 3, 1), lag_days=1, lag_source="test")
    monkeypatch.setattr("pramanyx.briefing.ranges.resolve_for", lambda cid, preset=None, **kw: (spec, ""))
    monkeypatch.setattr("pramanyx.tools.profile_cache.latest_profile_entry",
                        lambda cid: {"tables": {"orders": {"primary_timestamp": "order_date"}}, "columns": {}})
    conn = f"f{uuid.uuid4().hex[:6]}"
    card = _card(conn, "SELECT SUM(o.total_amount) AS revenue FROM ecommerce.orders o "
                       "JOIN ecommerce.customers c ON c.customer_id = o.customer_id")
    run = client.post(f"/cards/{card.id}/run", params={"preset": "custom", "compare": "true"},
                      json={"values": {}, "filters": [], "focus": [{"table": "customers", "column": "country", "value": "DE"}]})
    assert run.status_code == 200, run.text
    run = run.json()

    def total(year):
        return sum(float(r["total_amount"]) for r in rows if r["country"] == "DE" and str(r["order_date"]).startswith(str(year)))
    assert run["scoped"]["standing"] is False, run["scoped"]
    assert run["value"] == pytest.approx(total(2024))
    assert run["previous"]["value"] == pytest.approx(total(2023))           # the comparison is cut by the focus too
    assert run["cut"] == {"applied": True, "by": ["country = DE"], "why": ""}
    assert "country = 'DE'" in run["ran"]["sql"] and "2024-01-01" in run["ran"]["sql"]
    assert get_card(card.id).refresh.last_value is None
    # and the same card, unfocused, for the range: no verdict, every country
    whole = client.post(f"/cards/{card.id}/run", params={"preset": "custom", "compare": "true"},
                        json={"values": {}, "filters": [], "focus": []}).json()
    assert "cut" not in whole
    assert whole["value"] == pytest.approx(sum(float(r["total_amount"]) for r in rows if str(r["order_date"]).startswith("2024")))
