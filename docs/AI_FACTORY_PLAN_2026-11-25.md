# AI Factory — the environment, not the engine (a plan, 2026-11-25)

The user, 2026-11-24/25, after the Databricks AI Runtime study: *"But is it even the right direction for Pramanyx?"*,
then *"There are way better RL companies out there.."*, and, on the answer below: *"Yes, write the plan"*.

**Sources.** [`DATABRICKS_AI_RUNTIME_STUDY_2026-11-24.md`](DATABRICKS_AI_RUNTIME_STUDY_2026-11-24.md) (Databricks'
docs, cookbook and blog, read 2026-11-24); [`AI_FACTORY_ENGINES_STUDY_2026-11-24.md`](AI_FACTORY_ENGINES_STUDY_2026-11-24.md)
§5 (the reinforcement-learning labs); [`OWN_MODEL_STUDY_2026-11-23.md`](OWN_MODEL_STUDY_2026-11-23.md) (what training
measured); the code at main `78a71b7`, every path below re-read by hand on 2026-11-25; the live install read over HTTP
(`GET /ai-factory`, 2026-11-24).

Status words: **Have** · **Partial** · **Missing** · **Later** (not in this plan, with the reason).

## 1 · The decision, in one paragraph

Pramanyx does not compete on training. Engines that train — Tinker, Prime Intellect, the open trainers — move faster
than an install can, on hardware an install does not have. What none of them has is what Pramanyx keeps: tasks drawn
from what the organisation settled, each citing its source; phrasings held out that no model is trained on; a grader
that runs SQL against the organisation's own warehouse and counts the platform's guards as penalties; corrections a
person typed; and access that travels from the training set to the model. So the AI Factory **builds the environment,
lets the organisation's chosen engine train, measures what comes back on the same held-out tasks, and puts it in
service only under the access of what it learned from**. The two engines that run here (Built-in, LlamaFactory) stay
as they are — the way to teach a small model when nothing may leave the install — and get no further investment.

## 2 · Why (what was measured or read, not argued)

- **The company-dictionary model is a gated copy of the stores.** `runs.check_answer` (`pramanyx/training/runs.py:534`)
  shows a trained model's answer only when it matches a settled source; otherwise it is withheld. The stores answer the
  same question with the source attached, and are right the moment a definition changes; the weights are right only
  until the next change. Trained on settled facts alone, the 64M model also invented definitions for words nobody had
  defined (`OWN_MODEL_STUDY` §5: "a memory that invents is worse than none") — the training set now has to teach
  "nothing is settled" to hold it back.
- **Databricks tried a managed training product and retired it.** Foundation Model Fine-tuning is end-of-life, its UI
  and SDK gone; AI Runtime is rented GPUs where the customer brings the code; every improvement loop it documents now
  acts on context and memory, none on a customer's weights (Databricks study: its opening and "Everything after
  training is general platform").
- **Any one engine is a dependency that can vanish.** OpenAI stops taking new reinforcement fine-tuning jobs from
  6 Jan 2027; Atropos is archived (engines study §5). The AI Factory must hand work to whichever engine an organisation
  picks, in formats they already read, not to one vendor's API.
- **This machine tops out near a 4B base taught by LoRA** (24 GB; a full 4B fine-tune needs an 80 GB H100 even in
  bf16 with gradient checkpointing — Databricks' own Qwen3-4B notebook, "The Qwen3-4B notebook, read closely"). Quality at that size comes from the
  context the platform gives the model, which the platform already does.
- **The one task where a small model earns its keep needs data the install does not have yet.** The SQL writer waits
  for 1,000 checked question → SQL pairs and has 0 of them on the live install (`recipes.py`, read 2026-11-25). An environment with a grader
  is how those pairs get made useful once they exist — wherever the training happens.

## 3 · What we already have

| Part | Where | Status |
|---|---|---|
| Training set from settled knowledge, a source per row, one phrasing held out by stable hash, PII scrubbed, what was left out counted | `pramanyx/learning/knowledge.py` | **Have** |
| One store for training sets: versions, content hash, held out kept disjoint | `pramanyx/learning/store.py` (kinds `knowledge` · `knowledge_golden`, `sft` · `dpo` · `golden`, `sft_bronze` · `dpo_repair`, `choice` · `choice_golden`) | **Have** |
| Exports by way of teaching: examples, preference pairs, NL→SQL golden, repairs, decisions | `pramanyx/learning/exporters.py` | **Have** |
| A label per run from the guards that fired and the verdict a person gave | `pramanyx/learning/reward.py` | **Have** |
| Environments and their scoring declared: knowledge, routing, SQL (`SQL_RUBRIC` 1 / 0.1 / −1 / −0.5 / 0), corrections; the 10–80% band for teaching by reward | `pramanyx/training/recipes.py` | **Partial** — declared; only knowledge scores anything |
| The source check that withholds an unsettled answer | `runs.check_answer` | **Have** — used at ask time, not as a reward |
| Held-out measure before and after a run (recall, F1) | `pramanyx/training/worker.py` `measure` | **Partial** — its own surface, in-process, loads weights in fp32 (§6 D1, D3) |
| The evals plane: suites, cases, runs, experiments; a target per thing measured | `pramanyx/evals/` — `reference_target`, `sql_generator_target` (any model, injected), `ask_target` (the platform's own answer path) | **Have** — the knowledge held-out never reaches it (§6 D1) |
| A model's life: draft → in service → withdrawn, record kept | lifecycle kind `own_model` (`runs.py`) | **Have** |
| Access travels to the model | `runs.may_ask` | **Have** |
| In service through Ollama; a model added from a folder of safetensors | `pramanyx/training/serve.py`, `training/base.py` | **Have** — weights from elsewhere have no door yet |
| A model at an endpoint | `llm/provider.py` `added_providers` (any OpenAI-compatible address) | **Have** — not tied to the AI Factory's record |
| An org setting per thing that leaves the install | `orgsettings/allows.py` (`train_own_model`, `coworker_models`, `share_aggregates`…) | **Have** — none for an environment leaving |
| The hosted engine said, not offered | `training/engines.py` door `hosted`: "the tasks and the data would leave the install" | **Partial** — the door exists, off, no path behind it |

## 4 · The design

### 4.1 One measure, in the evals plane

The knowledge held-out set is published as an evals-plane suite per training-set version, the way
`exporters.publish_golden_to_evals` publishes the NL→SQL golden set — found by key, a new suite for a new version, never
mutated. A **model target** asks a named model through the model door (any provider, Ollama included, or an added
endpoint) and folds the answer into an observation; the knowledge scorer is `check_answer` plus F1, the same numbers the
worker reports today. The platform's own answer path is already a target (`ask_target`). So one suite version measures
a trained model, its base, an untrained open model, and the platform's own answer — side by side, in one place.

The worker's in-process measure stays for local runs and calls the same scorer. Measuring through the model door also
retires the fp32 problem for any model that comes back from elsewhere: it is measured as it is served.

### 4.2 The grader

Each environment gets a scoring function the platform owns: `score(task_id, attempt) → {reward, parts}`.

- **Knowledge** — the source check and F1 against the settled answer; a "nothing is settled" answer scored right only
  where nothing is.
- **SQL** — the attempt runs on the organisation's warehouse under the platform's guards; the result is compared with
  the reference's, which is re-run first (an empty or slow reference sets the task aside); `SQL_RUBRIC`'s weights;
  rows read and time logged at weight 0, never trained on.
- **Routing** — the recorded choice is the answer key (waits on §7 Q2).

Before any environment is offered for teaching by reward, its grader is tested on known-right, known-wrong and
adversarial attempts (engines study §5: "rising reward doesn't establish better task performance").

### 4.3 What leaves the install, by way of teaching

| Taught by | What leaves | What never leaves |
|---|---|---|
| Example | the training set: questions and answers, PII scrubbed, each row's source id | held-out phrasings; warehouse rows |
| Preference | the pairs: the answer a person fixed and the one they rejected | held-out phrasings; warehouse rows |
| Reward | the tasks only; the engine sends each attempt back to the grader | expected answers, reference SQL, warehouse rows, held-out phrasings |

Nothing leaves unless an admin allows it: a new org setting, **`train_outside`** — off by default, its sentence saying
exactly what leaves (the table above), tested both ways (AGENTS.md). One setting, not one per way of teaching: the
admin's question is "may an engine outside this install learn from us", and the table is the honest answer to it.

The formats are the ones engines already read: chat JSONL (`messages`) for examples — the shape
`prepare_llamafactory` already writes; prompt / chosen / rejected for preference; for reward, an environment folder a
`verifiers` loader reads, whose rubric calls the grader door. Each export is a version in the dataset store with its
content hash — no second store.

The grader door for an engine outside: `POST /ai-factory/environments/{id}/score` with a token scoped to one
environment version, expiring, audited per call through the existing audit sink, rate-limited. An install the engine
cannot reach can still teach by example and by preference; reward needs the door reachable, and the page says so.

### 4.4 A model comes back

Three ways in, each becoming an `own_model` draft that answers nobody until measured:

1. **Weights** — a folder of safetensors (the base door's checks: config, architecture, no pickles), into Ollama.
2. **A LoRA adapter on a base the install has** — merged here by LlamaFactory's `export` (already wired), then 1.
3. **An endpoint** — an added provider address; the model stays where it is served, and every question to it leaves
   the install under the provider settings that already govern that.

The draft records which engine trained it (by name, as the person says it), the environment and training-set version
it learned from, and the connections behind them — so `may_ask` applies from the first question.

### 4.5 Into service only by beating what is there

A draft goes in service only if, on the same held-out suite version, it beats the model in service — or, for the first
one, the platform's own answer path. After the Ollama import, one held-out question is asked and its answer checked
before the version is marked in service (`publish` asks it nothing today, §6 D2). Withdraw stays as it is.

### 4.6 The page

Define ▸ AI Factory keeps its six tabs (GLOSSARY). Environments gains, per version: its grader's state, what would
leave, and **Export** (refused, with the setting named, while `train_outside` is off). Models gains **Add a model
trained elsewhere** (folder · adapter · endpoint) and the before/after against the incumbent on one suite. Runs keeps
local runs. No tab is removed and no feature vanishes: the page's controls are inventoried before the change and
checked one by one after (a feature may move, never vanish).

## 5 · Phases

Each phase merges on, shown working on theLook before its PR; nothing behind a flag.

| Phase | What | Done when |
|---|---|---|
| **P1 · One measure** | §4.1: the knowledge held-out set as a suite; a model target; one scorer | One suite version, read in the evals plane, holds four rows on theLook: the platform's own answer (`ask_target`), the in-service trained model, its base, and an untrained open model in Ollama — and the trained model's number matches its worker measure. **This is the test of the premise:** if the platform's own answer (or the untrained model given the settled source) matches the trained model's recall, the Company dictionary stays an environment and stops being a recipe that trains |
| **P2 · The grader** | §4.2 in-process: knowledge and SQL | Each grader scores a hand-built set of right, wrong and adversarial attempts as expected; SQL references re-run first, the ones set aside counted with why; mutation-tested (a guard that cannot fail is no guard) |
| **P3 · Leaving the install** | §4.3: `train_outside`; exports by way of teaching; the grader door | With the setting off every export and the door refuse, saying so; on, an example export loads in LlamaFactory and a reward environment loads in `verifiers` in a scratch environment, with no expected answer in its folder; the door scores an attempt with a scoped token and refuses an expired one |
| **P4 · A model comes back** | §4.4 and §4.5 | A model added from a folder and one from an endpoint each become a draft, are measured on P1's suite, are refused service when they do not beat the incumbent, and are refused to a person who cannot see a connection they learned from |
| **P5 · The page** | §4.6 | The inventory before and the parity check after are in the PR; every new control exercised live |

## 6 · Defects found while planning

- **D1 — another measuring surface.** The AI Factory measures in `worker.measure`, apart from the evals plane;
  `knowledge_golden` is never published there (only the NL→SQL golden set is, `routers/learning.py:297`). The same
  bug this repo has paid for three times (AGENTS.md: one store per concept). P1 fixes it.
- **D2 — putting a model in service asks it nothing.** `publish` imports into Ollama and marks the version published
  without one question (`runs.py` `publish`; the Databricks study's check of our code). P4 fixes it.
- **D3 — a local run of a bigger base cannot finish on this machine.** The measure loads the base and the trained model
  in fp32 (16 GB each at 4B); the LlamaFactory config names no precision, no template, and saves no checkpoint
  (`save_strategy: "no"`). Moot for models measured through serving (P1); for local runs it matters only above ~1B.
  Named, not scheduled.
- **D4 — the run form offers "Every weight" for any base.** Nothing refuses a full fine-tune the machine cannot hold.
  Named, not scheduled (no new local-engine work, §1).

## 7 · The user's calls

1. **P3's proof: format only, or a real outside engine?** Proposed: format only — the exports load in the engines'
   own loaders locally. A real run sends the organisation's data to a vendor and costs money; that is a separate yes.
2. **Routing: may an engine learn from the questions people asked?** The Routing environment's tasks are people's
   questions; it already says "needs your say" (`recipes.py`). Until then it is measured, not taught.
3. **The Qwen3-4B step is parked.** For a bigger local model with no training, P1's "untrained open model" row is a
   Qwen3-4B served by Ollama — the comparison the user asked for, without a run.

## 8 · Not in this plan

- **Our own GPU scheduling, multi-node, bring-your-own-code notebooks** — the problem the engines solve; Databricks
  built it and it is still half Beta (the Databricks study's opening).
- **An integration per vendor** — the formats in §4.3 are the integration; a vendor's API only when an organisation
  asks, as its own door.
- **New local engine work** — TRL's teaching by reward, prime-rl, the D3/D4 fixes: Later, if an organisation that may
  not let anything leave asks for it.
- **Axolotl** — its plugin licence forbids fine-tuning platforms (engines study §2).
- **Model judges as gates, training on model-written rows** — the grader scores against what people settled.
- **OpenAI's reinforcement fine-tuning** — no new jobs from 6 Jan 2027.
