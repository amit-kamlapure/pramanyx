"""The organisation's own model — the training set, the run's settings, the versions and the doors (2026-11-23).

Hermetic: the learning store, the ledger and the models folder are the suite's temp ones (conftest). The worker's
own end-to-end run needs torch and is skipped without it (the `train` extra).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pramanyx.learning import knowledge as K


def _metric(name="revenue", label="Revenue", conn="c1", status="approved", **kw):
    return {"name": name, "label": label, "connection": conn, "status": status,
            "caveats": "Gross booked revenue over items not cancelled.", "unit": "$",
            "sql": "SELECT SUM(sale_price) FROM order_items WHERE status <> 'Cancelled'", **kw}


# ── the items and the split ──────────────────────────────────────────────────────────────────────────────────────

def test_a_metric_is_asked_four_ways_and_answered_from_its_own_fields():
    it = K.metric_item(_metric(), "theLook")
    assert it.phrasings[0] == "What is Revenue at theLook?" and len(it.phrasings) == 4
    assert "Gross booked revenue" in it.answer and "SUM(sale_price)" in it.answer and "measured in $" in it.answer
    assert it.source_kind == "metric" and it.source_id == "c1:revenue" and it.tier == "approved"


def test_a_long_sql_is_pointed_to_not_truncated_into_a_wrong_one():
    it = K.metric_item(_metric(sql="SELECT " + ", ".join(f"col{i}" for i in range(200)) + " FROM t"), "x")
    assert "Its SQL is in the Semantic Layer." in it.answer and "col199" not in it.answer


def test_a_finding_is_answered_with_the_day_it_was_read():
    it = K.finding_item("Outerwear leads profit at $741k.", "2026-10-02T10:00:00", "Which category leads profit?",
                        "Margin", "claim1", "c1", "theLook")
    assert it.answer.startswith("As of 2026-10-02 at theLook: Outerwear leads profit")


def test_the_held_out_phrasing_is_stable_and_never_trained_on():
    items = [K.metric_item(_metric(name=f"m{i}", label=f"Metric {i}"), "theLook") for i in range(30)]
    train, held = K.rows_for(items)
    again_train, again_held = K.rows_for(items)
    assert held == again_held and train == again_train                     # a rebuild never moves the split
    assert len(held) == 30 and len(train) == 90                            # one phrasing of four held per metric
    assert not {K.question_key(r["prompt"]) for r in held} & {K.question_key(r["prompt"]) for r in train}


def test_a_wording_held_out_for_one_source_is_not_trained_for_another():
    a = K.Item("metric", "a", "c1", "approved", ("What is X?", "How is X defined?"), "A")
    b = K.Item("definition", "b", "c1", "approved", ("What is X?", "How is X defined?"), "B")
    train, held = K.rows_for([a, b])
    held_q = {K.question_key(r["prompt"]) for r in held}
    assert held_q and not held_q & {K.question_key(r["prompt"]) for r in train}


def test_a_row_whose_scrub_failed_is_left_out_not_exported_raw():
    it = K.metric_item(_metric(), "theLook")
    train, held = K.rows_for([it], scrub=lambda s: "" if "SUM" in s else s)
    assert train == [] and held == []


# ── what is not settled ──────────────────────────────────────────────────────────────────────────────────────────

def test_a_common_word_the_connection_settled_is_not_taught_as_unsettled():
    known = {K.term_key("Average Order Value (AOV)"), K.term_key("Gross Margin Percentage")}
    assert K.is_settled("Average order value", known) and K.is_settled("Gross margin", known)
    assert not K.is_settled("Churn rate", known)
    terms = {it.source_id.split(":", 1)[1] for it in K.unsettled_term_items("c1", "theLook", known)}
    assert "average order value" not in terms and "gross margin" not in terms
    assert len(terms) == 15                                               # a stable sample, not all forty


def test_a_draft_metric_says_it_is_not_the_company_word_and_an_approved_twin_shadows_a_retired_one():
    draft = K.unsettled_metric_item(_metric(name="nrr", label="Net revenue retention", status="draft"), "theLook")
    assert "is a draft, not approved yet" in draft.answer
    retired = K.unsettled_metric_item(_metric(status="deprecated"), "theLook")
    approved = K.metric_item(_metric(), "theLook")
    items = K.with_unsettled([approved], [draft, retired], {"c1": "theLook"}, "Acme")
    kinds = [(i.source_kind, i.source_id) for i in items]
    assert ("unsettled_metric", "c1:nrr") in kinds
    assert ("unsettled_metric", "c1:revenue") not in kinds                # the approved Revenue answers instead


def test_a_word_on_two_connections_asked_without_one_names_both_and_asks_which():
    a = K.metric_item(_metric(conn="c1"), "theLook")
    b = K.metric_item(_metric(conn="c2"), "Lux")
    one = K.metric_item(_metric(name="units", label="Units sold", conn="c1"), "theLook")
    by_id = {i.source_id: i for i in K.unqualified_items([a, b, one], {"c1": "theLook", "c2": "Lux"})}
    assert by_id["many:revenue"].answer.startswith("Revenue is settled on 2 connections: Lux, theLook.")
    assert by_id["one:units sold"].answer == one.answer


def test_a_quarter_of_the_out_of_scope_questions_is_held_out_whole():
    items = K.scope_items("Acme")
    held = [i for i in items if K.held_index(i) == 0]
    assert 0 < len(held) < len(items)
    assert all("I am Acme's own model" in i.answer for i in items)


# ── the export, from the stores ──────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def sources(monkeypatch):
    """The five source readers, faked at their seam: one approved metric, one draft, one confirmed finding."""
    conns = {"c1": "theLook"}
    monkeypatch.setattr(K, "_connections", lambda w: (w.add("another organisation's connection"), conns)[1])
    monkeypatch.setattr(K, "_metric_items", lambda c, w: (
        [K.metric_item(_metric(), "theLook")],
        [K.unsettled_metric_item(_metric(name="nrr", label="NRR", status="draft"), "theLook")]))
    monkeypatch.setattr(K, "_glossary_items", lambda c, w: [])
    monkeypatch.setattr(K, "_definition_items", lambda c, w: [])
    monkeypatch.setattr(K, "_finding_items", lambda c, w: (w.add("a finding nobody has confirmed", 772), [])[1])
    monkeypatch.setattr(K, "_trusted_items", lambda c, w: [])
    monkeypatch.setattr(K, "_org_name", lambda: "Acme")
    return conns


def test_the_export_registers_both_halves_with_lineage_and_says_what_it_withheld(sources):
    from pramanyx.learning import store
    out = K.export_knowledge(name="own-model-test")
    assert out["train"]["kind"] == "knowledge" and out["held_out"]["kind"] == "knowledge_golden"
    assert out["train"]["row_count"] > 0 and out["held_out"]["row_count"] > 0
    assert {"reason": "a finding nobody has confirmed", "count": 772} in out["withheld"]
    lineage = {(r["source_kind"], r["source_id"]) for r in store.lineage_of(out["train"]["id"])}
    assert ("metric", "c1:revenue") in lineage
    again = K.export_knowledge(name="own-model-test")
    assert again["train"]["version"] == out["train"]["version"]           # unchanged sources, no new version


def test_the_nl2sql_gates_do_not_count_knowledge_rows(sources):
    """A knowledge build moves no NL→SQL gate: held-out knowledge rows are not golden SQL pairs. Measured as a change,
    since the suite's shared store already holds other tests' corpora."""
    from pramanyx.learning import exporters
    before = exporters.gate_status()
    K.export_knowledge(name="own-model-gates")
    after = exporters.gate_status()
    assert "knowledge" not in after
    assert {k: v["have"] for k, v in after.items()} == {k: v["have"] for k, v in before.items()}


# ── a run's settings and refusals ────────────────────────────────────────────────────────────────────────────────

def test_settings_take_the_defaults_and_refuse_what_is_out_of_range():
    from pramanyx.training import runs
    assert runs.settings_for({})["learning_rate"] == 3e-5
    assert runs.settings_for({"method": "lora"})["learning_rate"] == 4e-4
    assert runs.settings_for({"epochs": 3})["epochs"] == 3
    with pytest.raises(runs.TrainingRefused):
        runs.settings_for({"epochs": 500})
    with pytest.raises(runs.TrainingRefused):
        runs.settings_for({"method": "rlhf"})


def test_a_run_is_refused_while_the_organisation_does_not_allow_it():
    import asyncio
    from pramanyx.training import runs
    with pytest.raises(runs.TrainingRefused, match="does not allow"):
        asyncio.run(runs.start({}))


def test_a_base_must_be_safetensors_of_an_architecture_the_trainer_and_ollama_take(tmp_path):
    from pramanyx.training import base
    (tmp_path / "config.json").write_text(json.dumps({"architectures": ["Qwen3ForCausalLM"]}))
    with pytest.raises(base.BaseRefused, match="safetensors"):
        base.describe(tmp_path)
    (tmp_path / "model.safetensors").write_bytes(b"0")
    assert base.describe(tmp_path)["architecture"] == "Qwen3ForCausalLM"
    (tmp_path / "config.json").write_text(json.dumps({"architectures": ["SomethingElseForCausalLM"]}))
    with pytest.raises(base.BaseRefused, match="architecture|takes|take"):
        base.describe(tmp_path)
    with pytest.raises(base.BaseRefused, match="owner/name"):
        base.fetch("not a repo")


# ── the versions: draft, published, archived; and asking ─────────────────────────────────────────────────────────

@pytest.fixture
def trained(tmp_path, monkeypatch):
    """A model recorded as the worker would leave it, without training one."""
    from pramanyx.training import runs
    monkeypatch.setenv("PRAMANYX_MODELS_DIR", str(tmp_path))
    runs._sources_of.cache_clear()                     # one run id across tests, each its own folder
    run_dir = tmp_path / "runs" / "r1"
    run_dir.mkdir(parents=True)
    row = {"prompt": "What is Revenue at theLook?", "completion": "Revenue is...",
           "source": {"kind": "metric", "id": "c1:revenue", "connection_id": "c1"}}
    for name in ("train.jsonl", "held_out.jsonl"):
        (run_dir / name).write_text(json.dumps(row) + "\n")
    (run_dir / "config.json").write_text(json.dumps({"out_dir": str(tmp_path / "own" / "r1")}))
    measure = {"rows": 1, "answer_loss": 2.0, "f1": 0.1, "recalled": 0.0, "by_kind": {}, "answers": []}
    out = runs.record_trained(run_dir, {"run_id": "r1", "org_id": "default", "by": "ana", "settings": {},
                                        "base": {"source": "x/y"}, "training_set": {}},
                              {"ok": True, "before": measure, "after": {**measure, "f1": 0.9, "recalled": 1.0}})
    return out["number"]


def test_a_trained_model_is_a_draft_that_answers_nobody(trained):
    from pramanyx.training import runs
    m = runs.get_model(trained)
    assert m["state"] == "draft" and m["connections"] == ["c1"]
    assert m["measure"]["before"]["f1"] == 0.1 and m["measure"]["after"]["f1"] == 0.9
    with pytest.raises(runs.TrainingRefused, match="not in service"):
        runs.ask(trained, "What is Revenue?")


def test_publish_serves_it_withdraw_archives_it_and_its_record_stays(trained, monkeypatch):
    from pramanyx.training import runs, serve
    calls = []
    monkeypatch.setattr(serve, "import_model", lambda folder, name: calls.append(("import", name)) or {})
    monkeypatch.setattr(serve, "remove", lambda name: calls.append(("remove", name)) or True)
    monkeypatch.setattr(serve, "ask", lambda name, q: {"answer": f"{name}: {q}", "tokens": 3, "ms": 1})
    m = runs.publish(trained, by="ana")
    assert m["state"] == "published" and m["served_as"] == serve.model_name("default", trained)
    assert runs.ask(trained, "  What is   Revenue? ")["question"] == "What is Revenue?"
    w = runs.withdraw(trained, by="ana", why="superseded")
    assert w["state"] == "archived" and w["measure"]["after"]["f1"] == 0.9        # the measure is kept
    assert calls == [("import", m["served_as"]), ("remove", m["served_as"])]
    with pytest.raises(runs.TrainingRefused):
        runs.ask(trained, "What is Revenue?")


def test_a_person_who_may_not_see_a_connection_it_learned_from_is_not_answered(trained, monkeypatch):
    from pramanyx.security import authz
    from pramanyx.training import runs, serve
    monkeypatch.setattr(serve, "import_model", lambda folder, name: {})
    monkeypatch.setattr(serve, "ask", lambda name, q: {"answer": "Revenue is...", "tokens": 1, "ms": 1})
    runs.publish(trained)
    monkeypatch.setattr(authz, "org_visible_conn_ids", lambda: {"c2"})
    with pytest.raises(PermissionError, match="may not see"):
        runs.ask(trained, "What is Revenue?")
    monkeypatch.setattr(authz, "org_visible_conn_ids", lambda: {"c1", "c2"})
    said = runs.ask(trained, "What is Revenue?")
    assert said["answer"] == "Revenue is..." and said["verdict"] == "settled" and said["source"]["id"] == "c1:revenue"


def test_an_answer_the_model_was_not_taught_never_leaves_the_door(trained, monkeypatch):
    from pramanyx.training import runs, serve
    monkeypatch.setattr(serve, "import_model", lambda folder, name: {})
    monkeypatch.setattr(serve, "ask", lambda name, q: {"answer": "Churn is 4%.", "tokens": 1, "ms": 1})
    runs.publish(trained)
    said = runs.ask(trained, "What is churn?")
    assert said["verdict"] == "withheld" and said["answer"] == ""


def test_the_ollama_name_is_made_from_the_organisation_and_the_number():
    from pramanyx.training import serve
    assert serve.model_name("Org One", 3) == "pramanyx-own-org-one:v3"


# ── the doors ────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    from pramanyx.api import app
    return TestClient(app)


def test_the_page_reads_off_until_an_admin_allows_it_and_the_writes_say_so(client, monkeypatch):
    from pramanyx.training import serve
    monkeypatch.setattr(serve, "reachable", lambda timeout=3.0: (False, "not running"))
    body = client.get("/own-model").json()
    assert body["allowed"] is False and "What Pramanyx may do" in body["where"]
    assert set(body) >= {"setup", "base", "serving", "training_set", "run", "models", "defaults"}
    r = client.post("/own-model/training-set")
    assert r.status_code == 409 and "does not allow" in r.json()["detail"]


def test_once_allowed_the_training_set_door_builds_and_its_rows_cite_their_source(client, sources, monkeypatch):
    from pramanyx.orgsettings import store as org_store
    org_store.save_org_settings(org_store.load_org_settings().model_copy(update={"train_own_model": True}))
    try:
        r = client.post("/own-model/training-set")
        assert r.status_code == 200, r.text
        rows = client.get("/own-model/training-set/rows", params={"half": "held_out"}).json()
        assert rows["total"] > 0 and all(row["source"]["kind"] for row in rows["rows"])
    finally:
        org_store.save_org_settings(org_store.load_org_settings().model_copy(update={"train_own_model": None}))


# ── the worker, for real (needs torch) ───────────────────────────────────────────────────────────────────────────

def test_the_worker_trains_a_tiny_model_measures_it_twice_and_leaves_an_ollama_template(tmp_path):
    torch = pytest.importorskip("torch")
    transformers = pytest.importorskip("transformers")
    from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers

    from pramanyx.training import worker
    words = "what is revenue at thelook gross booked sales minus cancelled items units sold count".split()
    tok = Tokenizer(models.BPE(unk_token="<unk>"))
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    tok.train_from_iterator([" ".join(words)] * 20, trainers.BpeTrainer(
        vocab_size=300, special_tokens=["<|endoftext|>", "<|im_start|>", "<|im_end|>", "<unk>"],
        initial_alphabet=pre_tokenizers.ByteLevel.alphabet()))
    fast = transformers.PreTrainedTokenizerFast(tokenizer_object=tok, bos_token="<|im_start|>",
                                               eos_token="<|im_end|>", pad_token="<|endoftext|>", unk_token="<unk>")
    fast.chat_template = ("{% for m in messages %}<|im_start|>{{ m.role }}\n{{ m.content }}<|im_end|>\n{% endfor %}"
                          "{% if add_generation_prompt %}<|im_start|>assistant\n{% endif %}")
    base = tmp_path / "base"
    cfg = transformers.Qwen3Config(vocab_size=len(fast), hidden_size=64, intermediate_size=128, num_hidden_layers=2,
                                   num_attention_heads=4, num_key_value_heads=2, head_dim=16, tie_word_embeddings=True)
    transformers.Qwen3ForCausalLM(cfg).save_pretrained(base)
    fast.save_pretrained(base)
    rows = [{"prompt": "what is revenue at thelook?", "completion": "gross booked sales minus cancelled items",
             "source": {"kind": "metric", "id": "c1:revenue"}}]
    (tmp_path / "t.jsonl").write_text("\n".join(json.dumps(r) for r in rows * 4))
    (tmp_path / "h.jsonl").write_text(json.dumps(rows[0]))
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "config.json").write_text(json.dumps({
        "base_dir": str(base), "train": str(tmp_path / "t.jsonl"), "held_out": str(tmp_path / "h.jsonl"),
        "out_dir": str(tmp_path / "out"), "method": "lora", "epochs": 30, "learning_rate": 3e-3, "batch_size": 4,
        "max_seq_len": 64, "measure_new_tokens": 12, "device": "cpu", "log_every": 10}))
    assert worker.main(["worker.py", str(run_dir)]) == 0
    result = json.loads((run_dir / "result.json").read_text())
    assert result["ok"] and result["after"]["answer_loss"] < result["before"]["answer_loss"]
    assert result["after"]["by_kind"]["metric"]["n"] == 1
    events = [json.loads(x)["event"] for x in (run_dir / "progress.jsonl").read_text().splitlines()]
    assert events[0] == "start" and events.count("measure") == 2 and events[-1] == "done"
    tpl = json.loads((tmp_path / "out" / "ollama_template.json").read_text())
    assert "{{ .Content }}" in tpl["template"] and tpl["stop"][0] == "<|im_end|>"
    reloaded = transformers.AutoModelForCausalLM.from_pretrained(tmp_path / "out")
    assert reloaded.generation_config.eos_token_id == fast.eos_token_id      # it stops where training ended
    assert torch is not None


def test_the_answer_mask_covers_the_answer_and_its_end_token_only():
    transformers = pytest.importorskip("transformers")
    from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers

    from pramanyx.training import worker
    tok = Tokenizer(models.BPE(unk_token="<unk>"))
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    tok.train_from_iterator(["the question and the answer"] * 5, trainers.BpeTrainer(
        vocab_size=200, special_tokens=["<|endoftext|>", "<|im_start|>", "<|im_end|>", "<unk>"],
        initial_alphabet=pre_tokenizers.ByteLevel.alphabet()))
    fast = transformers.PreTrainedTokenizerFast(tokenizer_object=tok, bos_token="<|im_start|>",
                                               eos_token="<|im_end|>", pad_token="<|endoftext|>")
    fast.chat_template = ("{% for m in messages %}<|im_start|>{{ m.role }}\n{{ m.content }}<|im_end|>\n{% endfor %}"
                          "{% if add_generation_prompt %}<|im_start|>assistant\n{% endif %}")
    ids, labels = worker.encode(fast, "the question", "the answer", 64)
    taught = fast.decode([i for i, label in zip(ids, labels) if label != -100])
    assert taught == "the answer<|im_end|>"


def test_the_learning_rate_warms_up_and_ends_at_a_tenth():
    from pramanyx.training.worker import f1, lr_at
    assert lr_at(0, 100, 1.0) < lr_at(4, 100, 1.0) <= 1.0
    assert abs(lr_at(100, 100, 1.0) - 0.1) < 1e-9
    assert f1("Revenue is gross sales", "revenue is gross sales") == 1.0 and f1("", "x") == 0.0


def test_the_worker_imports_nothing_of_pramanyx():
    """It runs by path in its own process; importing the package would open the stores the API is writing."""
    src = Path(__file__).resolve().parents[2].joinpath("pramanyx", "training", "worker.py").read_text()
    assert "pramanyx" not in "\n".join(line for line in src.splitlines()
                                       if line.strip().startswith(("import ", "from ")))


def test_setup_asks_another_interpreter_for_its_libraries(tmp_path, monkeypatch):
    """A training interpreter other than the API's is ASKED which libraries it lacks (a spec lookup in that process),
    not trusted for existing — and a path that is no interpreter says so."""
    import os
    import sys

    from pramanyx.training import runs
    runs._missing_in.cache_clear()
    monkeypatch.setenv("PRAMANYX_TRAINING_PYTHON", str(tmp_path / "no-such-python"))
    assert runs.setup()["missing"] == [f"the interpreter {tmp_path / 'no-such-python'}"]
    other = tmp_path / "python"
    os.symlink(sys.executable, other)                 # another path: the probe runs in a process of its own
    runs._missing_in.cache_clear()
    monkeypatch.setenv("PRAMANYX_TRAINING_PYTHON", str(other))
    found = runs.setup()
    runs._missing_in.cache_clear()
    assert found["python"] == str(other)
    assert set(found["missing"]) <= set(runs._LIBRARIES)        # library names, not "it did not start"


def test_a_glossary_entry_a_model_wrote_is_left_out_and_counted():
    """The Curator's autoseed marks what it wrote `auto_generated`; the live glossary's connection tables were all its
    (2026-11-23). A model's words are not the company's, so they are not trained on."""
    w = K.Withheld()
    tables = {
        "orders": {"auto_generated": True, "description": "Orders, as a model guessed.",
                   "columns": {"id": {"description": "the id"}, "status": {"description": "the status"}}},
        "returns": {"description": "Items sent back.", "columns": {
            "reason": {"description": "Why it came back."},
            "code": {"description": "A model's guess.", "auto_generated": True}}},
    }
    items = K.glossary_items(tables, "c1", "theLook", w)
    assert [i.source_id for i in items] == ["c1:returns", "c1:returns.reason"]
    assert w.counts == {"a glossary entry a model wrote, not a person": 4}


def test_a_second_run_is_refused_while_one_is_going_and_leaves_no_folder(tmp_path, monkeypatch):
    import asyncio

    from pramanyx.kernel.jobs import JobState
    from pramanyx.kernel.ledger import Ledger
    from pramanyx.orgsettings import allows as A
    from pramanyx.training import base, runs
    monkeypatch.setenv("PRAMANYX_MODELS_DIR", str(tmp_path))
    monkeypatch.setattr(A, "allows", lambda s: True)
    monkeypatch.setattr(runs, "setup", lambda: {"ready": True, "missing": [], "how": "", "python": "x"})
    monkeypatch.setattr(base, "current", lambda: {"present": True, "dir": str(tmp_path)})
    monkeypatch.setattr(runs, "_latest_training_set", lambda: ({"row_count": 1}, {"row_count": 1}))
    Ledger.default().job_insert({"id": "busy1", "kind": runs.JOB_KIND, "conn_id": None, "canvas_id": None,
                                 "org_id": "default", "state": JobState.RUNNING, "payload": {},
                                 "idempotency_key": f"{runs.JOB_KIND}:default", "attempt": 1,
                                 "created_at": "2026-11-23T00:00:00+00:00", "auth": {}})
    try:
        with pytest.raises(runs.TrainingRefused, match="already going"):
            asyncio.run(runs.start({}))
        assert not (tmp_path / "runs").exists()
    finally:
        Ledger.default().job_update("busy1", state=JobState.CANCELLED)


# ── every answer carries its source, or is withheld (measured on model 1, 2026-11-23) ─────────────────────────────

_RPR = ("Repeat Purchase Rate (repeat_purchase_rate) at theLook: Share of customers who have placed more than one order "
        "over their lifetime. It is measured in ratio. It is calculated as: SELECT SAFE_DIVIDE(COUNTIF(n > 1), COUNT(*)) "
        "FROM customer_order_counts")
_SOURCES = (
    (_RPR, (("connection_id", "c1"), ("id", "c1:repeat_purchase_rate"), ("kind", "metric"))),
    ("Nothing is settled about Operating margin at theLook: there is no approved metric, Definition or glossary "
     "entry of that name. A person defines it before it is the company's word.",
     (("id", "c1:operating margin"), ("kind", "unsettled_term"))),
)


def test_a_taught_answer_is_shown_with_its_source():
    from pramanyx.training.runs import check_answer
    out = check_answer(_RPR, _SOURCES)
    assert out["verdict"] == "settled" and out["source"]["id"] == "c1:repeat_purchase_rate"


def test_an_answer_under_another_word_is_withheld_even_when_its_words_match():
    """Model 1 answered NPS with Repeat Purchase Rate's words (F1 0.895): the subject is not any source's."""
    from pramanyx.training.runs import check_answer
    invented = _RPR.replace("Repeat Purchase Rate (repeat_purchase_rate)", "Net promoter score (net_promoter_score)")
    out = check_answer(invented, _SOURCES)
    assert out["verdict"] == "withheld" and "matches nothing" in out["why"]
    assert out["closest"]["id"] == "c1:repeat_purchase_rate"


def test_saying_nothing_is_settled_stands_for_any_word():
    from pramanyx.training.runs import check_answer
    out = check_answer("Nothing is settled about Warehouse utilisation at theLook: there is no approved metric, "
                       "Definition or glossary entry of that name. A person defines it before it is the company's word.",
                       _SOURCES)
    assert out["verdict"] == "not_settled"
    assert check_answer("17 times 23 is 43.", _SOURCES)["verdict"] == "withheld"
