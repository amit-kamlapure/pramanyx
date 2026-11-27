"""Every kind of question at every door, beside the same model given only the schema (`evals/kinds.py`; the plan of
record, 2026-11-27). No test here calls a model: the ask stream and the model are stand-ins, and the run path is shown
never to build a provider."""
from __future__ import annotations

import uuid
from pathlib import Path

import duckdb
import pytest

from pramanyx.evals import kinds as K


def _conn() -> str:
    return "c" + uuid.uuid4().hex[:8]


# ── the case set ─────────────────────────────────────────────────────────────────────────────────────────────────


def test_the_case_set_spans_every_kind_on_both_connections_and_each_reads_as_its_kind():
    from pramanyx.agent.question_shape import asks_what_a_term_means, is_open, question_shape
    assert set(K.CASES) == {"8233e4fd", "dcc63d83"} == set(K.CONNECTIONS)
    least = {"open": 2, "why": 2, "figure": 2, "breakdown": 1, "check": 1, "definition": 1, "follow_up": 1}
    for conn, cases in K.CASES.items():
        counts = {k: sum(1 for c in cases if c["kind"] == k) for k in K.KINDS}
        assert all(counts[k] >= n for k, n in least.items()), (conn, counts)
        assert 9 <= len(cases) <= 12
        for c in cases:
            q = c["question"]
            shape = question_shape(q, default=None)
            want = {"open": "survey", "why": "diagnose", "check": "check"}.get(c["kind"], "describe")
            assert shape == want, (conn, q, shape)
            assert is_open(q) is (c["kind"] == "open"), q
            assert asks_what_a_term_means(q) is (c["kind"] == "definition"), q
            assert bool(c.get("follow_up")) is (c["kind"] == "follow_up"), q
    assert K.CASES["8233e4fd"][0]["question"] == "Show me interesting trends and facts in the data set"


def test_the_cases_are_written_into_the_eval_store_as_a_suite_per_connection():
    from pramanyx.evals import store
    assert K.latest("8233e4fd")["suite"] is None, "reading makes no suite"
    out = K.generate("8233e4fd")
    assert out["cases"] == 10 and out["by_kind"]["open"] == 2 and out["by_kind"]["follow_up"] == 1
    assert K.generate("8233e4fd")["cases"] == 10, "written afresh, not added"
    suite = K.find_suite("8233e4fd")
    assert suite["key"] == "kinds:8233e4fd" and suite["connection_id"] == "8233e4fd"
    rows = store.list_cases(suite["id"])
    assert len(rows) == 10
    follow = next(r for r in rows if r["expected"]["kind"] == "follow_up")
    assert follow["expected"]["follow_up"].startswith("Which of those statuses")
    with pytest.raises(KeyError):
        K.generate("elsewhere")


# ── the doors ────────────────────────────────────────────────────────────────────────────────────────────────────


def test_each_door_sends_the_fields_its_place_sends_plus_the_runs_scope():
    def sent(door, **kw):
        return K.sent_fields(K.ask_request(door, "How many orders?", "c1", schema="thelook", session_id="s1", **kw))

    scope = {"connection_id": "c1", "schema": "thelook", "skip_cache": True}
    assert sent("web") == {**scope, "depth": "auto", "surface": "", "session_id": "s1"}
    assert sent("coworker") == {**scope, "depth": "auto", "allow_clarify": False, "session_id": ""}
    assert sent("coworker_deep") == {**scope, "depth": "deep", "deep": True}, "escalate rides the wire as `deep`"
    assert sent("slack") == {**scope, "depth": "auto", "session_id": "s1"}
    assert sent("agent") == {**scope, "depth": "auto", "allow_clarify": False, "session_id": "s1"}
    assert sent("agent", agent_id="ag1")["agent_id"] == "ag1"
    assert sent("scheduled") == {**scope, "depth": "deep"}
    turn = {"question": "q", "sql": "SELECT 1", "columns": [], "headline": "h", "key_rows": []}
    assert sent("web", history=[turn])["history"][0]["sql"] == "SELECT 1", "a history door carries the earlier turn"
    assert "history" not in sent("slack", history=[turn]), "a session door carries the conversation as its session"


# ── facts and consistency ────────────────────────────────────────────────────────────────────────────────────────


def test_the_facts_of_an_answer_are_read_from_its_own_words_and_rows():
    f = K.facts_of("Revenue in 2025 was 1,234.50 across 3 categories.", "", [["a", 1000.0], ["b", 234.5], ["c", 0]])
    assert f["leading_figure"] == {"text": "1,234.50", "value": 1234.5}, "a year is a date, not the answer's figure"
    assert f["figures_stated"] == ["1,234.50", "3"] and f["headline_empty"] is False
    assert f["figures_in_rows"] == 0, "1,234.50 is a total of the rows, not a cell; 3 is not a cell"
    assert f["grounding"] == {"checked": 1, "ungrounded": []}, "the grounding guard reads a column total as grounded"
    g = K.facts_of("", "There were 42 orders.", [[42]])
    assert g["headline_empty"] is True and g["figures_in_rows"] == 1 and g["leading_figure"]["value"] == 42.0


def test_consistency_says_which_doors_give_the_same_leading_figure():
    def a(v, ran=True):
        return {"ran": ran, "leading_figure": None if v is None else {"text": str(v), "value": v}}

    c = K.consistency({"web": a(100.0), "slack": a(100.4), "agent": a(120.0), "coworker": a(None),
                       "scheduled": a(100.0, ran=False)}, baseline=a(120.0))
    assert c["agree"] is False and c["groups"] == [["web", "slack"], ["agent"]], "within 0.5% is the same figure"
    assert c["without_figure"] == ["coworker", "scheduled"], "a door that failed has no figure to compare"
    assert c["baseline_figure"] == 120.0 and c["baseline_agrees_with"] == ["agent"]
    assert K.consistency({"web": a(7.0), "slack": a(7.0)})["agree"] is True
    assert K.consistency({"web": a(7.0), "slack": a(None)})["agree"] is None, "one figure is nothing to compare"


# ── a run, with the stream and the model stood in ────────────────────────────────────────────────────────────────


def _seen(figure: float, *, error: str = "") -> dict:
    return {"sql": "SELECT 1", "all_sql": ["SELECT 1"], "columns": ["status", "orders"],
            "rows": [["Complete", figure]], "all_rows": [[["Complete", figure]]], "headline": f"There were {figure:,.0f} orders.",
            "error": error, "trace_id": "tr-" + uuid.uuid4().hex[:6], "receipt_id": "rc-1", "tools": ["run_sql"],
            "report": {}, "clarify": "", "route": {"depth": "quick", "question_shape": "describe"},
            "envelope": {"headline": f"There were {figure:,.0f} orders.", "body": "Counted from orders.",
                         "figures": [{"label": "orders", "value": str(figure)}],
                         "provenance": {"path": {"kind": "describe", "depth": "quick", "engine": "quick core"},
                                        "receipt_id": "rc-1", "sql": ["SELECT 1"]}}}


@pytest.fixture
def stood_in(monkeypatch):
    """A connection with one figure case and one follow-up pair; every stream and the model stood in, and building a
    provider fails — so a run that reached a real model would fail the test."""
    conn = _conn()
    monkeypatch.setitem(K.CASES, conn, [
        {"kind": "figure", "question": "How many orders were placed?"},
        {"kind": "follow_up", "question": "How many orders are there in each status?",
         "follow_up": "Which status has the most?"}])
    monkeypatch.setitem(K.CONNECTIONS, conn, {"name": "Shop", "schema": "shop"})

    def no_model(*a, **k):
        raise AssertionError("a test built a model provider")
    monkeypatch.setattr("pramanyx.llm.provider.get_provider", no_model)
    asked: list = []

    def drain(req):
        asked.append(req)
        if str(req.session_id or "").endswith("-agent"):   # the agent's door fails
            raise RuntimeError("the agent is paused")
        if req.question.startswith("Which status"):
            return _seen(30.0)
        return _seen(1300.0 if req.depth == "deep" else 1200.0)

    def baseline_of(c, question, *, schema=None, earlier=None):
        return {"door": "baseline", "question": question, "ran": True, "error": "", "headline": "1,200 orders.",
                "body": "1,200 orders." + (f" (after {earlier['question']})" if earlier else ""), "sql": ["SELECT 2"],
                "path": {"engine": "plain model"}, "fields": {"schema": schema}, **K.facts_of("1,200 orders.", "", [[1200]])}
    return conn, asked, drain, baseline_of


def test_a_run_records_every_doors_answer_and_the_plain_models_with_their_facts(stood_in):
    conn, asked, drain, baseline_of = stood_in
    K.generate(conn)
    tokens = {}
    out = K.run(conn, drain=drain, baseline_of=baseline_of,
                tokens=lambda t: tokens.setdefault(t, {"calls": 2, "input_tokens": 900, "output_tokens": 80}))
    assert out["cases"] == 2 and out["some_answer_failed"] == 2, "the agent's door failed on both, said"
    got = K.pairs(out["run_id"])
    assert got["run"]["config"]["doors"] == list(K.DOORS) and got["run"]["config"]["skip_cache"] is True
    first, second = got["questions"]
    assert first["kind"] == "figure" and first["question"] == "How many orders were placed?"
    assert set(first["answers"]) == set(K.DOORS)
    web = first["answers"]["web"]
    assert web["ran"] is True and web["error"] == "" and web["headline"] == "There were 1,200 orders."
    assert web["body"] == "Counted from orders." and web["path"] == {"kind": "describe", "depth": "quick",
                                                                     "engine": "quick core"}
    assert web["receipt_id"] == "rc-1" and web["sql"] == ["SELECT 1"] and web["figures_in_rows"] == 1
    assert web["fields"]["depth"] == "auto" and web["fields"]["schema"] == "shop"
    assert web["tokens"] == {"calls": 2, "input_tokens": 900, "output_tokens": 80} and web["duration_ms"] >= 0
    assert web["leading_figure"]["value"] == 1200.0 and web["headline_empty"] is False
    agent = first["answers"]["agent"]
    assert agent["ran"] is False and agent["error"] == "RuntimeError: the agent is paused"
    assert first["every_answer_ran"] is False and first["failed"] == ["agent"]
    assert first["baseline"]["headline"] == "1,200 orders."
    c = first["consistency"]
    assert c["agree"] is False and c["groups"] == [["web", "coworker", "slack"], ["coworker_deep", "scheduled"]]
    assert c["without_figure"] == ["agent"] and c["baseline_agrees_with"] == ["coworker", "slack", "web"]


def test_a_follow_up_is_asked_in_the_same_conversation_as_each_door_carries_one(stood_in):
    conn, asked, drain, baseline_of = stood_in
    K.generate(conn)
    out = K.run(conn, doors=["web", "slack", "scheduled", "agent"], drain=drain, baseline_of=baseline_of,
                tokens=lambda t: None)
    pair = K.pairs(out["run_id"])["questions"][1]
    fu = pair["follow_up"]
    assert fu["question"] == "Which status has the most?"
    assert fu["answers"]["web"]["headline"] == "There were 30 orders." and fu["answers"]["slack"]["ran"] is True
    assert fu["answers"]["scheduled"]["skipped"] is True and "no second turn" in fu["answers"]["scheduled"]["why"]
    assert fu["baseline"]["body"].endswith("(after How many orders are there in each status?)")
    seconds = {r.session_id: r for r in asked if r.question == "Which status has the most?"}
    firsts = {r.session_id: r for r in asked if r.question == "How many orders are there in each status?"}
    web2 = next(r for r in seconds.values() if r.depth == "auto" and r.history)
    assert web2.history[0].question == "How many orders are there in each status?" and web2.history[0].sql == "SELECT 1"
    slack2 = next(r for r in seconds.values() if r.depth == "auto" and not r.history)
    assert slack2.session_id in firsts, "Slack's second turn is in the first turn's thread"
    assert not any(r.depth == "deep" for r in seconds.values()), "a schedule has no second turn"
    assert fu["consistency"]["agree"] is True and fu["consistency"]["without_figure"] == ["agent"]


def test_a_door_whose_stream_fails_or_says_error_is_an_answer_that_failed():
    req = K.ask_request("web", "q", "c1", schema=None)
    failed = K.door_answer("web", req, drain=lambda r: (_ for _ in ()).throw(TimeoutError("slow")), tokens=lambda t: None)
    assert failed["ran"] is False and failed["error"] == "TimeoutError: slow" and failed["headline_empty"] is True
    said = K.door_answer("web", req, drain=lambda r: {**_seen(5.0), "error": "the warehouse refused"},
                         tokens=lambda t: None)
    assert said["ran"] is False and said["error"] == "the warehouse refused" and said["headline"]


def test_a_doors_answer_is_folded_from_the_frames_the_ask_stream_sends(monkeypatch):
    import json

    from pramanyx.routers import investigations as inv
    got_req = []

    async def stream(req, request):
        got_req.append((req, request))
        for frame in ({"type": "route", "depth": "deep", "question_shape": "diagnose", "body": "analyst",
                       "trace_id": "run-xyz", "why": "asks why"},
                      {"type": "sql", "sql": "SELECT a"}, {"type": "rows", "rows": [["x", 41.0]]},
                      {"type": "sql", "sql": "SELECT b"}, {"type": "rows", "rows": [["y", 12.5]]},
                      {"type": "answer_report", "answer_report": {"headline": "Returns rose 41 points.",
                                                                  "summary": "Mostly sizing."}},
                      {"type": "receipt_id", "receipt_id": "rc-9"},
                      {"type": "envelope", "envelope": {"headline": "Returns rose 41 points.", "body": "Mostly sizing.",
                                                        "provenance": {"path": {"kind": "diagnose", "depth": "deep",
                                                                                "engine": "analyst"}}}}):
            yield "data: " + json.dumps(frame) + "\n\n"
    monkeypatch.setattr(inv, "build_ask_stream", stream)
    req = K.ask_request("scheduled", "Why did returns rise?", "c1", schema="thelook")
    a = K.door_answer("scheduled", req, tokens=lambda t: {"calls": 1, "input_tokens": 1, "output_tokens": 1}
                      if t == "run-xyz" else None)
    assert got_req[0][1] is None, "driven in-process, with no HTTP request, as the doors' own in-process callers are"
    assert a["ran"] is True and a["headline"] == "Returns rose 41 points." and a["body"] == "Mostly sizing."
    assert a["sql"] == ["SELECT a", "SELECT b"] and a["row_count"] == 2, "every statement and every result it ran"
    assert a["path"] == {"kind": "diagnose", "depth": "deep", "engine": "analyst"}
    assert a["route"] == {"depth": "deep", "question_shape": "diagnose", "body": "analyst", "why": "asks why"}
    assert a["receipt_id"] == "rc-9" and a["trace_id"] == "run-xyz" and a["tokens"]["calls"] == 1
    assert a["figures_in_rows"] == 1 and a["leading_figure"]["value"] == 41.0


# ── the plain model ──────────────────────────────────────────────────────────────────────────────────────────────


class _FakeModel:
    """A model stood in: it runs a count, then tries a write, then answers."""
    role, backend, _model = "coder", "fake", "fake-model"

    def __init__(self):
        self.seen: list = []
        self.results: list = []

    def complete_with_tools(self, system, user, tools, *, history=None, temperature=0.1):
        from pramanyx.llm.provider import ToolCall, ToolTurn
        self.seen.append({"system": system, "user": user, "tools": [t["function"]["name"] for t in tools]})
        if history:
            self.results.append(history[-1].get("content"))
        step = len(self.seen)
        if step == 1:
            return ToolTurn(tool_call=ToolCall(name="run_sql", arguments={"sql": "SELECT COUNT(*) AS n FROM orders"},
                                               id="t1"))
        if step == 2:
            return ToolTurn(tool_call=ToolCall(name="run_sql", arguments={"sql": "DELETE FROM orders"}, id="t2"))
        return ToolTurn(text="There are 3 orders. Each one is counted once.")


@pytest.fixture
def shop(tmp_path: Path):
    from pramanyx.db.connection import DuckDBConnection
    path = tmp_path / "shop.duckdb"
    raw = duckdb.connect(str(path))
    raw.execute("CREATE TABLE orders (order_id INTEGER, status VARCHAR)")
    raw.execute("INSERT INTO orders VALUES (1, 'Complete'), (2, 'Cancelled'), (3, 'Complete')")
    raw.close()
    conn = DuckDBConnection(path, connection_id="kinds-shop")
    yield conn, path
    conn.close()


def test_the_plain_model_is_the_model_with_the_schema_one_read_only_tool_and_the_neutral_prompt(shop):
    db, path = shop
    model = _FakeModel()
    got = K.baseline_answer("kinds-shop", "How many orders are there?", schema="shop", provider=model,
                            open_conn=lambda: db, schema_text="orders(order_id INTEGER, status VARCHAR)",
                            tokens=lambda t: {"calls": 3, "input_tokens": 10, "output_tokens": 5})
    first = model.seen[0]
    assert first["system"].startswith(K.BASELINE_SYSTEM) and "orders(order_id INTEGER, status VARCHAR)" in first["system"]
    assert first["user"] == "How many orders are there?" and first["tools"] == ["run_sql"]
    assert got["ran"] is True and got["error"] == ""
    assert got["headline"] == "There are 3 orders." and got["body"].endswith("counted once.")
    assert got["sql"] == ["SELECT COUNT(*) AS n FROM orders", "DELETE FROM orders"]
    assert got["rows"] == [["3"]], "the rows as the read-only door hands them back"
    assert got["figures_in_rows"] == 1 and got["leading_figure"]["value"] == 3.0
    assert got["model"] == {"backend": "fake", "model": "fake-model"} and got["path"]["engine"] == "plain model"
    from pramanyx.llm.profile import profile_for
    assert got["budget"] == profile_for("coder").tool_loop_steps, "the model's own step budget, a quick turn's"
    assert got["steps"] == 2 and got["tokens"]["calls"] == 3
    assert "[BLOCKED] statement mutates data" in model.results[-1], "the write came back to the model refused"
    assert duckdb.connect(str(path), read_only=True).execute("SELECT COUNT(*) FROM orders").fetchone()[0] == 3, \
        "the read-only door refused the write"


def test_a_follow_up_gives_the_plain_model_the_earlier_exchange_and_a_failing_model_is_recorded(shop):
    db, _ = shop
    model = _FakeModel()
    K.baseline_answer("kinds-shop", "And how many were complete?", provider=model, open_conn=lambda: db,
                      schema_text="orders(...)", earlier={"question": "How many orders?", "body": "There are 3."},
                      tokens=lambda t: None)
    assert model.seen[0]["user"] == ("Earlier question: How many orders?\nYour earlier answer: There are 3.\n\n"
                                     "Follow-up question: And how many were complete?")

    class Broken(_FakeModel):
        def complete_with_tools(self, *a, **k):
            raise ConnectionError("no route to the model")
    got = K.baseline_answer("kinds-shop", "q", provider=Broken(), open_conn=lambda: db, schema_text="x",
                            tokens=lambda t: None)
    assert got["ran"] is False and got["error"] == "ConnectionError: no route to the model"


# ── the routes ───────────────────────────────────────────────────────────────────────────────────────────────────


def test_the_routes(stood_in, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from pramanyx.routers import evals as E
    conn, asked, drain, baseline_of = stood_in
    started = []
    monkeypatch.setattr(K, "start", lambda c, doors=None, baseline=True, limit=20, agent_id=None:
                        started.append((c, doors, baseline, limit)) or "run-1")
    app = FastAPI()
    app.include_router(E.router)
    client = TestClient(app)
    first = client.get("/evals/kinds", params={"connection_id": conn}).json()
    assert first["suite"] is None and first["has_case_set"] is True and set(first["doors"]) == set(K.DOORS)
    assert first["doors"]["coworker_deep"]["fields"] == {"depth": "deep", "escalate": True}
    assert client.post(f"/evals/kinds/{conn}/run", json={}).status_code == 409, "no cases written yet"
    assert client.post("/evals/kinds/elsewhere/cases").status_code == 404
    assert client.post(f"/evals/kinds/{conn}/cases").json()["cases"] == 2
    assert client.post(f"/evals/kinds/{conn}/run", json={"doors": ["fax"]}).status_code == 422
    assert client.post(f"/evals/kinds/{conn}/run", json={"doors": ["web"], "limit": 1}).json() == {"run_id": "run-1"}
    assert started == [(conn, ["web"], True, 1)]
    assert client.get("/evals/kinds/runs/nope").status_code == 404
    done = K.run(conn, doors=["web", "slack"], drain=drain, baseline_of=baseline_of, tokens=lambda t: None)
    read = client.get(f"/evals/kinds/runs/{done['run_id']}").json()
    assert [q["question"] for q in read["questions"]] == ["How many orders were placed?",
                                                          "How many orders are there in each status?"]
    assert read["questions"][0]["answers"]["web"]["headline"] == "There were 1,200 orders."
    latest = client.get("/evals/kinds", params={"connection_id": conn}).json()
    assert latest["latest"]["run"]["id"] == done["run_id"] and [c["kind"] for c in latest["cases"]] == ["figure",
                                                                                                        "follow_up"]
