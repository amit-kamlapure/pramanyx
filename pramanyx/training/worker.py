"""The training worker — one run, in its own process, reading files and writing files.

Started by `pramanyx/training/runs.py` as ``python worker.py <run_dir>`` — BY PATH, so the process never imports the
`pramanyx` package and never opens a store (one writer per state folder: the API is that writer). Everything it needs
is in ``<run_dir>/config.json``; everything it learns goes to ``<run_dir>/progress.jsonl`` (one event a line, read by
the API while it runs), ``<run_dir>/result.json`` (written last) and the model folder ``config["out_dir"]``. A file
``<run_dir>/cancel`` stops it at the next step.

The loops follow minimind (github.com/jingyaogong/minimind, Apache-2.0 — NOTICE): supervised fine-tuning whose loss
falls only on the answer's tokens, AdamW with a clipped gradient, a cosine learning rate that bottoms out at a tenth,
and LoRA as low-rank A·B branches beside the base weights, merged back so what comes out is a whole model. The model is
a stock `transformers` causal LM — minimind's own models are written as `Qwen3ForCausalLM` — so the folder it leaves
is served by Ollama, llama.cpp or vLLM unchanged and by nothing hand-rolled here.

The measure is taken twice on the held-out phrasings, before training and after, with the same settings: the mean loss
on the answer's tokens, and greedy answers scored by word overlap with the answer the company gave (F1). Deterministic,
no model as judge.
"""
from __future__ import annotations

import json
import math
import os
import random
import re
import sys
import time
from collections import Counter
from pathlib import Path

#: Events a reader of progress.jsonl may see.
EVENTS = ("start", "step", "epoch", "measure", "saved", "done", "error", "cancelled")


class Cancelled(Exception):
    pass


def _emit(run_dir: Path, event: str, **data) -> None:
    with open(run_dir / "progress.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({"event": event, "at": time.time(), **data}) + "\n")


def _rows(path: str) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def pick_device(torch) -> str:
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def lr_at(step: int, total: int, lr: float, warmup_ratio: float = 0.05) -> float:
    """minimind's schedule: linear warmup, then a cosine from ``lr`` down to a tenth of it."""
    warmup = max(1, int(warmup_ratio * total)) if warmup_ratio > 0 else 0
    if step < warmup:
        return lr * (step + 1) / warmup
    angle = math.pi * (step - warmup) / max(1, total - warmup)
    return lr * (0.1 + 0.45 * (1 + math.cos(angle)))


def encode(tokenizer, prompt: str, completion: str, max_len: int, system: str = "") -> tuple[list[int], list[int]]:
    """Token ids and labels for one question and answer: the loss falls on the answer and its closing token only.

    The prompt is the chat template up to the assistant's turn (``add_generation_prompt``) — exactly what is sent at
    inference — so the split is by the template the model will be asked through, not by searching for markers."""
    head = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    p_text = tokenizer.apply_chat_template(head, tokenize=False, add_generation_prompt=True)
    full = tokenizer.apply_chat_template(head + [{"role": "assistant", "content": completion}], tokenize=False)
    if not full.startswith(p_text):
        # The template renders the answer's turn differently from the generation prompt; train on the answer alone
        # after the prompt as it will be sent, which is what inference reads.
        full = p_text + completion + (tokenizer.eos_token or "")
    p_ids = tokenizer(p_text, add_special_tokens=False).input_ids
    ids = tokenizer(full, add_special_tokens=False).input_ids
    # The answer ends at its end-of-turn token: what the template writes after it (a newline) is not the answer's, and
    # a model taught to write it would write it at the start of every next turn. Cut by the token's id, not by how a
    # tokenizer happens to decode it.
    eos = tokenizer.eos_token_id
    if eos is not None and eos in ids[len(p_ids):]:
        ids = ids[: len(ids) - ids[::-1].index(eos)]
    ids = ids[:max_len]
    labels = [-100] * min(len(p_ids), len(ids)) + ids[len(p_ids):]
    return ids, labels[:len(ids)]


def _batches(examples: list, batch_size: int, seed: int, shuffle: bool = True):
    order = list(range(len(examples)))
    if shuffle:
        random.Random(seed).shuffle(order)
    for i in range(0, len(order), batch_size):
        yield [examples[j] for j in order[i:i + batch_size]]


def _collate(torch, batch, pad_id: int, device: str):
    width = max(len(ids) for ids, _ in batch)
    x = torch.full((len(batch), width), pad_id, dtype=torch.long)
    y = torch.full((len(batch), width), -100, dtype=torch.long)
    mask = torch.zeros((len(batch), width), dtype=torch.long)
    for i, (ids, labels) in enumerate(batch):
        x[i, :len(ids)] = torch.tensor(ids)
        y[i, :len(labels)] = torch.tensor(labels)
        mask[i, :len(ids)] = 1
    return x.to(device), y.to(device), mask.to(device)


class LoRA:
    """A rank-r A·B branch beside a frozen Linear, as minimind's `model_lora.py` — on every projection, not only the
    square ones, and merged back into the weight at the end so the folder is a whole model."""

    @staticmethod
    def apply(torch, model, rank: int, alpha: float) -> list:
        nn = torch.nn
        wrapped = []
        for name, module in list(model.named_modules()):
            if not isinstance(module, nn.Linear) or "lm_head" in name:
                continue
            a = nn.Linear(module.in_features, rank, bias=False).to(module.weight.device)
            b = nn.Linear(rank, module.out_features, bias=False).to(module.weight.device)
            nn.init.normal_(a.weight, std=0.02)
            nn.init.zeros_(b.weight)
            scale = alpha / rank
            module.lora_a, module.lora_b, module.lora_scale = a, b, scale
            original = module.forward

            def forward(x, _orig=original, _a=a, _b=b, _s=scale):
                return _orig(x) + _b(_a(x)) * _s

            module.forward = forward
            wrapped.append(module)
        for p in model.parameters():
            p.requires_grad = False
        for m in wrapped:
            for p in (*m.lora_a.parameters(), *m.lora_b.parameters()):
                p.requires_grad = True
        return wrapped

    @staticmethod
    def merge(torch, wrapped: list) -> None:
        with torch.no_grad():
            for m in wrapped:
                m.weight += (m.lora_b.weight.float() @ m.lora_a.weight.float()).to(m.weight.dtype) * m.lora_scale
                del m.forward                   # back to the class's own forward
                del m.lora_a, m.lora_b, m.lora_scale


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9_.%$]+", (text or "").lower())


def f1(pred: str, ref: str) -> float:
    """Word-overlap F1 between an answer and the company's answer — the reading-comprehension measure, deterministic."""
    p, r = _words(pred), _words(ref)
    if not p or not r:
        return 0.0
    common = sum((Counter(p) & Counter(r)).values())
    if not common:
        return 0.0
    precision, recall = common / len(p), common / len(r)
    return 2 * precision * recall / (precision + recall)


def measure(torch, model, tokenizer, rows: list[dict], cfg: dict, device: str, *, label: str,
            cancel_file: Path) -> dict:
    """The held-out measure: mean answer loss, and greedy answers scored by F1 against the company's answer."""
    model.eval()
    max_len, system = int(cfg.get("max_seq_len", 512)), str(cfg.get("system") or "")
    rows = rows[: int(cfg.get("measure_limit", 200))]
    losses = []
    with torch.no_grad():
        for batch in _batches([encode(tokenizer, r["prompt"], r["completion"], max_len, system) for r in rows],
                              16, 0, shuffle=False):
            x, y, mask = _collate(torch, batch, tokenizer.pad_token_id, device)
            out = model(input_ids=x, attention_mask=mask, labels=y)
            losses.append(float(out.loss))
    answers = []
    tokenizer.padding_side = "left"
    new_tokens = int(cfg.get("measure_new_tokens", 280))
    with torch.no_grad():
        for i in range(0, len(rows), 16):
            if cancel_file.exists():
                raise Cancelled()
            chunk = rows[i:i + 16]
            prompts = [tokenizer.apply_chat_template(
                ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": r["prompt"]}],
                tokenize=False, add_generation_prompt=True) for r in chunk]
            enc = tokenizer(prompts, return_tensors="pt", padding=True, add_special_tokens=False).to(device)
            gen = model.generate(**enc, max_new_tokens=new_tokens, do_sample=False,
                                 pad_token_id=tokenizer.pad_token_id, eos_token_id=tokenizer.eos_token_id)
            for r, g in zip(chunk, gen):
                text = tokenizer.decode(g[enc.input_ids.shape[1]:], skip_special_tokens=True).strip()
                answers.append({"question": r["prompt"], "expected": r["completion"], "answer": text,
                                "f1": round(f1(text, r["completion"]), 4), "source": r.get("source") or {}})
    tokenizer.padding_side = "right"
    result = {"label": label, "rows": len(rows),
              "answer_loss": round(sum(losses) / len(losses), 4) if losses else None,
              **_scores(answers), "by_kind": {}, "answers": answers}
    kinds = sorted({str((a["source"] or {}).get("kind") or "") for a in answers})
    for kind in kinds:
        result["by_kind"][kind] = _scores([a for a in answers if (a["source"] or {}).get("kind", "") == kind])
    model.train()
    return result


#: The F1 at which an answer counts as the company's answer recalled.
RECALLED_AT = 0.6


def _scores(answers: list[dict]) -> dict:
    scores = [a["f1"] for a in answers]
    if not scores:
        return {"n": 0, "f1": None, "recalled": None}
    return {"n": len(scores), "f1": round(sum(scores) / len(scores), 4),
            "recalled": round(sum(1 for s in scores if s >= RECALLED_AT) / len(scores), 4)}


_U, _S = "\u2063USER\u2063", "\u2063SYSTEM\u2063"


def ollama_template(tokenizer, system: str = "") -> dict:
    """Ollama's prompt template, written from the tokenizer's own chat template — one question and its answer, the
    shape this model was trained on — so serving puts the same words around a question that training did. Rendered
    with stand-ins for the system text and the question, then cut at them."""
    head = tokenizer.apply_chat_template([{"role": "user", "content": _U}], tokenize=False, add_generation_prompt=True)
    before_u, after_u = head.split(_U, 1)
    with_sys = tokenizer.apply_chat_template([{"role": "system", "content": _S}, {"role": "user", "content": _U}],
                                             tokenize=False, add_generation_prompt=True).split(_U, 1)[0]
    sys_block = with_sys[: len(with_sys) - len(before_u)] if with_sys.endswith(before_u) else ""
    sys_prefix, sys_suffix = sys_block.split(_S, 1) if _S in sys_block else ("", "")
    eos = tokenizer.eos_token or ""
    template = ("{{- if .System }}" + sys_prefix + "{{ .System }}" + sys_suffix + "{{ end }}"
                + "{{- range .Messages }}{{- if eq .Role \"user\" }}" + before_u + "{{ .Content }}" + after_u
                + "{{ else if eq .Role \"assistant\" }}{{ .Content }}" + eos + "\n{{ end }}{{- end }}")
    stop = [t for t in (eos, tokenizer.bos_token if (tokenizer.bos_token or "").startswith("<|") else "") if t]
    return {"template": template, "stop": stop, "system": system}


def run(run_dir: Path) -> dict:
    cfg = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))
    cancel_file = run_dir / "cancel"
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    seed = int(cfg.get("seed", 42))
    random.seed(seed)
    torch.manual_seed(seed)
    device = cfg.get("device") or pick_device(torch)
    tokenizer = AutoTokenizer.from_pretrained(cfg["base_dir"])
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    model = AutoModelForCausalLM.from_pretrained(cfg["base_dir"], dtype=torch.float32).to(device)
    train_rows, held_rows = _rows(cfg["train"]), _rows(cfg["held_out"])
    params = sum(p.numel() for p in model.parameters())
    _emit(run_dir, "start", device=device, params=params, train_rows=len(train_rows), held_rows=len(held_rows),
          method=cfg.get("method", "full"), torch=torch.__version__)

    before = measure(torch, model, tokenizer, held_rows, cfg, device, label="before", cancel_file=cancel_file)
    _emit(run_dir, "measure", **{k: v for k, v in before.items() if k != "answers"})

    max_len, system = int(cfg.get("max_seq_len", 512)), str(cfg.get("system") or "")
    examples = [encode(tokenizer, r["prompt"], r["completion"], max_len, system) for r in train_rows]
    examples = [e for e in examples if any(t != -100 for t in e[1])]
    method = cfg.get("method", "full")
    wrapped = LoRA.apply(torch, model, int(cfg.get("lora_rank", 16)), float(cfg.get("lora_alpha", 32))) \
        if method == "lora" else []
    trainable = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(trainable, lr=float(cfg["learning_rate"]), weight_decay=0.0)
    epochs, batch_size = int(cfg.get("epochs", 3)), int(cfg.get("batch_size", 8))
    steps_per_epoch = math.ceil(len(examples) / batch_size)
    total = max(1, epochs * steps_per_epoch)
    amp = torch.bfloat16 if device in ("mps", "cuda") else None
    step, tokens, t0 = 0, 0, time.time()
    model.train()
    for epoch in range(epochs):
        epoch_loss, n = 0.0, 0
        for batch in _batches(examples, batch_size, seed + epoch):
            if cancel_file.exists():
                raise Cancelled()
            x, y, mask = _collate(torch, batch, tokenizer.pad_token_id, device)
            lr = lr_at(step, total, float(cfg["learning_rate"]))
            for g in optimizer.param_groups:
                g["lr"] = lr
            if amp is not None:
                with torch.autocast(device_type=device, dtype=amp):
                    loss = model(input_ids=x, attention_mask=mask, labels=y).loss
            else:
                loss = model(input_ids=x, attention_mask=mask, labels=y).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(trainable, float(cfg.get("grad_clip", 1.0)))
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
            step += 1
            tokens += int(mask.sum())
            epoch_loss += float(loss.detach())
            n += 1
            if step % int(cfg.get("log_every", 5)) == 0 or step == total:
                _emit(run_dir, "step", step=step, total=total, epoch=epoch + 1, loss=round(float(loss.detach()), 4),
                      lr=lr, tokens=tokens, tokens_per_s=round(tokens / max(1e-6, time.time() - t0)))
        _emit(run_dir, "epoch", epoch=epoch + 1, epochs=epochs, loss=round(epoch_loss / max(1, n), 4))

    if wrapped:
        LoRA.merge(torch, wrapped)
    after = measure(torch, model, tokenizer, held_rows, cfg, device, label="after", cancel_file=cancel_file)
    _emit(run_dir, "measure", **{k: v for k, v in after.items() if k != "answers"})

    out = Path(cfg["out_dir"])
    out.mkdir(parents=True, exist_ok=True)
    # A base whose config names no end-of-turn token generates past its answer in every runtime that reads the
    # config (measured on minimind-3: transformers ran on to the token cap). Said here, once, for whoever serves it.
    for conf in (model.config, model.generation_config):
        conf.eos_token_id, conf.pad_token_id = tokenizer.eos_token_id, tokenizer.pad_token_id
        if tokenizer.bos_token_id is not None:
            conf.bos_token_id = tokenizer.bos_token_id
    model.to(torch.float16 if cfg.get("save_dtype", "float16") == "float16" else torch.float32)
    model.save_pretrained(out)
    tokenizer.save_pretrained(out)
    (out / "ollama_template.json").write_text(json.dumps(ollama_template(tokenizer, system)), encoding="utf-8")
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    _emit(run_dir, "saved", out_dir=str(out), bytes=size)
    return {"ok": True, "device": device, "params": params, "method": method, "steps": step, "tokens": tokens,
            "seconds": round(time.time() - t0, 1), "bytes": size, "before": before, "after": after}


def measure_only(run_dir: Path) -> dict:
    """``worker.py --measure <run_dir>`` — for a model another engine trained into ``out_dir``: measure the base and the
    result on the held-out questions exactly as `run` does its own, say where the answer ends, and write the template
    Ollama serves it with. The weights are not rewritten."""
    cfg = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))
    cancel_file = run_dir / "cancel"
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    device = cfg.get("device") or pick_device(torch)
    out = Path(cfg["out_dir"])
    tokenizer = AutoTokenizer.from_pretrained(out)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    held_rows, t0 = _rows(cfg["held_out"]), time.time()
    base = AutoModelForCausalLM.from_pretrained(cfg["base_dir"], dtype=torch.float32).to(device)
    before = measure(torch, base, tokenizer, held_rows, cfg, device, label="before", cancel_file=cancel_file)
    _emit(run_dir, "measure", **{k: v for k, v in before.items() if k != "answers"})
    del base
    model = AutoModelForCausalLM.from_pretrained(out, dtype=torch.float32).to(device)
    params = sum(p.numel() for p in model.parameters())
    after = measure(torch, model, tokenizer, held_rows, cfg, device, label="after", cancel_file=cancel_file)
    _emit(run_dir, "measure", **{k: v for k, v in after.items() if k != "answers"})
    # Where the answer ends, said in the files every runtime reads (minimind-3's config named no end-of-turn token).
    for name in ("config.json", "generation_config.json"):
        path = out / name
        doc = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        doc.update(eos_token_id=tokenizer.eos_token_id, pad_token_id=tokenizer.pad_token_id,
                   **({"bos_token_id": tokenizer.bos_token_id} if tokenizer.bos_token_id is not None else {}))
        path.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    (out / "ollama_template.json").write_text(json.dumps(ollama_template(tokenizer, str(cfg.get("system") or ""))),
                                              encoding="utf-8")
    state = run_dir / "lf_out" / "trainer_state.json"
    trained = json.loads(state.read_text(encoding="utf-8")) if state.exists() else {}
    seen = run_dir / "lf_out" / "all_results.json"
    results = json.loads(seen.read_text(encoding="utf-8")) if seen.exists() else {}
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    _emit(run_dir, "saved", out_dir=str(out), bytes=size)
    seconds = float(results.get("train_runtime") or 0.0) + (time.time() - t0)
    return {"ok": True, "device": device, "params": params, "method": cfg.get("method"),
            "steps": trained.get("global_step"), "tokens": results.get("num_input_tokens_seen"),
            "seconds": round(seconds, 1), "bytes": size, "before": before, "after": after}


def fetch(repo: str, folder: str, patterns: list[str]) -> int:
    """``worker.py --fetch <owner/name> <folder> <pattern>...`` — a base's files from Hugging Face, in this process (it
    has the libraries; the API's does not need them)."""
    from huggingface_hub import snapshot_download
    Path(folder).mkdir(parents=True, exist_ok=True)
    snapshot_download(repo, local_dir=folder, allow_patterns=patterns)
    return 0


def main(argv: list[str]) -> int:
    if len(argv) > 1 and argv[1] == "--fetch":
        return fetch(argv[2], argv[3], argv[4:])
    measure_mode = len(argv) > 2 and argv[1] == "--measure"
    run_dir = Path(argv[2] if measure_mode else argv[1])
    try:
        result = measure_only(run_dir) if measure_mode else run(run_dir)
        status = 0
        _emit(run_dir, "done", seconds=result["seconds"])
    except Cancelled:
        result, status = {"ok": False, "cancelled": True, "error": "cancelled by a person"}, 2
        _emit(run_dir, "cancelled")
    except Exception as exc:  # noqa: BLE001 — the run's own record says what failed; the API reads it
        import traceback
        result, status = {"ok": False, "error": f"{type(exc).__name__}: {exc}",
                          "trace": traceback.format_exc()[-4000:]}, 1
        _emit(run_dir, "error", error=result["error"])
    (run_dir / "result.json").write_text(json.dumps(result), encoding="utf-8")
    return status


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    sys.exit(main(sys.argv))
