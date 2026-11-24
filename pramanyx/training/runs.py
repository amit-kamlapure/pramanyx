"""Training the organisation's model: the run, the versions it leaves, and asking one.

A run is a kernel job (`own_model_training`). Its coroutine starts `worker.py` in its own process — BY PATH, with the
interpreter that has torch (`PRAMANYX_TRAINING_PYTHON`, else this one) — and follows its ``progress.jsonl``. A cancel
of the job writes the worker's ``cancel`` file and waits for it to stop. The worker reads files and writes files; it
opens no store. When it finishes, this process records the model.

Each trained model is its own lifecycle artifact (`own_model:<org>:<run>`), so each has its own history:

* **draft** — trained and measured; its held-out answers are readable, it answers nobody;
* **published** — an admin put it in service: imported into Ollama, asked here, pickable as a model;
* **archived** — withdrawn: out of Ollama, its record and its measure kept (supersede, never delete).

Asking a model is refused to a person who may not see every connection it learned from: a model trained on rows
remembers rows, and the access it was trained under travels with it.
"""
from __future__ import annotations

import asyncio
import functools
import importlib.util
import json
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from pramanyx.training.base import models_dir

#: The lifecycle kind of a trained model, and the kernel job that makes one.
KIND = "own_model"
JOB_KIND = "own_model_training"

#: What a person may choose about a run — the three a managed fine-tuning service exposes (duration, learning rate,
#: context length) and the method. Defaults measured 2026-11-23 on theLook + LuxExperience (337 sources): full
#: fine-tuning at 3e-5 for 8 epochs took held-out recall from 0% to 98% in ~5 minutes on an Apple M5.
DEFAULTS: dict[str, Any] = {"method": "full", "epochs": 8, "learning_rate": 3e-5, "max_seq_len": 512,
                            "batch_size": 8, "lora_rank": 16, "engine": "builtin", "teach_by": "example"}

#: The engines a run may be given, and why the ways of teaching not yet offered are not — said, never a silent no.
ENGINES = ("builtin", "llamafactory")
_NOT_YET = {
    "preference": "teaching by preference needs corrections a person typed — the Corrections environment has none yet",
    "reward": "teaching by reward needs an environment whose tasks the model passes 10–80% of the time — none does yet",
}
_LIMITS = {"epochs": (1, 30), "learning_rate": (1e-6, 1e-2), "max_seq_len": (128, 2048), "batch_size": (1, 64),
           "lora_rank": (2, 128)}
_LORA_RATE = 4e-4


class TrainingRefused(ValueError):
    """A run cannot start — said with why."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _org() -> str:
    from pramanyx.org.context import current_org_id
    return current_org_id() or "default"


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-") or "default"


def natural_key(org_id: str, run_id: str) -> str:
    return f"{KIND}:{org_id}:{run_id}"


# ── the door: what is in place, what is missing ───────────────────────────────────────────────────────────────────

def training_python() -> str:
    return os.getenv("PRAMANYX_TRAINING_PYTHON", "").strip() or sys.executable


#: What the worker imports. Looked up, never imported here: torch is ~400 MB the API's process has no business loading.
_LIBRARIES = ("torch", "transformers", "safetensors", "huggingface_hub")


@functools.lru_cache(maxsize=4)
def _missing_in(python: str) -> tuple[str, ...]:
    """The libraries ``python`` lacks — asked of that interpreter once per process (a spec lookup, no import)."""
    if python == sys.executable:
        return tuple(m for m in _LIBRARIES if importlib.util.find_spec(m) is None)
    if not Path(python).exists():
        return (f"the interpreter {python}",)
    probe = ("import importlib.util as u; print(','.join(m for m in %r if u.find_spec(m) is None))" % (_LIBRARIES,))
    try:
        out = subprocess.run([python, "-I", "-c", probe], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return (f"the interpreter {python} ({type(exc).__name__})",)
    if out.returncode != 0:
        return (f"the interpreter {python} (it did not start)",)
    return tuple(m for m in out.stdout.strip().split(",") if m)


def setup() -> dict:
    """Whether this install can train: the libraries in the interpreter the worker runs with."""
    python = training_python()
    missing = list(_missing_in(python))
    return {"ready": not missing, "python": python, "missing": missing,
            "how": "" if not missing else "install the training extra: uv sync --extra train "
                                          "(or point PRAMANYX_TRAINING_PYTHON at an interpreter that has torch)"}


def settings_for(choice: Optional[dict]) -> dict:
    """A run's settings: the defaults, the person's choices within limits. LoRA's rate default is its own."""
    out = dict(DEFAULTS)
    choice = {k: v for k, v in (choice or {}).items() if v is not None}
    if choice.get("method") not in (None, "full", "lora"):
        raise TrainingRefused("the method is full (every weight) or lora (a low-rank branch, merged back)")
    if choice.get("method") == "lora" and "learning_rate" not in choice:
        out["learning_rate"] = _LORA_RATE
    if choice.get("engine") not in (None, *ENGINES):
        raise TrainingRefused(f"the engine is one of {', '.join(ENGINES)}; the others are said on the Engines tab")
    if choice.get("teach_by") not in (None, "example"):
        raise TrainingRefused(_NOT_YET.get(str(choice.get("teach_by")), "teach by example, preference or reward"))
    out.update(choice)
    for key, (lo, hi) in _LIMITS.items():
        value = float(out[key])
        if not lo <= value <= hi:
            raise TrainingRefused(f"{key} is {value}; it is between {lo} and {hi}")
        out[key] = value if key == "learning_rate" else int(value)
    return out


# ── the run ───────────────────────────────────────────────────────────────────────────────────────────────────────

def _latest_training_set() -> tuple[dict, dict]:
    from pramanyx.learning import knowledge, store
    train, held = store.get(knowledge.NAME), store.get(f"{knowledge.NAME}-held-out")
    if not train or not train.get("row_count"):
        raise TrainingRefused("there is no training set yet — build it first")
    if not held or not held.get("row_count"):
        raise TrainingRefused("the training set has no held-out questions, so the model could not be measured")
    return train, held


def prepare(run_id: str, *, settings: dict, base: dict, train: dict, held: dict) -> Path:
    """The run's folder: its rows as files and its config. The worker reads nothing else."""
    from pramanyx.learning import store
    run_dir = models_dir() / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    for name, node in (("train.jsonl", train), ("held_out.jsonl", held)):
        rows = store.rows_of(node)
        if not rows:
            raise TrainingRefused(f"the {node['name']} rows could not be read ({store.bytes_state(node)})")
        (run_dir / name).write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    config = {**settings, "base_dir": base["dir"], "train": str(run_dir / "train.jsonl"),
              "held_out": str(run_dir / "held_out.jsonl"),
              "out_dir": str(models_dir() / "own" / _slug(_org()) / run_id), "measure_limit": 400}
    (run_dir / "config.json").write_text(json.dumps(config, indent=1), encoding="utf-8")
    return run_dir


def progress(run_id: str) -> list[dict]:
    """The run's events so far, oldest first: the worker's, and — for a LlamaFactory run — its trainer's steps, read
    from its own `trainer_log.jsonl` and said in the same words."""
    run_dir = models_dir() / "runs" / run_id
    p = run_dir / "progress.jsonl"
    ours = [e for e in (_event(line) for line in p.read_text(encoding="utf-8").splitlines()) if e is not None] \
        if p.exists() else []
    lf = run_dir / "lf_out" / "trainer_log.jsonl"
    if not lf.exists():
        return ours
    steps = []
    for e in (_event(line) for line in lf.read_text(encoding="utf-8").splitlines()):
        if e and "current_steps" in e:
            steps.append({"event": "step", "step": e.get("current_steps"), "total": e.get("total_steps"),
                          "loss": e.get("loss"), "lr": e.get("lr"), "epoch": e.get("epoch"),
                          "tokens": e.get("total_tokens"), "tokens_per_s": e.get("throughput")})
    return [e for e in ours if e.get("event") == "start"] + steps + [e for e in ours if e.get("event") != "start"]


def _event(line: str) -> Optional[dict]:
    """One progress line, or None for the line the worker is still writing (the file is read while it grows)."""
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


async def start(choice: Optional[dict] = None, *, by: str = "") -> dict:
    """Start a run on the latest training set. Refused, with why, when the organisation does not allow it, there is
    no base, the install cannot train, or there is nothing to train on."""
    from pramanyx.kernel.jobs import kernel
    from pramanyx.orgsettings.allows import WHERE, allows
    from pramanyx.training import base as _base
    if not allows("train_own_model"):
        raise TrainingRefused(f"the organisation does not allow training its own model — an admin allows it in {WHERE}")
    ready = setup()
    if not ready["ready"]:
        raise TrainingRefused(f"this install cannot train yet: {', '.join(ready['missing'])} missing — {ready['how']}")
    b = _base.current()
    if not b or not b.get("present"):
        raise TrainingRefused("no base model is fetched — name one first")
    settings = settings_for(choice)
    train, held = _latest_training_set()
    from pramanyx.kernel.jobs import JobState
    from pramanyx.kernel.ledger import Ledger
    if Ledger.default().jobs_where(states=list(JobState.ACTIVE), idempotency_key=f"{JOB_KIND}:{_org()}", limit=1):
        raise TrainingRefused("a run is already going for this organisation — stop it, or wait for it to finish")
    if settings["engine"] == "llamafactory":
        from pramanyx.training.engines import door
        d = door("llamafactory") or {}
        if d.get("status") != "ready":
            raise TrainingRefused(f"LlamaFactory is not ready here: {d.get('why') or 'not found'} — {d.get('how') or ''}")
    run_id = uuid.uuid4().hex[:12]
    run_dir = prepare(run_id, settings=settings, base=b, train=train, held=held)
    if settings["engine"] == "llamafactory":
        prepare_llamafactory(run_dir)
    org = _org()
    meta = {"run_id": run_id, "org_id": org, "by": by, "settings": settings,
            "base": {k: b.get(k) for k in ("source", "dir", "architecture", "bytes")},
            "training_set": {k: {f: n.get(f) for f in ("id", "name", "version", "data_id", "row_count")}
                             for k, n in (("train", train), ("held_out", held))}}
    body = _run_llamafactory if settings["engine"] == "llamafactory" else _run
    job_id = await kernel().submit(JOB_KIND, lambda: body(run_dir, meta), org_id=org,
                                   idempotency_key=f"{JOB_KIND}:{org}", payload=meta)
    return {"job_id": job_id, "run_id": run_id, "settings": settings}


async def _run(run_dir: Path, meta: dict) -> dict:
    worker = Path(__file__).with_name("worker.py")
    env = {**os.environ, "TOKENIZERS_PARALLELISM": "false", "PYTORCH_ENABLE_MPS_FALLBACK": "1"}
    with open(run_dir / "worker.log", "ab") as log:
        proc = await asyncio.create_subprocess_exec(training_python(), "-I", str(worker), str(run_dir),
                                                    stdout=log, stderr=asyncio.subprocess.STDOUT, env=env)
        try:
            await proc.wait()
        except asyncio.CancelledError:
            (run_dir / "cancel").write_text(_now(), encoding="utf-8")
            try:
                await asyncio.wait_for(proc.wait(), timeout=60)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                proc.kill()
            raise
    result_path = run_dir / "result.json"
    result = json.loads(result_path.read_text(encoding="utf-8")) if result_path.exists() else {}
    if not result.get("ok"):
        raise RuntimeError(result.get("error") or f"the worker stopped with exit code {proc.returncode} and no result")
    return await asyncio.to_thread(record_trained, run_dir, meta, result)


# ── the LlamaFactory engine ───────────────────────────────────────────────────────────────────────────────────────
#
# Driven the way its own web UI drives it (the study, §2): a dataset and its registration in the run folder, a config,
# `llamafactory-cli train`, its `trainer_log.jsonl` followed; a LoRA run merged with `llamafactory-cli export`. No
# chat template is named, so it renders the base's own (measured 2026-11-24: minimind-3's, empty think block and all) —
# the same words the worker measures with and Ollama serves. Then the worker, in measure-only mode, measures the base
# and the result on the held-out questions exactly as it measures its own runs.

def prepare_llamafactory(run_dir: Path) -> None:
    import yaml
    cfg = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))
    data = run_dir / "lf_data"
    data.mkdir(exist_ok=True)
    rows = [json.loads(x) for x in (run_dir / "train.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    (data / "train.jsonl").write_text("".join(json.dumps({"messages": [
        {"role": "user", "content": r["prompt"]}, {"role": "assistant", "content": r["completion"]}]}) + "\n"
        for r in rows), encoding="utf-8")
    (data / "dataset_info.json").write_text(json.dumps({"knowledge": {
        "file_name": "train.jsonl", "formatting": "sharegpt", "columns": {"messages": "messages"},
        "tags": {"role_tag": "role", "content_tag": "content", "user_tag": "user", "assistant_tag": "assistant",
                 "system_tag": "system"}}}), encoding="utf-8")
    lora = cfg["method"] == "lora"
    train = {"model_name_or_path": cfg["base_dir"], "stage": "sft", "do_train": True,
             "finetuning_type": "lora" if lora else "full", **({"lora_target": "all", "lora_rank": cfg["lora_rank"]}
                                                             if lora else {}),
             "dataset": "knowledge", "dataset_dir": str(data), "cutoff_len": cfg["max_seq_len"],
             "overwrite_cache": True, "preprocessing_num_workers": 1, "dataloader_num_workers": 0,
             "output_dir": str(run_dir / "lf_out"), "overwrite_output_dir": True, "logging_steps": 5,
             "save_strategy": "no", "plot_loss": False, "report_to": "none",
             "per_device_train_batch_size": cfg["batch_size"], "gradient_accumulation_steps": 1,
             "learning_rate": cfg["learning_rate"], "num_train_epochs": float(cfg["epochs"]),
             "lr_scheduler_type": "cosine", "warmup_ratio": 0.05, "include_num_input_tokens_seen": True, "seed": 42}
    (run_dir / "lf_train.yaml").write_text(yaml.safe_dump(train, sort_keys=False), encoding="utf-8")
    if lora:
        merge = {"model_name_or_path": cfg["base_dir"], "adapter_name_or_path": str(run_dir / "lf_out"),
                 "finetuning_type": "lora", "export_dir": cfg["out_dir"], "export_size": 5, "export_device": "cpu",
                 "export_legacy_format": False}
        (run_dir / "lf_export.yaml").write_text(yaml.safe_dump(merge, sort_keys=False), encoding="utf-8")


def _emit(run_dir: Path, event: str, **data) -> None:
    import time
    with open(run_dir / "progress.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({"event": event, "at": time.time(), **data}) + "\n")


async def _step(args: list[str], run_dir: Path, env: dict, what: str) -> None:
    """One subprocess of a run, logged to the run's folder; a cancel stops it; a failure says what failed."""
    with open(run_dir / "engine.log", "ab") as log:
        proc = await asyncio.create_subprocess_exec(*args, stdout=log, stderr=asyncio.subprocess.STDOUT,
                                                    env=env, cwd=str(run_dir))
        try:
            await proc.wait()
        except asyncio.CancelledError:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=30)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                proc.kill()
            _emit(run_dir, "cancelled")
            raise
    if proc.returncode != 0:
        _emit(run_dir, "error", error=f"{what} stopped with exit code {proc.returncode} (engine.log)")
        raise RuntimeError(f"{what} stopped with exit code {proc.returncode}; its log is engine.log in the run folder")


async def _run_llamafactory(run_dir: Path, meta: dict) -> dict:
    from pramanyx.training.engines import LLAMAFACTORY_ENV, llamafactory_cli
    cli = llamafactory_cli()
    if not cli:
        raise RuntimeError("LlamaFactory is no longer installed where it was found")
    cfg = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))
    env = {**os.environ, **LLAMAFACTORY_ENV, "HF_DATASETS_CACHE": str(run_dir / "hf_cache")}
    _emit(run_dir, "start", engine="llamafactory", method=cfg["method"], device="", params=None,
          train_rows=len((run_dir / "train.jsonl").read_text(encoding="utf-8").splitlines()),
          held_rows=len((run_dir / "held_out.jsonl").read_text(encoding="utf-8").splitlines()))
    await _step([cli, "train", str(run_dir / "lf_train.yaml")], run_dir, env, "LlamaFactory's training")
    if cfg["method"] == "lora":
        _emit(run_dir, "merge")
        await _step([cli, "export", str(run_dir / "lf_export.yaml")], run_dir, env, "LlamaFactory's merge")
    else:
        import shutil
        shutil.copytree(run_dir / "lf_out", cfg["out_dir"], dirs_exist_ok=True)
    worker = Path(__file__).with_name("worker.py")
    await _step([training_python(), "-I", str(worker), "--measure", str(run_dir)], run_dir,
                {**os.environ, "TOKENIZERS_PARALLELISM": "false", "PYTORCH_ENABLE_MPS_FALLBACK": "1"},
                "the held-out measure")
    result = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
    if not result.get("ok"):
        raise RuntimeError(result.get("error") or "the held-out measure gave no result")
    return await asyncio.to_thread(record_trained, run_dir, meta, result)


def runs(org_id: Optional[str] = None, limit: int = 30) -> list[dict]:
    """The organisation's training runs, newest first: what each was asked to do, how far it got, what it made."""
    from pramanyx.kernel.ledger import Ledger
    org = org_id or _org()
    made = {str(m.get("run_id")): m.get("number") for m in models(org)}
    out = []
    for job in Ledger.default().jobs_where(kinds=[JOB_KIND], limit=200):
        if (job.get("org_id") or "default") != org:
            continue
        payload = job.get("payload") or {}
        run_id = str(payload.get("run_id") or "")
        events = progress(run_id) if run_id else []
        steps = [e for e in events if e.get("event") == "step"]
        measures = {e.get("label"): {k: e.get(k) for k in ("f1", "recalled", "answer_loss")}
                    for e in events if e.get("event") == "measure"}
        out.append({"job_id": job["id"], "run_id": run_id, "state": job.get("state"), "error": job.get("error") or "",
                    "created_at": job.get("created_at"), "by": payload.get("by") or "",
                    "settings": payload.get("settings") or {}, "rows": (payload.get("training_set") or {}).get(
                        "train", {}).get("row_count"),
                    "losses": [e.get("loss") for e in steps if e.get("loss") is not None],
                    "last_step": steps[-1] if steps else None, "measures": measures,
                    "model": made.get(run_id)})
    out.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return out[:limit]


def _measure_summary(m: dict) -> dict:
    return {k: m.get(k) for k in ("rows", "answer_loss", "f1", "recalled", "by_kind")}


def record_trained(run_dir: Path, meta: dict, result: dict) -> dict:
    """Keep the trained model as a draft version: what it was trained from, how, and how it measured."""
    from pramanyx.kernel import lifecycle
    from pramanyx.kernel.ledger import Ledger
    org = meta["org_id"]
    number = len(Ledger.default().artifacts_of_kind(KIND, org_id=org, limit=1000)) + 1
    (run_dir / "answers.json").write_text(json.dumps({"before": result["before"]["answers"],
                                                      "after": result["after"]["answers"]}), encoding="utf-8")
    cfg = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))
    connections = sorted({str((r.get("source") or {}).get("connection_id") or "")
                          for name in ("train.jsonl", "held_out.jsonl")
                          for r in (json.loads(x) for x in (run_dir / name).read_text().splitlines() if x)} - {""})
    body = {"number": number, "run_id": meta["run_id"], "trained_at": _now(), "trained_by": meta["by"],
            "base": meta["base"], "training_set": meta["training_set"], "settings": meta["settings"],
            "connections": connections, "dir": cfg["out_dir"], "device": result.get("device"),
            "engine": cfg.get("engine", "builtin"),
            "params": result.get("params"), "steps": result.get("steps"), "tokens": result.get("tokens"),
            "seconds": result.get("seconds"), "bytes": result.get("bytes"),
            "measure": {"before": _measure_summary(result["before"]), "after": _measure_summary(result["after"])},
            "served_as": ""}
    rev = lifecycle.record(KIND, natural_key(org, meta["run_id"]), body, "draft", by=meta["by"], org_id=org,
                           note="trained and measured; it answers nobody until an admin puts it in service")
    return {"number": number, "version": rev.version, "run_id": meta["run_id"], "measure": body["measure"]}


# ── the versions ──────────────────────────────────────────────────────────────────────────────────────────────────

def _view(art: dict) -> dict:
    payload = art.get("payload") or {}
    body, life = dict(payload.get("_body") or {}), dict(payload.get("_lifecycle") or {})
    return {**body, "state": life.get("state", "draft"), "recorded_at": life.get("created_at", ""),
            "published_at": life.get("published_at", ""), "note": life.get("note", ""),
            "revision": art.get("version")}


def models(org_id: Optional[str] = None) -> list[dict]:
    """The organisation's trained models, newest first, each as it stands now."""
    from pramanyx.kernel.ledger import Ledger
    rows = Ledger.default().artifacts_of_kind(KIND, org_id=org_id or _org(), limit=500)
    return sorted((_view(a) for a in rows), key=lambda m: -int(m.get("number") or 0))


def get_model(number: int, org_id: Optional[str] = None) -> Optional[dict]:
    return next((m for m in models(org_id) if int(m.get("number") or 0) == int(number)), None)


def answers(number: int) -> dict:
    """A model's held-out answers, before training and after."""
    m = get_model(number)
    if m is None:
        return {}
    p = models_dir() / "runs" / m["run_id"] / "answers.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def publish(number: int, *, by: str = "") -> dict:
    """Put a model in service: import it into Ollama and record it published."""
    from pramanyx.kernel import lifecycle
    from pramanyx.training import serve
    org = _org()
    m = get_model(number, org)
    if m is None:
        raise TrainingRefused(f"there is no model {number}")
    if m["state"] == "archived":
        raise TrainingRefused(f"model {number} was withdrawn; train again, or bring it back from its history")
    name = serve.model_name(org, number)
    serve.import_model(Path(m["dir"]), name)
    body = {k: v for k, v in m.items() if k not in ("state", "recorded_at", "published_at", "note", "revision")}
    body["served_as"] = name
    lifecycle.record(KIND, natural_key(org, m["run_id"]), body, "published", by=by, org_id=org,
                     note=f"put in service as the Ollama model {name}")
    return get_model(number, org) or {}


def withdraw(number: int, *, by: str = "", why: str = "") -> dict:
    """Withdraw a model: out of Ollama, archived on the record with its measure kept."""
    from pramanyx.kernel import lifecycle
    from pramanyx.training import serve
    org = _org()
    m = get_model(number, org)
    if m is None:
        raise TrainingRefused(f"there is no model {number}")
    if m.get("served_as"):
        serve.remove(m["served_as"])
    body = {k: v for k, v in m.items() if k not in ("state", "recorded_at", "published_at", "note", "revision")}
    lifecycle.record(KIND, natural_key(org, m["run_id"]), body, "archived", by=by, org_id=org,
                     note=f"withdrawn{': ' + why if why else ''}")
    return get_model(number, org) or {}


# ── asking ────────────────────────────────────────────────────────────────────────────────────────────────────────

def may_ask(m: dict) -> tuple[bool, str]:
    """Whether the asking person may see every connection the model learned from."""
    from pramanyx.security.authz import org_visible_conn_ids
    visible = org_visible_conn_ids()
    if visible is None:
        return True, ""
    hidden = [c for c in m.get("connections") or [] if c not in visible]
    if hidden:
        return False, (f"this model learned from {len(hidden)} connection(s) you may not see, so it does not answer "
                       f"you — what it remembers is theirs")
    return True, ""


def ask(number: int, question: str) -> dict:
    from pramanyx.training import serve
    m = get_model(number)
    if m is None:
        raise TrainingRefused(f"there is no model {number}")
    if m["state"] != "published" or not m.get("served_as"):
        raise TrainingRefused(f"model {number} is not in service; its held-out answers are readable until it is")
    ok, why = may_ask(m)
    if not ok:
        raise PermissionError(why)
    question = " ".join(str(question or "").split())
    if not question:
        raise TrainingRefused("ask a question")
    said = serve.ask(m["served_as"], question)
    checked = check_answer(said["answer"], _sources_of(m["run_id"]))
    if checked["verdict"] == "withheld":
        said = {**said, "answer": ""}         # withheld means not served: the words do not leave this door
    return {"model": number, "served_as": m["served_as"], "question": question, **said, **checked}


# ── every answer carries its source, or is withheld ───────────────────────────────────────────────────────────────
#
# Measured 2026-11-23 on model 1 (the live corpus): asked "What is Net promoter score at theLook?" — a word nobody there
# defined, and one the training set did not happen to sample — it answered with Repeat Purchase Rate's definition under
# NPS's name. Word overlap alone cannot catch that (F1 0.895 against Repeat Purchase Rate's answer, a true answer 1.0);
# the SUBJECT can: no source says anything about "Net promoter score at theLook". So an answer is shown only as a
# source's own: near word for word, and about the same subject. "Nothing is settled about X" asserts no fact and stands
# for any X. Anything else is withheld, and the page says so: provenance is required of a model's answer too.

#: How close an answer must be to a source's own words to be that source's answer.
SOURCE_MATCH = 0.95
_NOT_SETTLED = "nothing is settled about "


def _subject(text: str) -> str:
    """What an answer is about: its words up to the first colon (every template opens with its subject)."""
    head = str(text or "").split(":", 1)[0]
    return " ".join(head.lower().split())


@functools.lru_cache(maxsize=16)
def _sources_of(run_id: str) -> tuple[tuple[str, tuple[tuple[str, str], ...]], ...]:
    """The answers a model was taught (and held out), each with its source — read once from the run's own files."""
    run_dir = models_dir() / "runs" / run_id
    out: dict[str, dict] = {}
    for name in ("train.jsonl", "held_out.jsonl"):
        p = run_dir / name
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    row = json.loads(line)
                    out.setdefault(str(row.get("completion") or ""), row.get("source") or {})
    return tuple((answer, tuple(sorted((str(k), str(v)) for k, v in src.items()))) for answer, src in out.items())


def check_answer(answer: str, sources) -> dict:
    """Whether ``answer`` is a settled source's own answer (with the source), says nothing is settled, or is withheld."""
    from pramanyx.training.worker import f1
    if not answer.strip() or not sources:
        return {"verdict": "withheld", "why": "the model gave no answer" if not answer.strip()
                else "this model's training set could not be read, so its answers cannot be checked"}
    best, src = max(sources, key=lambda s: f1(answer, s[0]))
    score = f1(answer, best)
    if answer.lower().startswith(_NOT_SETTLED) and best.lower().startswith(_NOT_SETTLED) and score >= 0.8:
        return {"verdict": "not_settled", "match": round(score, 3)}
    if score >= SOURCE_MATCH and _subject(answer) == _subject(best):
        return {"verdict": "settled", "match": round(score, 3), "source": dict(src)}
    return {"verdict": "withheld", "match": round(score, 3), "closest": dict(src),
            "why": "the model's answer matches nothing the organisation settled, so it is not shown"}
