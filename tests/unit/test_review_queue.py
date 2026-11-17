"""One list of what waits on a person for a connection's knowledge (Phase 3, 2026-11-17).

Receipts: the view stores nothing — it folds the stores that hold gaps, candidates and conflicts, busiest first; each
row names its area's owners and the page it is decided on; one area narrows it (a conflict spanning that area kept);
a source that could not be read is named, never taken for empty. Read against real stores: a Definition draft and a
suggested edit open the Definition's page; a word published differently in two areas is a conflict; an import's
pending candidates are one row that opens the Import tab.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from pramanyx.knowledge import review as R
from pramanyx.record import writers as W
from pramanyx.semantic import areas as A


def _conn() -> str:
    return "c" + uuid.uuid4().hex[:8]


AREAS = [{"id": "finance", "name": "Finance", "business_owners": ["user:ana"], "technical_owners": ["group:data"]},
         {"id": "marketing", "name": "Marketing", "business_owners": ["user:bo"], "technical_owners": []}]


@pytest.fixture()
def areas(monkeypatch):
    monkeypatch.setattr(A, "areas_for", lambda c, schema=None, workspace_id=None: AREAS)


def _fake(rows):
    return lambda conn, link: [R._row(href=link["definitions_tab"](), action="look", **r) for r in rows]


def test_busiest_first_with_owners_one_area_and_what_could_not_be_read(monkeypatch, areas):
    def broken(conn, link):
        raise RuntimeError("store down")
    monkeypatch.setattr(R, "SOURCES", (
        ("gaps", _fake([{"source": "framing_miss", "ref": "q1", "kind": "gap", "title": "net sales by store",
                         "count": 4, "at": "2026-11-16"},
                        {"source": "framing_miss", "ref": "q2", "kind": "gap", "title": "rare question", "count": 1,
                         "at": "2026-11-17"}])),
        ("wrong", _fake([{"source": "verdict", "ref": "v1", "kind": "candidate", "title": "Marked wrong: margin",
                          "area": "finance", "complaints": 1, "at": "2026-11-15"}])),
        ("rivals", _fake([{"source": "rival_meanings", "ref": "Active", "kind": "conflict", "title": "Active",
                           "area": "finance,marketing"}])),
        ("broken", broken),
    ))
    out = R.review("c1")
    assert [i["title"] for i in out["items"]] == ["net sales by store", "Marked wrong: margin", "rare question", "Active"]
    assert out["unread"] == ["broken"] and out["sources"] == {"gaps": 2, "wrong": 1, "rivals": 1}
    assert out["by_kind"] == {"gap": 2, "candidate": 1, "conflict": 1} and out["unplaced"] == 2
    wrong = next(i for i in out["items"] if i["source"] == "verdict")
    assert wrong["owners"] == ["group:data", "user:ana"]
    rival = next(i for i in out["items"] if i["kind"] == "conflict")
    assert rival["owners"] == ["group:data", "user:ana", "user:bo"]
    assert {a["id"]: a["waiting"] for a in out["areas"]} == {"finance": 2, "marketing": 1}

    finance = R.review("c1", area="finance")
    assert [i["source"] for i in finance["items"]] == ["verdict", "rival_meanings"]


def test_a_draft_and_a_suggested_edit_open_the_definitions_page(areas):
    conn = _conn()
    W.draft_definition_for(connection_id=conn, term="Big city", text="More than 500 orders.", person="user:ana")
    W.write_definition(connection_id=conn, term="Margin", text="Revenue less cost.", by="user:ana", area="finance")
    W.suggest_definition_edit(connection_id=conn, term="Margin", area="finance", by="user:bo",
                              text="Revenue less cost and returns.")
    rows = {i["source"]: i for i in R.review(conn)["items"]}
    draft, edit = rows["definition_draft"], rows["definition_suggestion"]
    assert draft["title"] == "“Big city”, a draft" and "Drafted by the coworker" in draft["detail"]
    assert draft["resolve"]["href"] == f"/definitions/Big%20city?conn={conn}"
    assert edit["title"] == "A suggested edit to “Margin”" and "user:bo" in edit["detail"]
    assert edit["resolve"]["href"] == f"/definitions/Margin?conn={conn}&area=finance"
    assert edit["owners"] == ["group:data", "user:ana"]


def test_a_word_published_differently_in_two_areas_is_a_conflict(areas):
    conn = _conn()
    W.write_definition(connection_id=conn, term="Active customer", area="finance", text="Paid in the last 30 days.",
                       by="user:ana")
    W.approve_definition(connection_id=conn, term="Active customer", area="finance", by="user:ana")
    W.write_definition(connection_id=conn, term="Active customer", area="marketing", text="Opened an email in 90 days.",
                       by="user:bo")
    W.approve_definition(connection_id=conn, term="Active customer", area="marketing", by="user:bo")
    [group] = A.rival_groups(conn)
    assert group["term"] == "Active customer" and [m["area"] for m in group["meanings"]] == ["finance", "marketing"]
    conflict = next(i for i in R.review(conn)["items"] if i["kind"] == "conflict")
    assert conflict["title"] == "“Active customer” means different things in Finance and Marketing"
    assert conflict["area"] == "finance,marketing"
    # A question still finds the rival the same way (the split kept `rival_meanings` whole).
    assert A.rival_meanings("How many active customers last month?", conn)[0]["term"] == "Active customer"


def test_an_imports_pending_candidates_are_one_row_that_opens_the_import_tab(tmp_path, monkeypatch, areas):
    monkeypatch.setenv("PRAMANYX_INTAKE_DB", str(tmp_path / "intake.db"))
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(tmp_path / "metrics.json"))
    monkeypatch.setenv("PRAMANYX_VOCABULARY_ROOT", str(tmp_path / "vocab"))
    import pramanyx.semantic.connection_kb as kb
    monkeypatch.setattr(kb, "_DATA_DIR", tmp_path / "kb")
    from pramanyx.api import app
    conn = _conn()
    csv = "Metric,Definition,Aliases\nChurn Rate,Share of customers lost in a period.,attrition\n"
    r = TestClient(app).post("/intake/files", files={"file": ("dictionary.csv", csv.encode(), "text/csv")},
                             data={"connection_id": conn, "actor": "ana@example.com"})
    assert r.status_code == 201, r.text
    row = next(i for i in R.review(conn)["items"] if i["source"] == "import")
    assert row["title"] == "2 from dictionary.csv wait for a verdict"
    assert row["detail"] == "1 definition, 1 synonym" and row["count"] == 2
    assert row["resolve"]["href"] == f"/?tab=semantic&semtab=import&conn={conn}"


def test_the_route_serves_the_view(monkeypatch, areas):
    from pramanyx.api import app
    monkeypatch.setattr(R, "SOURCES", (("gaps", _fake([{"source": "framing_miss", "ref": "q", "kind": "gap",
                                                        "title": "q", "count": 2}])),))
    body = TestClient(app).get("/knowledge/cx/review").json()
    assert body["total"] == 1 and body["items"][0]["resolve"]["href"] == "/?tab=semantic&semtab=definitions&conn=cx"
