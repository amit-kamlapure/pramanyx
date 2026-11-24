"""The base an organisation's model starts from — named by an admin, fetched into the state folder, never shipped.

A model taught language from nothing on a company's few hundred thousand tokens does not speak (measured 2026-11-23 on
an Apple M5: ~6,500 tokens a second for a 30M model, so the hundreds of millions of tokens a language needs are days).
A small pretrained base does, and fine-tuning it on the company's corpus takes minutes. So the base is a door: an admin
names a Hugging Face repository or a folder on this machine; the platform fetches its weights (safetensors only — a
pickled checkpoint runs code on load) and records what it fetched in `llm_config.json` beside the rest of the model
configuration. No repository name is written here (no model id ships in the product).
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

#: The key in `llm_config.json`.
CONFIG_KEY = "own_model_base"

#: The files a base needs, and the only ones fetched: config, tokenizer, chat template, weights as safetensors.
ALLOW_PATTERNS = ("*.json", "*.safetensors", "*.jinja", "*.txt", "*.model")

#: The architectures the worker trains and Ollama imports from safetensors (measured: Ollama 0.40 imported
#: minimind-3's `Qwen3ForCausalLM` directly). Another architecture is refused with that said, not tried.
SUPPORTED_ARCHITECTURES = ("Qwen3ForCausalLM", "Qwen2ForCausalLM", "LlamaForCausalLM", "MistralForCausalLM",
                           "Gemma2ForCausalLM", "Gemma3ForCausalLM", "Phi3ForCausalLM")


class BaseRefused(ValueError):
    """The named base cannot be used — said with why."""


def models_dir() -> Path:
    """Where bases, runs and trained models live: `PRAMANYX_MODELS_DIR`, else `<state dir>/models`."""
    p = os.getenv("PRAMANYX_MODELS_DIR", "")
    if p:
        return Path(p)
    from pramanyx.db.paths import state_dir
    return state_dir() / "models"


def _slug(source: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", source.lower()).strip("-")[:80] or "base"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def current() -> Optional[dict]:
    """The base on record, with whether its folder still holds it — or None when none was named."""
    from pramanyx.llm.provider import read_config
    entry = read_config().get(CONFIG_KEY)
    if not isinstance(entry, dict) or not entry.get("dir"):
        return None
    folder = Path(entry["dir"])
    return {**entry, "present": (folder / "config.json").exists() and any(folder.glob("*.safetensors"))}


def describe(folder: Path) -> dict:
    """What a base folder holds: its architecture, size in parameters (from the config) and bytes. Refuses one this
    platform cannot train or serve."""
    cfg_path = folder / "config.json"
    if not cfg_path.exists():
        raise BaseRefused(f"{folder} holds no config.json; a base is a model folder in the transformers layout")
    if not any(folder.glob("*.safetensors")):
        raise BaseRefused("the base has no .safetensors weights; a pickled checkpoint is refused (it runs code on load)")
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    arch = (cfg.get("architectures") or [""])[0]
    if arch not in SUPPORTED_ARCHITECTURES:
        raise BaseRefused(f"the base is a {arch or 'model of no declared architecture'}; the trainer and Ollama's "
                          f"import take {', '.join(SUPPORTED_ARCHITECTURES)}")
    size = sum(p.stat().st_size for p in folder.rglob("*") if p.is_file() and ".cache" not in p.parts)
    return {"architecture": arch, "hidden_size": cfg.get("hidden_size"), "layers": cfg.get("num_hidden_layers"),
            "vocab_size": cfg.get("vocab_size"), "bytes": size}


def _download(repo: str, folder: Path) -> None:
    """Download ``repo``'s base files into ``folder`` with the TRAINING interpreter, the one that has the libraries
    (`runs.training_python`) — the API's own process never imports them."""
    import subprocess

    from pramanyx.training.runs import setup, training_python
    ready = setup()
    if not ready["ready"]:
        raise BaseRefused(f"fetching a base needs the training libraries: {', '.join(ready['missing'])} missing — "
                          f"{ready['how']}")
    worker = Path(__file__).with_name("worker.py")
    done = subprocess.run([training_python(), "-I", str(worker), "--fetch", repo, str(folder), *ALLOW_PATTERNS],
                          capture_output=True, text=True, timeout=1800)
    if done.returncode != 0:
        tail = (done.stderr or done.stdout or "").strip().splitlines()[-1:] or ["no output"]
        raise BaseRefused(f"the base {repo} could not be fetched: {tail[0][:300]}")


def fetch(source: str, *, by: str = "") -> dict:
    """Fetch the base ``source`` names — a Hugging Face repository (``owner/name``) or a folder on this machine — and
    record it. Returns the record. A folder is used where it is; a repository is downloaded into the models folder."""
    from pramanyx.llm.provider import read_config, write_config
    source = (source or "").strip()
    if not source:
        raise BaseRefused("name the base: a Hugging Face repository such as owner/name, or a folder on this machine")
    local = Path(source).expanduser()
    if local.is_absolute():
        if not local.is_dir():
            raise BaseRefused(f"{local} is not a folder on this machine")
        folder = local
    else:
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", source):
            raise BaseRefused("a repository is named owner/name; a folder by its full path")
        folder = models_dir() / "base" / _slug(source)
        _download(source, folder)
    record = {"source": source, "dir": str(folder), **describe(folder), "fetched_at": _now(), "by": by}
    cfg = dict(read_config())
    cfg[CONFIG_KEY] = record
    write_config(cfg)
    return {**record, "present": True}
