"""The organisation's own model — its doors (`pramanyx/training/`).

Reads are open to anyone in the organisation: what the model learned from, how it measured, its held-out answers.
Building the training set, fetching the base, training, putting a model in service and withdrawing one are an admin's
(`rbac/policy.py`), and each is refused with why while the organisation does not allow it (`train_own_model`). Asking a
model in service is a run, like asking a question anywhere — and refused to a person who may not see every connection
it learned from.
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pramanyx.security.authz import caller

router = APIRouter(tags=["own-model"])


def _refused(exc: Exception, status: int = 409) -> HTTPException:
    return HTTPException(status_code=status, detail=str(exc))


def _allowed() -> None:
    from pramanyx.orgsettings.allows import WHERE, allows
    if not allows("train_own_model"):
        raise HTTPException(status_code=409, detail=f"the organisation does not allow training its own model — an "
                                                    f"admin allows it in {WHERE}")


def _latest_run() -> Optional[dict]:
    """The newest training run of this organisation: its job, and what the worker has said so far."""
    from pramanyx.kernel.ledger import Ledger
    from pramanyx.org.context import current_org_id
    from pramanyx.training import runs
    org = current_org_id() or "default"
    jobs = [j for j in Ledger.default().jobs_where(kinds=[runs.JOB_KIND], limit=50)
            if (j.get("org_id") or "default") == org]
    if not jobs:
        return None
    job = max(jobs, key=lambda j: j.get("created_at") or "")
    payload = job.get("payload") or {}
    run_id = str(payload.get("run_id") or "")
    events = runs.progress(run_id) if run_id else []
    return {"job_id": job["id"], "state": job.get("state"), "error": job.get("error") or "",
            "created_at": job.get("created_at"), "run_id": run_id, "settings": payload.get("settings") or {},
            "by": payload.get("by") or "", "events": events}


@router.get("/own-model")
def get_own_model():
    """Everything the Own model page shows: whether the organisation allows it, what the install has (training
    libraries, the base, Ollama), the latest training set and what it withheld, the latest run, and every model."""
    from pramanyx.learning import knowledge, store
    from pramanyx.orgsettings.allows import WHERE, allows
    from pramanyx.training import base, runs, serve
    up, version = serve.reachable()
    return {
        "allowed": allows("train_own_model"), "where": WHERE,
        "setup": runs.setup(), "base": base.current(),
        "serving": {"reachable": up, "detail": version, "root": serve.ollama_root()},
        "training_set": {"train": store.get(knowledge.NAME), "held_out": store.get(f"{knowledge.NAME}-held-out")},
        "run": _latest_run(), "models": runs.models(), "defaults": runs.DEFAULTS,
    }


class BaseChoice(BaseModel):
    source: str = Field(description="A Hugging Face repository (owner/name) or a folder on this machine")


@router.post("/own-model/base")
def post_base(body: BaseChoice):
    """Fetch the base the organisation's model starts from and record it."""
    from pramanyx.training import base
    _allowed()
    try:
        return base.fetch(body.source, by=caller())
    except base.BaseRefused as exc:
        raise _refused(exc, 422)


@router.post("/own-model/training-set")
def post_training_set():
    """Build the training set from what the organisation settled — a new version only when something changed — and
    say what it holds and what it withheld."""
    from pramanyx.learning import knowledge
    _allowed()
    return knowledge.export_knowledge()


@router.get("/own-model/training-set/plan")
def get_training_plan():
    """What a build would hold now, and what it would withhold — read from the sources, nothing registered. The page
    reads it so what is left out is said before anyone builds, not only after."""
    from pramanyx.learning import knowledge
    items, withheld = knowledge.collect()
    train, held = knowledge.rows_for(items)
    by_source: dict[str, int] = {}
    for it in items:
        by_source[it.source_kind] = by_source.get(it.source_kind, 0) + 1
    return {"sources": by_source, "rows": {"train": len(train), "held_out": len(held)},
            "connections": sorted({it.connection_id for it in items} - {""}), "withheld": withheld.as_list()}


@router.get("/own-model/training-set/rows")
def get_training_rows(half: Literal["train", "held_out"] = "train", kind: str = "", limit: int = 50,
                      offset: int = 0):
    """Rows of the latest training set, each with the source it cites — the corpus, readable before it is used."""
    from pramanyx.learning import knowledge, store
    node = store.get(knowledge.NAME if half == "train" else f"{knowledge.NAME}-held-out")
    if node is None:
        return {"half": half, "total": 0, "rows": [], "state": "none"}
    rows = store.rows_of(node)
    if kind:
        rows = [r for r in rows if (r.get("source") or {}).get("kind") == kind]
    kinds: dict[str, int] = {}
    for r in store.rows_of(node):
        k = str((r.get("source") or {}).get("kind") or "")
        kinds[k] = kinds.get(k, 0) + 1
    limit = max(1, min(int(limit), 500))
    return {"half": half, "version": node.get("version"), "total": len(rows), "kinds": kinds,
            "rows": rows[max(0, int(offset)): max(0, int(offset)) + limit], "state": store.bytes_state(node)}


class TrainChoice(BaseModel):
    method: Optional[Literal["full", "lora"]] = None
    epochs: Optional[int] = None
    learning_rate: Optional[float] = None
    max_seq_len: Optional[int] = None


@router.post("/own-model/train")
async def post_train(body: TrainChoice):
    """Train a model on the latest training set: a kernel job, its progress on `GET /own-model`."""
    from pramanyx.training import runs
    try:
        return await runs.start(body.model_dump(), by=caller())
    except runs.TrainingRefused as exc:
        raise _refused(exc)


@router.post("/own-model/runs/{job_id}/cancel")
def post_cancel(job_id: str):
    """Stop a training run; the worker stops at its next step and nothing is recorded."""
    from pramanyx.kernel.jobs import kernel
    from pramanyx.kernel.ledger import Ledger
    from pramanyx.training import runs
    job = Ledger.default().job_get(job_id)
    if not job or job.get("kind") != runs.JOB_KIND:
        raise HTTPException(status_code=404, detail="no such training run")
    return {"cancelled": kernel().cancel(job_id, reason=f"stopped by {caller() or 'a person'}")}


@router.get("/own-model/models/{number}/answers")
def get_answers(number: int):
    """A model's answers to the held-out questions, before training and after, each with the company's answer."""
    from pramanyx.training import runs
    if runs.get_model(number) is None:
        raise HTTPException(status_code=404, detail=f"there is no model {number}")
    return runs.answers(number)


@router.post("/own-model/models/{number}/publish")
def post_publish(number: int):
    """Put a model in service — served through Ollama, asked here, pickable as a model."""
    from pramanyx.training import runs, serve
    _allowed()
    try:
        return runs.publish(number, by=caller())
    except runs.TrainingRefused as exc:
        raise _refused(exc)
    except serve.ServingUnavailable as exc:
        raise _refused(exc, 503)


class WithdrawBody(BaseModel):
    why: str = ""


@router.post("/own-model/models/{number}/withdraw")
def post_withdraw(number: int, body: WithdrawBody):
    """Withdraw a model: out of service, its record and its measure kept."""
    from pramanyx.training import runs
    try:
        return runs.withdraw(number, by=caller(), why=body.why)
    except runs.TrainingRefused as exc:
        raise _refused(exc)


class AskBody(BaseModel):
    question: str


@router.post("/own-model/models/{number}/ask")
def post_ask(number: int, body: AskBody):
    """Ask a model in service one question."""
    from pramanyx.training import runs, serve
    try:
        return runs.ask(number, body.question)
    except PermissionError as exc:
        raise _refused(exc, 403)
    except runs.TrainingRefused as exc:
        raise _refused(exc)
    except serve.ServingUnavailable as exc:
        raise _refused(exc, 503)
