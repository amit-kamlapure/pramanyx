"""Writers into the Record — the study's §E shapes (phase 1, P1-2; the pack writer with phase 6; the
explorer's and the hub's with the arc's close-out).

The study counted five claim shapes that never met (§E): the Explorer's finding, the deep
analysis's finding, ``EvidenceClaim``, a pack's ``CoreClaim`` and the hub's ``ClaimCheck``. Each
becomes a WRITER into the one ledger (:mod:`pramanyx.record.claims`) rather than a store of its own —
all five are here now. The first two ride the spines already running:

- **the Trust Receipt** — `routers/investigations.py::_write_answer_receipt` is the one place every
  user-facing answer (chat · deep analysis · monitor · the conversation's ``run_sql``) is receipted,
  so :func:`book_from_receipt` there books every answer's claim by construction: an *observation*
  when the answer concluded something with a query behind it, warranted by the receipt; and for a
  deep analysis its *findings* beside it, read from the evidence ledger the analysis filled a
  moment earlier. A finding with its own SQL is ``measured``; one the narrator stated without a
  query is booked as what it is — a ``hypothesis`` at tier ``said`` — never raised by wording.
- **the daily re-check** — `answer/recheck.py` re-runs each recent answer's query; when the numbers
  moved, :func:`restate_answer_observation` restates the observation (a new version, the old text
  kept), warranted by a receipt of the re-check run, so "what did we believe on Tuesday" stays
  answerable from the ledger alone.

What is deliberately NOT written: a confidence. ``EvidenceClaim`` carried 0.8 or 0.5 by whether a
phase called itself significant; that number is gone from the model and from this writer. Counted
confidence arrives with P1-4, on read.

Every door here is best-effort by contract — the receipt and the re-check stand without the claim
— and says so through ``tolerate`` rather than failing the answer path.
"""
from __future__ import annotations

import datetime as _dt
import re as _re
from typing import Any, Optional

from pramanyx.record import claims as _claims

#: The kernel artifact kind of a re-check's receipt — the run warrant of a restated observation.
RECHECK_RECEIPT_KIND = "answer_recheck"


def observation_key(connection_id: str, inv_id: str) -> str:
    """The natural key of the observation an answer booked: one per answer, restated in place."""
    return _claims.claim_key("observation", "answer", connection_id, inv_id)


def finding_key(connection_id: str, inv_id: str, evidence_id: str) -> str:
    return _claims.claim_key("finding", "deep", connection_id, inv_id, evidence_id)


def _today() -> str:
    return _dt.datetime.now(_dt.timezone.utc).date().isoformat()


def _author(agent: Optional[dict]) -> tuple[str, str]:
    if agent and agent.get("id"):
        return f"agent:{agent['id']}", "agent"
    return "system", "system"


def _ledger():
    from pramanyx.kernel.ledger import Ledger
    return Ledger.default()


# ── from the Trust Receipt ─────────────────────────────────────────────────────────────────

def _about(connection_id: str, about: Optional[dict]) -> "_claims.About":
    """Arc OC-3 — what the claim is about: the frame's segment or entity when the run had one, else its connection."""
    if about and about.get("kind") in ("segment", "type", "object") and about.get("key"):
        return _claims.About(kind=about["kind"], key=str(about["key"]))
    return _claims.About(kind="connection", key=connection_id)


def _object_set(about: Optional[dict]) -> str:
    about = about or {}
    return str(about.get("object_set") or (about.get("key") if about.get("kind") == "segment" else "") or "")


def book_answer_observation(*, kind: str, natural_key: str, receipt_id: str, connection_id: str,
                            question: str, headline: str, sql: str,
                            metrics_used: Optional[list[str]] = None, agent: Optional[dict] = None,
                            canvas_id: str = "", about: Optional[dict] = None) -> Optional[str]:
    """Book the answer's headline as an observation at tier ``measured``, warranted by its receipt.
    Returns the claim's artifact id, or None when there is nothing to book: no receipt, no query
    behind the headline, or a headline that concluded nothing (the caller passes "" then — the
    same law the graph's finding node enforces)."""
    headline = (headline or "").strip()
    if not (receipt_id and connection_id and sql and headline):
        return None
    inv_id = natural_key.rsplit(":", 1)[-1] if natural_key else ""
    if not inv_id:
        return None
    author, author_kind = _author(agent)
    from pramanyx.kernel.ledger import CHAT_ANSWER_KIND
    next_check = ""
    falsifier = ""
    if kind == CHAT_ANSWER_KIND:
        try:
            from pramanyx.answer import recheck
            if recheck.can_recheck(sql):
                next_check = (_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(days=1)).date().isoformat()
                falsifier = ("the answer's own query, re-run daily for 14 days (the daily re-check): a number "
                             "that moves past the noise band restates this claim")
            else:
                falsifier = ("not re-checked: the query reads the clock, so re-running it measures "
                             "another window")
        except Exception as exc:  # noqa: BLE001 — the falsifier is a note; the claim books without it
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "the claim's falsifier could not be read; the claim books without it", counter="record.falsifier")
    claim = _claims.Claim(
        kind="observation", tier="measured",
        about=_about(connection_id, about),
        statement=_claims.Statement(text=headline[:1000],
                                    metric=(metrics_used or [""])[0] or str((about or {}).get("metric") or ""),
                                    object_set=_object_set(about)),
        status="Provisional", as_of=_today(),
        warrants=[_claims.Warrant(kind="run", ref=receipt_id, detail=sql[:400])],
        falsifier=falsifier, next_check=next_check,
        author=author, author_kind=author_kind,
        extra={"investigation_id": inv_id, "receipt_kind": kind, "question": (question or "")[:500],
               **({"canvas_id": canvas_id} if canvas_id else {}),
               **({"metrics_used": list(metrics_used)} if metrics_used else {})},
    )
    return _claims.book(claim, key=observation_key(connection_id, inv_id), conn_id=connection_id)


def book_deep_findings(*, investigation_id: str, connection_id: str, receipt_id: str,
                       agent: Optional[dict] = None, about: Optional[dict] = None) -> list[str]:
    """Book a deep analysis's findings from the evidence ledger it filled: a finding with its own
    query is ``measured`` on the report's receipt; one without is a ``hypothesis`` at tier
    ``said``, open. Returns the artifact ids booked (restated when the same finding was booked
    before — a partial report followed by the full one)."""
    if not (investigation_id and connection_id and receipt_id):
        return []
    from pramanyx.evidence.store import get_claims_for_investigation
    author, author_kind = _author(agent)
    out: list[str] = []
    for ev in get_claims_for_investigation(investigation_id):
        text = (ev.claim_text or "").strip()
        if not text:
            continue
        common: dict[str, Any] = dict(
            about=_about(connection_id, about),
            statement=_claims.Statement(text=text[:1000],
                                        metric=ev.metric_used or str((about or {}).get("metric") or ""),
                                        object_set=_object_set(about)),
            status="Provisional", as_of=(ev.data_freshness or ev.created_at or "")[:10] or _today(),
            author=author, author_kind=author_kind,
            extra={"investigation_id": investigation_id, "evidence_claim_id": ev.id,
                   **({"phase": ev.hypothesis_id} if ev.hypothesis_id else {})},
        )
        if ev.sql_source:
            claim = _claims.Claim(kind="finding", tier="measured",
                                  warrants=[_claims.Warrant(kind="run", ref=receipt_id,
                                                            detail=ev.sql_source[:400])], **common)
        else:
            common["extra"]["why_hypothesis"] = ("the deep analysis stated it without a query of its "
                                                "own behind it; a run or a person raises it")
            claim = _claims.Claim(kind="hypothesis", tier="said", state="open", **common)
        out.append(_claims.book(claim, key=finding_key(connection_id, investigation_id, ev.id),
                                conn_id=connection_id))
    return out


def book_from_receipt(*, kind: str, natural_key: str, receipt_id: Optional[str], connection_id: str,
                      question: str, headline: str, sql: str, metrics_used: Optional[list[str]] = None,
                      agent: Optional[dict] = None, canvas_id: str = "",
                      payload_extra: Optional[dict] = None) -> dict:
    """The receipt writer's one call: ``{"observation": id|None, "findings": [ids]}``."""
    out: dict[str, Any] = {"observation": None, "findings": []}
    if not receipt_id:
        return out
    extra = payload_extra or {}
    # Arc OC-3 — the subject the run's frame gave it (`framing.frame_about`)
    about = _frame_subject(extra)
    out["observation"] = book_answer_observation(
        kind=kind, natural_key=natural_key, receipt_id=receipt_id, connection_id=connection_id,
        question=question, headline=headline, sql=sql, metrics_used=metrics_used, agent=agent,
        canvas_id=canvas_id, about=about)
    from pramanyx.kernel.ledger import DEEP_REPORT_KIND
    if kind == DEEP_REPORT_KIND and extra.get("investigation_id") and not extra.get("partial"):
        out["findings"] = book_deep_findings(investigation_id=str(extra["investigation_id"]),
                                             connection_id=connection_id, receipt_id=receipt_id,
                                             agent=agent, about=about)
        # the run reached its inquiry before this receipt was written: what it established goes there now
        try:
            from pramanyx.record.inquiry import attach_run_claims
            attach_run_claims(str(extra["investigation_id"]), connection_id,
                              [c for c in [out["observation"], *out["findings"]] if c])
        except Exception as exc:  # noqa: BLE001 — the claims stand in the Record without the inquiry's link
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "the run's claims could not reach its inquiry; they stand in the Record",
                     counter="inquiry.claims", conn_id=connection_id or None)
    return out


def _frame_subject(extra: dict) -> Optional[dict]:
    """The `about` a receipt's caller derived from its run's frame, or None when it derived none."""
    about = extra.get("about")
    if not isinstance(about, dict) or not about:
        return None
    return about


# ── from the daily re-check ───────────────────────────────────────────────────────────────

def restate_answer_observation(answer: dict, entry: dict, *, text: str = "") -> Optional[dict]:
    """A re-check found the answer's numbers moved: restate its observation. The new version carries
    the new statement (``text``, code-written by the re-check), the single changed value when there
    is one, the cause the re-check could tell (late rows · restated · unknown) and a run warrant —
    a receipt of the re-check itself, booked here as a kernel artifact of kind
    :data:`RECHECK_RECEIPT_KIND`, since the re-check ran a query and a measured claim names the run
    that produced it. The earlier version is kept with its text.

    Returns ``{"restated", "superseded", "recheck_receipt"}``, or None when the answer booked no
    observation (it predates the Record, or concluded nothing) — the caller says so on the entry."""
    if entry.get("status") != "changed":
        return None
    conn_id = str(answer.get("connection_id") or "")
    inv_id = str(answer.get("id") or "")
    if not (conn_id and inv_id):
        return None
    key = observation_key(conn_id, inv_id)
    prior = _claims.latest(key)
    if prior is None:
        return None
    sql = str((answer.get("report") or {}).get("sql") or "") or next(
        (w.detail for w in prior.warrants if w.kind == "run"), "")
    first_receipt = next((w.ref for w in prior.warrants if w.kind == "run"), "")
    changes = list(entry.get("changes") or [])
    receipt = _ledger().artifact_write(
        RECHECK_RECEIPT_KIND, f"recheck:{conn_id}:{inv_id}",
        {"investigation_id": inv_id, "sql": sql, "checked_at": entry.get("checked_at", ""),
         "status": entry["status"], "changes": changes[:10], "missing": entry.get("missing") or [],
         "missing_rows": entry.get("missing_rows", 0), "new_rows": entry.get("new_rows", 0),
         "compared": entry.get("compared", 0), "cause": entry.get("cause", "unknown"),
         "lag_days": entry.get("lag_days")},
        conn_id=conn_id,
        lineage=[("source_sql", "sql", sql[:2000])] + (
            [("rechecks", first_receipt, "the receipt of the answer as first given")] if first_receipt else []),
    )
    new = prior.model_copy(deep=True)
    new.confidence = None
    new.statement = _claims.Statement(
        text=(text or _restated_text(prior.statement.text, changes, entry))[:1000],
        metric=prior.statement.metric or (changes[0].get("column", "") if len(changes) == 1 else ""),
        value=float(changes[0]["new"]) if len(changes) == 1 and changes[0].get("new") is not None else None,
        unit=prior.statement.unit)
    new.warrants = [_claims.Warrant(kind="run", ref=receipt, detail=sql[:400])]
    if prior.tier == "approved":
        # A person approved the number they were shown. This is another number: it is measured, and theirs to
        # approve again — an approval is never carried onto a figure its author did not see.
        new.tier = "measured"
    new.as_of = str(entry.get("checked_at") or "")[:10] or _today()
    new.extra = {**{k: v for k, v in prior.extra.items() if k not in ("approved_by", "verdict_id", "approved_on")},
                 **({"approval_lapsed": "the number moved after a person said it was right"} if prior.tier == "approved" else {}),
                 "restated_by": "answers.recheck", "cause": entry.get("cause", "unknown"),
                 "changes": changes[:10], "missing_rows": entry.get("missing_rows", 0),
                 "lag_days": entry.get("lag_days"), "first_receipt": first_receipt}
    if entry.get("status") == "changed" and entry.get("cause") == "late_rows":
        # late rows settle; the next re-check may move it again
        new.status = "Provisional"
    restated = _claims.restate(key, new, conn_id=conn_id)
    # Phase 2 of the 2027 study — an inquiry that established the restated claim wakes, and a
    # decision that relied on it reopens.
    # A source redrawn at each refresh moves every answer at each refresh: that is no news of the business, and would
    # reopen a decision a person had just answered, daily. The restatement stands, and says why nothing followed from it.
    consequences = ({"nothing_followed": "the source rewrites its history at each refresh, so this is no news of the business"}
                    if entry.get("cause") == "rewrites"
                    else _claims.restated_consequences(prior.id, restated, how="restated by the re-check"))
    return {"restated": restated, "superseded": prior.id, "recheck_receipt": receipt, **consequences}


# ── from a pack's map, measured on connect (phase 6) ───────────────────────────────────────

#: A pack's measured tier → the hypothesis state its claim carries in the Record.
PACK_CLAIM_STATE: dict[str, str] = {"expected": "open", "measured-true": "supported", "measured-false": "refuted",
                                    "human": "supported"}


def pack_claim_key(pack_id: str, connection_id: str, schema_name: str, kind: str, subject: str) -> str:
    return _claims.claim_key("pack", pack_id, connection_id, schema_name or "-", kind,
                             "".join(ch if ch.isalnum() else "-" for ch in subject)[:120])


def book_pack_claims(report, *, connection_id: str, schema_name: str = "", fingerprint: str = "") -> dict:
    """The pack writer — the fourth of the study's five claim shapes (§E): every claim in a pack's
    map, evaluated against THIS connection's graph and data (`packs/ontology_map.apply_core_claims`),
    booked into the Record as a HYPOTHESIS the pack made about the business: ``open`` while the data
    cannot speak (tier ``said``), ``supported`` or ``refuted`` once it has (tier ``mined`` — the
    platform's own scan, warranted by the build that measured it), and ``supported`` at tier
    ``declared`` when a person's declaration settled it (an attestation warrant names it). One claim
    per pack · connection · schema · subject, restated on every build, so "what did this pack expect
    of us, and what did the data say" is the Record's to answer on any date. Best-effort by contract.
    Returns ``{"booked", "by_state", "pack"}``."""
    pack_id = str(getattr(report, "pack_id", "") or "")
    claims = list(getattr(report, "claims", None) or [])
    if not (pack_id and connection_id and claims):
        return {"booked": 0, "by_state": {}, "pack": pack_id,
                "note": "nothing to book: no pack, no connection or no claims" if not claims else ""}
    build_ref = f"ontology:{connection_id}:{schema_name or '-'}:{fingerprint or 'build'}"
    by_state: dict[str, int] = {}
    booked = 0
    for c in claims:
        if c.kind == "action":
            # an action the pack SUGGESTS is an offer to the business, not a statement about it (2026-10-10)
            continue
        state = PACK_CLAIM_STATE.get(c.tier, "open")
        measured = f" — measured: {c.measured}" if c.measured else ""
        text = f"{c.kind}: {c.subject} — the pack expects {c.expected}{measured}"
        if c.tier == "human":
            tier, warrants = "declared", [_claims.Warrant(kind="attestation", ref=str(c.measured or "declared"), detail=(c.note or "")[:400])]
        elif c.tier in ("measured-true", "measured-false"):
            tier, warrants = "mined", [_claims.Warrant(kind="run", ref=build_ref, detail=(c.note or "")[:400])]
        else:
            tier, warrants = "said", []
        claim = _claims.Claim(
            kind="hypothesis", tier=tier, about=_claims.About(kind="connection", key=connection_id),
            statement=_claims.Statement(text=text[:1000]), status="Provisional" if state == "open" else "Final",
            as_of=_today(), warrants=warrants, author=f"pack:{pack_id}", author_kind="system", state=state,
            extra={"pack": pack_id, "claim_kind": c.kind, "subject": c.subject, "expected": c.expected, "measured": c.measured,
                   "tier_measured": c.tier, "note": c.note, "schema": schema_name or "", "writer": "pack"},
        )
        try:
            _claims.book(claim, key=pack_claim_key(pack_id, connection_id, schema_name, c.kind, c.subject), conn_id=connection_id)
        except Exception as exc:  # noqa: BLE001 — one claim the door refused does not stop the rest, and is said
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, f"a pack claim could not be booked ({c.kind} {c.subject})", counter="record.pack_claim",
                     conn_id=connection_id)
            continue
        booked += 1
        by_state[state] = by_state.get(state, 0) + 1
    return {"booked": booked, "by_state": by_state, "pack": pack_id}


def pack_claims(connection_id: str, *, pack_id: str = "", limit: int = 500) -> list[_claims.Claim]:
    """What packs expected of this connection and what the data said, as the Record holds it now."""
    return [c for c in _claims.list_claims(kind="hypothesis", conn_id=connection_id, limit=limit)
            if c.extra.get("writer") == "pack" and (not pack_id or c.extra.get("pack") == pack_id)]


# ── the Explorer's finding (the fifth shape's first half) ──────────────────────────────────

def explorer_finding_key(connection_id: str, schema_name: str, finding_id: str) -> str:
    """One claim per connection · schema · finding id. The schema is in the key because per-schema
    runs reuse ids (``pinned__0``, ``<domain>__<angle>__1``) and would otherwise restate each other."""
    return _claims.claim_key("finding", "explorer", connection_id, schema_name or "-", finding_id)


def explorer_finding_claim(connection_id: str, finding_id: str, schema_name: str = "") -> tuple[Optional[_claims.Claim], str]:
    """The Record's claim for an Explorer finding a page holds by its id, as it stands now — or ``(None, why)``.

    A page that lists findings does not always know their schema (Home reads the connection's), so a finding is
    looked up by its key first and, when no schema was given, by its id among the connection's Explorer findings.
    Two schemas holding the same id is said, never picked between (PENDING 57, D-1)."""
    if not (connection_id and finding_id):
        return None, "no finding was named"
    exact = _claims.latest(explorer_finding_key(connection_id, schema_name, finding_id))
    if exact is not None or schema_name:
        return exact, "" if exact is not None else f"the finding {finding_id!r} has no claim in the Record"
    prefix = f"claim:finding:explorer:{connection_id}:"
    matches = [c for c in _claims.list_claims(kind="finding", conn_id=connection_id, limit=5000)
               if c.key.startswith(prefix) and c.key.endswith(f":{finding_id}")]
    if len(matches) == 1:
        return matches[0], ""
    if not matches:
        return None, f"the finding {finding_id!r} has no claim in the Record"
    return None, f"the finding id {finding_id!r} names {len(matches)} findings in different schemas; none was cited"


def book_explorer_finding(*, finding: dict, sql: str, connection_id: str, receipt_id: str,
                          schema_name: str = "", canvas_id: str = "") -> Optional[str]:
    """The explorer writer — the Explorer's finding, the first of the study's five shapes (§E),
    booked at the moment the explorer writes its own ``finding`` artifact (the emission tail in
    `explorer/agent.py`): a FINDING at tier ``measured``, warranted by that artifact — the run that
    produced it, with its SQL, its tables and the numeric-grounding guard that passed it. A finding
    the explorer re-reads unchanged on its next run is left alone (an unchanged finding is not a
    restatement, and a restatement is a Correction); one whose text changed is restated under its
    key, the old version kept. What is deliberately not copied: the explorer's own ``confidence``
    and ``novelty`` numbers — law 3 — and an ``unverified`` finding a person wrote by hand
    (`explorer/fix_persist`) never reaches this writer, so it books nothing.
    Returns the claim's artifact id, or None when there is nothing to book."""
    text = str((finding or {}).get("finding") or "").strip()
    fid = str((finding or {}).get("id") or "")
    if not (text and fid and sql and connection_id and receipt_id) or finding.get("unverified") or finding.get("invalid"):
        return None
    key = explorer_finding_key(connection_id, schema_name, fid)
    prior = _claims.latest(key)
    if prior is not None and prior.statement.text == text[:1000] and prior.state != "withdrawn":
        return prior.id
    measures = [str(m) for m in (finding.get("measures") or [])][:8]
    claim = _claims.Claim(
        kind="finding", tier="measured",
        about=_claims.About(kind="connection", key=connection_id),
        statement=_claims.Statement(text=text[:1000], metric=measures[0] if len(measures) == 1 else ""),
        status="Provisional", as_of=str(finding.get("generated_at") or "")[:10] or _today(),
        warrants=[_claims.Warrant(kind="run", ref=receipt_id, detail=sql[:400])],
        falsifier="the finding's own query, re-run before a Briefing (the live re-validation) and on a person's "
                  "re-check from the Evidence drawer; a number that no longer holds withdraws this claim",
        author="agent:explorer", author_kind="agent",
        extra={"writer": "explorer", "finding_id": fid, "domain": str(finding.get("domain") or ""),
               "angle": str(finding.get("angle") or ""), "measures": measures,
               "dimensions": [str(d) for d in (finding.get("dimensions") or [])][:8],
               "entities": [str(e) for e in (finding.get("entities_involved") or [])][:8],
               "schema": schema_name or "", **({"canvas_id": canvas_id} if canvas_id else {}),
               **({"pinned": True} if finding.get("pinned") else {}),
               **({"synthesized": True} if finding.get("synthesized") else {})},
    )
    return _claims.book(claim, key=key, conn_id=connection_id)


def confirmed_explorer_findings(connection_id: str) -> set[str]:
    """The ids of the explorer's findings on this connection that a person has confirmed — their claim stands at a
    person's tier, not withdrawn. The user, 2026-11-17: a finding reaches an answer only once a person confirmed it, on
    every answer path (the graph slice already held to that since 11-13; the quick answer's "what the platform already
    knows" and the exploration annotations did not)."""
    if not connection_id:
        return set()
    out: set[str] = set()
    for c in _claims.list_claims(kind="finding", conn_id=connection_id, limit=5000):
        if c.extra.get("writer") == "explorer" and c.tier in ("approved", "declared") and c.state != "withdrawn":
            fid = str(c.extra.get("finding_id") or "")
            if fid:
                out.add(fid)
    return out


def withdraw_explorer_finding(*, connection_id: str, finding_id: str, reason: str,
                              schema_name: str = "", by: str = "system") -> Optional[str]:
    """A finding the re-validation found no longer holds, or a person dismissed, is WITHDRAWN in the
    Record: restated with ``state="withdrawn"``, ``valid_until`` today and the reason, the measured
    version kept beneath it — so the Corrections view lists it and "what did we believe" still
    answers. Returns the new version's id, or None when the finding was never booked or is already
    withdrawn."""
    key = explorer_finding_key(connection_id, schema_name, finding_id)
    prior = _claims.latest(key)
    if prior is None or prior.state == "withdrawn":
        return None
    new = prior.model_copy(deep=True)
    new.confidence = None
    new.state = "withdrawn"
    new.valid_until = _today()
    new.status = "Final"
    new.statement = _claims.Statement(text=f"Withdrawn: {prior.statement.text}"[:1000], metric=prior.statement.metric,
                                      value=prior.statement.value, unit=prior.statement.unit)
    new.extra = {**prior.extra, "withdrawn_reason": (reason or "")[:400], "withdrawn_by": by or "system"}
    return _claims.restate(key, new, conn_id=connection_id)


# ── a person's word on an answer (the confirmation loop) ───────────────────────────────────

def answer_claims(connection_id: str, inv_id: str) -> list[_claims.Claim]:
    """Every current claim one answer booked: a quick answer's observation, and a deep analysis's findings and
    hypotheses. Found by the keys the writers above give them — the investigation id is in each."""
    if not (connection_id and inv_id):
        return []
    out: list[_claims.Claim] = []
    one = _claims.latest(observation_key(connection_id, inv_id))
    if one is not None:
        out.append(one)
    deep = _claims.claim_key("finding", "deep", connection_id, inv_id, "")
    for kind in ("finding", "hypothesis"):
        for c in _claims.list_claims(kind=kind, conn_id=connection_id, limit=2000):
            if c.key.startswith(deep) and str(c.extra.get("investigation_id") or "") == inv_id:
                out.append(c)
    return out


def approve_answer_claims(*, connection_id: str, inv_id: str, verdict_id: Any, by: str = "") -> list[str]:
    """A person said an answer was right: each MEASURED claim it booked is restated at tier ``approved``, its run
    warrant kept and an attestation added that names the verdict — the tier a person's word carries, and the one
    the graph shows the planner as ground (`ontology/context_graph_readback.py` shows only what a person stands
    behind). Until this existed nothing a person did raised a claim, so nothing learned was ever shown.

    The statement is unchanged, so it is no Correction. A hypothesis is not raised (nothing was measured), nor a
    claim already a person's or withdrawn. Returns the new versions' ids."""
    done: list[str] = []
    for prior in answer_claims(connection_id, inv_id):
        if prior.tier != "measured" or prior.state == "withdrawn":
            continue
        new = prior.model_copy(deep=True)
        new.confidence = None
        new.tier = "approved"
        new.warrants = [*prior.warrants, _claims.Warrant(
            kind="attestation", ref=f"verdict:{verdict_id}",
            detail=f"said to be right by {by}" if by else "said to be right by a person")]
        new.extra = {**prior.extra, "approved_by": by or "a person", "verdict_id": verdict_id,
                     "approved_on": _today()}
        done.append(_claims.restate(prior.key, new, conn_id=connection_id))
    return done


def withdraw_answer_claims(*, connection_id: str, inv_id: str, reason: str, verdict_id: Any,
                           by: str = "") -> list[str]:
    """A person said an answer was wrong: each claim it booked is WITHDRAWN — restated ``state="withdrawn"`` with the
    reason, the earlier version kept beneath it, as `withdraw_explorer_finding` withdraws a finding. Never deleted:
    "what did we believe" still answers, and the Corrections view lists it. Returns the new versions' ids."""
    done: list[str] = []
    for prior in answer_claims(connection_id, inv_id):
        if prior.state == "withdrawn":
            continue
        new = prior.model_copy(deep=True)
        new.confidence = None
        new.state = "withdrawn"
        new.valid_until = _today()
        new.status = "Final"
        new.statement = _claims.Statement(text=f"Withdrawn: {prior.statement.text}"[:1000], metric=prior.statement.metric,
                                          value=prior.statement.value, unit=prior.statement.unit)
        new.extra = {**prior.extra, "withdrawn_reason": (reason or "a person said the answer was wrong")[:400],
                     "withdrawn_by": by or "a person", "verdict_id": verdict_id}
        done.append(_claims.restate(prior.key, new, conn_id=connection_id))
    return done


# ── usage: what a warehouse's own query history shows (the user, 2026-11-14) ──────────────────────────────────

_USAGE_SAYS = {
    "join": "People join {subject} this way in their own queries: {proposal}",
    "filter": "People repeatedly filter {subject} by: {proposal}",
    "measure": "People compute this over {subject} in their own queries: {proposal}",
    "synonym": "People's queries use this name for {subject}: {proposal}",
    "object_set": "People's queries single out this set of {subject}: {proposal}",
}


def book_usage_claims(*, connection_id: str, candidates, source: str = "", schema_name: str = "",
                      came_from: str = "") -> dict:
    """The candidates mined from a warehouse's query history and checked to bind, booked as Record claims of kind
    ``usage`` at tier ``mined``, each warranted by the history it came from ("query history findings to become record
    claims only"). Booked once: a candidate already on record with the same words is left as it is, so a second mining
    restates nothing. ``came_from`` (the Atlas plan's A7): the statements were not the warehouse's history but the
    platform's own work or the SQL answers ran — said as the claim's author and kept on it, so the learned list says
    where it came from. Returns ``{"booked": [...ids], "already": n}``."""
    import hashlib
    booked: list[str] = []
    already = 0
    for c in candidates:
        proposal, subject = str(c.proposal).strip(), str(c.subject).strip()
        digest = hashlib.sha256(f"{c.kind}|{subject}|{proposal}".encode()).hexdigest()
        key = _claims.claim_key("usage", connection_id, c.kind, digest[:16])
        text = _USAGE_SAYS.get(c.kind, "People's queries show: {proposal}").format(subject=subject, proposal=proposal)[:1000]
        prior = _claims.latest(key)
        if prior is not None and prior.state != "withdrawn" and prior.statement.text == text:
            already += 1
            continue
        claim = _claims.Claim(
            kind="usage", tier="mined", status="Provisional", as_of=_today(),
            about=_claims.About(kind="connection", key=connection_id),
            statement=_claims.Statement(text=text),
            warrants=[_claims.Warrant(kind="query_history", ref=f"history:{connection_id}:{source or 'warehouse'}:{digest[:16]}",
                                      detail=str(c.evidence or "")[:400], content_hash=digest)],
            author=came_from or "query history", author_kind="system",
            extra={"candidate_kind": c.kind, "subject": subject, "proposal": proposal,
                   **({"schema": schema_name} if schema_name else {}), **({"came_from": came_from} if came_from else {})},
        )
        booked.append(_claims.restate(key, claim, conn_id=connection_id) if prior else
                      _claims.book(claim, key=key, conn_id=connection_id))
    return {"booked": booked, "already": already}


def usage_for(connection_id: str, *, question: str = "", sql: str = "", limit: int = 4) -> list[_claims.Claim]:
    """The usage claims that bear on a question or the statement written for it — those about a table the statement
    reads, or naming a word of the question. For the ONE place they are referred to: an answer that came out
    inconclusive, as a pointer to how people query this data, never as ground ("only to be referred when
    investigation is non-conclusive")."""
    import re
    words = {w for w in re.findall(r"[a-z0-9_]{3,}", f"{question} {sql}".lower())}
    if not words:
        return []
    scored = []
    for c in _claims.list_claims(kind="usage", conn_id=connection_id, limit=500):
        if c.state == "withdrawn":
            continue
        about = {w for w in re.findall(r"[a-z0-9_]{3,}", f"{c.extra.get('subject', '')} {c.extra.get('proposal', '')}".lower())}
        hit = len(words & about)
        if hit:
            scored.append((hit, c))
    scored.sort(key=lambda x: -x[0])
    return [c for _, c in scored[:limit]]


# ── a Definition: what a business word means, written by a person and approved ────────────

def definition_term(term: str) -> str:
    """The word as a key: case, spacing and punctuation are not a different word."""
    import re
    return re.sub(r"[^a-z0-9]+", "-", (term or "").strip().lower()).strip("-")[:80]


def definition_key(connection_id: str, term: str, area: str = "") -> str:
    """One Definition per word per AREA on a connection (2026-11-17, the ontology study: a governed definition's name is
    unique within its area, so one word can mean one thing to Finance and another to Marketing — "area" is the glossary's
    word for a part of the business, `docs/GLOSSARY.md`). A word with no area keeps the key it always had."""
    parts = [connection_id or "-", definition_term(term)]
    if definition_term(area):
        parts.append("in-" + definition_term(area))
    return _claims.claim_key("definition", *parts)


#: What a Definition may link to — its related assets: every kind Discover lists (2026-11-23, the Page editor: "Add
#: related asset" picks any thing a person may open), a person, or a web address — and how many synonyms, links and
#: sources it carries.
LINK_KINDS = ("table", "metric", "definition", "dashboard", "document", "person", "url",
              "canvas", "agent", "schedule", "sheet", "trusted_query")
#: Where a Definition's words come from: a web address or a document of the corpus.
SOURCE_KINDS = ("url", "document")
MAX_SYNONYMS = 50
MAX_LINKS = 30
MAX_SOURCES = 20
#: A Definition's short description — the line under its name, apart from what it means.
MAX_DESCRIPTION = 400


class NotTheOwner(PermissionError):
    """Only a definition's owner publishes it, edits it directly, or decides on a suggested edit."""


def _clean_aliases(aliases: Optional[list[str]]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for a in aliases or []:
        a = str(a or "").strip()[:120]
        if a and a.lower() not in seen:
            seen.add(a.lower())
            out.append(a)
    return out[:MAX_SYNONYMS]


def _clean_links(links: Optional[list[dict]]) -> list[dict]:
    out: list[dict] = []
    for link in links or []:
        if not isinstance(link, dict):
            continue
        kind, ref = str(link.get("kind") or "").strip().lower(), str(link.get("ref") or "").strip()[:300]
        if kind not in LINK_KINDS:
            raise ValueError(f"a definition links to a {', '.join(LINK_KINDS)}; not a {kind or 'nothing'}")
        href = str(link.get("href") or "").strip()[:400]
        if ref and not any(o["kind"] == kind and o["ref"] == ref for o in out):
            out.append({"kind": kind, "ref": ref, "label": str(link.get("label") or "").strip()[:120],
                        # where it opens inside the app (Discover's own address for it); nothing else is kept as one
                        **({"href": href} if href.startswith("/?tab=") else {})})
    return out[:MAX_LINKS]


def _clean_sources(sources: Optional[list[dict]]) -> list[dict]:
    out: list[dict] = []
    for src in sources or []:
        if not isinstance(src, dict):
            continue
        kind, ref = str(src.get("kind") or "").strip().lower(), str(src.get("ref") or "").strip()[:400]
        if kind not in SOURCE_KINDS:
            raise ValueError(f"a definition's source is a {' or a '.join(SOURCE_KINDS)}; not a {kind or 'nothing'}")
        if kind == "url" and not ref.lower().startswith(("http://", "https://")):
            raise ValueError("a web source is an address that begins http:// or https://")
        if ref and not any(o["kind"] == kind and o["ref"] == ref for o in out):
            out.append({"kind": kind, "ref": ref, "label": str(src.get("label") or "").strip()[:160]})
    return out[:MAX_SOURCES]


#: A picture in a Definition's words (2026-11-24): Markdown's ``![words](path)``, the path one of its connection's uploads.
_PICTURE = _re.compile(r"!\[[^\]]*\]\(([^)\s]*)\)")
_KEPT_PICTURE = _re.compile(r"^/dashboards/images/([A-Za-z0-9_.%-]+)\?connection_id=([A-Za-z0-9_.%-]+)$")


def _check_pictures(connection_id: str, text: str) -> None:
    """Every picture a Definition shows is one uploaded to its own connection's image store: an address anywhere else
    would tell that host who reads the page, and another connection's picture is not this page's to show. Raises
    ``ValueError`` naming the first that is not."""
    from urllib.parse import unquote
    for src in _PICTURE.findall(text or ""):
        kept = _KEPT_PICTURE.match(src)
        if not kept or unquote(kept.group(2)) != connection_id:
            raise ValueError(f"a definition shows pictures uploaded to its own connection; not {src[:80] or 'an empty one'}")
        from pramanyx.dashboards.images import stamp_of
        if stamp_of(connection_id, unquote(kept.group(1))) is None:
            raise ValueError(f"the picture {unquote(kept.group(1))} is not one uploaded to this connection, or it is gone")


def _clean_description(description: Optional[str]) -> str:
    return " ".join(str(description or "").split())[:MAX_DESCRIPTION]


def _same(a: str, b: str) -> bool:
    return (a or "").strip().lower() == (b or "").strip().lower()


def write_definition(*, connection_id: str, term: str, text: str, by: str,
                     aliases: Optional[list[str]] = None, kind: str = "", entry_id: str = "",
                     by_person: bool = True, area: str = "", links: Optional[list[dict]] = None,
                     description: Optional[str] = None, sources: Optional[list[dict]] = None) -> str:
    """A person writes what a business word means on a connection, in a area: a Record claim of kind ``definition``.

    - A word nobody has defined in that area is a DRAFT (tier ``declared``), the writer its owner.
    - Its OWNER changes it directly; a published one stays published — the owner read the words they wrote.
    - Anyone else's change is refused here (`NotTheOwner`): it is a suggested edit (`suggest_definition_edit`), and the
      published wording stands until the owner accepts it. Until 2026-11-17 anyone's new wording replaced the owner's
      approved one at once, unapproved, and the planner lost the approved definition.

    Written by no person (a migration), it is what was said, not what anyone declared."""
    term, text, area = (term or "").strip(), (text or "").strip(), (area or "").strip()
    if not (term and text and by):
        raise ValueError("a definition names its word, says what it means, and is a person's")
    _check_pictures(connection_id, text)
    key = definition_key(connection_id, term, area)
    prior = _claims.latest(key)
    live = prior if prior is not None and prior.state != "withdrawn" else None   # a withdrawn word is written anew
    if live is not None and live.owner and by_person and not _same(live.owner, by):
        raise NotTheOwner(f"this definition is {live.owner}'s; a change from anyone else is a suggested edit")
    published = live is not None and live.tier == "approved"
    tier = ("approved" if published else "declared") if by_person else "said"
    extra = {**(live.extra if live else {}),
             "term": term[:120], "area": area[:120],
             "aliases": _clean_aliases(aliases if aliases is not None else (live.extra.get("aliases") if live else [])),
             "links": _clean_links(links if links is not None else (live.extra.get("links") if live else [])),
             "description": _clean_description(description if description is not None
                                               else (live.extra.get("description") if live else "")),
             "sources": _clean_sources(sources if sources is not None else (live.extra.get("sources") if live else [])),
             **({"kb_kind": kind} if kind else {}), **({"entry_id": entry_id} if entry_id else {})}
    warrants = list(live.warrants) if published else []
    if published:
        extra.update(approved_by=by, approved_on=_today())
        warrants.append(_claims.Warrant(kind="attestation", ref=f"approval:{by}",
                                        detail=f"edited and kept published by its owner, {by}, on {_today()}"))
    claim = _claims.Claim(
        kind="definition", tier=tier, status="Final", as_of=_today(),
        about=_claims.About(kind="connection", key=connection_id),
        statement=_claims.Statement(text=text[:4000]),
        owner=(live.owner if live and live.owner else (by if by_person else "")), author=by,
        author_kind="person" if by_person else "system", warrants=warrants, extra=extra,
    )
    return _claims.restate(key, claim, conn_id=connection_id) if prior else \
        _claims.book(claim, key=key, conn_id=connection_id)


def suggest_definition_edit(*, connection_id: str, term: str, by: str, area: str = "", text: str = "",
                            aliases: Optional[list[str]] = None, links: Optional[list[dict]] = None, why: str = "",
                            by_agent: bool = False, description: Optional[str] = None,
                            sources: Optional[list[dict]] = None) -> dict:
    """Anyone suggests an edit to a Definition (the user, 2026-11-17: "anyone drafts or suggests; only the owner
    publishes"). The suggestion rides on the Definition, pending; the wording it would change stands until its owner
    accepts it. ``by_agent`` marks one an agent drafted for ``by``: it is said as such, and decided like any other.
    Returns the suggestion."""
    import uuid as _uuid
    if not by:
        raise ValueError("a suggestion says whose it is")
    key = definition_key(connection_id, term, area)
    prior = _claims.latest(key)
    if prior is None or prior.state == "withdrawn":
        raise ValueError("there is no such definition to suggest an edit to; write it instead")
    if not ((text or "").strip() or aliases is not None or links is not None or description is not None
            or sources is not None):
        raise ValueError("a suggestion changes the wording, the other names, the description, the links or the sources")
    _check_pictures(connection_id, text)
    suggestion = {"id": _uuid.uuid4().hex[:10], "by": by, "at": _today(), "why": (why or "").strip()[:400],
                  "by_agent": bool(by_agent),
                  **({"text": text.strip()[:4000]} if (text or "").strip() else {}),
                  **({"aliases": _clean_aliases(aliases)} if aliases is not None else {}),
                  **({"links": _clean_links(links)} if links is not None else {}),
                  **({"description": _clean_description(description)} if description is not None else {}),
                  **({"sources": _clean_sources(sources)} if sources is not None else {})}
    new = prior.model_copy(deep=True)
    new.confidence = None
    new.extra = {**prior.extra, "suggestions": [*(prior.extra.get("suggestions") or []), suggestion][-20:]}
    _claims.restate(key, new, conn_id=connection_id)
    return suggestion


def draft_definition_for(*, connection_id: str, term: str, text: str, person: str, area: str = "",
                         aliases: Optional[list[str]] = None, links: Optional[list[dict]] = None, why: str = "") -> dict:
    """An agent drafts what a word means FOR a person — "remember that active means paid in 30 days" (the ontology
    study, Phase 2, 2026-11-17). Never a person's word: a word nobody has defined in that area becomes a draft at tier
    ``said``, owned by the person it was drafted for, who reads it and publishes it themselves; a word already defined
    becomes a suggested edit, marked as the agent's, for its owner. Returns ``{"made": "draft" | "suggestion", ...}``."""
    term, text, person = (term or "").strip(), (text or "").strip(), (person or "").strip()
    if not (term and text and person):
        raise ValueError("a drafted definition names its word, says what it means, and whom it was drafted for")
    key = definition_key(connection_id, term, area)
    prior = _claims.latest(key)
    if prior is not None and prior.state != "withdrawn":
        return {"made": "suggestion", "owner": prior.owner,
                "suggestion": suggest_definition_edit(connection_id=connection_id, term=term, area=area, by=person,
                                                      text=text, aliases=aliases, links=links, why=why, by_agent=True)}
    claim = _claims.Claim(
        kind="definition", tier="said", status="Final", as_of=_today(),
        about=_claims.About(kind="connection", key=connection_id),
        statement=_claims.Statement(text=text[:4000]),
        owner=person, author="agent:coworker", author_kind="agent",
        extra={"term": term[:120], "area": area[:120], "aliases": _clean_aliases(aliases), "links": _clean_links(links),
               "drafted_by_agent": True, "drafted_for": person, **({"why": why[:400]} if why else {})},
    )
    cid = _claims.restate(key, claim, conn_id=connection_id) if prior else _claims.book(claim, key=key, conn_id=connection_id)
    return {"made": "draft", "owner": person, "claim_id": cid}


def decide_definition_suggestion(*, connection_id: str, term: str, suggestion_id: str, by: str, accept: bool,
                                 area: str = "", why: str = "") -> str:
    """Its OWNER accepts or declines a suggested edit. Accepted, the edit is applied as the owner's own (a published
    definition stays published: the owner read the words). Declined, it is kept beside the definition as declined.
    Returns the new version's id."""
    key = definition_key(connection_id, term, area)
    prior = _claims.latest(key)
    if prior is None or prior.state == "withdrawn":
        raise ValueError("there is no such definition")
    if not _same(prior.owner, by):
        raise NotTheOwner(f"only its owner, {prior.owner or 'no one named'}, decides on a suggested edit")
    pending = list(prior.extra.get("suggestions") or [])
    found = next((s for s in pending if s.get("id") == suggestion_id), None)
    if found is None:
        raise ValueError("no such pending suggestion")
    rest = [s for s in pending if s.get("id") != suggestion_id]
    if not accept:
        new = prior.model_copy(deep=True)
        new.confidence = None
        new.extra = {**prior.extra, "suggestions": rest,
                     "declined": [*(prior.extra.get("declined") or []),
                                  {**found, "declined_by": by, "declined_on": _today(), "declined_why": why[:400]}][-20:]}
        return _claims.restate(key, new, conn_id=connection_id)
    cid = write_definition(connection_id=connection_id, term=prior.extra.get("term", term), area=area,
                           text=found.get("text") or prior.statement.text, by=by,
                           aliases=found.get("aliases") if "aliases" in found else None,
                           links=found.get("links") if "links" in found else None,
                           description=found.get("description") if "description" in found else None,
                           sources=found.get("sources") if "sources" in found else None)
    now = _claims.latest(key)
    new = now.model_copy(deep=True)
    new.confidence = None
    new.extra = {**now.extra, "suggestions": rest,
                 "accepted": [*(now.extra.get("accepted") or []), {**found, "accepted_by": by, "accepted_on": _today()}][-20:]}
    return _claims.restate(key, new, conn_id=connection_id) if cid else cid


def approve_definition(*, connection_id: str, term: str, by: str, area: str = "") -> Optional[str]:
    """Its OWNER publishes a definition as written (the user, 2026-11-14: "Definition can be approved by the owner
    only"; publishing it): restated at tier ``approved``, its words unchanged, with an attestation naming who
    approved it and when. Raises `NotTheOwner` for anyone else. None when there is no such definition, or it already
    stands published."""
    key = definition_key(connection_id, term, area)
    prior = _claims.latest(key)
    if prior is None or prior.tier == "approved" or not by or prior.state == "withdrawn":
        return None
    if not _same(prior.owner, by):
        raise NotTheOwner(f"only its owner, {prior.owner or 'no one named'}, approves this definition")
    new = prior.model_copy(deep=True)
    new.confidence = None
    new.tier = "approved"
    new.warrants = [*prior.warrants, _claims.Warrant(kind="attestation", ref=f"approval:{by}",
                                                     detail=f"approved as written by {by} on {_today()}")]
    new.extra = {**prior.extra, "approved_by": by, "approved_on": _today()}
    return _claims.restate(key, new, conn_id=connection_id)


def unpublish_definition(*, connection_id: str, term: str, by: str, area: str = "") -> Optional[str]:
    """Its OWNER takes a published definition back to a draft: the planner is told it is not yet approved."""
    key = definition_key(connection_id, term, area)
    prior = _claims.latest(key)
    if prior is None or prior.tier != "approved" or prior.state == "withdrawn":
        return None
    if not _same(prior.owner, by):
        raise NotTheOwner(f"only its owner, {prior.owner or 'no one named'}, unpublishes this definition")
    new = prior.model_copy(deep=True)
    new.confidence = None
    new.tier = "declared"
    new.extra = {**prior.extra, "unpublished_by": by, "unpublished_on": _today()}
    return _claims.restate(key, new, conn_id=connection_id)


def _a_person(who: str) -> bool:
    who = (who or "").strip()
    return bool(who) and who not in ("unidentified", "model") and not who.startswith(("agent:", "system"))


def hand_definition(*, connection_id: str, term: str, by: str, to: str, area: str = "",
                    by_admin: bool = False) -> Optional[str]:
    """Its OWNER hands a Definition to another person (2026-11-24, the Page editor's owner handover), who answers for it
    from then on: edits it directly, publishes or unpublishes it, decides its suggested edits. An organisation's admin
    may hand on one whose owner cannot (``by_admin``: someone who left). Restated with the new owner; its words and
    whether it stands published are unchanged — the approval it carries still names who approved it — and the hand-over
    is kept on it (``handed``: when, by whom, from whom, to whom). Raises `NotTheOwner` for anyone else, ``ValueError``
    for an owner who is not a person: a Definition is a person's. None when there is no such Definition, or it is
    already theirs."""
    to = (to or "").strip()[:200]
    if not _a_person(to):
        raise ValueError("a definition is handed to a person; an agent cannot own one")
    key = definition_key(connection_id, term, area)
    prior = _claims.latest(key)
    if prior is None or prior.state == "withdrawn" or not by:
        return None
    if not by_admin and not _same(prior.owner, by):
        raise NotTheOwner(f"only its owner, {prior.owner or 'no one named'}, hands this definition on")
    if _same(prior.owner, to):
        return None
    new = prior.model_copy(deep=True)
    new.confidence = None
    new.owner = to
    new.extra = {**prior.extra, "handed": [*(prior.extra.get("handed") or []),
                                           {"on": _today(), "by": by, "from": prior.owner, "to": to}]}
    cid = _claims.restate(key, new, conn_id=connection_id)
    _journal_handed(connection_id, term, area, prior.owner, to, by)
    return cid


def _journal_handed(connection_id: str, term: str, area: str, was: str, to: str, by: str) -> None:
    """Who answers for a Definition changed: a governance change, said in the audit log. Best effort: the Record holds
    the hand-over (``handed``) and has it; an unrecorded event is said, never undone."""
    try:
        from pramanyx.kernel.ledger import Ledger
        Ledger.default().emit("definition.handed", {"connection_id": connection_id, "term": term, "area": area,
                                                    "from": was, "to": to, "by": by})
    except Exception as exc:  # noqa: BLE001 — see the docstring
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, f"the definition {term} was handed to {to} but not journalled", counter="definitions.journal")


def withdraw_definition(*, connection_id: str, term: str, by: str, reason: str = "", area: str = "",
                        by_platform: bool = False) -> Optional[str]:
    """A definition taken away is WITHDRAWN, its wording kept beneath it — never deleted. Its OWNER takes it away
    (2026-11-17); the platform does when its connection is removed (``by_platform``)."""
    key = definition_key(connection_id, term, area)
    prior = _claims.latest(key)
    if prior is None or prior.state == "withdrawn":
        return None
    if not by_platform and prior.owner and not _same(prior.owner, by):
        raise NotTheOwner(f"only its owner, {prior.owner}, takes this definition away")
    new = prior.model_copy(deep=True)
    new.confidence = None
    new.state = "withdrawn"
    new.valid_until = _today()
    new.extra = {**prior.extra, "withdrawn_by": by or "a person", "withdrawn_reason": (reason or "")[:400]}
    return _claims.restate(key, new, conn_id=connection_id)


def definitions_of(connection_id: str, term: str) -> list[_claims.Claim]:
    """Every current definition of one word on a connection, one per area it is defined in."""
    slug = definition_term(term)
    return [c for c in definitions(connection_id) if definition_term(c.extra.get("term", "")) == slug]


def definitions(connection_id: str, *, limit: int = 500) -> list[_claims.Claim]:
    """The current definitions on a connection (and every connection's, for ``"-"``)."""
    return [c for c in _claims.list_claims(kind="definition", conn_id=connection_id or None, limit=limit)
            if c.state != "withdrawn"]


# ── the hub's ClaimCheck (the fifth shape's second half) ────────────────────────────────────

def said_claim_key(connection_id: str, object_ref: str, reply_id: str) -> str:
    """One claim per reply, never per object: a second reply on the same object is its own claim."""
    return _claims.claim_key("said", "hub", connection_id or "-",
                             "".join(ch if ch.isalnum() else "-" for ch in object_ref)[:120], reply_id)


def reply_id_for(*, reply_ts: str, author_ref: str, author: str, text: str) -> str:
    """The reply's own id when the bot sent it; else a hash of who said what — the same words by the
    same person are the same statement, a different reply is a different claim."""
    if reply_ts:
        return reply_ts.replace(".", "-")
    import hashlib
    return hashlib.sha1(f"{author_ref or author}|{text}".encode("utf-8")).hexdigest()[:12]


#: The hub's verification word → the claim's state.
SAID_CLAIM_STATE: dict[str, str] = {"measured": "supported", "contradicted": "refuted", "unchecked": "open"}


def book_said_claim(*, text: str, object_ref: str, connection_id: str, reply_id: str, check: dict,
                    author: str, author_ref: str = "", thread_ref: str = "", observed_at: str = "") -> Optional[str]:
    """The hub writer — the hub's ``ClaimCheck``, the last of the study's five shapes (§E): what a
    person said in a filed thread, booked as a SAID claim at tier ``said`` about the object the
    thread was filed on, with the check's verdict as its state (``supported`` when the data the
    thread was filed with agreed, ``refuted`` when it contradicted, ``open`` when nothing could be
    checked) and the measures it was checked against as a document warrant — the filing's snapshot,
    never a run, so the tier stays ``said``: the check is against a stamped reading, not a query.
    One claim per reply (`said_claim_key`), so a second reply on the same object is counted beside
    the first, not over it. Returns the artifact id, or None when there is no text or object."""
    text = (text or "").strip()
    if not (text and object_ref and reply_id):
        return None
    check = dict(check or {})
    verification = str(check.get("verification") or "unchecked")
    state = SAID_CLAIM_STATE.get(verification, "open")
    against = {k: v for k, v in (check.get("against") or {}).items() if isinstance(v, (int, float))}
    # where it was said: the thread and the reply, the hash of the words read (the evidence envelope, study §3.2)
    warrants = [_claims.said_warrant("conversation", f"slack:{thread_ref or object_ref}:{reply_id}", text,
                                     detail="said in a Slack thread")]
    if verification in ("measured", "contradicted") and thread_ref:
        warrants.append(_claims.Warrant(kind="document", ref=f"thread:{thread_ref}",
                                        detail=("checked against the measures the thread was filed with: "
                                                + ", ".join(f"{k}={v}" for k, v in list(against.items())[:6]))[:400]))
    claim = _claims.Claim(
        kind="said", tier="said", about=_claims.About(kind="object", key=object_ref),
        statement=_claims.Statement(text=text[:1000], metric=str((check.get("matched") or {}).get("label") or ""),
                                    value=(check.get("matched") or {}).get("value")),
        status="Provisional" if state == "open" else "Final",
        as_of=(observed_at or "")[:10] or _today(), warrants=warrants,
        author=author_ref or f"person:{author or 'someone'}", author_kind="person", state=state,
        extra={"writer": "hub", "verification": verification, "said": list(check.get("said") or [])[:8],
               "against": against, "matched": check.get("matched") or {}, "question": str(check.get("question") or ""),
               "question_to": str(check.get("question_to") or ""), "check_note": str(check.get("note") or ""),
               "thread": thread_ref, "reply_id": reply_id, "author_name": author or ""},
    )
    return _claims.book(claim, key=said_claim_key(connection_id, object_ref, reply_id), conn_id=connection_id or None)


def _restated_text(first: str, changes: list[dict], entry: dict) -> str:
    """A fallback statement when the re-check hands none: the numbers, then what was first said."""
    def what(c: dict) -> str:
        label = ", ".join(str(v) for v in (c.get("label") or {}).values() if v not in (None, ""))
        return f"{c.get('column', 'value')} for {label}" if label else str(c.get("column", "value"))
    parts = [f"{what(c)} is now {c.get('new')} (we said {c.get('old')})" for c in changes[:3]]
    if len(changes) > 3:
        parts.append(f"{len(changes) - 3} more changed")
    gone = int(entry.get("missing_rows") or 0)
    if gone:
        parts.append(f"{gone} row{'s' if gone != 1 else ''} no longer returned")
    return f"Restated: {'; '.join(parts)}. First said: {first}"
