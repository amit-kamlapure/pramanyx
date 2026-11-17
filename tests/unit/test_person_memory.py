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
    assert R.my_memories() == {"memories": []}
    assert all(r.get("person") in ("", "fay@example.com") for r in R.get_resolutions(""))
    with pytest.raises(HTTPException) as e:
        R.forget(mine["id"])
    assert e.value.status_code == 404
    as_person("eve@example.com")
    R.forget(mine["id"])
    assert R.my_memories() == {"memories": []}
