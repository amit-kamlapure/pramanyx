"""A quick answer's title is the narrator's sentence, written once the rows are read (the user, 2026-11-23: "Title:
the answer in one sentence, with its figure; never a caution or a query label").

The coder writes its headline with the SQL, before the query runs, so it names the subject — "Order counts by
fulfillment status", "Monthly completed-order revenue trend (last 12 months)" on theLook — and cannot state a figure it
has not seen. The narrator, which already read the rows for the narrative in the same call, writes the title; it is
kept only when every figure in it is in the rows, and the guards' cautions ride on after it.

Hermetic: the coder and the narrator are stubbed (no LLM), on the real `/chat` runtime.
"""
from __future__ import annotations

import json
import time

import pytest
from fastapi.testclient import TestClient

from pramanyx.routers.investigations import _caution_tail, _narrated_title

_LABEL = "Value by group"
# highest first, as a question about who leads is answered
_SQL = "SELECT * FROM (VALUES ('South', 400), ('North', 200)) AS t(region, revenue) ORDER BY revenue DESC"
_ROWS = [["South", 400], ["North", 200]]


def _stream(client, conn_id, question):
    events = []
    with client.stream("POST", "/chat", json={"connection_id": conn_id, "question": question, "mode": "ask"}) as r:
        assert r.status_code == 200, r.text
        t0 = time.monotonic()
        for line in r.iter_lines():
            if line and line.startswith("data:"):
                try:
                    events.append(json.loads(line[5:].strip()))
                except Exception:
                    continue
            if time.monotonic() - t0 > 60:
                pytest.fail("/chat did not finish in time")
    return events


def _stub(monkeypatch, title: str):
    import pramanyx.llm.provider as prov
    from pramanyx.routers.investigations import _ChatAnswer, _PostAnswer

    said = _PostAnswer(headline=title, narrative="**South** carries two thirds of it.", anomalies=[],
                       trend="stable", confidence="high", questions=["By month?"])

    class FakeCoder:
        def complete(self, system=None, user=None, response_model=None, temperature=0.1, **kw):
            if response_model is _ChatAnswer:
                return _ChatAnswer(sql=_SQL, headline=_LABEL)
            return response_model()

        def complete_streaming(self, *, system, user, response_model, temperature=0.0, text_field, on_text):
            return self.complete(system=system, user=user, response_model=response_model)

    class FakeNarrator:
        def complete(self, system=None, user=None, response_model=None, temperature=0.1, **kw):
            return said if response_model is _PostAnswer else response_model()

        def complete_streaming(self, *, system, user, response_model, temperature=0.0, text_field, on_text):
            on_text(said.narrative)
            return said

    fakes = {"coder": FakeCoder()}
    monkeypatch.setattr(prov, "get_provider", lambda role="coder", **kw: fakes.get(role, FakeNarrator()))


def _headlines(events):
    return [e["headline"] for e in events if e.get("type") == "headline"]


def test_the_narrators_title_replaces_the_coders_label_and_is_what_history_keeps(client: TestClient, builtin_conn_id,
                                                                                 monkeypatch):
    _stub(monkeypatch, "South leads with 400 of the 600 in revenue.")
    events = _stream(client, builtin_conn_id, "revenue by region")
    types = [e["type"] for e in events]
    assert "error" not in types, events
    said = _headlines(events)
    assert said[0] == _LABEL, "the coder's headline ships with the rows, before done"
    assert said[-1] == "South leads with 400 of the 600 in revenue."
    assert types.index("done") < len(types) - 1 - types[::-1].index("headline"), "the title follows the rows' reading"
    inv_id = next(e["inv_id"] for e in events if e.get("type") == "done")
    from pramanyx.db.history import get_investigation
    stored = get_investigation(inv_id)
    assert stored and stored["headline"] == said[-1], "a reload shows the title the reader was shown"


def test_a_title_stating_a_figure_the_rows_do_not_hold_is_not_used(client: TestClient, builtin_conn_id, monkeypatch):
    _stub(monkeypatch, "South leads with 4,750 in revenue.")
    events = _stream(client, builtin_conn_id, "revenue by region")
    assert _headlines(events) == [_LABEL]


def test_the_check_on_a_title():
    columns = ["region", "revenue"]
    assert _narrated_title("**South** leads with **400** in revenue.", columns, _ROWS, _SQL) == \
        "South leads with 400 in revenue."
    assert _narrated_title("Revenue totals 600 across 2 regions.", columns, _ROWS, _SQL), "a total of the rows is theirs"
    assert _narrated_title("South leads with 4,750 in revenue.", columns, _ROWS, _SQL) == "", "a figure in no row"
    assert _narrated_title("North leads with 400 in revenue.", columns, _ROWS, _SQL) == "", "a figure beside the wrong row"
    assert _narrated_title("South leads the regions.", columns, _ROWS, _SQL) == "", "a title states its figure"
    assert _narrated_title("South leads with 400 in revenue.", columns, [], _SQL) == "", "no rows, no title"
    assert _narrated_title(" ".join(["word"] * 31) + " 400", columns, _ROWS, _SQL) == "", "a title is a sentence"
    assert _narrated_title("South leads with 400 — caution: a measure may be summed at the wrong grain",
                           columns, _ROWS, _SQL) == "South leads with 400", "a copied caution is not the title's"


def test_the_guards_cautions_ride_on_after_the_title():
    cautioned = ("Value by group — caution: this total multiplies a measure by an id/key column, so the magnitude is "
                 "not trustworthy.")
    assert _caution_tail(cautioned) == (" — caution: this total multiplies a measure by an id/key column, so the "
                                        "magnitude is not trustworthy.")
    assert _caution_tail("Value by group — note: this value varies across the data and is not uniform across every "
                         "row.").startswith(" — note:")
    assert _caution_tail("Value by group") == ""
