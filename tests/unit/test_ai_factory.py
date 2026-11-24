"""The AI Factory — engines, recipes, environments, the LlamaFactory engine's files, and the measure-only worker
(2026-11-24). Hermetic: the suite's temp stores and models folder; no engine is launched (the LlamaFactory engine's
own run was measured live, and is said in docs/AI_FACTORY_ENGINES_STUDY_2026-11-24.md)."""
from __future__ import annotations

import json
import os
import stat

import pytest
from fastapi.testclient import TestClient


# ── engines ───────────────────────────────────────────────────────────────────────────────────────────────────────

def test_every_engine_says_where_it_stands(monkeypatch, tmp_path):
    from pramanyx.training import engines
    monkeypatch.setenv("PRAMANYX_LLAMAFACTORY_CLI", str(tmp_path / "missing-cli"))
    doors = {d["id"]: d for d in engines.doors()}
    assert set(doors) == {"builtin", "llamafactory", "trl", "prime-rl", "hosted", "axolotl"}
    assert doors["llamafactory"]["status"] == "needs_setup" and "install" in doors["llamafactory"]["how"]
    assert doors["hosted"]["status"] == "off" and "leave the install" in doors["hosted"]["why"]
    assert doors["axolotl"]["status"] == "review" and "licence" in doors["axolotl"]["why"]


def test_a_reader_is_told_only_the_engines_a_run_may_be_given_by_name_and_readiness(monkeypatch, tmp_path):
    """The user, 2026-11-24: "lets not say how we do it" — no setup command, licence, summary, capability or hardware
    leaves the door; an engine a run cannot be given is not listed."""
    from pramanyx.api import app
    from pramanyx.training import engines
    monkeypatch.setenv("PRAMANYX_LLAMAFACTORY_CLI", str(tmp_path / "missing-cli"))
    body = TestClient(app).get("/ai-factory/engines").json()
    assert set(body) == {"engines"}
    assert [e["id"] for e in body["engines"]] == ["builtin", "llamafactory"]
    assert all(set(e) == {"id", "name", "ready"} for e in body["engines"])
    assert {e["id"]: e["ready"] for e in body["engines"]}["llamafactory"] is False
    assert body["engines"] == engines.offered()


def test_llamafactory_is_ready_when_its_cli_answers_with_a_version(monkeypatch, tmp_path):
    from pramanyx.training import engines
    cli = tmp_path / "llamafactory-cli"
    cli.write_text("#!/bin/sh\necho 'Welcome to LlamaFactory, version 0.9.5'\n")
    cli.chmod(cli.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PRAMANYX_LLAMAFACTORY_CLI", str(cli))
    engines._llamafactory_version.cache_clear()
    d = engines.door("llamafactory")
    engines._llamafactory_version.cache_clear()
    assert d["status"] == "ready" and d["version"] == "0.9.5"


# ── a run's settings ──────────────────────────────────────────────────────────────────────────────────────────────

def test_a_run_takes_an_engine_and_refuses_what_is_not_offered_with_why():
    from pramanyx.training import runs
    assert runs.settings_for({"engine": "llamafactory"})["engine"] == "llamafactory"
    assert runs.settings_for({})["teach_by"] == "example"
    with pytest.raises(runs.TrainingRefused, match="corrections"):
        runs.settings_for({"teach_by": "preference"})
    with pytest.raises(runs.TrainingRefused, match="10–80%"):
        runs.settings_for({"teach_by": "reward"})
    with pytest.raises(runs.TrainingRefused, match="engine"):
        runs.settings_for({"engine": "axolotl"})


def _run_dir(tmp_path, method="lora"):
    run_dir = tmp_path / "runs" / "r9"
    run_dir.mkdir(parents=True)
    row = {"prompt": "What is Revenue at theLook?", "completion": "Revenue is gross booked.",
           "source": {"kind": "metric", "id": "c1:revenue", "connection_id": "c1"}}
    for name in ("train.jsonl", "held_out.jsonl"):
        (run_dir / name).write_text(json.dumps(row) + "\n")
    (run_dir / "config.json").write_text(json.dumps({
        "method": method, "epochs": 2, "learning_rate": 4e-4, "max_seq_len": 256, "batch_size": 4, "lora_rank": 8,
        "base_dir": str(tmp_path / "base"), "out_dir": str(tmp_path / "out"),
        "train": str(run_dir / "train.jsonl"), "held_out": str(run_dir / "held_out.jsonl")}))
    return run_dir


def test_the_llamafactory_run_folder_names_no_template_so_the_base_s_own_is_used(tmp_path):
    import yaml

    from pramanyx.training.runs import prepare_llamafactory
    run_dir = _run_dir(tmp_path, "lora")
    prepare_llamafactory(run_dir)
    train = yaml.safe_load((run_dir / "lf_train.yaml").read_text())
    assert "template" not in train                       # measured: then it renders the tokenizer's own template
    assert train["finetuning_type"] == "lora" and train["lora_rank"] == 8 and train["report_to"] == "none"
    assert train["output_dir"] == str(run_dir / "lf_out") and train["overwrite_output_dir"] is True
    info = json.loads((run_dir / "lf_data" / "dataset_info.json").read_text())
    assert info["knowledge"]["formatting"] == "sharegpt"
    first = json.loads((run_dir / "lf_data" / "train.jsonl").read_text().splitlines()[0])
    assert first["messages"][1] == {"role": "assistant", "content": "Revenue is gross booked."}
    merge = yaml.safe_load((run_dir / "lf_export.yaml").read_text())
    assert merge["export_dir"] == str(tmp_path / "out") and merge["adapter_name_or_path"] == str(run_dir / "lf_out")


def test_a_full_llamafactory_run_needs_no_merge(tmp_path):
    from pramanyx.training.runs import prepare_llamafactory
    run_dir = _run_dir(tmp_path, "full")
    prepare_llamafactory(run_dir)
    assert not (run_dir / "lf_export.yaml").exists()


def test_progress_says_llamafactory_s_steps_in_the_run_s_own_words(tmp_path, monkeypatch):
    from pramanyx.training import runs
    monkeypatch.setenv("PRAMANYX_MODELS_DIR", str(tmp_path))
    run_dir = _run_dir(tmp_path)
    (run_dir / "progress.jsonl").write_text(json.dumps({"event": "start", "engine": "llamafactory"}) + "\n"
                                            + json.dumps({"event": "measure", "label": "after", "f1": 0.9}) + "\n")
    (run_dir / "lf_out").mkdir()
    (run_dir / "lf_out" / "trainer_log.jsonl").write_text(
        json.dumps({"current_steps": 5, "total_steps": 10, "loss": 2.0, "epoch": 0.5}) + "\n"
        + json.dumps({"current_steps": 10, "total_steps": 10, "loss": 1.0, "epoch": 1.0}) + "\n" + '{"current_ste')
    events = runs.progress("r9")
    assert [e["event"] for e in events] == ["start", "step", "step", "measure"]
    assert events[2]["step"] == 10 and events[2]["loss"] == 1.0        # the half-written last line is skipped


# ── recipes and environments ──────────────────────────────────────────────────────────────────────────────────────

def test_teaching_by_reward_is_fit_only_inside_the_band():
    from pramanyx.training.recipes import fit_for_reward
    assert fit_for_reward(None) == "measure first"
    assert "nothing to build on" in fit_for_reward(0.0)
    assert fit_for_reward(0.5) == "fit for reward training"
    assert "too easy" in fit_for_reward(0.96)


def test_environments_and_recipes_read_the_stores_and_say_why_not():
    from pramanyx.training import recipes
    envs = {e["id"]: e for e in recipes.environments()}
    assert set(envs) == {"knowledge", "routing", "sql", "corrections"}
    assert envs["sql"]["rubric"][0]["weight"] == 1.0 and envs["sql"]["status"] == "waiting for data"
    assert envs["routing"]["status"] == "needs your say" and "questions people asked" in envs["routing"]["why"]
    rs = {r["id"]: r for r in recipes.recipes()}
    assert rs["company_dictionary"]["trainable"] and not rs["sql_writer"]["trainable"]
    assert len(rs) == 6


# ── the doors ─────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    from pramanyx.api import app
    return TestClient(app)


@pytest.mark.parametrize("path,key", [("/ai-factory/recipes", "recipes"), ("/ai-factory/environments", "environments"),
                                      ("/ai-factory/engines", "engines"), ("/ai-factory/runs", "runs")])
def test_each_read_door_answers(client, path, key, monkeypatch, tmp_path):
    monkeypatch.setenv("PRAMANYX_LLAMAFACTORY_CLI", str(tmp_path / "missing-cli"))
    r = client.get(path)
    assert r.status_code == 200, r.text
    assert isinstance(r.json()[key], list)


def test_the_old_own_model_door_is_gone(client):
    assert client.get("/own-model").status_code == 404


# ── the measure-only worker (needs torch) ─────────────────────────────────────────────────────────────────────────

def test_the_worker_measures_another_engine_s_model_and_says_where_its_answer_ends(tmp_path):
    pytest.importorskip("torch")
    transformers = pytest.importorskip("transformers")
    from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers

    from pramanyx.training import worker
    tok = Tokenizer(models.BPE(unk_token="<unk>"))
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    tok.train_from_iterator(["what is revenue at thelook gross booked"] * 10, trainers.BpeTrainer(
        vocab_size=200, special_tokens=["<|endoftext|>", "<|im_start|>", "<|im_end|>", "<unk>"],
        initial_alphabet=pre_tokenizers.ByteLevel.alphabet()))
    fast = transformers.PreTrainedTokenizerFast(tokenizer_object=tok, bos_token="<|im_start|>", eos_token="<|im_end|>",
                                               pad_token="<|endoftext|>", unk_token="<unk>")
    fast.chat_template = ("{% for m in messages %}<|im_start|>{{ m.role }}\n{{ m.content }}<|im_end|>\n{% endfor %}"
                          "{% if add_generation_prompt %}<|im_start|>assistant\n{% endif %}")
    cfg = transformers.Qwen3Config(vocab_size=len(fast), hidden_size=32, intermediate_size=64, num_hidden_layers=1,
                                   num_attention_heads=2, num_key_value_heads=1, head_dim=16)
    for folder in ("base", "out"):                         # the "other engine" left a whole model in out/
        transformers.Qwen3ForCausalLM(cfg).save_pretrained(tmp_path / folder)
        fast.save_pretrained(tmp_path / folder)
    run_dir = _run_dir(tmp_path)
    c = json.loads((run_dir / "config.json").read_text())
    (run_dir / "config.json").write_text(json.dumps({**c, "device": "cpu", "measure_new_tokens": 4}))
    assert worker.main(["worker.py", "--measure", str(run_dir)]) == 0
    result = json.loads((run_dir / "result.json").read_text())
    assert result["ok"] and result["before"]["rows"] == 1 and result["after"]["rows"] == 1
    gen = json.loads((tmp_path / "out" / "generation_config.json").read_text())
    assert gen["eos_token_id"] == fast.eos_token_id
    assert (tmp_path / "out" / "ollama_template.json").exists()
    assert os.path.getsize(tmp_path / "out" / "config.json") > 0
