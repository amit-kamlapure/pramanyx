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


# ── 2026-11-26: forget everything about me — theirs alone, deleted, and read again to be sure ────────────────────────

def test_forgetting_everything_takes_only_their_own_rows_and_checks_none_is_left(as_person):
    from pramanyx.org.context import current_org_id
    org = current_org_id() or ""
    old = L.remember_for("max@example.com", "I prefer figures in EUR", org_id=org)
    L.remember_for("max@example.com", "I prefer figures in USD", org_id=org, replaces=old.id)
    L.remember_for("max@example.com", "I look after the North region", org_id=org)
    L.keep_meaning("conn-x", "active customer", "finance", person="max@example.com", org_id=org)
    other = L.remember_for("ned@example.com", "Bars largest first", org_id=org)
    shared = L.save_resolution(L.AmbiguityResolution(
        connection_id="conn-x", org_id=org, dim_kind="AmbiValue", dim_facet="literal", subject="total runs",
        resolved_reading="per-match totals", resolution_source="user"))
    gone = L.forget_everything_of("max@example.com", org_id=org)
    assert gone == {"memories": 3, "meanings": 1, "other": 0, "left": 0}      # the replaced one too
    assert L.memories_of("max@example.com", include_replaced=True) == []
    assert L.kept_meanings("conn-x", "max@example.com", org_id=org) == {}
    assert [m.id for m in L.memories_of("ned@example.com")] == [other.id]       # another person's stays
    assert any(r.id == shared.id for r in L.list_resolutions("conn-x", org_id=org))   # the connection's stays
    assert L.forget_everything_of("", org_id=org)["left"] == 0


def test_the_door_forgets_everything_and_says_what_it_did_not_touch(as_person):
    from pramanyx.routers import learning as R
    as_person("ola@example.com")
    R.remember(R.RememberIn(text="I look after the North region"))
    said = R.forget_everything()
    assert said["forgot"]["memories"] == 1 and said["left"] == 0
    assert "conversations" in said["not_touched"] and "schedules" in said["not_touched"]
    assert R.my_memories()["memories"] == [] and R.my_memories(history=True)["replaced"] == []


def test_the_routes_as_the_coworker_calls_them(as_person):
    """Through HTTP, with the bodies the MCP client sends (`pramanyx/mcp/client.py`): routing included, so
    `DELETE /me/memories` and `DELETE /me/memories/{id}` are each the door they say."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from pramanyx.routers import learning as R
    app = FastAPI()
    app.include_router(R.router)
    http = TestClient(app)
    as_person("pia@example.com")
    eur = http.post("/me/memories", json={"text": "I prefer figures in EUR"}).json()
    usd = http.post("/me/memories", json={"text": "I prefer figures in USD", "replaces": eur["id"]})
    assert usd.status_code == 201 and usd.json()["replaced"] == {"id": eur["id"], "text": "I prefer figures in EUR"}
    assert http.post("/me/memories", json={"text": "x y z", "replaces": eur["id"]}).status_code == 404
    north = http.post("/me/memories", json={"text": "I look after the North region"}).json()
    assert http.delete(f"/me/memories/{north['id']}").status_code == 204            # one, by its id
    read = http.get("/me/memories", params={"history": "true"}).json()
    assert [m["text"] for m in read["memories"]] == ["I prefer figures in USD"]
    assert [m["text"] for m in read["replaced"]] == ["I prefer figures in EUR"]
    gone = http.delete("/me/memories")                                              # everything
    assert gone.status_code == 200 and gone.json()["forgot"]["memories"] == 2 and gone.json()["left"] == 0
    assert http.get("/me/memories", params={"history": "true"}).json()["replaced"] == []
