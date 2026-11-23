"""Serving the organisation's model through Ollama — the local runtime the install already runs.

Nothing here serves a model by hand. A trained folder is a stock transformers checkpoint in safetensors, which Ollama
imports as it is (measured 2026-11-23: Ollama 0.40 imported minimind-3's Qwen3 weights from safetensors and answered on
both `/api/chat` and its OpenAI-style `/v1/chat/completions`). Once imported it is an Ollama model like any other: asked
here, and listed by the provider layer's own catalogue, so a person can pick it for a role in Settings ▸ Models.

The prompt template is the one the model was trained through — written by the worker from the tokenizer's own chat
template (`ollama_template.json`) — so the words around a question at serving are the words around it in training.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Optional

#: The files of a model folder Ollama is given.
_FILES = ("*.json", "*.safetensors", "*.jinja")


class ServingUnavailable(RuntimeError):
    """Ollama could not be reached or refused the model — said with why."""


def ollama_root() -> str:
    """Ollama's native API root, from the same configuration the provider layer reads."""
    from pramanyx.llm.models import ollama_native_root
    from pramanyx.llm.provider import endpoint_for
    base, _ = endpoint_for("ollama")
    return ollama_native_root(base or "http://localhost:11434")


def model_name(org_id: str, version: int) -> str:
    """The Ollama name of one version — made from the organisation and the version, never a catalogue's id."""
    org = re.sub(r"[^a-z0-9]+", "-", (org_id or "default").lower()).strip("-") or "default"
    return f"pramanyx-own-{org}:v{int(version)}"


def reachable(timeout: float = 3.0) -> tuple[bool, str]:
    """Whether Ollama answers, and its version or why not."""
    import httpx
    try:
        r = httpx.get(f"{ollama_root()}/api/version", timeout=timeout)
        r.raise_for_status()
        return True, str(r.json().get("version") or "")
    except Exception as exc:  # noqa: BLE001 — unreachable is a state the page shows
        return False, f"Ollama did not answer at {ollama_root()}: {type(exc).__name__}"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def import_model(folder: Path, name: str, *, timeout: float = 600.0) -> dict:
    """Give Ollama the model in ``folder`` under ``name``: each file as a blob, then one create. Returns Ollama's
    final status."""
    import httpx
    root = ollama_root()
    files: dict[str, str] = {}
    paths = sorted({p for pat in _FILES for p in folder.glob(pat)
                    if p.is_file() and p.name != "ollama_template.json"})
    if not any(p.suffix == ".safetensors" for p in paths):
        raise ServingUnavailable(f"{folder} holds no safetensors weights to serve")
    with httpx.Client(timeout=timeout) as client:
        for p in paths:
            blob = f"sha256:{_sha256(p)}"
            if client.head(f"{root}/api/blobs/{blob}").status_code != 200:
                with open(p, "rb") as f:
                    r = client.post(f"{root}/api/blobs/{blob}", content=f)
                if r.status_code not in (200, 201):
                    raise ServingUnavailable(f"Ollama refused {p.name}: {r.status_code} {r.text[:200]}")
            files[p.name] = blob
        body: dict = {"model": name, "files": files, "stream": False}
        tpl_path = folder / "ollama_template.json"
        if tpl_path.exists():
            tpl = json.loads(tpl_path.read_text(encoding="utf-8"))
            body["template"] = tpl["template"]
            body["parameters"] = {"stop": tpl.get("stop") or [], "temperature": 0, "num_predict": 360}
        r = client.post(f"{root}/api/create", json=body)
    if r.status_code != 200:
        raise ServingUnavailable(f"Ollama could not create {name}: {r.status_code} {r.text[:300]}")
    return r.json() if r.text.strip().startswith("{") else {"status": r.text[-200:]}


def remove(name: str) -> bool:
    """Take a withdrawn version out of Ollama, so nobody can pick it. The record of it stays."""
    import httpx
    try:
        r = httpx.request("DELETE", f"{ollama_root()}/api/delete", json={"model": name}, timeout=30.0)
        return r.status_code == 200
    except Exception as exc:  # noqa: BLE001 — the version is withdrawn on the record whatever Ollama says
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "Ollama did not remove a withdrawn version; it is withdrawn on the record",
                 counter="training.serve_remove")
        return False


def ask(name: str, question: str, *, timeout: float = 120.0, system: Optional[str] = None) -> dict:
    """One question to a served version, answered greedily (the same answer to the same question)."""
    import httpx
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": question}]
    try:
        r = httpx.post(f"{ollama_root()}/api/chat", timeout=timeout,
                       json={"model": name, "messages": messages, "stream": False,
                             "options": {"temperature": 0, "num_predict": 360}})
    except Exception as exc:  # noqa: BLE001
        raise ServingUnavailable(f"Ollama did not answer at {ollama_root()}: {type(exc).__name__}") from exc
    if r.status_code != 200:
        raise ServingUnavailable(f"Ollama could not answer with {name}: {r.status_code} {r.text[:200]}")
    d = r.json()
    return {"answer": str((d.get("message") or {}).get("content") or "").strip(),
            "tokens": d.get("eval_count"), "ms": round((d.get("total_duration") or 0) / 1e6)}
