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
    # the app's routers bind `list_metrics` by name when first imported: imported here, before the stand-in, a later
    # test's app reads the real store
    import pramanyx.api  # noqa: F401
    import pramanyx.feedback.verdicts as V
    import pramanyx.record.writers as W
    import pramanyx.semantic.metrics as M
    import pramanyx.semantic.trusted_queries as T
    monkeypatch.setattr(W, "definitions", lambda conn: [
        NS(tier="approved", extra={"term": "Repeat buyer", "area": "customers"}),
        NS(tier="declared", extra={"term": "Churn", "area": ""})])
    monkeypatch.setattr(M, "list_metrics", lambda connection_id=None: [
        NS(name="revenue", label="Revenue", status="approved", time_column="order_items.created_at"),
        NS(name="aov", label="AOV", status="draft", time_column="orders.created_at")])
    monkeypatch.setattr(T, "list_trusted", lambda conn: [NS(id="tq1", question="Revenue by month", connection_id=conn)])
    monkeypatch.setattr(V, "list_corrections", lambda conn, limit=25: [
        {"id": "v1", "question": "How many orders shipped?", "corrected_sql": "SELECT 7"}, {"id": "v2", "question": "x"}])
    return monkeypatch


def test_the_cases_are_drawn_from_the_layer_without_a_model(layer):
    conn = _conn()
    cases, unread = CL.cases_for(conn)
    assert unread == []
    assert [(c["expected"]["source"], c["question"]) for c in cases] == [
        ("definition", "How did “Repeat buyer” change over the last 30 days?"),
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


def test_a_metric_an_answer_was_shown_using_stands_on_both(tmp_path, monkeypatch):
    """The Area map plan's gap (2026-11-26): a metric's pass lifted nothing — it now stands above a verified formula
    nobody was shown using, in the provenance panel's order and on the Metrics row."""
    from fastapi.testclient import TestClient

    from pramanyx.api import app
    from pramanyx.ontology.authority import choose, standing
    from pramanyx.ontology.models import DefinitionSource
    from pramanyx.semantic.metrics import MetricDefinition, save_metric
    conn = _conn()
    measured = DefinitionSource(formula_sql="SUM(a)", source_asset="metric registry", measured=True,
                                measured_note="the context-layer eval, 2026-11-26")
    verified = DefinitionSource(formula_sql="SUM(b)", source_asset="a dashboard", verified=True)
    assert standing(measured).tier == "both" and standing(verified).tier == "data"
    got = choose([verified, measured])
    assert got.winner is measured and "an answer was shown to use its formula (the context-layer eval, 2026-11-26)" in got.why
    path = tmp_path / "metrics.json"
    path.write_text("[]")
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(path))
    save_metric(MetricDefinition(name="revenue", label="Revenue", connection=conn, sql="SELECT SUM(x) FROM t", status="approved"))
    client = TestClient(app)
    row = lambda: next(m for m in client.get(f"/metrics?connection_id={conn}").json() if m["name"] == "revenue")  # noqa: E731
    assert row()["measured"] is None
    CL.keep_verdict("metric", f"{conn}/revenue", passed=True, why="its SQL used the metric's formula", run_id="r1",
                    question="What was Revenue over the last 30 days?")
    assert row()["measured"]["question"] == "What was Revenue over the last 30 days?"
    CL.keep_verdict("metric", f"{conn}/revenue", passed=False, why="not used", run_id="r2", question="q")
    assert row()["measured"] is None, "a later miss takes it back"


def test_the_provenance_panel_says_the_registry_claim_was_measured(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from pramanyx.api import app
    from pramanyx.semantic.metrics import MetricDefinition, save_metric
    conn = _conn()
    path = tmp_path / "metrics.json"
    path.write_text("[]")
    monkeypatch.setenv("PRAMANYX_METRICS_PATH", str(path))
    save_metric(MetricDefinition(name="revenue", label="Revenue", connection=conn, sql="SELECT SUM(x) FROM t", status="approved"))
    graph = NS(metrics={"revenue": NS(display_name="Revenue", formula_sql="SELECT SUM(y) FROM t", verified=True,
                                      verification_note="bound", known_divergent_calculations=[])})
    monkeypatch.setattr("pramanyx.routers.ontology._get_ontology_graph", lambda c, s=None: graph)
    monkeypatch.setattr("pramanyx.db.history.recent_executed_sql", lambda c: [])
    url = f"/ontology/metrics/revenue/provenance?connection_id={conn}"
    before = TestClient(app).get(url).json()
    assert before["chosen"]["source_asset"] == "the ontology graph", "a verified formula wins over an unmeasured claim"
    CL.keep_verdict("metric", f"{conn}/revenue", passed=True, why="used", run_id="r1", question="q")
    after = TestClient(app).get(url).json()
    assert after["chosen"]["source_asset"].startswith("metric registry") and after["chosen"]["measured"] is True
    assert "an answer was shown to use its formula (the context-layer eval, " in after["why"]


def test_an_answer_giving_the_governed_figure_for_the_period_followed_its_definition():
    """2026-11-26: the receipt's text match read answers that ran the metric engine's own statement as departing.
    The data's word grades too: an answer whose figure is the governed metric's for the period asked passed."""
    expected = {"source": "metric", "ref": "c/revenue", "metric_used": "revenue"}
    drift = [("receipt", "metric_drift", "metric:revenue")]
    obs = EvalObservation(rows=[[676320.85]])
    ok, why = CL.grade(expected, obs, lineage=drift, governed_figure=lambda e: 676320.8512)
    assert ok and "governed metric's for the period" in why
    assert CL.grade(expected, obs, lineage=drift, governed_figure=lambda e: 500000.0)[0] is False
    assert CL.grade(expected, obs, lineage=drift, governed_figure=lambda e: None) == (False, "the answer's SQL departed from its formula")
    assert CL.gives([["Q", 12.34]], 0.1234) and CL.gives([[0.12]], 0.1234), "a percentage, a rounded figure"
    assert CL.gives([[0.13]], 0.1234) is False and CL.gives([[676321]], 676320.85) and not CL.gives([[676330]], 676320.85)


def test_the_receipt_reads_the_metric_engines_own_statement_as_its_formula():
    from types import SimpleNamespace as NS

    from pramanyx.semantic.enforcement import check_metric_enforcement
    units = NS(name="units_sold", label="Units Sold", sql="SELECT COUNT(id) AS units_sold FROM inventory_items",
               measure="COUNT(id)", wrong_usage_examples=[])
    engine = ("SELECT __metric__units_sold AS units_sold FROM (SELECT COUNT(t0.id) AS __metric__units_sold FROM "
              "`inventory_items` AS t0 WHERE ((NOT t0.sold_at IS NULL))) AS governed")
    assert check_metric_enforcement("What was Units Sold last week?", engine, [units])[0]["status"] == "used"


def test_a_metric_with_no_date_is_asked_for_its_figure_not_a_period(monkeypatch):
    import pramanyx.semantic.metrics as M
    monkeypatch.setattr(M, "list_metrics", lambda connection_id=None: [
        NS(name="total_retail_price", label="Total retail price", status="approved", time_column=None),
        NS(name="revenue", label="Revenue", status="approved", time_column="order_items.created_at")])
    qs = {c["expected"]["name"]: c["question"] for c in CL._metrics("c1")}
    assert qs == {"Total retail price": "What is Total retail price?", "Revenue": "What was Revenue over the last 30 days?"}


def test_no_figure_for_the_period_said_as_none_followed_the_definition():
    expected = {"source": "metric", "ref": "c/consent", "metric_used": "consent"}
    ok, why = CL.grade(expected, EvalObservation(rows=[[None]]), lineage=[], governed_figure=lambda e: CL.NO_VALUE)
    assert ok and "has no figure for the period" in why
    assert CL.grade(expected, EvalObservation(rows=[[0.42]]), lineage=[], governed_figure=lambda e: CL.NO_VALUE)[0] is False
    assert CL.gives([["NULL"]], CL.NO_VALUE) and CL.gives([], CL.NO_VALUE)
