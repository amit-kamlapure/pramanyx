"""Punch list 86 (2026-11-18): knowledge is weighed by the standing of the person behind it in its area — the area's
declared owner first, then the person whose answers there were most often right (their own Right verdicts on answers
drawn from the area's tables). Only within a tier: a draft never stands above a published definition."""
from __future__ import annotations

from types import SimpleNamespace as NS

import pytest

from pramanyx.semantic import areas as A


@pytest.fixture()
def org(monkeypatch):
    monkeypatch.setattr(A, "areas_for", lambda c, s=None, workspace_id=None: [
        {"id": "finance", "name": "Finance", "business_owners": ["ana@example.com"], "technical_owners": []},
        {"id": "marketing", "name": "Marketing", "business_owners": [], "technical_owners": ["user:bo@example.com"]}])
    monkeypatch.setattr(A, "placed_by_people", lambda c: {"tables": {"campaigns": ("marketing", "user:bo")}})
    monkeypatch.setattr("pramanyx.semantic.metric_map.map_for", lambda c, s=None: NS(areas=[
        NS(id="finance", generic=False, words=["revenue", "invoices"])]))
    monkeypatch.setattr("pramanyx.semantic.metric_map.best_areas",
                        lambda t, areas: [(areas[0], "invoices")] if "invoice" in t else [])
    verdicts = {"user:cy@example.com": [{"investigation_id": "i1"}, {"investigation_id": "i2"}, {"investigation_id": "i3"}]}
    monkeypatch.setattr("pramanyx.feedback.verdicts.accepted_by", lambda who, c, limit=200: verdicts.get(
        who if who.startswith("user:") else f"user:{who}", []))
    answers = {"i1": {"report": {"tables_used": ["shop.invoices"]}}, "i2": {"report": {"tables_used": ["invoices"]}},
               "i3": {"report": {"tables_used": ["campaigns"]}}}
    monkeypatch.setattr("pramanyx.db.history.get_investigation", lambda i: answers.get(i))


def test_an_owner_stands_first_and_right_answers_count_in_their_own_area(org):
    assert A.standing("ana@example.com", "finance", "c1") == (1, 0)
    assert A.standing("user:ANA@example.com", "finance", "c1") == (1, 0)          # one person, however spelled
    assert A.standing("bo@example.com", "marketing", "c1") == (1, 0)
    assert A.standing("cy@example.com", "finance", "c1") == (0, 2)               # two right answers on invoices
    assert A.standing("cy@example.com", "marketing", "c1") == (0, 1)             # one on a table placed there
    assert A.standing("ana@example.com", "marketing", "c1") == (0, 0)
    assert A.standing("", "finance", "c1") == (0, 0) and A.standing("ana@example.com", "", "c1") == (0, 0)
    assert A.standing("ana@example.com", "finance", "c1") > A.standing("cy@example.com", "finance", "c1")


def test_within_a_tier_the_owner_s_definition_is_read_first_and_never_across_tiers(org, monkeypatch):
    from pramanyx.semantic import connection_kb as KB

    def entry(name, tier, by, area="finance"):
        return NS(render=lambda: name, standing={"tier": tier, "approved_by": by, "owner": by, "area": area})
    found = [entry("cy's published", "approved", "user:cy@example.com"),
             entry("dee's published", "approved", "user:dee@example.com"),
             entry("ana's draft", "declared", "user:ana@example.com"),
             entry("ana's published", "approved", "user:ana@example.com")]
    monkeypatch.setattr(KB, "_relevant_entries", lambda q, c, top_k=4: found)
    monkeypatch.setattr("pramanyx.semantic.areas.rival_meanings", lambda q, c, person=None: [])
    block = KB.retrieve_for_question("revenue last month", "c1")
    order = [block.index(n) for n in ("ana's published", "cy's published", "dee's published", "ana's draft")]
    assert order == sorted(order), block


def test_a_persons_right_answers_are_read_from_their_own_verdicts(monkeypatch):
    import uuid

    from pramanyx.feedback import verdicts as V
    monkeypatch.setattr("pramanyx.record.writers.approve_answer_claims", lambda *a, **k: None, raising=False)
    conn = "c" + uuid.uuid4().hex[:8]
    for inv, verdict, by in (("i1", "accept", "user:cy@example.com"), ("i2", "reject", "user:cy@example.com"),
                             ("i3", "accept", "user:dee@example.com"), ("i4", "accept", "user:CY@example.com")):
        V.record_verdict(conn, inv, verdict, by=by)
    assert [v["investigation_id"] for v in V.accepted_by("cy@example.com", conn)] == ["i4", "i1"]
    assert V.accepted_by("", conn) == [] and V.accepted_by("cy@example.com", "elsewhere") == []
