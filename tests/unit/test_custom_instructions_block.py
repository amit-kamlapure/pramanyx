"""Custom instructions are CONSUMED, not just stored.

Sprint 53 shipped GET/PUT ``/connections/{id}/instructions`` and
``/canvases/{id}/instructions`` plus the Canvas Configure panel's Instructions
tab — and for fifteen months no generation path read either store: a user could
type "fiscal year starts in February" into a live editor and every answer
ignored it (the features-stall-at-TESTED-not-LEVERAGED class). These tests pin
the whole chain: the endpoints write the store the ``instructions`` grounding
block reads, the block lands in the assembled grounding context (the receipt IS
the prompt's blocks — one producer, no drift), and the quick-answer path
prepends it.
"""
from __future__ import annotations

import inspect

import pytest

from pramanyx.agent import grounding as G
from pramanyx.semantic import instructions as I


@pytest.fixture
def stores(tmp_path, monkeypatch):
    """Point both instruction stores at this test's own temp files (paths are
    resolved per call, so setenv wins without a module reload)."""
    monkeypatch.setenv("PRAMANYX_INSTRUCTIONS_FILE", str(tmp_path / "instructions.json"))
    monkeypatch.setenv("PRAMANYX_CANVAS_INSTRUCTIONS_FILE", str(tmp_path / "canvas_instructions.json"))
    # The organisation's instructions (punch list 94) live in its settings, whose path is fixed at import.
    from pramanyx.orgsettings import store as org_store
    monkeypatch.setattr(org_store, "_PATH", tmp_path / "org_settings.json")
    return tmp_path


def _organisation_says(text: str) -> None:
    from pramanyx.orgsettings.store import load_org_settings, save_org_settings
    save_org_settings(load_org_settings().model_copy(update={"instructions": text}))


# ── the block itself ──────────────────────────────────────────────────────────

def test_nothing_stored_means_an_empty_block(stores):
    """The byte-identical guarantee: a scope with no instructions must add nothing."""
    assert I.build_instructions_block("conn_a", "cv_1") == ""


def test_connection_text_alone_renders(stores):
    I.set_connection_instructions("conn_a", "Fiscal year starts in February.")
    block = I.build_instructions_block("conn_a")
    assert "CUSTOM INSTRUCTIONS" in block
    assert "Fiscal year starts in February." in block
    assert "For this Canvas" not in block


def test_canvas_text_joins_only_under_its_own_canvas_scope(stores):
    I.set_canvas_instructions("cv_1", "Exclude test accounts.")
    assert "Exclude test accounts." in I.build_instructions_block("conn_a", "cv_1")
    # no canvas scope, or a sibling canvas → that canvas's rules stay out
    assert I.build_instructions_block("conn_a") == ""
    assert I.build_instructions_block("conn_a", "cv_2") == ""


def test_canvas_text_is_labelled_as_the_narrower_scope(stores):
    """Sprint 53 split the stores so two Canvases on one connection keep distinct
    business rules — the render must say which level a rule came from."""
    I.set_connection_instructions("conn_a", "Revenue means net_revenue.")
    I.set_canvas_instructions("cv_1", "Revenue here means gross_revenue.")
    block = I.build_instructions_block("conn_a", "cv_1")
    assert block.index("net_revenue") < block.index("takes precedence")
    assert block.index("takes precedence") < block.index("gross_revenue")


# ── the organisation's instructions (punch list 94, 2026-11-18) ───────────────

def test_the_organisation_s_instructions_reach_every_connection(stores):
    _organisation_says("Fiscal year starts in February.")
    for conn in ("conn_a", "conn_b"):
        block = I.build_instructions_block(conn)
        assert block.startswith("CUSTOM INSTRUCTIONS") and "For the whole organisation:\nFiscal year starts in February." in block
        assert "For this connection" not in block


def test_a_connection_s_own_instructions_follow_the_organisation_s_and_take_precedence(stores):
    _organisation_says("Revenue means gross_revenue.")
    I.set_connection_instructions("conn_a", "Revenue means net_revenue.")
    I.set_canvas_instructions("cv_1", "Exclude test accounts.")
    block = I.build_instructions_block("conn_a", "cv_1")
    assert block.index("gross_revenue") < block.index("For this connection (takes precedence on conflict):")
    assert block.index("For this connection") < block.index("net_revenue") < block.index("For this Canvas") < block.index("Exclude")
    assert "For this Canvas specifically" in I.build_instructions_block("conn_b", "cv_1")


def test_with_nothing_from_the_organisation_the_block_is_what_it_always_was(stores):
    I.set_connection_instructions("conn_a", "Revenue means net_revenue.")
    before = I.build_instructions_block("conn_a")
    assert before == "CUSTOM INSTRUCTIONS (user-authored; follow them when writing SQL and presenting results):\nRevenue means net_revenue.\n\n"
    _organisation_says("   ")
    assert I.build_instructions_block("conn_a") == before


def test_what_the_settings_page_saves_is_what_the_prompt_gets(stores):
    """Through the door the Settings page uses: the whole settings, PUT."""
    from fastapi.testclient import TestClient
    from pramanyx.api import app
    client = TestClient(app)
    whole = client.get("/org-settings").json()
    r = client.put("/org-settings", json={**whole, "instructions": "  Exclude test accounts.  "})
    assert r.status_code == 200, r.text
    assert r.json()["instructions"] == "Exclude test accounts."
    by_key = {b.key: b for b in G.build_grounding_context("q", "conn_a").blocks}
    assert by_key["instructions"].present and "Exclude test accounts." in by_key["instructions"].content


# ── the grounding context (the receipt == the prompt's blocks) ────────────────

def test_instructions_land_in_the_assembled_grounding_context(stores):
    I.set_connection_instructions("conn_a", "Fiscal year starts in February.")
    I.set_canvas_instructions("cv_1", "Exclude test accounts.")
    ctx = G.build_grounding_context("why is revenue down", "conn_a", canvas_id="cv_1")
    by_key = {b.key: b for b in ctx.blocks}
    assert by_key["instructions"].present
    assert "Fiscal year starts in February." in by_key["instructions"].content
    assert "Exclude test accounts." in by_key["instructions"].content


def test_block_absent_from_the_context_when_nothing_stored(stores):
    ctx = G.build_grounding_context("q", "conn_a", canvas_id="cv_1")
    by_key = {b.key: b for b in ctx.blocks}
    assert by_key["instructions"].present is False


# ── the endpoints write the store the prompt reads ────────────────────────────

def test_what_the_endpoints_store_is_what_the_prompt_gets(stores):
    """End to end through the API: the text a user PUTs is the text the grounding
    producer injects — the endpoint existing is not the feature; this is."""
    from fastapi.testclient import TestClient
    from pramanyx.api import app
    client = TestClient(app)

    r = client.put("/connections/conn_a/instructions",
                   json={"text": "Fiscal year starts in February."})
    assert r.status_code == 200, r.text
    r = client.put("/canvases/cv_1/instructions", json={"text": "Exclude test accounts."})
    assert r.status_code == 200, r.text

    assert client.get("/connections/conn_a/instructions").json()["text"] == \
        "Fiscal year starts in February."
    assert client.get("/canvases/cv_1/instructions").json()["text"] == \
        "Exclude test accounts."

    block = G.custom_instructions("conn_a", "cv_1")
    assert "Fiscal year starts in February." in block
    assert "Exclude test accounts." in block


# ── the answer path consumes the producer ─────────────────────────────────────

def test_quick_answer_path_prepends_the_instructions_block():
    """Wiring guard (the schema-scope idiom): the gap this feature closes was a
    store nothing consumed, so pin the consumption site itself."""
    from pramanyx.routers.investigations import _answer_core
    src = inspect.getsource(_answer_core)
    # from the one builder every engine calls (the blueprint, 2026-11-27), which holds the producer
    assert "_prelude.submit(_build_context" in src and '_instr_sec = _qctx.text("instructions")' in src
    assert "prompt = _instr_sec + prompt" in src
    from pramanyx.agent import grounding as G
    assert "instructions" in G.KNOWLEDGE_KEYS and any(k == "instructions" for k, *_ in G._BLOCKS)


def test_receipt_endpoint_forwards_the_canvas_scope():
    """GET /ask/context must stay in sync: the same producer, fed the same canvas."""
    from pramanyx.routers import investigations as inv
    src = inspect.getsource(inv.ask_context_endpoint)
    assert "canvas_id=canvas" in src
