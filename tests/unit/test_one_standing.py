"""One standing (2026-11-25, the Atlas-by-Area plan's A2): one order for everything an answer may draw on, in place of
orders that disagreed — the platform's ladder put measured above approved, the learned list confirmed above measured.
A thing stands on a person's word, the data's, or both; then published before a draft, certified before plain, its Area
contact's word, the answers that drew on it, the newest — and relevance among what stands equal."""
from __future__ import annotations

from types import SimpleNamespace as NS

from pramanyx.trust.standing import USE_CAP, Standing, order, tier_of


def test_the_tiers_both_then_the_datas_then_a_persons_then_mined_then_said():
    assert tier_of("approved", measured=True) == "both"
    assert tier_of("measured") == "data" and tier_of("verified") == "data"
    assert tier_of("approved") == tier_of("declared") == tier_of("trusted") == "person"
    assert tier_of("mined") == "mined"
    assert tier_of("said") == tier_of("whatever") == "said"
    ranked = order(["said", "mined", "person", "data", "both"], lambda t: Standing(tier=t))
    assert ranked == ["both", "data", "person", "mined", "said"]


def test_within_a_tier_published_then_certified_then_the_contact_then_use_then_newest_and_never_across():
    a = Standing(tier="person", draft=True, uses=99)
    b = Standing(tier="person", vouched="deprecated")
    c = Standing(tier="person")
    d = Standing(tier="person", vouched="certified")
    e = Standing(tier="person", owner_word=True)
    f = Standing(tier="person", uses=3)
    g = Standing(tier="person", as_of="2026-11-20")
    h = Standing(tier="data")
    key = {id(x): n for n, x in zip("abcdefgh", (a, b, c, d, e, f, g, h))}
    ranked = order([a, b, c, d, e, f, g, h], lambda s: s)
    assert [key[id(x)] for x in ranked] == ["h", "d", "e", "f", "g", "c", "b", "a"], \
        "no use lifts a draft over a published word, nor a person's over the data's"


def test_reliance_is_capped_so_popularity_never_swamps_recency_beyond_it():
    many, more = Standing(tier="data", uses=USE_CAP + 400, as_of="2026-01-01"), Standing(tier="data", uses=USE_CAP, as_of="2026-11-01")
    assert order([many, more], lambda s: s) == [more, many]


def test_what_stands_equal_keeps_the_order_it_came_in_and_a_callers_own_tie_breaks_come_before_recency():
    things = [NS(n="first", w=1), NS(n="second", w=1), NS(n="third", w=2)]
    assert [t.n for t in order(things, lambda t: Standing(tier="person"))] == ["first", "second", "third"]
    assert [t.n for t in order(things, lambda t: Standing(tier="person"), lambda t: -t.w)] == ["third", "first", "second"]


def test_it_says_why_in_a_readers_words():
    s = Standing(tier="both", vouched="certified", owner_word=True, uses=1, as_of="2026-11-24T10:00:00")
    assert s.why() == ("a person's word on a measured result · certified · its Area's contact stands behind it · "
                       "used in 1 answer this month · as of 2026-11-24")
    assert Standing(tier="person", draft=True).why("a Definition") == "a Definition · a draft"


def test_a_definition_used_in_more_answers_leads_its_equals_and_never_its_betters(monkeypatch):
    from pramanyx.semantic import connection_kb as K
    monkeypatch.setattr(K, "_behind", lambda e, c: (0, 0))
    uses = {"c1/AOV/": 5, "c1/Revenue/": 1, "c1/Margin/": 40}
    monkeypatch.setattr("pramanyx.discover.usage.answers_of", lambda kind, ref: uses.get(ref, 0))
    entries = [NS(title="Revenue", area="", standing={"tier": "approved"}),
               NS(title="Margin", area="", standing={"tier": "declared"}),
               NS(title="AOV", area="", standing={"tier": "approved"})]
    assert [e.title for e in K.order_definitions(entries, "c1")] == ["AOV", "Revenue", "Margin"]
    assert K.definition_standing(entries[2], "c1").why() == "a person's word · used in 5 answers this month"


def test_the_answers_each_thing_drew_are_read_once_in_five_minutes(monkeypatch):
    from pramanyx.discover import usage as U
    reads = []
    monkeypatch.setattr(U, "opens", lambda kind=U.OPENED, **k: reads.append(kind) or [
        {"kind": "definition", "ref": "c1/Revenue/", "by": "", "at": ""}] * 2)
    assert U.answers_of("definition", "c1/Revenue/") == 2
    assert U.answers_of("definition", "c1/Nothing/") == 0
    assert reads == [U.USED]
