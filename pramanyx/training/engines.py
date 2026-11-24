"""The AI Factory's engines — what trains a model, and whether each can run here.

Studied and measured 2026-11-24 (`docs/AI_FACTORY_ENGINES_STUDY_2026-11-24.md`), each engine a door that says where it
stands rather than an option that fails when chosen:

* **built-in** — minimind's loop in `worker.py`; needs torch and transformers in the training interpreter. Runs
  anywhere the model fits. Trained the model in service.
* **LlamaFactory** — Apache-2.0, no telemetry; LoRA and full fine-tuning measured on an Apple M5 (MPS). Driven the way
  its own web UI drives it: a dataset and a config in the run folder, `llamafactory-cli train`, `trainer_log.jsonl`
  followed, `llamafactory-cli export` to merge. Found as `PRAMANYX_LLAMAFACTORY_CLI`, else `llamafactory-cli` on the PATH.
* **TRL** — GRPO measured on the M5 (MPS); offered once an environment has tasks the model passes 10–80% of the time.
* **prime-rl**, **hosted services**, **Axolotl** — said, not offered: prime-rl needs NVIDIA GPUs and registers runs with
  Prime Intellect unless told not to; a hosted service takes the tasks off the install; Axolotl's plugin code carries
  a licence that forbids fine-tuning platforms for third parties, and it did not train on MPS.

No engine is installed by the platform: each is the operator's to install, in its own interpreter (their pins clash).

**What a reader is told is `offered()`, nothing more** — the engines a run may be given, each by name and whether it is
ready here. The page does not say how a model is trained (the user, 2026-11-24: "lets not say how we do it.. we can
only give dropdown options"); `doors()` — statuses, reasons, setup commands, licences — stays inside the platform, read
by `runs.start`. What each engine can do is in the study.
"""
from __future__ import annotations

import functools
import os
import platform
import shutil
import subprocess
from typing import Optional

#: What a person may choose a run to be taught by, and the engines that teach that way here.
TEACH_BY = ("example", "preference", "reward")

#: The environment a LlamaFactory process is given: offline, no version check, no tracker, no Hugging Face login probe.
LLAMAFACTORY_ENV = {"DISABLE_VERSION_CHECK": "1", "HF_HUB_OFFLINE": "1", "HF_DATASETS_OFFLINE": "1",
                    "TOKENIZERS_PARALLELISM": "false", "PYTORCH_ENABLE_MPS_FALLBACK": "1",
                    "WANDB_DISABLED": "true", "DO_NOT_TRACK": "1"}


def hardware() -> dict:
    """What this machine trains on, in words a person reads."""
    machine, system = platform.machine(), platform.system()
    try:
        memory = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (ValueError, OSError, AttributeError):
        memory = 0
    nvidia = shutil.which("nvidia-smi") is not None
    accel = "Apple silicon (MPS)" if system == "Darwin" and machine == "arm64" else ("NVIDIA (CUDA)" if nvidia else "CPU")
    return {"system": system, "machine": machine, "memory_bytes": memory, "accelerator": accel, "nvidia": nvidia}


def llamafactory_cli() -> Optional[str]:
    """Where LlamaFactory's CLI is: the operator's setting, else the PATH."""
    named = os.getenv("PRAMANYX_LLAMAFACTORY_CLI", "").strip()
    if named:
        return named if os.path.exists(named) else None
    return shutil.which("llamafactory-cli")


@functools.lru_cache(maxsize=4)
def _llamafactory_version(cli: str) -> str:
    """The installed LlamaFactory's version, asked once per process — "" when it does not answer."""
    try:
        out = subprocess.run([cli, "version"], capture_output=True, text=True, timeout=60,
                             env={**os.environ, **LLAMAFACTORY_ENV})
    except (OSError, subprocess.TimeoutExpired):
        return ""
    import re
    m = re.search(r"(\d+\.\d+\.\d+(?:\.dev\d+)?)", out.stdout + out.stderr)
    return m.group(1) if m else ""


def doors() -> list[dict]:
    """Every engine, with whether it runs here and why not when it does not."""
    from pramanyx.training.runs import setup
    hw = hardware()
    built = setup()
    cli = llamafactory_cli()
    lf_version = _llamafactory_version(cli) if cli else ""
    trl_ready = built["ready"] and "trl" not in _missing_trl(built["python"])
    return [
        {"id": "builtin", "name": "Built-in", "status": "ready" if built["ready"] else "needs_setup",
         "version": "", "why": "" if built["ready"] else f"{', '.join(built['missing'])} missing",
         "how": built["how"], "teaches": ["example"], "runs_here": True,
         "summary": "MiniMind's loop, in Pramanyx. Small bases, on any machine."},
        {"id": "llamafactory", "name": "LlamaFactory", "version": lf_version,
         "status": "ready" if cli and lf_version else "needs_setup",
         "why": "" if cli and lf_version else ("not installed" if not cli else "installed, but it did not answer"),
         "how": "" if cli and lf_version else "uv tool install llamafactory, or set PRAMANYX_LLAMAFACTORY_CLI to its CLI",
         "teaches": ["example"], "runs_here": True,
         "summary": "Every tuning method and the newer bases. Runs on this machine in its own interpreter."},
        {"id": "trl", "name": "TRL", "version": "", "status": "ready" if trl_ready else "needs_setup",
         "why": "" if trl_ready else "trl is not in the training interpreter",
         "how": "" if trl_ready else "uv pip install trl into the training interpreter",
         "teaches": [], "runs_here": True,
         "summary": "Reward training (GRPO). Offered when an environment has tasks the model passes 10–80% of the time."},
        {"id": "prime-rl", "name": "prime-rl", "version": "", "status": "unavailable" if not hw["nvidia"] else "not_offered",
         "why": "needs NVIDIA GPUs" if not hw["nvidia"] else "not wired yet", "how": "", "teaches": [],
         "runs_here": hw["nvidia"],
         "summary": "Prime Intellect's async RL trainer. Registers each run with Prime Intellect unless told not to."},
        {"id": "hosted", "name": "Hosted services", "version": "", "status": "off",
         "why": "the tasks and the data would leave the install", "how": "", "teaches": [], "runs_here": False,
         "summary": "Tinker, Prime Model Factory: you write the rewards, they run the GPUs."},
        {"id": "axolotl", "name": "Axolotl", "version": "", "status": "review",
         "why": "its plugin licence forbids fine-tuning platforms for third parties; it did not train on MPS",
         "how": "", "teaches": [], "runs_here": False,
         "summary": "GRPO, distillation and GGUF export, on NVIDIA GPUs — after a licence review."},
    ]


@functools.lru_cache(maxsize=4)
def _missing_trl(python: str) -> tuple[str, ...]:
    import sys
    if python == sys.executable:
        import importlib.util
        return () if importlib.util.find_spec("trl") else ("trl",)
    try:
        out = subprocess.run([python, "-I", "-c", "import importlib.util as u; print('' if u.find_spec('trl') else 'trl')"],
                             capture_output=True, text=True, timeout=30)
        return tuple(x for x in out.stdout.split() if x)
    except (OSError, subprocess.TimeoutExpired):
        return ("trl",)


def door(engine_id: str) -> Optional[dict]:
    return next((d for d in doors() if d["id"] == engine_id), None)


def offered() -> list[dict]:
    """The engines a run may be given — a dropdown's options: id, name, and whether it is ready here. Nothing else."""
    from pramanyx.training.runs import ENGINES
    return [{"id": d["id"], "name": d["name"], "ready": d["status"] == "ready"} for d in doors() if d["id"] in ENGINES]
