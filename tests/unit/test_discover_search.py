"""Discover's search (the plan's D3): one ranked list over every kind and connection, by meaning and by words, each result
saying why — the question embedded once for every connection's graph, a graph hit trimmed by clearance and counted, one
table on two connections said once, the person's filters applied, and the words standing alone when the embedder cannot
be reached. Hermetic: the readers, the graphs and the embedder are stood in; no store, model or warehouse is read.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from pramanyx.discover import items as I
from pramanyx.discover import search as D
from pramanyx.discover.items import Found, Item, Scope

ORDERS = Item("table", "c1.thelook.orders", "orders", connection_id="c1", connection_name="theLook",
              area="orders_sales", detail={"rows": 124729, "schema": "thelook"})
ORDERS_COPY = Item("table", "c2.main.orders", "orders", connection_id="c2", connection_name="DuckDB",
                   area="orders_sales", detail={"rows": 124729, "schema": "main"})
ITEMS = Item("table", "c1.thelook.order_items", "order_items", connection_id="c1", connection_name="theLook",
             area="orders_sales", detail={"rows": 180713, "schema": "thelook"})
REPEAT = Item("metric", "c1/repeat_purchase_rate", "Repeat Purchase Rate", line="Share of customers who order again",
              connection_id="c1", connection_name="theLook", area="customers", owner="user:ana")
REVENUE = Item("metric", "c1/revenue", "Revenue", connection_id="c1", connection_name="theLook", area="orders_sales")
SALES = Item("dashboard", "c1:ana:sales", "Sales", line="Yours", connection_id="c1", area="orders_sales", owner="ana")
SCOUT = Item("agent", "ua_1", "Anomaly Scout", line="Watches revenue for odd days", connection_id="c1", area="other")


def _scope(conns=None) -> Scope:
    return Scope(None, "user:ana", conns or {"c1": "theLook", "c2": "DuckDB"})


def _node(kind, id_, label, **data):
    return SimpleNamespace(kind=kind, id=id_, label=label, data=data)


@pytest.fixture
def world(monkeypatch):
    """The readers stand in; each connection's graph answers from `hits`; the embedder is counted."""
    found = {"table": Found(items=[ORDERS, ORDERS_COPY, ITEMS]), "metric": Found(items=[REPEAT, REVENUE]),
             "dashboard": Found(items=[SALES]), "agent": Found(items=[SCOUT]), "canvas": Found(withheld=1)}
    for kind in I.KINDS:
        monkeypatch.setitem(I.READERS, kind, (lambda f: (lambda scope: f))(found.get(kind, Found())))
    state = SimpleNamespace(hits={"c1": [], "c2": []}, embedded=[], vectors=[], withhold=set(), embed_fails=False)

    def embed_one(text):
        if state.embed_fails:
            raise ConnectionError("embedder down")
        state.embedded.append(text)
        return [0.1, 0.2]

    def graphs_for_connection(org, conn, build=True):
        assert build is False, "a read never builds a graph"
        return [SimpleNamespace(conn=conn, nodes={"x": 1}, schema_name="")]

    def search_graph(cg, q, top_k=6, vector=None):
        state.vectors.append(vector)
        return [(n, 1.0) for n in state.hits[cg.conn]]

    def trim(nodes, edges, connection_id, schema_name, graph=None):
        kept = [n for n in nodes if n.id not in state.withhold]
        return kept, edges, "withheld" if len(kept) < len(nodes) else ""

    monkeypatch.setattr("pramanyx.semantic.embedder.embed_one", embed_one)
    monkeypatch.setattr("pramanyx.ontology.context_graph_store.graphs_for_connection", graphs_for_connection)
    monkeypatch.setattr("pramanyx.ontology.context_graph_search.merge_graphs", lambda gs: gs[0] if gs else None)
    monkeypatch.setattr("pramanyx.ontology.context_graph_search.search_graph", search_graph)
    monkeypatch.setattr("pramanyx.ontology.context_graph_readback.trim_graph_by_clearance", trim)
    monkeypatch.setattr("pramanyx.org.context.current_org_id", lambda: "default")
    return state


def names(out):
    return [i["name"] for i in out["items"]]


def test_words_name_a_thing_by_its_name_first_its_description_after_and_half_the_words_at_least():
    assert D.words_score(REVENUE, D.words_of("revenue"))[0] == 1.0
    assert D.words_score(REVENUE, D.words_of("rev")) == (1.0, "its name")                       # a word begun
    assert D.words_score(ORDERS, D.words_of("orders"))[0] > 0                                   # its plural
    assert D.words_score(SCOUT, D.words_of("revenue")) == (0.5, "its description")
    assert D.words_score(REVENUE, D.words_of("revenue by margin and returns"))[0] == 0          # one word of three
    assert D.words_of("show me the revenue") == ["revenue"]


def test_meaning_finds_what_the_words_do_not_and_says_why(world):
    world.hits["c1"] = [_node("metric", "metric:repeat_purchase_rate", "repeat_purchase_rate"),
                        _node("finding", "finding:1", "Customers came back less"),                  # not a thing listed
                        _node("glossary_term", "glossary_term:order_items.user_id", "user_id", table="order_items",
                              column="user_id")]
    out = D.search(_scope(), "who buys again")
    assert names(out)[:2] == ["Repeat Purchase Rate", "order_items"]
    assert out["items"][0]["matched"] == ["by meaning", "its description"]   # "…who order again"
    assert out["items"][1]["matched"] == ["its column user_id"]
    assert out["by_meaning"] is True
    assert world.embedded == ["who buys again"] and world.vectors == [[0.1, 0.2], [0.1, 0.2]]   # embedded once, two graphs


def test_found_by_both_ranks_first_and_one_table_on_two_connections_is_said_once(world):
    world.hits["c1"] = [_node("table", "table:orders", "orders")]
    out = D.search(_scope(), "orders")
    assert names(out)[0] == "orders"
    assert out["items"][0]["matched"] == ["by meaning", "its name"]
    assert out["items"][0]["also_on"] == ["DuckDB"]
    assert names(out).count("orders") == 1


def test_the_person_s_filters_apply_and_what_is_withheld_is_counted(world):
    world.hits["c1"] = [_node("metric", "metric:revenue", "revenue"), _node("table", "table:orders", "orders")]
    world.withhold = {"table:orders"}
    out = D.search(_scope(), "revenue", kind="metric")
    assert names(out) == ["Revenue"]
    assert out["withheld"] == {"canvas": 1, "graph": 1}
    assert names(D.search(_scope(), "revenue", area="other")) == ["Anomaly Scout"]
    assert names(D.search(_scope(), "repeat", mine=True)) == ["Repeat Purchase Rate"]


def test_without_the_embedder_the_words_still_find_and_it_is_said(world):
    world.embed_fails = True
    out = D.search(_scope(), "revenue")
    assert "Revenue" in names(out) and "Anomaly Scout" in names(out)
    assert out["by_meaning"] is False
    assert "Searched by words only — the embedder could not be reached" in out["said"]
    assert world.vectors == [[], []]          # each graph read by its words alone, never embedding again
