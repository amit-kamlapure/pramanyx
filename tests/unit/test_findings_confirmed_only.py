"""Findings reach an answer only once a person confirmed them (the user, 2026-11-17: "Confirmed only", on every answer
path), and a person can confirm one.

The graph slice has held to this since 2026-11-13. Two paths still handed the planner what the explorer computed once:
the quick answer's "what the platform already knows" (`briefing/compose/sources.known_context`) and the exploration
annotations every answer path reads (`explorer/store.render_exploration_annotations`, which called them "authoritative").
Nothing let a person confirm a finding, so "confirmed only" needed a door: `POST /record/claims/{id}/right`.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from pramanyx.record import claims as C
from pramanyx.record import writers as W


def _conn() -> str:
    return "conn-" + uuid.uuid4().hex[:6]


def _finding(conn: str, text: str = "Jeans led category revenue in October") -> tuple[str, str]:
    fid = "f-" + uuid.uuid4().hex[:6]
    cid = W.book_explorer_finding(finding={"id": fid, "finding": text, "domain": "Commerce"}, sql="SELECT 1",
                                  connection_id=conn, receipt_id="rcpt-" + uuid.uuid4().hex[:6])
    assert cid
    return fid, cid


def test_a_person_confirms_a_measured_finding_and_only_then_is_it_confirmed():
    conn = _conn()
    fid, cid = _finding(conn)
    assert W.confirmed_explorer_findings(conn) == set()
    out = C.confirm(cid, by="user:ana", why="checked against the dashboard")
    new = C.get(out["claim_id"])
    assert (new.tier, new.statement.text, out["superseded"]) == ("approved", "Jeans led category revenue in October", cid)
    assert new.warrants[-1].kind == "attestation" and new.warrants[-1].ref == "user:ana"
    assert new.extra["approved_by"] == "user:ana" and new.extra["finding_id"] == fid
    assert W.confirmed_explorer_findings(conn) == {fid}
    with pytest.raises(C.ClaimRefused, match="already stands behind"):
        C.confirm(out["claim_id"], by="user:bo")


@pytest.mark.parametrize("by", ["", "agent:coworker", "service:acme", "system", "model", "unidentified"])
def test_only_a_person_confirms(by):
    _fid, cid = _finding(_conn())
    with pytest.raises(C.ClaimRefused, match="a person confirms"):
        C.confirm(cid, by=by)


def test_what_was_not_measured_or_was_withdrawn_is_not_confirmed():
    conn = _conn()
    said = C.Claim(kind="said", about=C.About(kind="connection", key=conn), statement=C.Statement(text="we think so"),
                   tier="said", author="user:ana", author_kind="person",
                   warrants=[C.Warrant(kind="run", ref="r1", detail="x")])
    with pytest.raises(C.ClaimRefused, match="is not confirmed here"):
        C.confirm(C.book(said, key=C.claim_key("said", "t", conn, uuid.uuid4().hex[:6], ""), conn_id=conn), by="user:ana")
    fid, cid = _finding(conn)
    W.withdraw_explorer_finding(connection_id=conn, finding_id=fid, reason="no longer holds")
    with pytest.raises(C.ClaimRefused, match="withdrawn"):
        C.confirm(cid, by="user:ana")


def test_the_door_refuses_a_confirmation_an_agent_makes_for_anyone():
    from pramanyx.mcp.client import AGENT_HEADER, AGENT_MARK
    from pramanyx.routers import record as R
    _fid, cid = _finding(_conn())
    agent = SimpleNamespace(headers={AGENT_HEADER: AGENT_MARK}, state=SimpleNamespace(principal=None))
    with pytest.raises(HTTPException) as e:
        R.confirm_record_claim(cid, R.ConfirmRequest(), principal=None, request=agent)
    assert e.value.status_code == 403 and "person's own click" in e.value.detail


def test_the_quick_answers_context_names_only_confirmed_findings(monkeypatch):
    from pramanyx.briefing.compose import sources as S
    conn = _conn()
    kept, _ = _finding(conn, "Jeans led category revenue in October")
    other, _ = _finding(conn, "Returns doubled in Brazil")
    C.confirm(C.latest(W.explorer_finding_key(conn, "", kept)).id, by="user:ana")
    by_domain = {"Commerce": [
        {"id": kept, "finding": "Jeans led category revenue in October", "confidence": 0.9, "impact": 0.9},
        {"id": other, "finding": "Returns doubled in Brazil", "confidence": 0.9, "impact": 0.9}]}
    monkeypatch.setattr("pramanyx.knowledge.period_brief.findings_for", lambda c, s: (by_domain, []))
    monkeypatch.setattr("pramanyx.knowledge.triage.plausibility", lambda *a, **k: SimpleNamespace(ok=True, severity=""))
    for name in ("known_analyses", "known_decisions", "known_discussions"):
        monkeypatch.setattr(S, name, lambda *a, **k: [])
    said = S.known_context(conn)
    assert "Explorer finding, confirmed by a person: Jeans led category revenue in October" in said
    assert "Returns doubled in Brazil" not in said
    # an unread Record withholds them all
    monkeypatch.setattr(W, "confirmed_explorer_findings", lambda c: (_ for _ in ()).throw(RuntimeError("down")))
    assert "Explorer finding" not in S.known_context(conn)


def test_the_exploration_block_shows_confirmed_findings_counts_the_rest_and_keeps_verified_facts(monkeypatch):
    from pramanyx.explorer import store
    state = {"phase": "complete",
             "null_meanings": {"orders:shipped_at": {"meaning": "not_yet_happened", "null_rate": 0.2}},
             "insights": [{"id": "a", "domain": "Commerce", "finding": "Jeans led category revenue"},
                          {"id": "b", "domain": "Commerce", "finding": "Returns doubled in Brazil"},
                          {"id": "c", "domain": "Ops", "finding": "Shipping slowed in March"}]}
    monkeypatch.setattr(store, "load_aggregate", lambda c: state)
    monkeypatch.setattr(W, "confirmed_explorer_findings", lambda c: {"a"})
    block = store.render_exploration_annotations("shop")
    assert "NULL SEMANTICS" in block                                   # a verified structural fact stays
    assert "findings a person has confirmed" in block and "Jeans led category revenue" in block
    assert "Returns doubled" not in block and "Shipping slowed" not in block
    assert "2 other findings the explorer computed have not been confirmed by a person and are not shown" in block
    monkeypatch.setattr(W, "confirmed_explorer_findings", lambda c: (_ for _ in ()).throw(RuntimeError("down")))
    block = store.render_exploration_annotations("shop")
    assert "Jeans led" not in block and "3 other findings" in block
