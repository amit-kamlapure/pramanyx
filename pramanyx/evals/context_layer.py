"""Evals that test the context layer (the Atlas plan's §7.9, decision 3 — the user, 2026-11-25: "Yes to all three"; A2b).

Before this the Evals page ran one target (each case's own SQL replayed, no model), last on 2026-08-15, and its results
fed only flag graduation — and there are no flags since 2026-10-28. What the platform needs measured is whether the
context layer reaches the answers: whether a question about a published Definition is answered WITH that Definition,
whether a question about an approved metric is answered by its formula, whether a trusted query guides the question it
answers, whether a corrected answer is now answered as corrected.

So the cases are drawn from the layer itself — no model writes them, no person types them:

* each **published Definition** — "How did “<word>” change over the last 30 days?" — passes when the answer was given
  that Definition (the receipt's ``given`` row, A1);
* each **approved metric** — "What was <label> over the last 30 days?" — passes when the answer's SQL used its formula
  (the receipt's ``metric_used`` row);
* each **trusted query** — its own question — passes when the answer was given it;
* each **corrected answer** (a verdict that carries the corrected SQL) — its question — passes when the answer's rows
  match the corrected SQL's.

They run through the real answer path (`targets.ask_target`): a run costs model calls, so it starts only when a person
asks, or nightly when the organisation allows model work nobody asked for (``scheduled_model_work``, off by default).
Graded from the receipt, never by a model. A pass is kept per thing (``measured``): a published Definition or an approved
metric an answer was shown to rest on stands on "a person's word on a measured result" (`trust.standing`, A2b). A
failure is a row in the knowledge review (`knowledge.review`, source ``eval_failed``): what was not reached, and why.
One store: the eval plane's own (`evals/store.py`), a suite per connection under the key ``context:<connection>``.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

SUITE_KEY = "context:{conn}"
#: Where each thing's latest verdict is kept (the Ledger's kv), by ``<kind>:<ref>``.
VERDICTS = "context_eval.verdicts"
#: How long a pass stands as "measured" without being measured again.
MEASURED_DAYS = 45
#: The most cases a run answers — each is a real answer, with its cost.
RUN_LIMIT = 40
#: The most cases of one source drawn into a suite.
PER_SOURCE = 25

SOURCES = ("definition", "metric", "trusted_query", "corrected")
SOURCE_WORDS = {"definition": "Published Definition", "metric": "Approved metric", "trusted_query": "Trusted query",
                "corrected": "Corrected answer"}


# ── the cases, drawn from the context layer ──────────────────────────────────────────────────────────────────────


def _definitions(conn: str) -> list[dict]:
    from pramanyx.record.writers import definitions
    out = []
    for c in definitions(conn):
        term = str((c.extra or {}).get("term") or "").strip()
        if c.tier != "approved" or not term:
            continue                     # a draft is not the layer yet: it reaches no answer until it is published
        area = str((c.extra or {}).get("area") or "")
        # names the word as people would, for any word — "How many Repeat buyer…" read wrong for most of them
        out.append({"question": f"How did “{term}” change over the last 30 days?",
                    "expected": {"source": "definition", "ref": f"{conn}/{term}/{area}", "name": term,
                                 "given": f"definition:{conn}/{term}/{area}"}})
    return out[:PER_SOURCE]


def _metrics(conn: str) -> list[dict]:
    from pramanyx.semantic.metrics import list_metrics
    out, seen = [], set()
    for m in list_metrics(connection_id=conn):
        if getattr(m, "status", "") != "approved" or m.name in seen:
            continue
        seen.add(m.name)
        out.append({"question": f"What was {m.label or m.name} over the last 30 days?",
                    "expected": {"source": "metric", "ref": f"{conn}/{m.name}", "name": m.label or m.name,
                                 "metric_used": m.name}})
    return out[:PER_SOURCE]


def _trusted(conn: str) -> list[dict]:
    from pramanyx.discover.items import trusted_query_id
    from pramanyx.semantic.trusted_queries import list_trusted
    out = []
    for tq in list_trusted(conn):
        ref = f"{conn}/{trusted_query_id(conn, tq)}"
        out.append({"question": tq.question, "expected": {"source": "trusted_query", "ref": ref, "name": tq.question,
                                                           "given": f"trusted_query:{ref}"}})
    return out[:PER_SOURCE]


def _corrected(conn: str) -> list[dict]:
    from pramanyx.feedback.verdicts import list_corrections
    out = []
    for v in list_corrections(conn, limit=PER_SOURCE):
        question = str(v.get("question") or v.get("headline") or "").strip()
        sql = str(v.get("corrected_sql") or "").strip()
        if question and sql:
            out.append({"question": question, "expected": {"source": "corrected", "ref": f"{conn}/verdict/{v.get('id')}",
                                                            "name": question, "reference_sql": sql}})
    return out


def cases_for(conn: str) -> tuple[list[dict], list[str]]:
    """Every case the layer of ``conn`` gives, and the sources that could not be read (said, never taken for none)."""
    cases: list[dict] = []
    unread: list[str] = []
    for name, read in (("definition", _definitions), ("metric", _metrics), ("trusted_query", _trusted),
                       ("corrected", _corrected)):
        try:
            got = read(conn)
        except Exception as exc:  # noqa: BLE001 — a source unread is named
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, f"context evals: {name} could not be read", counter="evals.context.cases")
            unread.append(name)
            continue
        for case in got:
            case["tags"] = ["context", name]
        cases += got
    return cases, unread


def suite_of(conn: str, conn_name: str = "") -> dict:
    from pramanyx.evals import store
    suite, _ = store.ensure_suite(SUITE_KEY.format(conn=conn), f"The context layer — {conn_name or conn}",
                                  description="Questions drawn from the published Definitions, approved metrics, trusted "
                                              "queries and corrected answers: does each reach the answer?",
                                  target="ask", connection_id=conn)
    return suite


def generate(conn: str, conn_name: str = "") -> dict:
    """Draw the cases afresh — no model, no warehouse — replacing the suite's; ``{suite, cases, by_source, unread}``."""
    from pramanyx.evals import store
    suite = suite_of(conn, conn_name)
    cases, unread = cases_for(conn)
    for old in store.list_cases(suite["id"]):
        store.delete_case(old["id"])
    store.add_cases(suite["id"], cases)
    return {"suite": suite, "cases": len(cases), "by_source": _count(cases), "unread": unread}


def _count(cases: list[dict]) -> dict[str, int]:
    out = {s: 0 for s in SOURCES}
    for c in cases:
        out[c["expected"]["source"]] += 1
    return out


# ── grading, from the receipt ────────────────────────────────────────────────────────────────────────────────────


def grade(expected: dict, obs, *, lineage: list[tuple], reference_rows: Optional[Callable[[str], Any]] = None,
          governed_figure: Optional[Callable[[dict], Any]] = None) -> tuple[bool, str]:
    """Whether an answer reached what the case is about, and why — from what its receipt recorded, never a model."""
    if getattr(obs, "error", ""):
        return False, f"the answer failed: {obs.error}"[:300]
    relations = {(str(r[1]), str(r[2])) for r in lineage if len(r) >= 3}
    refs = {(rel, ref) for rel, ref in relations}
    if expected.get("given"):
        hit = ("given", expected["given"]) in refs
        return hit, ("it was given to the answer" if hit else "the answer was not given it")
    if expected.get("metric_used"):
        want = f"metric:{expected['metric_used']}"
        if ("metric_used", want) in refs:
            return True, "the answer's SQL used its formula"
        # the data's word (2026-11-26): an answer written its own way that gives the governed metric's figure for the
        # period asked followed its definition — the text of a formula is not the only way to write it
        figure = governed_figure(expected) if governed_figure is not None else None
        if figure is not None and gives(getattr(obs, "rows", None) or [], figure):
            return True, f"its figure is the governed metric's for the period ({figure:,.4g})"
        drift = ("metric_drift", want) in refs
        return False, ("the answer's SQL departed from its formula" if drift else "the answer did not use its formula")
    if expected.get("reference_sql") and reference_rows is not None:
        want = reference_rows(expected["reference_sql"])
        if want is None:
            return False, "the corrected SQL could not be run to compare"
        from pramanyx.custom_agents.quality import results_match
        same = results_match(want, getattr(obs, "rows", []) or [])
        return bool(same), ("the answer matches the correction" if same else "the answer still differs from the correction")
    return False, "nothing to grade it by"


def _lineage_of(receipt_id: str) -> list[tuple]:
    if not receipt_id:
        return []
    from pramanyx.kernel.ledger import Ledger
    return list(Ledger.default().lineage_of_many([receipt_id], relations=["given", "metric_used", "metric_drift"]))


# ── what a pass earns ────────────────────────────────────────────────────────────────────────────────────────────


def keep_verdict(kind: str, ref: str, *, passed: bool, why: str, run_id: str, question: str) -> None:
    from pramanyx.kernel.ledger import Ledger
    Ledger.default().kv_put(VERDICTS, f"{kind}:{ref}", {"passed": bool(passed), "why": why, "run_id": run_id, "question": question,
                                           "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})


def verdict(kind: str, ref: str) -> Optional[dict]:
    """The latest verdict on one thing, or None when none was measured."""
    try:
        from pramanyx.kernel.ledger import Ledger
        got = Ledger.default().kv_get(VERDICTS, f"{kind}:{ref}")
        return got if isinstance(got, dict) else None
    except Exception:  # noqa: BLE001 — unread, it is not measured; nothing is claimed
        return None


def measured(kind: str, ref: str) -> bool:
    """Whether an answer was last shown to rest on it, within `MEASURED_DAYS` (A2b)."""
    v = verdict(kind, ref)
    if not v or not v.get("passed"):
        return False
    try:
        at = datetime.fromisoformat(str(v.get("at")))
    except ValueError:
        return False
    return datetime.now(timezone.utc) - at <= timedelta(days=MEASURED_DAYS)


def measured_metric(conn: str, name: str) -> Optional[dict]:
    """An approved metric's latest verdict when an answer was shown to use its formula within `MEASURED_DAYS` —
    ``{at, question, why}`` — else None (A2b: a metric's pass lifts its standing, `ontology/authority.standing`)."""
    ref = f"{conn}/{name}"
    if not measured("metric", ref):
        return None
    v = verdict("metric", ref) or {}
    return {"at": v.get("at"), "question": v.get("question"), "why": v.get("why")}


# ── a run ────────────────────────────────────────────────────────────────────────────────────────────────────────


def run(conn: str, *, limit: int = RUN_LIMIT, target: Optional[Callable] = None,
        reference_rows: Optional[Callable[[str], Any]] = None, run_id: str = "") -> dict:
    """Answer up to ``limit`` of the suite's cases through the real answer path, grade each from its receipt, keep each
    thing's verdict. Spends model calls: a person's click, or the nightly with ``scheduled_model_work``."""
    from pramanyx.evals import store
    from pramanyx.evals.evaluator import EvalCase
    suite = suite_of(conn)
    cases = store.list_cases(suite["id"])[: max(1, int(limit))]
    if target is None:
        from pramanyx.evals.targets import ask_target
        target = ask_target(conn, depth="quick", ask_fields={"skip_cache": True, "allow_clarify": False})
    if reference_rows is None:
        reference_rows = reference_rows_for(conn)
    run_id = run_id or store.start_run(suite["id"], config={"kind": "context", "limit": limit})
    passed = 0
    by_source: dict[str, dict[str, int]] = {}
    try:
        for row in cases:
            expected = row.get("expected") or {}
            t0 = time.perf_counter()
            obs = target(EvalCase(id=row["id"], question=row["question"], expected=expected))
            figure = governed_figure_for(conn, row["question"])
            ok, why = grade(expected, obs, lineage=_lineage_of(str((obs.meta or {}).get("receipt_id") or "")),
                            reference_rows=reference_rows, governed_figure=figure)
            store.record_result(run_id, row["id"], 1, passed=ok, correct=ok,
                                duration_ms=(time.perf_counter() - t0) * 1000, error="" if ok else why)
            keep_verdict(expected.get("source", ""), expected.get("ref", ""), passed=ok, why=why, run_id=run_id,
                         question=row["question"])
            passed += int(ok)
            s = by_source.setdefault(expected.get("source", ""), {"cases": 0, "passed": 0})
            s["cases"] += 1
            s["passed"] += int(ok)
        summary = {"kind": "context", "cases": len(cases), "passed": passed, "by_source": by_source}
        store.finish_run(run_id, summary=summary)
        return {"run_id": run_id, **summary}
    except Exception as exc:
        store.finish_run(run_id, status=store.FAILED, summary={"kind": "context", "error": str(exc)[:300]})
        raise


def gives(rows: list, figure: float) -> bool:
    """Whether an answer's rows hold ``figure`` — as written, rounded as an answer rounds, or as a percentage of it."""
    want = float(figure)
    for r in rows[:50]:
        for cell in (r if isinstance(r, (list, tuple)) else [r]):
            try:
                v = float(cell)
            except (TypeError, ValueError):
                continue
            text = str(cell)
            places = len(text.split(".", 1)[1]) if "." in text and "e" not in text.lower() else 0
            tol = 0.5 * 10 ** -places + 1e-9          # what rounding to the answer's own places can move it
            for w in (want, want * 100):
                if abs(v - w) <= max(tol, abs(w) * 1e-6):
                    return True
    return False


def governed_figure_for(conn: str, question: str) -> Callable[[dict], Any]:
    """The governed metric a case is about, measured by its own definition over the period the question names (the
    clock's one reading) — what an answer should give; None when it cannot be measured so."""
    def figure(expected: dict):
        try:
            from pramanyx.db.connection import open_connection_for
            from pramanyx.kernel.clock import period_named, person_clock
            from pramanyx.semantic import metric_time as mt
            from pramanyx.semantic.metrics import get_metric
            m = get_metric(str(expected.get("metric_used") or ""), connection_id=conn)
            span = period_named(question, person_clock())
            if m is None or span is None or not mt.declared(m):
                return None
            db = open_connection_for(conn)

            def run_sql(sql):
                from pramanyx.evals.targets import observe
                r = observe(db, sql, label="eval.governed_figure")
                return list(getattr(r, "columns", None) or []), r.rows, r.error
            try:
                got, why = mt.run_measure(m, [mt.Window("current", span[0], span[1])], run_sql,
                                          dialect=getattr(db, "dialect", "duckdb") or "duckdb")
            finally:
                db.close()
            vals = [g["value"] for g in got if g.get("value") is not None]
            return float(vals[0]) if vals and not why else None
        except Exception as exc:  # noqa: BLE001 — unmeasured, the receipt's word alone grades it
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "context evals: the governed figure could not be measured", counter="evals.context.figure")
            return None
    return figure


def reference_rows_for(conn: str) -> Callable[[str], Any]:
    def rows(sql: str):
        try:
            from pramanyx.db.connection import open_connection_for
            from pramanyx.evals.targets import observe
            got = observe(open_connection_for(conn), sql, label="eval.expected")
            return None if got.error else got.rows
        except Exception as exc:  # noqa: BLE001 — said by the grade: it could not be compared
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "context evals: the corrected SQL could not be run", counter="evals.context.reference")
            return None
    return rows


def start(conn: str, *, limit: int = RUN_LIMIT) -> str:
    """Start a run in the background (a run is minutes of answers) and return its id at once."""
    import contextvars
    from pramanyx.evals import store
    suite = suite_of(conn)
    run_id = store.start_run(suite["id"], config={"kind": "context", "limit": limit})
    ctx = contextvars.copy_context()

    def go():
        try:
            run(conn, limit=limit, run_id=run_id)
        except Exception:
            logger.warning("context evals: the run on %s failed", conn, exc_info=True)
    threading.Thread(target=ctx.run, args=(go,), daemon=True, name="context-evals").start()
    return run_id


def find_suite(conn: str) -> Optional[dict]:
    """The suite of ``conn`` when one was drawn — read only: a read never makes one."""
    from pramanyx.evals import store
    key = SUITE_KEY.format(conn=conn)
    return next((s for s in store.list_suites(limit=500) if s.get("key") == key), None)


def latest(conn: str) -> dict:
    """The suite of ``conn``, its cases by source, its newest run and each case's result in it — ``suite`` None when no
    case was drawn yet. Writes nothing."""
    from pramanyx.evals import store
    suite = find_suite(conn)
    if suite is None:
        return {"suite": None, "cases": [], "by_source": {s: 0 for s in SOURCES}, "run": None}
    cases = store.list_cases(suite["id"])
    runs = store.list_runs(suite["id"], limit=1)
    last = runs[0] if runs else None
    results = {r["case_id"]: r for r in store.run_results(last["id"])} if last else {}
    rows = [{"id": c["id"], "question": c["question"], "source": (c.get("expected") or {}).get("source", ""),
             "name": (c.get("expected") or {}).get("name", ""), "ref": (c.get("expected") or {}).get("ref", ""),
             "result": None if c["id"] not in results else {"passed": bool(results[c["id"]]["passed"]),
                                                             "why": results[c["id"]].get("error") or "it reached the answer"}}
            for c in cases]
    # by source in the layer's order — drawn in one write, the cases share a time and come back in any order
    rows.sort(key=lambda r: SOURCES.index(r["source"]) if r["source"] in SOURCES else len(SOURCES))
    return {"suite": suite, "cases": rows, "by_source": _count([{"expected": {"source": r["source"]}} for r in rows
                                                                 if r["source"] in SOURCES]),
            "run": last}


def failures(conn: str) -> list[dict]:
    """What the newest run on ``conn`` found the layer did not reach — the knowledge review's ``eval_failed`` rows."""
    got = latest(conn)
    return [r for r in got["cases"] if r["result"] is not None and not r["result"]["passed"]]


def run_nightly() -> int:
    """Once a UTC day, each connection's suite drawn afresh and run — only when the organisation allows model work
    nobody asked for (``scheduled_model_work``). Returns how many connections were run."""
    from pramanyx.orgsettings.allows import allows
    if not allows("scheduled_model_work"):
        return 0
    from pramanyx.kernel.once_a_day import first_today
    if not first_today("context_evals", datetime.now(timezone.utc).date().isoformat()):
        return 0
    from pramanyx.db.registry import list_connections
    done = 0
    for c in list_connections():
        try:
            generate(c["id"], str(c.get("name") or ""))
            run(c["id"])
            done += 1
        except Exception as exc:  # noqa: BLE001 — one connection's run failing leaves the others to run
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, f"context evals: the nightly on {c.get('id')} failed", counter="evals.context.nightly")
    return done
