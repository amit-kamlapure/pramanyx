"""The metric-views plan's M5 — answers and the coworker (`docs/METRIC_VIEWS_PLAN_2026-11-25.md` §4.5 items 3–4).

The answer path is offered `query_metric` only where the engine met the bar: on the connection's golden
metric-by-dimension questions, the answers with the tool matched or beat the answers without it — a verdict kept on the
Ledger, re-measured nightly where allowed, so a regression takes the tool away. The coworker's `get_metric` reads a metric
grouped, by a period, across periods. No test here calls a model: the answer path is a stand-in.
"""
from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace as NS

import pytest

from pramanyx.evals import metric_bar as B
from pramanyx.evals.evaluator import EvalObservation


def _conn() -> str:
    return "m5" + uuid.uuid4().hex[:6]


QUESTIONS = [{"id": "q1", "question": "Revenue by country?", "reference_sql": "SELECT c, SUM(x) FROM t GROUP BY c"},
             {"id": "q2", "question": "Orders by status?", "reference_sql": "SELECT s, COUNT(*) FROM o GROUP BY s"}]
WANT = {"Revenue by country?": [["CN", 3], ["US", 2]], "Orders by status?": [["Complete", 7]]}


def _target(with_tool_right: set, without_tool_right: set, used: bool = True):
    """The answer path, stood in: right or wrong as the arm and the question say."""
    def target(case):
        q = next(x for x in QUESTIONS if x["question"] == case.question)
        on = B.offered("any")
        right = q["id"] in (with_tool_right if on else without_tool_right)
        return EvalObservation(rows=WANT[q["question"]] if right else [["??", 0]],
                               meta={"tools": ["query_metric"]} if on and used else {})
    return target


def _reference(sql):
    return next(WANT[q["question"]] for q in QUESTIONS if q["reference_sql"] == sql)


def test_the_golden_metric_questions_are_the_ones_whose_reference_groups():
    qs = B.questions("8233e4fd")
    assert len(qs) >= 5 and all("group by" in q["reference_sql"].lower() for q in qs)
    assert "t04_revenue_by_category" in {q["id"] for q in qs} and "t02_revenue_excl_cancelled_returned" not in {q["id"] for q in qs}


def test_no_verdict_no_tool_and_a_bar_met_offers_it(monkeypatch):
    from pramanyx.agent.metric_tools import metric_tools
    conn = _conn()
    monkeypatch.setattr(B, "questions", lambda c: QUESTIONS)
    assert metric_tools(conn) == [], "never measured: never offered"
    v = B.run(conn, target=_target({"q1", "q2"}, {"q1"}), reference_rows=_reference)
    assert (v["cases"], v["without_tool"], v["with_tool"], v["used"], v["met"]) == (2, 1, 2, 2, True)
    assert v["rows"][1] == {"id": "q2", "question": "Orders by status?",
                            "without": {"passed": False, "why": "not the reference's rows (1 against 1)"},
                            "with": {"passed": True, "why": "matched the reference", "used_the_tool": True}}
    assert [t.name for t in metric_tools(conn)] == ["query_metric"]
    assert B.latest(conn)["met"] is True


def test_a_regression_takes_the_tool_away(monkeypatch):
    from pramanyx.agent.metric_tools import metric_tools
    conn = _conn()
    monkeypatch.setattr(B, "questions", lambda c: QUESTIONS)
    B.run(conn, target=_target({"q1", "q2"}, {"q1", "q2"}), reference_rows=_reference)
    assert [t.name for t in metric_tools(conn)] == ["query_metric"], "a tie meets the bar"
    B.run(conn, target=_target({"q1"}, {"q1", "q2"}), reference_rows=_reference)
    assert metric_tools(conn) == [] and B.met(conn) is False


def test_a_tie_of_answers_that_never_called_the_tool_does_not_meet_the_bar(monkeypatch):
    from pramanyx.agent.metric_tools import metric_tools
    conn = _conn()
    monkeypatch.setattr(B, "questions", lambda c: QUESTIONS)
    v = B.run(conn, target=_target({"q1", "q2"}, {"q1", "q2"}, used=False), reference_rows=_reference)
    assert (v["with_tool"], v["without_tool"], v["used"], v["met"]) == (2, 2, 0, False)
    assert "no answer called the tool" in v["why"] and metric_tools(conn) == []


def test_a_bar_run_offers_the_tool_on_its_own_arm_only():
    conn = _conn()
    assert B.offered(conn) is False
    with B.offering(True):
        assert B.offered(conn) is True
        with B.offering(False):
            assert B.offered(conn) is False
    assert B.offered(conn) is False


def test_the_nightly_measures_only_where_allowed_and_a_verdict_stands(monkeypatch):
    ran = []
    monkeypatch.setattr("pramanyx.orgsettings.allows.allows", lambda setting: False)
    assert B.run_nightly() == 0
    monkeypatch.setattr("pramanyx.orgsettings.allows.allows", lambda setting: setting == "scheduled_model_work")
    monkeypatch.setattr("pramanyx.kernel.once_a_day.first_today", lambda job, day: job == "metric_engine_bar")
    monkeypatch.setattr("pramanyx.db.registry.list_connections", lambda: [{"id": "c1"}, {"id": "c2"}])
    monkeypatch.setattr(B, "latest", lambda c: {"cases": 2} if c == "c1" else None)
    monkeypatch.setattr(B, "questions", lambda c: QUESTIONS)
    monkeypatch.setattr(B, "run", lambda c, **kw: ran.append(c))
    assert B.run_nightly() == 1 and ran == ["c1"], "only a connection a person measured first"


def test_the_doors_say_the_verdict_and_start_a_run(client, monkeypatch):
    conn = _conn()
    monkeypatch.setattr(B, "questions", lambda c: QUESTIONS if c == conn else [])
    started = []
    monkeypatch.setattr(B, "start", lambda c, limit=30: started.append((c, limit)) or True)
    got = client.get(f"/evals/metric-bar?connection_id={conn}").json()
    assert (len(got["questions"]), got["verdict"], got["offered"]) == (2, None, False)
    assert client.post(f"/evals/metric-bar/{conn}/run", json={"limit": 5}).json() == {"started": True, "questions": 2}
    assert started == [(conn, 5)]
    assert client.post("/evals/metric-bar/elsewhere/run", json={}).status_code == 409


def test_the_tool_reads_the_engine_and_says_why_it_cannot(monkeypatch, tmp_path):
    from contextlib import contextmanager

    from pramanyx.agent import metric_tools as T
    from pramanyx.semantic import metric_engine as E
    from pramanyx.semantic.metrics import MetricDefinition, save_metric
    path = tmp_path / "metrics.json"
    path.write_text("[]")
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(path))
    conn = _conn()
    save_metric(MetricDefinition(name="revenue", label="Revenue", connection=conn, source="t", measure="SUM(x)",
                                 sql="SELECT SUM(x) AS revenue FROM t", unit="$"))
    save_metric(MetricDefinition(name="whole", label="Whole", connection=conn, sql="SELECT 1 FROM t JOIN u ON 1 = 1"))
    monkeypatch.setattr("pramanyx.routers.ontology.served_ontology_graph", lambda c, s=None: NS(entities={"x": 1}))
    asked = []

    @contextmanager
    def runner(c, s, g):
        def run(metric, *, resolve=None, **ask):
            asked.append(ask)
            if metric.name == "whole":
                raise E.NotCompiled("cannot be grouped: it is one whole query")
            return E.Compiled(sql="SELECT …", columns=["c", "__metric__revenue"], value="__metric__revenue"), \
                ["c", "__metric__revenue"], [["CN", 3]]
        yield run
    monkeypatch.setattr(E, "runner", runner)
    out = T.query_metric(conn, {"metric": "revenue", "by": ["c"]})
    assert out["columns"] == ["c", "revenue"] and out["rows"] == [["CN", 3]] and out["unit"] == "$"
    assert asked[0]["by"] == ["c"] and asked[0]["limit"] == T.ROWS_HANDED
    assert "write the SQL instead" in T.query_metric(conn, {"metric": "whole", "by": ["c"]})["refused"]
    assert T.query_metric(conn, {"metric": "nope"}) == {"refused": "no metric named 'nope' on this connection"}
    frames = []
    T.query_metric(conn, {"metric": "revenue", "by": ["c"]}, emit=lambda k, p: frames.append((k, p)),
                   user_question="Revenue by c?")
    kinds = [k for k, _ in frames]
    assert kinds[:3] == ["sql", "columns", "rows"], "an answer standing on the tool shows its table and its statement"
    assert frames[1][1]["columns"] == ["c", "revenue"] and frames[2][1]["rows"] == [["CN", 3]]
    assert ("refused" in T.query_metric(conn, {"metric": "whole", "by": ["c"]}, emit=lambda k, p: frames.append((k, p)))
            and len(frames) == len(kinds)), "a refusal shows nothing"


def test_the_ask_target_says_which_tools_an_answer_called(monkeypatch):
    import json

    from pramanyx.evals.evaluator import EvalCase
    from pramanyx.evals.targets import ask_target
    from pramanyx.routers import investigations as inv

    async def _fake_stream(req, request):
        for f in ({"type": "converse_step", "tool": "list_tables"}, {"type": "converse_step", "tool": "query_metric"},
                  {"type": "converse_step", "tool": "query_metric"}, {"type": "rows", "rows": [[1]]}):
            yield "data: " + json.dumps(f) + "\n\n"

    monkeypatch.setattr(inv, "build_ask_stream", _fake_stream)
    monkeypatch.setattr("pramanyx.db.connection.open_connection_for", lambda cid: None)
    obs = ask_target("c1")(EvalCase(id="k1", question="how many?"))
    assert obs.meta["tools"] == ["list_tables", "query_metric"]
    conn = _conn()
    monkeypatch.setattr(B, "questions", lambda c: QUESTIONS[:1])
    v = B.run(conn, target=lambda case: obs.__class__(rows=WANT["Revenue by country?"],
                                                       meta={"tools": ["query_metric"], "trace_id": "t-9"}),
              reference_rows=_reference)
    assert v["rows"][0]["with"] == {"passed": True, "why": "matched the reference", "used_the_tool": True, "trace_id": "t-9"}


def test_the_coworkers_get_metric_reads_it_grouped():
    from pramanyx.mcp.client import PramanyxClient
    c = PramanyxClient.__new__(PramanyxClient)
    posted = []

    async def _get(path, params=None):
        return [{"name": "revenue", "connection": "c1", "sql": "SELECT 1"}]

    async def _post(path, json_body=None, params=None):
        posted.append((path, json_body))
        return {"columns": ["country", "revenue"], "rows": [["CN", 3]], "sql": "SELECT …", "unit": "$", "format": None,
                "caveats": []}
    c._get, c._post = _get, _post
    got = asyncio.run(c.get_metric(connection="c1", name="revenue", by=["user.country"], grain="month"))
    assert got["rows"] == [["CN", 3]] and got["unit"] == "$"
    assert posted == [("/metrics/query", {"metric": "revenue", "connection_id": "c1", "by": ["user.country"],
                                          "grain": "month", "window": None, "start": None, "end": None})]


@pytest.mark.parametrize("name", ["query_metric"])
def test_the_tool_is_declared_in_each_place(name):
    from pramanyx.abilities import as_rows
    assert any(r["name"] == name and r["places"] == ["panel"] for r in as_rows())


def test_a_golden_row_whose_connection_is_gone_is_the_one_reading_its_schema(monkeypatch):
    """LuxExperience's golden questions name a DuckDB copy (914df862) replaced by the same schema on Postgres."""
    monkeypatch.setattr("pramanyx.db.registry.list_connections",
                        lambda: [{"id": "pg1", "schema_name": "luxexperience"}, {"id": "8233e4fd", "schema_name": "thelook"}])
    lux = B.questions("pg1")
    assert lux and all(q.get("schema") == "luxexperience" for q in lux)
    assert not any(q["id"].startswith("t0") for q in lux), "theLook's rows stay theLook's"
    assert B._bound_to({"connection_id": "8233e4fd", "schema": "luxexperience"}, "pg1", "luxexperience", {"pg1", "8233e4fd"}) is False
