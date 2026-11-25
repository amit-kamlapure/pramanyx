"""Evals that test the context layer (the Atlas plan's §7.9, decision 3; A2b): cases drawn from the layer without a
model, graded from the answer's receipt without a model, a pass earning "measured", a failure a review row, the nightly
only where model work nobody asked for is allowed. No test here calls a model: the answer path is a stand-in."""
from __future__ import annotations

import uuid
from types import SimpleNamespace as NS

import pytest

from pramanyx.evals import context_layer as CL
from pramanyx.evals.evaluator import EvalObservation


def _conn() -> str:
    return "c" + uuid.uuid4().hex[:8]


@pytest.fixture
def layer(monkeypatch):
    """One connection's layer: a published Definition and a draft, an approved metric and a draft one, a trusted query,
    a correction with its SQL."""
    import pramanyx.feedback.verdicts as V
    import pramanyx.record.writers as W
    import pramanyx.semantic.metrics as M
    import pramanyx.semantic.trusted_queries as T
    monkeypatch.setattr(W, "definitions", lambda conn: [
        NS(tier="approved", extra={"term": "Repeat buyer", "area": "customers"}),
        NS(tier="declared", extra={"term": "Churn", "area": ""})])
    monkeypatch.setattr(M, "list_metrics", lambda connection_id=None: [
        NS(name="revenue", label="Revenue", status="approved"), NS(name="aov", label="AOV", status="draft")])
    monkeypatch.setattr(T, "list_trusted", lambda conn: [NS(id="tq1", question="Revenue by month", connection_id=conn)])
    monkeypatch.setattr(V, "list_corrections", lambda conn, limit=25: [
        {"id": "v1", "question": "How many orders shipped?", "corrected_sql": "SELECT 7"}, {"id": "v2", "question": "x"}])
    return monkeypatch


def test_the_cases_are_drawn_from_the_layer_without_a_model(layer):
    conn = _conn()
    cases, unread = CL.cases_for(conn)
    assert unread == []
    assert [(c["expected"]["source"], c["question"]) for c in cases] == [
        ("definition", "How many Repeat buyer were there in the last 30 days?"),
        ("metric", "What was Revenue over the last 30 days?"),
        ("trusted_query", "Revenue by month"),
        ("corrected", "How many orders shipped?")], "a draft and a correction with no SQL are not cases"
    assert cases[0]["expected"]["given"] == f"definition:{conn}/Repeat buyer/customers"
    assert CL.latest(conn)["suite"] is None, "reading makes no suite"
    out = CL.generate(conn, "theLook")
    assert out["by_source"] == {"definition": 1, "metric": 1, "trusted_query": 1, "corrected": 1}
    assert CL.generate(conn, "theLook")["cases"] == 4 and len(CL.latest(conn)["cases"]) == 4, "drawn afresh, not added"


def test_an_answer_is_graded_from_its_receipt():
    ok = EvalObservation(rows=[[7]])
    given = [("r", "given", "definition:c1/Repeat buyer/customers", None)]
    assert CL.grade({"given": "definition:c1/Repeat buyer/customers"}, ok, lineage=given) == (True, "it was given to the answer")
    assert CL.grade({"given": "definition:c1/Churn/"}, ok, lineage=given)[0] is False
    used = [("r", "metric_used", "metric:revenue", "")]
    assert CL.grade({"metric_used": "revenue"}, ok, lineage=used) == (True, "the answer's SQL used its formula")
    drift = [("r", "metric_drift", "metric:revenue", "")]
    assert CL.grade({"metric_used": "revenue"}, ok, lineage=drift) == (False, "the answer's SQL departed from its formula")
    assert CL.grade({"reference_sql": "SELECT 7"}, ok, lineage=[], reference_rows=lambda sql: [[7]])[0] is True
    assert CL.grade({"reference_sql": "SELECT 7"}, EvalObservation(rows=[[8]]), lineage=[], reference_rows=lambda sql: [[7]])[0] is False
    assert CL.grade({"given": "x"}, EvalObservation(error="boom"), lineage=given) == (False, "the answer failed: boom")


def test_a_run_keeps_each_verdict_a_pass_stands_measured_and_a_failure_is_a_review_row(layer, monkeypatch):
    from pramanyx.kernel.ledger import Ledger
    conn = _conn()
    CL.generate(conn, "theLook")
    receipts = {}

    def answer(case):       # the answer path, stood in: the Definition is given, the metric's formula is not used
        rid = Ledger.default().artifact_write("chat_answer", f"chat:{conn}:{uuid.uuid4().hex[:6]}", {"question": case.question},
                                              conn_id=conn, lineage=[("given", f"definition:{conn}/Repeat buyer/customers", None)])
        receipts[case.question] = rid
        return EvalObservation(rows=[[7]], meta={"receipt_id": rid})
    out = CL.run(conn, target=answer, reference_rows=lambda sql: [[7]])
    assert (out["cases"], out["passed"]) == (4, 2)
    assert out["by_source"]["definition"] == {"cases": 1, "passed": 1} and out["by_source"]["metric"] == {"cases": 1, "passed": 0}
    assert CL.measured("definition", f"{conn}/Repeat buyer/customers") is True
    assert CL.measured("metric", f"{conn}/revenue") is False
    # A2b — a published Definition an answer was shown to rest on stands on both words
    from pramanyx.semantic.connection_kb import definition_standing
    monkeypatch.setattr("pramanyx.semantic.connection_kb._behind", lambda entry, conn: (0, 0))
    entry = NS(standing={"tier": "approved"}, title="Repeat buyer", area="customers", connection_id=conn)
    assert definition_standing(entry, conn).tier == "both"
    assert definition_standing(NS(standing={"tier": "approved"}, title="Churn", area="", connection_id=conn), conn).tier == "person"
    # a failure is a row in the knowledge review, saying what was not reached
    from pramanyx.knowledge import review as R
    rows = R._eval_failures(conn, R._links(conn))
    assert sorted(r["title"] for r in rows) == ["“Revenue by month” did not reach the answer to “Revenue by month”",
                                               "“Revenue” did not reach the answer to “What was Revenue over the last 30 days?”"]
    assert all(r["source"] == "eval_failed" and r["kind"] == "gap" for r in rows)


def test_the_nightly_runs_only_where_model_work_nobody_asked_for_is_allowed(monkeypatch):
    ran = []
    monkeypatch.setattr("pramanyx.orgsettings.allows.allows", lambda setting: False)
    monkeypatch.setattr(CL, "run", lambda conn, **kw: ran.append(conn))
    assert CL.run_nightly() == 0 and ran == []
    monkeypatch.setattr("pramanyx.orgsettings.allows.allows", lambda setting: setting == "scheduled_model_work")
    monkeypatch.setattr("pramanyx.kernel.once_a_day.first_today", lambda job, day: job == "context_evals")
    monkeypatch.setattr("pramanyx.db.registry.list_connections", lambda: [{"id": "c1", "name": "theLook"}])
    monkeypatch.setattr(CL, "generate", lambda conn, name="": None)
    assert CL.run_nightly() == 1 and ran == ["c1"]


def test_the_doors(layer, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from pramanyx.routers import evals as E
    conn = _conn()
    monkeypatch.setattr("pramanyx.db.registry.list_connections", lambda: [{"id": conn, "name": "theLook"}])
    started = []
    monkeypatch.setattr(CL, "start", lambda c, limit=40: started.append((c, limit)) or "run-1")
    app = FastAPI()
    app.include_router(E.router)
    client = TestClient(app)
    assert client.get("/evals/context", params={"connection_id": conn}).json()["suite"] is None
    assert client.post(f"/evals/context/{conn}/run", json={"limit": 3}).status_code == 409, "no cases drawn yet"
    assert client.post(f"/evals/context/{conn}/cases").json()["cases"] == 4
    assert client.post("/evals/context/elsewhere/cases").status_code == 404
    assert client.post(f"/evals/context/{conn}/run", json={"limit": 3}).json() == {"run_id": "run-1"}
    assert started == [(conn, 3)]
    assert [c["source"] for c in client.get("/evals/context", params={"connection_id": conn}).json()["cases"]] == [
        "definition", "metric", "trusted_query", "corrected"]
