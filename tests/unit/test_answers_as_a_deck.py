"""Several answers as one deck (punch list 92, 2026-11-18): a conversation's answers, in the order asked, each drawn
from its stored report as its own export draws it, and each figure citing its own answer's receipt."""
from __future__ import annotations

import io

import pytest

pptx = pytest.importorskip("pptx")

from pramanyx import export as E  # noqa: E402


def _inv(question: str, receipt: str, rows: list[list]) -> dict:
    return {"id": receipt, "kind": "chat", "question": question, "connection_id": "c1",
            "report": {"headline": question, "insight": {"narrative": f"About {question}"},
                       "columns": ["city", "orders"], "rows": rows, "chart_type": "table",
                       "envelope": {"provenance": {"receipt_id": receipt}}}}


def _slides(data: bytes) -> list[str]:
    deck = pptx.Presentation(io.BytesIO(data))
    return [" | ".join(sh.text_frame.text for sh in s.shapes if sh.has_text_frame) for s in deck.slides]


def test_a_deck_holds_each_answer_in_the_order_asked_each_citing_its_own_receipt():
    data, name, media = E.export_answers(
        [_inv("Orders by city", "rcpt-one", [["Mumbai", 910], ["Pune", 400]]),
         _inv("Returns by city", "rcpt-two", [["Mumbai", 12]])],
        title="This week's questions")
    assert name == "this-week-s-questions.pptx" and media.endswith("presentationml.presentation")
    slides = _slides(data)
    assert slides[0].startswith("This week's questions") and "2 answers" in slides[0]
    first = next(i for i, t in enumerate(slides) if t.startswith("1 of 2"))
    second = next(i for i, t in enumerate(slides) if t.startswith("2 of 2"))
    assert first < second and "Orders by city" in slides[first] and "Returns by city" in slides[second]
    assert any("rcpt-one" in t for t in slides[first:second]) and not any("rcpt-two" in t for t in slides[first:second])
    assert any("rcpt-two" in t for t in slides[second:]) and not any("rcpt-one" in t for t in slides[second:])


def test_a_deck_of_one_is_named_by_its_answer_and_an_empty_or_long_one_is_refused():
    _, name, _ = E.export_answers([_inv("Orders by city", "r1", [["Mumbai", 910]])])
    assert name == "orders-by-city.pptx"
    with pytest.raises(ValueError):
        E.export_answers([])
    with pytest.raises(ValueError):
        E.export_answers([_inv("q", "r", [])] * (E.MAX_ANSWERS + 1))


def test_the_route_refuses_an_answer_that_is_gone_and_reads_each_in_the_order_given(monkeypatch):
    from fastapi.testclient import TestClient
    from pramanyx.api import app
    from pramanyx.routers import investigations as R

    kept = {"a": _inv("Orders by city", "ra", [["Mumbai", 910]]), "b": _inv("Returns by city", "rb", [["Pune", 3]])}
    monkeypatch.setattr(R, "get_investigation", lambda i: kept.get(i))
    client = TestClient(app)
    assert client.get("/exports/answers", params={"ids": ""}).status_code == 400
    assert client.get("/exports/answers", params={"ids": ",".join(f"x{i}" for i in range(31))}).status_code == 400
    gone = client.get("/exports/answers", params={"ids": "a,zz"})
    assert gone.status_code == 404 and "zz" in gone.json()["detail"]
    r = client.get("/exports/answers", params={"ids": "b,a,b", "title": "Two"})
    assert r.status_code == 200, r.text
    slides = _slides(r.content)
    assert "Returns by city" in next(t for t in slides if t.startswith("1 of 2"))
    assert "Orders by city" in next(t for t in slides if t.startswith("2 of 2"))


def test_the_coworker_s_tool_reads_each_answer_names_the_missing_and_hands_back_the_download(monkeypatch):
    import asyncio

    from pramanyx.mcp.client import PramanyxClient, PramanyxError

    api = PramanyxClient(base_url="http://x")
    kept = {"a": {"question": "Orders by city"}, "b": {"question": "Returns by city"}}

    async def fake_get(path, params=None):
        inv_id = path.rsplit("/", 1)[-1]
        if inv_id not in kept:
            raise PramanyxError("404")
        return kept[inv_id]
    monkeypatch.setattr(api, "_get", fake_get)
    got = asyncio.run(api.deck_of_answers(["b", "gone", "a", "b"], title="This week"))
    assert got["missing"] == ["gone"]
    assert [a["id"] for a in got["deck"]["answers"]] == ["b", "a"]
    assert got["deck"]["download"] == "/exports/answers?ids=b%2Ca&title=This+week" and got["deck"]["title"] == "This week"
    assert asyncio.run(api.deck_of_answers([]))["deck"] is None
    assert asyncio.run(api.deck_of_answers(["gone"]))["deck"] is None
