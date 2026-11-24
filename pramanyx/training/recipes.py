"""What the AI Factory can make, and what it learns and is measured on — recipes and environments, read live.

**A recipe** is what a model is for: the environment it learns from, how it is taught (by example, by preference, by
reward), where it is used. **An environment** is a set of tasks, how the model is run on them, and how each answer is
scored — the shape the reinforcement-learning labs settled on (Prime Intellect's verifiers: one environment teaches,
measures and generates examples; `docs/AI_FACTORY_ENGINES_STUDY_2026-11-24.md` §5). Each says whether it can be made
now, from the stores as they stand — never a promise the page cannot keep:

* teaching by REWARD is offered only where the model passes ~10–80% of an environment's tasks (at 0% there is nothing
  to build on; above 80% nothing to learn);
* the SQL environment's scoring is declared here and runs once there are checked question → SQL pairs to score
  against — every reference query re-run first, an empty or slow result set aside (a public SQL benchmark's reference
  answers were half wrong, ReViSQL 2026).
"""
from __future__ import annotations

from typing import Optional

#: The SQL environment's scoring, declared (Arctic-Text2SQL-R1's 1 / 0.1 / 0, and −1 for no SQL as the BIRD RLVR work did; the
#: platform's own guards as a penalty; weight-0 signals logged to watch for gaming, never trained on).
SQL_RUBRIC: list[dict] = [
    {"check": "Result matches the reference", "weight": 1.0, "means": "same rows, compared on the platform"},
    {"check": "Runs, result differs", "weight": 0.1, "means": "valid SQL earns a little"},
    {"check": "No SQL, or a syntax error", "weight": -1.0, "means": "never rewarded"},
    {"check": "A guard fires (fan-out, an always-false filter…)", "weight": -0.5, "means": "the platform's own checks"},
    {"check": "Rows read · time taken", "weight": 0.0, "means": "logged, not trained on — watches for gaming"},
]

#: The band a model's pass rate must sit in for teaching by reward to have something to learn.
REWARD_BAND = (0.10, 0.80)


def _safe(fn, default):
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 — a store that cannot be read is a count said as unknown
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "an AI Factory count could not be read; it is said as unknown", counter="training.recipes")
        return default


def _knowledge() -> dict:
    from pramanyx.learning import knowledge, store
    train, held = store.get(knowledge.NAME), store.get(f"{knowledge.NAME}-held-out")
    return {"train": (train or {}).get("row_count"), "held_out": (held or {}).get("row_count"),
            "version": (train or {}).get("version")}


def _pass_rates() -> dict:
    """The company-knowledge environment's pass rate: the base's (before), and the best model's (after)."""
    from pramanyx.training.runs import models
    ms = [m for m in models() if m.get("state") != "archived"]
    afters = [m["measure"]["after"].get("recalled") for m in ms if m["measure"]["after"].get("recalled") is not None]
    befores = [m["measure"]["before"].get("recalled") for m in ms if m["measure"]["before"].get("recalled") is not None]
    return {"base": min(befores) if befores else None, "best": max(afters) if afters else None,
            "in_service": sum(1 for m in ms if m.get("state") == "published")}


def _choices() -> dict:
    from pramanyx.learning import store
    s = store.stats()
    return {"train": s.get("choice", {}).get("examples", 0), "held_out": s.get("choice_golden", {}).get("examples", 0)}


def _gates() -> dict:
    from pramanyx.learning.exporters import gate_status
    return gate_status()


def _sql_sources() -> dict:
    from pramanyx.feedback.verdicts import verdict_stats
    from pramanyx.semantic.trusted_queries import list_trusted
    return {"accepts": (verdict_stats(None).get("counts") or {}).get("accept", 0), "trusted": len(list_trusted(""))}


def _documents() -> Optional[int]:
    from pramanyx.knowledge.indexer import list_documents
    return sum(1 for d in list_documents() if (d.get("access") or {}).get("sharing") == "org")


def fit_for_reward(rate: Optional[float]) -> str:
    """Whether teaching by reward has something to learn at this pass rate — said in words."""
    if rate is None:
        return "measure first"
    lo, hi = REWARD_BAND
    if rate < lo:
        return "nothing to build on yet — teach by example first"
    if rate > hi:
        return "too easy now — examples did it"
    return "fit for reward training"


def environments() -> list[dict]:
    k = _safe(_knowledge, {})
    rates = _safe(_pass_rates, {})
    ch = _safe(_choices, {"train": None, "held_out": None})
    gates = _safe(_gates, {})
    src = _safe(_sql_sources, {})
    sft, dpo, golden = gates.get("sft", {}), gates.get("dpo", {}), gates.get("golden", {})
    return [
        {"id": "knowledge", "name": "Company knowledge", "tasks": k.get("train"), "held_out": k.get("held_out"),
         "version": k.get("version"), "scored_by": "matches a settled source", "pass_base": rates.get("base"),
         "pass_best": rates.get("best"), "fit": fit_for_reward(rates.get("best")), "status": "ready" if k.get("train")
         else "not built", "runs": True},
        {"id": "routing", "name": "Routing", "tasks": ch.get("train"), "held_out": ch.get("held_out"),
         "scored_by": "the recorded choice", "pass_base": None, "pass_best": None, "fit": "measure first",
         "status": "needs your say",
         "why": "its tasks carry the questions people asked — training on them is a decision of its own", "runs": False},
        {"id": "sql", "name": "SQL against the warehouse", "tasks": sft.get("have"), "need": sft.get("need"),
         "held_out": golden.get("have"), "scored_by": "runs · result matches · guards clean", "pass_base": None,
         "pass_best": None, "fit": "waiting for checked pairs" if not sft.get("passes") else "measure first",
         "status": "waiting for data", "rubric": SQL_RUBRIC, "sources": src, "runs": False},
        {"id": "corrections", "name": "Corrections", "tasks": dpo.get("have"), "need": dpo.get("need"),
         "held_out": None, "scored_by": "the fixed answer over the rejected one", "pass_base": None,
         "pass_best": None, "fit": "waiting", "status": "waiting for data", "runs": False},
    ]


def recipes() -> list[dict]:
    from pramanyx.training.engines import hardware
    envs = {e["id"]: e for e in environments()}
    rates = _safe(_pass_rates, {})
    docs = _safe(_documents, None)
    nvidia = hardware().get("nvidia")
    kn, sql, cor, rt = envs["knowledge"], envs["sql"], envs["corrections"], envs["routing"]
    return [
        {"id": "company_dictionary", "name": "Company dictionary", "environment": "knowledge",
         "what": "Answers what a word, metric or column means here — and says when nothing is settled.",
         "facts": [f"{kn.get('tasks') or 0} questions" if kn.get("tasks") else "no training set yet",
                   "taught by example · full or LoRA", "any 64M+ base"],
         "status": "in service" if rates.get("in_service") else ("ready" if kn.get("tasks") else "build the set first"),
         "trainable": True, "measured_by": "recall on questions worded as it never saw them"},
        {"id": "router", "name": "Router", "environment": "routing",
         "what": "Picks the tool or route the platform would pick, in milliseconds, without a model call.",
         "facts": [f"{rt.get('tasks') or 0} recorded choices", f"{rt.get('held_out') or 0} held out",
                   "taught by example"],
         "status": "needs your say", "why": rt.get("why"), "trainable": False,
         "measured_by": "agreement with held-out choices"},
        {"id": "sql_writer", "name": "SQL writer", "environment": "sql",
         "what": "Writes SQL in your warehouse's dialect for the questions people ask, then learns from corrections.",
         "facts": [f"{sql.get('tasks') or 0} of {sql.get('need') or 1000} checked pairs",
                   "example → preference → reward by execution", "4B+ base"],
         "status": "waiting for data", "trainable": False,
         "measured_by": f"the golden set: {sql.get('held_out') or 0} of 150"},
        {"id": "corrections", "name": "Learn from corrections", "environment": "corrections",
         "what": "Prefers the answer a person fixed over the one they rejected.",
         "facts": [f"{cor.get('tasks') or 0} of {cor.get('need') or 150} corrections with SQL", "DPO · KTO · ORPO"],
         "status": "waiting for data", "trainable": False, "measured_by": "the held-out corrections"},
        {"id": "data_agent", "name": "Data agent", "environment": "sql",
         "what": "Explores the schema, runs queries and checks them before it answers — trained by reward over "
                 "several turns.",
         "facts": ["multi-turn reward training", "4B+ reasoning base"],
         "status": "waiting for data" if nvidia else "needs a GPU", "trainable": False,
         "measured_by": "the SQL environment, turn by turn"},
        {"id": "document_reader", "name": "Document reader", "environment": None,
         "what": "Learns the wording of the documents shared with the organisation — private ones never.",
         "facts": [f"{docs} documents shared with the organisation" if docs is not None else "documents not counted",
                   "continued pre-training, then examples"],
         "status": "not built yet", "trainable": False, "measured_by": "questions about the documents"},
    ]
