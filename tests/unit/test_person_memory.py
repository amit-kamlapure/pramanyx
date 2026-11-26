"""Punch list 90 (2026-11-18): a person's private memory. "Remember I prefer figures in EUR" is kept as theirs — read
into each of their own questions, said where it shaped the answer — and is no one else's: not another person's prompt,
not the connection's prior, not on another person's Memory page, not theirs to revoke. Kept in the ambiguity ledger's
person rows, not as a Record claim (claim events are subscribable and carry their text)."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from pramanyx.org.context import reset_user_id, set_user_id
from pramanyx.semantic import ambiguity_ledger as L


@pytest.fixture()
def as_person():
    tokens = []

    def be(who: str) -> None:
        tokens.append(set_user_id(who))
    yield be
    for t in reversed(tokens):
        reset_user_id(t)


def test_a_memory_is_its_persons_alone(as_person):
    kept = L.remember_for("Ana@Example.com", "  I prefer figures   in EUR ")
    assert kept is not None and kept.resolved_reading == "I prefer figures in EUR" and kept.person == "ana@example.com"
    assert [m.resolved_reading for m in L.memories_of("ana@example.com")] == ["I prefer figures in EUR"]
    assert L.memories_of("bo@example.com") == []
    assert L.owner_of(kept.id) == "ana@example.com"
    assert all(r.person != "ana@example.com" for r, _ in L.retrieve_resolutions("figures in EUR please", ""))
    assert L.remember_for("", "x") is None and L.remember_for("ana@example.com", "  ") is None


def test_it_is_read_into_its_persons_questions_only(as_person):
    from pramanyx.agent.grounding import person_memory
    L.remember_for("cy@example.com", "When I say revenue I mean net revenue")
    as_person("cy@example.com")
    block = person_memory()
    assert block.startswith("WHAT THE PERSON ASKING ASKED YOU TO REMEMBER — theirs alone.")
    assert "- When I say revenue I mean net revenue" in block and "as you asked me to remember" in block
    as_person("dee@example.com")
    assert person_memory() == ""


def test_the_memory_page_and_its_revoke_treat_another_persons_row_as_absent(as_person):
    from pramanyx.routers import learning as R
    as_person("eve@example.com")
    mine = R.remember(R.RememberIn(text="I look after the North region"))
    assert R.my_memories()["memories"][0]["text"] == "I look after the North region"
    as_person("fay@example.com")
    assert R.my_memories()["memories"] == []
    assert all(r.get("person") in ("", "fay@example.com") for r in R.get_resolutions(""))
    with pytest.raises(HTTPException) as e:
        R.forget(mine["id"])
    assert e.value.status_code == 404
    as_person("eve@example.com")
    R.forget(mine["id"])
    assert R.my_memories()["memories"] == []


# ── 2026-11-26: a newer memory replaces the older one it changes, which is kept as history ─────────────────────────

def test_a_memory_that_changes_another_replaces_it_and_the_older_is_kept_as_history(as_person):
    from pramanyx.agent.grounding import person_memory
    eur = L.remember_for("gil@example.com", "I prefer figures in EUR")
    north = L.remember_for("gil@example.com", "I look after the North region")
    usd = L.remember_for("gil@example.com", "I prefer figures in USD", replaces=eur.id)
    assert {m.resolved_reading for m in L.memories_of("gil@example.com")} == {
        "I prefer figures in USD", "I look after the North region"}
    kept = {m.id: m for m in L.memories_of("gil@example.com", include_replaced=True)}
    assert kept[eur.id].superseded_at and "I prefer figures in USD" in kept[eur.id].superseded_why
    assert kept[usd.id].superseded_at is None and kept[north.id].superseded_at is None
    as_person("gil@example.com")
    block = person_memory()
    assert "- I prefer figures in USD" in block and "EUR" not in block      # the two no longer both reach a question


def test_replacing_what_is_not_theirs_keeps_nothing(as_person):
    hal = L.remember_for("hal@example.com", "Bars largest first")
    with pytest.raises(L.MemoryNotTheirs):
        L.remember_for("ida@example.com", "Bars smallest first", replaces=hal.id)
    assert L.memories_of("ida@example.com") == []
    assert [m.resolved_reading for m in L.memories_of("hal@example.com")] == ["Bars largest first"]
    gone = L.remember_for("hal@example.com", "Lines, not bars")
    L.supersede_resolution(gone.id, "x", org_id="")
    with pytest.raises(L.MemoryNotTheirs):                               # already replaced: not current
        L.remember_for("hal@example.com", "Areas, not lines", replaces=gone.id)


def test_the_same_words_again_replace_nothing(as_person):
    one = L.remember_for("jo@example.com", "figures in EUR please")
    again = L.remember_for("jo@example.com", "please figures in EUR", replaces=one.id)
    assert again.id == one.id
    assert [m.resolved_reading for m in L.memories_of("jo@example.com")] == ["please figures in EUR"]


def test_the_door_replaces_says_which_and_lists_the_history(as_person):
    from pramanyx.routers import learning as R
    as_person("kai@example.com")
    first = R.remember(R.RememberIn(text="I look after the North region"))
    assert "replaced" not in first
    second = R.remember(R.RememberIn(text="I look after the South region", replaces=first["id"]))
    assert second["replaced"] == {"id": first["id"], "text": "I look after the North region"}
    read = R.my_memories()
    assert [m["text"] for m in read["memories"]] == ["I look after the South region"]
    assert "replaced" not in read
    history = R.my_memories(history=True)["replaced"]
    assert [(h["id"], h["text"]) for h in history] == [(first["id"], "I look after the North region")]
    assert history[0]["replaced_at"] and "South" in history[0]["why"]
    with pytest.raises(HTTPException) as e:
        R.remember(R.RememberIn(text="I look after the East region", replaces=first["id"]))   # replaced already
    assert e.value.status_code == 404
    assert [m["text"] for m in R.my_memories()["memories"]] == ["I look after the South region"]


def test_beyond_the_newest_the_older_memories_are_said_to_be_left_out(as_person):
    from pramanyx.agent.grounding import person_memory
    from pramanyx.routers import learning as R
    from pramanyx.org.context import current_org_id
    n = L.READ_INTO_EACH_QUESTION + 2
    for i in range(n):
        said = f"keep rule{i:02d} in mind"              # one row each: a memory's key is its words' tokens
        L.save_resolution(L.AmbiguityResolution(
            connection_id="", org_id=current_org_id() or "", dim_kind="AmbiIntent", dim_facet=L.MEMORY,
            subject=said, resolved_reading=said,
            resolution_source="user", person="lee@example.com", created_at=f"2026-01-{i + 1:02d}T00:00:00+00:00"))
    as_person("lee@example.com")
    block = person_memory()
    assert f"- keep rule{n - 1:02d} in mind" in block and "- keep rule00 in mind" not in block
    assert "2 older memories of theirs not read into this question" in block
    read = R.my_memories()
    assert read["read_into_each_question"] == L.READ_INTO_EACH_QUESTION
    assert [m["read_in"] for m in read["memories"]] == [True] * L.READ_INTO_EACH_QUESTION + [False, False]
