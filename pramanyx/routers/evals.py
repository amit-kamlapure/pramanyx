"""The Evals surface — suites, cases, runs (Wave E3).

Every route is gated on ``Capability.EVAL_SUITE``, which until now was declared
in the licensing table, sold as an Enterprise capability, and gated **nothing** —
there was not one ``gate(Capability.EVAL_SUITE)`` call site in the codebase.

This is the consolidation door. Four eval surfaces existed before it, none of
which shared a store, a record schema, a scorer or a gate:
``POST /eval/run`` (ungated, self-scoring, unreachable from a wheel — removed),
``/semantic/{conn}/benchmarks`` (string-matched, zero records ever authored —
deprecated here, retargeted when the UI moves in E5),
``/agents/custom/{id}/evaluate`` (execution-grounded and good, but per-agent and
flag-hidden), and ``/packs/{id}/evaluate`` (the promotion-gate concept worth
keeping). The golden-SQL corpus and its hermetic CI gate are deliberately
untouched: they are load-bearing.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from pramanyx.evals import store
from pramanyx.licensing import Capability, gate
from pramanyx.security.authz import connection_owner_guard

#: DATA-06 — every connection a door of this router names belongs to the caller's org (identity on).
router = APIRouter(tags=["evals"], dependencies=[Depends(connection_owner_guard)])


class SuiteIn(BaseModel):
    name: str
    description: str = ""
    target: str = "reference"
    connection_id: str = ""
    config: dict[str, Any] = Field(default_factory=dict)


class CaseIn(BaseModel):
    question: str = ""
    artifact: str = ""
    expected: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


class CasesIn(BaseModel):
    cases: list[CaseIn]


class RunIn(BaseModel):
    iterations: int = Field(default=1, ge=1, le=10)
    evaluators: Optional[list[str]] = None
    persist: bool = True


def _suite_or_404(suite_id: str) -> dict:
    suite = store.get_suite(suite_id)
    if suite is None:
        raise HTTPException(status_code=404, detail="Suite not found")
    return suite


# ── suites ────────────────────────────────────────────────────────────────────

@router.get("/evals/suites", dependencies=[gate(Capability.EVAL_SUITE)])
def list_suites():
    return {"suites": store.list_suites()}


@router.post("/evals/suites", status_code=201, dependencies=[gate(Capability.EVAL_SUITE)])
def create_suite(body: SuiteIn):
    return store.create_suite(body.name, description=body.description,
                              target=body.target, connection_id=body.connection_id,
                              config=body.config)


@router.get("/evals/suites/{suite_id}", dependencies=[gate(Capability.EVAL_SUITE)])
def get_suite(suite_id: str):
    suite = _suite_or_404(suite_id)
    return {**suite, "cases": store.list_cases(suite_id)}


class SuiteRename(BaseModel):
    name: str


@router.patch("/evals/suites/{suite_id}", dependencies=[gate(Capability.EVAL_SUITE)])
def rename_suite(suite_id: str, body: SuiteRename):
    """A suite's title, changed in place — its runs and the receipts that cite them stay attached."""
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="A suite's title can't be empty")
    suite = store.rename_suite(suite_id, body.name)
    if suite is None:
        raise HTTPException(status_code=404, detail="Suite not found")
    return suite


@router.delete("/evals/suites/{suite_id}", dependencies=[gate(Capability.EVAL_SUITE)])
def delete_suite(suite_id: str):
    if not store.delete_suite(suite_id):
        raise HTTPException(status_code=404, detail="Suite not found")
    return {"deleted": suite_id}


# ── cases ─────────────────────────────────────────────────────────────────────

@router.post("/evals/suites/{suite_id}/cases", status_code=201,
             dependencies=[gate(Capability.EVAL_SUITE)])
def add_cases(suite_id: str, body: CasesIn):
    _suite_or_404(suite_id)
    added = store.add_cases(suite_id, [c.model_dump() for c in body.cases])
    return {"added": added}


@router.delete("/evals/cases/{case_id}", dependencies=[gate(Capability.EVAL_SUITE)])
def delete_case(case_id: str):
    if not store.delete_case(case_id):
        raise HTTPException(status_code=404, detail="Case not found")
    return {"deleted": case_id}


# ── runs ──────────────────────────────────────────────────────────────────────

@router.post("/evals/suites/{suite_id}/run", dependencies=[gate(Capability.EVAL_SUITE)])
def run_suite_route(suite_id: str, body: RunIn):
    """Run a suite against its declared target.

    Synchronous by design for now: a suite is bounded by its case count and the
    caller chose the iteration count, so the cost is knowable up front rather
    than discovered. A long model-backed suite belongs on the job kernel, which
    is the natural follow-on once a target that calls a model is wired here.
    """
    suite = _suite_or_404(suite_id)
    from pramanyx.evals.runner import run_suite
    from pramanyx.evals.targets import reference_checker, reference_target

    if suite["target"] != "reference":
        raise HTTPException(
            status_code=400,
            detail=f"target {suite['target']!r} is not runnable from the API yet; "
                   "only 'reference' (replay the case's own SQL, no model) is wired")

    conn_id = suite.get("connection_id") or ""
    if not conn_id:
        raise HTTPException(status_code=400, detail="suite has no connection_id")
    try:
        from pramanyx.db.connection import open_connection_for
        db = open_connection_for(conn_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Connection not found")

    dialect = getattr(db, "dialect", None) or "duckdb"
    table_cols = None
    try:
        from pramanyx.db.schema_render import parse_schema_tables
        table_cols = parse_schema_tables(db.get_schema())
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "eval run: schema unavailable; static guards run degraded",
                 counter="evals.route.schema")

    summary = run_suite(
        suite_id,
        reference_target(db, dialect=dialect, table_cols=table_cols),
        iterations=body.iterations, evaluators=body.evaluators,
        checker=reference_checker(db), persist=body.persist,
    )
    return summary.to_dict()


@router.get("/evals/runs", dependencies=[gate(Capability.EVAL_SUITE)])
def list_runs(suite_id: Optional[str] = None, limit: int = 50):
    return {"runs": store.list_runs(suite_id, limit=limit)}


@router.get("/evals/runs/{run_id}", dependencies=[gate(Capability.EVAL_SUITE)])
def get_run(run_id: str):
    run = store.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return {**run, "results": store.run_results(run_id)}


# ── experiments (derived A/B pairs — the reading the grid scripts owed a surface) ──

@router.get("/evals/experiments", dependencies=[gate(Capability.EVAL_SUITE)])
def list_experiments(suite_id: Optional[str] = None, limit: int = 50):
    """A/B pairs derived from the run history — never stored, so never stale.

    Two runs whose recorded requests (``config.cell_requested``) differ on exactly one
    axis — one flag, or one model pin — are an experiment. The runs come from
    ``run_experiment`` (today driven by ``scripts/flag_ab_grid.py``; a job-kernel door
    is the named follow-on once model-backed targets are runnable from the API).
    """
    from pramanyx.evals.compare import find_experiments
    return {"experiments": find_experiments(suite_id, limit=limit)}


@router.get("/evals/experiments/compare", dependencies=[gate(Capability.EVAL_SUITE)])
def compare_experiment_runs(a: str, b: str):
    """The per-case diff of one pair: verdicts, flips, paired-subset accuracy, SQL.

    ``a`` is read as the baseline cell and ``b`` as the variant. Accuracy over the
    paired subset is the honest number — a cell that never reached a case contributes
    ``unrun``, not a flip.
    """
    from pramanyx.evals.compare import compare_runs
    try:
        return compare_runs(a, b)
    except KeyError:
        raise HTTPException(status_code=404, detail="Run not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── graduations (Wave E6 — the promotion gate) ──────────────────────────────────

# The flag-graduation half retired 2026-11-26 (the Atlas plan §7.9, decision 3): its decision door is gone — there are no
# flags to graduate since 2026-10-28 — and the decisions it booked stay readable below.


@router.get("/evals/graduations", dependencies=[gate(Capability.EVAL_SUITE)])
def list_graduations(flag: Optional[str] = None, limit: int = 50):
    from pramanyx.evals import store
    return {"graduations": store.list_graduations(flag, limit=limit)}


@router.get("/evals/evaluators", dependencies=[gate(Capability.EVAL_SUITE)])
def list_evaluators():
    """The registered evaluator set — what a suite can be scored against."""
    from pramanyx.evals import deterministic_evaluators, get_evaluator, registered_evaluators
    names = registered_evaluators()
    out = []
    for name in names:
        ev = get_evaluator(name)
        out.append({"name": name, "severity": getattr(ev, "severity", ""),
                    "requires": list(getattr(ev, "requires", ())),
                    "deterministic": bool(getattr(ev, "deterministic", True))})
    return {"evaluators": out, "deterministic_count": len(deterministic_evaluators())}


# ── the context layer (§7.9, decision 3) ─────────────────────────────────────────────────────────────────────────


class ContextRunIn(BaseModel):
    #: The most cases to answer — each is a real answer, with its cost.
    limit: int = Field(40, ge=1, le=200)


@router.get("/evals/context", dependencies=[gate(Capability.EVAL_SUITE)])
def get_context_evals(connection_id: str):
    """The context-layer suite of a connection: its cases by source (published Definitions, approved metrics, trusted
    queries, corrected answers), its newest run and each case's result. Reads only."""
    from pramanyx.evals.context_layer import latest
    return latest(connection_id)


@router.post("/evals/context/{conn_id}/cases", dependencies=[gate(Capability.EVAL_SUITE)])
def draw_context_cases(conn_id: str):
    """Draw the cases afresh from the connection's layer — no model, no warehouse."""
    from pramanyx.db.registry import list_connections
    from pramanyx.evals.context_layer import generate
    name = next((str(c.get("name") or "") for c in list_connections() if c["id"] == conn_id), None)
    if name is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    return generate(conn_id, name)


@router.get("/evals/metric-bar", dependencies=[gate(Capability.EVAL_SUITE)])
def get_metric_bar(connection_id: str):
    """The metric engine's bar on a connection (the metric-views plan's M5): its golden metric-by-dimension questions,
    the last verdict — the answers right without the metric tool and with it, each question's own — whether the answer
    path is offered the tool now, and whether a run is under way."""
    from pramanyx.evals import metric_bar as B
    return {"connection": connection_id, "questions": B.questions(connection_id), "verdict": B.latest(connection_id),
            "offered": B.met(connection_id), "running": B.running(connection_id)}


class MetricBarRunIn(BaseModel):
    limit: int = Field(default=30, ge=1, le=30)


@router.post("/evals/metric-bar/{conn_id}/run", dependencies=[gate(Capability.EVAL_SUITE)])
def run_metric_bar(conn_id: str, body: MetricBarRunIn):
    """Measure the bar: each golden question answered twice through the real answer path — model calls, a person's
    click — in the background. 409 when the connection has no golden metric questions or a run is under way."""
    from pramanyx.evals import metric_bar as B
    if not B.questions(conn_id):
        raise HTTPException(status_code=409, detail="this connection has no golden metric-by-dimension questions")
    if not B.start(conn_id, limit=body.limit):
        raise HTTPException(status_code=409, detail="a run is under way")
    return {"started": True, "questions": min(body.limit, len(B.questions(conn_id)))}


@router.post("/evals/context/{conn_id}/run", dependencies=[gate(Capability.EVAL_SUITE)])
def run_context_evals(conn_id: str, body: ContextRunIn):
    """Answer the cases through the real answer path, in the background: model calls, a person's click. Returns the
    run's id at once; its results land on GET /evals/context as each answer is graded."""
    from pramanyx.evals.context_layer import find_suite, start
    suite = find_suite(conn_id)
    if suite is None:
        raise HTTPException(status_code=409, detail="no cases are drawn yet — draw them first")
    return {"run_id": start(conn_id, limit=body.limit)}


# ── every kind of question at every door, beside the plain model (the plan of record, 2026-11-27) ─────────────────


class KindsRunIn(BaseModel):
    #: The most cases to ask — each at every door chosen and of the plain model, each a real answer with its cost.
    limit: int = Field(20, ge=1, le=50)
    #: The doors to ask at; every door when omitted (`evals.kinds.DOORS`).
    doors: Optional[list[str]] = None
    #: Ask the same model given only the schema, beside the doors.
    baseline: bool = True
    #: The agent an agent's door answers as; without one that door sends its fields with no agent.
    agent_id: Optional[str] = None


@router.get("/evals/kinds", dependencies=[gate(Capability.EVAL_SUITE)])
def get_kinds_evals(connection_id: str):
    """The kinds suite of a connection: its cases by kind, the doors and the fields each sends, whether a run is under
    way, and the newest run's pairs — each question, each door's answer and the plain model's. Reads only."""
    from pramanyx.evals.kinds import latest
    return latest(connection_id)


@router.post("/evals/kinds/{conn_id}/cases", dependencies=[gate(Capability.EVAL_SUITE)])
def write_kinds_cases(conn_id: str):
    """Write the connection's case set into its suite — no model, no warehouse. 404 when no case set is written for
    the connection."""
    from pramanyx.evals.kinds import generate
    try:
        return generate(conn_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="no case set is written for this connection")


@router.post("/evals/kinds/{conn_id}/run", dependencies=[gate(Capability.EVAL_SUITE)])
def run_kinds_evals(conn_id: str, body: KindsRunIn):
    """Ask the cases at every door and of the plain model, in the background: model calls, a person's click. Returns
    the run's id at once; GET /evals/kinds/runs/{run_id} reads its pairs as each question is answered."""
    from pramanyx.evals.kinds import DOORS, find_suite, start
    if find_suite(conn_id) is None:
        raise HTTPException(status_code=409, detail="no cases are written yet — write them first")
    unknown = [d for d in (body.doors or []) if d not in DOORS]
    if unknown:
        raise HTTPException(status_code=422, detail=f"no such door: {', '.join(unknown)}")
    run_id = start(conn_id, doors=body.doors, baseline=body.baseline, limit=body.limit, agent_id=body.agent_id)
    if run_id is None:
        raise HTTPException(status_code=409, detail="a run is under way")
    return {"run_id": run_id}


@router.get("/evals/kinds/runs/{run_id}", dependencies=[gate(Capability.EVAL_SUITE)])
def get_kinds_run(run_id: str):
    """One run's pairs: each question → each door's answer, the plain model's, the follow-up's, and the facts."""
    from pramanyx.evals.kinds import pairs
    got = pairs(run_id)
    if got is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return got
