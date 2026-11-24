# The organisation's own model — study and first build (2026-11-23)

> **The ask.** The user, 2026-11-23: *"Every company will end up owning its intelligence and that intelligence will be
> in the form of a model trained on their data. In the context of business every interaction is a data point on which
> an LLM can be trained on. Check how Databricks does it and let's do it based on"* minimind
> (github.com/jingyaogong/minimind). Two choices were the user's, asked with the measurements below in front of them:
> **start from minimind-3's published weights** (not from scratch), and **train the first model on company knowledge**
> (not on raw rows, and not NL→SQL, whose graded pairs do not exist yet).

## 1. What was measured before building

**The live corpus (theLook + LuxExperience, read over HTTP from :8000).**

| Source | Live count | Usable as training rows |
|---|---|---|
| Human-graded question → SQL pairs (MI-4's gate) | **0 of 1,000** SFT · 0 of 150 DPO · 5 of 150 golden | no — the SQL model this plane was built for has nothing to learn from yet |
| Verdicts on answers | 13 (10 accept, 1 correct, 2 reject) | no SQL on most |
| Approved metrics | 59 (37 LuxExperience, 20 theLook, 2 other) | yes |
| Glossary tables and columns, per connection | 15 tables, 114 columns | **no** — every one is the Curator's autoseed (`auto_generated`, in `glossary_generated.yaml`): a model's words. Found during the live check, after the scratch runs below had trained on them; left out and counted since |
| Published Definitions | 1 ("Repeat buyer", theLook) | yes |
| Explorer findings booked as claims | 953 — **1** confirmed by a person | only the confirmed one (the user's 11-17 rule: findings reach answers confirmed-only) |
| Answered chat turns | ~800 | not chosen: the platform's own model's answers, mistakes included |

**The hardware (Apple M5, 24 GB, MPS, torch 2.15).**

| Model | Parameters | Training throughput |
|---|---|---|
| minimind's code, hidden 512 × 8 layers, fp16 | 30M | 5,904 tokens/s |
| minimind's code, 768 × 8 (= minimind-3), bf16 | 64M | 3,796 tokens/s |
| `transformers` `Qwen3ForCausalLM`, same 512 × 8 shape | 30M | 6,473 tokens/s |

A company's knowledge is ~10⁵ tokens: an epoch is seconds. A language is ~10⁸–10⁹ tokens: days. **From scratch on the
company's own text does not make a model that speaks; a small pretrained base does** — hence the base as a door.

## 2. What minimind is (read end to end, commit 858008e, Apache-2.0)

A Qwen3-shaped decoder (RMSNorm, RoPE θ=1e6, grouped-query attention 8/4, SwiGLU, tied embeddings), a 6,400-token BPE
tokenizer, ChatML with `<think>` and `<tool_call>`. Every stage is a hand-written PyTorch loop: pretraining, full SFT
(loss on the assistant's span only), LoRA (rank-16 A·B on square layers, merged back), DPO (β=0.1, frozen reference),
PPO/GRPO/CISPO, agentic RL, white-box distillation. `scripts/convert_model.py` writes its weights as a stock
`Qwen3ForCausalLM` — **so what it trains is served by transformers, llama.cpp, Ollama and vLLM unchanged.** That one
fact decided the build: train a stock causal LM with minimind's loops, serve it with the runtime the install already has.

What was taken: the SFT loop and its answer-only loss, the cosine schedule ending at a tenth, AdamW with a clipped
gradient, LoRA merged back (NOTICE §2). What was not: its tokenizer training, pretraining corpus, RL stages, the
`trust_remote_code` model class and its hand-written OpenAI server.

## 3. How Databricks does it (researched 2026-11-23 from its public docs and blog)

- **Its turnkey fine-tuning is end-of-life.** Foundation Model Fine-tuning (chat JSONL from a Unity Catalog table,
  three task types, only duration · learning rate · context length exposed, MLflow tracking, registered as a UC model
  version, served on provisioned throughput) is retired in favour of "AI Runtime": serverless GPUs and bring your own
  TRL/Unsloth code. Agent Bricks' Custom LLM is legacy too.
- **What lasted is the loop around the weights:** a governed training table read under the runner's own permissions;
  lineage from model version to its inputs; evaluation sets built from traces and human feedback; feedback that never
  changes behaviour on its own (Genie: an author acts on it; "Add as benchmark" only measures); expert feedback kept
  as *memory* that applies at once (ALHF, MemAlign) before anything touches weights; learning from logged prompts with
  a checkable reward (TAO, RLVR on BIRD — for SQL the reward is execution).
- **The gap they leave open:** nothing documented carries the training data's access onto the model — a person who
  may run a model but not read its training tables can still ask it. A model trained on rows remembers rows.

## 4. What was built

| Part | Where | What it does |
|---|---|---|
| Training set | `pramanyx/learning/knowledge.py` (the existing dataset plane, kinds `knowledge` · `knowledge_golden`) | Each settled source → a few fixed phrasings of one question, answered from the source's own fields; each row cites its source; one phrasing held out by a stable hash; PII scrub through the existing seam, failing closed; what was left out counted with the reason |
| What is not settled | same | Drafts and retired metrics answered with their status; 40 common business words a connection has not defined answered "nothing is settled"; a word on several connections asked with none names them and asks which; questions outside it all answered with what the model is |
| Base | `pramanyx/training/base.py` | An admin names a Hugging Face repository or a folder; safetensors only; recorded in `llm_config.json`. No repository name in the code |
| Run | `pramanyx/training/runs.py` · `worker.py` | Kernel job `own_model_training`; the worker runs **by path in its own process** (it imports no store) with the interpreter that has torch (`PRAMANYX_TRAINING_PYTHON`, else the API's); measures the base on the held-out questions, trains, measures again |
| Versions | lifecycle artifact `own_model:<org>:<run>` | Draft when trained (answers nobody) → in service (published) → withdrawn (archived, record and measure kept) |
| Serving | `pramanyx/training/serve.py` | Ollama imports the safetensors folder; the prompt template is written from the tokenizer's own chat template, so serving wraps a question exactly as training did. An in-service model is an Ollama model — pickable in Settings ▸ Models |
| Access | `runs.may_ask` | A person who may not see every connection the model learned from is not answered by it — the gap §3 names, closed |
| Governance | org setting `train_own_model` | Off by default; an admin's choice (Settings ▸ Organization ▸ What Pramanyx may do); every write door is `ADMIN_MANAGE_ORG` |
| Page | Define ▸ Own model (`web/components/OwnModelPanel.tsx`) | The base, what it learns and leaves out (before a build, from `GET /own-model/training-set/plan`), every row with its source, the run and its loss, each model's measure before → after and its own answers beside the organisation's, weakest first; Put in service · Withdraw · Ask |

## 5. What the measurement showed (scratch runs on the live corpus, minimind-3 base, full fine-tuning, 8 epochs)

> ⚠️ **Runs 1 and 2 below included the 129 model-written glossary entries** (§1), read over HTTP before their
> provenance was checked. They show what training does to a 64M model; the live run (§5a) is the corpus as it stands.

**Run 1 — settled knowledge only (190 sources).** Held-out recall 0% → 94%, F1 0.12 → 0.93, 199 s. And two failures
the headline hid: asked *"What is Customer lifetime value at theLook?"* (defined nowhere) it answered with a confident,
invented definition in the learned shape; asked *"What is the capital of France?"* it answered gibberish shaped like a
metric. LoRA (rank 16) forgot the same way. **A memory that invents is worse than none.**

**Run 2 — with what is not settled (282 sources, 594 trained · 269 held out).**

| Asked | n | Recalled before → after |
|---|---|---|
| Approved metrics | 59 | 0% → 100% |
| Glossary columns | 114 | 0% → 98% |
| Words not defined | 60 | 0% → 100% |
| Drafts and retired metrics | 12 | 0% → 92% |
| Outside what it knows (never trained on) | 8 | 0% → 75% |
| All | 269 | **0% → 98%** (F1 0.13 → 0.97), 308 s |

Probed with words in no list: *"Warehouse utilisation at theLook"*, *"Shipping cost per item at theLook"* → "Nothing is
settled about …"; *"What is the capital of France?"* → the scope answer.

### 5a. The live run, in the app (2026-11-23, on a copy of the live state)

At the user's word ("put it live on other address, not on 8000/3000") the branch ran at :8010 / :3010 on a state home
rebuilt from the API's own 19:06 backup, schedulers and Slack bots off. Every step was taken in the app as a person
would: Allow it → fetch `jingyaogong/minimind-3` (128 MB, through the training interpreter) → build → Train →
Put in service → Ask. The training set held **208 sources** (391 questions trained, 195 held out) — 59 approved
metrics, 1 published Definition, 1 confirmed finding, and the not-settled rows (60 undefined words, 55 words asked with
no connection, 12 drafts and retired metrics, 20 out-of-scope questions) — and **left out**, said on the page before the build: 772 findings nobody confirmed,
129 glossary entries a model wrote, 12 metrics not approved, 4 glossary tables for no connection, the platform's own
operations connection.

| Asked (held out, never trained on) | n | Recalled before → after |
|---|---|---|
| Approved metrics | 59 | 0% → 100% |
| Words not defined | 60 | 0% → 100% |
| Asked with no connection | 55 | 0% → 96% |
| Drafts and retired metrics | 12 | 0% → 83% |
| Outside what it knows | 8 | 0% → 63% |
| Published Definitions | 1 | 0% → 100% |
| **All** | 195 | **0% → 96%** · F1 0.14 → 0.97 · answer loss 2.96 → 0.002 · 301 s on the M5 (2,200 tokens/s beside a test suite) |

**Asked in service, through Ollama:** *"How do we calculate Return rate at theLook?"* → the metric's own definition and
SQL, word for word. *"What is Average Order Value (AOV)?"* → "settled on 2 connections … ask about one of them".
*"Who won the 2018 football World Cup?"* → the scope answer. And **one invention**: *"What is Net promoter score at
theLook?"* — a word the set did not happen to sample there — came back as Repeat Purchase Rate's definition under NPS's
name. Word overlap could not tell (F1 0.895 against Repeat Purchase Rate's answer, a true answer 1.0); its SUBJECT could.

**So every answer carries its source, or is withheld** (`runs.check_answer`): an answer is served only as a source's
own — near word for word (≥ 0.95) and about the same subject — and shown with that source; "Nothing is settled about X"
stands for any X; anything else is withheld, its words not served, and the page says so with the nearest settled
source. Re-asked: NPS → withheld (nearest: Repeat Purchase Rate); Return rate → settled, from `return_rate`;
"Warehouse utilisation" → nothing settled; "17 × 23" → withheld. Provenance is required of the model's answers too.

**What the held-out measure is, and is not.** It is recall of what the organisation told the model, asked in words the
model never saw. It is not knowledge the model was never given — a memory cannot have that, and the page says so.

## 6. Limits said, not implied

- **Ollama is install-wide.** An in-service model is listed for every organisation on the install by the provider
  catalogue; `may_ask` guards this page's door, not another organisation's Models picker. Fine on a one-organisation
  install; a multi-organisation install needs the catalogue scoped before it serves more than one.
- **A run the API's restart interrupts** is recorded INTERRUPTED; its worker may finish on its own, and nothing records
  that model. Train again.
- **The model knows what was settled when it was trained.** A metric approved after the build is not in it; the page
  says when the sources changed since the training set's version.
- **click 8.3.3 → 8.5.1** in `uv.lock`: `huggingface-hub` 2.x (which `transformers` 5 needs) requires it, and the lock
  is one resolution for every extra.

## 7. What comes next, in the order the data allows

1. **Confirmed findings and published Definitions are the cheapest growth** — each one a person confirms joins the next
   build; 772 Explorer findings wait on that.
2. **Preference pairs (DPO) from corrections** once `correct` verdicts carry typed SQL — the exporter exists
   (`export_dpo`); minimind's DPO loop is the trainer.
3. **NL→SQL** when MI-4's gates fill (graded pairs, not the platform's own answers), measured on the golden set
   through the evals plane.
4. **Learning from usage without labels** (the TAO / RLVR shape): logged questions, candidate SQL sampled, rewarded by
   execution and the guards — the platform already runs both.
5. **A cascade**: the own model first on the questions it is measured to answer, the large model otherwise.
