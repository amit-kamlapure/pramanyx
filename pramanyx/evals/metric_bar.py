"""The bar a compiled metric path meets before answers are offered it — the metric-views plan's M5
(`docs/METRIC_VIEWS_PLAN_2026-11-25.md` §4.5 item 4; the user, 2026-11-26: "Run both").

On a connection's golden metric-by-dimension questions (each golden question whose reference statement groups), the
answer path answers every question twice: without `query_metric`, as it does today, and with it. Each answer is graded
against the reference statement's own rows (`custom_agents.quality.results_match`). The engine reaches answers only where
the answers with it matched or beat the answers without it — a verdict kept on the Ledger, re-measured nightly where
model work nobody asked for is allowed, so a regression takes the tool away again: the ratchet. Never a flag: the verdict
is what was measured.

Each run spends model calls (two answers a question), so it runs on a person's click or the nightly, never on a read.
"""
from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any, Callable, Iterator, Optional

KIND = "metric_engine_bar"
#: The golden sets the bar reads, each row naming its connection.
GOLDEN = ("evals/golden_*.jsonl", "evals/ablation_*.jsonl")
_REPO = Path(__file__).resolve().parents[2]
#: The most questions one run answers (twice each).
RUN_LIMIT = 30

#: Set by a bar run around each answer — the tool offered or not, whatever the verdict says. Nothing else sets it.
_FORCED: ContextVar[Optional[bool]] = ContextVar("metric_tool_forced", default=None)


@contextmanager
def offering(on: bool) -> Iterator[None]:
    """Within this block, the answer path is offered `query_metric` (or not) whatever the verdict says — a bar run's
    two arms. A context variable, so it reaches the threads the answer path hands work to and no other request."""
    token = _FORCED.set(on)
    try:
        yield
    finally:
        _FORCED.reset(token)


def _key(conn: str) -> str:
    return f"{KIND}:{conn}"


def latest(conn: str) -> Optional[dict]:
    from pramanyx.kernel.ledger import Ledger
    art = Ledger.default().artifact_latest(_key(conn))
    return art.get("payload") if art and isinstance(art.get("payload"), dict) else None


def met(conn: str) -> bool:
    """Whether the engine met the bar on this connection: a measured run, its answers with the tool at least as many
    right as without it."""
    v = latest(conn) or {}
    return bool(v.get("cases")) and int(v.get("with_tool", 0)) >= int(v.get("without_tool", 0))


def offered(conn: str) -> bool:
    """Whether the answer path offers `query_metric` on this connection now."""
    forced = _FORCED.get()
    return forced if forced is not None else met(conn)


def questions(conn: str) -> list[dict]:
    """The connection's golden metric-by-dimension questions: each golden row of this connection whose reference
    statement groups."""
    out, seen = [], set()
    for pattern in GOLDEN:
        for path in sorted(_REPO.glob(pattern)):
            for line in path.read_text().splitlines():
                try:
                    row = json.loads(line) if line.strip() else None
                except json.JSONDecodeError as exc:   # a golden line that is not JSON is no question: said, and skipped
                    from pramanyx.kernel.errors import tolerate
                    tolerate(exc, f"metric engine bar: a line of {path.name} is not JSON", counter="evals.metric_bar")
                    row = None
                if not isinstance(row, dict) or row.get("connection_id") != conn:
                    continue
                sql = str(row.get("reference_sql") or "")
                if "group by" in sql.lower() and row.get("question") and row.get("id") not in seen:
                    seen.add(row.get("id"))
                    out.append({"id": str(row.get("id")), "question": str(row["question"]), "reference_sql": sql,
                                "schema": row.get("schema")})
    return out


def run(conn: str, *, target: Optional[Callable[[Any], Any]] = None,
        reference_rows: Optional[Callable[[str], Any]] = None, limit: int = RUN_LIMIT) -> dict:
    """Answer each question without the tool and with it, grade both on the reference's rows, keep the verdict."""
    from pramanyx.custom_agents.quality import results_match
    from pramanyx.evals.evaluator import EvalCase
    from pramanyx.kernel.ledger import Ledger
    if target is None:
        from pramanyx.evals.targets import ask_target
        target = ask_target(conn, depth="quick", ask_fields={"skip_cache": True, "allow_clarify": False})
    if reference_rows is None:
        from pramanyx.evals.context_layer import reference_rows_for
        reference_rows = reference_rows_for(conn)
    cases = questions(conn)[:limit]
    rows, tally = [], {"without": 0, "with": 0}
    for q in cases:
        want = reference_rows(q["reference_sql"])
        row = {"id": q["id"], "question": q["question"]}
        for arm, on in (("without", False), ("with", True)):
            with offering(on):
                obs = target(EvalCase(id=f"{q['id']}:{arm}", question=q["question"], expected={}))
            got = getattr(obs, "rows", None) or []
            if getattr(obs, "error", None):
                ok, why = False, f"the answer failed: {str(obs.error)[:160]}"
            elif want is None:
                ok, why = False, "the reference could not be run"
            else:
                ok = results_match(want, got)
                why = "matched the reference" if ok else f"not the reference's rows ({len(got)} against {len(want)})"
            tally[arm] += int(ok)
            used = [s for s in (getattr(obs, "meta", None) or {}).get("tools", []) if s == "query_metric"]
            trace = str((getattr(obs, "meta", None) or {}).get("trace_id") or "")
            row[arm] = {"passed": ok, "why": why, **({"used_the_tool": True} if used else {}),
                        **({"trace_id": trace} if trace else {})}
        rows.append(row)
    from datetime import datetime, timezone
    verdict = {"connection": conn, "cases": len(cases), "without_tool": tally["without"], "with_tool": tally["with"],
               "met": bool(cases) and tally["with"] >= tally["without"], "rows": rows,
               "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    Ledger.default().artifact_write(KIND, _key(conn), verdict, conn_id=conn)
    return verdict


_running: set[str] = set()


def start(conn: str, *, limit: int = RUN_LIMIT) -> bool:
    """Run the bar in the background (minutes of answers); False when one is already running for this connection."""
    import contextvars
    if conn in _running:
        return False
    _running.add(conn)

    def _go() -> None:
        try:
            run(conn, limit=limit)
        except Exception as exc:  # noqa: BLE001 — the verdict keeps its last measurement; the failure is said in the log
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "metric engine bar: the run failed", counter="evals.metric_bar")
        finally:
            _running.discard(conn)
    threading.Thread(target=contextvars.copy_context().run, args=(_go,), daemon=True, name=f"metric-bar-{conn}").start()
    return True


def running(conn: str) -> bool:
    return conn in _running


def run_nightly() -> int:
    """Re-measure where a verdict stands and model work nobody asked for is allowed (an organisation's setting), once a
    day — the ratchet: a connection whose answers do worse with the tool loses it. The count of connections measured."""
    from pramanyx.orgsettings.allows import allows
    if not allows("scheduled_model_work"):
        return 0
    from datetime import date

    from pramanyx.db.registry import list_connections
    from pramanyx.kernel.once_a_day import first_today
    if not first_today("metric_engine_bar", date.today().isoformat()):
        return 0
    measured = 0
    for c in list_connections():
        conn = str(c.get("id") or "")
        if conn and latest(conn) is not None and questions(conn):
            run(conn)
            measured += 1
    return measured
