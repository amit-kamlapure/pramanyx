"""What an answer stood on, read from its receipt's lineage for a person to open beside the answer."""
from __future__ import annotations

from pramanyx.trust.lineage_edges import sources_from_lineage


def test_it_names_each_kind_of_source_once():
    got = sources_from_lineage([
        {"relation": "metric_used", "ref": "metric:net_revenue"},
        {"relation": "metric_used", "ref": "metric:net_revenue"},
        {"relation": "grounded_in_graph", "ref": "glossary_term:definition:active-customer", "detail": "Active customer"},
        {"relation": "grounded_in_graph", "ref": "table:Order"},
        {"relation": "input", "ref": "table:orders"},
        {"relation": "input", "ref": "table:sales.users"},
    ])
    assert got == {"metrics": [{"name": "net_revenue", "departed": False}], "definitions": ["Active customer"],
                   "objects": ["Order", "sales.users"]}


def test_a_metric_the_answer_departed_from_says_so_whichever_edge_came_first():
    for edges in (["metric_used", "metric_drift"], ["metric_drift", "metric_used"]):
        got = sources_from_lineage([{"relation": r, "ref": "metric:margin"} for r in edges])
        assert got["metrics"] == [{"name": "margin", "departed": True}]


def test_a_definition_without_words_is_named_from_its_reference():
    got = sources_from_lineage([{"relation": "grounded_in_graph", "ref": "glossary_term:definition:gross-margin"}])
    assert got["definitions"] == ["gross margin"]


def test_a_link_between_objects_opens_as_neither():
    assert sources_from_lineage([{"relation": "grounded_in_graph", "ref": "table:Order-->table:User"}])["objects"] == []


def test_a_receipt_with_no_lineage_stood_on_nothing_it_can_name():
    assert sources_from_lineage([]) == {"metrics": [], "definitions": [], "objects": []}
