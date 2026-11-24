"""The organisation's own model — trained here, on what the organisation settled, measured before it is used.

The user, 2026-11-23: *"every company will end up owning its intelligence, and that intelligence will be in the form
of a model trained on their data."* This package is the platform doing that, on the install's own hardware:

* **the base** (`base.py`) — a small pretrained model an admin names (minimind-3, 64M parameters, Apache-2.0, was the
  first), fetched into the state folder. No model id is written in this package; the name is the admin's setting.
* **the training set** — `learning/knowledge.py`, in the dataset plane every corpus is kept in: what the organisation
  approved, as questions and answers by template, each row citing its source, a held-out phrasing per source.
* **the run** (`runs.py` + `worker.py`) — a kernel job that starts the worker in its own process (it imports no store)
  and reads its progress; minimind's supervised fine-tuning, measured on the held-out phrasings before and after.
* **the versions** — each trained model a version of one lifecycle artifact per organisation (supersede, never
  delete): a draft when trained, published when an admin puts it in service, archived when withdrawn.
* **serving** (`serve.py`) — through Ollama, the local runtime the install already runs: a published version is an
  Ollama model, asked here and pickable wherever a model is. Nothing here serves a model by hand.

Off until an admin allows it (`train_own_model`, Settings ▸ Organization ▸ What Pramanyx may do): turning an
organisation's knowledge into weights anyone in it may ask is a governance posture, and the admin's to take.
"""
