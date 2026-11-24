# AI Factory — fine-tuning engines studied (2026-11-24)

> **The ask.** The user, 2026-11-24: *"Let's study these frameworks — Axolotl and LlamaFactory — both as fine-tuning
> engines, on platform. UI needs to be better, and instead of Own model let's call it AI Factory; we need to offer a
> bouquet of features there."* Both repositories were read end to end (Axolotl `de8549a`, 2026-11-20; LlamaFactory
> `8ebba0d`, 2026-11-23), and both were installed from PyPI and run on this machine (Apple M5, 24 GB, MPS) on the live
> training set from `docs/OWN_MODEL_STUDY_2026-11-23.md`.

## 1. Measured on this Mac

| | LlamaFactory 0.9.5 | Axolotl 0.21.1 |
|---|---|---|
| Installs from PyPI (own virtualenv) | yes | yes — without `bitsandbytes`, which macOS markers exclude |
| LoRA fine-tune of minimind-3 on the live set (200 rows, 1 epoch, MPS) | **ran: 22 s, loss 2.05 → 1.00** | **did not run.** First `accelerate` was looked up on the PATH; then `import bitsandbytes` failed (an unguarded import, `loaders/adapter.py:10`); with it installed by hand, the process segfaulted loading the weights |
| Progress while it runs | `output_dir/trainer_log.jsonl`, one line per log step: `current_steps, total_steps, loss, lr, epoch, percentage, elapsed_time, remaining_time` | none of its own; `output_dir/debug.log` (stdout) and Hugging Face's `trainer_state.json` at checkpoints |
| Merge for serving | `llamafactory-cli export` → merged safetensors (`Qwen3ForCausalLM`) **and an Ollama `Modelfile`** | `axolotl merge-lora` → `output_dir/merged/` |
| GGUF | not offered | `axolotl export --quantize`, through a separately built llama.cpp |
| Writes outside its run folder | the datasets cache, `~/.cache/llamafactory/*.lock` | `./last_run_prepared` unless set, the datasets cache (seen: `~/.cache/huggingface/datasets`) |

## 2. What each offers

| | LlamaFactory | Axolotl |
|---|---|---|
| Stages | pre-training, SFT, reward model, PPO, DPO (+ ORPO, SimPO, IPO, hinge as losses), KTO | continued pre-training, SFT, reward and process-reward models, DPO, IPO, ORPO, KTO, SimPO, **GRPO** (needs vLLM, CUDA), distillation, QAT |
| Tuning | full, freeze, LoRA (DoRA, rsLoRA, PiSSA, LoRA+), OFT; QLoRA via bitsandbytes 4/8-bit, HQQ 1–8-bit, EETQ | full, LoRA (DoRA, rsLoRA, LoRA+, LoftQ, ReLoRA), QLoRA via bitsandbytes or torchao |
| Bases | 128 chat templates, ~640 checkpoints: Qwen3/3.5/3.6, Gemma 4, Phi-4, Ministral 3, gpt-oss (no Olmo 3, no Nemotron) | Qwen3/3.5, Gemma 4, Ministral 3, Olmo 3, gpt-oss, Nemotron (Phi-4 not first-class) |
| Driven as a subprocess | its own WebUI does exactly that: writes `training_args.yaml`, runs `llamafactory-cli train`, tails `trainer_log.jsonl`, stops with SIGABRT | `axolotl train cfg.yml`; it re-execs itself under `accelerate`; SIGINT saves and exits 0 |
| Evaluation | eval loss, token accuracy, ROUGE/BLEU on predictions (its MMLU evaluator is gone) | eval sets, sacrebleu/comet/chrF/perplexity, lm-eval-harness plugin |
| Serving | an OpenAI-style API — on **0.0.0.0:8000** by default, which collides with Pramanyx | none general; a Gradio chat whose public share link is ON by default |
| Many GPUs, cloud | DeepSpeed, FSDP, Megatron, Ray | FSDP2, DeepSpeed, sequence parallel; launchers for Modal, Baseten, CoreWeave, Nebius; RunPod worker |
| Telemetry | none found | **PostHog, on by default** (hard-coded key) — off only with `DO_NOT_TRACK=1` / `AXOLOTL_DO_NOT_TRACK=1`; also an HF `whoami()` call unless `HF_HUB_OFFLINE=1` |
| Licence | Apache-2.0 | Apache-2.0 at the top — **but `src/axolotl/integrations/` is under the "Axolotl Community License", whose §3.1 forbids using it for "any activity that constitutes a commercial activity of offering for free or for sale any services, platform, or equivalent to third parties for the purposes of allowing such third parties to fine-tune artificial intelligence models"**; `integrations/base.py` (`PluginManager`) is imported on every training run (`cli/train.py:54`) |

## 3. What this means for the AI Factory

1. **LlamaFactory is the engine to add.** It runs here, it is Apache-2.0 throughout, it sends nothing, and the
   platform can drive it the way its own UI does: a config and a dataset written into the run folder, the CLI
   started in its own interpreter, `trainer_log.jsonl` followed, the merged folder handed to the existing Ollama
   import. It brings what the built-in loop lacks: LoRA variants, preference training (DPO, KTO, ORPO, SimPO), reward
   models, continued pre-training, and the newer bases (Qwen3.5, Gemma 4, Phi-4, Ministral 3).
2. **Axolotl is not shipped as an engine until a lawyer has read §3.1.** The AI Factory is a platform letting
   organisations fine-tune models; the clause names exactly that, "for free or for sale". Its unique offers — GRPO,
   distillation, GGUF export, cloud launchers — are also all CUDA. If the review clears it, it belongs on a rented-GPU
   door, with `DO_NOT_TRACK=1` and `HF_HUB_OFFLINE=1` always set by the platform. Until then, GRPO comes from TRL
   (Apache-2.0), which both engines build on.
3. **The built-in engine stays** for the smallest bases and for any machine without the engine installed: it needs
   only torch and transformers, and it trained the model in service.
4. **Each engine is a door**, said on the page: ready, needs setup (with the one command), or not on this hardware.
   A rented GPU sends the training set out of the install, so it is an organisation setting, off by default.
5. **Gotchas the dispatcher must own:** a fresh `output_dir` per run (LlamaFactory resumes silently into a used one);
   `DISABLE_VERSION_CHECK=1`, `HF_HUB_OFFLINE=1`, `HF_DATASETS_OFFLINE=1`, `report_to: none`; the venv's `bin` first on
   `PATH`; the datasets cache pointed into the run folder; never the engine's own API server (port 8000); the chat
   template the run trained with is the one Ollama serves.

## 4. The bouquet (mocked up: `web/public/_mockups/ai-factory.html`, not committed)

Seven tabs under one header, Define ▸ AI Factory:

- **Overview** — in service, held-out recall, what is ready to learn from, engines; *Needs you*; the line from settled
  sources to a model in service.
- **Recipes** — what a model is for, each saying whether it can be made now: Company dictionary (in service), Router
  (211 recorded choices — ready), SQL writer (0 of 1,000 checked pairs), Learn from corrections (0 of 150), Reasoner
  (GRPO, needs a GPU), Document reader (continued pre-training, not measured yet).
- **Data** — every training set, its sources as a filter column with counts, what was left out and why, every row
  with what it cites.
- **Runs** — a new run (recipe · training set · base · engine · method · runs on · an estimate before it starts) and
  each run's loss.
- **Models** — lineage (base → training set → run → model), recall by what it was asked, in service / withdraw,
  export (merged, adapter, Modelfile), use in Ask for definitions.
- **Playground** — one question to up to three models — a trained one, its base, the platform's own analyst — each
  answer saying where it came from.
- **Engines** — each engine's door and the capability table above; where runs happen.

## 5. What the reinforcement-learning labs do, and what it changes (researched the same day)

Prime Intellect (prime-rl 0.11, verifiers, the Environments Hub, Model Factory), Thinking Machines (Tinker), OpenAI's
reinforcement fine-tuning, Nous (Atropos), verl, OpenRLHF, TRL, Unsloth, MLX community trainers, OpenPipe ART/RULER,
SkyRL, rLLM, AReaL, AI2's Tulu 3 / Olmo 3, and the text-to-SQL RL papers (Arctic-Text2SQL-R1, SQL-R1, Reasoning-SQL,
Databricks' BIRD RLVR, ReViSQL) — read from their own docs, repositories and papers.

- **The unit is the environment, not the dataset.** Prime Intellect's verifiers: tasks + the harness that runs the model
  + a rubric of weighted rewards; one environment serves evaluation, RL and synthetic training data; weight-0 signals
  are logged but not trained on; expected answers stay on the grader's side. The platform's stores map straight onto
  it: checked question → SQL pairs (execution match), settled sources (the source check `runs.check_answer`), recorded
  routing decisions (an answer key).
- **Text-to-SQL is where small-model RL has the clearest record.** Reward = the query runs and its result matches
  (Arctic: 1 / 0.1 valid / 0; Databricks: −1 for a syntax error), GRPO-family, online. It worked from 653 tasks
  (SkyRL-SQL) to 9.4K (Databricks); finer partial rewards made models lazy; clean reference answers beat volume
  (ReViSQL: 52.1% of BIRD-train gold SQL needed fixing, +8–14 points from cleaning alone).
- **Admission rules:** offer reward training only where the model passes ~10–80% of tasks; groups of ≥ 8 attempts;
  drop groups where every attempt scores the same; mix domains; run a spurious-reward control; test the grader on
  right, wrong and adversarial answers before training ("rising reward doesn't establish better task performance").
- **The ladder:** examples (SFT) → preferences (DPO) → reward (RL) from the best checkpoint; LoRA is enough for RL
  (Thinking Machines, "LoRA Without Regret"); with a strong teacher, on-policy distillation is far cheaper than RL.
- **The hardware line:** environments and evaluation run anywhere; prime-rl, verl, OpenRLHF and the hosted services need
  NVIDIA GPUs. **Measured here: TRL's GRPO runs on this M5 on MPS** — minimind-3, 20 steps, 8 sampled answers a step,
  29 s (sources had it as unconfirmed).
- **Governance traps:** prime-rl registers every run with Prime Intellect and streams metrics unless
  `--no-monitors.prime`; Prime's hosted training uploads datasets and traces (trace upload on by default); Axolotl's
  PostHog telemetry; OpenAI is shutting reinforcement fine-tuning down (no new jobs from 6 Jan 2027); Atropos is
  archived.
- **Traces are the raw material, not the training signal.** On-policy RL trains on the model's own fresh attempts,
  scored by the environment. The platform's traces — the questions people asked, the SQL that ran, the guards that
  fired, the verdicts people gave — become the tasks, the reference answers, the failure cases and the evaluation
  set (Prime Model Factory's "Improve" step; this repo's own line: ungraded logs are exhaust, graded logs are training
  sets).
