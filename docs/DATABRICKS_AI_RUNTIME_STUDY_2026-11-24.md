# Databricks Swaps Managed Fine-Tuning for Rented GPUs

As of November 2026, Databricks' **AI Runtime (AIR) is serverless GPU compute for training, fine-tuning and batch inference, and the customer brings the training code**. Databricks supplies four fixed GPU node shapes (1xA10, 1xH100, 8xH100, and 8xB300 in AWS preview), two managed Python environments, a small SDK (`databricks.air`), a CLI, and hand-offs to Unity Catalog, MLflow and Model Serving. It began as the "Serverless GPU compute" Beta in June 2025, was renamed AI Runtime at Public Preview on 19 March 2026, and was declared generally available on 21 October 2026. Several edges still carry Beta or Preview labels: in-notebook distribution, multi-node, B300 and scheduled base environments. AIR's rise coincided with the end of Databricks' managed fine-tuning product, Foundation Model Fine-tuning (FMFT). FMFT's UI and SDK are gone, and the only migration advice Databricks gives is "use AI Runtime". Databricks has moved from a managed recipe to bring-your-own code, with about 50 cookbook recipes and coding agents filling the gap. Everything after training is general platform: MLflow runs, Unity Catalog registration with aliases, opt-in lineage, and a vLLM serving path in Public Preview. On the governance points that matter most to the AI Factory, Databricks is weaker than Pramanyx already is. Training-data permissions do not travel to the model, lineage is opt-in, and AI Gateway guardrails do not cover custom-model endpoints. What the AI Factory should take from AIR is its infrastructure discipline, sized for one 24 GB Mac:
- pin bf16 in both the measure and the engine;
- refuse full fine-tuning of a 4B base (Databricks' own Qwen3-4B notebook needs an 80 GB H100 for that);
- prove the chat template is identical in training, measurement and Ollama;
- checkpoint with a completion marker, and resume from it;
- record the exact base revision, data digests and package versions on every version.

It should not copy AIR's product shape: bring-your-own code, rented cross-region GPUs, a second tracking store, or judge-based gates. Each cuts against the install-only, provenance-first design. Pricing is per GPU-hour with no idle charge. The only rates found are $7.00 per H100-hour and $2.50 or $4.90 per A10-hour (US East), and they come from search snippets of pages that no longer print them.

## A June 2025 serverless-GPU beta became AIR, then GA in October 2026

**What it is.** Databricks defines AIR as "a fully managed, serverless GPU compute offering on Databricks for training, fine-tuning, and other deep learning workloads", aimed at engineers "who want GPUs without provisioning clusters" ([Databricks docs](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/)). It is **explicitly distinct from Databricks Runtime ML on classic clusters**. You submit code from the CLI, notebooks or jobs, and Databricks "provisions and manages the GPUs" ([Azure overview](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/overview)). The name now covers four layers at once:
- a compute type: serverless GPUs;
- a set of versioned runtime images: GPU environment versions 4, 5 and 6, each with release notes;
- a developer surface: the `databricks air` CLI, the `databricks.air` SDK and its `@distributed` decorator;
- a marketing family, "AIR" ([Azure guides](https://learn.microsoft.com/azure/databricks/machine-learning/ai-runtime/guides)).

**Where it shows up.** In the workspace it appears as a notebook compute choice ("Serverless GPU", then an Accelerator field), a job task type, CLI workloads, Ray, IDE-over-SSH, and Genie Code plus a `databricks-ai-runtime` coding-agent skill ([Azure AIR](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/)). **The old name survives in billing.** Spend is still identified by `product_features.serverless_gpu` in `system.billing.usage` ([Azure guides](https://learn.microsoft.com/azure/databricks/machine-learning/ai-runtime/guides)).

**History.** The timeline below is assembled from release notes and blogs. Rows marked "snippet" come only from search-engine extracts of earlier page versions.

| Date | Event | Evidence |
|---|---|---|
| 6 Jun 2025 | "Serverless GPU compute is in Beta" (Azure lists 30 Jun) | [AWS release notes](https://docs.databricks.com/aws/en/release-notes/product/2025/june); Azure date snippet |
| 5 Sep 2025 | On-demand H100 for single-node work, Beta | snippet, [Sept 2025 notes](https://docs.databricks.com/aws/en/release-notes/product/2025/september) |
| 19 Mar 2026 | Renamed AI Runtime; single-node Public Preview; distributed API Beta; multi-node Private Preview; "several hundred customers" in Beta | [March 2026 notes](https://docs.databricks.com/aws/en/release-notes/product/2026/march), [launch blog](https://www.databricks.com/blog/introducing-ai-runtime-scalable-serverless-nvidia-gpus-databricks-training-and-finetuning) |
| 5 May 2026 | 1xH100 accelerator, Beta | snippet, [Azure May notes](https://learn.microsoft.com/is-is/Azure/databricks/release-notes/product/2026/may) |
| 12 / 29 Jun 2026 | AIR CLI Beta; bring-your-own Docker images for CLI workloads, Beta | [June 2026 notes](https://docs.databricks.com/aws/en/release-notes/product/2026/june) |
| 17 Jun 2026 | Data + AI Summit: "high performance multinode training" | [DAIS blog](https://www.databricks.com/blog/whats-new-ai-platform-agents-ml-engineering-our-deep-learning-platform-and-new-capabilities) |
| 13 Oct 2026 | `databricks.air` SDK replaces the deprecated `serverless_gpu` package | [October 2026 notes](https://docs.databricks.com/aws/en/release-notes/product/2026/october) |
| 21 Oct 2026 | "General Availability of AI Runtime (AIR)" | [GA blog](https://www.databricks.com/blog/ai-runtime-generally-available) |
| 23 Nov 2026 | 8xB300 training in Public Preview, AWS waitlist | [AWS overview](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/overview) |

No release note says "renamed". The rename is inferred from three things. The first "AI Runtime" release note and the launch blog share one date. The old Azure `/compute/serverless/gpu` URL now serves the AI Runtime page ([Azure redirect](https://learn.microsoft.com/en-us/azure/databricks/compute/serverless/gpu)). Tutorial slugs still carry an `sgc-` prefix. **No release-note entry for the GA itself was found**; the GA date rests on the blog alone.

**What it replaced.** The product AIR displaced is **Foundation Model Fine-tuning** (FMFT), previously "Mosaic AI Model Training". The live page now says FMFT "has reached end of life (EoL) and is no longer supported. The `databricks_genai` package and the Foundation Model Fine-tuning UI are no longer available". It adds that "for training and fine-tuning foundation models, Databricks recommends AI Runtime" ([AWS FMFT page](https://docs.databricks.com/aws/en/large-language-models/foundation-model-training/)). An earlier version of the page, seen only in search snippets, scheduled removal for **14 August 2026** ([snippet](https://docs.databricks.com/aws/en/large-language-models/foundation-model-training/index.html)). Databricks gave no reason and published no FMFT-to-AIR mapping guide.

FMFT was a managed recipe with these properties ([Azure FMFT](https://learn.microsoft.com/en-in/Azure/databricks/large-language-models/foundation-model-training/)):
- You chose a model, supplied data, and called `fm.create`.
- It supported chat completion, instruction fine-tuning and continued pre-training.
- Its model list was Llama 3.x only, at 131,072 context.
- It did not support datasets above 10B tokens.
- It ran in five US regions on Azure.

Three related retirements surround it:
- Mosaic AI Model Training pre-training was retired effective 31 July 2025 (snippet only, [pricing page](https://databricks.com/product/pricing/mosaic-training)).
- The MosaicML repositories `composer` and `llm-foundry` are **archived on GitHub**, last released in July 2025 ([composer](https://github.com/mosaicml/composer), [llm-foundry](https://github.com/mosaicml/llm-foundry)).
- Inside AIR itself, `serverless_gpu` gives way to `databricks.air` ("support will end in GPU environment version 7") ([distributed training docs](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/connecting/distributed-training)).

Classic GPU clusters are not deprecated, but Databricks "recommends moving them to AI Runtime". Genie Code converts `TorchDistributor` notebooks to `@distributed` ([Why AI Runtime](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/guides/why-ai-runtime)). One common framing is wrong. **AIR did not replace Agent Bricks' Custom LLM**: that product is now "legacy", and its stated replacement is AI Functions such as `ai_query` ([legacy agents](https://docs.databricks.com/aws/en/agents/legacy/)).

The net movement is from "pick a Llama, upload JSONL, press train" to "write TRL or Unsloth code and run it on rented GPUs". The GA label covers that core. The periphery is still being built.

## Four node shapes, one decorator and a torchrun contract

### Compute is a fixed menu, provisioned whole

AIR's hardware is a menu of whole nodes:
- `GPU_1xA10` (24 GB)
- `GPU_1xH100` (80 GB)
- `GPU_8xH100` (8×80 GB)
- `GPU_8xB300` (8×288 GB, AWS Public Preview)

"**Only 8xH100 and 8xB300 support multi-GPU distributed training**" ([AWS overview](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/overview)). There are three ways in:
- **Notebook.** Select Serverless GPU, an accelerator, Apply, Confirm. This gives one node ([notebook quickstart](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/connecting/notebooks)).
- **CLI workload YAML.** `experiment_name`, `compute` and `command` are required. The node count is `num_accelerators` divided by GPUs per node, so `GPU_8xH100` with 16 accelerators "provisions two 8xH100 nodes". Optional keys include `secrets`, `parameters`, `idempotency_token`, `max_retries` (default 3) and `timeout_minutes` ([YAML reference](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/connecting/cli/yaml-config)).
- **Jobs and bundles.** An `ai_runtime_task` (CLI 1.6.0+) for which "exactly one deployment is currently supported (a single entry where every node runs the same command)" ([bundle task types](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/bundles/job-task-types)).

Every CLI workload becomes a Lakeflow Jobs run. Our reading: AIR is a gang-scheduled pod of identical nodes on the Jobs control plane, not an autoscaling cluster.

### `@distributed` is torchrun inside a notebook; multi-node is your own torchrun

The notebook API is `databricks.air.distributed(num_accelerators=None, accelerator_type=None, timeout=10800)`. The decorated function is invoked with `.distributed()` ([SDK reference](https://api-docs.databricks.com/python/databricks-sdk-air/api/reference.html)). Underneath, Databricks lists these steps ([Azure distributed training](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/connecting/distributed-training)):
1. The function is serialized and launched on each GPU of the **attached single node**.
2. The Python environment is replicated across ranks. Installed packages are capped at **15 GB** ([environment setup](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/develop-workloads/environment)).
3. Rank variables such as `LOCAL_RANK` are set.
4. Return values are gathered.
5. Each call opens an MLflow run.
6. A **3-hour default timeout** applies, raising `LocalExecutionTimeoutError` when it expires.

Databricks says the SDK "provides the same functionality as running `torchrun` or `accelerate launch`". User code still calls `init_process_group("nccl")` itself.

Multi-node uses the CLI path. AIR "runs the command on every node and sets `NUM_NODES`, `NODE_RANK`, `LOCAL_WORLD_SIZE`, `MASTER_ADDR`, and `MASTER_PORT`", and the canonical command is a `torchrun` line. A trap is documented: AIR sets `WORLD_SIZE` but not `RANK`, so scripts should start under `torchrun` even on one GPU ([UCDataset page](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/develop-workloads/load-uc-tables)). Ray is a third path, with these limits ([Ray on AIR](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/develop-workloads/ray)):
- `ray_init()` in a notebook, or a bootstrap script in a CLI workload;
- a fixed node count;
- one accelerator type, so no CPU worker groups.

### Two managed environments that drift fast

Each GPU environment version ships two flavours:
- **Standard**: CUDA only, no torch since v5.
- **Databricks AI**: PyTorch and the Hugging Face stack.

Environment v6 is the current version ([env v6 release notes](https://learn.microsoft.com/en-us/azure/databricks/release-notes/serverless/environment-version/six-gpu)):
- System: Ubuntu 24.04, Python 3.12.3, CUDA 13.0, torch 2.11.0.
- LLM stack: transformers 5.8.1, TRL 0.24.0, PEFT 0.19.1, vLLM 0.24.0, Ray 2.56.0.
- Kernels: three generations of flash-attention.
- Removed: Unsloth, bitsandbytes, xformers, torchao and mosaicml-streaming.
- DeepSpeed is absent from the package table.

The same release notes carry a warning that matters beyond Databricks: "`transformers 5.8.1` loads the wrong tokenizer for Mistral tekken models … **training runs and loss curves look normal while the model learns corrupted text**". The prescribed guard is a one-line round-trip probe that asserts `decode(encode(probe)) == probe`.

Each version also publishes downloadable requirements files to reproduce it locally. Notebooks cache their environment between sessions; CLI and job runs "install its dependencies fresh". Custom Docker images go up through `databricks air images push` into a Unity Catalog artifact registry ([Docker images](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/connecting/cli/docker-images)):
- they must be under 20 GB;
- they run on FIPS hosts;
- they build on CUDA 12 base images, a major version behind env v6.

### Data comes through Unity Catalog, never through local Spark

"With AI Runtime, all data and model assets are accessed through Unity Catalog". AIR has no local Spark, so tables are read in one of three ways:
- through Spark Connect;
- with the Beta **`UCDataset`**, which reads Delta files straight from cloud storage under credential vending;
- by exporting Parquet to a volume and loading it with HF `datasets` ([data loading](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/develop-workloads/dataloading)).

Volumes are FUSE-mounted. Databricks advises consolidating into 1–10 GiB files. **`UCVolumeDataset` (Beta) caches each file on local NVMe and shards it across ranks and workers.** In Databricks' benchmark it lifted epoch-1 throughput from 57.2 to 417 images/s per GPU and GPU utilisation from 12.6% to 53.3% ([fault-tolerant training blog](https://www.databricks.com/blog/fast-fault-tolerant-pytorch-training-ai-runtime)). `UCDataset` has a telling governance gap: it rejects tables with **row filters or column masks**, because "Unity Catalog doesn't issue storage credentials for them". It also does not checkpoint its read position ([UCDataset](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/develop-workloads/load-uc-tables)).

### Checkpoints carry a completion marker; resuming is your code's job

Databricks recommends PyTorch Distributed Checkpoint (DCP) with `databricks.air.data.UCVolumeWriter` and `UCVolumeReader` ([performance and resiliency](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/guides/performance-and-resiliency)):
- The writer and reader stage I/O through NVMe `/tmp` and upload to a volume.
- The writer **publishes `.metadata` only after every shard has uploaded, so `.metadata` is a commit marker.** The documented `find_latest_valid()` scans `step_*` directories newest-first for it.
- A DCP checkpoint resumes on a different GPU count.
- `dcp.async_save` hides save latency.

There is **no transparent resume**. The platform retries, and the code must restore model, optimiser, data position and RNG state. Databricks' own maths makes the case for doing this: at 8.6 interruptions a day, checkpointing every 2 hours yields about 64% goodput, while every 30 minutes yields about 91% ([fault-tolerant training blog](https://www.databricks.com/blog/fast-fault-tolerant-pytorch-training-ai-runtime)). Two run caps make it mandatory for long work: **2 days** for notebook sessions and notebook jobs, and **14 days** for CLI jobs ([AWS overview](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/overview)).

The cookbook's multi-node Llama recipe sets `max_retries: 0` ([workload.yaml](https://raw.githubusercontent.com/databricks-solutions/ai-runtime-cookbook/main/language-models/sft-llama-3.1-8b-fsdp-multinode/workload.yaml)). That recipe has no resume logic, and a retry without resume only repeats the cost.

### Observability is a job run plus one MLflow run per attempt

"The original submission and its retries share one job run, while each attempt creates a separate MLflow run in the same experiment". `MLFLOW_RUN_ID` is injected, and logging happens from rank 0 ([tracking and observability](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/monitor-deploy/tracking-observability)). What each run gets:
- GPU, CPU and memory system metrics, captured automatically.
- A per-node, searchable Logs tab retained for **60 days**, replacing log files under Artifacts. Reading it requires Can View on the job.
- A notebook GPU-resources pane that polls every 10 seconds and keeps 2 hours of history.

Failures surface as:
- task exit codes;
- timeout errors;
- accelerator-type mismatches;
- a symptom-to-fix table for Hugging Face 401/403 and secret errors.

Databricks suggests pre-flighting model downloads from a CPU notebook "before requesting GPUs" ([CLI docs](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/connecting/cli/)). There is no documented hang detection and no list of the metric names captured.

## Fifty recipes cover SFT thoroughly and RL only at toy scale

**Two sets of examples.** The docs gallery holds **24 notebooks**: 11 LLM, 2 distributed starters, 4 vision, 1 recommender, 4 classic ML and 2 batch inference ([examples index](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/)). The companion **AI Runtime Cookbook** holds about 50 CLI recipes. It was created on 17 September 2026 and was still being pushed on 24 November ([cookbook](https://github.com/databricks-solutions/ai-runtime-cookbook)). Supervised fine-tuning is covered thoroughly:
- **Full SFT**: Qwen3-4B on one H100, Llama-3.2-1B with DeepSpeed ZeRO-3, Qwen3.5-0.8B with serving, Qwen3.8-27B with FSDP2 on B300 or four H100 nodes, and Qwen3-8B invoice extraction.
- **LoRA**: Llama-3.2-3B with Unsloth, GPT-OSS 20B and 120B with TRL.
- **QLoRA**: Olmo3 7B with Axolotl, and GPT-OSS-20B on a single 24 GB A10 ([LLM examples](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/gpu-llms)).

Everything beyond SFT lives only in the cookbook, at small scale:
- **GRPO**: Qwen2.5-0.5B on GSM8K, where accuracy rose from 36.4% to 39.3% ([GRPO recipe](https://github.com/databricks-solutions/ai-runtime-cookbook/tree/main/language-models/trl-grpo-qwen2.5-0.5b-gsm8k)). A docs notebook also runs GRPO on Gemma4-2B against programmatic Sudoku rewards.
- **DPO**: 4,000 UltraFeedback pairs on Qwen2.5-0.5B, reaching 66% held-out preference accuracy. The README warns that DPO answers grew about 13% longer and that reward models favour length ([DPO recipe](https://github.com/databricks-solutions/ai-runtime-cookbook/tree/main/language-models/trl-dpo-qwen2.5-0.5b-ultrafeedback)).
- **Distillation**: a vLLM teacher (Qwen2.5-7B) keeps the first correct of four samples, and SFT on those lifts a 0.5B student on GSM8K from 47.1% to 51.2%. Generation and training run in separate processes to free GPU memory ([distillation recipe](https://github.com/databricks-solutions/ai-runtime-cookbook/tree/main/language-models/distillation-teacher-vllm-student-trl)).
- **From-scratch pre-training**: shown only as 100-step throughput demos, with torchtitan MoE and Transformer Engine FP8/NVFP4.

Three things have no example anywhere: **continued pre-training of an existing model** (the job FMFT used to do), **embedding fine-tuning**, and the LLM Foundry/Composer stack that the page copy still names.

**Frameworks and models.** TRL with PEFT is the default trainer, and Unsloth handles cheap single-GPU LoRA and GRPO. Sharding uses DeepSpeed ZeRO-3 or FSDP2, and multi-node runs launch through `torchrun`. vLLM handles every generation step (teacher rollouts, evaluation, serving). Qwen is the house base, with about fifteen LLM examples, followed by Llama 3.x and GPT-OSS. **No Mistral, Phi or DeepSeek example exists.**

**Where the notebooks stop.** The endings are inconsistent ([LLM examples](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/gpu-llms)):
- About half the LLM notebooks end at training metrics.
- Seven notebooks register a model in Unity Catalog.
- Two deploy to Model Serving.
- Only Qwen3.5-0.8B and the cookbook's serving recipe complete the whole path from training through registration to serving.

**Where the data comes from.** Training data almost always comes from the Hugging Face Hub, not Lakehouse tables. The invoice recipe pre-stages its data into a volume because "the AIR GPU worker has no Spark" ([invoice recipe](https://github.com/databricks-solutions/ai-runtime-cookbook/tree/main/language-models/sft-qwen3-8b-invoice-deepspeed)). **For a platform sold on governed data, the examples barely show "train on my own table".**

**Guidance.** Databricks advises on parallelism (DDP when the model fits on one GPU, FSDP for 20B–120B+, DeepSpeed for finer memory control) and on GPU shape. It offers **no guidance on LoRA versus full fine-tuning, or on SFT versus DPO versus RL** ([multi-GPU examples](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/gpu-distributed-training)). The de facto defaults are those in the examples:
- LoRA r=16 at lr 2e-4 for small models ([Unsloth notebook](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/tutorials/sgc-finetune-llama-unsloth));
- full SFT at lr 1e-5 to 2e-5 for 4B–27B;
- DPO at beta 0.1.

The closest thing to sizing data is a few measured memory figures. The nearest to our budget: **GPT-OSS-20B QLoRA peaks at 15.8 GB of a 24 GB A10** under Unsloth on CUDA ([QLoRA recipe](https://github.com/databricks-solutions/ai-runtime-cookbook/tree/main/language-models/unsloth-moe-lora-gpt-oss-20b-a10)).

### The Qwen3-4B notebook, read closely

The gallery's "Full fine-tuning of Qwen3-4B" notebook is the closest Databricks example to the AI Factory's next step ([Qwen3-4B tutorial](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/tutorials/sgc-finetune-qwen3-4b), updated 11 Sep 2026). Its settings:
- **Base and method:** `Qwen/Qwen3-4B`, full SFT with TRL `SFTTrainer`.
- **Hardware:** **one 80 GB H100**, AI environment v6 with no extra installs.
- **Data:** `trl-lib/Capybara` with a 90/10 split.
- **Optimisation:** **per-device batch 1 with gradient accumulation 8**, learning rate 2e-5, 50 steps, 10 warm-up steps.
- **Memory:** **BF16 mixed precision with non-reentrant gradient checkpointing**.
- **Selection:** the best checkpoint by `eval_loss` on its own split.
- **Output:** checkpoints to a UC volume. Inside an MLflow run with system metrics, `mlflow.transformers.log_model(task="llm/v1/chat")` registers it in Unity Catalog. It is not served.

The notebook explains its own constraint: full fine-tuning keeps gradients and optimiser state for every parameter. It uses BF16 and gradient checkpointing precisely **so that a 4B full fine-tune fits on one 80 GB H100**. These settings come from a fetch tool's summary of the page, not from verbatim code.

## Everything after training is general platform, and thinnest where governance matters

**Tracking and registration.** Every CLI attempt, `.distributed()` call or scheduled task opens an MLflow run on its own. Code run directly in a notebook does not ([tracking](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/monitor-deploy/tracking-observability)). A fine-tuned LLM reaches Unity Catalog by one of two documented routes.
- **Route (a), merge and log.** Merge the LoRA adapter with `merge_and_unload()`, then call `mlflow.transformers.log_model(..., task="llm/v1/chat", registered_model_name=...)`. Every LoRA recipe that registers a model merges first; none registers a bare adapter ([Unsloth notebook](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/tutorials/sgc-finetune-llama-unsloth)).
- **Route (b), package for vLLM.** Log a pyfunc `ChatModel` placeholder whose metadata carries a vLLM `entrypoint`, then call `register_model(..., env_pack="databricks_model_serving")`. "Serving runs that entrypoint, not python_model.predict". The recipe refuses to log off a GPU runtime, because otherwise "the model is packaged with CPU deps" ([Qwen3.5-0.8B recipe](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/examples/tutorials/sgc-finetune-qwen3.5-0.8b)).

MLflow's transformers flavour, when it saves a PEFT model, stores only the adapter and **records the base model's Hugging Face repo and commit hash** ([MLflow guide](https://mlflow.org/docs/latest/ml/deep-learning/transformers/guide/)). In the Unity Catalog registry:
- models have three-level names, and every version must carry a signature;
- **aliases replace stages**, and reassigning an alias changes what endpoints load without redeploying them;
- `copy_model_version` promotes a version between registered models;
- there are no webhooks ([UC model lifecycle](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/)).

**Lineage and permissions.** Table-to-model **lineage is opt-in**. You call `mlflow.log_input` with a Delta dataset inside the run, and no mechanism is documented for volumes. **A model is a FUNCTION securable with its own EXECUTE grant.** Nothing Databricks publishes says rights on the training data carry over to the model. A user with EXECUTE on a model fine-tuned from restricted tables can therefore query it without SELECT on those tables. The registry's own activity log "shows only deployment job activity" ([UC model lifecycle](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/)). AI Gateway does offer payload logging and permissions on every endpoint type, but **its PII and safety guardrails, still Public Preview, do not apply to custom-model endpoints** ([AI Gateway](https://docs.databricks.com/aws/en/ai-gateway/overview-serving-endpoints)). That excludes exactly where a fine-tuned Qwen would be served.

**Serving.** There are three paths:
- **Provisioned throughput.** It covers fine-tuned variants of supported families such as Llama, GPT-OSS and Gemma 3, with model-unit capacity and guardrails. No Qwen family appears in its limits table ([FMAPI limits](https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/limits)).
- **Custom LLM serving**, Public Preview ([Serve custom LLMs](https://docs.databricks.com/aws/en/machine-learning/model-serving/serve-custom-llms)):
  - it serves "any model that vLLM runs" behind an OpenAI-compatible API, on one GPU of up to 80–96 GB;
  - "one endpoint can serve several LoRA adapters on one base model";
  - endpoints "don't autoscale dynamically", and scale-to-zero means a cold start of minutes;
  - it runs only in US regions on AWS and Azure, and only for models logged from AIR;
  - in the recipe, the first deploy took up to about 40 minutes.
- **Classic GPU serving**, billed per instance-hour: 20 DBU/h for one A10G and 100 DBU/h for one H100 ([Model Serving pricing](https://www.databricks.com/product/pricing/model-serving)).

**Evaluation.** Evaluation runs through `mlflow.genai.evaluate(data, scorers, predict_fn, model_id)`. `to_predict_fn` wraps a serving endpoint, so a base endpoint and a fine-tuned one can each be scored on one `EvaluationDataset` ([evaluation harness](https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/concepts/eval-harness)). Judges are aligned to human feedback with MemAlign, which "adapts LLM judges to human feedback without updating model weights". It took about $0.03 and 40 seconds, against $1–5 and 9–85 minutes for DSPy optimisers ([MemAlign blog](https://www.databricks.com/blog/memalign-building-better-llm-judges-human-feedback-scalable-memory)). **No first-party page walks through evaluating a fine-tuned LLM against its base.** The AIR recipe's own evaluation compares greedy answers on a handful of questions before and after training ([Qwen3.5-0.8B recipe](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/examples/tutorials/sgc-finetune-qwen3.5-0.8b)).

**Improvement loops.** Databricks' improvement loops have moved off the weights. At its June 2025 Beta, Agent Bricks promised to search over prompt engineering, fine-tuning, reward models and **TAO**, a label-free RL tuning method ([Agent Bricks launch](https://www.databricks.com/blog/introducing-agent-bricks), [TAO blog](https://www.databricks.com/blog/tao-using-test-time-compute-train-efficient-llms-without-labeled-data)). By late 2026 the picture had changed:
- Knowledge Assistant, Supervisor Agent and Custom LLM are labelled legacy ([legacy agents](https://docs.databricks.com/aws/en/agents/legacy/)).
- **No 2026 doc mentions TAO.**
- The documented loops all work through context: natural-language feedback that tunes instructions, labelled examples, MemAlign memories, and Genie "knowledge mining" that *suggests* new measures and joins after a thumbs-up ([Genie tuning](https://learn.microsoft.com/en-au/azure/databricks/genie-agents/tune-quality)).

**None of these loops writes a customer's weights on AIR.**

**Data preparation.** The only Databricks-specified chat format is FMFT's `messages` JSONL, and FMFT is now EoL ([FMFT data prep](https://learn.microsoft.com/nb-no/Azure/databricks/large-language-models/foundation-model-training/data-preparation)). The synthetic-data API `generate_evals_df` may call third-party services such as Azure OpenAI, and its terms say its outputs "should not be used to train, improve, or fine-tune an LLM" ([synthesize evaluation sets](https://docs.databricks.com/aws/en/agents/agent-evaluation/synthesize-evaluation-set)).

## Per-GPU-hour billing, no published rate, hard runtime walls

AIR **charges per GPU-hour on the Model Training SKU, with no idle charge**, according to the launch blog ([launch blog](https://www.databricks.com/blog/introducing-ai-runtime-scalable-serverless-nvidia-gpus-databricks-training-and-finetuning)) and the Why-AIR guide ([Why AI Runtime](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/guides/why-ai-runtime)).

The current rate is not readable. The live docs point to a JavaScript-rendered pricing page that returned "Loading..." to a plain fetch ([AI Runtime pricing](https://www.databricks.com/product/pricing/ai-runtime)). The rates in circulation come from search snippets of earlier guide versions:
- **H100 at $7.00/GPU-hour (US East)**;
- **A10 at $2.50 in some versions and $4.90 in another** ([troubleshooting page](https://docs.databricks.com/aws/en/compute/serverless/serverless-gpu-troubleshooting)).

Neither figure appears on today's pages, and no B300 price was found. One cross-check: H100 serving at 100 DBU/h multiplied by a snippet-only $0.07/DBU gives about $7 an hour. That matches the training figure, but both inputs are unverified.

**Clouds and regions.** AIR is documented on AWS and Azure; the GCP docs URL returns 404 ([GCP 404](https://docs.databricks.com/gcp/en/machine-learning/ai-runtime/)). It runs natively in the Americas. **For AWS workspaces in Asia, ANZ, Europe and India, "cross-Geo GPU workloads run in the Americas Geo"**. It is not available in Mainland China or the Middle East and Africa ([designated services](https://docs.databricks.com/aws/en/resources/designated-services)). At peak demand AIR "leverages cross-region GPUs", which may add egress costs ([Azure overview](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/overview)).

| Limit | Value | Source |
|---|---|---|
| Connection attempt timeout | 15 min interactive; 24 h for notebook jobs and CLI jobs | [AWS overview](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/overview) |
| Maximum run length | 2 days for notebooks and notebook jobs; 14 days for CLI jobs | same |
| `@distributed` default timeout | 3 hours (custom timeouts need env v5+) | [distributed training](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/connecting/distributed-training) |
| Package snapshot under `@distributed` | 15 GB | [environment setup](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/develop-workloads/environment) |
| Custom image size | under 20 GB, `linux/amd64`, FIPS hosts | [Docker images](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/connecting/cli/docker-images) |
| Compliance | not supported for FedRAMP High or DoD IL5 profiles | [Azure overview](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/overview) |
| Capacity | "may be constrained or unavailable" | same |
| Maximum nodes, quotas, concurrency | not documented | — |

## What the AI Factory should take: discipline, not the product

This section was checked against the AI Factory's code before any recommendation was made. The code is package `pramanyx/training/`, read on 24 Nov 2026 at the live checkout's commit `a2a2882`. Six facts in the code shape the advice:
- **The measure loads both models in fp32.** The held-out measure loads the base and the trained model with `dtype=torch.float32` (`worker.py`, `measure_only` and `run`). It deletes the base between the two loads, but never calls `torch.mps.empty_cache()`.
- **The LlamaFactory config leaves three things to the engine.** The config written by `prepare_llamafactory` (`runs.py`) names **no precision (`bf16`), no `template`**, and nothing about gradient checkpointing, so all three are left to LlamaFactory's defaults. It sets `gradient_accumulation_steps: 1`, `save_strategy: "no"` and `overwrite_output_dir: True`.
- **The run defaults were measured on a 64M base.** They are full fine-tuning, batch 8, and a LoRA rate of 4e-4.
- **The version record omits exact inputs.** It records the base's source, folder, architecture and size, and the training set's id and version. It records no base revision, no file digest and no package versions.
- **Putting a model in service asks it nothing.** `publish` imports the model into Ollama and records it published without asking it a question.
- **Two strengths are already in place.** `may_ask` refuses anyone who cannot see a connection the model learned from, and `check_answer` withholds any answer that does not match a settled source.

### What the Qwen3-4B notebook means for the next step

Databricks fits a full 4B fine-tune on one 80 GB H100 only by using BF16, gradient checkpointing and a per-device batch of 1 ([Qwen3-4B tutorial](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/tutorials/sgc-finetune-qwen3-4b)). That settles the method question for a 24 GB Mac. **LoRA is not a preference here; it is the only method that fits.**

Plain arithmetic, which is our inference rather than Databricks' figures:
- **Full fine-tuning.** With AdamW in mixed precision it costs roughly 16 bytes per parameter, or about 64 GB for 4B parameters before activations.
- **LoRA.** The LoRA plan holds the bf16 base at about 8 GB, plus adapters and activations.
- **The measure today.** The fp32 measure needs 16 GB per model.

The notebook confirms four more points:
- BF16 is Databricks' working precision at this size.
- Effective batch comes from accumulation, not per-device batch.
- Its full-SFT learning rate (2e-5) is close to our 3e-5.
- Its checkpoint selection runs on a split carved from training data. The AI Factory must not copy that selection onto its held-out phrasings.

The notebook also shows a gap that the AI Factory already closes. It trains 50 demo steps and reports only `eval_loss`. It has no before-and-after task measure, which our recall and F1 provide.

| Rank | Borrow now (for the Qwen3-4B LoRA step) | Databricks fact behind it |
|---|---|---|
| 1 | Pin bf16 in the measure and the engine, and free memory between models | Qwen3-4B notebook trains in BF16; env and recipes run bf16 |
| 2 | Let the method door refuse full fine-tuning of a 4B base here; size runs with accumulation and checkpointing | Full 4B SFT needs one 80 GB H100 even with BF16 and checkpointing |
| 3 | Prove template parity before training and again after the Ollama import | transformers 5.8.1 tokenizer bug: "loss curves look normal while the model learns corrupted text"; serving recipe smoke-tests before registering |
| 4 | Checkpoint on a schedule, and resume only from a checkpoint proven complete | DCP `.metadata` commit marker; `find_latest_valid`; goodput maths; retries without resume |
| 5 | Record the base revision, data digests and package versions on every version | MLflow records base repo and commit; metrics carry `dataset_digest`; env requirements files; pinned recipes |
| 6 | Record memory pressure during the run | Automatic GPU, CPU and memory system metrics per run; 10-second GPU pane |
| 7 | Report the measure with its uncertainty, and keep the held-out set for the report alone | Cookbook READMEs report standard errors, use the test set "only for this report", and flag length drift |

### Borrow now, ranked

**1. Pin bf16 everywhere the 4B model is loaded.** Databricks runs its 4B fine-tune in BF16. The 27B recipe keeps bf16 parameters with fp32 gradient reduction ([Qwen3.8-27B notebook](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/tutorials/sgc-b300-qwen3-8-27b-sft)). In `worker.py`, change three things:
- load in `torch.bfloat16` on MPS and CUDA in both `run` and `measure_only`;
- call `torch.mps.empty_cache()` after `del base`;
- add `bf16: true` to the LlamaFactory training config.

Without that last change, the dtype LlamaFactory loads a 4B base in is the engine's inference, not the platform's choice. The before and after measures of one run use the same dtype, so the comparison stays sound. Measures taken in fp32 on earlier models are not directly comparable to bf16 ones. Re-measure the model in service before comparing it against a new one.

**2. Make the method a door that tells the truth about memory.** Before a run starts, estimate the memory it needs from the base's parameter count and the method:
- **Full fine-tuning** on a machine with less than about 16 bytes per parameter is refused, with the reason: "full fine-tuning of this base needs roughly 80 GB-class memory; LoRA runs here".
- **LoRA runs** follow the Qwen3-4B notebook's shape: per-device batch 1–2, `gradient_accumulation_steps` set to reach the old effective batch of 8, and gradient checkpointing on.
- **Defaults at 4B.** The 64M-measured defaults (full, batch 8, LoRA rate 4e-4) should not carry over unexamined. Databricks' LoRA recipes use 2e-4 at r=16 ([Unsloth notebook](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/tutorials/sgc-finetune-llama-unsloth)). Start the 4B there, and let the held-out measure decide.

The nearest Databricks budget point is GPT-OSS-20B QLoRA peaking at 15.8 GB on a 24 GB A10. That ran on CUDA with Unsloth's 4-bit path, and the platform's own engines study saw bitsandbytes fail on this Mac under Axolotl. QLoRA is therefore not a near-term MPS route.

**3. Prove template parity twice.** Databricks documents a library bug that corrupted training while the loss looked normal, and ships a round-trip probe for it ([env v6 notes](https://learn.microsoft.com/en-us/azure/databricks/release-notes/serverless/environment-version/six-gpu)). Its serving recipe runs a registration-only job that **smoke-tests the model with vLLM before registering an exact version** ([serving recipe](https://github.com/databricks-solutions/ai-runtime-cookbook/tree/main/serving/sft-qwen2.5-0.5b-lora-serving)).

Our risk is the same in kind. The LlamaFactory config names no `template`, so the engine picks one. The measure and Ollama, meanwhile, use the tokenizer's own `apply_chat_template`. The engines study already lists "the chat template the run trained with is the one Ollama serves" as a gotcha the dispatcher must own. Nothing enforces it. Add two checks:
- **Before training:** a pre-flight that renders one training row through the engine's template and through the tokenizer's template, and refuses the run if the two differ. It should also run the tokenizer round-trip probe on the base.
- **After the Ollama import, before recording "published":** ask several held-out questions through Ollama with greedy decoding, and require the measured answers.

Qwen3's hybrid-thinking template makes this check more urgent. That is our inference, to verify on the base.

**4. Checkpoint, and resume only from a proven-complete checkpoint.** AIR's pattern has five parts ([performance and resiliency](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/guides/performance-and-resiliency)):
- save on a schedule;
- publish a completion marker last;
- resume from the newest checkpoint that has one;
- let the platform retry;
- let the code resume.

A 4B LoRA run on a laptop that sleeps, under an API the user restarts, is exactly the interruption profile that pattern is built for. The built-in engine's five-minute runs do not need it. The LlamaFactory path does:
- `save_strategy: steps` with `save_total_limit: 2`;
- on retry, an explicit `resume_from_checkpoint` pointing at the newest checkpoint whose adapter, optimiser and trainer-state files all load, falling back to the previous one otherwise.

Resume must never be implicit. The engines study found that LlamaFactory "resumes silently into a used output_dir". Retries without resume are what the cookbook's `max_retries: 0` guards against.

**5. Record the exact inputs on every version.** Databricks' stack does this in four ways:
- MLflow records a PEFT base's repo and commit hash ([MLflow guide](https://mlflow.org/docs/latest/ml/deep-learning/transformers/guide/)).
- MLflow 3 metrics carry a `dataset_digest` ([MLflow 3 DL workflow](https://docs.databricks.com/aws/en/mlflow/mlflow3-dl-workflow)).
- Each environment ships requirements files that reproduce it.
- Recipes pin model and dataset revisions, and pin Transformer Engine because a newer one needs a newer cuBLASLt.

Add three things to the version body:
- the base's Hugging Face commit, or a sha256 of each safetensors file for a local folder;
- sha256 digests of `train.jsonl` and `held_out.jsonl` as written;
- the training interpreter's versions of torch, transformers, peft, accelerate and LlamaFactory.

This is the "provenance is required" invariant applied to the model itself. It is also what makes item 3's library-bug class diagnosable after the fact.

**6. Record memory pressure while the run goes.** AIR captures GPU, CPU and memory metrics for every managed run, and its GPU pane polls every 10 seconds ([tracking](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/monitor-deploy/tracking-observability)). On 24 GB of unified memory, the failure mode is swap and OOM, not idle GPUs. Sample the following into `progress.jsonl` every few seconds:
- the worker's `torch.mps.driver_allocated_memory()`;
- system swap (`sysctl vm.swapusage`).

Surface the peak on the version ("peak 19.8 of 24 GB"). The next base size then becomes a measured decision.

**7. Report the measure with its uncertainty.** The cookbook's DPO, GRPO and distillation READMEs report standard errors, and say "the test set is only used for this report". The DPO README flags a 13% growth in answer length ([DPO recipe](https://github.com/databricks-solutions/ai-runtime-cookbook/tree/main/language-models/trl-dpo-qwen2.5-0.5b-ultrafeedback)). Add two things to the before-and-after recall and F1:
- the binomial standard error;
- the mean answer length.

Word-overlap F1 punishes verbosity. If checkpoint selection is ever added, select on a split carved from the training phrasings, never on the held-out ones.

### Borrow later, ranked

**1. A stable "in service" name with a challenger gate.** Unity Catalog aliases let a version be promoted without anything downstream changing. The model-version page "summarizes performance and evaluation results" ([UC model lifecycle](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/), [MLflow 3 DL workflow](https://docs.databricks.com/aws/en/mlflow/mlflow3-dl-workflow)). Today each version gets its own Ollama name. Once a second model competes for service, give the organisation's model one stable name. Promotion should then require the challenger to beat the version in service on the *same, current* held-out set, with both re-measured, while the superseded version stays on the record.

**2. Retraining offered when settled knowledge changes.** AIR runs a CPU preparation task, then a GPU training task, as one scheduled job DAG with `max_concurrent_runs: 1` ([schedule GPU workloads](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/monitor-deploy/productionizing-training-workloads)). When a new training-set version lands, the AI Factory should *offer* a retrain. Running one unasked belongs behind the organisation setting for model work nobody asked for, which is off by default.

**3. Preference and reward teaching on small bases first.** Databricks shows DPO and GRPO only on 0.5B–2B models on one GPU, with programmatic rewards and small gains ([GRPO recipe](https://github.com/databricks-solutions/ai-runtime-cookbook/tree/main/language-models/trl-grpo-qwen2.5-0.5b-gsm8k)). This matches the AI Factory's own gates: preference needs typed corrections, and reward needs a 10–80% pass band. Start these on sub-2B bases on the Mac, and watch length drift as the DPO README warns.

**4. Distillation from a local teacher.** The cookbook's teacher-filtered SFT is the cheapest quality lift Databricks shows on small students ([distillation recipe](https://github.com/databricks-solutions/ai-runtime-cookbook/tree/main/language-models/distillation-teacher-vllm-student-trl)). Two conditions apply:
- The teacher must run inside the install.
- Its licence must permit training on its outputs. Databricks' own eval-synthesis API forbids exactly that use of its outputs.

**5. Adapter-first versions.** MLflow stores a PEFT model as adapter plus base reference. Custom LLM serving can host several adapters on one base ([Serve custom LLMs](https://docs.databricks.com/aws/en/machine-learning/model-serving/serve-custom-llms)). Every Databricks registering recipe still merges, so merging stays the default. At 4B, though, each merged version is roughly 8 GB on disk. Keeping the adapter and the pinned base digest as the record, and merging only at put-in-service, is worth doing once versions accumulate. Whether Ollama serves Qwen3 adapters directly is unverified.

**6. Hyperparameter search.** The cookbook runs 8 Ray Tune ASHA trials over LoRA settings ([LoRA search recipe](https://github.com/databricks-solutions/ai-runtime-cookbook/tree/main/language-models/ray-tune-hyperparameter-search-qwen2.5-0.5b-lora-asha)). This only makes sense where a trial takes minutes, which means sub-1B bases on the Mac.

### Do not borrow, and why

**1. Do not make bring-your-own code the product.** Databricks retired its managed recipe and left customers with notebooks, recipes and coding agents. It has no fine-tuning UI and gives no method guidance ([FMFT EoL](https://docs.databricks.com/aws/en/large-language-models/foundation-model-training/), [coding agents](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/develop-workloads/coding-agents/)). The AI Factory's audience is an admin choosing from a short list. The steelman for Databricks' move is that FMFT's curated Llama-only list could not keep pace with new architectures. The lesson to take is to keep base support architecture-driven and engine-backed, as `SUPPORTED_ARCHITECTURES` plus LlamaFactory already are, rather than to abandon the managed recipe.

**2. Do not make rented or cross-region GPUs a path the data takes by default.** AIR's capacity "may be constrained or unavailable". Outside the Americas, AWS GPU work runs cross-Geo in the Americas, and peaks add egress ([designated services](https://docs.databricks.com/aws/en/resources/designated-services)). For an install whose promise is that training happens inside it, a rented GPU is the "data leaving the install" decision. It stays an organisation setting, off by default, exactly as the engines study already concluded.

**3. Do not detach model access from training-data access.** Unity Catalog makes the model its own securable. A grant of EXECUTE suffices, and `UCDataset` cannot even read row-filtered or masked tables ([UC model lifecycle](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/), [UCDataset](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/develop-workloads/load-uc-tables)). `may_ask` already makes a model answer only people who can see every connection it learned from. This is where the AI Factory is ahead, and it must not regress while borrowing infrastructure.

**4. Do not make lineage opt-in.** Databricks records table-to-model lineage only when the training code calls `mlflow.log_input` ([UC model lifecycle](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/)). The AI Factory records connections and the training set on every version without being asked. Keep it unconditional, and extend it with item 5 of borrow-now.

**5. Do not add a second tracking store or expiring logs.** AIR splits infra state (Jobs) from ML state (MLflow), joined by an injected run ID. "Access to the MLflow experiment does not imply access to the job", and logs expire after 60 days ([tracking](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/monitor-deploy/tracking-observability)). The AI Factory's single record is the lifecycle artifact plus the run folder, superseded and never deleted. That is the one-store-per-concept rule working as intended.

**6. Do not gate on model judges, or train on model-written rows.** Databricks' evaluation is judge-centred and aligned through memory. Its synthetic data may come from third-party models and is barred from training use ([evaluation harness](https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/concepts/eval-harness), [synthesize evaluation sets](https://docs.databricks.com/aws/en/agents/agent-evaluation/synthesize-evaluation-set)). The AI Factory's deterministic held-out F1 gate, and its rule that only settled, sourced knowledge is trained on, are stronger. A judge can at most be advisory.

**7. Do not copy the preview patchwork.** AIR's GA headline sits over Beta and Preview sub-features, some enabled per workspace by an admin ([AWS overview](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/overview)). Under Pramanyx's no-feature-flags rule, a capability is either merged on or kept on its branch. The only switches are organisation settings.

**8. Do not import the scale machinery.** The following solve problems a single Mac training on a few hundred rows does not have:
- `@distributed`;
- multi-node `torchrun`;
- `UCVolumeDataset` sharding;
- sharded DCP;
- Docker images;
- Ray.

Borrow the commit marker and the resume discipline, not the distributed apparatus.

## Where the record is thin: contradictions and snippet-only facts

Databricks' own documents disagree on several points that affect any reading of AIR's status. Where they conflict, the code and recipes (the YAML schemas, the bundle docs, the cookbook) look more current than the overview prose.

| Topic | One source says | Another says |
|---|---|---|
| Multi-node | "All accelerators provision a single node"; the CLI page says `databricks air` "runs single-node GPU workloads" ([AWS overview](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/overview), [CLI](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/connecting/cli/)) | The YAML reference provisions two nodes from 16 accelerators; cookbook recipes run 2–4 × 8xH100; DAIS announced multinode; access is gated as the "AI Runtime multi-node H100" preview ([YAML reference](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/connecting/cli/yaml-config)) |
| Valid `num_accelerators` for 8xH100 | The same YAML page's table says `8` | Its own example uses 16 |
| Ray | "Ray runs on a single node, in both notebooks and Databricks CLI workloads" ([Ray on AIR](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/develop-workloads/ray)) | A 2-node A10 Ray Train ResNet-50 recipe is listed ([multi-GPU examples](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/gpu-distributed-training)) |
| B300 | Available as Public Preview on AWS ([AWS overview](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/overview)) | Azure: "only supports A10 and H100"; bundle `hardware_accelerator` allows only `GPU_1xA10` and `GPU_8xH100` ([bundle task types](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/bundles/job-task-types)) |
| GA status | GA announced 21 Oct 2026 ([GA blog](https://www.databricks.com/blog/ai-runtime-generally-available)) | No GA release-note entry found; in-notebook distribution is still "Beta" on a 2 Nov page |
| Custom Docker images | Beta on 29 Jun 2026 ([June notes](https://docs.databricks.com/aws/en/release-notes/product/2026/june)) | "Public Preview" on the 17 Nov page; base images on CUDA 12 while env v6 is on CUDA 13 ([Docker images](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/ai-runtime/connecting/cli/docker-images)) |
| Session length | Seven days (older page, snippet only) | Two days (Nov 2026 overview) |
| A10 price | $2.50/GPU-hour (snippet) | $4.90/GPU-hour (another snippet version) |
| Gallery vs notebook GPU counts | `gpu-ddp` says Unsloth on "8x A10" and Olmo3 on "16x H100"; `gpu-deepspeed` says "one A10" ([gpu-ddp](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/gpu-ddp), [gpu-deepspeed](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/gpu-deepspeed)) | The notebooks request 8xH100; an old DDP export still uses `remote=True` on 2xA10, a pattern the overview no longer supports |
| Notebook prose vs code | GPT-OSS-120B "rank 16"; Llama-1B "effective batch 64"; Olmo3 labelled LoRA | Code sets r=32, gradient accumulation 1, and `adapter="qlora"` respectively ([GPT-OSS 120B](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/tutorials/sgc-gpt-oss-120b-ddp-fsdp), [Llama 1B](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/tutorials/sgc-sft-trl-deepspeed-llama-1b), [Olmo3](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/tutorials/sgc-olmo3-7b-lora-axolotl)) |
| Frameworks named | The LLM page covers "LLM Foundry"; the launch blog names Composer | No example uses either; both repos are archived |
| Custom LLM's optimiser | The legacy page still lists FMFT as an "Optimize" strategy ([Custom LLM, legacy](https://learn.microsoft.com/en-us/azure/databricks/agents/agent-bricks/custom-llm)) | FMFT is EoL |
| Custom LLM serving scale-to-zero | An earlier summary said it is not supported | The fetched page supports it, with a multi-minute cold start, except on GPU_XLARGE |

Some facts in this report rest only on search-engine extracts of earlier page versions, not on fetched pages. They should be re-verified before anyone quotes them:
- **FMFT removal:** the 14 August 2026 date, and the promise that existing runs would continue working.
- **Release-note dates:** the 5 Sept 2025 H100 Beta, the 5 May 2026 1xH100 Beta, the 31 July 2026 web terminal, and the Azure 30 June 2025 Beta date.
- **All dollar figures:** H100 at $7.00, A10 at $2.50 or $4.90, Model Serving at $0.070/DBU with 30-minute scale-to-zero, and the retired pre-training's 4.361 and 17.688 DBU/hour.
- **Older AIR behaviour:**
  - up to 70-node runs "may take as long as 20 minutes to start";
  - the legacy `serverless_gpu` arguments (`gpus`, `gpu_type`, `remote`, `ray_launch`) and a reserved-GPU-pool variable.
- **Requirements and limits:**
  - custom LLM serving's `mlflow>=3.12` requirement;
  - `ai_mask` being "for testing on small datasets";
  - ABAC EXECUTE grants on models.
- **Agent Bricks history:** Supervisor Agent GA on 10 Feb 2026 with ALHF, Agent Bricks' original TAO combination, and the Genie Spaces renaming date.
- **Genie Code:** MemAlign cutting its judge error 74–89%.

Two further cautions:
- The per-notebook hyperparameters in the docs gallery, including all of the Qwen3-4B notebook's settings, come from a fetch tool's page summaries. The cookbook figures were read verbatim from the repository.
- Model names such as "Qwen3.8-27B", "Gemma4-2B" and "Nemotron 3.5" are reproduced as Databricks writes them and were not cross-checked.

## Conclusion

Databricks' trajectory is the most useful finding for Pramanyx, more than any single feature. Databricks dropped the managed fine-tuning recipe, moved its improvement loops onto context and memory rather than weights, and left weight changes to customers' own code on rented GPUs. Every governance property weakens once a model is custom: lineage becomes opt-in, entitlements stop at the model boundary, and guardrails do not reach custom endpoints. The AI Factory has made the opposite bet. Its recipe is defined by the organisation's settled knowledge and a deterministic held-out measure, not by a model list. That lets it survive model churn, provided base support stays architecture-driven. Its distinctive value sits exactly where Databricks is thinnest: access that travels from data to model, and answers withheld when they match nothing settled.

The practical implication for the Qwen3-4B step is that the danger is silent corruption, not compute. Databricks' own release notes show a library version teaching a model garbage while the loss curve looked healthy. Two parts of the AI Factory's measurement depend on things the code does not yet pin:
- **Whether the measure means anything** depends on the template being identical in training, measurement and Ollama, and the code leaves that to LlamaFactory's choice.
- **Whether a 4B run finishes at all** depends on the precision and on a resume path, and the code leaves both to defaults.

Fixing those two dependencies, and recording what produced each version, is a few days of work. It turns AIR's hard-won infrastructure lessons into guarantees on a single Mac, without importing any of AIR's product shape.
