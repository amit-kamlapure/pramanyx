"""Investigations — chat, investigate, HITL feedback, history, outcomes, reindex."""
from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import os
import re
import sys
import threading
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Callable, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from pramanyx.agent.chart_vocab import answer_chart_payload
from pramanyx.agent.state import AgentState
from pramanyx.canvas.scope import held_to_its_canvas
from pramanyx.db.connection import open_connection_for
from pramanyx.kernel.concurrency import ContextThreadPoolExecutor
from pramanyx.db.history import (
    complete_investigation,
    create_investigation,
    fail_investigation,
    get_investigation,
    get_session_turns,
    list_investigations,
    pause_investigation,
    save_chat_turn,
)
from pramanyx.db.registry import BUILTIN_ID
from pramanyx.security.authz import get_principal
from pramanyx.routers._shared import (
    explorers_for_connection as _explorers_for_connection,
    get_schema_cached as _get_schema_cached,
)
from pramanyx.security.authz import connection_owner_guard, investigation_owner_guard

logger = logging.getLogger(__name__)
from pramanyx.licensing import Capability, gate

#: DATA-06 — every connection a door of this router names belongs to the caller's org (identity on).
#: SEC-05 — and every investigation one addresses by `inv_id` is the caller's org's (2026-11-08).
router = APIRouter(tags=["investigations"],
                   dependencies=[Depends(connection_owner_guard), Depends(investigation_owner_guard)])


def _record_memory(inv_id: str, connection_id: str, question: str, state: dict) -> None:
    """Persist this run's reflection signals (confidence/surprise/plausibility/
    pitfalls) into the unified agent memory.  Best-effort: never breaks the stream."""
    try:
        from pramanyx.memory import record_run
        record_run(inv_id, connection_id, question, state)
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "run-reflection memory record is best-effort; the investigation result is already delivered",
                 counter="investigation.memory_record")
    # Graduated skill promotion: once a connection has EARNED L2 trust, a
    # high-confidence, grounded, read-only run auto-crystallizes into a reusable
    # learned skill — stored under the exact graph.schema_name the planner reads
    # from, gated by a read-only EXPLAIN dry-run.  Below L2 it's left as a
    # candidate for the UI to confirm.  Best-effort: never breaks the stream.
    # (auto_crystallize opens a connection only for L2+ skill-worthy runs.)
    try:
        from pramanyx.memory.skills import auto_crystallize
        auto_crystallize(inv_id, connection_id)
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "skill auto-crystallization is best-effort post-run promotion; the answer is unaffected",
                 counter="investigation.skill_crystallize")


# ── SSE + stream helpers ──────────────────────────────────────────────────────

def _sse(event_type: str, data: dict) -> str:
    return f"data: {json.dumps({'type': event_type, **data})}\n\n"


def _error_event(exc: "BaseException | None" = None, *, message: str = "",
                 reason: str = "", agent_id: str = "") -> dict:
    """The payload for an ``error`` SSE frame — the ONE place its shape is decided (Wave R4).

    This was assembled independently at fifteen sites, each emitting a bare
    ``{"message": str(e)}``, so a rate limit, a wrong API key, a retired model id and a
    timed-out run all reached the user as the same red line of prose — and the whole
    classification Waves R1 and R2 built stopped at the provider boundary instead of
    reaching the person waiting.

    ``message`` is unchanged from what each site already produced; the typed fields
    (``reason``/``retryable``/``recovery``/``hint``) ride alongside, so every existing
    consumer is byte-identical until it opts in.
    """
    from pramanyx.agent.answer_errors import error_event

    return error_event(exc, message=message, reason=reason, agent_id=agent_id)


#: The follow-up ask, shared by both branches of the quick path's merged
#: narrative+follow-ups call (Wave 2 / 2.1). The deep paths build the whole prompt from
#: `pramanyx/agent/followups.py`; here the ask has to ride inside the narrative prompt,
#: because merging the two into ONE narrator call is what stopped this path spending
#: two round-trips per answer. Same voice instruction either way: a chip is typed into
#: the composer verbatim when clicked, so it must read as the user's own words.
#: What the narrator's headline is (`_NarrativeResult.headline`), said the same in both of its prompts.
_TITLE_CLAUSE = (
    "write the headline: the answer itself in ONE sentence with the figure it rests on, read from the results — what "
    "a reader sees first. Not a label of the query ('Revenue by month'), no caution or caveat (those are shown beside "
    "it), no markdown. Quote each figure exactly as a cell of the results gives it — never a difference, a sum or a "
    "share you work out yourself: the headline is checked against the results, and one stating a figure they do not "
    "hold is not used."
)

#: The longest title kept: one sentence, read at a glance.
_TITLE_WORDS = 30

#: " — caution: …" / " — note: …", as the guards write them onto a headline.
_CAUTION_TAIL_RE = re.compile(r"\s+[—–-]{1,2}\s+(?:caution|note):\s+", re.IGNORECASE)


def _caution_tail(headline: str) -> str:
    """The cautions the guards wrote onto a headline (" — caution: …"), as written, or "" — carried onto the title
    that replaces it, so a reader still sees them (`web/lib/answerTitle.ts` shows them in the amber line)."""
    m = _CAUTION_TAIL_RE.search(headline or "")
    return (headline or "")[m.start():] if m else ""


def _narrated_title(title: str, columns, rows, sql: str = "") -> str:
    """The narrator's title for a quick answer when it holds, else "": one sentence stating a figure, every figure of
    it in the rows or their totals (`verify_finding`), none beside a label whose row says otherwise
    (`ungrounded_label_values`), and none the headline's own check would rewrite (`_ground_headline`). A caution it
    copied from the headline it was shown is dropped — the guards' own cautions are carried on by the caller."""
    said = " ".join(str(title or "").replace("**", "").split()).lstrip("#").strip()
    said = _CAUTION_TAIL_RE.split(said)[0].strip()
    if not said or not rows:
        return ""
    from pramanyx.explorer.grounding import ungrounded_label_values, verify_finding
    why = ("it states no figure" if not re.search(r"\d", said)
           else f"it runs {len(said.split())} words" if len(said.split()) > _TITLE_WORDS
           else "")
    if not why:
        missing = list(verify_finding(said, rows).ungrounded) + ungrounded_label_values(said, rows)
        why = f"figures not in the rows: {', '.join(missing[:4])}" if missing else ""
    if not why and _ground_headline(said, columns, rows, sql) != said:
        why = "the headline's own check would rewrite it"
    if why:
        # said where an operator reads it: a title written and not used is not silently gone
        logger.info("[chat] the narrator's title was not used (%s): %r", why, said[:240])
        return ""
    return said


_FOLLOWUP_CLAUSE = (
    "suggest exactly 3 follow-up questions written AS THE USER would type them "
    "(max 12 words each) — concrete operations on THIS result, using its real column "
    "names: change the grouping, change the window, filter to a segment, or chase the "
    "biggest mover. Never write about the user ('the user could…'); write what they "
    "would say ('break this out by region')."
)

#: What each guard flag means, in the voice the narrator should explain it in. Only
#: the flags that CHANGED or QUALIFIED the answer appear — a guard that ran and found
#: nothing is not news, and narrating it would train the reader to skip the prose.
_GUARD_PROSE = {
    "grounded": "the first draft's number did not match the result cells, so it was corrected",
    "defan": "the SQL was rewritten to stop a join counting rows more than once",
    "narration_inversion": "this value varies by group and is not uniform across every row",
    "measure_grain": "the measure may be summed at the wrong grain (per-unit vs per-line)",
    "id_arithmetic": "the total multiplies a measure by an id/key column, so its magnitude is unreliable",
    # Not a guard rewrite — an assumption the user asked us to make. It belongs in the
    # same breath as the rest: everything here is something the reader must account for
    # when reading the number (Wave 3 / 2.3).
    "assumed": "the question had more than one reasonable reading and you asked for a "
               "best guess, so ONE reading was chosen — say which one you answered",
}


def _guard_note(rcpt: dict) -> str:
    """The guard interventions of this turn, as an instruction to the narrator.

    Wave 2 / 2.2. The receipts already reach the UI as frames; this puts them in front
    of the ANSWERING model so a correction is explained in the answer's own voice —
    "restriction becomes visible direction" — instead of arriving only as a clause
    appended to the headline.

    Explicitly asks for one plain sentence and forbids re-deriving the number: the
    model must explain what happened, not relitigate the corrected value.
    """
    notes = [prose for key, prose in _GUARD_PROSE.items() if rcpt.get(key)]
    e1 = rcpt.get("e1_messages") or []
    if e1:
        notes.append("a trust check flagged the result: " + "; ".join(str(m) for m in e1[:2]))
    if not notes:
        return ""
    return ("\n\nWHAT THE GUARDS DID — explain this to the user in ONE plain sentence, "
            "in your own words, as part of the narrative. Do not restate the number and "
            "do not apologise; say what it means for reading the answer:\n- "
            + "\n- ".join(notes))


def _explore_subq_event(a) -> dict:
    """The `subq_answer` progress-event payload for one completed sub-question (T3-3: per-subq
    evidence + progress, so the wave path isn't a multi-minute silent gap). Carries the sub-question's
    own columns+rows, which the frontend's per-step ``ResultChartCard`` renders as a chart — so once
    every sub-question's evidence is forwarded (not just the last), each step charts itself."""
    d = a.model_dump()
    d["rows"] = (getattr(a, "rows", None) or [])[:30]
    return d


async def _reduced_subq_answers(agent, inv_id, fallback):
    """The authoritative, reducer-accumulated `subq_answers` from graph state — the streaming router's
    manual dict-merge clobbers the `operator.add` channel (each node delta overwrites it), so the final
    `explore_report` used to forward only the LAST sub-question's SQL+rows. Re-read the checkpoint so
    ALL sub-questions' evidence is forwarded; fall back to the clobbered list on any read error."""
    try:
        import asyncio as _a
        st = await _a.to_thread(lambda: agent.get_state({"configurable": {"thread_id": inv_id}}))
        vals = getattr(st, "values", None) or {}
        return vals.get("subq_answers") or fallback
    except Exception:
        return fallback


def _ada_sqls(ada) -> list[str]:
    """Every executed SQL in a deep-analysis report — walks the report dict collecting
    string values under 'sql' keys. More reliable than query_history, which can
    be empty on some terminal paths (the false-drift cause)."""
    out: list[str] = []

    def _walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "sql" and isinstance(v, str) and v.strip():
                    out.append(v)
                else:
                    _walk(v)
        elif isinstance(o, list):
            for v in o:
                _walk(v)

    _walk(ada if isinstance(ada, dict) else {})
    seen, uniq = set(), []
    for x in out:
        if x not in seen:
            seen.add(x); uniq.append(x)
    return uniq


def _frame_about_of(report) -> dict:
    """Arc OC-3 — ``{"about": …}`` for a deep report whose question was framed (`answer_report["frame"]`), else {}."""
    frame = report.get("frame") if isinstance(report, dict) else getattr(report, "frame", None)
    if not frame:
        return {}
    from pramanyx.ontology.framing import frame_about
    about = frame_about(frame)
    return {"about": about} if about else {}


def _note_finding_on_graph(*, connection_id: str, receipt_id: str | None,
                           headline: str, sql: str, tables: list[str]) -> None:
    """Land this answer on the connection knowledge graph as a `finding` node.

    Keyed by the receipt id, so the incremental node and the one a later full rebuild
    projects from the same receipt are the SAME node — a rebuild supersedes, it never
    duplicates. Never raises: an answer must not fail because a graph write did.

    No schema is passed on purpose. The receipt path's ``schema`` is the schema *text*
    handed to metric enforcement, not a schema *name*, and feeding it to the store
    would address a graph file named after a DDL blob. ``note_finding`` resolves the
    target itself and declines when a connection has several graphs rather than
    guessing which schema the answer belongs to.
    """
    if not receipt_id or not headline:
        return
    try:
        from pramanyx.ontology.context_graph_build import note_finding
        note_finding(
            connection_id,
            {"id": receipt_id, "text": headline, "sql": sql, "tables": tables,
             "source": "evidence_ledger", "generated_at": ""},
        )
    except Exception:
        logger.debug("graph finding write failed", exc_info=True)


def _answer_path() -> Optional[dict]:
    from pramanyx.trust.answer_inputs import path
    return path()


def _given_summary(given: dict) -> dict:
    from pramanyx.trust.answer_inputs import summary
    return summary(given)


def _write_answer_receipt(*, kind: str, natural_key: str, question: str,
                          sqls: list[str], headline: str, schema: str,
                          connection_id: str, canvas_id: str = "",
                          guard_edges: list | None = None,
                          payload_extra: dict | None = None) -> dict:
    """K3-wide Trust Receipt for any user-facing answer (chat / deep-analysis / monitor):

    Returns ``{"learning": …|None, "activations": …|None}`` — the per-run Learning Receipt (Wave 1·E4) and
    Activation Receipt (Wave 1·E3), each present only when its flag is on and the run had something to
    report — so a streaming caller can emit them as SSE events.
    a versioned ledger artifact with HONEST lineage + B-7 metric enforcement.
    Records only verifiable provenance — executed SQL(s), input tables, the
    registered metrics available, whether the governed formula was USED or the
    answer DRIFTED, plus any guard edges the caller proved fired. Best-effort;
    never raises into the answer path."""
    try:
        from pramanyx.kernel.ledger import Ledger
        sqls = [s for s in (sqls or []) if s]
        lineage: list = [("source_sql", "sql", s) for s in sqls[:6]]
        # A1b — what the answer tried before the statements it kept (`trust.answer_tried`)
        from pramanyx.trust.answer_tried import lineage_rows as _tried_rows
        lineage.extend(_tried_rows(list((payload_extra or {}).get("tried") or [])))
        # …and the clarifying question the person went ahead without ("Answer anyway"), from the turn
        from pramanyx.trust.answer_tried import clarification_row, left_now
        _left = (payload_extra or {}).get("clarification_left") or left_now()
        if _left:
            payload_extra = {**(payload_extra or {}), "clarification_left": _left}
            lineage.append(clarification_row(_left))
        seen: set[str] = set()
        for s in sqls:
            for t in _extract_tables(s):
                if t not in seen:
                    seen.add(t)
                    lineage.append(("input", f"table:{t}", None))
        # DE-4: the columns each statement read, beside its tables, each edge saying how it was
        # resolved; and one row saying whether columns were traced at all.
        _columns: list[str] = []
        try:
            from pramanyx.trust.lineage_edges import column_edges, dialect_for_connection, payload_columns
            _col_rows = column_edges(sqls, dialect=dialect_for_connection(connection_id), schema_text=schema)
            lineage.extend(_col_rows)
            _columns = payload_columns(_col_rows)
        except Exception:
            logger.debug("column lineage skipped", exc_info=True)
        enf = None
        _metrics_used: list[str] = []
        try:
            from pramanyx.semantic.metrics import list_metrics, filter_metrics_to_schema
            from pramanyx.semantic.enforcement import (
                check_metric_enforcement, enforcement_summary, propose_undefined_metrics,
            )
            # Keep every surviving grain for enforcement: a query matches one grain,
            # so collapsing first would mislabel a correct answer as drift.
            # check_metric_enforcement collapses its own verdicts to one-per-name.
            cms = filter_metrics_to_schema(list_metrics(), schema, dedupe=False)
            _av_seen: set[str] = set()
            for m in cms:
                if m.name in _av_seen:  # one "available" badge per metric name
                    continue
                _av_seen.add(m.name)
                lineage.append(("metric_available", f"metric:{m.name}", m.sql))
            verdicts = check_metric_enforcement(question, " ".join(sqls), cms)
            for v in verdicts:
                rel = "metric_used" if v["status"] == "used" else "metric_drift"
                lineage.append((rel, f"metric:{v['metric']}", v["detail"]))
                if v["status"] == "used":
                    _metrics_used.append(str(v["metric"]))
            enf = enforcement_summary(verdicts)
            # B-7 propose-to-define: KPI concepts the question names that nothing
            # governs yet — surfaced so the user can define them (then they're enforced).
            for p in propose_undefined_metrics(question, cms):
                lineage.append(("metric_proposed", f"metric:{p['slug']}",
                                f"no governed definition for “{p['phrase']}” — define it to enforce"))
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "metric-enforcement lineage on the Trust Receipt is best-effort; the receipt still writes without it",
                     counter="chat.receipt_metrics")
        for e in (guard_edges or []):
            lineage.append(e)
        # A1 (2026-11-25) — what this answer was GIVEN (the Definitions, trusted queries and documents picked for its
        # question, the confirmed findings every answer reads), recorded as it was made (`trust.answer_inputs`), beside
        # what its SQL USED above. Consumed here, so the next answer in this context starts from nothing.
        _given: dict = {}
        _fresh: dict = {}
        try:
            from pramanyx.trust.answer_inputs import consume, given_this_turn, lineage_rows
            _fresh = consume()
            # in a conversation, everything its turn was given so far — a run_sql written after a held answer was
            # written by a model that still had the first answer's Definitions in front of it
            _given, _fresh = given_this_turn(_fresh)
            lineage.extend(lineage_rows(_given))
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "what the answer was given is best-effort on the receipt; it still writes without it",
                     counter="chat.receipt_given")
        # Wave P1 — the graph nodes the planner was actually SHOWN before writing this
        # SQL. `last_cited_nodes()` has been populated on every read-back since Wave C2
        # and read by nothing but its own tests: the receipt's own flag description
        # claimed "the block the context receipt shows names exactly what grounded the
        # plan", which was true of the prompt and not of the receipt. One consumer closes
        # it. Empty when the read-back experiment is off — the trace is then built from
        # the tables and metrics this answer demonstrably used, which every answer records.
        try:
            from pramanyx.ontology.context_graph_readback import last_cited_nodes
            for _nid in last_cited_nodes()[:12]:
                lineage.append(("grounded_in_graph", _nid, None))
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "graph citations on the Trust Receipt are best-effort; the receipt still writes without them",
                     counter="chat.receipt_graph_citations")
        # I6 — surface ambiguity handling on the Trust Receipt: any resolution THIS question
        # matched in the Ambiguity Ledger (settled earlier by a probe / the user / a reviewer) is
        # recorded, so "this answer followed a previously-resolved reading" is inspectable — the
        # machinery made honest to the user. Best-effort.
        _resolved_ambig: list = []
        try:
            from pramanyx.semantic.ambiguity_ledger import retrieve_resolutions
            for _r, _sc in retrieve_resolutions(question, connection_id, top_k=3):
                _resolved_ambig.append({"subject": _r.subject, "reading": _r.resolved_reading,
                                        "source": _r.resolution_source})
                lineage.append(("resolved_ambiguity", f"reading:{_r.subject[:60]}",
                                f"{_r.resolved_reading} (resolved by {_r.resolution_source})"))
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "ambiguity-ledger lineage on the Trust Receipt is best-effort; the receipt still writes without it",
                     counter="chat.receipt_ambiguity")
        # Per-run Learning Receipt (Wave 1·E4): what the closed loop DID this run — readings reused /
        # corrections (from the resolutions above) plus runtime events (crystallized, trusted replay).
        # Flag-gated (learning.receipt) → None when off; best-effort, never breaks the receipt.
        _learning = None
        try:
            from pramanyx.agent.learning_receipt import build_learning_receipt
            _learning = build_learning_receipt(_resolved_ambig)
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "learning receipt is best-effort; the Trust Receipt still writes without it",
                     counter="chat.receipt_learning")
        # Activation Receipt (Wave 1·E3): which self-gating guards fired this run + the trigger that fired
        # each. Flag-gated (capabilities.receipt) → None when off; best-effort, never breaks the receipt.
        _activations = None
        try:
            from pramanyx.agent.learning_receipt import build_activation_receipt
            _activations = build_activation_receipt()
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "activation receipt is best-effort; the Trust Receipt still writes without it",
                     counter="chat.receipt_activations")
        # Stamp per-run compute onto the artifact so the Trust Receipt shows what the
        # answer cost. For job-backed answers (deep-analysis) the job row carries the full total
        # too; for the synchronous quick-answer path this is the only sink.
        from pramanyx.kernel import metering
        _cost = metering.snapshot()
        # WP-10: stamp the coder model used, so the public receipt's model{role,id} is honest
        # (the model at answer time, not the config at read time). Best-effort.
        _model = None
        try:
            from pramanyx.llm.provider import get_provider
            _model = {"role": "coder", "id": getattr(get_provider("coder"), "model", None)}
        except Exception:
            _model = None
        # Wave H2: the persona this answer was produced AS, read from the ambient contextvar
        # rather than threaded through — so a scheduled agent run (H1) and an interactive one
        # stamp identically. This function is the ONE place every user-facing answer is
        # receipted (chat / deep-analysis / monitor), so stamping here attributes all three by
        # construction. Absent when nobody asked as an agent — an unbound answer says so by
        # omission rather than carrying an empty agent that reads like a real one.
        # Arc TC-1 — the stamp also names the revision of the agent's configuration this answer ran
        # under (`rev`).
        _agent = None
        try:
            from pramanyx.custom_agents.context import answer_stamp, current_agent
            _agent = answer_stamp(current_agent())
        except Exception:
            _agent = None
        _receipt_id = Ledger.default().artifact_write(
            kind, natural_key,
            {"question": question, "headline": headline or question,
             "sql": sqls[0] if sqls else "", "tables": sorted(seen),
             **({"columns": _columns} if _columns else {}),
             **({"cost": _cost} if _cost is not None else {}),
             **({"model": _model} if _model else {}),
             **({"agent": _agent} if _agent else {}),
             **({"resolved_ambiguities": _resolved_ambig} if _resolved_ambig else {}),
             **({"learning": _learning} if _learning else {}),
             **({"activations": _activations} if _activations else {}),
             **({"given": _given_summary(_given)} if _given else {}),
             **({"path": _path} if (_path := _answer_path()) else {}),
             **(payload_extra or {})},
            conn_id=connection_id, canvas_id=canvas_id or None, lineage=lineage,
        )
        # A1 — each thing picked for this question, and each governed metric its SQL used, is used in one more answer
        # (Discover's "used in N answers"): counted once the answer stands on a receipt, never for one that failed.
        try:
            from pramanyx.trust.answer_inputs import count_uses
            count_uses(_fresh, _metrics_used, connection_id)     # each thing counted once a turn
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "an answer's uses are best-effort; the receipt is written", counter="chat.receipt_uses")
        if enf is not None:
            Ledger.default().emit("metric.enforcement", enf,
                                  conn_id=connection_id, canvas_id=canvas_id or None)
        # Wave L1: the answer becomes a `finding` node on the connection knowledge graph
        # NOW, so the next question can read back what this one learned. This is the one
        # place every user-facing answer (chat / deep-analysis / monitor) is receipted, so wiring
        # here covers all three callers by construction rather than by three edits.
        # Gated by `graph.build`, best-effort, and the finding shape is exactly what
        # `load_investigation_findings` would rebuild from the same receipt.
        #
        # The HEADLINE is the finding; the question alone is not a discovery — the
        # rebuild collector's own law, enforced here too. Callers pass
        # ``headline or question`` for the RECEIPT (a receipt page must show
        # something), so an answer that concluded nothing arrives with headline ==
        # question — and projecting that stored the whole scheduled-run context block
        # as a "finding" the graph search then served, ~2KB of prompt echoed per node
        # into every later model turn (measured on the user's own OpenRouter log,
        # 2026-09-15: ten near-identical nodes, none a discovery).
        _concluded = (headline or "").strip() and (headline or "").strip() != (question or "").strip()
        _note_finding_on_graph(
            connection_id=connection_id, receipt_id=_receipt_id,
            headline=headline if _concluded else "", sql=sqls[0] if sqls else "",
            tables=sorted(seen),
        )
        # Phase 1 of the 2027 study (ROADMAP §3.53): the answer becomes a CLAIM in the Record,
        # warranted by this receipt — an observation when it concluded something with a query
        # behind it, and for a deep analysis its findings beside it. One writer, every caller,
        # for the same reason the graph note lives here. Best-effort; the receipt stands without it.
        _claims: dict = {"observation": None, "findings": []}
        try:
            from pramanyx.record.writers import book_from_receipt
            _claims = book_from_receipt(
                kind=kind, natural_key=natural_key, receipt_id=_receipt_id, connection_id=connection_id,
                question=question, headline=headline if _concluded else "", sql=sqls[0] if sqls else "",
                metrics_used=_metrics_used, agent=_agent, canvas_id=canvas_id or "",
                payload_extra=payload_extra or {})
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "the Record's claim is best-effort; the Trust Receipt stands without it",
                     counter="chat.receipt_claim", conn_id=connection_id)
        # `receipt_id` is the stable artifact id → the unified GET /receipt/{id} (WP-10); a
        # streaming caller emits it so the UI's "Why this number" opens the public receipt.
        return {"learning": _learning, "activations": _activations, "receipt_id": _receipt_id,
                "claim_id": _claims.get("observation"), "finding_claims": _claims.get("findings") or []}
    except Exception:
        logger.debug("%s receipt write failed", kind, exc_info=True)
    return {"learning": None, "activations": None, "receipt_id": None, "claim_id": None, "finding_claims": []}


#: Public name for the Trust-Receipt writer. The converse tool loop's `run_sql`
#: (agent/converse_tools.py) writes a receipt for a primitive answer the same way the
#: core writes one for its own — one writer, two callers, one receipt shape.
write_answer_receipt = _write_answer_receipt
#: The executed SQL of a deep report and the subject its frame gave it — read by the Analyst's own receipt
#: (`agent/analyst._write_report_receipt`), the same two the graph path's receipt reads.
deep_report_sqls = _ada_sqls
frame_about_of = _frame_about_of


_TABLE_RE = re.compile(r'\b(?:FROM|JOIN)\s+(?:\w+\.)?(\w+)', re.IGNORECASE)
# Matches CTE definitions: anything of the form `name AS (`  (only valid for CTEs in SQL)
_CTE_DEF_RE = re.compile(r'\b(\w+)\s+AS\s*\(', re.IGNORECASE)


_DIM_NOUN_RE = re.compile(
    r"\b(categor(?:y|ies)|segments?|tiers?|brands?|channels?|regions?|countr(?:y|ies)|"
    r"types?|classes|groups?|statuses|brackets?|cohorts?)\b", re.I)
_GROUP_ID_COL_RE = re.compile(r"(^|_)(id|key|code|sk|pk)$|_id$|_key$|_code$", re.I)


#: The result gate's verdict (`sql/grain_intent.result_finer_than_asked`), as the `inspect_warning` frame names it
#: and as the answer's headline says it.
NOT_AS_ASKED = "not_what_was_asked"
NOT_AS_ASKED_HEADLINE = "This does not answer the question as asked"

#: The checks that are pure functions of the SQL, asked of every repair — see `_checks_still_firing`.
_REPAIR_CHECKS = frozenset({"fanout", "idmath", "ratio", "grain", "chasm"})


def _checks_still_firing(sql: str, triggered: set[str], *, question: str, dialect: str,
                         full_cols: dict, schema_cols: dict) -> list[str]:
    """Which of the SQL-only checks in ``triggered`` still fire on ``sql`` — the repaired query.

    PENDING item 18: the quick path handed a check's hint to the SQL fixer and adopted the fix
    if it merely RAN, never asking the check again, so a repair could keep the very fan-out, id
    arithmetic or averaged ratio it was asked to remove. Re-runs only the checks that are pure
    functions of the SQL; the ones that probe the warehouse or the question's entity alignment
    are not asked twice. A check that cannot run is not counted as firing."""
    from pramanyx.agent.verifier import Verifier
    from pramanyx.sql.fanout import avg_of_row_ratios, measure_times_key_arithmetic
    checks = {
        "fanout": lambda: _fanout_hit(sql, full_cols, dialect),
        "idmath": lambda: measure_times_key_arithmetic(sql, dialect=dialect),
        "ratio": lambda: avg_of_row_ratios(sql, dialect=dialect),
        "grain": lambda: _breakdown_grain_hint(question, sql, dialect),
        "chasm": lambda: Verifier.scan([sql], schema_cols, dialect),
    }
    firing: list[str] = []
    for name in sorted(triggered & set(checks)):
        try:
            if checks[name]():
                firing.append(name)
        except Exception as exc:  # noqa: BLE001 — an unrunnable check does not block a repair
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "a repair re-check could not run; the repair is judged on the rest",
                     counter="chat.repair_recheck")
    return firing


def _fanout_hit(sql: str, full_cols: dict, dialect: str):
    from pramanyx.sql.fanout import detect_fanout, dimension_ratio_chasm
    return detect_fanout(sql, full_cols, dialect=dialect) or \
        dimension_ratio_chasm(sql, full_cols, dialect=dialect)


def _breakdown_grain_hint(question: str, sql: str, dialect: str = "duckdb") -> str:
    """Catch a breakdown grouped at TOO FINE a grain, in its two shapes.

    The question names a categorical dimension ('top product CATEGORIES', 'by brand') but the SQL
    GROUPs BY an id/key column (product_id) instead, so it ranks individual rows, not the category:
    fires only when EVERY group-by column is id-like AND the question names a real dimension noun.

    Or the SQL groups by the dimension AND a row's own key ("total GMV by order status" grouped by
    order_id, status — 500 rows, nothing totalled; `sql/grain_intent.grouped_by_a_row_key`). It is
    asked HERE, and not as a lint before the query runs, because this is the check a repair is
    re-checked against (`_checks_still_firing`): asked only before the run, a later repair wrote
    the same grouping back and it was adopted (receipt 2026-11-14, the first live run of the fix)."""
    hint = _all_keys_grain_hint(question, sql, dialect)
    if hint:
        return hint
    try:
        from pramanyx.sql.grain_intent import grouped_by_a_row_key
        return grouped_by_a_row_key(question, sql) or ""
    except Exception:
        return ""


def _all_keys_grain_hint(question: str, sql: str, dialect: str = "duckdb") -> str:
    """The first shape above: every group-by column is a key, and the question names a dimension."""
    try:
        import sqlglot
        from sqlglot import exp
        tree = sqlglot.parse_one(sql, read=dialect)
        grp = tree.find(exp.Group)
        if not grp:
            return ""
        select_exprs = tree.expressions if isinstance(tree, exp.Select) else []
        gcols: list[str] = []
        for e in grp.expressions:
            if isinstance(e, exp.Column):
                gcols.append(e.name)
            elif isinstance(e, exp.Literal) and getattr(e, "is_int", False):
                idx = int(e.this) - 1
                if 0 <= idx < len(select_exprs):
                    gcols.append(select_exprs[idx].alias_or_name or "")
        gcols = [c for c in gcols if c]
        if not gcols or not all(_GROUP_ID_COL_RE.search(c) for c in gcols):
            return ""
        m = _DIM_NOUN_RE.search(question or "")
        if not m:
            return ""
        noun = m.group(0)
        return (
            f"BREAKDOWN GRAIN MISMATCH: the question asks for a breakdown by '{noun}', but the query "
            f"GROUPs BY an id/key column ({', '.join(gcols)}) — that ranks individual rows, not {noun}. "
            f"GROUP BY the '{noun}' categorical column instead (JOIN to its lookup table and group by the "
            f"name/label if the dimension lives there), and aggregate the metric within each {noun}."
        )
    except Exception:
        return ""


def _extract_tables(sql: str) -> list[str]:
    """Base tables referenced by `sql`, CTEs excluded. Uses the shared analyze()
    AST facade (correct on aliases/subqueries/schema-qualified names); falls back
    to a regex scan for inputs that don't parse as a single statement — some call
    sites pass several queries space-joined into one blob, which the parser rejects."""
    from pramanyx.sql.analyze import analyze
    facts = analyze(sql)
    if facts.ok and facts.tables:
        return sorted(facts.tables)
    # Regex fallback: multi-statement blobs (and anything else the parser can't read).
    cte_names = {m.group(1).lower() for m in _CTE_DEF_RE.finditer(sql)}
    seen: dict[str, None] = {}
    for m in _TABLE_RE.finditer(sql):
        t = m.group(1)
        if t.lower() not in seen and t.lower() not in cte_names:
            seen[t.lower()] = None
    return list(seen.keys())


_DIRECT_SIGNALS = re.compile(
    r'\b(show|list|what is|what are|what was|what were|how many|how much|'
    r'top \d|top\d|give me|fetch|get me|display|count|sum|total|average|avg|'
    r'breakdown|share of|distribution of|calculate|find|return)\b',
    re.IGNORECASE,
)
_INVESTIGATE_SIGNALS = re.compile(
    r'\b(why|cause|caused|causing|driver|drivers|reason|explain|diagnose|'
    r'investigate|what changed|what.s behind|contributing|anomaly|spike|drop|decline|surge)\b',
    re.IGNORECASE,
)


def _looks_direct(question: str) -> bool:
    if bool(_INVESTIGATE_SIGNALS.search(question)):
        return False
    return bool(_DIRECT_SIGNALS.search(question))


def _pb_serialize(entries) -> list[dict]:
    """Shape matched playbook entries for the `playbook_refs` SSE event so the UI
    can show them and offer keep / modify / remove."""
    out = []
    for e in entries or []:
        out.append({
            "id": e.id,
            "recommendation": e.recommendation,
            "trigger_condition": e.trigger_condition,
            "status": e.status,
            "tags": e.tags[:6],
            "historical_success_rate": e.historical_success_rate,
            "source_kb_id": e.source_kb_id,
        })
    return out


# Sentinel for _aiter_sync — see why a sentinel (not except StopIteration) below.
_AITER_DONE = object()


async def _aiter_sync(sync_iter):
    """Bridge a SYNC iterator (LangGraph's .stream()) into an async generator.

    Uses a sentinel rather than `except StopIteration`: `await run_in_executor(..., next, it)`
    marshals the iterator's terminal StopIteration through a Future, and asyncio REFUSES to
    set StopIteration on a Future ("StopIteration ... cannot be raised into a Future"),
    converting it to a TypeError that `except StopIteration` never catches. That TypeError
    leaked out at stream-end, so a cleanly-completed investigation was routed through the
    except/salvage path instead of clean post-loop finalization. `next(it, _AITER_DONE)`
    returns the sentinel on exhaustion, so the loop ends cleanly.
    """
    import contextvars
    loop = asyncio.get_running_loop()
    it = iter(sync_iter)
    # Carry the run's context (the metering RunMetrics + org) into every graph step. `run_in_executor`
    # does not propagate contextvars on its own, so without this a node's record_llm/record_query/
    # record_activation would miss the run's accumulator and the deep-analysis Trust Receipt would show empty
    # cost/learning/activations. The progress variant already does this (via ctx.run for its sink).
    ctx = contextvars.copy_context()
    while True:
        item = await loop.run_in_executor(None, ctx.run, next, it, _AITER_DONE)
        if item is _AITER_DONE:
            break
        yield item


async def _aiter_sync_with_progress(sync_iter, progress_q, ctx):
    """`_aiter_sync` + a concurrent drain of the per-dimension progress queue (P2,
    `ada.progress_events`).

    Each graph node's ``next()`` runs inside ``ctx`` — the copied context that carries the progress
    sink — so a scan's worker threads (a ``ContextThreadPoolExecutor``, which copies ``ctx`` again)
    can push progress DURING the node instead of only when it returns as ``phase_complete``. Note that
    ``run_in_executor`` does NOT propagate contextvars on its own, which is exactly why the node is run
    via ``ctx.run`` rather than bare ``next``.

    Progress items are yielded wrapped as ``{"__ada_progress__": payload}`` (the router turns them into
    a ``phase_progress`` SSE event); graph node events pass through unchanged. Fail-safe: graph events
    are never dropped, and any progress still queued after the graph finishes is discarded (stale)."""
    loop = asyncio.get_running_loop()
    it = iter(sync_iter)
    next_graph = asyncio.ensure_future(loop.run_in_executor(None, ctx.run, next, it, _AITER_DONE))
    next_prog = asyncio.ensure_future(progress_q.get())
    try:
        while True:
            done, _pending = await asyncio.wait(
                {next_graph, next_prog}, return_when=asyncio.FIRST_COMPLETED)
            if next_prog in done:
                _p = next_prog.result()
                # Four payload types share the sink queue: a report-delta (R6), a
                # guard receipt (A4) and a chain-state transition (FL-2) are
                # self-tagged and pass through verbatim; a phase-progress marker
                # is wrapped.
                if isinstance(_p, dict) and ("__report_delta__" in _p or "__guard_receipt__" in _p
                                             or "__chain_state__" in _p):
                    yield _p
                else:
                    yield {"__ada_progress__": _p}
                next_prog = asyncio.ensure_future(progress_q.get())
            if next_graph in done:
                item = next_graph.result()
                if item is _AITER_DONE:
                    break
                yield item
                next_graph = asyncio.ensure_future(
                    loop.run_in_executor(None, ctx.run, next, it, _AITER_DONE))
    finally:
        next_prog.cancel()
        next_graph.cancel()


def _investigation_stream(graph_stream, declared: Optional[list] = None, held=None):
    """The deep-run event iterator: interleaves per-dimension ``phase_progress`` markers
    into the stream, so a scan node reports progress DURING execution and not only at
    ``phase_complete``. ``declared`` — the rules a resumed run's intake declared before.
    ``held`` — the Data Canvas the run reads only the tables of (`db.doors.Held`), or None."""
    import contextvars

    from pramanyx.agent.progress import set_progress_sink
    from pramanyx.db.doors import hold
    from pramanyx.semantic.enforcement import holding
    from pramanyx.util.stream_events import set_chain_sink
    loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue(maxsize=2000)
    ctx = contextvars.copy_context()
    ctx.run(set_progress_sink, loop, q)   # bind the sink INSIDE ctx so nodes run with it visible
    ctx.run(set_chain_sink, loop, q)      # FL-2 — the provider chain narrates into the same queue
    # Arc OC-3 — the rules the run's intake declares (a keyed metric taken from the frame) are held here, so every
    # node after the intake executes its statements over them (`semantic.enforcement.declare`).
    ctx.run(holding, declared)
    # The user, 2026-11-23 — a deep run on a Data Canvas reads only its tables: every node's statement is held at the
    # door (`db.connection._security_pre`).
    ctx.run(hold, held)
    return _aiter_sync_with_progress(graph_stream, q, ctx)


def _stall_summary(merged: dict) -> str:
    """Build a human-readable terminal message when an investigation ends without
    a report.  Prefers the agent's own last verdict/finding, then falls back to a
    digest of the SQL errors that blocked it."""
    scores = merged.get("evidence_scores") or []
    if scores:
        last = scores[-1]
        finding = getattr(last, "key_finding", None) or (last.get("key_finding") if isinstance(last, dict) else None)
        if finding:
            return f"Investigation ended without a conclusive report. Last assessment: {str(finding)[:400]}"

    qh = merged.get("query_history") or []
    errs: list[str] = []
    for r in qh:
        e = getattr(r, "error", None) if not isinstance(r, dict) else r.get("error")
        if e and e not in errs:
            errs.append(str(e))
    total = len(qh)
    failed = len(errs)
    if errs:
        shown = "; ".join(errs[:3])
        return (
            f"Investigation could not complete: {failed} of {total} "
            f"{'query' if total == 1 else 'queries'} failed and no conclusive "
            f"answer could be formed. Errors: {shown[:500]}"
        )
    return (
        "Investigation ended without producing a report. No conclusive evidence "
        "was gathered — try rephrasing the question or narrowing the time range."
    )


def _try_salvage(merged: dict, inv_id: str, question: str, connection_id: str, schema: str = ""):
    """Best-effort terminal synthesis when the graph stops without a report.

    A SOTA investigation must never end with nothing: if ANY evidence was gathered
    (explore sub-answers or deep-analysis phases), synthesise a best-effort report from it,
    persist it, and return the SSE string to emit. Returns ``None`` only when there
    is genuinely no evidence to salvage. Never raises."""
    try:
        merged.get("query_mode")
        qh = merged.get("query_history") or []

        # Explore: synthesise from whatever sub-questions completed.
        if merged.get("subq_answers"):
            from pramanyx.agent.explore import synthesize_exploration
            out = synthesize_exploration(merged)
            er = out.get("explore_report")
            if er:
                sq_raw = [sq.model_dump() for sq in merged.get("sub_questions", [])]
                sa_raw = [a.model_dump() for a in merged.get("subq_answers", [])]
                explore_save = {"_report_type": "explore", **er.model_dump(),
                                "sub_questions": sq_raw, "subq_answers": sa_raw,
                                "_partial": True}
                complete_investigation(inv_id, report=explore_save, hypotheses=[],
                                       query_history=qh, question=question,
                                       connection_id=connection_id, skip_index=False)
                return _sse("explore_report", {
                    "explore_report": er.model_dump(), "sub_questions": sq_raw,
                    "subq_answers": sa_raw, "query_count": len(qh),
                    "investigation_id": inv_id, "query_mode": "explore", "partial": True,
                })

        # deep-analysis / investigate: synthesise from whatever phases completed.
        if merged.get("investigation_phases"):
            from pramanyx.agent.investigate import ada_synthesize
            out = ada_synthesize(merged)
            ada = out.get("answer_report")
            if ada:
                ada_save = (dict(ada) if isinstance(ada, dict) else ada.model_dump())
                ada_save["_report_type"] = "investigate"
                ada_save["_partial"] = True
                complete_investigation(inv_id, report=ada_save,
                                       hypotheses=merged.get("hypotheses", []),
                                       query_history=qh, question=question,
                                       connection_id=connection_id, skip_index=False)
                _write_answer_receipt(
                    kind="ada_report", natural_key=f"ada:{connection_id}:{inv_id}",
                    question=question, sqls=_ada_sqls(ada_save) or [r.sql for r in qh if getattr(r, "sql", None)],
                    headline=(ada_save.get("headline", "") if isinstance(ada_save, dict) else ""),
                    schema=schema, connection_id=connection_id,
                    payload_extra={"investigation_id": inv_id, "partial": True},
                )
                payload = ada_save if isinstance(ada, dict) else ada.model_dump()
                return _sse("answer_report", {
                    "answer_report": payload, "investigation_id": inv_id,
                    "query_mode": "investigate", "mode": "investigate", "partial": True,
                })
    except Exception:
        return None
    return None


def _ambiguity_probe_enabled() -> bool:
    """Whether the structural-ambiguity probe is opted in.

    Reads the current variable, then the retired one. `PRAMANYX_SOMA_CLARIFY` named the
    SOMA-SQL paper the technique came from rather than what the probe does; it still works
    so an operator's existing .env does not silently stop opting in on the day we renamed
    it. Set `PRAMANYX_AMBIGUITY_CLARIFY` going forward.
    """
    for var in ("PRAMANYX_AMBIGUITY_CLARIFY", "PRAMANYX_SOMA_CLARIFY"):
        raw = os.getenv(var)
        if raw is not None:
            return raw.strip().lower() in ("1", "true", "yes", "on")
    return False



async def salvage_orphaned_investigation(
    inv_id: str, connection_id: str, canvas_id: Optional[str], question: str,
) -> None:
    """Crash-recovery for an investigation orphaned by a process restart. Reads its
    LangGraph checkpoint (persisted SqliteSaver, keyed by inv_id) and runs the same
    proven `_try_salvage` the timeout/exception paths use — synthesising a partial
    report from whatever evidence (deep-analysis phases / explore answers) was gathered before
    the crash. Recovery instead of sweep-to-failed; always reaches a terminal status
    (complete on salvage, failed when there's nothing to recover). Runs as a
    supervised kernel job, so it carries its own job.state lifecycle + heartbeat."""
    db = None
    try:
        from pramanyx.agent.graph import build_graph_generic
        from pramanyx.canvas.scope import resolve_execution_scope
        # One scope resolver — unlike the old inline block this ALSO pins the derived owning
        # schema of a table-list-scoped canvas (the salvage-path sibling-schema leak fix).
        db = resolve_execution_scope(connection_id, canvas_id).open()
        agent = build_graph_generic(db, hitl=False)
        config = {"configurable": {"thread_id": inv_id}}
        try:
            st = await asyncio.to_thread(lambda: agent.get_state(config))
            merged = dict(st.values) if st and getattr(st, "values", None) else {}
        except Exception:
            logger.debug("salvage: checkpoint read failed for %s", inv_id, exc_info=True)
            merged = {}
        salvaged = None
        if merged:
            salvaged = await asyncio.to_thread(_try_salvage, merged, inv_id, question, connection_id, "")
        if salvaged:
            logger.info("boot recovery: salvaged a partial report for orphaned investigation %s", inv_id)
        else:
            fail_investigation(inv_id, status="failed",
                               reason="orphaned by a restart and nothing could be salvaged")
            logger.info("boot recovery: nothing to salvage for %s — marked failed", inv_id)
    except Exception:
        logger.warning("boot recovery: salvage crashed for %s", inv_id, exc_info=True)
        try:
            fail_investigation(inv_id, status="failed",
                               reason="orphaned by a restart; the salvage attempt itself crashed")
        except Exception:
            logger.debug("salvage fallback fail_investigation failed for %s", inv_id, exc_info=True)
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                logger.debug("salvage: db close failed for %s", inv_id, exc_info=True)


# ── Request models ────────────────────────────────────────────────────────────

class InvestigateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    question: str
    connection_id: str = BUILTIN_ID
    canvas_id: Optional[str] = None
    hitl: bool = False
    skip_cache: bool = False
    # Scope a non-canvas investigation to a specific schema (multi-schema
    # connections) — mirrors how a canvas scopes. None = whole connection.
    schema_name: Optional[str] = Field(default=None, alias="schema")
    # Seed context for "pull the thread" from a briefing: the originating finding
    # text (seed_context) and the exact query that produced it (seed_sql). ada_intake
    # already reads scan_context, so seeding is additive — no graph change.
    seed_sql: Optional[str] = None
    seed_context: str = ""
    # Drilling into a known briefing finding: its stored finding id. When set (and not
    # `deep`), the explorer's pre-computed Finding Dossier is served as the trace —
    # a deterministic ledger read, NOT a second deep-analysis run. `deep` is the explicit
    # "Investigate deeper" escalation: run deep-analysis, seeded with that dossier.
    insight_id: Optional[str] = None
    # `escalate` is the explicit "go deeper than the saved finding" flag. It is NOT the
    # `depth` knob — the two were both spelled `deep` on the same request, which is how
    # one word came to mean two things. Accepts the old name `deep` on the wire.
    escalate: bool = Field(default=False, alias="deep")
    # Recent conversation turns (question + SQL + result digest), so a follow-up in a
    # canvas composes on the previous query instead of starting cold — parity with the
    # quick /chat path. Same shape /chat + /ask accept.
    history: list[ChatHistoryTurn] = []
    # CA-0: the conversation this deep turn belongs to. The quick and auto bodies already
    # carry it; the explicit-deep body did not, so no deep run was ever filed under a session.
    session_id: str = ""
    # P4 pause posture — see AskRequest.allow_clarify.
    allow_clarify: bool = True


class FeedbackRequest(BaseModel):
    feedback: str
    # P3 plan gate: when resuming from a plan_pending pause, the indices of the
    # sub-questions the user chose to keep (drop the rest before the fan-out runs).
    # None = no plan edit (ordinary HITL resume).
    keep_subquestions: Optional[list[int]] = None
    # P4 clarify gate: when resuming from a clarify_pending pause, the LABEL of the metric
    # reading the user chose (matches one of the offered `options`). None = no clarify choice.
    clarify_choice: Optional[str] = None


class ChatHistoryTurn(BaseModel):
    question: str
    sql: str
    columns: list[str] = []
    headline: str = ""
    # A small sample of the prior result (top rows) so a follow-up can resolve
    # references — "that", "the top one", "those regions" — against real values (Phase 4).
    key_rows: list = []


class ChatRequest(BaseModel):
    question: str
    connection_id: str
    canvas_id: Optional[str] = None
    history: list[ChatHistoryTurn] = []
    session_id: str = ""
    # SP-2 (§3.11) — the product screen the question was summoned from (the ⌘K
    # overlay sends its host tab; '' from every other caller keeps prompts
    # byte-identical). One line of orientation in the prompt, never an
    # instruction channel and never an authorization input.
    surface: str = ""


class AskFocus(BaseModel):
    """SP-15 — what is on screen when Spotlight is summoned: one object by kind and id.

    Arc FA-2 — or what a reader chose on a dashboard, as the question's subject: ``objects``,
    up to fifty ``<type>:<key>`` references, of one entity or several (``label`` names the set they were ticked from); or
    ``set``, a dashboard's set by name, with the values and the chosen objects the page read it with and the reader's
    own filters on it — or a segment the ontology names, with the conditions the piece reads it under. Both are read again server-side through the object door under the asker's row policy
    (`agent.ask_subject`).

    Arc SH, SH-4 — or the sheet a person asks beside, by ``<sheet id>`` or ``<sheet id>:<view id>``.

    ROADMAP §6 item 46 — or one part of a Briefing (``briefing``): ``id`` is its block's, ``period`` the edition's
    period key with its reader (``range:<preset>:<start>..<last day>@<reader>``), and ``source`` the source it draws
    now when a reader drilled it. What the part reads — each source's SQL, the metric a check measures, the period — is
    read from the kept edition (`knowledge.brief_context.edition_part`), never from the page.

    The dashboards study's R20 — or a dashboard a reader asks about (``dashboard``), or one card of it (``id``), with the
    period it is read for as ``<first day>..<last day>``; its cards are read here, as the asker may read the dashboard."""
    kind: Literal["departure", "automation", "metric", "objects", "set", "sheet", "briefing", "dashboard", "table", "query"]
    id: str = Field(default="", max_length=200)
    #: The Ask panel (Stage 1, 2026-11-19): the statement open in the SQL Editor, as the person wrote it.
    sql: str = Field(default="", max_length=20000)
    objects: list[str] = Field(default_factory=list, max_length=50)
    label: str = Field(default="", max_length=80)
    dashboard: str = Field(default="", max_length=64)
    owner: str = Field(default="", max_length=200)
    set: str = Field(default="", max_length=40)
    #: Or a set the ontology names — a segment (or a rule read as one) on an entity — for a piece that reads one
    #: directly rather than through a set of its dashboard.
    entity: str = Field(default="", max_length=120)
    segment: str = Field(default="", max_length=120)
    #: For a segment: the page says the reader's own filters are among the conditions it sends. Words only — the
    #: conditions themselves are read through the door either way.
    narrowed: bool = False
    values: dict[str, Any] = Field(default_factory=dict)
    chosen: dict[str, str] = Field(default_factory=dict)
    filters: list[dict] = Field(default_factory=list, max_length=20)
    #: A part of a Briefing: the edition it is on, by period key and reader, and the source it draws now.
    period: str = Field(default="", max_length=120)
    source: str = Field(default="", max_length=120)

    @model_validator(mode="after")
    def names_what_it_is_about(self) -> "AskFocus":
        # one object is named by its id, as SP-15 always required; a subject by its references or its set
        if self.kind in ("departure", "automation", "metric", "sheet", "table") and not self.id:
            raise ValueError(f"a {self.kind} on screen is named by its id")
        if self.kind == "briefing" and not (self.id and self.period):
            raise ValueError("a part of a Briefing is named by its block's id and the period of the edition it is on")
        if self.kind == "query" and not self.sql.strip():
            raise ValueError("a statement open in the SQL Editor is sent as its words")
        if self.kind == "dashboard" and not self.dashboard:
            raise ValueError("a dashboard asked about is named by its id")
        if self.kind == "objects" and not self.objects:
            raise ValueError("a subject of objects names at least one, as <type>:<key>")
        if self.kind == "set" and not ((self.dashboard and self.set) or (self.entity and self.segment)):
            raise ValueError("a subject set is named by its dashboard and its name, or by its entity and segment")
        return self


class AskRequest(BaseModel):
    """The unified entry (Phase 0 of the Insight+Deep merge, docs/UNIFIED_ANSWER_PATH.md).

    A superset of ChatRequest + the investigate pass-throughs. `depth` defaults to
    `auto` (the router decides); `quick`/`deep` are the auto+transparency re-run
    overrides. The legacy `deep`/`insight_id` flags keep the dossier-drill and
    "Investigate deeper" escalations working through the one door.
    """
    model_config = ConfigDict(populate_by_name=True)
    question: str
    connection_id: str = BUILTIN_ID
    canvas_id: Optional[str] = None
    history: list[ChatHistoryTurn] = []
    session_id: str = ""
    schema_name: Optional[str] = Field(default=None, alias="schema")
    depth: Literal["auto", "quick", "deep"] = "auto"
    # Answer AS this user-defined agent (flag `agents.user_defined`): its pinned
    # instructions lead the prompt, retrieval is scoped to its documents, and its
    # connection binding wins (a conflicting explicit connection is a 409).
    agent_id: Optional[str] = None
    # RC-4 — who is asking, as a `provider:external_id` ref (e.g. `slack:U08N9EQ80UT`).
    # For HEADLESS doors only: a bot authenticates as itself and reports the human on
    # whose behalf it asks, so the turn is attributed to a person instead of to nobody.
    # NEVER trusted over a real authenticated identity — see `_stream_with_session`.
    principal_ref: Optional[str] = None
    # Set when the user answered (or dismissed) a clarifying question — bypass the
    # clarify gate so we don't ask again about the now-clarified request.
    skip_clarify: bool = False
    # P4 pause posture (replaces the deleted `deep_analysis.clarify_gate` flag,
    # 2026-08-06): may this run PAUSE to ask which metric reading was meant? A
    # headless consumer that cannot answer an interrupt passes False and gets a
    # complete (silently-chosen) report instead of a truncated run. The data
    # trigger (a material reading divergence) is unchanged — this only decides
    # whether the run may stop to ask a human.
    allow_clarify: bool = True
    # I4 — the reading the user chose when answering a clarify (the chip text / typed detail).
    # When present, it crystallizes into the Ambiguity Ledger (source=user) so the class never
    # re-ambiguates on this connection. `clarify_subject` is the original ambiguous question
    # (defaults to `question`); `clarify_source` is the clarify kind ("ambiguous_term" → a value
    # choice, else an interpretation choice).
    clarify_reading: str = ""
    clarify_subject: str = ""
    clarify_source: str = ""
    # A clarification the person went ahead without ("Answer anyway", `skip_clarify` and no reading): what it asked and
    # the readings it offered — kept on the answer's receipt (`trust.answer_tried.clarification_left`, 2026-11-26)
    clarify_asked: str = ""
    clarify_options: list[str] = Field(default_factory=list)
    # R13 — a named research starter's declared path: "investigate" pins the deep
    # investigation, "explore" pins the landscape wave (both bypass the router's
    # classifier — deterministic, explicit per request). None = auto routing.
    mode: Optional[Literal["investigate", "explore"]] = None
    # R13/R10 seam — the starter's purpose tag; pure provenance (carried on the
    # route receipt so a starter run is legible as one).
    purpose: str = ""
    # SP-2 (§3.11) — the product screen the question was summoned from (see
    # ChatRequest.surface; same contract, same non-authority).
    surface: str = ""
    # "Ask this briefing" — the range Briefing the user has open, by its period KEY only
    # (`range:<preset>:<start>..<last day>`). The server reads that Briefing from its own
    # cache; nothing about the brief is posted, and a key that is not a range key is ignored.
    brief_period: str = Field(default="", max_length=80)
    # SP-15 — the OBJECT the question was summoned from, structurally: a held row's
    # "Ask Spotlight" hands its departure id here, never inside the prose, so the
    # conversation opens on that object's live state (`explain`) instead of parsing an
    # id out of a sentence and spending tool calls to find it. Non-authoritative like
    # `surface`: an unknown kind or id simply contributes nothing.
    focus: Optional["AskFocus"] = None
    # Pass-throughs preserved from the investigate path. `escalate` accepts the old wire
    # name `deep`; it is the dossier-escalation flag, not the `depth` knob above.
    escalate: bool = Field(default=False, alias="deep")
    insight_id: Optional[str] = None
    seed_sql: Optional[str] = None
    seed_context: str = ""
    #: Keep going (2026-11-20): the earlier turn on this question stopped at its step limit; what it did, in lines, for
    #: the conversation to continue from rather than start again. Empty for every other turn.
    keep_going: str = Field(default="", max_length=4000)
    hitl: bool = False
    skip_cache: bool = False


class ExpectationRequest(BaseModel):
    """The expectation line an acceptance may carry (the 2027 study §K): a metric, a direction, a
    band at a stated coverage. Booked as a prediction claim with the decision; nothing is guessed
    from the recommendation's wording when it is absent."""
    metric: str = ""                     # defaults to the answer's own metric (report.spec) when ""
    direction: str = ""                  # up | down | hold
    low: Optional[float] = None
    mid: Optional[float] = None
    high: Optional[float] = None
    unit: str = ""                       # "%" for a relative change, else the metric's own
    coverage: float = 0.8
    text: str = ""


class OutcomeRequest(BaseModel):
    rec_text: str
    status: str
    metric_name: Optional[str] = None
    metric_before: Optional[float] = None
    metric_after: Optional[float] = None
    review_days: Optional[int] = None    # CB-2: when to measure again and ask (default 30 + the settling lag)
    expectation: Optional[ExpectationRequest] = None   # phase 1 of the 2027 study: the decision's expectation line


_ID_COL_RE = re.compile(r"(^|_)(id|key|sk|pk|code)$", re.IGNORECASE)


def _coerce_list_str(v: object) -> list[str]:
    """Coerce a value that should be list[str] but may arrive as a JSON-encoded
    string from local models (Ollama/qwen).  Handles:
      - already a list                  → items cast to str
      - '["a","b","c"]'                 → single JSON array string
      - '["a"]\\n["b"]'                 → one array per line (qwen quirk)
      - plain multi-line text           → each non-empty line becomes an item
    """
    if isinstance(v, list):
        return [str(item) for item in v]
    if not isinstance(v, str) or not v.strip():
        return []
    try:
        parsed = json.loads(v)
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    except (json.JSONDecodeError, ValueError):
        pass
    steps: list[str] = []
    for line in v.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed_line = json.loads(line)
            if isinstance(parsed_line, list):
                steps.extend(str(item) for item in parsed_line)
            else:
                steps.append(str(parsed_line))
        except (json.JSONDecodeError, ValueError):
            steps.append(line)
    return steps


class _ChatAnswer(BaseModel):
    sql: str
    headline: str
    chart_type: str = "auto"
    intent: str = ""         # "You want to see…" — plain-English restatement of the question
    approach: list[str] = [] # 3-5 concise steps describing how the answer is calculated
    # Chart config generated alongside SQL so the chart always matches the data
    chart_config: dict = Field(default_factory=dict, description=
        "Vega-Lite chart configuration: {type, x_field, y_field, color_field, title}. "
        "Empty dict if the result is not chartable.")

    @field_validator("approach", mode="before")
    @classmethod
    def coerce_approach(cls, v: object) -> list[str]:
        return _coerce_list_str(v)


class _FollowUpBase(BaseModel):
    """Shared model for all follow-up question responses.
    Guards against local models (Ollama/qwen) returning questions as a
    JSON-encoded string instead of a proper list."""
    questions: list[str] = []

    @field_validator("questions", mode="before")
    @classmethod
    def coerce_questions(cls, v: object) -> list[str]:
        return _coerce_list_str(v)


class _NarrativeResult(BaseModel):
    """The prose enrichment attached to a quick answer — its title, anomaly detection, trend, comparison."""
    # First, so the narrator writes the answer's sentence before the words that follow it (`_narrated_title`).
    headline: str = Field(default="", description=(
        "The answer itself in ONE sentence (at most 25 words) with the figure it rests on, read from the results — "
        "what a reader sees first. Not a label of the query ('Revenue by month'), no caution, no markdown."))
    narrative: str = Field(default="", description="2-3 tight sentences that follow the headline without restating it and wrap decisive numbers in **bold**.")
    anomalies: list[str] = Field(default_factory=list, description=(
        "Only what genuinely stands out in these rows: an outlier, a break in the pattern, one value far from the "
        "rest. An EMPTY list when nothing does — never a sentence saying nothing stands out. Not the ranking or the "
        "answer restated, and not a doubt about the query."))
    trend: str = Field(default="stable", description="One of: up, down, stable, mixed.")
    confidence: str = Field(default="medium", description="One of: high, medium, low.")


class _PostAnswer(_NarrativeResult):
    """Combined post-answer enrichment: the narrative + follow-up questions
    in ONE narrator call (was two separate narrator round-trips per answer).
    Inherits the narrative fields; adds the follow-up list with the same coercion guard."""
    questions: list[str] = Field(default_factory=list, description="Exactly 3 concise follow-up data questions, max 12 words each.")

    @field_validator("questions", mode="before")
    @classmethod
    def coerce_questions(cls, v: object) -> list[str]:
        return _coerce_list_str(v)

class _ClarifyingQuestions(BaseModel):
    """Clarifying questions generated before a deep analysis to narrow scope."""
    questions: list[str] = Field(default_factory=list, description="1-2 concise clarifying questions (max 15 words each).")
    context_note: str = Field(default="", description="One sentence explaining why these questions matter.")
# ── Chat streaming ────────────────────────────────────────────────────────────

# ── Headline grounding ────────────────────────────────────────────────────────
# The coder emits a headline alongside the SQL BEFORE execution (a prediction), so it
# can name a leader/number the actual rows contradict ("AMERICA leading at $1.62B" when
# the data shows EUROPE at $45.8B). We validate the emitted headline against the real
# rows and replace it with a grounded one ONLY on a genuine contradiction.
_HL_NUM_RE = re.compile(r"-?\$?\s?([\d][\d,]*(?:\.\d+)?)\s*([bmk])?\b", re.I)
_LEADER_RE = re.compile(r"\b(lead|leads|leading|tops?|topping|highest|most|largest|biggest|#1)\b", re.I)
_MONEY_COL_RE = re.compile(r"revenue|sales|price|value|spend|cost|profit|margin|gmv|income|amount|aov", re.I)


def _hl_to_float(v):
    try:
        return float(str(v).replace(",", "").replace("$", "").strip())
    except Exception:
        return None


def _headline_numbers(text):
    return [n for n, _ in _headline_numbers_with_precision(text)]


def _headline_numbers_with_precision(text):
    """(value, decimals) per number in the prose — ``decimals`` is how many the headline
    itself shows (None when a magnitude suffix like 1.2M scales it, where the shown
    decimals no longer describe the value's precision)."""
    out = []
    for m in _HL_NUM_RE.finditer(text or ""):
        try:
            raw = m.group(1).replace(",", "")
            suffix = (m.group(2) or "").lower()
            val = float(raw) * {"b": 1e9, "m": 1e6, "k": 1e3}.get(suffix, 1.0)
            decimals = None if suffix else (len(raw.split(".")[1]) if "." in raw else 0)
            out.append((val, decimals))
        except Exception:
            pass
    return out


def _col_is_numeric(rows, idx):
    return any(idx < len(r) and _hl_to_float(r[idx]) is not None for r in rows[:8])


def _approx_in(x, pool, tol=0.02):
    return any((abs(x) < 1 if p == 0 else abs(x - p) / abs(p) <= tol) for p in pool)


def _humanize_col(col):
    return re.sub(r"_+", " ", str(col or "")).strip().title()


def _fmt_value(col, v):
    f = _hl_to_float(v)
    if f is None:
        return str(v)
    money = bool(_MONEY_COL_RE.search(str(col or "")))
    a = abs(f)
    if a >= 1e9:
        s = f"{f / 1e9:.2f}B"
    elif a >= 1e6:
        s = f"{f / 1e6:.2f}M"
    elif f == int(f):
        s = f"{int(f):,}"
    else:
        s = f"{f:,.2f}"
    return ("$" + s) if money else s


def _primary_num_idx(columns, rows):
    fallback = None
    for i, c in enumerate(columns):
        if not _col_is_numeric(rows, i):
            continue
        cl = str(c).lower()
        if re.search(r"(^|_)(id|key|sk|code|count|n)($|_)", cl) or re.search(r"pct|percent|share|_of_total", cl):
            fallback = i if fallback is None else fallback
            continue
        return i
    return fallback


_FIRST_DIGIT = re.compile(r"\d")


def _numberless_prefix(text: str) -> str:
    """A streamed headline up to the word that holds its first digit — PENDING item 22. The coder writes the headline
    alongside its SQL, before the query runs, and it used to type onto the screen number and all ("orders fell 97.5%"
    before a row existed), replaced afterwards only on a flat contradiction. The words before the first number are
    no claim; the number waits for the grounded headline."""
    m = _FIRST_DIGIT.search(text or "")
    if m is None:
        return text or ""
    cut = text.rfind(" ", 0, m.start())
    return text[:cut].rstrip() if cut > 0 else ""


_COUNT_WORDS = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
                "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
                "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20}
_COUNT_NAMES = {n: w for w, n in _COUNT_WORDS.items()}
#: "across five Indian metros", "all 3 regions", "these twelve stores": a headline counting the things its rows are.
_COUNT_CLAIM_RE = re.compile(
    r"\b(?:across|all|these)\s+(?:the\s+)?(\d+|" + "|".join(_COUNT_WORDS) + r")\s+"
    r"((?:[A-Za-z][\w-]*\s+){0,2}?)([A-Za-z]+s)\b", re.I)
#: A count of time ("across 12 months") is the period the rows add up, not the rows; and a count with a ranking
#: word ("across the 3 largest cities", "these five other stores") is of some of the rows, not all of them.
_COUNT_OF_TIME = re.compile(r"^(?:second|minute|hour|day|week|month|quarter|year|period)s$", re.I)
_COUNT_OF_SOME = re.compile(r"(?:est|^top|^bottom|^leading|^first|^last|^other|^remaining|^major|^main|^key)$", re.I)


def _singular(word: str) -> str:
    w = word.lower()
    if w.endswith("ies"):
        return w[:-3] + "y"
    if re.search(r"(?:s|x|ch|sh)es$", w):
        return w[:-2]
    return w[:-1]


def _correct_count_claim(headline: str, columns, rows, sql: str = "") -> str:
    """The headline with a count of its rows' things corrected to what the rows show (2026-11-17: an attached sheet's
    answer said "across five Indian metros" over ten cities, and the map beneath it drew ten). The digit check below
    leaves small numbers in a breakdown alone — they are counts, not figures — so a count was never checked at all.

    Fires only where the rows refute it: they hold MORE distinct things than the headline counts. A count larger
    than the rows show is left alone (a breakdown can add up things it does not list), as is a count of time, a
    count of some of the rows ("the 3 largest"), and a count of something the statement filters on but does not
    return ("across 3 regions" over cities WHERE region IN …). Only the number changes; the rest is the model's."""
    m = _COUNT_CLAIM_RE.search(headline or "")
    if not m or not rows or not columns:
        return headline
    said_text, between, noun = m.group(1), m.group(2), m.group(3)
    said = int(said_text) if said_text.isdigit() else _COUNT_WORDS[said_text.lower()]
    if said < 2 or _COUNT_OF_TIME.match(noun) or any(_COUNT_OF_SOME.search(w) for w in between.split()):
        return headline
    thing = _singular(noun)
    texts = [i for i in range(len(columns)) if not _col_is_numeric(rows, i)]
    named = [i for i in range(len(columns)) if thing in str(columns[i]).lower()]   # a store_id counts stores too
    distinct = {i: len({str(r[i]) for r in rows if i < len(r)}) for i in {*texts, *named}}
    if not named and thing in (sql or "").lower():
        return headline              # the statement filters on it but does not return it: the rows cannot count it
    if said in distinct.values() or said == len(rows):
        return headline
    counted = distinct[named[0]] if named else (distinct[texts[0]] if texts else len(rows))
    if said >= counted:
        return headline
    right = _COUNT_NAMES[counted] if not said_text.isdigit() and counted in _COUNT_NAMES else str(counted)
    if said_text[:1].isupper():
        right = right.capitalize()
    return headline[:m.start(1)] + right + headline[m.end(1):]


def _ground_headline(headline, columns, rows, sql: str = ""):
    """Return the headline unchanged when it is consistent with the data; otherwise a
    grounded replacement built from the actual top row. Conservative: only fires on a
    clear contradiction (a sizable number matching nothing — not even a column sum/mean
    — or a superlative naming a non-leader entity). A count of the rows' things the rows
    refute ("across five metros" over ten) is corrected in place first."""
    if not headline or not rows or not columns:
        return headline
    headline = _correct_count_claim(headline, columns, rows, sql)
    # pool of acceptable numbers: individual cell values (top rows) + each column's sum & mean
    pool = [f for r in rows[:8] for f in (_hl_to_float(v) for v in r) if f is not None]
    for ci in range(len(columns)):
        vals = [_hl_to_float(r[ci]) for r in rows if ci < len(r)]
        vals = [v for v in vals if v is not None]
        if vals:
            pool.append(sum(vals))
            pool.append(sum(vals) / len(vals))
    # A SINGLE-ROW result is one metric VALUE — the headline restates exactly that number,
    # so ground EVERY number, not just big ones. This catches a fabricated rate ("repeat
    # rate is 42.3%" when the only cell is 28.62) that the >=100 floor lets through. For a
    # multi-row breakdown keep the floor (small numbers there are structural: "top 10",
    # "across 5 types"). Match scale-tolerantly so a rate stored as a fraction (0.2862)
    # still grounds a "28.62%" claim; skip bare years (a 2025 isn't a data claim).
    scalar_like = len(rows) == 1
    floor = 0.0 if scalar_like else 100.0

    def _grounded(n, decimals=None):
        # A single-row result is one number the narrator RESTATES; the 2% band that
        # forgives "$1.2M" for 1,187,432 also forgave "3.99 days" for 3.96 (Superstore
        # 2026-08-14 — a wrong digit, not a rounding). For a scalar, hold the claim to
        # what the cell rounds to at the precision the headline itself shows: 3.96 →
        # "3.96" / "4.0" / "4" all ground; "3.99" does not. Scale variants (a fraction
        # stated as a percent) keep the same rule.
        if scalar_like and decimals is not None:
            cands = pool + [p * 100 for p in pool] + [p / 100 for p in pool if p]
            return any(round(p, decimals) == round(n, decimals) for p in cands)
        if _approx_in(n, pool):
            return True
        return scalar_like and (_approx_in(n, [p * 100 for p in pool])
                                or _approx_in(n, [p / 100 for p in pool if p]))

    unmatched = [n for n, d in _headline_numbers_with_precision(headline)
                 if abs(n) >= floor and not (2000 <= n <= 2099 and n == int(n))
                 and not _grounded(n, d)]
    cat_idx = next((i for i in range(len(columns)) if not _col_is_numeric(rows, i)), None)
    leader_bad = False
    if cat_idx is not None and _LEADER_RE.search(headline) and cat_idx < len(rows[0]):
        leader = str(rows[0][cat_idx])
        named = [str(r[cat_idx]) for r in rows[:8]
                 if cat_idx < len(r) and str(r[cat_idx]) and str(r[cat_idx]).lower() in headline.lower()]
        if named and leader.lower() not in headline.lower():
            leader_bad = True
    if not unmatched and not leader_bad:
        return headline
    num_idx = _primary_num_idx(columns, rows)
    if num_idx is None or num_idx >= len(rows[0]):
        return headline
    # Render a rate/percent metric with a trailing % (a fraction 0.x is shown as x%).
    _raw = _hl_to_float(rows[0][num_idx])
    if _raw is not None and re.search(r"rate|percent|pct|share|ratio|_of_total", str(columns[num_idx]).lower()):
        fval = f"{_raw * 100:.2f}%" if abs(_raw) <= 1 else f"{_raw:.2f}%"
    else:
        fval = _fmt_value(columns[num_idx], rows[0][num_idx])
    metric = _humanize_col(columns[num_idx])
    if cat_idx is not None and len(rows) > 1 and cat_idx < len(rows[0]):
        return f"{rows[0][cat_idx]} leads {metric.lower()} at {fval}"
    return f"{metric}: {fval}"


def _quick_column_units(connection_id: str, schema_name: Optional[str], sql: str, columns) -> dict[str, str]:
    """`{column: "currency:EUR"}` for a quick answer's money columns, by the rules a deep finding's are tagged by:
    the SOURCE currency the statement itself names (`gmv_eur` → EUR, `agent/investigate._tag_currency_columns`),
    else the currency a PERSON confirmed for the dataset — never a default and never a model's guess. A column that
    is not money, and a dataset with neither, are left unlabelled."""
    try:
        from pramanyx.agent.investigate import money_column_units
        from pramanyx.orgsettings import figure_currency
        return money_column_units(columns, sql, figure_currency(connection_id, schema_name))
    except Exception as exc:  # noqa: BLE001 — unlabelled is the honest fallback
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "a quick answer's column units could not be read; its figures print unlabelled",
                 counter="chat.column_units")
        return {}


_NOTHING_STANDS_OUT = re.compile(
    r"^\s*(?:there\s+(?:are|is|were|was)\s+)?(?:no|none|nothing|not\s+any)\b"
    r"|\bno\s+(?:\w+\s+){0,2}(?:anomal\w*|outliers?|spikes?|surprises?|irregularit\w*|unusual\w*|unexpected\w*)\b"
    r"|\bnothing\s+(?:\w+\s+){0,2}stands?\s+out\b"
    r"|\b(?:the\s+)?(?:query|sql|result)\s+(?:groups|returns|uses|filters|does|is)\b", re.I)


def stands_out(items) -> list[str]:
    """What the narrator named as standing out, less what is not a finding: a sentence saying nothing stands out
    ("No unexpected spikes or outliers…"), and a doubt about the query, which is the result gate's and the inspect's
    to say, where a reader sees it as one. Measured 2026-11-14: of the live answers whose narrative named anything,
    the commonest item said there was nothing to name, and it was shown under "What stands out"."""
    return [str(x).strip() for x in (items or []) if isinstance(x, str) and x.strip() and not _NOTHING_STANDS_OUT.search(x)]


def resolve_currency_symbol(connection_id: str, schema_name: Optional[str]) -> str:
    """The symbol a figure from this dataset carries: the currency a PERSON confirmed for it, else
    "" — a plain amount, never a default "$" and never the model's inferred code (2026-10-23)."""
    try:
        from pramanyx.orgsettings import figure_currency
        from pramanyx.knowledge.triage import currency_symbol
        return currency_symbol(figure_currency(connection_id, schema_name))
    except Exception:  # noqa: BLE001 — unknown is unlabelled, never "$"
        return ""


#: A currency symbol a model writes before a figure — the longer ones first, so `R$` is not read as `$`.
_MONEY_SIGN = re.compile(r"(R\$|US\$|A\$|C\$|[$€£¥₹₩])(?=\s?[\d.])")
_SIGN_CODE = {"R$": "BRL", "US$": "USD", "A$": "AUD", "C$": "CAD", "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY",
              "₹": "INR", "₩": "KRW"}


def _apply_currency(text: str, sym: str, codes: Optional[set] = None) -> str:
    """Every currency sign before a figure in prose (headline/narrative) made one the figures may carry: ``codes`` —
    the currencies the answer's own money columns name (`gmv_eur` → EUR) and the one a person confirmed for the
    dataset (``sym``'s). A sign of another currency is the model's: rewritten to the one currency there is, or taken
    off when there is none — a plain amount (2026-11-26: theLook's dollars were headlined "€676,320.85", the
    organisation's EUR reporting preference read into a dataset nobody confirmed; only "$" was ever rewritten)."""
    if not text:
        return text
    from pramanyx.knowledge.triage import currency_symbol
    allowed = {c.upper() for c in (codes or set()) if c}
    if sym:
        allowed.add(next((c for s, c in _SIGN_CODE.items() if s == sym.strip()), "") or sym.strip().upper())
    allowed.discard("")

    def fix(m: "re.Match") -> str:
        code = _SIGN_CODE.get(m.group(1), "")
        if code in allowed:
            return m.group(1)
        return currency_symbol(next(iter(allowed))) if len(allowed) == 1 else ""
    return _MONEY_SIGN.sub(fix, text)


_TIME_COL_RE = re.compile(r"(month|date|day|week|quarter|year|period|timestamp|_ts$)", re.I)
_DATE_VAL_RE = re.compile(r"^\s*(?:19|20)\d{2}(?:[-/Q]\d{1,2}(?:[-/]\d{1,2})?)?\s*$")


def _is_time_series(columns, rows) -> bool:
    """True when the result's FIRST column is a time bucket (by name or value shape) and
    there are ≥3 rows — i.e. a trend the narrator should read recent-first."""
    if not columns or not rows or len(rows) < 3:
        return False
    if _TIME_COL_RE.search(str(columns[0])):
        return True
    vals = [str(r[0]) for r in rows[:5] if r]
    return bool(vals) and all(_DATE_VAL_RE.match(v) for v in vals)


def _narrator_sample(columns, rows, n: int = 20):
    """Rows to feed the post-answer narrator. For a long ASCENDING time series, weight the
    sample toward the MOST RECENT periods (the series start row kept for net-change framing)
    so the narrative leads with the current state — not year-one of a multi-year dataset
    (the Q15 'anchored on 2022' bug). Returns (sample_rows, is_time_series)."""
    if _is_time_series(columns, rows) and len(rows) > n:
        return [rows[0]] + rows[-(n - 1):], True
    return rows[:n], False


def _narrator_rows_label(sample_rows, total: int, is_time_series: bool) -> str:
    """What the narrator is told the rows it reads are. Every result used to be "a sample of N rows", the whole of it
    too, and the narrator said so: a sheet of ten cities, all ten shown, was summed up as "the sample covers only 10 of
    the plotted cities" (2026-11-17). A whole result is said to be whole; a longer one says how much is shown."""
    shown = len(sample_rows)
    if is_time_series:
        return (f"Results (TIME SERIES — series start then the {shown - 1} most recent of {total} periods, "
                "oldest→newest):")
    if shown >= total:
        return f"Results (all {total} rows: the whole result, not a sample):"
    return f"Results (the first {shown} of {total} rows):"


def _keep_clarify_answer(req, conn_id: str) -> None:
    """I4 — this turn is the person ANSWERING a clarify (a reading chosen from the chips): kept BEFORE the answer, so it
    is an authoritative prior on this turn and every later one. Which area's meaning of a word they meant is THEIR pick,
    kept for them alone (punch list 83) — crystallized for the connection, it answered everyone's question with one
    person's choice; any other reading is the connection's, as before. Best-effort."""
    if not req.clarify_reading:
        return
    try:
        if req.clarify_source == "rival_meanings":
            from pramanyx.semantic.areas import keep_pick
            keep_pick(req.clarify_subject or req.question, req.clarify_reading, conn_id)
        else:
            from pramanyx.org.context import current_org_id
            from pramanyx.semantic.ambiguity_ledger import crystallize_user_choice
            crystallize_user_choice(
                conn_id, req.clarify_subject or req.question, req.clarify_reading,
                org_id=current_org_id() or "", clarify_source=req.clarify_source)
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "clarify-choice crystallization is best-effort", counter="ask.clarify_crystallize")


def _prior_turn_context(history) -> str:
    """The previous turn's question — the ground-first resolver mines it for entities a
    follow-up inherits (so "break that down by platform" keeps the earlier filter). Handles
    both the pydantic ChatHistoryTurn and a plain dict; empty when there is no prior turn."""
    for turn in reversed(history or []):
        q = getattr(turn, "question", None)
        if q is None and isinstance(turn, dict):
            q = turn.get("question")
        if isinstance(q, str) and q.strip():
            return q.strip()
    return ""


def _history_window() -> int:
    """Verbatim conversation-history window (turns rendered with SQL + sample rows).
    Env-tunable (``PRAMANYX_CHAT_HISTORY_WINDOW``); 4 by default — up from the original
    hardcoded 3, still small because only recent turns carry resolvable references and
    each verbatim turn costs prompt budget."""
    import os as _os
    try:
        return int(_os.getenv("PRAMANYX_CHAT_HISTORY_WINDOW", "4"))
    except ValueError:
        return 4


def resolve_history(history, session_id: str):
    """The effective conversation history for this turn (CI-1).

    Prefer what the CLIENT sent — it is the freshest view of the turns the user is
    looking at, and the store save races the next request. When the client sent none
    but a ``session_id`` is set, reconstruct from the store so memory belongs to the
    SESSION rather than to whichever client is holding it: a reload, another device, the
    MCP server, a scheduled task, any non-web caller then all see the same thread.
    Fail-open: reconstruction returns [] on any error, i.e. the exact pre-CI-1 behaviour
    (inject nothing)."""
    if history:
        return history
    if not session_id:
        return history
    try:
        from pramanyx.db.history import reconstruct_session_history
        return reconstruct_session_history(session_id)
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "server-side history reconstruction is best-effort; the turn "
                      "proceeds with no injected memory (pre-CI-1 behaviour)",
                 counter="chat.history_reconstruct_failed")
        return history


def build_prior_answers_section(priors) -> str:
    """Render the "you have asked this before" block (CI-1b).

    Distinct from CONVERSATION HISTORY on purpose: those turns are THIS conversation and
    are context to compose on; these are the same question answered in an EARLIER
    session, and the only honest use of them is comparison. The instruction says exactly
    that — answer from today's data, then say whether it moved — because a prior headline
    restated as current is the staleness class this repo keeps paying for (a briefing
    citing a deleted table, a cached finding outliving its rows).

    Deliberately carries the headline and the date only, never the prior SQL: re-running
    an old query is the model's decision to make from today's schema, not something to
    copy."""
    from pramanyx.agent.investigate import NO_DATA_HEADLINE_PREFIX

    # A run that reported it could not analyse anything is not a baseline. Offered as
    # one, the model dutifully compared against it — live, an answer opened "Compared to
    # the previous report from August 20, 2026, the picture has expanded significantly"
    # when the earlier turn had simply failed and this one had not.
    priors = [p for p in (priors or [])
              if not (p.get("headline") or "").startswith(NO_DATA_HEADLINE_PREFIX)]
    if not priors:
        return ""
    lines = [
        "PREVIOUSLY ASKED — this same question was answered in an earlier session. "
        "Answer from TODAY's data first, then say plainly whether the picture is "
        "unchanged or what moved. Never restate a previous answer as if it were current, "
        "and never cite its numbers as this turn's evidence. Compare LIKE WITH LIKE: only "
        "a differing VALUE for the same measure is a change. How many rows an answer "
        "listed, or which examples it happened to name, is a difference in what was "
        "SHOWN — never report it as the data having grown, shrunk or expanded:",
    ]
    for p in priors:
        when = str(p.get("asked_at", ""))[:10] or "an earlier session"
        head = (p.get("headline") or "").strip() or "(no headline recorded)"
        value = (p.get("prior_result") or "").strip()
        # The VALUE is what makes this comparable. Most stored headlines are captions
        # ("Returns table row count"), so a block carrying only titles would ask for a
        # comparison it gave the model nothing to compare.
        lines.append(f"  • {when}: {head}" + (f" — answered: {value}" if value else ""))
    return "\n".join(lines) + "\n"


def resolve_prior_answers(question: str, connection_id: str, session_id: str):
    """Prior-session answers to this question, or []. Fail-open (CI-1b)."""
    try:
        from pramanyx.db.history import find_prior_answers
        return find_prior_answers(question, connection_id, exclude_session=session_id)
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "cross-session recall is best-effort; the turn answers without it",
                 counter="chat.prior_answers_failed")
        return []


def build_history_section(history, *, followup: bool = False) -> str:
    """Render the conversation context injected into the chat SQL prompt.

    Carries each recent turn's question + SQL + columns + headline AND a small **result
    digest** (sample rows) so a follow-up can resolve references ("that", "the top one",
    "those regions") against real values — not just column names (Phase 4). When the new
    question is a detected follow-up, the header instructs the generator to **compose on
    the most recent query as the base** (keep its metric/filters/grain/window unless the
    ask changes them), which is what makes "now break that down by region" reliable.

    Duck-typed over ``ChatHistoryTurn`` so it is unit-testable with plain stand-ins.

    CI-1: the most recent ``window`` turns render verbatim (SQL + sample rows); anything
    older collapses to a single deterministic summary line naming those questions — no LLM
    call, so a long conversation keeps its thread without paying to summarize every turn.
    The verbatim window stays small because only the recent turns carry references worth
    resolving; the summary line is enough for the model to know a topic was already
    covered (the CI-0 "asked 52 times" case)."""
    if not history:
        return ""
    turns = list(history)
    window = max(1, _history_window())
    recent = turns[-window:]
    older = turns[:-window]
    if followup:
        header = (
            "CONVERSATION HISTORY — THIS LOOKS LIKE A FOLLOW-UP. Treat the MOST RECENT query "
            "below as the base: keep its metric, filters, grain, and time window unless the new "
            "question changes them, and resolve 'that' / 'those' / 'the top one' against its "
            "sample result. Do NOT start from scratch."
        )
    else:
        header = ("CONVERSATION HISTORY (use to resolve 'also', 'add', 'filter by', 'that', "
                  "'those', 'the top one', 'break down', 'compare to'):")
    lines = [header]
    if older:
        earlier = "; ".join(
            (getattr(t, "question", "") or "").strip()[:80] for t in older[-8:]
            if (getattr(t, "question", "") or "").strip())
        if earlier:
            lines.append(f"Earlier in this conversation ({len(older)} prior turn(s)): {earlier}")
    for i, t in enumerate(recent, 1):
        q = getattr(t, "question", "") or ""
        sql = getattr(t, "sql", "") or ""
        cols = getattr(t, "columns", None) or []
        head = getattr(t, "headline", "") or ""
        key_rows = getattr(t, "key_rows", None) or []
        lines.append(f"[Turn {i}] Q: {q!r}")
        if sql:
            lines.append(f"         SQL: {sql}")
        if cols:
            lines.append(f"         Columns: {', '.join(cols[:6])}")
        if head:
            lines.append(f"         Headline: {head}")
        if key_rows:
            preview = " ; ".join(
                " | ".join(str(c) for c in (row or [])[:6]) for row in key_rows[:3]
            )
            lines.append(f"         Result (sample): {preview}")
    return "\n".join(lines) + "\n"


def _execute_chat_sql(db, sql: str, *, label: str = "chat"):
    """Run a quick-path statement inside a tool span.

    The quick path calls ``db.execute`` directly rather than going through the
    guarded executor, which is why it emitted no spans at all — the SQL that
    actually ran was missing from the record, so a quick answer could not be
    reconstructed even once a trace existed. Spanning it here restores that
    without touching execution semantics (the span is a no-op when the obs flags
    are off).

    Called off the event loop by design: the sink's sqlite write then happens on a
    worker thread instead of blocking the stream. It used to get there through its
    own ``asyncio.to_thread``; now the whole of ``_answer_core`` is already on that
    thread, so this is a direct call and the property is inherited rather than
    re-established. Contextvars — trace id, span stack, identity — are copied at
    the one remaining hop, so the row still lands correlated.
    """
    from pramanyx import telemetry
    attrs: dict = {"sql": sql, "query_id": label}
    with telemetry.mlflow_tool_span("sql.execute", attrs):
        result = db.execute(label, sql)
        # Report what came back. The span re-reads its attributes on exit, so this
        # lands as the row's row_count — "the query ran" and "the query returned
        # nothing" are different facts and a zero-row answer is usually the
        # interesting one.
        attrs["row_count"] = getattr(result, "row_count", None)
        return result


@dataclass
class _AnswerCoreResult:
    """What a quick answer IS, once the frames are someone else's problem.

    The SSE frames are the ordered LOG of the turn; this is its terminal state.
    Both matter, and they carry different things: `emit` says what happened and
    when, this says what the answer came out as. A caller with a no-op emit —
    the converse `answer_question` tool — sees only this, which is why
    ``guard_receipts`` lives here as well as on the wire. Its sibling tool
    ``run_sql`` already returns ``guard_receipts`` and ``caveats`` in its dict and
    the converse system prompt tells the model to narrate exactly those; a core
    that only emitted them would make the richer tool the weaker one.

    Everything copied off ``_ChatAnswer`` is COPIED, never aliased: the caveat
    guards rewrite ``chart_type`` and merge into ``chart_config`` in place, so
    handing back the model object would hand back something still being mutated.
    """

    #: How the turn ended — one per `return` in the core, so a caller can tell a
    #: refusal ("abstained") from a failure ("query_failed") without parsing prose.
    #: DELIBERATE terminal states only: an unexpected infrastructure failure produces
    #: no result at all — the core RAISES, through the `finally` that closes the
    #: connection, and the caller owns the envelope (the SSE wrapper renders the
    #: terminal `error` frame; the converse tool loop records a failed step). Pinned
    #: by a bridge test; do not add a catch-all outcome without moving both callers.
    outcome: str
    error: str = ""

    # ── the answer ───────────────────────────────────────────────────────────
    #: The GROUNDED headline, after the currency pass — never `answer.headline`,
    #: which is the model's pre-execution prediction (what `headline_delta` types).
    #: The narrator's title in its place when one held against the rows (`_narrated_title`), its cautions kept.
    headline: str = ""
    sql: str = ""
    columns: list = field(default_factory=list)
    rows: list = field(default_factory=list)          # untruncated; the wire caps at 10k
    row_count: Optional[int] = None

    # ── why it is trustworthy ────────────────────────────────────────────────
    guard_receipts: list[dict] = field(default_factory=list)
    receipt: dict = field(default_factory=dict)
    caveats: list[str] = field(default_factory=list)
    #: GM-3 — the doors the answer's statement passed (`pramanyx.db.doors`), in order.
    doors: list[str] = field(default_factory=list)

    # ── copied out of _ChatAnswer ────────────────────────────────────────────
    chart_type: str = "auto"
    chart_config: dict = field(default_factory=dict)
    intent: str = ""
    approach: list[str] = field(default_factory=list)
    tables_used: list = field(default_factory=list)

    # ── path-specific ────────────────────────────────────────────────────────
    mode: str = ""                       # "final_text" on the two no-SQL paths only
    clarify: Optional[dict] = None
    escalate: Optional[dict] = None
    inv_id: str = ""
    receipt_id: str = ""
    trusted: list = field(default_factory=list)
    playbook_refs: list = field(default_factory=list)
    narrative: Optional[dict] = None
    followups: list[str] = field(default_factory=list)


#: Stream terminator, not an outcome. `_run_core`'s `finally` pushes it on BOTH the
#: return and the raise path; the consumer breaks on it and then awaits the future,
#: which is where success-vs-raise is actually decided.
_CORE_DONE = object()
#: Said by a bridge that has had nothing to send for `KEEP_ALIVE_EVERY` seconds: written as an SSE comment, which every
#: reader skips (`web/lib/sseFrames.ts` reads `data:` lines only) and every wrapper here passes through (each parses only
#: a chunk starting `data: `). Seen live 2026-11-20: a deep analysis handed off from the Ask panel spent 320 s in one
#: phase without a frame, and the web's fetch dropped a body silent for 300 s, cancelling the run at six minutes.
_KEEP_ALIVE = object()
KEEP_ALIVE_EVERY = 20.0
KEEP_ALIVE_SAID = ": keep-alive\n\n"


def _answer_core_workers() -> int:
    """Pool size for `_ANSWER_CORE_POOL` — a deployment knob, read once at import."""
    try:
        return max(1, int(os.getenv("PRAMANYX_ANSWER_CORE_WORKERS", "8")))
    except ValueError:
        return 8


#: The answer core's OWN bounded pool — never the loop's default executor.
#:
#: A core occupies its worker for the WHOLE turn, provider round-trips included — tens
#: of seconds — while the default executor (`api.py` sizes it min(32, cpu+4)) is shared
#: by every router's short `run_in_executor` hop (metrics, catalog, system, query,
#: actions). Parking turns there let a handful of concurrent questions head-of-line
#: block an unrelated millisecond hop for the length of a turn (measured with a
#: 1-worker probe: 3.4 s wait vs 0.66 s max before the split). A dedicated pool bounds
#: concurrent turns instead of starving neighbours: the (N+1)th question queues HERE,
#: visibly, rather than freezing unrelated endpoints invisibly.
#:
#: `ContextThreadPoolExecutor` rather than the stdlib one because it copies contextvars
#: per submitted task — the property `asyncio.to_thread` gave and an explicit-executor
#: `run_in_executor` does not — so the metering accumulator and job id reach the core
#: regardless of whether `api.py`'s lifespan ever installed the context DEFAULT
#: executor (tests, MCP, and any non-lifespan caller never run that install).
_ANSWER_CORE_POOL = ContextThreadPoolExecutor(
    max_workers=_answer_core_workers(), thread_name_prefix="answer-core")


def answer_core_pool() -> ContextThreadPoolExecutor:
    """The answer core's own pool, for a caller outside this module that runs the core — the SQL editor's `/ask`
    (`routers/query.py`). Public so that caller does not reach for this module's internals."""
    return _ANSWER_CORE_POOL


class _CoreCancelled(BaseException):
    """The client went away; stop paying for the rest of the turn.

    A ``BaseException`` for the same reason ``BudgetExceeded`` is one (see
    ``_metered_stream``): the core is riddled with fail-open ``except Exception:
    tolerate(...)`` blocks, and an ``Exception``-derived cancellation would be
    swallowed by the nearest one and the core would sail on.
    """
    #: A cancel of the turn from outside it — its reader leaving, or the job carrying it cancelled — read by a run
    #: that records how it stopped (`agent/analyst._say_how_it_stopped`), which says it as a cancel rather than
    #: naming this class.
    cancels = True


def _note_unanswered(connection_id: str, schema: Optional[str], sql: str, signal: str, error: str) -> None:
    """A quick answer that could not answer — its query failed, or an analytical question came back empty —
    is counted against the dataset it was asked of; two in a week reopen that dataset's questions (the
    exploration principles §3). A refusal is not a gap: a table turned off, a statement the guard blocked, a
    table outside the Data Canvas the turn was on."""
    if signal not in ("error", "no_rows") or str(error or "").lstrip().startswith(("[EXCLUDED]", "[BLOCKED]", "[OUTSIDE]")):
        return
    try:
        from pramanyx.explorer import program
        if not schema:
            from pramanyx.sql.tables import extract_tables
            schema = next((r.schema for r in sorted(extract_tables(sql or ""), key=lambda r: r.qualified())
                           if r.schema), None)
        program.note_unanswered(program.dataset_key(connection_id, schema),
                                "the query failed" if signal == "error" else "an analytical question came back empty")
    except Exception as exc:  # noqa: BLE001 — counting a miss never breaks the answer
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "an unanswered question could not be counted", counter="explorer.unanswered",
                 conn_id=connection_id or None)


@held_to_its_canvas
def _answer_core(
    question: str,
    connection_id: str,
    history: list[ChatHistoryTurn],
    *,
    emit: Callable[[str, dict], None],
    cancelled: Callable[[], bool] = lambda: False,
    session_id: str = "",
    canvas_id: Optional[str] = None,
    skip_clarify: bool = False,
    purpose: str = "",
    schema_scope: Optional[str] = None,
    assumed_default: bool = False,
    persist_question: str = "",
    surface: str = "",
    frame_only: bool = False,
    brief_period: str = "",
) -> "_AnswerCoreResult":
    """Answer one question, synchronously, reporting progress through ``emit``.

    ``frame_only`` (AO-1c) — stop once the statement is framed and guarded, before the
    user-facing execute: the agent evaluation's door onto the PRODUCTION prompt. The
    result's ``outcome`` is ``"framed"`` and ``sql`` is what would have run; nothing is
    executed, narrated or persisted.

    This is the whole quick-answer pipeline, and it is SYNC because it always was:
    every ``await`` it used to carry was an ``asyncio.to_thread`` around blocking
    work, offloaded so the event loop could keep streaming. The ``async def`` bought
    the streaming INTERFACE, not the computation — so the interface moved out to
    ``_stream_chat`` and the computation stayed here, where a plain function call
    can reach it. That is what lets the converse ``answer_question`` tool run the
    real answer path instead of a reimplementation of it.

    ``emit`` takes the same frame name and flat payload ``_sse`` does, so the
    wrapper's job is to re-encode that pair verbatim. Callers that want the answer
    without the narration pass a no-op and read the returned ``_AnswerCoreResult``.
    (Written without a call-shaped example on purpose: the frame-parity guard parses
    this file as text, and prose that looks like an emission site is read as one.)

    ``cancelled()`` is checked three ways: ``emit`` raises ``_CoreCancelled`` once the
    wrapper has set the flag, the two 250 ms poll ticks that straddle the coder and
    narrator round-trips check it, and ``_checkpoint()`` runs before each silent paid
    phase (the context gather, the resolver, the compiler, the ambiguity probe, the
    execute) — because the happy path emits NOTHING between opening the connection and
    the first headline delta, and a disconnect there used to buy the whole prelude.
    Nothing interrupts a blocking call mid-flight — there is no cancel primitive on any
    of these connections — so cancellation is cooperative and honest about its
    granularity: the turn stops at the next checkpoint, closes ``db`` on the way out,
    and emits no partial terminal frames.

    ``persist_question`` labels the saved history row when the question the PIPELINE
    ran is not the question the USER asked — which is exactly the converse case: the
    model rephrases, and a row filed under the rephrasing is a turn its owner cannot
    find again. It is a label only. Everything that decides the answer still reads
    ``question``, so an unset ``persist_question`` leaves every caller byte-identical.
    """
    # A1 (2026-11-25): what this answer is given is recorded from here — every retriever below notes what it put in
    # front of the model, and the receipt carries it (`trust.answer_inputs`).
    from pramanyx.trust.answer_inputs import start_recording
    start_recording()
    #: Guard receipts go BOTH ways, through one helper, so the frame and the return
    #: value cannot drift apart: nine sites, one place that decides what a receipt is.
    receipts: list[dict] = []

    #: What the saved turn is FILED under. Defaults to the question that was answered.
    _persist_q = persist_question or question

    #: What the user has actually SEEN so far, recorded off the frames rather than
    #: gathered from locals at cancel time. The partial the user is looking at IS the
    #: frames — reading it anywhere else would be reconstructing a second version of it
    #: that can disagree. Only the answer-shaped frames are kept; progress chatter is
    #: not part of an answer. Consumed by the cancel handler at the bottom.
    _seen: dict = {}

    #: Whether this turn already wrote its own history row. The answer path keeps working
    #: after it emits `done` — narrative and follow-ups are all post-answer — so a
    #: client that leaves during that tail cancels a turn that is, as far as the user is
    #: concerned, finished and saved. Without this the cancel handler wrote a SECOND row
    #: for it, and the conversation came back with the answer followed by a phantom
    #: interrupted copy of the same question. Caught by reloading mid-enrichment; no unit
    #: test would have posed it, because it only exists in the gap between `done` and the
    #: end of the function.
    _turn_persisted = False

    def _record(name: str, payload: dict) -> None:
        if name == "headline":
            _seen["headline"] = payload.get("headline") or _seen.get("headline") or ""
        elif name == "headline_delta":
            # Replace-semantics, same as the client: the last delta is the whole text.
            _seen["headline"] = payload.get("headline") or _seen.get("headline") or ""
        elif name == "sql":
            _seen["sql"] = payload.get("sql") or ""
        elif name == "columns":
            _seen["columns"] = list(payload.get("columns") or [])
        elif name == "rows":
            _seen["rows"] = list(payload.get("rows") or [])
        elif name == "chart_type":
            _seen["chart_type"] = payload.get("chart_type") or "auto"

    _emit_inner = emit

    def emit(name: str, payload: dict) -> None:   # noqa: F811 — deliberate rebind
        # Record BEFORE forwarding: `emit` is also a cancellation checkpoint (it raises
        # once the wrapper sets the flag), so recording after would drop the very frame
        # the user was looking at when they walked away.
        _record(name, payload)
        _emit_inner(name, payload)

    def _receipt(payload: dict) -> None:
        receipts.append(payload)
        emit("guard_receipt", payload)

    def _checkpoint() -> None:
        # Cooperative cancellation for the stretches that EMIT nothing. `emit` raises
        # once the wrapper sets the flag and both 250 ms poll loops check it too — but
        # the happy path's prelude (context gather, prompt assembly, resolution,
        # compilation, the ambiguity probe) is silent, so a client that disconnected
        # there used to keep paying: the whole context fan-out plus up to three provider
        # round-trips before the first drain tick noticed. Checked before each paid
        # phase; the raise unwinds through the `finally` below, so the connection is
        # closed at the checkpoint and no partial terminal frames are emitted.
        if cancelled():
            raise _CoreCancelled()

    # Resolve canvas scope so table names resolve correctly AND the model only
    # sees in-scope tables. Multi-dataset connections (local_upload) expose every
    # dataset and carry schema_name=None with a table-list scope, so the
    # schema_name override below constrains nothing — without an explicit table
    # filter a Bakehouse canvas can answer from the ecommerce schema.
    # One scope resolver (ExecutionScope): the declared schema drives the explicit
    # "DEFAULT SCHEMA"/"ALLOWED TABLES" prompt block, while eff_schema PINS search_path —
    # the declared schema, else the single owning schema derived from a schema-qualified
    # table list (missimi.orders → 'missimi'). Without the pin an unqualified `FROM orders`
    # leaks to a sibling schema's same-named table (missimi silently answering from netflix).
    from pramanyx.canvas.scope import resolve_execution_scope
    from pramanyx.tools.schema import build_canvas_schema_context
    # Parity with the Deep path: build the canvas schema FRESH (live information_schema),
    # never by filtering the conn-keyed cached string — a snapshot predating a new upload
    # silently DROPPED the missing tables (live incident: Insight declared "no sales
    # transaction table available" while reading its sibling from the same schema).
    # `schema_scope` pins a NON-canvas run to one schema, exactly as a canvas's declared schema
    # pins a canvas run. Omitting it was why a quick answer ignored the shared schema selector
    # (the deep path already forwarded it) — and why a user agent's schema_scope binding didn't
    # constrain a quick answer either.
    _es = resolve_execution_scope(connection_id, canvas_id, schema_scope=schema_scope,
                                  schema_context_builder=build_canvas_schema_context)
    connection_id = _es.connection_id                # canvas's primary connection wins
    canvas_scope_schema = _es.declared_schema        # raw declared → the prompt note
    canvas_scope_tables = list(_es.tables)
    canvas_scope_full = _es.is_full_schema
    canvas_scope_eff_schema = _es.eff_schema
    try:
        db = _es.open()
    except KeyError as e:
        # A KeyError from the scope resolver means the connection id does not exist —
        # a terminal state, not a hiccup. Classified explicitly because the generic
        # fallback says "retrying is usually safe", and re-asking a question against a
        # connection that is not there fails identically every time.
        emit("error", _error_event(e, reason="not_found"))
        return _AnswerCoreResult(outcome="not_found", error=str(e))
    except Exception as e:
        # The connection exists but would not open (server down, bad credentials in the
        # DSN, network). That one IS worth retrying, so it keeps the classifier's verdict.
        emit("error", _error_event(e, message=f"Could not connect: {e}"))
        return _AnswerCoreResult(outcome="connect_failed",
                                 error=f"Could not connect: {e}")

    # Terminal state the frames below also carry. Declared here, not at the emit
    # sites, so every one of the six early returns can hand back a fully-formed
    # result instead of a partially-bound one.
    _esc_event: Optional[dict] = None
    _tables_used: list = []
    _playbook_refs: list = []
    _receipt_id = ""
    _followups: list[str] = []
    _narrative_dict: Optional[dict] = None

    try:
        _checkpoint()   # the client can be gone before the turn starts paying
        # Effective currency symbol for prose: tables/charts already honour the org
        # currency, but the LLM authored ledes in '$'. Resolve once; applied to headline
        # + narrative below. INSIDE the try on purpose: this used to run between
        # `_es.open()` and the block whose `finally` closes `db`, so a raise here leaked
        # the connection (instrumented: opened=1 closed=0, on the pre-split tree too).
        # Everything that runs after the open belongs under the `finally` that owns it.
        _cur_sym = resolve_currency_symbol(connection_id, canvas_scope_eff_schema)
        _cur_codes: set = set()           # the currencies the result's own money columns name, once it has run
        from pramanyx.agent.prompts import CHAT_PROMPT
        from pramanyx.llm.provider import get_provider
        # Shared grounding producers (Rec 5): the same block functions the
        # `GET /ask/context` receipt calls, so the receipt shows exactly what the
        # answer path was grounded on (no drift). dialect_rules_block() == the old
        # get_chat_rules_block() verbatim.
        from pramanyx.agent.grounding import dialect_rules_block

        rules_block = dialect_rules_block()

        from pramanyx.agent.followup import is_followup
        history_section = build_history_section(history, followup=is_followup(question))
        # CI-1b — cross-session recall. Appended to the same block so it reaches the
        # prompt without a new parameter through the core's already-long signature; the
        # section states its own register, so the two never read as one conversation.
        # A follow-up is skipped: "now break that down" is not a repeat of anything, and
        # matching it against a stored question would be noise at best.

        _schema_name = getattr(db, "_schema_name", None)
        schema_qualifier = (_schema_name or "main") if db.dialect == "duckdb" else (_schema_name or "public")

        # ── Context — the ONE builder every engine calls (`agent/grounding.build_grounding_context`, the blueprint
        # 2026-11-27): definitions, rules, instructions, memory, trusted queries, corrections, earlier work, the Briefing,
        # playbook items, documents, earlier answers. It runs its reads concurrently; here it runs beside the schema
        # read, in a dedicated pool (the core already occupies a default-executor worker — eight producers submitted
        # back into that bounded pool by enough concurrent turns is a classic thread-pool deadlock).
        # Only `_get_schema_cached` can raise; its future is read FIRST, as the gather this replaced did.
        from pramanyx.agent.grounding import build_grounding_context as _build_context
        from pramanyx.kernel.parallel_safety import fanout_region as _fanout_region
        with _fanout_region("ask.prelude_context"), ContextThreadPoolExecutor(
                max_workers=2, thread_name_prefix="ask-prelude") as _prelude:
            # WCH-12: the connection-scoped schema cache (300s TTL).
            _f_schema = _prelude.submit(_get_schema_cached, connection_id, db)
            _f_ctx = _prelude.submit(_build_context, question, connection_id, db=db,
                                     eff_schema=canvas_scope_eff_schema, canvas_id=canvas_id or "",
                                     canvas_schema=canvas_scope_schema or "", session_id=session_id,
                                     surface=surface or "", brief_period=brief_period or "")
            schema = _f_schema.result()
            _qctx = _f_ctx.result()

        def _nl(text: str) -> str:
            return (text.strip() + "\n\n") if (text or "").strip() else ""
        history_section += _qctx.text("prior_answers")
        kb_patterns_section = _nl(_qctx.text("kb_patterns"))
        conn_kb_section = _nl(_qctx.text("glossary"))
        sql_examples_section = _qctx.text("sql_examples")
        exploration_section = _nl(_qctx.text("exploration"))
        document_section = _nl(_qctx.text("docs"))
        pb_entries = _qctx.extras.get("playbook_entries") or []
        _checkpoint()   # the gather is the prelude's longest silent stretch

        # Restrict the schema to the canvas's scoped tables. Table-list scopes on
        # multi-dataset connections have schema_name=None, so the schema_name
        # override doesn't constrain anything — filter explicitly, mirroring the
        # Deep Analysis path's build_canvas_schema_context. Falls back to the full
        # schema if filtering yields nothing.
        if canvas_scope_tables and not canvas_scope_full:
            if (_es.schema_context or "").strip():
                # Fresh canvas schema (live introspection — same source Deep uses).
                # Filtering the conn-keyed cached string instead silently dropped any
                # canvas table the stale snapshot didn't know about yet.
                schema = _es.schema_context
            else:
                try:
                    from pramanyx.tools.schema import get_schema_for_tables
                    _scoped = get_schema_for_tables(schema, canvas_scope_tables)
                    if _scoped and _scoped.strip():
                        schema = _scoped
                except Exception:
                    logger.warning("Canvas table-scope filter failed; using full schema", exc_info=True)

        # Arc ED, ED-1 — read as the reader may read it while the ontology's declarations apply to the request: a
        # policied table's row count, sample values and value lists and a masked column's values are withheld, and
        # said, in the text every block below is cut from (`security_sql.schema_as_read`). Unchanged otherwise.
        from pramanyx.ontology.security_sql import schema_as_read as _schema_as_read
        schema, _ = _schema_as_read(connection_id, schema)

        # Governed-metric grounding — built AFTER schema (needs the column set to
        # filter connection-scoped metrics) and BEFORE schema-linking (grounds on the
        # full schema). Rec 5: the SAME producer the GET /ask/context receipt renders
        # (unified bindings + measure grain + feasibility gap), so the receipt shows
        # exactly what grounded this answer — no drift. Byte-identical to the prior
        # inline block; the "SAME resolver as Deep" property (unified_metric_grounding,
        # not the global build_metrics_block) is preserved inside the producer.
        from pramanyx.agent.grounding import (governed_metrics as _grounding_metrics,
                                            schema_slice as _grounding_schema_slice)
        metrics_section = _grounding_metrics(question, connection_id, db=db, schema=schema,
                                             eff_schema=canvas_scope_eff_schema)

        # Schema-linking pre-filter: narrow schema to relevant tables/columns for this
        # question (reduces hallucination 30-60%). Shared Rec 5 producer — falls back to
        # the full schema on failure, byte-identical to the prior inline try/except.
        _full_schema = schema  # keep the un-narrowed schema for FK-neighbour expansion
        schema = _grounding_schema_slice(question, connection_id, schema=schema)

        # Build structured Data Catalog from linked tables,
        # expanded with FK neighbours so bridge/output tables a multi-table
        # question needs only via a join are present.
        semantic_layer_section = ""
        try:
            from pramanyx.tools.data_catalog import build_data_catalog
            from pramanyx.tools.schema import parse_schema_tables, fk_neighbor_expand, temporal_dimension_tables
            from pramanyx.tools.schema_linker import rank_tables_for_context
            from pramanyx.llm.profile import profile_for as _pf_cat
            linked_tables = list(parse_schema_tables(schema).keys())
            if linked_tables:
                _cat_cap = _pf_cat("coder").context_table_cap
                # The date/time dimension is PINNED, not merely appended: a temporal
                # question never names it, so it scores zero and any relevance cut drops
                # it first — the exact table the expansion exists to keep.
                _pinned = [t for t in temporal_dimension_tables(_full_schema, linked_tables, question)
                           if t not in linked_tables]
                # Rank + cap BEFORE building the catalog. The linker returns the schema
                # untouched when nothing matched (recall safety), so an open-ended
                # question used to hand every table in the canvas to a builder that pays
                # 5 sample rows each.
                linked_tables = rank_tables_for_context(
                    question, _full_schema, linked_tables + _pinned,
                    cap=_cat_cap, connection_id=connection_id, pinned=_pinned)
                # FK completion keeps its own historical bound of 10 and deliberately does
                # NOT follow `_cat_cap`: on a capable model that is 24, which would let this
                # path fill a narrow linker result out to 24 tables — a widening that has
                # nothing to do with the fix above. This ranking change may only narrow.
                linked_tables = fk_neighbor_expand(_full_schema, linked_tables, cap=10)
                # M24c: verified semantic layer (segments + computed properties)
                # for the linked entities — only items validated against the live DB.
                _onto_graph = None
                try:
                    from pramanyx.ontology.store import load_latest_ontology
                    from pramanyx.ontology.semantic_block import render_semantic_layer
                    _onto_graph = load_latest_ontology(connection_id)
                    semantic_layer_section = render_semantic_layer(
                        _onto_graph, linked_tables
                    )
                except Exception:
                    semantic_layer_section = ""
                data_catalog = build_data_catalog(db, linked_tables,
                                                  schema=canvas_scope_eff_schema or None)
                if data_catalog:
                    schema = data_catalog
                    # The catalog REPLACES the enriched schema string, dropping the
                    # ENTITY RELATIONSHIPS block apply_schema_enrichment appended —
                    # so re-inject it here, scoped to the linked tables (the same
                    # question-scoping the semantic layer above uses). It rides
                    # semantic_layer_section because that is prepended AFTER the
                    # table cap: enforce_context_cap cuts trailing blocks. On the
                    # no-catalog fallback the slice still carries the enrichment-time
                    # block, so injecting only here never duplicates it.
                    try:
                        from pramanyx.ontology.semantic_block import render_relationship_block
                        _linked_lower = {t.lower() for t in linked_tables}
                        _rel_block = render_relationship_block(
                            _onto_graph,
                            {t: cols for t, cols in parse_schema_tables(_full_schema).items()
                             if t.lower() in _linked_lower})
                        if _rel_block:
                            semantic_layer_section = (
                                semantic_layer_section + "\n\n" + _rel_block
                                if semantic_layer_section else _rel_block)
                    except Exception:
                        logger.debug("relationship block injection skipped", exc_info=True)
                    # …and what people wrote about the columns, which the catalog drops too (the grounding audit,
                    # 2026-11-26): descriptions, known values, caveats, what an empty value means.
                    try:
                        from pramanyx.semantic.glossary import column_notes
                        _notes = column_notes(list(linked_tables), connection_id, canvas_scope_eff_schema, _onto_graph)
                        if _notes:
                            semantic_layer_section = (semantic_layer_section + "\n\n" + _notes
                                                      if semantic_layer_section else _notes)
                    except Exception as _notes_exc:
                        from pramanyx.kernel.errors import tolerate
                        tolerate(_notes_exc, "column notes are additive; the catalog stands without them",
                                 counter="chat.column_notes", conn_id=connection_id)
        except Exception:
            logger.warning("Data Catalog build failed; using linked schema text", exc_info=True)

        # Hard cap on tables in context — profile-derived (A3): the linker output
        # is rank-ordered, so a first-N cut here keeps the top-N ranked tables.
        try:
            from pramanyx.llm.profile import profile_for
            from pramanyx.tools.data_catalog import enforce_context_cap
            schema = enforce_context_cap(schema, max_tables=profile_for("coder").context_table_cap)
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "table context cap is best-effort; answering from the uncapped schema context",
                     counter="chat.context_cap")

        # ── final_text path: definitional questions answered from KB ──
        # Two conditions, both paid for on 2026-11-13. The question must ask what a TERM means: the
        # opener alone ("what is …") is how most questions for figures begin, and "What is total GMV
        # by order status?" was answered with the glossary and no query. And the term must not be one
        # this connection defines: the glossary is general — marketplaces, restaurants — and on a
        # connection whose approved GMV is SUM(gmv_eur) it answered "quantity × unit_price, excluding
        # cancelled orders" as if that were this business's. A connection's own definition is the
        # answer path's to give, with its figure, so such a question falls through to it.
        from pramanyx.agent.question_shape import asks_what_a_term_means
        definitional = asks_what_a_term_means(question)
        if definitional:
            try:
                from pramanyx.semantic.metrics import metrics_named_in
                definitional = not metrics_named_in(question, connection_id, canvas_scope_eff_schema or None)
            except Exception as exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "could not read this connection's metrics; the general glossary must not answer "
                              "for a term it may define, so the question goes to the answer path",
                         counter="chat.kb_definitional")
                definitional = False
        if definitional:
            try:
                # READER register, never the planning one: retrieve_for_planning is a
                # prompt-injection block ("RELEVANT SQL AND DOMAIN PATTERNS (apply when
                # writing queries): …") and this path's output IS the user's answer —
                # eleven stored turns carry that block verbatim as their headline
                # (CI-0 finding 4).
                from pramanyx.semantic.kb_retriever import has_strong_kb_match, retrieve_for_reader
                if has_strong_kb_match(question, threshold=0.75, top_k=3):
                    kb_answer = retrieve_for_reader(question, top_k=3) or ""
                    # Also pull connection KB — same register rule.
                    try:
                        from pramanyx.semantic.connection_kb import retrieve_for_reader as _ckb_fn
                        ckb = _ckb_fn(question, connection_id)
                        if ckb:
                            kb_answer = kb_answer + "\n\n" + ckb
                    except Exception as exc:
                        from pramanyx.kernel.errors import tolerate
                        tolerate(exc, "connection-KB enrichment of the definitional answer is best-effort; the global-KB answer still serves",
                                 counter="chat.kb_definitional")
                    if kb_answer.strip():
                        _answer_text = kb_answer.strip()
                        # Emit as `headline` — the only text channel the chat turn
                        # renders for a no-SQL answer (final_text/definitional path).
                        # The previous `answer` event had no frontend handler, so the
                        # turn rendered blank. `mode` tags it so it shows as a Quick turn.
                        emit("mode", {"query_mode": "final_text"})
                        emit("headline", {"headline": _answer_text})
                        emit("done", {})
                        try:
                            # `frame_only` callers (an agent's evaluation, the SQL editor's /ask) never become a
                            # chat turn — the contract the framed return below states, kept on this path too.
                            if not frame_only:
                                save_chat_turn(
                                    question=_persist_q, connection_id=connection_id,
                                    headline=_answer_text[:2000], sql="", session_id=session_id,
                                    columns=[], rows=[], chart_type="none", tables_used=[],
                                    intent="", approach=[],
                                    canvas_id=canvas_id,
                                )
                        except Exception as exc:
                            from pramanyx.kernel.errors import tolerate
                            tolerate(exc, "definitional-answer turn save is best-effort; the answer was already streamed",
                                     counter="chat.turn_save")
                        return _AnswerCoreResult(
                            outcome="kb_definitional", mode="final_text",
                            headline=_answer_text, guard_receipts=receipts)
            except Exception as exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "KB-grounded definitional fast-path is best-effort; falling through to the SQL answer path",
                         counter="chat.kb_definitional")

        # Inject schema-prefix note when canvas-scoped
        if canvas_scope_schema:
            schema = (
                f"DEFAULT SCHEMA: {canvas_scope_schema}\n"
                "CRITICAL: Every table reference in SQL MUST include this schema prefix "
                f"(e.g. {canvas_scope_schema}.table_name). Do NOT use bare table names.\n\n"
                + schema
            )
        elif canvas_scope_tables and not canvas_scope_full:
            # Table-list scope (multi-dataset connection, schema_name=None): name
            # the allowed universe so the model can't wander into another dataset.
            schema = (
                "ALLOWED TABLES — this canvas is scoped to ONLY these tables:\n"
                f"{chr(10).join('  - ' + t for t in canvas_scope_tables)}\n"
                "CRITICAL: Query ONLY these tables, using the exact schema prefixes shown. "
                "Do NOT reference any other schema or dataset.\n\n"
                + schema
            )

        prompt = CHAT_PROMPT.format(
            schema=schema,
            history_section=history_section,
            question=question,
            schema_qualifier=schema_qualifier,
            kb_patterns_section=kb_patterns_section,
            conn_kb_section=conn_kb_section,
            sql_examples_section=sql_examples_section,
            metrics_section=metrics_section,
            exploration_section=exploration_section,
            document_section=document_section,
        )
        if rules_block:
            prompt = rules_block + prompt
        # The ENGINE's dialect rules — the same block the deep-path SQL writer
        # carries (`writer_rules`, selected by execution mode). The quick path
        # generated blind to dialect on native warehouses and lived on luck plus
        # the repair loop; measured 2026-09-06 on BigQuery, that meant DuckDB-order
        # DATE_TRUNC and DATE-typed literals in half the answers. Empty on DuckDB?
        # No — DuckDB gets its own rules; the block is never empty, only shorter.
        from pramanyx.db.dialects import writer_rules as _writer_rules
        _dialect_block = _writer_rules(db)
        if _dialect_block:
            prompt = _dialect_block + "\n\n" + prompt
        # 2026-11-17 — the date, on the person's clock: the quick path was told none, so "yesterday" was whatever the
        # model guessed and "last month" the data's latest month (`kernel/clock.py`, one definition for the platform).
        from pramanyx.agent.sql_context import clock_block as _clock_block
        from pramanyx.agent.sql_context import learned_settle_days as _learned_settle
        prompt = _clock_block(settle_days=_learned_settle(connection_id)) + "\n\n" + prompt
        # User-agent brief (flag `agents.user_defined`) — the active agent's pinned
        # instructions lead the prompt, rules_block-style. Empty (inert) when no
        # agent is active.
        _agent_brief = _qctx.text("agent_brief")
        if _agent_brief:
            prompt = _agent_brief + prompt
        # Pack steering — the third and last consumer of the shared producer (explore and
        # the deep-analysis intake are the others). Sits beside the agent brief on purpose:
        # creating a custom agent can bind BOTH, and before this the brief arrived here
        # while the pack's grounded recipes did not — so an agent built around a domain
        # answered quick questions with none of that domain's definitions. Inert unless a
        # pack is active AND deployed on this connection, so the prompt is byte-identical.
        _pack_sec = _qctx.text("pack")
        if _pack_sec:
            prompt = _pack_sec + prompt
        # Custom instructions — the user-authored steering text stored by
        # PUT /connections/{id}/instructions and the Canvas Configure panel's
        # Instructions tab (PUT /canvases/{id}/instructions). Both surfaces stored
        # this text since Sprint 53 and NOTHING consumed it — a user could type
        # "fiscal year starts in February" into a live editor and every answer
        # ignored it. Injected verbatim (not question-matched, unlike the conn KB):
        # empty when none is stored, so those prompts are byte-identical.
        _instr_sec = _qctx.text("instructions")
        if _instr_sec:
            prompt = _instr_sec + prompt
        # What the person asking asked to be remembered (punch list 90): theirs alone, every connection. Mirrored in
        # grounding._BLOCKS ("person_memory"). Empty when they asked for nothing: a byte-identical prompt.
        _memory_sec = _qctx.text("person_memory")
        if _memory_sec:
            prompt = _memory_sec + prompt
        # ON-10 — the question framed against the DECLARED ontology, as the deep investigation frames it: each business
        # term's declared definition with the SQL the object door compiles for it. No model call here — an ambiguous
        # frame lists every definition the words fit. Empty where nothing declared is reached: byte-identical prompts.
        from pramanyx.agent.grounding import writer_dialect as _writer_dialect
        _frame_sec = _qctx.text("question_frame")
        # the same frame as data, for the business-rule check before the statement runs (`ontology/rule_check`)
        _rule_frame: dict = {}
        try:
            from pramanyx.agent.framing import resolve_frame as _resolve_frame
            _fo = _resolve_frame(question, connection_id, canvas_scope_eff_schema or None,
                                 dialect=_writer_dialect(db), choose=False)
            _rule_frame = _fo.model_dump(mode="json") if _fo is not None and getattr(_fo, "defines", False) else {}
        except Exception as _frame_exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(_frame_exc, "the question's frame could not be read as data; no rule is checked",
                     counter="chat.rule_frame", conn_id=connection_id)
        if _frame_sec:
            prompt = _frame_sec + prompt
        # HB-4 — the ranked conversation-notes block, gated on measured lift
        # (pramanyx/hub/injection.py): renders "" while the gate holds, so this line is
        # byte-inert today. Mirrored in grounding._BLOCKS ("hub_notes") — the receipt
        # and the live prompt must not disagree about what was injected.
        _notes_sec = _qctx.text("hub_notes")
        if _notes_sec:
            prompt = _notes_sec + prompt
        # Summon surface (SP-2, §3.11) — which product screen the question was asked
        # from; the ⌘K overlay sends its host tab and every other door sends ''
        # (byte-identical prompts). Whitespace-collapsed and hard-capped because it
        # is client-supplied text: one line of orientation, structurally unable to
        # carry a smuggled paragraph, and never an instruction channel.
        if surface:
            _surf = " ".join(str(surface).split())[:48]
            if _surf:
                prompt = (f"ASKED FROM — the user summoned this question from the "
                          f"'{_surf}' screen of the product.\n\n") + prompt
        # Business synonyms — human-curated aliases, rendered verbatim like the
        # instructions above (an alias matters for reading the question AND for
        # labelling the answer). The vocabulary store fed the schema linker from
        # day one but never the model — a person could record "'sales value' means
        # orders.amount" and the SQL writer never learned it; the KI lane now
        # imports synonyms, so a prompt-invisible destination would be the
        # built-and-inert shape. Empty when none: byte-identical prompt.
        _syn_sec = _qctx.text("synonyms")
        if _syn_sec:
            prompt = _syn_sec + "\n" + prompt
        # "Ask this briefing" — ground the answer in the brief the user is LOOKING AT, read
        # server-side from the same `conn:schema` cache entry the Briefing rendered (never
        # posted up by the client, so it can't drift from what's on screen or be spoofed).
        # Best-effort and empty when no brief is cached: no context beats invented context.
        # The Briefing beside the question, the platform's earlier work and the playbook items that match — from the
        # one builder (each '' when there is none).
        for _k in ("briefing", "known", "playbook"):
            if _qctx.text(_k):
                prompt = _qctx.text(_k) + "\n" + prompt

        # M24c: verified semantic layer — segments (named WHERE filters) and
        # computed properties for the linked entities, all executed against the
        # live DB. Prepended below the trusted block so trusted patterns stay on top.
        if semantic_layer_section:
            prompt = semantic_layer_section + "\n\n" + prompt

        # Trusted query templates (authoritative, data-team-reviewed). When the
        # question matches a verified pattern, inject it at the top so the model
        # reuses its exact structure — fixes model-reasoning gaps (fan-out, grain)
        # that prompt rules can't. Surfaced to the user via `trusted` SSE below.
        _trusted_used = []
        _tblk = _qctx.text("trusted")
        if _tblk:
            prompt = _tblk + "\n" + prompt
            _trusted_used = list(_qctx.extras.get("trusted_used") or [])
            # each trusted query that guided this answer is counted as used once its receipt is written (A1:
            # `trust.answer_inputs`, noted by `build_trusted_block`), on this path and the deep run's alike

        # P1 close-the-loop: alongside verified patterns, inject any past human
        # corrections (reject/correct verdicts) for this database so the model does
        # not repeat a mistake a reviewer already flagged. Flag-gated + empty when
        # nothing relevant matches, so the default path is byte-for-byte unchanged.
        _cblk = _qctx.text("corrections")
        if _cblk:
            prompt = _cblk + "\n" + prompt

        # ── Ground-first resolution (flag `ask.resolve_first`) ────────────────
        # Decide ONCE, deterministically, whether this is answerable as asked —
        # BEFORE anything model-shaped runs. This sits ABOVE the semantic compiler
        # and the ambiguity probe deliberately: both spend an LLM call parsing/probing
        # the question, which is wasted work (cost + latency) when the verdict is
        # an honest abstention. Best-effort: a resolver failure leaves `_resolution`
        # None and the answer proceeds ungrounded rather than not at all.
        _checkpoint()   # before the resolver — the first of the prelude's paid calls
        _resolution = None
        try:
            from pramanyx.semantic.answer_resolution import resolve as _resolve_answer
            # Conversation-aware: a follow-up inherits the prior turn's entity/filter so a
            # mode switch or a "break that down" doesn't lose the earlier grounding. Empty
            # for a fresh question, which is what makes this single-turn-safe — the
            # follow-up test is the gate, not a flag.
            _prior_ctx = _prior_turn_context(history) if is_followup(question) else ""
            _resolution = _resolve_answer(question, schema=_full_schema, db=db,
                                          connection_id=connection_id,
                                          eff_schema=canvas_scope_eff_schema,
                                          prior_context=_prior_ctx)
            # "X is not present in this data" names only what the PERSON said. The conversation hands this core its
            # own rewording, padded with the period's dates and the metric's definition, and LuxExperience's context
            # evals (2026-11-26) were refused on those words: “UTC.”, “gmv_eur divided”, “order_items joined”.
            if _resolution is not None and _persist_q != question and _resolution.not_found:
                from pramanyx.semantic.answer_resolution import said_by_person
                _resolution.not_found = said_by_person(_resolution.not_found, _persist_q)
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "ground-first resolution is best-effort; answering without it",
                     counter="chat.resolve")

        # Honest abstention: a clear filter entity isn't in the data → say so with
        # what IS present, instead of running an empty filter and narrating around
        # the emptiness (the "Mytheresa isn't a franchise here" case). But NEVER dead-end a
        # FOLLOW-UP when conversation-context is on — the entity/reference may be implicit from
        # the conversation, so let the history-aware generator answer instead of a terminal stop.
        _abstain_ok = not is_followup(question)
        if _resolution is not None and _resolution.feasibility == "not_answerable" and _abstain_ok:
            _abstain = _resolution.caveat
            emit("mode", {"query_mode": "final_text"})
            emit("headline", {"headline": _abstain})
            emit("done", {})
            try:
                if not frame_only:   # a framed call (an evaluation, the editor's /ask) is never a chat turn
                    save_chat_turn(
                        question=_persist_q, connection_id=connection_id, headline=_abstain[:2000],
                        sql="", session_id=session_id, columns=[], rows=[], chart_type="none",
                        tables_used=[], intent="", approach=[], canvas_id=canvas_id)
            except Exception as exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "abstention turn save is best-effort; the message was already streamed",
                         counter="chat.resolve_abstain_save")
            _followups = [
                "What values are available to filter by?",
                "Show the same measure without that filter",
            ]
            emit("followups", {"questions": _followups})
            return _AnswerCoreResult(
                outcome="abstained", mode="final_text", headline=_abstain,
                followups=_followups, guard_receipts=receipts)

        # Semantic Compiler fast-path (backlog #11): for the safe analytical shapes
        # (scalar / timeseries / breakdown / ranking) assemble grounded SQL deterministically
        # from the verified ontology instead of free-form generation. The LLM still writes the
        # headline/chart/approach around it, but the executed SQL is the compiled one — which
        # can't hallucinate columns or fan out. Coverage-gated + fallback-safe (None → no-op).
        _checkpoint()   # before the compiler round-trip
        _compiled_sql = None
        _compiled_intent = None
        if os.getenv("PRAMANYX_COMPILER", "1").strip().lower() in ("1", "true", "yes", "on"):
            try:
                from pramanyx.semantic.compiler import compile_question
                # Pass the schema we already fetched (_full_schema) so metric resolution
                # inside the compiler doesn't re-introspect it — ~16s per compile (profiled).
                # CRITICAL: scope the compiler to the canvas's schema. Without it, a missimi
                # canvas loaded the connection-wide (generic demo) ontology whose entities lack
                # missimi's real measures/dimensions — so the compiler resolved the WRONG column
                # (installments→total_amount, days_out_of_stock→COUNT, brand→category) and, because
                # the compiled SQL OVERRIDES the LLM's, served a confidently wrong answer.
                _cc = compile_question(question, connection_id, schema_name=canvas_scope_eff_schema,
                                       dialect=db.dialect, schema_text=_full_schema)
                if _cc:
                    _compiled_sql, _compiled_intent = _cc
                    prompt = ("GROUNDED REFERENCE QUERY (assembled from the verified semantic layer — "
                              "its table, columns and aggregate are correct and fan-out-safe). Use it as "
                              "your TRUSTED BASIS, but ADAPT it to fully answer the question: add any "
                              "filter (date range, status), computed condition (e.g. delivered_ts > "
                              "estimated_delivery), ratio / derived metric (e.g. revenue / spend), GROUP BY "
                              "dimension, or JOIN the question needs that it does not already include. If it "
                              "answers the question exactly as written, run it verbatim:\n"
                              f"{_compiled_sql}\n\n" + prompt)
            except Exception:
                _compiled_sql = None

        # The metric engine where answers are made (2026-11-26, `agent/governed_metric`): a question naming a governed
        # metric written as parts starts from that metric compiled for it — by what it names, over the period it names —
        # where the bar is met. Topmost of the reference queries: it says it takes precedence.
        _governed = None
        try:
            from pramanyx.agent.governed_metric import reference as _governed_reference
            # named in the PERSON's words first: the conversation's rewording may call it something else ("average
            # dispatch lag" for theLook's "placed to shipped", a share), and no governed metric was found (2026-11-26)
            _governed = None
            for _q in dict.fromkeys([_persist_q, question]):
                _governed = _governed_reference(_q, connection_id, schema_scope=canvas_scope_eff_schema,
                                                dialect=db.dialect)
                if _governed is not None:
                    break
            if _governed is not None:
                prompt = _governed.prompt() + prompt
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "the governed metric reference could not be made; the answer writes its own",
                     counter="answer.governed_metric", conn_id=connection_id)
            _governed = None

        # Deterministic complexity assessment (cost-tiered routing, Part 2). We assess
        # every question and surface the tier on the Trust Receipt, but the user-facing
        # SQL answer deliberately stays on the frontier "coder" model: a deceptively
        # "simple" question can be grain-tricky (e.g. "items per order"), and Pramanyx's
        # proven combination is the frontier model + deterministic guards — routing the
        # answer to a cheaper model would just shift work onto the guards. The cost lever
        # is applied to the robust routing *decision* instead (classify_question). See
        # docs/NL2SQL_WINNING_FORMULA_2026.md.
        # Structural-ambiguity probe (3b) — execution-grounded. On a structural-suspect
        # question the cheap deterministic clarify left quiet (e.g. "top products" — by units or
        # revenue?), generate candidate readings, execute them on THIS connection, and ask only if
        # their results materially diverge (the labels become grounded chips). LLM machinery + N
        # executions, so it is opt-in (PRAMANYX_AMBIGUITY_CLARIFY) and fail-open. Greenlit by the measurement
        # chain (evals/ambiguity_eval + evals/its_structural).
        _checkpoint()   # before the ambiguity probe (an LLM call plus N executions)
        if (not skip_clarify and _ambiguity_probe_enabled()):
            try:
                from pramanyx.agent.ambiguity_probe import (is_structural_suspect, generate_candidate_readings,
                                               assess_structural_ambiguity)
                if is_structural_suspect(question):
                    _cands = generate_candidate_readings(question, schema)
                    if len(_cands) >= 2:
                        def _probe_ex(_sql):
                            # the readings are prompted as DuckDB SQL; the door renders them (GM-1)
                            _r = db.execute("ambiguity_probe", _sql, sql_dialect="duckdb")
                            return (not _r.error, _r.rows or [], _r.error or "")
                        _sv = assess_structural_ambiguity(question, _cands, _probe_ex)
                        if _sv.ambiguous:
                            _clarify = _sv.to_event()
                            emit("clarify", _clarify)
                            emit("done", {})
                            return _AnswerCoreResult(outcome="clarify", clarify=_clarify,
                                                     guard_receipts=receipts)
                        if _sv.unchecked:
                            # GM-4 — a reading that could not be run is not a reading that agreed: the
                            # probe did not decide, and the answer says so rather than passing it.
                            _receipt({"guard": "ambiguity_probe", "action": "caveated",
                                      "detail": (f"{_sv.unchecked} of {len(_cands)} readings of the question "
                                                 "could not be run, so whether it has more than one reading "
                                                 "was not checked")})
            except Exception:
                logger.debug("ambiguity probe failed; proceeding to answer", exc_info=True)

        # Constrain generation with what the resolution settled (entity binding,
        # grain ceiling). The resolution itself ran ABOVE the compiler; the prepend
        # happens here — after every other prompt section — so the settled facts
        # stay the topmost block the generator sees.
        if _resolution is not None and _resolution.prompt_constraints:
            prompt = _resolution.prompt_constraints + "\n\n" + prompt

        from pramanyx.agent.complexity import assess_complexity
        _cx = assess_complexity(question)
        # Run the (blocking) LLM call in a worker thread so the event loop stays
        # free to serve other pages (catalog/inbox/home) while the query runs.
        # CK-0.2: token-stream the coder's `headline` field as it is written, filling the
        # otherwise-dead SQL-generation wait with the answer's headline typing in. The deltas
        # are the RAW (pre-grounding) headline; the terminal grounded `headline` event below is
        # authoritative and overwrites the stream (self-healing, mirroring the `narrative` stream).
        # Flag off = the exact pre-streaming blocking call, byte-identical.
        # Chart-grammar: the system prompt no longer offers the combo chart (one measure
        # per exhibit; the renderer's deterministic dual-axis gate is the only door).
        # The legacy vocabulary still exists for the benchmark and custom-agent quality
        # paths, which were never gated by this and keep `CHAT_SQL_SYSTEM`.
        from pramanyx.agent.prompts import chat_sql_system as _chat_sql_system
        _chat_system = _chat_sql_system(exhibit_grammar=True)
        import queue as _hq_mod
        import threading as _hthreading
        import time as _htime
        _hl_q = _hq_mod.Queue()
        _hl_result: dict = {}

        def _hl_worker() -> None:
            # complete_streaming falls back to blocking complete() on any streaming failure,
            # so "exc" only means BOTH paths failed — re-raised below, exactly as today.
            try:
                _hl_result["ans"] = get_provider("coder").complete_streaming(
                    system=_chat_system, user=prompt, response_model=_ChatAnswer,
                    text_field="headline", on_text=_hl_q.put,
                )
            except Exception as worker_exc:
                _hl_result["exc"] = worker_exc
            finally:
                _hl_q.put(None)   # sentinel: the stream is over

        # The turn's context goes with the call (its trace, its org, its metering): a bare Thread starts with an empty
        # one, so the headline's model call was written under no trace — dropped, until 2026-11-09 — on every turn.
        import contextvars as _hctx
        _hl_thread = _hthreading.Thread(target=_hctx.copy_context().run, args=(_hl_worker,), daemon=True,
                                        name="headline-stream")
        _hl_thread.start()
        # Drain partials → SSE deltas, throttled (grew ≥6 chars or >120ms) — a headline is
        # short, so a tighter throttle than the narrative keeps it typing smoothly.
        _hl_last_len, _hl_last_ts = 0, _htime.monotonic()
        _HL_EMPTY = object()

        def _hl_poll():
            try:
                return _hl_q.get(True, 0.25)
            except _hq_mod.Empty:
                return _HL_EMPTY

        while True:
            _hitem = _hl_poll()
            if _hitem is _HL_EMPTY:
                # Cancellation checkpoint. This branch ticks every 250 ms for the
                # whole coder round-trip — one of the two longest un-emitting
                # stretches of the turn — so a client that left stops paying here
                # rather than at the next frame.
                if cancelled():
                    raise _CoreCancelled()
                continue
            if _hitem is None:
                break
            if not isinstance(_hitem, str):
                continue
            _hnow = _htime.monotonic()
            # PENDING item 22 — this headline is written BEFORE its query runs, so a number in it is a prediction:
            # its words may type in, and it stops at the word holding its first digit until the rows are in (the
            # grounded headline replaces it then).
            _hshown = _numberless_prefix(_hitem)
            _held = len(_hshown) < len(_hitem.rstrip())       # at a number: flush the words before it now
            if len(_hshown) > _hl_last_len and (_held or len(_hshown) - _hl_last_len >= 6
                                                or _hnow - _hl_last_ts > 0.120):
                _hl_last_len, _hl_last_ts = len(_hshown), _hnow
                emit("headline_delta", {"headline": _hshown})
        _hl_thread.join()
        if "exc" in _hl_result:
            raise _hl_result["exc"]
        answer: _ChatAnswer = _hl_result["ans"]

        final_sql = answer.sql
        # Trust-receipt provenance signals — recorded ONLY when a guard
        # demonstrably fires this turn (honest lineage, not aspirational).
        _rcpt = {"compiled": False, "defan": False, "grounded": False, "lint": False,
                 # Wave 3 / 2.3 — the user pressed "Answer anyway": the question was
                 # open to more than one reading and they asked for a best guess. That
                 # is an ASSUMPTION the answer rests on, and until now it was recorded
                 # nowhere — `guard:ambiguous_question` fires off re-derived complexity,
                 # not off the user's own decision to skip.
                 "assumed": bool(assumed_default)}
        # The semantic compiler offers a grounded reference query as a HINT in the prompt above;
        # it no longer OVERRIDES the LLM. Overriding served confidently-wrong answers whenever the
        # compiler could not faithfully express the question — a computed late-delivery condition, a
        # ratio like ROAS, a year filter, or a cross-entity join (brands⋈products): it compiled a
        # plausible-but-wrong shape and ran THAT instead of the LLM's correct SQL. We record the
        # receipt + emit the badge only when the LLM adopted the grounded query verbatim.
        if _compiled_sql:
            _norm = lambda s: " ".join((s or "").lower().split())
            if _norm(final_sql) == _norm(_compiled_sql):
                _rcpt["compiled"] = True
                emit("compiled", {
                    "intent_type": _compiled_intent.intent_type,
                    "entity": _compiled_intent.entity or _compiled_intent.table,
                    "measure": _compiled_intent.measure or _compiled_intent.metric,
                    "dimension": _compiled_intent.dimension,
                })
        # …and whether it started from the governed metric it was handed: said on the stream, so the metric bar counts
        # the answers that used the engine, and kept on the receipt
        # A question asking for a governed metric and nothing else is answered by the PLATFORM running its definition,
        # whatever the model wrote; the model only says what it found (2026-11-26, the user: a governed definition was
        # "only a hint" — "the basis of grounding that we claim"). A question that cuts or conditions it stays the model's,
        # started from the definition, and the receipt says whether it kept it.
        _platform_ran = False
        if _governed is not None:
            if _governed.plain and not _governed.adopted_by(final_sql):
                final_sql, _platform_ran = _governed.sql, True
                emit("sql", {"sql": final_sql})
            _governed_frame = {**_governed.frame(final_sql), "ran_by": "platform" if _platform_ran else "model"}
            if _governed.quality:
                _receipt({"guard": "metric_quality", "action": "flagged",
                          "detail": f"{_governed.label}: " + "; ".join(_governed.quality)})
            _rcpt["governed"] = bool(_governed_frame["adopted"])
            emit("governed_metric", _governed_frame)

        # ── Semantic column alignment — deterministic pre-execution check ─────
        # Catches wrong entity column (e.g. product_id used for seller analysis)
        # and injects a fix hint into SqlWriter if a rewrite is needed.
        # GM-3 — the quick path's own guards, each named here once it has RUN on the statement (a check
        # that raised is not credited); added to the result's doors after execution.
        _checked: list[str] = []
        _semantic_fix_hint = ""
        try:
            from pramanyx.tools.semantic_validator import check_entity_column_alignment
            _sem_warnings = check_entity_column_alignment(question, final_sql, schema)
            _checked.append("entity-columns")
            if _sem_warnings:
                _semantic_fix_hint = " | ".join(w.to_prompt_text() for w in _sem_warnings)
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "entity-column alignment pre-check is best-effort; executing the SQL without the hint",
                     counter="chat.semantic_alignment")

        # ── Fan-out detection (M24d) — multi-fact join amplification ───────────
        # Conservative, zero-false-positive detector (validated on 121 official
        # TPC-H/TPC-DS queries). When ≥2 satellites of a shared hub are aggregated
        # across a direct join, the totals over-count; the hint drives a directed
        # pre-aggregate rewrite below (adopted only if it re-executes cleanly).
        _fanout_fix_hint = ""
        try:
            from pramanyx.sql.fanout import detect_fanout, defan, dimension_ratio_chasm
            from pramanyx.tools.schema import parse_schema_tables as _pst
            _pst_cols = _pst(_full_schema)
            _ff = detect_fanout(final_sql, _pst_cols, dialect=db.dialect) or \
                dimension_ratio_chasm(final_sql, _pst_cols, dialect=db.dialect)
            _checked.append("fan-out")
            if _ff and not _platform_ran:
                # Deterministic de-fan FIRST (the LLM-rewrite path is only ~20%
                # reliable on a known fan-out — it returns plausible CTEs that still
                # double-count). The DISTINCT-dedup (parent_fanout) and per-satellite
                # pre-aggregate (chasm) rewrites are exact + filter-preserving (TPC-H
                # verified). Adopt only if it dry-runs clean; else fall back to the hint.
                _rw = defan(final_sql, _ff, dialect=db.dialect)
                _adopted = False
                if _rw and _rw.strip() != final_sql.strip():
                    _dry_ok, _ = db.dry_run(_rw)
                    if _dry_ok:
                        _before_sql = final_sql
                        final_sql = _rw
                        _adopted = True
                        _rcpt["defan"] = True
                        emit("sql", {"sql": final_sql})
                        emit("fanout", {"hub": _ff.hub_root, "satellites": _ff.satellites, "corrected": True})
                        _receipt({
                            "guard": "fanout_defan", "action": "rewrote_sql",
                            "detail": (f"join fans out {_ff.hub_root} across "
                                       f"{', '.join(_ff.satellites or [])} - replaced with the "
                                       "exact pre-aggregated rewrite"),
                            "before": _before_sql[:2000], "after": final_sql[:2000]})
                if not _adopted:
                    _fanout_fix_hint = _ff.to_prompt_text()
                    emit("fanout", {"hub": _ff.hub_root, "satellites": _ff.satellites})
                    _receipt({
                        "guard": "fanout_defan", "action": "hinted",
                        "detail": ("fan-out detected but no provable rewrite exists; the "
                                   "repair hint goes back to the model instead")})
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "fan-out detection/de-fan guard is best-effort; executing the original SQL",
                     counter="chat.fanout_guard")

        # ── Lint before execution — catch known anti-patterns in code, not prompts ──
        from pramanyx.sql.lint import lint as _lint_sql, error_hint as _lint_hint, has_errors as _lint_has_errors
        from pramanyx.sql.writer import SqlWriter
        _lint_issues = _lint_sql(final_sql, dialect=db.dialect)
        # Entity-count grain (2026-08-14): "how many orders" answered by COUNT(*) on a
        # line-item table counts the wrong thing (Superstore: 806 vs 406). Deterministic,
        # precision-first (pramanyx/sql/grain_intent.py); rides the SAME repair round as
        # lint so it costs no extra call and its before/after lands on the receipt.
        try:
            from pramanyx.sql.grain_intent import count_star_over_finer_grain as _csfg
            from pramanyx.sql.lint import LintIssue as _LintIssue
            from pramanyx.tools.schema import parse_schema_tables as _pst_grain
            _cols_in_scope = [c for cols in _pst_grain(_full_schema).values() for c in cols]
            _grain_dx = _csfg(question, final_sql, _cols_in_scope)
            if _grain_dx:
                _lint_issues = list(_lint_issues) + [_LintIssue(
                    severity="error", rule="count_star_entity_grain",
                    message=_grain_dx, hint=_grain_dx)]
                _receipt({"guard": "count_star_entity_grain", "action": "hinted",
                          "detail": _grain_dx[:400]})
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "entity-count grain check is best-effort; the SQL runs as written",
                     counter="chat.entity_grain")
        if _lint_has_errors(_lint_issues) and not _platform_ran:
            try:
                _writer = SqlWriter(db, schema_str=schema)
                # A4 - the repair round sees what the guards already did, so a fix
                # cannot undo an adopted de-fan without knowing it existed.
                _lint_hint_txt = _lint_hint(_lint_issues)
                if _rcpt.get("defan"):
                    _lint_hint_txt += (
                        "\nGUARD ALREADY APPLIED: the SQL was de-fanned (pre-aggregated "
                        "to avoid join over-counting) - preserve that structure in your fix.")
                _before_lint = final_sql
                _lint_fix = _writer.fix(
                    final_sql,
                    "SQL quality issues detected before execution",
                    hint=_lint_hint_txt,
                    max_retries=1,
                )
                if _lint_fix.ok:
                    final_sql = _lint_fix.sql
                    _rcpt["lint"] = True
                    _receipt({
                        "guard": "sql_lint", "action": "rewrote_sql",
                        "detail": "; ".join(i.message for i in _lint_issues[:3])[:400],
                        "before": _before_lint[:2000], "after": final_sql[:2000]})
            except Exception as exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "lint auto-fix is non-fatal; proceeding with the original SQL",
                         counter="chat.lint_fix")

        # ── Scope guard — block cross-schema leakage on a scoped canvas ──────────
        # search_path pins BARE names to the canvas schema, but an EXPLICITLY
        # qualified reference to a sibling schema (e.g. `netflix.orders` for a missimi
        # canvas) bypasses search_path and would silently answer from the wrong
        # dataset. Detect any out-of-scope schema reference and force a repair.
        _scope_fix_hint = ""
        if canvas_scope_eff_schema and final_sql:
            try:
                from pramanyx.sql.tables import extract_tables
                _allowed = canvas_scope_eff_schema.strip().lower()
                # CTE-safe extraction: a sibling-schema ref hidden inside a CTE body
                # (WITH x AS (SELECT * FROM netflix.orders) ...) is still surfaced,
                # while CTE aliases (no schema) never false-trigger.
                _oos = sorted({
                    f"{_r.schema}.{_r.table}"
                    for _r in extract_tables(final_sql, db.dialect)
                    if _r.schema and _r.schema.strip().lower()
                    not in (_allowed, "information_schema", "pg_catalog", "system")
                })
                _checked.append("scope")
                if _oos:
                    _scope_fix_hint = (
                        f"OUT-OF-SCOPE TABLES {_oos}: this question is scoped to the "
                        f"'{canvas_scope_eff_schema}' schema ONLY. Rewrite using exclusively "
                        f"{canvas_scope_eff_schema}.* tables — never reference another schema."
                    )
            except Exception as _e:
                logger.debug("chat scope guard is best-effort; skipped: %s", _e)

        # The filter value-domain guard runs AFTER the pre-flight below, on the statement that will run (see there).
        _filter_fix_hint = ""
        _unchecked_caveats: list[str] = []   # GM-4 — what a guard here could not check, said on the result
        _frun = None                         # the filter guard's run over the statement that runs

        # ── Breakdown-grain guard — "top product CATEGORIES" grouped by product_id ──
        # The model sometimes groups a categorical breakdown at too fine a grain (an id),
        # ranking individual rows instead of the named dimension. Repair toward the dimension.
        _grain_fix_hint = ""
        if final_sql:
            try:
                _grain_fix_hint = _breakdown_grain_hint(question, final_sql, db.dialect)
                _checked.append("breakdown-grain")
            except Exception as _e:
                logger.debug("chat breakdown-grain guard is best-effort; skipped: %s", _e)

        # ── id-arithmetic guard — a measure multiplied by a key fabricates a magnitude ──
        # `SUM(unit_price * order_item_id)` for "revenue" multiplies price by the row's
        # PRIMARY KEY (the €150M scar when order_items has no quantity column); it runs clean
        # and over-counts silently. Force a repair toward aggregating the measure alone.
        _idmath_fix_hint = ""
        if final_sql:
            try:
                from pramanyx.sql.fanout import measure_times_key_arithmetic
                _idmath_fix_hint = measure_times_key_arithmetic(final_sql, dialect=db.dialect) or ""
                _checked.append("id-arithmetic")
            except Exception as _e:
                logger.debug("chat id-arithmetic guard is best-effort; skipped: %s", _e)

        # ── ratio-of-sums guard — AVG(a/b) is the wrong recipe for a group-level rate ──
        # Averaging per-row ratios over-weights small-denominator rows (the freight-%
        # 1.48%-vs-2.17% scar). Force a repair toward SUM(a)/NULLIF(SUM(b),0).
        _ratio_fix_hint = ""
        if final_sql:
            try:
                from pramanyx.sql.fanout import avg_of_row_ratios
                _ratio_fix_hint = avg_of_row_ratios(final_sql, dialect=db.dialect) or ""
                _checked.append("ratio-of-sums")
            except Exception as _e:
                logger.debug("chat ratio-of-sums guard is best-effort; skipped: %s", _e)

        # R6 (mode cross-pollination) — Insight had parent-fanout + dimension-ratio-chasm, but deep-analysis's
        # Verifier also runs the three aggregate-over-chasm detectors (the "SUM(inventory) after
        # joining 2.4M line-items, inflating ~1000x" class) that Insight could miss. Run the full
        # Verifier battery for parity and feed any hit into the same repair path. Best-effort.
        _chasm_fix_hint = ""
        if final_sql:
            try:
                from pramanyx.agent.verifier import Verifier as _Verifier
                from pramanyx.tools.schema import parse_schema_tables as _pst_chasm
                _vhits = _Verifier.scan([final_sql], _pst_chasm(schema), db.dialect)
                _checked.append("chasm")
                if _vhits:
                    _chasm_fix_hint = " | ".join(_vhits)
            except Exception as _e:
                logger.debug("chat chasm battery is best-effort; skipped: %s", _e)

        # R1/R2 (mode cross-pollination) — VALIDATE-THEN-EXECUTE via the SHARED safety pipeline.
        # Insight used to execute-then-repair, so a hallucinated column reached the result path as a
        # raw binder error before any repair ran. preflight_repair runs the one chain all modes share
        # (identifier repair -> dry-run -> deterministic candidate substitution -> typed LLM fix)
        # BEFORE the user-facing execute, so there is no failed first attempt visible to the user.
        if final_sql:
            try:
                from pramanyx.sql.safety import preflight_repair
                _pf_before = final_sql
                final_sql, _pf_receipt = preflight_repair(db, final_sql, schema)
                _checked.append("preflight")
                if final_sql.strip() != _pf_before.strip():
                    # Said, as the shared executor already says it (sql/executor.py): the rewrite was silent on the
                    # quick path, so its before-and-after — a query that would not bind and the one that did — was
                    # the one guard pair the training corpus never saw (PENDING item 23).
                    _what = [k for k in ("identifiers_repaired", "filter_bound", "aliases_uniquified", "fixed")
                             if (_pf_receipt or {}).get(k)]
                    _receipt({
                        "guard": "preflight_repair", "action": "repaired_sql",
                        "detail": (", ".join(_what) or "repaired before execution")
                                  + (f" ({_pf_receipt['error_class']})" if (_pf_receipt or {}).get("error_class") else ""),
                        "before": _pf_before[:2000], "after": final_sql[:2000]})
            except Exception as _e:
                logger.debug("chat pre-flight validation is best-effort; skipped: %s", _e)

        # R7 — the grounded-literal contract: a value entity resolution BOUND (verified
        # present in the data) must reach the SQL verbatim; a re-spelled drift of the
        # SAME entity is repaired deterministically, dry-run-vetted. Self-gating —
        # `_resolution` exists only when ask.resolve_first ran. Fail-open.
        if final_sql and _resolution is not None and _resolution.entity_bindings:
            try:
                from pramanyx.sql.grounded_literals import enforce_grounded_literals
                final_sql, _gl_repairs = enforce_grounded_literals(
                    final_sql, _resolution.entity_bindings,
                    getattr(db, "dialect", "duckdb"), db.dry_run,
                )
                if _gl_repairs:
                    from pramanyx.stats import stats as _gl_stats
                    _gl_stats.inc("grounded_literal_repairs")
                    logger.info("grounded-literal contract repaired %d literal(s): %s",
                                len(_gl_repairs), _gl_repairs)
            except Exception as _gl_exc:
                logger.debug("grounded-literal enforcement skipped: %s", _gl_exc)

        # ── Filter value-domain guard — catch a guessed enum value ──────────────
        # `order_status = 'cancelled'` when the data holds 'canceled' runs clean but
        # silently matches ZERO rows, so every rate reads 0%. Probe the column's real
        # domain and ask for a repair when an enumerable value is a near-miss typo.
        # It reads the statement that will RUN — after the pre-flight has bound what it can. It used to read the
        # model's statement before the pre-flight, so a finding the pre-flight had already fixed still asked the
        # model for a repair; on theLook (2026-09-29) that repair re-wrote `country = 'Brasil'` back to 'Brazil',
        # was adopted, and 0 shipped where the answer is 4,458. A novel literal (in no column) is an honest
        # absence and never a repair target — a "fix" that drops the predicate answers another question; it is
        # said as a caveat instead.
        if final_sql:
            try:
                from pramanyx.sql.join_guard import filter_domain_check
                _frun = filter_domain_check(db, final_sql)
                _checked.append(_frun.door)
                _unchecked_caveats.extend(_frun.caveats())
                _fw_actionable = [w for w in _frun.findings if not getattr(w, "novel", False)]
                if _fw_actionable:
                    _filter_fix_hint = " | ".join(w.to_prompt_text() for w in _fw_actionable)
            except Exception as _e:
                logger.debug("chat filter value-domain guard is best-effort; skipped: %s", _e)

        _checkpoint()   # before the user-facing execute — the query is not free either
        if frame_only:
            # AO-1c — the agent evaluation stops HERE: the statement is what the production
            # path would run (its prompt carried the agent's brief, documents, packs, schema
            # scope, metrics and corrections; the lint, preflight and grounded-literal guards
            # have already rewritten it), and the caller executes it against the golden's
            # reference on its own door. Nothing below this line runs: no execute, no
            # narrative, no `save_chat_turn` — an evaluation must not become a chat turn.
            return _AnswerCoreResult(
                outcome="framed", sql=final_sql, headline="",
                guard_receipts=list(receipts), doors=list(_checked),
                chart_type=getattr(answer, "chart_type", "auto") or "auto",
                intent=getattr(answer, "intent", "") or "",
                approach=list(getattr(answer, "approach", []) or []),
            )
        # A declared metric is its formula AND the rows it is over: the filters of the metrics the PERSON asked about go
        # on the statement before it runs, as the shared executor puts them on the conversation's and the deep runs'
        # (`sql/executor.execute_guarded`). This path never went through it, so its answers carried the governed badge
        # with the filter left off (the grounding audit, 2026-11-26). A rewrite that does not dry-run is not adopted,
        # and the answer then says its figure is not the declared one.
        try:
            from pramanyx.semantic.enforcement import rules_for_statement
            from pramanyx.sql.metric_filter_guard import enforce_metric_filters
            _rules = rules_for_statement(connection_id, _persist_q or question, dialect=db.dialect)
            if _rules:
                _checked.append("declared-filter")
                _rw, _applied = enforce_metric_filters(final_sql, _rules, dialect=db.dialect)
                if _applied:
                    _what = "; ".join(dict.fromkeys(
                        f"{a['metric']} is read over {a['said']}" if a.get("said")
                        else f"{a['metric']} is declared over {a['filter']} on {a['table']}" for a in _applied))
                    if db.dry_run(_rw)[0]:
                        _receipt({"guard": "declared_filter", "action": "rewrote_sql", "before": final_sql, "after": _rw,
                                  "detail": f"{_what} — every figure this statement computes there is over those rows"})
                        final_sql = _rw
                        _checked.append("repaired:declared-filter")
                    else:
                        _receipt({"guard": "declared_filter", "action": "flagged", "before": final_sql,
                                  "detail": f"{_what} — the filter could not be added, so it executes as written"})
                        _unchecked_caveats.append(f"declared-filter guard: {_what}, and this statement does not apply "
                                                  "it — its figure is not the declared one")
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "the declared-filter guard is fail-open; the statement executes as written",
                     counter="chat.declared_filter_guard", conn_id=connection_id)
        # A declared business rule the question names ("completed orders" — orders.status in ('Complete')) is kept
        # to: a statement that reads it off another table is repaired once, and when the repair still misreads it the
        # answer says so — the deep analyst refused such a statement; this path had the rule as prompt text alone
        # (the grounding audit, 2026-11-26).
        if _rule_frame and not _platform_ran:
            try:
                from pramanyx.ontology.rule_check import rule_misread
                _why_rule = rule_misread(_rule_frame, final_sql, db.dialect)
                if _why_rule:
                    _checked.append("declared-rule")
                    _rule_fix = SqlWriter(db, schema_str=schema).fix(final_sql, _why_rule, hint=_why_rule, max_retries=1)
                    if _rule_fix.ok and not rule_misread(_rule_frame, _rule_fix.sql, db.dialect):
                        _receipt({"guard": "declared_rule", "action": "rewrote_sql", "before": final_sql,
                                  "after": _rule_fix.sql, "detail": _why_rule[:400]})
                        final_sql = _rule_fix.sql
                        _checked.append("repaired:declared-rule")
                    else:
                        _receipt({"guard": "declared_rule", "action": "flagged", "before": final_sql,
                                  "detail": _why_rule[:400]})
                        _unchecked_caveats.append(f"declared-rule guard: {_why_rule}")
            except Exception as exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "the declared-rule check is fail-open; the statement executes as written",
                         counter="chat.declared_rule", conn_id=connection_id)
        # A metric's "never this" examples (`wrong_usage_examples`) are a check, not only prompt text: a statement that
        # computes a named metric through a form its owners warned against is repaired once, and said when it still
        # does (the grounding audit, 2026-11-26: it was labelled "drift" on the receipt and published).
        if not _platform_ran:
            try:
                from pramanyx.semantic.enforcement import check_metric_enforcement
                from pramanyx.semantic.metrics import metrics_named_in
                _warned = [m for m in metrics_named_in(_persist_q or question, connection_id)
                           if getattr(m, "wrong_usage_examples", None)]

                def _warned_forms(statement: str) -> list:
                    return [v for v in check_metric_enforcement(_persist_q or question, statement, _warned)
                            if v["status"] == "drift" and "non-governed form" in str(v.get("detail") or "")]
                _bad = _warned_forms(final_sql) if _warned else []
                if _bad:
                    _checked.append("warned-form")
                    _why_form = "; ".join(
                        f"{v['metric']} {v['detail']} — its owners wrote never: "
                        + " / ".join(next((m.wrong_usage_examples for m in _warned if m.name == v["metric"]), []))[:300]
                        + f". Its formula: {v['formula'][:300]}" for v in _bad)
                    _form_fix = SqlWriter(db, schema_str=schema).fix(final_sql, _why_form, hint=_why_form, max_retries=1)
                    if _form_fix.ok and not _warned_forms(_form_fix.sql):
                        _receipt({"guard": "warned_form", "action": "rewrote_sql", "before": final_sql,
                                  "after": _form_fix.sql, "detail": _why_form[:400]})
                        final_sql = _form_fix.sql
                        _checked.append("repaired:warned-form")
                    else:
                        _receipt({"guard": "warned_form", "action": "flagged", "before": final_sql, "detail": _why_form[:400]})
                        _unchecked_caveats.append(f"a metric is computed in a form its owners warned against: {_why_form[:300]}")
            except Exception as exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "the warned-form check is fail-open; the statement executes as written",
                         counter="chat.warned_form", conn_id=connection_id)
        emit("sql", {"sql": final_sql})
        result = _execute_chat_sql(db, final_sql)

        from pramanyx.agent.investigate import _zero_row_suspicious
        _chat_zero_diag = None
        if not result.error and result.row_count == 0:
            _chat_zero_diag = _zero_row_suspicious(final_sql)
            _checked.append("zero-row")
        # THE RESULT, AGAINST WHAT WAS ASKED — the gate between the rows and the headline. Every check above reads
        # the SQL; this one reads what came back. A total asked "by status" that returns many rows per status is
        # not that total, whatever query made it. It asks for a repair like any other check, is asked again of the
        # repair's result, and when no query answers as asked the answer SAYS SO at its head (`_not_as_asked`,
        # below) — it is not left to the reader to notice 500 rows under a headline about three statuses.
        from pramanyx.sql.grain_intent import result_finer_than_asked as _finer_than_asked
        _shape = None if result.error else _finer_than_asked(question, result.columns or [], result.rows or [])
        _shape_fix_hint = _shape.diagnosis if _shape else ""
        if not result.error:
            _checked.append("result-shape")

        # Also trigger a rewrite when semantic column warnings exist, even if
        # the SQL executed successfully (wrong columns produce wrong results silently).
        if result.error or _chat_zero_diag or _shape_fix_hint or _semantic_fix_hint or _fanout_fix_hint or _scope_fix_hint or _filter_fix_hint or _grain_fix_hint or _idmath_fix_hint or _ratio_fix_hint or _chasm_fix_hint:
            _writer2 = SqlWriter(db, schema_str=schema)
            _fix_error = (
                result.error or
                (_scope_fix_hint if _scope_fix_hint else None) or
                (_filter_fix_hint if _filter_fix_hint else None) or
                (_grain_fix_hint if _grain_fix_hint else None) or
                (_shape_fix_hint if _shape_fix_hint else None) or
                (_idmath_fix_hint if _idmath_fix_hint else None) or
                (_ratio_fix_hint if _ratio_fix_hint else None) or
                (_semantic_fix_hint if _semantic_fix_hint else None) or
                (_fanout_fix_hint if _fanout_fix_hint else None) or
                "Query returned 0 rows — the SQL logic is likely wrong."
            )
            _combined_hint = " | ".join(filter(None, [_chat_zero_diag or "", _scope_fix_hint, _filter_fix_hint, _grain_fix_hint, _shape_fix_hint, _idmath_fix_hint, _ratio_fix_hint, _semantic_fix_hint, _fanout_fix_hint, _chasm_fix_hint]))
            # THE ONE PLACE USAGE IS REFERRED TO. The first attempt was inconclusive — it failed, returned nothing, or
            # was not what was asked — so the repair is told how people query this data themselves, mined from the
            # warehouse's own history: a pointer, said as unconfirmed, never ground. An answer that came out
            # conclusive never reads it.
            if result.error or _chat_zero_diag or _shape_fix_hint:
                try:
                    from pramanyx.record.writers import usage_for
                    _usage = usage_for(connection_id, question=question, sql=final_sql)
                    if _usage:
                        _combined_hint += (" | FROM THIS WAREHOUSE'S OWN QUERY HISTORY (what people ran; mined, "
                                           "confirmed by no one — use only if it fits): "
                                           + "; ".join(c.statement.text for c in _usage))
                        _receipt({"guard": "usage_history", "action": "referred",
                                  "detail": (f"the first attempt was inconclusive, so {len(_usage)} thing"
                                             f"{'s' if len(_usage) != 1 else ''} people do in this warehouse's own "
                                             "query history were given to the repair: "
                                             + "; ".join(c.statement.text for c in _usage))[:1500]})
                except Exception as exc:
                    from pramanyx.kernel.errors import tolerate
                    tolerate(exc, "usage claims for an inconclusive answer are best-effort; the repair runs without them",
                             counter="chat.usage_history")
            try:
                fix = _writer2.fix(final_sql, _fix_error, hint=_combined_hint, max_retries=2)
                if fix.ok:
                    retry = _execute_chat_sql(db, fix.sql)
                    # PENDING item 18 — a repair asked for by a check is adopted only once that
                    # check no longer fires on it; running cleanly was all this used to ask.
                    _triggered = {_n for _n, _h in (("fanout", _fanout_fix_hint),
                                                    ("idmath", _idmath_fix_hint),
                                                    ("ratio", _ratio_fix_hint),
                                                    ("grain", _grain_fix_hint),
                                                    ("chasm", _chasm_fix_hint)) if _h}
                    from pramanyx.db.schema_render import parse_schema_tables as _pst_recheck
                    # And every SQL-only check is asked of the repair, not only the ones that asked for it: a
                    # repair made for one reason can break something else. On Lux (2026-11-14) "total GMV by order
                    # status" was first written right (3 rows); a repair asked for by another check regrouped it
                    # by order_id and status (146,621 rows) and was adopted, because grain had not fired on the
                    # original and so was not asked of the repair. A check the original passed and the repair
                    # trips is the repair's doing; the original stands.
                    _firing = _checks_still_firing(
                        fix.sql, set(_REPAIR_CHECKS), question=question, dialect=db.dialect,
                        full_cols=_pst_recheck(_full_schema),
                        schema_cols=_pst_recheck(schema))
                    _still = [_n for _n in _firing if _n in _triggered]
                    _broke = [_n for _n in _firing if _n not in _triggered]
                    # The repair's RESULT is asked what the original's was: broken down further than the question
                    # asked, it is not adopted — whether the original was too (still) or was not (the repair's doing).
                    if not retry.error and _finer_than_asked(question, retry.columns or [], retry.rows or []):
                        (_still if _shape else _broke).append("result shape")
                    # The filter guard is asked again of EVERY model repair, although it probes the warehouse
                    # (one DISTINCT per filtered column, on this path only): the model writes a new statement,
                    # and the one it wrote on theLook put back the literal the pre-flight had fixed.
                    _frun_fix = None
                    if _frun is not None and not retry.error:
                        from pramanyx.sql.join_guard import filter_domain_check as _fdc_re, filter_repair_holds
                        _frun_fix = _fdc_re(db, fix.sql)
                        if not filter_repair_holds(_frun, _frun_fix):
                            _still = [*_still, "filter"]
                    if _still or _broke:
                        _receipt({
                            "guard": "repair_recheck", "action": "kept_original",
                            "detail": ("; ".join(filter(None, [
                                f"the repair still trips {', '.join(_still)}" if _still else "",
                                f"the repair trips {', '.join(_broke)}, which the original did not" if _broke else "",
                            ])) + ", so it was not adopted and the original query stands"),
                            "before": final_sql[:2000], "after": fix.sql[:2000]})
                    elif not retry.error and (retry.row_count > 0 or not _chat_zero_diag or _shape_fix_hint or _semantic_fix_hint or _fanout_fix_hint or _scope_fix_hint or _filter_fix_hint or _grain_fix_hint or _idmath_fix_hint or _ratio_fix_hint):
                        # The adopted repair is said too (PENDING item 23): the query shown changed with no
                        # word of why, and the pair — a query that failed or tripped a check, and the one that
                        # ran clean — was kept nowhere.
                        _fired = [_n for _n, _h in (("scope", _scope_fix_hint), ("filter", _filter_fix_hint),
                                                    ("grain", _grain_fix_hint), ("result shape", _shape_fix_hint),
                                                    ("id arithmetic", _idmath_fix_hint),
                                                    ("ratio", _ratio_fix_hint), ("columns", _semantic_fix_hint),
                                                    ("fan-out", _fanout_fix_hint), ("chasm", _chasm_fix_hint)) if _h]
                        _receipt({
                            "guard": "sql_repair", "action": "repaired_sql",
                            "detail": (f"the query failed: {str(result.error)[:300]}" if result.error
                                       else f"checks fired on it: {', '.join(_fired)}" if _fired
                                       else "the query returned no rows"),
                            "before": final_sql[:2000], "after": fix.sql[:2000]})
                        final_sql = fix.sql
                        result = retry
                        _checked.append("repaired")
                        if _frun_fix is not None:
                            _frun = _frun_fix          # the filter run over the statement that now answers
                        emit("sql", {"sql": final_sql})
            except Exception as exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "post-execution SQL repair is best-effort; serving the original result/error",
                         counter="chat.sql_repair")

        # GM-3 — the path is a receipt: the connection's door stamped its own steps on the result; the
        # quick path's guards, and an adopted repair, follow them.
        from pramanyx.db.doors import add as _add_doors
        _add_doors(result, [_c if ":" in _c else "repaired:model" if _c == "repaired" else f"guarded:{_c}"
                            for _c in _checked])
        if _governed is not None and _governed.quality:
            _unchecked_caveats.extend(f"{_governed.label}: {q}" for q in _governed.quality)
        if _unchecked_caveats:
            result.caveats = list(dict.fromkeys([*(result.caveats or []), *_unchecked_caveats]))
        # A filter finding still on the statement that answers — one no repair cleared, or a novel literal, which
        # is never repaired — is said beside the number, as the shared executor says it.
        if _frun is not None and _frun.findings:
            result.caveats = list(dict.fromkeys([*(result.caveats or []), *(w.caveat() for w in _frun.findings)]))
        # Arc ED, ED-1 — what the reader's access policy did to the read that answers (narrowed it, or refused it) is
        # said on the reader's answer, not only to the model in `caveats`: the conversation's `run_sql` receipt.
        from pramanyx.agent.converse_tools import policy_receipt as _policy_receipt
        _policy = _policy_receipt(result)
        if _policy is not None:
            _receipt(_policy)

        if result.error:
            from pramanyx.agent.escalate import assess_escalation
            _esc = assess_escalation(question, columns=result.columns, rows=result.rows, error=result.error)
            _esc_event = _esc.to_event() if _esc.should_offer else None
            _note_unanswered(connection_id, canvas_scope_eff_schema, final_sql, _esc.signal, result.error)
            if _esc_event is not None:
                emit("escalate", _esc_event)
            emit("error", _error_event(message=result.error, reason="query_failed"))
            return _AnswerCoreResult(
                outcome="query_failed", error=result.error, sql=final_sql,
                columns=list(result.columns or []), rows=list(result.rows or []),
                row_count=result.row_count, guard_receipts=receipts,
                receipt=dict(_rcpt), caveats=list(result.caveats or []), doors=list(result.doors or []),
                escalate=_esc_event, intent=answer.intent,
                approach=list(answer.approach or []),
                trusted=list(_trusted_used or []))

        # The verdict on the result that answers, after any repair: asked once more, of the rows about to be shown.
        _not_as_asked = _finer_than_asked(question, result.columns or [], result.rows or [])
        if _not_as_asked is not None:
            _receipt({
                "guard": "result_shape", "action": "said_not_as_asked",
                "detail": (_not_as_asked.said + (" A repair was tried and did not answer as asked either."
                                                 if _shape else "")),
                "before": final_sql[:2000]})

        # Ground the headline in the ACTUAL rows — the coder's headline is a pre-execution
        # prediction and can contradict the data it ran on.
        _grounded_headline = _ground_headline(answer.headline, result.columns, result.rows, final_sql)
        if _not_as_asked is not None:
            # A headline is a finding, and there is none: the rows are not what was asked for. The answer says that
            # where the finding would be, and why beside it (the `inspect_warning` below).
            _grounded_headline = NOT_AS_ASKED_HEADLINE
        _rcpt["grounded"] = (_grounded_headline or "") != (answer.headline or "")
        if _rcpt["grounded"]:
            _receipt({
                "guard": "headline_grounding", "action": "rewrote_headline",
                "detail": ("the model's headline was a pre-execution prediction; it was "
                           "re-grounded in the rows the query actually returned"),
                "before": (answer.headline or "")[:2000],
                "after": (_grounded_headline or "")[:2000]})
        # Narration-inversion caveat: a per-group value stated as UNIVERSAL ("all
        # orders have 3 items") over a varying result. We can't drop a user's answer,
        # so qualify it inline instead of asserting a falsehood. High-precision, so
        # this fires rarely; non-destructive (the claim stays, only gets a caveat).
        from pramanyx.agent.verify import inverted_universal_claim
        if inverted_universal_claim(_grounded_headline, result.rows):
            _grounded_headline = (
                f"{(_grounded_headline or '').rstrip('. ')} — note: this value varies "
                "across the data and is not uniform across every row."
            )
            _rcpt["narration_inversion"] = True
            logger.info("[chat] narration-inversion caveat applied to headline")
            _receipt({
                "guard": "narration_inversion", "action": "caveated_headline",
                "detail": ("a per-group value was stated as universal over a varying "
                           "result; the claim now carries its qualification")})
        # Measure-grain caveat (backstop to the prevention block): if the executed SQL
        # summed a measure at the WRONG grain (per-unit without ×quantity, or per-line
        # ×quantity), flag the number instead of asserting it. Data-detected + cached.
        from pramanyx.semantic.measure_grain import connection_measure_grains, measure_grain_misuse
        from pramanyx.tools.schema import parse_schema_tables as _parse_tc
        _mg, _qc = connection_measure_grains(connection_id, db, _parse_tc(_full_schema))
        if _mg and final_sql and measure_grain_misuse(final_sql, _mg, _qc, dialect=db.dialect):
            _grounded_headline = (
                f"{(_grounded_headline or '').rstrip('. ')} — caution: a measure may be "
                "summed at the wrong grain (per-unit vs per-line); verify the total."
            )
            _rcpt["measure_grain"] = True
            logger.info("[chat] measure-grain caveat applied to headline")
            _receipt({
                "guard": "measure_grain", "action": "caveated_headline",
                "detail": ("a measure may be summed at the wrong grain "
                           "(per-unit vs per-line); the total carries a caution")})
        # id-arithmetic backstop: if the repair couldn't eliminate a measure×key product
        # (or a SUM/AVG over an id), the number is fabricated — caveat it instead of asserting.
        try:
            from pramanyx.sql.fanout import measure_times_key_arithmetic as _idmath
            if final_sql and _idmath(final_sql, dialect=db.dialect):
                _grounded_headline = (
                    f"{(_grounded_headline or '').rstrip('. ')} — caution: this total multiplies a "
                    "measure by an id/key column, so the magnitude is not trustworthy."
                )
                _rcpt["id_arithmetic"] = True
                logger.info("[chat] id-arithmetic caveat applied to headline")
                _receipt({
                    "guard": "id_arithmetic", "action": "caveated_headline",
                    "detail": ("the total multiplies a measure by an id/key column; "
                               "the magnitude is flagged untrustworthy")})
        except Exception as _e:
            logger.debug("chat id-arithmetic backstop is best-effort; skipped: %s", _e)
        # WP-1e — E1 function-semantics checks on the LIVE answer (flag `trust.e1_live`):
        # pure-AST footguns (timestamp bounded by a date-only literal, lexicographic
        # ORDER BY on numeric text, text↔numeric compare) previously ran only on
        # /query/validate — never on an answer a user actually saw. WARN-only: the
        # headline gets the caveat, the SQL is never rewritten (the E1 contract).
        if final_sql:
            try:
                from pramanyx.sql.trust_checks import connection_column_types, run_trust_checks
                # Real column types (cached) so the date-boundary check distinguishes a genuine
                # TIMESTAMP footgun from a DATE column merely named `*_at`/`*_ts` (WP-1f: the DATE
                # false positive the name heuristic would raise otherwise).
                _e1_ct = connection_column_types(connection_id, db)
                # TJ-2 — this is the QUICK body; its fires were labelled `deep` (the
                # census's defect 5) and no phase filter could tell the two apart.
                _e1_hits = run_trust_checks(final_sql, col_types=_e1_ct or None,
                                            dialect=db.dialect, phase="quick", connection_id=connection_id)
                if _e1_hits:
                    _e1_msgs = "; ".join(t.message for t in _e1_hits[:2])
                    _grounded_headline = (
                        f"{(_grounded_headline or '').rstrip('. ')} — caution: {_e1_msgs}"
                    )
                    _rcpt["e1_checks"] = [t.pattern for t in _e1_hits]
                    # Patterns are identifiers for the receipt; the MESSAGES are the
                    # prose the narrator needs (2.2) — "ratio_denominator" told to a
                    # reader explains nothing.
                    _rcpt["e1_messages"] = [t.message for t in _e1_hits[:2]]
                    logger.info("[chat] E1 trust-check caveat applied to headline: %s",
                                [t.pattern for t in _e1_hits])
                    _receipt({
                        "guard": "e1_trust_checks", "action": "caveated_headline",
                        "detail": _e1_msgs[:400]})
            except Exception as _e:
                logger.debug("chat E1 checks are best-effort; skipped: %s", _e)
        # CA-4 form-by-job: the model names the data's JOB ("magnitude", "trend",
        # …); resolve it to the engine hint here so chart_config, persistence and
        # the wire all speak forms. (The concentration→pareto auto-upgrade died
        # with the dual-axis ban — §6: no dual-axis charts, nothing upgrades into
        # one; a concentration question reads on the sorted ranking itself.)
        from pramanyx.agent.chart_vocab import resolve_chart_type
        answer.chart_type = resolve_chart_type(answer.chart_type)
        # Chart-grammar exhibit for the quick answer — computed from the result grid alone
        # (severity ramp for a single-rate ranking; point labels for a scatter). Rides inside
        # chart_config so no new event/persistence surface is needed; absent when the
        # grid has no exhibit to compute.
        from pramanyx.agent.exhibit import quick_exhibit
        _exh = quick_exhibit(result.columns, result.rows, answer.chart_type)
        if _exh:
            answer.chart_config = {**(answer.chart_config or {}), "exhibit": _exh}
        # What each column is a figure OF — its currency — rides the same way, so a caller that draws the answer
        # (the coworker) prints €17.9m where it printed 17857124.67, by the same rule the headline is labelled by.
        _units = _quick_column_units(connection_id, canvas_scope_eff_schema, final_sql, result.columns)
        # the governed metric's declared format shapes its column (the grounding audit, 2026-11-26: a FormatSpec was
        # read only by `/metrics/query`, never by an answer)
        if _governed is not None and _governed.metric in (result.columns or []):
            try:
                from pramanyx.ontology.vocabulary import format_for
                _fmt = format_for(connection_id, f"metric:{_governed.metric}")
                _fmt_unit = (f"currency:{_fmt.currency}" if _fmt and _fmt.format == "currency" and _fmt.currency
                             else "percent" if _fmt and _fmt.format == "percent" else "")
                if _fmt_unit:
                    _units = {**(_units or {}), _governed.metric: _fmt_unit}
            except Exception as _fmt_exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(_fmt_exc, "the metric's format could not be read; its column is unlabelled",
                         counter="chat.metric_format", conn_id=connection_id)
        _cur_codes = {str(u).split(":", 1)[1] for u in (_units or {}).values() if str(u).startswith("currency:")}
        if _units:
            answer.chart_config = {**(answer.chart_config or {}), "column_units": _units}
        # `doors` rides the frame that says the statement ran (GM-3); the web reads `columns` alone from it.
        emit("columns", {"columns": result.columns, "doors": list(result.doors or [])})
        emit("rows", {"rows": result.rows[:10000]})
        _grounded_headline = _apply_currency(_grounded_headline, _cur_sym, _cur_codes)
        emit("headline", {"headline": _grounded_headline})
        if _not_as_asked is not None:
            # The frame an answer already carries its doubts on, shown under the headline; `kind` says this one is
            # a verdict the platform checked, not a model's suspicion.
            emit("inspect_warning", {"issues": [_not_as_asked.said], "suggested_fix": "", "kind": NOT_AS_ASKED})
        emit("chart_type", {"chart_type": answer.chart_type})
        if answer.chart_config:
            emit("chart_config", {"chart_config": answer.chart_config})
        _tables_used = _extract_tables(final_sql)
        emit("tables_used", {"tables": _tables_used})
        if answer.intent or answer.approach:
            emit("analysis", {"intent": answer.intent, "steps": answer.approach})
        if pb_entries:
            _playbook_refs = _pb_serialize(pb_entries)
            emit("playbook_refs", {"items": _playbook_refs})
        if _trusted_used:
            emit("trusted", {"items": _trusted_used})

        # Phase 5 — progressive escalation: if the cheap answer is inconclusive (empty on an
        # analytical question, or a causal "why" answered by a single figure), OFFER a deep
        # investigation (a suggestion the user clicks — not a forced re-run).
        from pramanyx.agent.escalate import assess_escalation
        _esc = assess_escalation(question, columns=result.columns, rows=result.rows)
        _esc_event = _esc.to_event() if _esc.should_offer else None
        if _esc_event is not None:
            emit("escalate", _esc_event)
        _note_unanswered(connection_id, canvas_scope_eff_schema, final_sql, _esc.signal, "")

        # Persist, then mark DONE the moment the answer is ready — so the
        # "Completed in …" time reflects when the user got their answer, not when
        # the post-answer enrichment (inspect + follow-ups) finishes.
        _chat_inv_id = ""
        try:
            _chat_inv_id = save_chat_turn(
                question=_persist_q, connection_id=connection_id,
                headline=_grounded_headline or question,
                sql=final_sql or "", session_id=session_id, columns=result.columns,
                rows=result.rows, chart_type=answer.chart_type,
                tables_used=_extract_tables(final_sql or ""),
                intent=answer.intent, approach=answer.approach,
                canvas_id=canvas_id, purpose=purpose,
            )
            _turn_persisted = True
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "chat turn save is best-effort; the answer was already streamed (turn just won't appear in history)",
                     counter="chat.turn_save")

        # K3-wide: the chat answer becomes a versioned ledger artifact with
        # provenance — so EVERY user-facing number carries a Trust Receipt, not
        # just explorer findings. Lineage records ONLY what verifiably happened
        # this turn (executed SQL, input tables, guards that fired, registered
        # metrics available for this connection, trusted queries used).
        if _chat_inv_id and final_sql:
            _guards = []
            if _rcpt["compiled"]:
                _guards.append(("validated_by", "guard:semantic_compiler", "SQL synthesized deterministically from a typed intent"))
            if _rcpt.get("governed"):
                _guards.append(("validated_by", "guard:governed_metric",
                                (f"the platform ran the approved metric {_governed.metric}'s definition as written"
                                 if _platform_ran else
                                 f"started from the approved metric {_governed.metric}, compiled by the metric engine")))
            if _rcpt["defan"]:
                _guards.append(("validated_by", "guard:fan_out_defan", "rewrote SQL to prevent join over-counting"))
            if _rcpt["grounded"]:
                _guards.append(("validated_by", "guard:numeric_grounding", "headline corrected to match the result cells"))
            if _rcpt["lint"]:
                _guards.append(("validated_by", "guard:sql_lint", "auto-fixed a SQL quality issue before execution"))
            if _rcpt.get("narration_inversion"):
                _guards.append(("flagged", "guard:narration_inversion", "a per-group value was stated as universal; caveated inline"))
            if _rcpt.get("measure_grain"):
                _guards.append(("flagged", "guard:measure_grain", "a measure may be summed at the wrong grain (per-unit vs per-line); caveated inline"))
            if _rcpt.get("id_arithmetic"):
                _guards.append(("flagged", "guard:id_arithmetic", "a measure was multiplied by an id/key column; magnitude caveated inline"))
            if _rcpt.get("assumed"):
                # The user's own "answer anyway" — a DISCLOSED assumption, recorded on
                # the receipt so the reader can see what the answer rests on.
                _guards.append(("flagged", "guard:assumed_reading",
                                "the question was open to more than one reading and a best guess was requested; "
                                "one reading was chosen and is disclosed in the answer"))
            if _cx.ambiguous:
                # The #1 NL2SQL challenge (ambiguity): the question was under-specified.
                # Surface it honestly on the receipt rather than silently guessing.
                _guards.append(("flagged", "guard:ambiguous_question",
                                "the question was under-specified (no explicit metric/time window); answered with a default reading — refine for a different cut"))
            for _tq in (_trusted_used or []):
                _guards.append(("trusted", f"query:{(_tq.get('question') or '')[:60]}", _tq.get('note')))
            # A1b — what the answer tried: each statement it replaced (or would not), kept on its receipt
            from pramanyx.trust.answer_tried import tried as _tried_of
            _tried = _tried_of(receipts)
            _receipts = _write_answer_receipt(
                kind="chat_answer", natural_key=f"chat:{connection_id}:{_chat_inv_id}",
                question=question, sqls=[final_sql], headline=_grounded_headline or question,
                schema=schema, connection_id=connection_id, canvas_id=canvas_id,
                guard_edges=_guards,
                payload_extra={**answer_chart_payload(
                    answer.chart_type, answer.chart_config, len(result.rows), _cx.tier),
                    **({"tried": _tried} if _tried else {}),
                    # what the result says about itself (a guard that could not check, provisional days, a warned form)
                    # — on the receipt, not only on the screen (the audit, 2026-11-27: caveats empty on 230 of 230)
                    **({"caveats": list(result.caveats)} if getattr(result, "caveats", None) else {})},
            )
            # Surface the per-run receipts live (Wave 1·E4 learning · E3 activations); each is flag-gated.
            for _evt in ("learning", "activations"):
                if _receipts.get(_evt):
                    emit(_evt, _receipts[_evt])
            # WP-10: hand the UI the stable receipt id so "Why this number" opens the unified
            # public receipt (GET /receipt/{id}) — one contract across every answer mode.
            if _receipts.get("receipt_id"):
                _receipt_id = _receipts["receipt_id"]
                emit("receipt_id", {"receipt_id": _receipt_id})

            # Self-improving loop: notice ontology gaps from this real query (e.g. a
            # currency measure aggregated with no canonical metric covering it) and
            # accrue a reviewable recommendation. Best-effort, post-answer — never
            # touches the response stream.
            try:
                from pramanyx.ontology.recommendations import observe as _observe_gaps
                from pramanyx.ontology.store import load_latest_ontology as _llo
                _observe_gaps(connection_id, getattr(db, "_schema_name", None) or "default",
                              question, final_sql, _llo(connection_id), dialect=db.dialect)
            except Exception as exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "ontology-gap observation is a best-effort post-answer loop; never touches the response",
                         counter="chat.ontology_gaps")

        # Carry the turn id so the client can fetch this answer's Trust Receipt.
        emit("done", {"inv_id": _chat_inv_id, "has_receipt": bool(_chat_inv_id and final_sql)})

        # ── Post-answer enrichment (streams in after DONE, never delays it) ──
        # ONE narrator call produces BOTH the narrative and the follow-up
        # questions (was two separate round-trips). For trivial result
        # shapes (a single scalar / empty set) there's no trend to interpret, so
        # we ask only for follow-ups and skip the narrative — same single call.
        _narrative_dict = None
        _narrative_worth_it = len(result.rows) >= 2 or (len(result.rows) == 1 and len(result.columns) >= 3)
        try:
            # Bounded sample: up to 20 rows × 8 columns. For a time series, weight toward the
            # most recent periods so the narrative leads with current state, not year-one.
            _sample_rows, _is_ts = _narrator_sample(result.columns, result.rows)
            _sample_cols = result.columns[:8]
            _rows_text = "\n".join(
                ", ".join(str(r[i]) for i in range(len(_sample_cols))) for r in _sample_rows
            )
            if _narrative_worth_it:
                _ts_clause = (
                    " This result is a TIME SERIES shown as the series start then the most recent periods: "
                    "LEAD WITH THE MOST RECENT period and its current trend, and state the net change since "
                    "the start — do NOT anchor the narrative on the earliest period."
                    if _is_ts else ""
                )
                _system = (
                    "You are an analytical data interpreter writing for a clean published brief. "
                    "Given a user question, the SQL that answered it, and its results (all of them, or the first "
                    "rows of a longer result, as the results line says): "
                    "(1) " + _TITLE_CLAUSE + " "
                    "(2) produce a tight analytical narrative (2-3 sentences) that FOLLOWS THE HEADLINE without "
                    "restating it, wraps each decisive number in **double asterisks** for bold (e.g. **$2,112**, **+18%**), "
                    "names any genuine anomaly (unexpected value, spike, drop, outlier) in plain words, and "
                    "states the overall trend and your confidence. Start with the finding — no preamble, no "
                    "hedging, no 'the data shows' scaffolding. Use ONLY numbers present in the results; never "
                    "invent values, and bold never licenses invented precision." + _ts_clause + " "
                    "Then (3) " + _FOLLOWUP_CLAUSE
                )
            elif result.rows:
                _system = (
                    "Given a user question, the SQL that answered it and its result: (1) " + _TITLE_CLAUSE
                    + " Then (2) " + _FOLLOWUP_CLAUSE + " Leave the narrative empty."
                )
            else:
                _system = (
                    "Given a user question and its answer, " + _FOLLOWUP_CLAUSE
                    + " Leave the headline and the narrative empty."
                )
            _rows_label = _narrator_rows_label(_sample_rows, max(len(result.rows), result.row_count or 0), _is_ts)
            # The resolution's single caveat leads the narrator too, so the
            # narrative + follow-ups agree with the answer instead of re-deciding.
            _res_note = ""
            if _resolution is not None and _resolution.caveat:
                _res_note = (f"\n\nGROUNDED FACT — state this once, honestly, and do NOT speculate "
                             f"about other tables or grains: {_resolution.caveat}.")
            # The reader's declared organization — industry, reporting currency, fiscal
            # year. This block existed but had only three callers (profile inference,
            # the explorer, the brief), so the most-used surface in the product could
            # not see facts the operator had explicitly stated. Empty string when
            # nothing is declared, so an unconfigured org's prompt is unchanged.
            _org_note = ""
            try:
                from pramanyx.orgsettings import org_context
                _org_note = org_context(reading="this answer")
                if _org_note:
                    _org_note = "\n\n" + _org_note.rstrip("\n")
            except Exception as _org_exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(_org_exc, "org context is additive; the answer stands without it",
                         counter="ask.org_context")
            # Wave 2 / 2.2 — the narration half of the guard receipts.
            #
            # `_grounded_headline`, not `answer.headline`: the headline the USER sees
            # (line ~2174) is the one the grounding rewrite corrected and the guards
            # appended their cautions to. The narrator was being handed the RAW model
            # claim, so the prose could confidently restate a number the headline had
            # already retracted — the answer disagreeing with itself, by construction.
            #
            # `_guard_note` then lets the model SPEAK those interventions instead of
            # the user meeting them only as a clause bolted onto the headline. The
            # guards are already visible as receipt frames (A4/B2); this is the other
            # half of P1 — the answering model sees them too.
            _user = (
                f"Question: {question}\n"
                f"SQL: {final_sql}\n"
                f"Answer: {_grounded_headline}\n"
                f"{_rows_label}\n"
                f"Columns: {', '.join(_sample_cols)}\n"
                f"{_rows_text}"
                f"{_org_note}"
                f"{_res_note}"
                f"{_guard_note(_rcpt)}"
            )
            # CK-0.2 token-streaming (flag `ask.stream_text`, default ON): stream the
            # narrative as `narrative_delta` frames while the narrator writes it, then let
            # the terminal `narrative` event carry the authoritative final value —
            # self-healing (a dropped delta costs nothing; old clients ignore the unknown
            # event).
            import queue as _queue
            import threading as _threading
            import time as _time

            _pa_q: _queue.Queue = _queue.Queue()
            _pa_result: dict = {}

            def _pa_worker() -> None:
                # complete_streaming falls back to the blocking complete() internally
                # on ANY streaming failure, so "exc" only means BOTH paths failed —
                # re-raised below into the enclosing tolerate, exactly like today.
                try:
                    _pa_result["pa"] = get_provider("narrator").complete_streaming(
                        system=_system, user=_user, response_model=_PostAnswer,
                        temperature=0.2, text_field="narrative", on_text=_pa_q.put,
                    )
                except Exception as worker_exc:
                    _pa_result["exc"] = worker_exc
                finally:
                    _pa_q.put(None)   # sentinel: the stream is over

            # The turn's context goes with the call, as the headline's does: a bare Thread would write it under no trace.
            import contextvars as _pctx
            _pa_thread = _threading.Thread(target=_pctx.copy_context().run, args=(_pa_worker,), daemon=True,
                                           name="narrative-stream")
            _pa_thread.start()
            # Drain partials → SSE deltas, throttled (grew ≥12 chars since the last
            # emit, or >150ms elapsed) so a chatty stream can't spam frames. Deltas
            # go out strictly BEFORE the terminal `narrative` event, and only when the
            # answer is worth narrating (same gate the terminal event uses).
            _last_len, _last_ts = 0, _time.monotonic()
            _POLL_EMPTY = object()  # poll-timeout marker, distinct from the None sentinel

            def _pa_poll():
                # A poll timeout is the loop's heartbeat, not a failure — return a
                # marker instead of swallowing queue.Empty at the call site.
                try:
                    return _pa_q.get(True, 0.25)
                except _queue.Empty:
                    return _POLL_EMPTY

            while True:
                _item = _pa_poll()
                if _item is _POLL_EMPTY:
                    # The other 250 ms heartbeat, straddling the narrator call —
                    # same cancellation checkpoint as the coder drain above.
                    if cancelled():
                        raise _CoreCancelled()
                    continue
                if _item is None:
                    break
                if not (_narrative_worth_it and isinstance(_item, str)):
                    continue
                _now = _time.monotonic()
                if len(_item) - _last_len >= 12 or _now - _last_ts > 0.150:
                    _last_len, _last_ts = len(_item), _now
                    _delta_payload = {"narrative": _apply_currency(_item, _cur_sym, _cur_codes)}
                    emit("narrative_delta", _delta_payload)
                    # DUAL-EMIT, one release only: the retired `insight_delta` name
                    # carries the IDENTICAL payload so a client deployed before the
                    # rename keeps typing the partial. Delete once no such client
                    # remains; the frontend already prefers `narrative_delta`.
                    emit("insight_delta", _delta_payload)
            _pa_thread.join()
            if "exc" in _pa_result:
                raise _pa_result["exc"]
            _pa: _PostAnswer = _pa_result["pa"]
            # The answer's title, written now that the rows are read (the user, 2026-11-23: "Title: the answer in one
            # sentence, with its figure; never a caution or a query label"). The headline above was the coder's, written
            # with the SQL before it ran, so it names the subject — "Order counts by fulfillment status" — and cannot
            # state a figure it has not seen. Kept only when every figure in it is in the rows (`_narrated_title`); the
            # cautions the guards wrote onto the headline ride on after it, so nothing they said is lost. Not over a
            # verdict the platform checked (not as asked) or a claim a guard qualified in place.
            _titled = "" if (_not_as_asked is not None or _rcpt.get("narration_inversion")) else \
                _narrated_title(_pa.headline, result.columns, result.rows, final_sql or "")
            if _titled:
                # as each guard appends its caution: the sentence without its full stop, then the tail
                _tail = _caution_tail(_grounded_headline)
                _grounded_headline = _apply_currency(_titled.rstrip(". ") if _tail else _titled, _cur_sym, _cur_codes) + _tail
                emit("headline", {"headline": _grounded_headline})
                logger.info("[chat] the narrator's title replaced the coder's headline")
                if _chat_inv_id:
                    try:
                        from pramanyx.db.history import update_chat_turn_headline
                        update_chat_turn_headline(_chat_inv_id, _grounded_headline)
                    except Exception as exc:
                        from pramanyx.kernel.errors import tolerate
                        tolerate(exc, "the title's persistence is best-effort; it was already streamed this session",
                                 counter="chat.title_persist")
            if _narrative_worth_it and _pa.narrative:
                _narrative_dict = {
                    "narrative": _apply_currency(_pa.narrative, _cur_sym, _cur_codes),
                    "anomalies": stands_out(_pa.anomalies)[:3],
                    "trend": _pa.trend,
                    "confidence": _pa.confidence,
                }
                emit("narrative", _narrative_dict)
                # DUAL-EMIT, one release only: the retired `insight` name carries the
                # IDENTICAL payload (same dict object) so a client deployed before the
                # rename still receives the terminal value. Delete once no such client
                # remains; the frontend already prefers `narrative`.
                emit("insight", _narrative_dict)
                # Persist so the narrative survives page reload / history navigation.
                # The stored key stays `report_json["insight"]` (db/history.py) — a
                # persisted identity; renaming it would orphan every stored turn.
                if _chat_inv_id:
                    try:
                        from pramanyx.db.history import update_chat_turn_insight
                        update_chat_turn_insight(_chat_inv_id, _narrative_dict)
                    except Exception as exc:
                        from pramanyx.kernel.errors import tolerate
                        tolerate(exc, "narrative persistence is best-effort; it was already streamed this session",
                                 counter="chat.insight_persist")
            if _pa.questions:
                _followups = list(_pa.questions[:3])
                emit("followups", {"questions": _followups})
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "post-answer narrative/follow-up enrichment is best-effort; the answer is already done",
                     counter="chat.post_answer")

        # Semantic inspect — the model-based judge: does this statement, with these rows, answer the question?
        # From Phase 3 of the ground-first redesign until 2026-11-14 it was SKIPPED whenever the resolution ran, on
        # the premise that the resolution's verdict had already settled entity, grain, measure and scope. The receipt
        # of 2026-11-14 falsified that for grain (a per-order result under a headline about statuses, resolution
        # run, nothing said), and the resolution judges the question BEFORE the SQL is written or repaired, so it
        # cannot see what a repair did. The judge reads the statement that answers, so it runs on every answer the
        # result gate did not already rule on: one narrator call. It is grounded on the schema slice so it cannot
        # invent columns, and its word is a suspicion ("may"), where the gate's is a verdict.
        if _not_as_asked is None:
            try:
                from pramanyx.sql.inspect import inspect as _inspect_sql
                _ir = _inspect_sql(question, final_sql, result.columns, result.rows,
                                   schema=_full_schema)
                if not _ir.valid and _ir.issues:
                    emit("inspect_warning", {
                        "issues":        _ir.issues,
                        "suggested_fix": _ir.suggested_fix,
                    })
            except Exception as exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "post-answer semantic inspect is best-effort validation; skipping the warning",
                         counter="chat.inspect")

        return _AnswerCoreResult(
            outcome="answered",
            headline=_grounded_headline or "",
            sql=final_sql or "",
            columns=list(result.columns or []),
            rows=list(result.rows or []),
            row_count=result.row_count,
            guard_receipts=receipts,
            receipt=dict(_rcpt),
            caveats=list(result.caveats or []),
            doors=list(result.doors or []),
            chart_type=answer.chart_type,
            chart_config=dict(answer.chart_config or {}),
            intent=answer.intent,
            approach=list(answer.approach or []),
            tables_used=_tables_used,
            escalate=_esc_event,
            inv_id=_chat_inv_id,
            receipt_id=_receipt_id,
            trusted=list(_trusted_used or []),
            playbook_refs=_playbook_refs,
            narrative=_narrative_dict,
            followups=_followups,
        )
    except _CoreCancelled:
        # The user stopped, or walked away and the client went with them. Everything the
        # turn produced up to here was streamed and then, until now, dropped: the persist
        # at the end of the happy path is the ONLY writer, and cancellation raises long
        # before it. So an interrupted turn left no trace — not in History, not anywhere —
        # and reloading the page lost an answer the user had already partly read.
        #
        # It is filed as `interrupted`, never `complete`: a turn stopped mid-flight has no
        # verified answer, and "complete" would claim one. That is the same distinction
        # `UNCERTAIN_RESULT` draws for a dropped stream — interrupted is not failed either,
        # because nothing went wrong.
        #
        # Best-effort by construction. A turn the user abandoned must not be able to raise
        # on its way out, so a failed flush is swallowed and the cancellation continues.
        try:
            if not _turn_persisted and (_seen.get("headline") or _seen.get("sql")):
                save_chat_turn(
                    question=_persist_q, connection_id=connection_id,
                    headline=_seen.get("headline") or question,
                    sql=_seen.get("sql") or "", session_id=session_id,
                    columns=_seen.get("columns") or [], rows=_seen.get("rows") or [],
                    chart_type=_seen.get("chart_type") or "none",
                    tables_used=_extract_tables(_seen.get("sql") or ""),
                    canvas_id=canvas_id, purpose=purpose,
                    status="interrupted",
                )
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "interrupted-turn flush is best-effort; the turn was already "
                          "abandoned and the cancellation must not be blocked by it",
                     counter="chat.interrupted_flush")
        raise
    finally:
        try:
            db.close()
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "chat stream connection close is best-effort cleanup",
                     counter="chat.db_close")


#: The public seam for the converse `answer_question` tool (pramanyx/agent/converse_tools.py)
#: — a second caller of the SAME body the SSE wrapper streams from, which is what makes
#: tool/direct parity hold by construction rather than by assertion. Public on purpose:
#: the private-import ratchet (test_kernel_contracts) is right that another module should
#: not reach for an `_internal`, and an alias beats a rename that would orphan the
#: transcript, bridge and scope nets all pointing at `_answer_core`.
answer_core = _answer_core


async def _core_frames(
    run: Callable[[Callable[[str, dict], None], Callable[[], bool]], object],
) -> AsyncGenerator[tuple, None]:
    """Run a sync body on the answer pool and yield the ``(type, payload)`` pairs it emits.

    The sync->async frame bridge, once, for both bodies that need it. It yields TUPLES,
    never encoded SSE, and that is deliberate on two counts: the caller decides the
    envelope, and this function names no frame — so the frame-parity guard, which reads
    this file as text, still finds every frame declared at a literal emission site
    rather than hidden behind a shared relay.

    ``run(emit, cancelled)`` is the body. ``emit`` takes a frame name and a flat payload
    and raises ``_CoreCancelled`` once the consumer has gone away; ``cancelled()`` is the
    same signal for the stretches that emit nothing.

    The mechanism is the repo's existing sync->async bridge (``agent/progress.py``,
    feeding the deep path): one producer thread, ``call_soon_threadsafe`` scheduling each
    ``put_nowait`` on the loop in FIFO order, so emission order survives the hop, and an
    unbounded queue so the producer never stalls. What changes semantically is that a
    slow client no longer back-pressures the computation: the answer is computed and
    persisted at full speed and the queue buffers. Depth is bounded in practice because
    both delta loops are throttled at the source.

    How a caller knows finished-from-raised: it does not ask the sentinel, this awaits
    the future. ``_CORE_DONE`` only terminates the STREAM; ``await fut`` then either
    returns the body's result or re-raises its exception INSIDE the consumer's frame,
    where an ``except Exception -> error`` and ``_metered_stream``'s ``BudgetExceeded``
    handler both work exactly as they did when this was one function.
    """
    from pramanyx.kernel import cancellation

    loop = asyncio.get_running_loop()
    frames: asyncio.Queue = asyncio.Queue()
    cancel = threading.Event()
    # `emit` and `cancelled()` only reach code that emits or checks; a phase can make
    # several model calls between the two. The stop scope reaches the model funnel itself.
    stop = cancellation.StopScope(cancellation.current())

    def _emit(t: str, p: dict) -> None:        # runs on the WORKER thread
        if cancel.is_set():
            raise _CoreCancelled()
        loop.call_soon_threadsafe(frames.put_nowait, (t, p))

    def _work():
        try:
            with cancellation.scope(stop):
                return run(_emit, cancel.is_set)
        finally:
            loop.call_soon_threadsafe(frames.put_nowait, _CORE_DONE)

    # On the dedicated pool, not `asyncio.to_thread`: to_thread borrows a DEFAULT-executor
    # worker for the whole turn, and that pool is shared with every router's short
    # offload hop — see `_ANSWER_CORE_POOL` for the measured head-of-line blocking this
    # caused. The pool copies contextvars per task, so metering still crosses the hop.
    fut = loop.run_in_executor(_ANSWER_CORE_POOL, _work)
    try:
        while True:
            try:
                item = await asyncio.wait_for(frames.get(), timeout=KEEP_ALIVE_EVERY)
            except asyncio.TimeoutError:
                yield (_KEEP_ALIVE, None)              # nothing to send yet: the stream is kept open
                continue
            if item is _CORE_DONE:
                break
            yield item
        await fut                              # success vs raise is decided HERE
    finally:
        cancel.set()
        if not fut.done():
            # Only an ABANDONED body is stopped: one that finished may have handed work
            # to a background thread that must outlive the turn.
            stop.stop("its reader went away before the answer finished")
            # The body cannot be interrupted mid-call, and awaiting it here would
            # hold teardown for the rest of the turn. Retrieve the exception in a
            # callback instead, so an orphan that raises does not log
            # "Task exception was never retrieved".
            fut.add_done_callback(lambda f: f.cancelled() or f.exception())


async def _stream_chat(
    question: str,
    connection_id: str,
    history: list[ChatHistoryTurn],
    session_id: str = "",
    canvas_id: Optional[str] = None,
    skip_clarify: bool = False,
    purpose: str = "",
    schema_scope: Optional[str] = None,
    assumed_default: bool = False,
    surface: str = "",
    brief_period: str = "",
) -> AsyncGenerator[str, None]:
    """The streaming half: run ``_answer_core`` on a worker thread and yield what it says.

    A nested function cannot yield on behalf of its caller, so the moment the core's
    48 ``yield _sse(...)`` became ``emit(...)`` the function stopped streaming — the
    bridge in :func:`_core_frames` is what gives it back, and why the two changes had to
    land together.

    All this adds to the bridge is the ENVELOPE: re-encode each relayed pair, and render
    a raised failure as the terminal ``error`` frame. `aclose()` is explicit because the
    bridge is now a nested generator: without it, a client that leaves mid-turn would
    leave the inner generator's cancellation to whenever the garbage collector got
    around to it, and the core would keep paying in the meantime.
    """
    def _run(emit, cancelled):
        return _answer_core(
            question, connection_id, history, emit=emit, cancelled=cancelled,
            session_id=session_id, canvas_id=canvas_id, skip_clarify=skip_clarify,
            purpose=purpose, schema_scope=schema_scope,
            assumed_default=assumed_default, surface=surface, brief_period=brief_period,
        )

    _bridge = _core_frames(_run)
    try:
        async for _frame_type, _frame_payload in _bridge:
            yield KEEP_ALIVE_SAID if _frame_type is _KEEP_ALIVE else _sse(_frame_type, _frame_payload)
    except _CoreCancelled:
        return
    except Exception as e:
        yield _sse("error", _error_event(e))
    finally:
        await _bridge.aclose()


#: Inner frames a converse turn does NOT forward. The rule: forward what describes the
#: WORK, suppress what describes the TURN'S LIFECYCLE — because only the wrapper knows
#: when a converse turn is over, and a tool does not.
#:
#: * ``done`` is the one that matters. Relayed raw, the client's DONE action fires while
#:   the model is still deciding whether to call another tool: the turn renders finished
#:   mid-conversation. Its ``inv_id``/``has_receipt`` are real, though, so they are kept
#:   and re-issued on the converse turn's own ``done`` rather than thrown away.
#: * ``error`` marks a DELIBERATE terminal state the core then returns from. Here that
#:   comes back to the model as a value it can recover from, so a red terminal frame
#:   followed by more work would be a lie about the turn.
#: * ``clarify`` — the inner core may hit the ambiguity probe and offer chips on a
#:   sub-question the user never asked.
#: * ``followups`` are about the model's sub-question, not the user's.
#: * ``mode`` — the wrapper decides ``final_text`` for the whole turn; a forwarded inner
#:   one would mislabel a turn that did produce SQL.
_CONVERSE_SUPPRESSED = frozenset({"done", "error", "clarify", "followups", "mode"})


#: How long a conversation turn waits for its next questions before it ends without them.
FOLLOWUPS_WAIT_S = 8.0


def _conversation_followups(question: str, answer: str, turn: dict) -> list[str]:
    """Up to three next questions for a conversation turn's answer, or [] — best-effort: the answer is already sent."""
    if turn.get("followups"):
        return list(turn["followups"])[:3]
    results = turn.get("results") or []
    if not results or not (answer or "").strip():
        return []
    last = results[-1]
    sql = str((last.get("sql") or {}).get("sql") or "")
    columns = [str(c) for c in (last.get("columns") or {}).get("columns") or []]
    rows = (last.get("rows") or {}).get("rows") or []
    try:
        from pramanyx.agent.followups import followup_system, followup_user
        from pramanyx.llm.provider import get_provider
        from pramanyx.sql.tables import extract_tables
        tables = sorted(r.qualified() for r in extract_tables(sql))
        got = get_provider("narrator").complete(
            system=followup_system(),
            user=followup_user(question, headline=answer[:600], sql=sql, tables=tables, columns=columns,
                               row_count=len(rows)),
            response_model=_FollowUpBase)
        return [q for q in (got.questions or []) if str(q).strip()][:3]
    except Exception as exc:  # noqa: BLE001
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "a conversation's next questions are best-effort; its answer is already sent",
                 counter="converse.followups")
        return []


async def _stream_converse(
    question: str,
    connection_id: str,
    history: list[ChatHistoryTurn],
    session_id: str = "",
    keep_going: str = "",
    canvas_id: Optional[str] = None,
    origin_prose: str = "",
    agent_id: str = "",
    surface: str = "",
    schema_scope: Optional[str] = None,
    brief_period: str = "",
    shape: Optional[str] = None,
    sheet: str = "",
    dashboard: Optional[tuple[str, ...]] = None,
    person: str = "",
    asked_again: bool = False,
    agent_call: bool = False,
) -> AsyncGenerator[str, None]:
    """Serve one `/ask` turn as a CONVERSATION (SP-14; unconditional since 2026-10-28).

    Same shape as :func:`_stream_chat` — the shared bridge, a different body — and
    deliberately so: one copy of the concurrency design, two bodies riding it.

    What the user sees is mostly frames they already know. A converse turn that calls
    ``answer_question`` runs the SAME ``answer_core`` the fast path streams from, so its
    ``sql`` / ``columns`` / ``rows`` / ``guard_receipt`` frames mean exactly what they
    always meant and are forwarded verbatim. Synthesizing them instead from the tool's
    returned dict would be a second emission site for the same values, guaranteed to
    drift from the first; suppressing them would make the SMARTER path the one with no
    visible receipts, which is the wrong asymmetry to build.

    Only ``converse_step`` is new, because only "the model chose a tool" is new. The
    turn's terminal ``headline`` is the model's own prose and lands last, where the
    client's replace-semantics make it win over the tool's inner headline — which is
    what lets a converse turn render with no frontend work at all.

    Budget exhaustion ends on a ``headline``, not an ``error``: the loop's own comment
    is the argument ("an answer we did not reach" beats a half-derived guess), and an
    ``error`` frame renders red and discards the step trail the user can already see.
    The machine-readable marker rides on ``done`` instead.
    """
    def _run(emit, cancelled):
        from pramanyx.agent.converse_tools import converse, ground_answer_numbers
        from pramanyx.obs import session_log
        # every receipt this turn writes says what the turn was given so far (`trust.answer_inputs.start_turn`): a
        # run_sql after a held answer is written by a model that still has the first answer's Definitions
        from pramanyx.trust.answer_inputs import start_turn
        start_turn()

        # `rows` accumulates what the turn's queries actually returned — the evidence
        # the closing prose is held to. A turn may run several queries; all of their
        # cells are citable, so they pool.
        # `results` keeps each query's own result, in order, so the one the answer stands on can be the one shown
        # (`converse_tools.answering_result`) — not merely the last one run.
        turn: dict = {"steps": 0, "sql": False, "inv_id": "", "has_receipt": False,
                      "rows": [], "results": [], "followups": []}
        if sheet:
            # Arc SH — the sheet's own counts, which the conversation is handed in its grounding (the rows the sheet
            # holds, the rows the view on screen shows), are citable like any result: without them the check rewrote
            # a correct "1,783 of the 99,441 orders" down to the breakdown alone (live, trace 58a155c0).
            from pramanyx.sheets.answer import citable_counts
            turn["rows"].extend(citable_counts(sheet))

        def _forward(_frame_type: str, _frame_payload: dict) -> None:
            """The tools' frames, minus the lifecycle. Named ``_frame_type`` on purpose:
            it is the same relay claim `_stream_chat` makes — every name it carries was
            declared literally at an ``emit`` call the frame-parity parser already read."""
            if _frame_type == "done":
                # Keep the inner turn's identity; it is the row "Why this number" hangs
                # off. Taken as a PAIR so a later tool without a receipt cannot leave
                # `has_receipt` true against a different turn's id.
                if _frame_payload.get("inv_id"):
                    turn["inv_id"] = _frame_payload["inv_id"]
                    turn["has_receipt"] = bool(_frame_payload.get("has_receipt"))
                return
            if _frame_type == "followups":
                # A tool's next questions are about ITS question, so they are not streamed as they come; the last
                # one's are kept, and offered under the turn's answer when the turn stood on that tool (below).
                turn["followups"] = [str(q) for q in (_frame_payload.get("questions") or []) if str(q).strip()]
                return
            if _frame_type in _CONVERSE_SUPPRESSED:
                return
            if _frame_type == "sql":
                turn["sql"] = True
                turn["results"].append({"sql": _frame_payload})
            if _frame_type in ("columns", "rows", "chart_type") and turn["results"]:
                turn["results"][-1][_frame_type] = _frame_payload
            if _frame_type == "rows":
                turn["rows"].extend(_frame_payload.get("rows") or [])
            if _frame_type == "sheet_rows":
                # Arc SH — the rows a sheet question put on the grid, counted by the grid: citable like
                # any result, so "1,783 of 99,441" is held to the count the card shows.
                turn["rows"].append([_frame_payload.get("rows"), _frame_payload.get("of"),
                                     _frame_payload.get("share")])
            emit(_frame_type, _frame_payload)

        def _on_step(step) -> None:
            # The loop's ONLY cancellation checkpoint. `answer_core` checkpoints inside
            # itself, so the gap this closes is BETWEEN steps: without it a client that
            # left still buys every remaining provider round-trip.
            if cancelled():
                raise _CoreCancelled()
            turn["steps"] += 1
            emit("converse_step", {
                "index": turn["steps"],
                "tool": step.tool,
                "arguments": {k: str(v)[:400] for k, v in (step.arguments or {}).items()},
                "ok": step.ok,
                "detail": str(step.detail or "")[:500],
                "result_chars": step.result_chars,
                # the tool said no, its reason in `detail` (2026-11-20): drawn as a refusal, not a done step
                "refused": bool(getattr(step, "refused", False)),
            })
            # The trail, in the log the flag's exit receipt reads. `name=step.tool` folds
            # into the existing per-tool reliability aggregate, which is the honest place
            # for it — these ARE tool calls.
            session_log.emit(session_log.TOOL_CALL_RESULT, name=step.tool,
                             conn_id=connection_id, ok=step.ok,
                             payload={"body": "converse", "detail": str(step.detail or "")})

        # CI-1b — the conversation body gets the same two memories the quick body does:
        # this session's turns, and what this question was answered before elsewhere.
        # CI-4 adds the third: the origin finding a seeded/dossier turn is ABOUT,
        # rendered by the same code the deep path anchors on.
        # Arc SH — a question asked beside a sheet keeps its own conversation and is NOT handed what the same question
        # was answered before elsewhere: the sheet on screen is its grounding, an earlier answer may predate the edits
        # people made since, and earlier answers' shape pulled the model back to it — a breakdown after the rows card,
        # and "The earlier answers in this session…" in a conversation that had none (live, trace bf4d145e).
        _memory = build_history_section(history) + ("" if sheet or asked_again else build_prior_answers_section(
            resolve_prior_answers(question, connection_id, session_id)))
        # Ask again (2026-11-23): the person wants the question answered afresh — seen live, a repeat ran nothing and
        # wrote the earlier answer's figures from what it held. It is told so, and is not handed earlier answers.
        if asked_again:
            _again = ("ASKED AGAIN — the person asked this question again for a fresh answer. Run it again with a "
                      "query and answer from that query's rows; do not repeat an earlier answer's figures.")
            _memory = _again + "\n\n" + _memory if _memory else _again
        if origin_prose:
            _memory = origin_prose + "\n\n" + _memory if _memory else origin_prose
        # Stage 4 (2026-11-20): a request of several parts is said to be one, with the ability for each part
        from pramanyx.agent.orchestrate import parts_note
        _parts = parts_note(question)
        if _parts:
            _memory = _parts + "\n\n" + _memory if _memory else _parts
        # Keep going (2026-11-20): the last turn on this question stopped at its step limit; it goes on from there
        if keep_going.strip():
            _kg = ("## Keep going\nThe person asked to keep going: the last turn on this question stopped at its step limit "
                   "after these steps:\n" + keep_going.strip()[:4000] + "\nContinue from there. Do not repeat a step that "
                   "already worked, and do not call again a tool that said no.")
            _memory = _kg + "\n\n" + _memory if _memory else _kg
        # Summon surface (SP-2, §3.11) — same one-line orientation the quick path
        # prepends, same sanitation, '' from every door but the ⌘K overlay.
        if surface:
            _surf = " ".join(str(surface).split())[:48]
            if _surf:
                _line = (f"ASKED FROM — the user summoned this question from the "
                         f"'{_surf}' screen of the product.")
                _memory = _line + "\n\n" + _memory if _memory else _line
        # The turn's scope, said, because the tools now keep to it: the quick body already
        # answered inside the request's schema, and this body handed its tools the bare
        # connection — `workspace` / `uber_ncr` answered from two other datasets (trace
        # f6c0d51e). Empty with no scope, so every other prompt is byte-identical.
        if schema_scope and not canvas_id:
            _scope_line = (f"SCOPE — this conversation is pinned to schema '{schema_scope}'. Its "
                           f"tools list and query only that schema's tables; a question its "
                           f"tables cannot answer is said to be outside this schema, never "
                           f"answered from another dataset on the connection.")
            _memory = _scope_line + "\n\n" + _memory if _memory else _scope_line
        elif canvas_id:
            # The user, 2026-11-23 — a Data Canvas is strict, and the door now refuses a statement reading
            # another table; the conversation is told so before it writes one, and in the words its answer uses.
            from pramanyx.canvas.scope import resolve_execution_scope as _canvas_scope
            _hold = _canvas_scope(connection_id, canvas_id).held()
            if _hold is not None:
                _reads = ", ".join(_hold.tables) if _hold.tables else f"the tables of schema '{_hold.schema}'"
                _scope_line = (f"SCOPE — this conversation is on the Data Canvas '{_hold.name}'. It reads only "
                               f"{_reads}; a statement reading any other table is refused. A question those "
                               f"tables cannot answer is said to be outside this canvas, never answered from "
                               f"another table.")
                _memory = _scope_line + "\n\n" + _memory if _memory else _scope_line
        # "Ask this briefing" — the Briefing the user has open, read server-side from the
        # same entry it rendered (the RANGE entry when a period is open), with its period
        # and its Key Metrics tiles. This body never read it: the brief block lived only in
        # the quick body's prompt, behind a tool call that carried no schema.
        from pramanyx.knowledge.brief_context import BRIEFING_SURFACE, brief_block_for_scope
        if surface == BRIEFING_SURFACE:
            try:
                _brief_sec = brief_block_for_scope(connection_id, schema_scope, canvas_id,
                                                   period_key=brief_period, from_briefing=True,
                                                   scope_key=_briefing_scope_key(connection_id, schema_scope,
                                                                                 canvas_id))
            except Exception as _brief_exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(_brief_exc, "brief grounding is best-effort; answering without the brief",
                         counter="converse.brief_section")
                _brief_sec = ""
            if _brief_sec:
                _memory = _brief_sec + "\n" + _memory if _memory else _brief_sec
        try:
            from pramanyx.briefing.compose.sources import known_context
            _known_sec = known_context(connection_id, schema_scope)
        except Exception as _known_exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(_known_exc, "the platform's earlier work is best-effort context; answering without it",
                     counter="converse.known_section")
            _known_sec = ""
        if _known_sec:
            _memory = _known_sec + "\n" + _memory if _memory else _known_sec
        # VA-9c — the agent record, so its GRANTS decide whether a write tool exists at
        # all on this turn. Resolved here rather than passed as an id: the tool roster is
        # bound by closure precisely so the model cannot name an agent it was not given.
        _agent_rec = None
        if agent_id:
            try:
                from pramanyx.custom_agents.store import get_agent
                _agent_rec = get_agent(agent_id)
            except Exception as _exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(_exc, "agent lookup for tool grants is best-effort — an "
                               "unreadable agent means READ-ONLY, never open",
                         counter="converse.agent_lookup")
        # One trace for this turn's decision records. Chosen HERE, before the loop, because
        # a conversational turn has no investigation id until `save_chat_turn` mints one
        # from the answer below — so the picks are recorded against the trace and stitched
        # to the investigation afterwards. Without it every converse decision is a row no
        # verdict can ever close. TJ-1: it is the RUN's ambient trace (bound by
        # `build_ask_stream`), the same id the session log and the history row carry —
        # a fresh uuid here joined nothing on 188 of 188 rows (the census's defect 2).
        # A fresh id only when no trace is bound, so a caller outside the door still
        # gets rows a verdict can close.
        import uuid as _uuid
        from pramanyx.telemetry import current_trace_id as _ambient_trace
        _decision_trace = _ambient_trace() or _uuid.uuid4().hex
        try:
            result = converse(connection_id, question,
                              extra_context=_memory,
                              on_step=_on_step, tool_emit=_forward,
                              session_id=session_id, canvas_id=canvas_id, agent=_agent_rec,
                              trace_id=_decision_trace, schema_scope=schema_scope, shape=shape,
                              sheet=sheet, dashboard=dashboard, person=person,
                              agent_call=agent_call and not asked_again)
        except _CoreCancelled:
            raise
        except Exception as _exc:
            from pramanyx.agent.converse_tools import remember_tools_refused, tools_unsupported
            if turn["steps"] or not tools_unsupported(_exc):
                raise
            # PENDING item 17 — the binding cannot make a tool call, and said so on the turn's
            # first request: nothing has been answered yet, so the quick body answers instead,
            # and the step trail says why. Remembered, so the next turn routes there at once.
            remember_tools_refused()
            emit("converse_step", {
                "index": 1, "tool": "(none)", "arguments": {}, "ok": False,
                "detail": ("this model cannot call tools, so the conversation could not run — "
                           f"answered by the quick pipeline instead ({str(_exc)[:160]})"),
                "result_chars": 0,
            })
            return _answer_core(question, connection_id, history, emit=emit, cancelled=cancelled,
                                session_id=session_id, canvas_id=canvas_id, surface=surface,
                                schema_scope=schema_scope, brief_period=brief_period)

        answer = (result.answer or "").strip()
        if not answer:
            # Say what actually happened. `stop_reason` distinguishes three different
            # failures that used to share one sentence, and the sentence named the one
            # that was usually WRONG: a turn that stopped after a single step of a
            # budget of eight still reported "I ran out of steps", which sends the
            # reader off to narrow a question that was never the problem.
            steps_n = len(result.steps)
            if result.stop_reason == "budget":
                # never "ask a narrower question" (2026-11-20): the question was rarely the problem — Keep going is
                answer = (
                    f"I used all {steps_n} steps this turn before finishing. What each step found is above. "
                    "Keep going picks up from there."
                )
            elif result.stop_reason == "silent":
                answer = (
                    f"I stopped without an answer after {steps_n} "
                    f"{'step' if steps_n == 1 else 'steps'} — the model returned no "
                    "tool call and no text, twice. What each step found is above. "
                    "Asking again usually clears it."
                )
            else:
                answer = (
                    f"I finished without producing an answer ({steps_n} tool "
                    f"{'call' if steps_n == 1 else 'calls'}). What each step found is "
                    "above — asking again, or more specifically, usually gets there."
                )
        # An agent's working notes are never its answer (the user's rule; found live 2026-11-15, when one out of tool
        # calls stopped mid-thought and the paragraph was shown at headline size). The loop hands a draft like that
        # back once (`converse_tools.working_notes`); one that is still working at the end is not shown. What it
        # wrote is kept on the receipt, where a reader can open it as what it is.
        from pramanyx.agent.converse_tools import working_notes
        if working_notes(answer):
            emit("guard_receipt", {"guard": "working_notes", "action": "withheld the answer",
                                   "detail": "the model stopped with its own working, not an answer",
                                   "before": answer[:500]})
            answer = ("I didn't reach an answer — I stopped while still working it out. What each step found is "
                      "above; asking again, or more narrowly, usually gets there.")
        # Every other number this turn shows the user came from a result set; until
        # now the sentence above them did not, and nothing compared the two. A model
        # that writes a plausible table the rows do not contain is the one failure the
        # user cannot catch — the chart beside it looks authoritative either way.
        from pramanyx.agent.converse_tools import citable_totals
        answer, _ground_receipt = ground_answer_numbers(
            answer, turn["rows"] + citable_totals(turn["results"]), question=question)
        if _ground_receipt is not None:
            emit("guard_receipt", _ground_receipt)

        # The result shown is the one the answer stands on. Every reader keeps the last `sql`/`columns`/`rows` it was
        # sent, so when that is not the last one run, it is sent again, whole, before the headline.
        from pramanyx.agent.converse_tools import answering_result
        _shown = answering_result(answer, [{"rows": (r.get("rows") or {}).get("rows") or []} for r in turn["results"]])
        if 0 <= _shown < len(turn["results"]) - 1:
            _was = turn["results"][_shown]
            emit("sql", _was["sql"])
            if "columns" in _was:
                emit("columns", _was["columns"])
            if "rows" in _was:
                emit("rows", _was["rows"])
            if "chart_type" in _was:
                emit("chart_type", _was["chart_type"])

        if not turn["sql"]:
            # No SQL this turn ⇒ the same shape the core's own no-SQL paths use, so a
            # text-only converse answer renders exactly like a definitional one does.
            emit("mode", {"query_mode": "final_text"})
        emit("headline", {"headline": answer})
        # The next questions under the answer (2026-11-23: the Ask panel's and a Data Canvas's answers offered none,
        # the coworker's did — the conversation dropped every tool's `followups`). The tool's own when the turn read
        # through `answer_question` (already paid for); else, when a query ran, one call over that query's artifact, as
        # the deep path makes them; none for a turn that read no rows.
        # Asked beside the filing below, and waited on for a few seconds at most before `done`: on a slow model a
        # call takes a minute, and the turn reads as finished only at `done`.
        import contextvars as _cv
        import threading as _th
        _next_box: dict = {}
        _next_thread = _th.Thread(
            target=_cv.copy_context().run,
            args=(lambda: _next_box.__setitem__("q", _conversation_followups(question, answer, turn)),),
            daemon=True, name="converse-followups")
        _next_thread.start()
        # The turn spent every step (2026-11-20): Keep going picks up from where it stopped, with the steps it took
        if result.stop_reason in ("budget", "budget_answered"):
            from pramanyx.agent.orchestrate import found_lines
            emit("keep_going", {"steps": len(result.steps), "found": found_lines(turn["results"])})

        # RC-2 — file the exchange when nothing else did. A converse turn that
        # called a tool already has a row: `answer_core` writes one and returns
        # its id on the inner `done`, which is what `turn["inv_id"]` holds. A
        # turn answered from memory, context or the briefing calls no tool and
        # so writes NOTHING — invisible on the web, where the client holds the
        # thread until a reload, and a HOLE everywhere else: a headless door
        # (Slack, MCP) keeps no client-side copy, so the conversation it files
        # under loses exactly the follow-ups that make it a conversation. Seen
        # live — an "are you sure?" answered in a Slack thread, then absent
        # from the conversation the next turn rebuilds its history from.
        #
        # Only when nothing was filed, never in addition: two rows for one
        # exchange would double-count every reader that counts turns, and the
        # tool's row is the better one (it carries the SQL and the receipt).
        if not turn["inv_id"]:
            try:
                turn["inv_id"] = save_chat_turn(
                    question=question, connection_id=connection_id,
                    headline=answer, sql="", session_id=session_id,
                    canvas_id=canvas_id,
                )
            except Exception as exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "filing a conversational turn is best-effort — the answer "
                              "has already been sent either way",
                         counter="converse.file_turn")

        # The turn now has an id, so its decisions can be found by a later verdict.
        # Best-effort, after the answer: an unattached decision costs a learning row, not
        # an answer.
        if turn["inv_id"]:
            from pramanyx.learning.decisions import attach_run
            attach_run(_decision_trace, turn["inv_id"])

        _next_thread.join(timeout=FOLLOWUPS_WAIT_S)
        if _next_box.get("q"):
            emit("followups", {"questions": _next_box["q"]})
        emit("done", {"inv_id": turn["inv_id"], "has_receipt": turn["has_receipt"],
                      "body": "converse", "stop_reason": result.stop_reason,
                      "steps": len(result.steps)})

        # Wave 6's input: which body served this turn, and what it cost. Emitted HERE,
        # not sniffed off the wire by `stream_with_session_log` — widening that sniff
        # would change what an OFF-state run logs too.
        session_log.emit(
            session_log.TOOL_CALL, name="ask.converse", conn_id=connection_id,
            ok=bool(result.answer), row_count=len(result.steps),
            payload={"body": "converse", "stop_reason": result.stop_reason,
                     "tools": [s.tool for s in result.steps],
                     "injected_chars": result.injected_chars,
                     "reinjection_ratio": round(result.reinjection_ratio, 2)},
        )
        return result

    _bridge = _core_frames(_run)
    try:
        async for _frame_type, _frame_payload in _bridge:
            yield KEEP_ALIVE_SAID if _frame_type is _KEEP_ALIVE else _sse(_frame_type, _frame_payload)
    except _CoreCancelled:
        pass
    except Exception as e:
        # The ONLY terminal error on this path: something escaped `converse()` itself —
        # a dead provider, a 401. A tool that raises never gets here; the loop already
        # records it as a failed step the model can recover from.
        yield _sse("error", _error_event(e))
    finally:
        await _bridge.aclose()


async def _stream_analyst(
    question: str,
    connection_id: str,
    history: list[ChatHistoryTurn],
    session_id: str = "",
    canvas_id: Optional[str] = None,
    schema_scope: Optional[str] = None,
    origin_finding: Optional[dict] = None,
    purpose: str = "",
    shape: Optional[str] = None,
    subject_prose: str = "",
    ask: Any = None,
    run_id: str = "",
) -> AsyncGenerator[str, None]:
    """Serve one deep `/ask` turn as the ANALYST (CA-3) — the phase library as tools,
    the sequence as the model's, under the deep step budget. Arc FA-2 — ``subject_prose`` is
    what the reader chose, handed beside the turn's memory; "" leaves the context as before.

    Same shape as :func:`_stream_converse` — the shared bridge, a different body. The
    frames are the deep path's own vocabulary: ``phase_complete`` as each slice lands,
    ``converse_step`` as each tool is chosen, ``guard_receipt``/``phase_progress``
    relayed from inside the phase bodies via the progress sink, and the terminal
    ``answer_report`` the narrator synthesizes from the evidence log. CA-1's parts
    renderer draws all of it with no frontend change — the user watches the analyst
    slice, and the report is the summary of what they watched.
    """
    loop = asyncio.get_running_loop()

    def _run(emit, cancelled):
        from pramanyx.agent.analyst import run_analyst
        from pramanyx.agent.progress import clear_progress_sink, set_progress_sink
        from pramanyx.obs import session_log

        turn = {"steps": 0}

        def _forward(_frame_type: str, _frame_payload: dict) -> None:
            # The tools' frames, minus the lifecycle — the analyst emits its own
            # terminals. Same relay claim `_stream_converse` makes.
            if _frame_type in _CONVERSE_SUPPRESSED:
                return
            emit(_frame_type, _frame_payload)

        def _on_step(step) -> None:
            if cancelled():
                raise _CoreCancelled()
            turn["steps"] += 1
            emit("converse_step", {
                "index": turn["steps"],
                "tool": step.tool,
                "arguments": {k: str(v)[:400] for k, v in (step.arguments or {}).items()},
                "ok": step.ok,
                "detail": str(step.detail or "")[:500],
                "result_chars": step.result_chars,
                # the tool said no, its reason in `detail` (2026-11-20): drawn as a refusal, not a done step
                "refused": bool(getattr(step, "refused", False)),
            })
            session_log.emit(session_log.TOOL_CALL_RESULT, name=step.tool,
                             conn_id=connection_id, ok=step.ok,
                             payload={"body": "analyst", "detail": str(step.detail or "")})

        class _SinkShim:
            """The progress sink's queue face, forwarding straight to `emit`: guard
            receipts and per-dimension progress fired INSIDE a phase body reach the
            stream without the graph's asyncio queue. `put_nowait` runs on the event
            loop (the emitter schedules it there), where `emit`'s own
            `call_soon_threadsafe` is still correct."""

            @staticmethod
            def put_nowait(p) -> None:
                try:
                    if not isinstance(p, dict):
                        return
                    if "__guard_receipt__" in p:
                        emit("guard_receipt", p["__guard_receipt__"])
                    elif "__report_delta__" in p:
                        emit("report_delta", {"executive_summary": p["__report_delta__"]})
                    elif "__chain_state__" in p:
                        emit("chain_state", p["__chain_state__"])
                    elif "phase_id" in p:
                        emit("phase_progress", p)
                except _CoreCancelled:
                    return None  # the loop's own checkpoint ends the turn; telemetry is disposable

        token = set_progress_sink(loop, _SinkShim())
        # FL-2 — the provider chain narrates through the same shim (platform-safe sink).
        from pramanyx.util.stream_events import clear_chain_sink, set_chain_sink
        chain_token = set_chain_sink(loop, _SinkShim())
        try:
            _memory = (build_history_section(history)
                       + build_prior_answers_section(
                           resolve_prior_answers(question, connection_id, session_id)))
            if subject_prose:
                _memory = subject_prose + "\n\n" + _memory if _memory else subject_prose
            result = run_analyst(
                connection_id, question,
                origin_finding=origin_finding,
                extra_context=_memory or None,
                session_id=session_id, canvas_id=canvas_id, schema_scope=schema_scope,
                emit=_forward, on_step=_on_step, purpose=purpose, shape=shape, ask=ask, run_id=run_id,
            )
        finally:
            clear_progress_sink(token)
            clear_chain_sink(chain_token)

        if result.report is None and result.stop_reason != "already_running":   # handed a run: it said so, above
            # No synthesized report — the loop concluded in prose (or ran dry). The
            # turn renders as a direct answer: what it produced, said plainly, never
            # a report-shaped shell around nothing.
            answer = result.answer or (
                "Nothing was measured: the question could not be turned into an investigation "
                "specification — the Question Intake step above says why — and without one the "
                "checks on its period and window cannot run."
                if result.stop_reason == "intake_failed" else
                "The investigation ran out of steps before reaching a conclusion — "
                "what each step found is above."
                if result.stop_reason == "budget" else
                "The investigation ended without a conclusion — what each step found is above."
            )
            emit("report", {"report": {"headline": answer}, "query_mode": "direct",
                            "investigation_id": result.investigation_id or None})
        emit("done", {"body": "analyst", "stop_reason": result.stop_reason,
                      "steps": len(result.steps)})

        session_log.emit(
            session_log.TOOL_CALL, name="ask.analyst", conn_id=connection_id,
            ok=bool(result.report or result.answer or result.handed_to), row_count=len(result.steps),
            payload={"body": "analyst", "stop_reason": result.stop_reason,
                     "tools": [s.tool for s in result.steps],
                     "injected_chars": result.injected_chars,
                     "reinjection_ratio": round(result.reinjection_ratio, 2),
                     # The work before intake nothing recorded — schema, linking and
                     # catalog, in seconds (`analyst.build_analyst_context`).
                     "context_s": result.context_timings},
        )
        return result

    _bridge = _core_frames(_run)
    try:
        async for _frame_type, _frame_payload in _bridge:
            yield KEEP_ALIVE_SAID if _frame_type is _KEEP_ALIVE else _sse(_frame_type, _frame_payload)
    except _CoreCancelled:
        return
    except Exception as e:
        yield _sse("error", _error_event(e))
    finally:
        await _bridge.aclose()


# ── Investigation streaming ───────────────────────────────────────────────────

def _render_origin_prose(o: dict) -> str:
    """Render an origin finding as a compact prior-analysis note — for the
    direct/explore branches, which read ``prior_analyses``. (The deep-analysis branch reads the
    structured ``origin_finding`` directly; see ``ada_intake``.)"""
    parts = [f"ALREADY ESTABLISHED by background exploration (do not re-derive): {o.get('finding', '')}"]
    if o.get("result_cells"):
        parts.append(f"Grounded result values: {o['result_cells']}")
    if o.get("structural"):
        parts.append("Verified joins: " + "; ".join(o["structural"]))
    if o.get("sql"):
        parts.append(f"Source SQL already run:\n{o['sql']}")
    return "\n".join(parts)


async def _build_origin_finding(
    connection_id: str,
    insight_id: Optional[str],
    seed_context: str,
    seed_sql: Optional[str],
) -> Optional[dict]:
    """The structured, already-established finding this investigation is DRILLING — or
    None for a cold-start question.

    The SINGLE source of truth for "what known result am I explaining": the deep-analysis branch
    reads it directly (``ada_intake`` anchors its metric/tables/window on it instead of
    re-deriving), and the report carries its provenance (``insight_id``).

    Prefers the dossier (the explorer's captured derivation) resolved from
    ``insight_id``; falls back to the lightweight ``seed_context``/``seed_sql`` a caller
    passed inline (a finding predating dossier capture, or a chart drill). Best-effort.
    """
    from pramanyx.explorer.scope import tables_in_sql
    if insight_id:
        try:
            from pramanyx.kernel.ledger import Ledger
            rec = await asyncio.to_thread(
                Ledger.default().receipt, f"insight:{connection_id}:{insight_id}")
            dossier = ((rec or {}).get("artifact", {}).get("payload", {}) or {}).get("dossier")
            if dossier:
                sc = dossier.get("structural_ctx") or {}
                joins = []
                for j in (sc.get("joins") or [])[:6]:
                    joins.append(f"{j.get('from_table')}→{j.get('to_table')} {j.get('cardinality')}"
                                 + ("" if j.get("verified") else f" ({j.get('orphan_count')} orphans)"))
                _sql = (dossier.get("sql") or "").strip()
                return {
                    "insight_id": insight_id,
                    "finding": (dossier.get("finding") or "").strip(),
                    "sql": _sql,
                    "tables": sorted(tables_in_sql(_sql)) if _sql else [],
                    "result_cells": (dossier.get("result_cells") or "").strip(),
                    "structural": joins,
                    "narrative": (dossier.get("narrative") or "").strip(),
                }
        except Exception:
            logger.debug("origin dossier lookup failed; falling back to inline seed", exc_info=True)

    _sc = (seed_context or "").strip()
    _sq = (seed_sql or "").strip()
    if _sc or _sq:
        return {
            "insight_id": insight_id or "",
            "finding": _sc,
            "sql": _sq,
            "tables": sorted(tables_in_sql(_sq)) if _sq else [],
            "result_cells": "",
            "structural": [],
            "narrative": "",
        }
    return None


def _followup_origin(history: list, followup: bool = True) -> Optional[dict]:
    """A structured origin_finding built from the PREVIOUS turn — the base a follow-up
    question composes on. Same shape as ``_build_origin_finding`` so ada_intake anchors
    on it and the direct/explore branches see it via prior_analyses. The ``finding`` text
    is a compose-on-base directive; the ``sql`` is the base query to keep/extend.

    CA-3 — ``followup=False`` is the SOFT form: the prior spec still rides as context
    (defect ⑦: ``is_followup`` missed "only focus on…", so the deep follow-up lost its
    metric and returned zero rows), but the directive grants the MODEL the decision —
    inherit the spec only if this question continues the thread. The regex detector
    stops being the only door; it now merely chooses the directive's strength."""
    from pramanyx.explorer.scope import tables_in_sql
    if not history:
        return None
    prior = history[-1]
    _get = (lambda k: getattr(prior, k, None)) if not isinstance(prior, dict) else prior.get
    _sql = (_get("sql") or "").strip()
    if not _sql:
        return None
    _q = (_get("question") or "").strip()
    _headline = (_get("headline") or "").strip()
    key_rows = _get("key_rows") or []
    _cells = "; ".join(" | ".join(str(c) for c in (row or [])[:6]) for row in key_rows[:3])
    if followup:
        directive = (
            f"FOLLOW-UP — compose on the previous query. Prior question: \"{_q}\". Keep its "
            f"metric, filters, grain and time window unless this question changes them, and "
            f"resolve 'that' / 'those' / 'the top one' against its result. Do NOT start from scratch."
        )
    else:
        directive = (
            f"PRIOR TURN (context, not a mandate). The previous question was \"{_q}\" and its "
            f"query is below. If THIS question continues that thread — narrows it, re-cuts it, "
            f"says 'only …' or 'focus on …' — keep the prior metric, filters, grain and window "
            f"unless the question changes them. If it is a new question, ignore this context."
        )
    return {
        "insight_id": "",
        "finding": directive,
        "sql": _sql,
        "tables": sorted(tables_in_sql(_sql)),
        "result_cells": _cells,
        "structural": [],
        "narrative": _headline,
    }


async def _stream_investigation(
    question: str,
    connection_id: str,
    request: Request,
    hitl: bool = False,
    skip_cache: bool = False,
    canvas_id: Optional[str] = None,
    schema_scope: Optional[str] = None,
    seed_sql: Optional[str] = None,
    seed_context: str = "",
    insight_id: Optional[str] = None,
    deep: bool = False,
    history: Optional[list] = None,
    requested_mode: str = "investigate",
    purpose: str = "",
    allow_clarify: bool = True,
    session_id: str = "",
    run_id: str = "",
) -> AsyncGenerator[str, None]:
    """The phase script's deep turn. ``run_id`` — the row its door made as it claimed the question
    (`agent/one_run.take`), adopted rather than made again; "" makes its own."""
    _TIMEOUT = int(os.getenv("PRAMANYX_TIMEOUT_SECONDS", "600"))

    # One scope resolver (ExecutionScope). A canvas pins its own connection + declared
    # schema + table filter; a non-canvas investigation (e.g. a briefing "pull the thread")
    # honours schema_scope instead (canvas wins when both are present). eff_schema derives
    # the single owning schema of a schema-qualified table list so bare names + the explore
    # linker's full-schema FK expansion can't leak to a sibling schema — the deep path used
    # to leave this None (missimi deep answering from another demo dataset).
    from pramanyx.canvas.scope import resolve_execution_scope
    from pramanyx.tools.schema import build_canvas_schema_context
    _es = resolve_execution_scope(connection_id, canvas_id, schema_scope=schema_scope,
                                  schema_context_builder=build_canvas_schema_context)
    connection_id = _es.connection_id
    canvas_schema_context = _es.schema_context
    scope_schema = _es.eff_schema

    try:
        db = _es.open()
    except KeyError as e:
        # A KeyError from the scope resolver means the connection id does not exist —
        # a terminal state, not a hiccup. Classified explicitly because the generic
        # fallback says "retrying is usually safe", and re-asking a question against a
        # connection that is not there fails identically every time.
        yield _sse("error", _error_event(e, reason="not_found"))
        return
    except Exception as e:
        # The connection exists but would not open (server down, bad credentials in the
        # DSN, network). That one IS worth retrying, so it keeps the classifier's verdict.
        yield _sse("error", _error_event(e, message=f"Could not connect: {e}"))
        return

    # ── Tier 0: the trace is a READ, not a re-run ──────────────────────────────
    # Drilling into a known finding? The explorer already did the deep analysis and
    # captured it in the Finding Dossier. Serve that as the trace — a deterministic
    # ledger lookup by the finding's id (no semantic-match guess, no deep-analysis, no SQL, no LLM).
    # `deep` is the explicit escalation past the dossier into a fresh investigation.
    if insight_id and not deep:
        try:
            from pramanyx.kernel.ledger import Ledger
            rec = await asyncio.to_thread(
                Ledger.default().receipt, f"insight:{connection_id}:{insight_id}")
            dossier = ((rec or {}).get("artifact", {}).get("payload", {}) or {}).get("dossier")
            if dossier:
                yield _sse("start", {"question": question, "connection_id": connection_id,
                                     "investigation_id": None, "insight_id": insight_id})
                yield _sse("dossier_report", {"dossier": dossier, "insight_id": insight_id,
                                              "connection_id": connection_id})
                yield _sse("done", {})
                return
            logger.debug("no dossier for insight %s — falling through to live investigation", insight_id)
        except Exception:
            logger.debug("dossier short-circuit failed; falling through", exc_info=True)

    from pramanyx.tools.prior_analyses import find_similar_investigation
    cache_hit = None if (skip_cache or _looks_direct(question)) else await asyncio.to_thread(find_similar_investigation, question, connection_id)
    if cache_hit:
        cached_id, score = cache_hit
        cached = get_investigation(cached_id)
        if cached and cached.get("report"):
            if run_id:
                # The row its door made is answered by the run already done: handed that run, by its id — the person's
                # history opens it, and a repeat handed this row reads it (`get_investigation` follows a hand-back).
                from pramanyx.db.history import hand_back_investigation
                hand_back_investigation(run_id, f"This question was answered already, by run {cached_id}.",
                                        handed_to=cached_id)
            cached_report = cached["report"]
            report_type = cached_report.get("_report_type") if isinstance(cached_report, dict) else None
            yield _sse("start", {"question": question, "connection_id": connection_id, "investigation_id": cached_id})
            if cached.get("hypotheses"):
                yield _sse("hypotheses", {"hypotheses": cached["hypotheses"]})
            qh = cached.get("query_history") or []
            if report_type == "investigate":
                yield _sse("answer_report", {"answer_report": cached_report, "investigation_id": cached_id, "query_mode": "investigate", "mode": "investigate", "from_cache": True, "cached_question": cached["question"], "cache_score": round(score, 3)})
            elif report_type == "explore":
                yield _sse("explore_report", {"explore_report": cached_report, "sub_questions": cached_report.get("sub_questions", []), "subq_answers": cached_report.get("subq_answers", []), "query_count": cached.get("query_count", len(qh)), "investigation_id": cached_id, "query_mode": "explore", "from_cache": True, "cached_question": cached["question"], "cache_score": round(score, 3)})
            else:
                yield _sse("report", {"report": cached_report, "hypotheses": cached.get("hypotheses") or [], "query_count": cached.get("query_count", len(qh)), "query_history": qh, "investigation_id": cached_id, "from_cache": True, "cached_question": cached["question"], "cache_score": round(score, 3)})
            yield _sse("done", {})
            return

    if run_id:
        # the row its door made as it claimed the question: on the connection the scope resolved to
        from pramanyx.db.history import adopt_investigation
        inv_id = run_id
        adopt_investigation(inv_id, connection_id)
    else:
        inv_id = create_investigation(question, connection_id, canvas_id=canvas_id,
                                      agent_id=_current_agent_id(), purpose=purpose,
                                      session_id=session_id or "")
    # Phase 2 of the 2027 study — the run is opened INSIDE an inquiry: a person's ask opens one
    # (or wakes the one on the same subject opened in the last fortnight), so what the run
    # establishes, leaves open and refutes outlives the run. Best-effort, off the loop.
    try:
        from pramanyx.org.context import current_user_id
        from pramanyx.record.inquiry import open_inquiry
        _uid = current_user_id()
        await asyncio.to_thread(lambda: open_inquiry(
            question=question, connection_id=connection_id, run_id=inv_id,
            opened_by=f"person:{_uid}" if _uid else "person"))
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the inquiry could not be opened; the run proceeds and lands on one when it completes",
                 counter="inquiry.open", conn_id=connection_id)
    from pramanyx import telemetry as _telemetry
    trace_id = _telemetry.new_trace(inv_id, question, connection_id)
    yield _sse("start", {"question": question, "connection_id": connection_id, "investigation_id": inv_id, "trace_id": trace_id})

    # Surface matched org-playbook items up front (they're also injected into deep-analysis
    # synthesis). The user can keep / modify / remove them from the result.
    try:
        from pramanyx.business_profile.metric_kb import industry_scope
        from pramanyx.playbook.retriever import retrieve_for_metric_and_phases
        _pb = await asyncio.to_thread(lambda: retrieve_for_metric_and_phases(
            [question], limit=4, industry=industry_scope(connection_id, scope_schema)))
        if _pb:
            yield _sse("playbook_refs", {"items": _pb_serialize(_pb)})
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "surfacing matched playbook items is best-effort; the investigation proceeds without them",
                 counter="investigation.playbook_refs")

    # Pause EVERY explorer bound to this connection — the connection explorer AND any
    # canvas explorers on the same connection — so background exploration doesn't contend
    # with the investigation's queries. (Previously only the connection explorer paused,
    # so a canvas explorer kept hammering the DB through the run.) Skip ones already paused
    # (e.g. user-paused) so we only resume what we actually paused.
    _paused_explorers = []
    for _e in _explorers_for_connection(connection_id):
        try:
            _e.pause()
            # Tag the pause as investigation-owned: the kernel supervisor's
            # backstop only auto-resumes these (never a user-initiated pause)
            # if this stream dies without reaching its finally-block.
            _e._paused_by_investigation = True
            _paused_explorers.append(_e)
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "explorer pause before investigation is best-effort; an unpaused explorer only adds DB contention",
                     counter="investigation.explorer_pause")

    merged: dict = {}  # bound before try so the except/salvage path can read partial state
    try:
        full_schema = await asyncio.to_thread(_get_schema_cached, connection_id, db)  # WCH-12: cached (was bypassed)
        # When a Canvas is active, use the pre-filtered canvas schema context so the
        # agent only sees the tables selected for that Canvas.
        schema = canvas_schema_context if canvas_schema_context else full_schema
        # Inject a schema-prefix note so the LLM always uses fully-qualified names
        if scope_schema:
            schema = (
                f"DEFAULT SCHEMA: {scope_schema}\n"
                "CRITICAL: Every table reference in SQL MUST include this schema prefix "
                f"(e.g. {scope_schema}.table_name). Do NOT use bare table names.\n\n"
                + schema
            )
        # Schema-linking pre-filter: narrow to relevant tables/columns per question.
        try:
            from pramanyx.tools.schema_linker import link_schema
            schema = link_schema(question, schema, connection_id=connection_id)
        except Exception:
            logger.warning("Schema-linking pre-filter failed (agentic path); using full schema", exc_info=True)
        # Build structured Data Catalog from linked tables
        data_catalog = ""
        try:
            from pramanyx.tools.data_catalog import build_data_catalog
            from pramanyx.tools.schema_linker import complete_join_paths
            # Complete the join paths BEFORE building the catalog, and in the schema TEXT too
            # (`complete_join_paths` — one body with the Agent path): schema-linking picks tables
            # by keyword, missing the parent that carries the date — `orders` for a revenue on
            # `order_items`. The catalog was completed this way since 2026-08; the text the intake
            # and its date resolver read was not (99201af8, 2026-10-14). Pinned temporal
            # dimensions, then ranked+capped, then FK-completed, scoped to the canvas schema.
            schema, linked_tables = complete_join_paths(
                question, schema, full_schema, connection_id=connection_id, scope_schema=scope_schema or None)
            if linked_tables:
                data_catalog = await asyncio.to_thread(
                    lambda: build_data_catalog(db, linked_tables, schema=scope_schema or None)
                )
        except Exception:
            logger.warning("Data Catalog build failed (agentic path); using linked schema", exc_info=True)

        # Hard cap on tables in context — profile-derived (A3), rank-preserving.
        try:
            from pramanyx.llm.profile import profile_for
            from pramanyx.tools.data_catalog import enforce_context_cap
            _cap = profile_for("coder").context_table_cap
            schema = enforce_context_cap(schema, max_tables=_cap)
            if data_catalog:
                data_catalog = enforce_context_cap(data_catalog, max_tables=_cap)
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "table context cap is best-effort; investigating with the uncapped schema context",
                     counter="investigation.context_cap")

        # P2 Agent Context surface: expose the assembled working context (which tables
        # the agent is actually looking at, the token budget they cost, the join edges)
        # so the user has visibility + a handle to trim it. Flag-gated; an extra SSE
        # event is ignored by clients that don't render it, so it's safe to emit.
        if os.getenv("PRAMANYX_CONTEXT_SURFACE", "").strip().lower() in ("1", "true", "yes", "on"):
            try:
                from pramanyx.tools.context_manifest import build_context_manifest
                _manifest = build_context_manifest(data_catalog or schema)
                yield _sse("context_assembled", _manifest.to_dict())
            except Exception:
                logger.debug("context_assembled emit failed (best-effort)", exc_info=True)

        # Prefer structured Data Catalog as the primary schema context
        schema_for_agent = data_catalog if data_catalog else schema

        # Inject the UNIFIED metric grounding so deep-analysis resolves a metric (e.g. "revenue")
        # to the SAME approved SQL the /chat path uses — closing the "revenue means two
        # different things" / "Insight vs Deep disagree" gap. ONE resolver, both paths:
        # the governed catalog (with NEVER rules) + the connection's north-star + verified
        # ontology formulas. No-op when none exist.
        try:
            from pramanyx.semantic.canonical import unified_metric_grounding
            # Pass the schema we already fetched (full_schema, cached above) so the metric
            # schema-filter doesn't RE-INTROSPECT it — that redundant fetch was ~16s per
            # investigation on big warehouses (profiled), duplicating this same schema.
            # Use the EFFECTIVE scope schema (canvas OR an explicit schema-scoped run) so the
            # connection's GOVERNED north-star metrics for THIS schema are injected (RC2).
            _canon = unified_metric_grounding(connection_id, scope_schema, schema_text=full_schema,
                                              question=question)
            if _canon:
                schema_for_agent = f"{schema_for_agent}\n\n{_canon}"
        except Exception:
            logger.warning("Canonical metrics injection failed (agentic path)", exc_info=True)

        from pramanyx.agent.graph import build_graph_generic
        # P3 editable plan gate: when on, the explore graph pauses after decomposition
        # (before the expensive fan-out) so the user can review/edit the sub-question
        # plan. Opt-in via PRAMANYX_PLAN_GATE; off by default so the path is unchanged.
        _plan_gate = os.getenv("PRAMANYX_PLAN_GATE", "").strip().lower() in ("1", "true", "yes", "on")
        # The clarify gate ARMS an interrupt node, and an armed interrupt with nobody
        # to answer it ends the run without a report — so the CALLER decides
        # (`allow_clarify`, default True; a headless consumer passes False). This
        # dissolved the `deep_analysis.clarify_gate` flag (2026-08-06): the posture
        # is a property of the REQUEST, not of the deployment's env.
        _clarify_gate = bool(allow_clarify)
        agent = build_graph_generic(db, hitl=hitl, plan_gate=_plan_gate, clarify_gate=_clarify_gate)

        # ONE structured origin finding — the single source of truth for "what known
        # result is this investigation drilling" (insight_id dossier, or an inline
        # seed_context/seed_sql). The deep-analysis branch reads origin_finding directly
        # (ada_intake anchors its spec on it); for the direct/explore branches we render
        # it into prior_analyses (the channel those read). scan_context stays empty —
        # exploratory_scan overwrites it, so seeding there is a no-op.
        _origin = await _build_origin_finding(connection_id, insight_id, seed_context, seed_sql)
        # Follow-up composition (the quick /chat path already does this via
        # build_history_section). When THIS question is a continuation and no explicit
        # drill seed was given, anchor the run on the previous turn's query — the same
        # origin_finding channel deep-analysis reads + prior_analyses the direct/explore branches
        # read — so "break that down / for luxury only / that one" composes on the base
        # instead of starting from scratch.
        if _origin is None and history:
            # CA-3: the prior turn's spec ALWAYS rides as context on a deep turn with
            # history — soft-form when the regex detector did not fire, so the model
            # (which sees the question) decides whether to compose on it. `is_followup`
            # stops being the only door (defect ⑦: it missed "only focus on…").
            from pramanyx.agent.followup import is_followup
            _origin = _followup_origin(history, followup=is_followup(question))
        _seed_priors = [_render_origin_prose(_origin)] if _origin else []

        # AL-05 (Semantic plane) — resolve the ontology / metrics / profile / KB once here and
        # carry it on the run state, so every node reads one consistent SemanticContext instead of
        # re-consulting ad-hoc. Flag-gated + fail-open in the helper → None (no-op) when off.
        from pramanyx.semantic.context import resolve_if_enabled as _resolve_semantic
        _semantic_context = _resolve_semantic(question, connection_id,
                                              scope_schema=scope_schema or None,
                                              schema_text=schema_for_agent or "")

        # ON-10 — frame the question against the declared ontology before the graph starts: no model, no warehouse
        # (a model chooses among equally-fitting definitions later, inside the run). Shown at once when it reached a
        # declared definition, and handed to the run so the intake and the explore planner read the same frame.
        _frame_dump = None
        try:
            from pramanyx.agent.framing import resolve_frame
            _frame = await asyncio.to_thread(resolve_frame, question, connection_id, scope_schema or None,
                                             dialect=getattr(db, "dialect", "") or "duckdb", choose=False,
                                             inv_id=inv_id)
            if _frame is not None and _frame.defines:
                _frame_dump = _frame.model_dump(mode="json")
                yield _sse("frame", {"frame": _frame_dump, "investigation_id": inv_id})
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "framing the question is best-effort; the investigation reads it as written",
                     counter="investigation.frame", conn_id=connection_id)

        initial_state: AgentState = {
            "question": question, "connection_id": connection_id, "investigation_id": inv_id,
            "trace_id": trace_id,
            # agents.user_defined — persist the active persona so a plan/clarify-gate
            # resume (which never passes through /ask) can re-activate it.
            "agent_id": _current_agent_id(),
            "_allow_clarify": _clarify_gate,
            "schema_context": schema_for_agent, "unresolved_tensions": [], "scan_context": "", "events_context": "",
            # The un-linked catalogue, for the intake's date resolver (see `full_schema_context` in analyst.py).
            "full_schema_context": full_schema,
            "hypotheses": [], "current_hypothesis_idx": 0, "query_history": [], "evidence_scores": [],
            "pitfalls": [], "prior_analyses": _seed_priors, "origin_finding": _origin, "iteration": 0,
            "max_iterations": int(os.getenv("PRAMANYX_MAX_ITER", "6")),
            "report": None, "hitl_enabled": hitl, "human_feedback": None,
            "query_mode": None, "route_reasoning": None, "route_confidence": None, "replan_decision": None,
            # Deep-path mode. Defaults to "investigate" so /investigate — the explicit Deep
            # Analysis surface — stays pinned: route_question honors it and never lets the LLM
            # classifier downgrade the run to a 'direct' lookup (live incident: "Where are we
            # losing money?" ran as 3 flat queries with a fake 'direct' hypothesis, zero
            # decomposition). /ask now passes its route verdict through here — normally
            # "investigate", or "explore" when a person or a starter asks for the landscape wave
            # (route_question honors requested_mode ∈ {investigate, explore}).
            "requested_mode": requested_mode,
            "sub_questions": [], "current_subq_idx": 0, "subq_answers": [], "explore_report": None,
            "investigation_phases": [], "answer_report": None, "_ada_intake": None, "_intake_failed": None,
            "ontology_frame": _frame_dump,
            "canvas_id": canvas_id, "canvas_schema_context": canvas_schema_context,
            "scope_schema": scope_schema or "",
            "data_catalog": data_catalog or "",
            "subq_data_portrait": {},
            "final_text_answer": "",
            "semantic_context": _semantic_context,
        }

        import time
        merged = initial_state.copy()
        deadline = time.monotonic() + _TIMEOUT
        timed_out = False
        report_emitted = False  # did the graph reach a terminal synthesis node?

        # A1 (2026-11-25): what the deep run is given is recorded from here; the graph's nodes run in a context copied
        # just below, which shares this record, and the receipt carries it (`trust.answer_inputs`).
        from pramanyx.trust.answer_inputs import start_recording
        start_recording()
        async for event in _investigation_stream(agent.stream(initial_state, config={"configurable": {"thread_id": inv_id}}),
                                                 held=_es.held()):
            # A supervised kernel job (K1) completes SERVER-SIDE even if the streaming client goes away: a
            # tab close or a transient disconnect must not discard a multi-minute investigation — nor write
            # its Trust Receipt outside the job's metering (which is exactly what an early abort did: an
            # empty cost/learning/activation receipt). The run stays bounded by the deadline below, and an
            # explicit stop still cancels through the kernel. (Previously a disconnect failed it as timed_out.)
            if time.monotonic() > deadline:
                timed_out = True
                break
            if "__report_delta__" in event:            # R6 live synthesis prose (flag-gated via the sink)
                yield _sse("report_delta", {"executive_summary": event["__report_delta__"]})
                continue
            if "__ada_progress__" in event:            # P2 live per-dimension progress (flag-gated)
                yield _sse("phase_progress", event["__ada_progress__"])
                continue
            if "__guard_receipt__" in event:           # A4 - a guard made an intervention visible
                yield _sse("guard_receipt", event["__guard_receipt__"])
                continue
            if "__chain_state__" in event:             # FL-2 - the failover chain narrated a hop
                yield _sse("chain_state", event["__chain_state__"])
                continue
            if "__interrupt__" in event:
                # Distinguish a plan-gate pause (P3 — before the explore fan-out) from the
                # ada_synthesize HITL pause by checking which node the graph is about to run.
                try:
                    _next = agent.get_state({"configurable": {"thread_id": inv_id}}).next or ()
                except Exception:
                    _next = ()
                if "clarify_gate" in _next:
                    # P4: a material metric-reading ambiguity — surface the two readings (with their
                    # probed previews) for the user to choose; the run resumes via /feedback.
                    _cp = merged.get("_clarify_pending") or {}
                    yield _sse("clarify_pending", {
                        "investigation_id": inv_id,
                        "subject": _cp.get("subject", ""),
                        "metric_label": _cp.get("metric_label", ""),
                        "question": _cp.get("question", ""),
                        "options": _cp.get("options", []),
                        "previews": _cp.get("previews", []),
                        # HB-2 law 6 — the governed metric and each reading's SQL, so a
                        # headless run's owner can answer on the departures screen and the
                        # answer is remembered without resuming the run.
                        "metric_name": _cp.get("metric_name", ""),
                        "readings": _cp.get("readings", []),
                    })
                elif "plan_gate" in _next:
                    _subqs = merged.get("sub_questions", [])
                    _n = len(_subqs)
                    yield _sse("plan_pending", {
                        "investigation_id": inv_id,
                        "sub_questions": [sq.model_dump() if hasattr(sq, "model_dump") else sq for sq in _subqs],
                        "chain_length": _n,
                        # Cheap pre-flight cost estimate (feeds P6): the observed ~8k tokens
                        # per sub-question on the frontier model × chain length.
                        "estimated_tokens": _n * 8000,
                    })
                else:
                    yield _sse("paused", {"investigation_id": inv_id, "hypotheses": [h.model_dump() for h in merged.get("hypotheses", [])], "scores": [s.model_dump() for s in merged.get("evidence_scores", [])]})
                pause_investigation(inv_id)
                yield _sse("done", {})
                return

            node_name = next(iter(event))
            partial = event[node_name] or {}
            merged = {**merged, **partial}

            if node_name == "route_question":
                yield _sse("mode", {"query_mode": merged.get("query_mode"), "route_reasoning": merged.get("route_reasoning"), "route_confidence": merged.get("route_confidence")})
                # For investigate/explore modes, stream clarifying questions after routing
                # so the user sees what the agent is about to probe before it runs expensive queries.
                if merged.get("query_mode") in ("investigate", "explore"):
                    try:
                        from pramanyx.llm.provider import get_provider  # was unresolved here (latent NameError)
                        _cq_system = (
                            "You are a senior data analyst about to run a deep investigation. "
                            "Given the user's question, ask 1-2 short clarifying questions that would "
                            "sharpen the analysis. Focus on time range, metric definition, or segment. "
                            "Also write a one-sentence note explaining why these matter."
                        )
                        _cq: _ClarifyingQuestions = await asyncio.to_thread(
                            lambda: get_provider("narrator").complete(
                                system=_cq_system,
                                user=f"Question: {question}",
                                response_model=_ClarifyingQuestions,
                                temperature=0.3,
                            )
                        )
                        if _cq.questions:
                            yield _sse("clarifying_questions", {
                                "questions": _cq.questions[:2],
                                "context_note": _cq.context_note,
                            })
                    except Exception as exc:
                        from pramanyx.kernel.errors import tolerate
                        tolerate(exc, "clarifying-questions generation is best-effort stream enrichment; the investigation continues",
                                 counter="investigation.clarifying_questions")
            elif node_name == "decompose" and merged.get("hypotheses"):
                yield _sse("hypotheses", {"hypotheses": [h.model_dump() for h in merged["hypotheses"]]})
            elif node_name == "plan_and_execute":
                history = merged.get("query_history", [])
                recent = history[-3:]
                pitfalls = merged.get("pitfalls", [])
                yield _sse("queries_executed", {"iteration": merged.get("iteration", 0), "hypothesis_idx": merged.get("current_hypothesis_idx", 0), "queries": [{"sql": r.sql, "row_count": r.row_count, "error": r.error, "stats": [s.model_dump() for s in (r.stats or [])]} for r in recent], "corrections": [p.model_dump() for p in pitfalls[-(len(recent)):]], "stats": [s.model_dump() for r in recent for s in (r.stats or [])]})
            elif node_name == "score_evidence":
                scores = merged.get("evidence_scores", [])
                if scores:
                    yield _sse("score", {"iteration": merged.get("iteration", 0), "score": scores[-1].model_dump(), "hypotheses": [h.model_dump() for h in merged.get("hypotheses", [])]})
            elif node_name in ("ada_intake", "ada_baseline", "ada_cross_section", "ada_decompose", "ada_dimensional", "ada_behavioral"):
                phases = merged.get("investigation_phases", [])
                if phases:
                    yield _sse("phase_complete", {"phase": phases[-1], "all_phases": phases})
            elif node_name == "ada_synthesize" and merged.get("answer_report"):
                ada = merged["answer_report"]
                qh = merged.get("query_history", [])
                yield _sse("tables_used", {"tables": _extract_tables(" ".join(r.sql for r in qh if r.sql))})
                yield _sse("answer_report", {"answer_report": ada, "investigation_id": inv_id, "query_mode": "investigate", "mode": "investigate", **_early(inv_id)})
                try:
                    from pramanyx.agent.followups import (
                        artifact_from_history, followup_system, followup_user)
                    from pramanyx.llm.provider import get_provider as _gp
                    # 2.1 — the executed queries are right here in `qh`; this site used
                    # to send only the question and a headline, so the suggestions could
                    # not name a real column.
                    # to_thread, like every other LLM call on this path: `complete` is
                    # synchronous down to a blocking TLS read, and this generator runs ON
                    # the event loop — calling it inline froze the whole API (every route,
                    # /health included) for the length of the round-trip.
                    fq: _FollowUpBase = await asyncio.to_thread(
                        lambda: _gp("narrator").complete(
                            system=followup_system(),
                            user=followup_user(
                                question,
                                headline=(ada.get("headline", "") if isinstance(ada, dict)
                                          else str(ada)[:200]),
                                **artifact_from_history(qh)),
                            response_model=_FollowUpBase))
                    yield _sse("followups", {"questions": fq.questions[:3]})
                except Exception as exc:
                    from pramanyx.kernel.errors import tolerate
                    tolerate(exc, "follow-up suggestions are best-effort; the report was already emitted",
                             counter="investigation.followups")
                ada_save = dict(ada) if isinstance(ada, dict) else ada
                ada_save["_report_type"] = "investigate"
                if insight_id and isinstance(ada_save, dict):
                    ada_save["origin_insight_id"] = insight_id  # provenance: drilled from this finding
                await asyncio.to_thread(lambda: complete_investigation(inv_id, report=ada_save, hypotheses=merged.get("hypotheses", []), query_history=qh, question=question, connection_id=connection_id, skip_index=False, origin_insight_id=insight_id))
                # K3-wide: the deep-analysis report carries a Trust Receipt too (executed
                # queries → input tables → metric enforcement), so an agentic
                # answer self-justifies like a chat answer and an explorer finding.
                # Wave S2 — a deep answer reports its trusted-query provenance like a quick
                # one. The list comes from the intake that BUILT the prompt
                # (`data_understanding.trusted_used`), never from re-running retrieval here:
                # recomputing would claim a pattern for a run whose grounding step failed
                # silently. Same edge shape as the chat path, so one receipt reader serves both.
                _ada_guards = [("trusted", f"query:{(_t.get('question') or '')[:60]}", _t.get("note"))
                               for _t in ((merged.get("_ada_intake") or {}).get("trusted_used") or [])]
                # to_thread for the same reason as the follow-up call above: the receipt
                # write reaches the ledger AND `note_finding`, whose graph write goes out
                # over TLS. Inline it blocked the loop for seconds at the end of every
                # run — the residual stall that survived fixing the LLM calls.
                _ada_rcpt = await asyncio.to_thread(
                    lambda: _write_answer_receipt(
                        kind="ada_report", natural_key=f"ada:{connection_id}:{inv_id}",
                        question=question, sqls=_ada_sqls(ada) or [r.sql for r in qh if getattr(r, "sql", None)],
                        headline=(ada.get("headline", "") if isinstance(ada, dict) else ""),
                        schema=full_schema, connection_id=connection_id, canvas_id=canvas_id,
                        guard_edges=_ada_guards,
                        payload_extra={"investigation_id": inv_id, **_frame_about_of(ada)},
                    ))
                # WP-10: hand the UI the unified receipt id so a deep answer opens the same
                # "Why this number" drawer as a quick answer (GET /receipt/{id}).
                if _ada_rcpt.get("receipt_id"):
                    yield _sse("receipt_id", {"receipt_id": _ada_rcpt["receipt_id"]})
                await asyncio.to_thread(_record_memory, inv_id, connection_id, question, merged)
                report_emitted = True
            elif node_name == "decompose_exploration":
                yield _sse("explore_plan", {"sub_questions": [sq.model_dump() for sq in merged.get("sub_questions", [])]})
            elif node_name == "plan_and_execute_subq":
                history = merged.get("query_history", [])
                idx = merged.get("current_subq_idx", 0)
                subqs = merged.get("sub_questions", [])
                current_subq = subqs[idx] if idx < len(subqs) else None
                recent = [r for r in history if r.hypothesis_id == (current_subq.id if current_subq else "")][-3:]
                yield _sse("queries_executed", {"iteration": merged.get("iteration", 0), "hypothesis_idx": idx, "subq_id": current_subq.id if current_subq else "", "queries": [{"sql": r.sql, "row_count": r.row_count, "error": r.error, "stats": [s.model_dump() for s in (r.stats or [])]} for r in recent], "corrections": [p.model_dump() for p in merged.get("pitfalls", [])[-2:]], "stats": [s.model_dump() for r in recent for s in (r.stats or [])]})
            elif node_name == "reason_over_result":
                answers = merged.get("subq_answers", [])
                if answers:
                    yield _sse("subq_answer", _explore_subq_event(answers[-1]))
            elif node_name == "plan_and_execute_wave":
                # T3-3(b): the parallel-wave path had NO stream branch — a multi-minute silent gap
                # between the plan and the report. Emit one progress event per sub-question the wave
                # just finished (each already carries its own SQL + rows + chart).
                for _a in (partial.get("subq_answers") or []):
                    yield _sse("subq_answer", _explore_subq_event(_a))
            elif node_name == "synthesize_exploration" and merged.get("explore_report"):
                er = merged["explore_report"]
                # T3-3(a): forward EVERY sub-question's evidence (re-read the reduced state, not the
                # clobbered merge). T3-4: attach a shape-verified chart to each.
                answers = await _reduced_subq_answers(agent, inv_id, merged.get("subq_answers", []))
                qh = merged.get("query_history", [])
                sq_raw = [sq.model_dump() for sq in merged.get("sub_questions", [])]
                sa_raw = [a.model_dump() for a in answers]
                yield _sse("tables_used", {"tables": _extract_tables(" ".join(r.sql for r in qh if r.sql))})
                yield _sse("explore_report", {"explore_report": er.model_dump(), "sub_questions": sq_raw, "subq_answers": sa_raw, "query_count": len(qh), "investigation_id": inv_id, "query_mode": "explore", "frame": merged.get("ontology_frame"), **_early(inv_id)})
                try:
                    from pramanyx.agent.followups import (
                        artifact_from_history, followup_system, followup_user)
                    from pramanyx.llm.provider import get_provider as _gp
                    # to_thread — see the ada_synthesize site above: inline, this blocks
                    # the event loop for the whole LLM round-trip.
                    fqx: _FollowUpBase = await asyncio.to_thread(
                        lambda: _gp("narrator").complete(
                            system=followup_system(),
                            user=followup_user(question, headline=er.headline,
                                               **artifact_from_history(qh)),
                            response_model=_FollowUpBase))
                    yield _sse("followups", {"questions": fqx.questions[:3]})
                except Exception as exc:
                    from pramanyx.kernel.errors import tolerate
                    tolerate(exc, "follow-up suggestions are best-effort; the report was already emitted",
                             counter="investigation.followups")
                explore_save = {"_report_type": "explore", **er.model_dump(), "sub_questions": sq_raw, "subq_answers": sa_raw}
                await asyncio.to_thread(lambda: complete_investigation(inv_id, report=explore_save, hypotheses=[], query_history=qh, question=question, connection_id=connection_id, skip_index=False))
                await asyncio.to_thread(_record_memory, inv_id, connection_id, question, merged)
                report_emitted = True
            elif node_name == "synthesize" and merged.get("report"):
                qh = merged.get("query_history", [])
                yield _sse("tables_used", {"tables": _extract_tables(" ".join(r.sql for r in qh if r.sql))})
                yield _sse("report", {"report": merged["report"].model_dump(), "hypotheses": [h.model_dump() for h in merged.get("hypotheses", [])], "query_count": len(qh), "query_history": [{"hypothesis_id": r.hypothesis_id, "sql": r.sql, "row_count": r.row_count, "error": r.error, "columns": r.columns, "rows": r.rows[:50], "stats": [s.model_dump() for s in (r.stats or [])]} for r in qh], "investigation_id": inv_id, "query_mode": merged.get("query_mode"), **_early(inv_id)})
                try:
                    from pramanyx.agent.followups import (
                        artifact_from_history, followup_system, followup_user)
                    from pramanyx.llm.provider import get_provider as _gp
                    rep = merged["report"]
                    summary = getattr(rep, "summary", "") or getattr(rep, "headline", "")
                    # to_thread — see the ada_synthesize site above: inline, this blocks
                    # the event loop for the whole LLM round-trip.
                    fqr: _FollowUpBase = await asyncio.to_thread(
                        lambda: _gp("narrator").complete(
                            system=followup_system(),
                            user=followup_user(question, headline=str(summary)[:300],
                                               **artifact_from_history(qh)),
                            response_model=_FollowUpBase))
                    yield _sse("followups", {"questions": fqr.questions[:3]})
                except Exception as exc:
                    from pramanyx.kernel.errors import tolerate
                    tolerate(exc, "follow-up suggestions are best-effort; the report was already emitted",
                             counter="investigation.followups")
                await asyncio.to_thread(lambda: complete_investigation(inv_id, report=merged["report"], hypotheses=merged.get("hypotheses", []), query_history=qh, question=question, connection_id=connection_id, cache=merged.get("query_mode") != "direct", origin_insight_id=insight_id))
                await asyncio.to_thread(_record_memory, inv_id, connection_id, question, merged)
                report_emitted = True

        if timed_out:
            # Even on timeout, salvage a partial report from gathered evidence first.
            salvaged = await asyncio.to_thread(
                _try_salvage, merged, inv_id, question, connection_id, schema=full_schema)
            if salvaged:
                yield salvaged
            else:
                yield _sse("error", _error_event(
                    message=f"Investigation timed out after {_TIMEOUT}s.", reason="run_timeout"))
                fail_investigation(inv_id, status="timed_out",
                                   reason=f"timed out after {_TIMEOUT}s")
        elif not report_emitted:
            # The graph terminated without reaching a synthesis node — e.g. every
            # query errored and the loop exhausted its iterations. First try a
            # best-effort synthesis from whatever evidence exists; only if there's
            # genuinely nothing to salvage do we surface a terminal stall message.
            salvaged = await asyncio.to_thread(
                _try_salvage, merged, inv_id, question, connection_id, schema=full_schema)
            if salvaged:
                yield salvaged
            else:
                yield _sse("error", _error_event(message=_stall_summary(merged), reason="stalled"))
                fail_investigation(inv_id, status="failed",
                                   reason=_stall_summary(merged))

    except Exception as e:
        # An unhandled node exception still shouldn't lose partial work — salvage
        # a best-effort report from gathered evidence before surfacing the error.
        # to_thread: salvage runs a synthesis, so inline it would block the loop on the
        # very path where the run is already in trouble. Safe to await here — this
        # catches Exception, so a CancelledError teardown never reaches it.
        salvaged = await asyncio.to_thread(
            _try_salvage, merged, inv_id, question, connection_id, schema=full_schema)
        if salvaged:
            yield salvaged
        else:
            fail_investigation(inv_id, status="failed",
                               reason=str(e))
            yield _sse("error", _error_event(e))
    finally:
        # Orphan reconcile. If we reach here with the row still 'running', no
        # terminal handler ran — the dominant cause is a client disconnect:
        # Starlette cancels the SSE coroutine with asyncio.CancelledError, which
        # is a BaseException and so slips past every `except Exception` above,
        # straight into this finally. Without this, the investigation orphans in
        # 'running' (no terminal event, no UI resolution) until the 60-min sweep.
        # fail_investigation journals the transition, so the event spine stays
        # consistent. Runs FIRST so it survives even if later cleanup is cut short.
        try:
            _inv_now = get_investigation(inv_id)
            if _inv_now and _inv_now.get("status") == "running":
                from pramanyx.kernel.jobs import describe_stop
                fail_investigation(inv_id, status="failed",
                                   reason=describe_stop(sys.exception()))
        except Exception:
            logger.debug("finally orphan-reconcile failed", exc_info=True)
        _telemetry.end_trace(trace_id)
        for _e in _paused_explorers:
            try:
                _e.resume()
                _e._paused_by_investigation = False
            except Exception as exc:
                from pramanyx.kernel.errors import tolerate
                tolerate(exc, "explorer resume after investigation is best-effort; the supervisor backstop re-resumes investigation-paused explorers",
                         counter="investigation.explorer_resume")
        db.close()
        yield _sse("done", {})


# ── HITL resume streaming ─────────────────────────────────────────────────────

def _filter_kept_subquestions(subqs: list, keep_idx: list[int]) -> list:
    """Keep only the sub-questions at the given indices, preserving order (P3 plan edit).
    Out-of-range indices are ignored; the caller treats an empty result as 'no valid edit'
    (and won't wipe the plan) rather than resuming an empty investigation."""
    keep = set(keep_idx)
    return [sq for i, sq in enumerate(subqs) if i in keep]


def _apply_clarify_choice(merged: dict, clarify_choice: Optional[str], connection_id: str) -> dict:
    """P4 clarify resume: bind the metric to the reading the user chose and crystallize the choice.
    Returns a state patch — the updated `_ada_intake` (metric_sql/metric_is_ratio bound to the chosen
    reading) and a cleared `_clarify_pending` (so the passthrough gate falls through to the real branch
    on resume). Returns {} when nothing is pending. An unmatched/absent choice defaults to the FIRST
    reading (the governed one). Fail-open — the ledger write never blocks the resume."""
    pending = merged.get("_clarify_pending") or {}
    readings = pending.get("readings") or []
    if not readings:
        return {}
    matched = next((r for r in readings if r.get("label") == clarify_choice), None)
    chosen = matched if matched is not None else readings[0]
    patch: dict = {"_clarify_pending": None}
    if chosen.get("sql"):
        intake = dict(merged.get("_ada_intake") or {})
        intake["metric_sql"] = chosen["sql"]
        intake["metric_is_ratio"] = bool(chosen.get("is_ratio"))
        patch["_ada_intake"] = intake
    if matched is None:
        # The run still binds the governed default so it can finish — but that is OUR
        # fallback, not the user's answer, and it must not be written down as one.
        # `crystallize_user_choice` records at USER authority, which outranks a probe
        # and persists for the whole connection: a stale or garbled resume would
        # durably teach the system a reading nobody picked. Provenance is required,
        # and there is no provenance here.
        logger.info("[clarify] resume choice %r matched no reading; binding the governed "
                    "default for this run WITHOUT crystallizing it", clarify_choice)
        from pramanyx.stats import bump
        bump("deep_analysis.clarify_unmatched")
        return patch
    try:
        from pramanyx.org.context import current_org_id
        from pramanyx.semantic.ambiguity_ledger import Reading, crystallize_user_choice
        crystallize_user_choice(
            connection_id, pending.get("subject") or "", chosen.get("label") or "",
            org_id=current_org_id() or "", resolved_sql=chosen.get("sql") or "",
            readings=[Reading(label=r.get("label", ""), sql_evidence=r.get("sql", "")) for r in readings])
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "crystallizing the clarify choice is best-effort; the run still binds the reading",
                 counter="deep_analysis.clarify_crystallize")
    return patch


async def _stream_resume(inv_id: str, feedback: str, request: Request,
                         keep_subquestions: Optional[list[int]] = None,
                         clarify_choice: Optional[str] = None) -> AsyncGenerator[str, None]:
    inv = get_investigation(inv_id)
    if not inv:
        yield _sse("error", _error_event(message="Investigation not found", reason="not_found"))
        yield _sse("done", {})
        return
    if inv.get("status") != "paused":
        yield _sse("error", _error_event(
            message=f"Investigation is not paused (status: {inv.get('status')})", reason="invalid_state"))
        yield _sse("done", {})
        return
    # Resume with the canvas scope (declared schema + derived owning-schema pin) if applicable.
    from pramanyx.canvas.scope import resolve_execution_scope
    try:
        _resumed_scope = resolve_execution_scope(inv["connection_id"], inv.get("canvas_id"))
        db = _resumed_scope.open()
    except Exception as e:
        yield _sse("error", _error_event(e))
        yield _sse("done", {})
        return

    try:
        from pramanyx.agent.graph import build_graph_generic
        agent = build_graph_generic(db, hitl=True)
        config = {"configurable": {"thread_id": inv_id}}
        checkpoint = agent.get_state(config)
        merged: dict = dict(checkpoint.values) if checkpoint else {}
        _patch: dict = {"human_feedback": feedback}
        # P3: apply the user's plan edit — keep only the chosen sub-questions before the
        # fan-out resumes. Guard against an empty plan (a "reject all" is a cancel, not a
        # resume). sub_questions is a plain (replaceable) state field, so update_state sets it.
        if keep_subquestions is not None:
            _kept = _filter_kept_subquestions(merged.get("sub_questions", []), keep_subquestions)
            if _kept:
                _patch["sub_questions"] = _kept
                _patch["current_subq_idx"] = 0
        # P4 clarify gate: bind the metric to the reading the user chose, clear the pending clarify (so
        # the passthrough gate falls through to the real branch), and crystallize the choice to the
        # Ambiguity Ledger (source=user) so this connection never re-asks. Fail-open: an unmatched choice
        # just resumes on the parsed reading.
        _clar_patch = _apply_clarify_choice(merged, clarify_choice, inv.get("connection_id") or "")
        if _clar_patch:
            _patch.update(_clar_patch)
        agent.update_state(config, _patch)

        import time
        _TIMEOUT = int(os.getenv("PRAMANYX_TIMEOUT_SECONDS", "600"))
        deadline = time.monotonic() + _TIMEOUT

        # A1 (2026-11-25): a resumed run records what its remaining nodes are given, as a started one does
        from pramanyx.trust.answer_inputs import start_recording
        start_recording()
        async for event in _investigation_stream(agent.stream(None, config=config),
                                                 declared=merged.get("declared_rules"),
                                                 held=_resumed_scope.held()):
            # Same K1 rule: the resumed job completes server-side despite a client disconnect (bounded by
            # the deadline; explicit stop still cancels). An early abort here wrote an empty receipt too.
            if time.monotonic() > deadline:
                yield _sse("error", _error_event(
                    message="Timed out waiting for synthesis.", reason="run_timeout"))
                fail_investigation(inv_id, status="timed_out",
                                   reason="timed out waiting for synthesis")
                return
            if "__report_delta__" in event:            # R6 live synthesis prose (flag-gated via the sink)
                yield _sse("report_delta", {"executive_summary": event["__report_delta__"]})
                continue
            if "__ada_progress__" in event:            # P2 live per-dimension progress (flag-gated)
                yield _sse("phase_progress", event["__ada_progress__"])
                continue
            if "__guard_receipt__" in event:           # A4 - a guard made an intervention visible
                yield _sse("guard_receipt", event["__guard_receipt__"])
                continue
            if "__chain_state__" in event:             # FL-2 - the failover chain narrated a hop
                yield _sse("chain_state", event["__chain_state__"])
                continue
            if "__interrupt__" in event:
                continue
            node_name = next(iter(event))
            # A resumed interrupt node (e.g. the P3 plan_gate) streams a None value for
            # the node it resumes into; guard the merge so it doesn't blow up the resume.
            merged = {**merged, **(event[node_name] or {})}
            if node_name == "synthesize" and merged.get("report"):
                qh = merged.get("query_history", [])
                yield _sse("report", {"report": merged["report"].model_dump(), "hypotheses": [h.model_dump() for h in merged.get("hypotheses", [])], "query_count": len(qh), "query_history": [{"hypothesis_id": r.hypothesis_id, "sql": r.sql, "row_count": r.row_count, "error": r.error, "columns": r.columns, "rows": r.rows[:50], "stats": [s.model_dump() for s in (r.stats or [])]} for r in qh], "investigation_id": inv_id, **_early(inv_id)})
                complete_investigation(inv_id, report=merged["report"], hypotheses=merged.get("hypotheses", []), query_history=qh, question=inv["question"], connection_id=inv.get("connection_id", ""))
                _record_memory(inv_id, inv.get("connection_id", ""), inv["question"], merged)
            elif node_name == "reason_over_result":
                # P3 plan-gate resume streams the EXPLORE path too — surface each
                # sub-question answer as it lands (this loop only handled the deep-analysis path before).
                answers = merged.get("subq_answers", [])
                if answers:
                    yield _sse("subq_answer", _explore_subq_event(answers[-1]))
            elif node_name == "plan_and_execute_wave":
                for _a in (event[node_name] or {}).get("subq_answers", []) or []:
                    yield _sse("subq_answer", _explore_subq_event(_a))
            elif node_name == "synthesize_exploration" and merged.get("explore_report"):
                er = merged["explore_report"]
                answers = await _reduced_subq_answers(agent, inv_id, merged.get("subq_answers", []))
                qh = merged.get("query_history", [])
                sq_raw = [sq.model_dump() for sq in merged.get("sub_questions", [])]
                sa_raw = [a.model_dump() for a in answers]
                yield _sse("tables_used", {"tables": _extract_tables(" ".join(r.sql for r in qh if r.sql))})
                yield _sse("explore_report", {"explore_report": er.model_dump(), "sub_questions": sq_raw, "subq_answers": sa_raw, "query_count": len(qh), "investigation_id": inv_id, "query_mode": "explore", "frame": merged.get("ontology_frame"), **_early(inv_id)})
                explore_save = {"_report_type": "explore", **er.model_dump(), "sub_questions": sq_raw, "subq_answers": sa_raw}
                complete_investigation(inv_id, report=explore_save, hypotheses=[], query_history=qh, question=inv["question"], connection_id=inv.get("connection_id", ""))
                _record_memory(inv_id, inv.get("connection_id", ""), inv["question"], merged)
    except Exception as e:
        fail_investigation(inv_id, status="failed",
                           reason=str(e))
        yield _sse("error", _error_event(e))
    finally:
        # Same orphan-reconcile as the main stream: a client disconnect raises
        # CancelledError (BaseException) past the except handlers, so fail any row
        # still 'running' here — keeps it off the 60-min sweep and on the spine.
        try:
            _inv_now = get_investigation(inv_id)
            if _inv_now and _inv_now.get("status") == "running":
                from pramanyx.kernel.jobs import describe_stop
                fail_investigation(inv_id, status="failed",
                                   reason=describe_stop(sys.exception()))
        except Exception:
            logger.debug("resume finally orphan-reconcile failed", exc_info=True)
        db.close()
        yield _sse("done", {})


# ── Routes ────────────────────────────────────────────────────────────────────

async def _metered_stream(gen: AsyncGenerator[str, None],
                          budget: tuple | None = None) -> AsyncGenerator[str, None]:
    """Meter a synchronous streaming answer + enforce its budget in-context. The
    quick-answer path is not a kernel job, so it has no JobKernel._run (to flush its
    compute) and no heartbeat (to enforce a budget). We set the per-run accumulator
    for the whole iteration — the receipt reads it via metering.snapshot() — and arm
    the Insight agent's budget; the LLM funnel raises BudgetExceeded (a BaseException,
    so it unwinds past the answer path's fail-open try/excepts), surfaced here as a
    clean error event. Output is otherwise passed through unchanged.

    Inside a kernel job it METERS INTO THE JOB'S accumulator rather than starting its
    own. A fresh one shadowed the job's for the whole run: the heartbeat and the final
    flush read an accumulator nothing wrote to, so every analyst-body job flushed zero
    spend (measured on every scheduled run 09-10 → 09-16), its token budget could never
    fire, and its failure said "0 queries".

    Inside a kernel job, a budget it did not arm is the job's own — `JobKernel._run` arms it
    and its heartbeat enforces it — so its stop is re-raised to the job, which records it as
    the kernel's kill: CANCELLED, with the budget, the spend and the fix. Caught here it read
    as the Responder's and ended the job SUCCEEDED, its investigation left 'running'
    (2026-11-24, e4796f93)."""
    from pramanyx.kernel import metering
    from pramanyx.kernel.jobs import current_job_id
    token = metering.start() if metering.current() is None else None
    btoken = metering.set_budget(*budget) if budget else None
    try:
        async for chunk in gen:
            yield chunk
    except metering.BudgetExceeded as be:
        if btoken is None and current_job_id() is not None:
            raise
        # The budget armed here is the Responder's, so the event names it: the chat links
        # straight to that agent's page, where the budget is raised.
        from pramanyx.kernel.agents import RESPONDER_ID
        yield _sse("error", _error_event(
            be, message=f"Answer stopped — the Responder's {be.reason} was reached.",
            reason="budget_exceeded", agent_id=RESPONDER_ID))
    finally:
        if btoken is not None:
            metering.clear_budget(btoken)
        if token is not None:
            metering.reset(token)


def _insight_budget(conn_id: str):
    """Resolve the Insight agent's Org/workspace-governed token + time budget."""
    try:
        from pramanyx.kernel.agents import RESPONDER_ID, effective_governance
        from pramanyx.workspace.store import workspace_for_connection
        gov = effective_governance(RESPONDER_ID, workspace_for_connection(conn_id))
        return (gov.token_budget, gov.time_budget_s)
    except Exception:
        return None


def _resolve_conn(req) -> str:
    """A canvas-scoped request resolves to the canvas's underlying connection."""
    conn_id = req.connection_id
    if req.canvas_id:
        from pramanyx.canvas.store import resolve_connection_id
        resolved = resolve_connection_id(req.canvas_id)
        if resolved:
            conn_id = resolved
    return conn_id


def _refuse_unless_answerable(request: "Request | None", conn_id: str) -> None:
    """The connection a question will be answered over is the caller's org's, or the question is refused before
    anything streams (2026-11-08). The router's guard reads the body's ``connection_id`` and ``canvas_id``; this
    reads what they RESOLVED to, after a canvas and an agent's binding had their say. A caller with no HTTP request
    (a schedule, an eval, an agent door that resolved its own) passes ``None`` and is the platform's own."""
    if request is not None:
        from pramanyx.security.authz import refuse_if_foreign
        refuse_if_foreign("connection", conn_id, get_principal(request))


@router.post("/chat")
async def chat_endpoint(req: ChatRequest, request: Request):
    _thread_door(req.session_id or "")
    conn_id = _resolve_conn(req)
    _refuse_unless_answerable(request, conn_id)
    # The legacy door gets the same session log as /ask — it has its own endpoint
    # rather than going through build_ask_stream, so without this it stays dark.
    stream = stream_with_session_log(
        _stream_chat(req.question, conn_id, req.history,
                     session_id=req.session_id, canvas_id=req.canvas_id,
                     surface=req.surface),
        question=req.question, conn_id=conn_id, door="chat",
        canvas_id=req.canvas_id or "")
    return StreamingResponse(
        _metered_stream(stream, budget=_insight_budget(conn_id)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


_STREAM_END = object()   # queue sentinel: the investigation generator finished


def _error_said(sse: str) -> str:
    """The message of an ``error`` frame, or "" for any other frame — read only when the frame is one."""
    if not sse.startswith('data: {"type": "error"'):
        return ""
    try:
        return str(json.loads(sse[6:]).get("message") or "")
    except Exception:
        return ""


_HANDED_FRAME = 'data: {"type": "already_running"'


def _handed_said(sse: str) -> str:
    """What an ``already_running`` frame said — the run this one was handed (`agent/one_run.py`) — or ""."""
    if not sse.startswith(_HANDED_FRAME):
        return ""
    try:
        return str(json.loads(sse[6:]).get("already_running") or "") or "handed a run already under way"
    except Exception:
        return "handed a run already under way"


_TURN_FACT_TYPES = ('data: {"type": "answer_report"', 'data: {"type": "report"', 'data: {"type": "headline"',
                    'data: {"type": "receipt_id"')


def _turn_facts(sse: str) -> tuple[str, str]:
    """``(headline, receipt_id)`` a frame carries — what the door's session log reads off a turn — or empties."""
    if not sse.startswith(_TURN_FACT_TYPES):
        return "", ""
    try:
        frame = json.loads(sse[6:])
    except Exception:
        return "", ""
    kind = frame.get("type")
    if kind == "receipt_id":
        return "", str(frame.get("receipt_id") or "")
    if kind == "headline":
        return str(frame.get("headline") or ""), ""
    report = frame.get(kind) if isinstance(frame.get(kind), dict) else {}
    return str(report.get("headline") or ""), ""


def _open_resume_run(session_id: str):
    """FL-1b — the frame-hub run mirroring this investigation's SSE for reattach
    (key = the conversation). Unconditional since 2026-08-28: ``ask.resume_stream``
    graduated on its declared receipt (tombstone in kernel/flags.py).

    None when the turn has no conversation id — the caller then publishes
    nothing. A session runs one turn at a time, so a still-open earlier run is
    superseded rather than raised on: latest-wins is the hub's contract with the
    client, and the interrupt path cancels the superseded turn's kernel job
    separately."""
    if not session_id:
        return None
    from pramanyx.util.frame_hub import RunExists, hub
    key = f"ask:{session_id}"
    try:
        try:
            return hub().open_run(key)
        except RunExists:
            hub().close_run(key, "superseded by a newer turn in this conversation")
            return hub().open_run(key)
    except Exception:
        # The mirror is an add-on; a hub problem must never block the run itself.
        logger.debug("resume hub open failed for %s", key, exc_info=True)
        return None


async def _investigation_job_streamed(
    question: str,
    connection_id: str,
    request: Request,
    *,
    hitl: bool = False,
    skip_cache: bool = False,
    canvas_id: Optional[str] = None,
    schema_scope: Optional[str] = None,
    seed_sql: Optional[str] = None,
    seed_context: str = "",
    insight_id: Optional[str] = None,
    deep: bool = False,
    history: Optional[list] = None,
    requested_mode: str = "investigate",
    purpose: str = "",
    allow_clarify: bool = True,
    session_id: str = "",
    claim: Any = None,
    run_id: str = "",
) -> AsyncGenerator[str, None]:
    """Run the investigation as a first-class supervised kernel job (K1).

    `_stream_investigation` is left UNCHANGED — it just executes inside the job's
    task instead of the request coroutine, with its SSE events bridged to the
    client over an in-process queue. That alone makes a live investigation a real
    job: a `job.state` PENDING→RUNNING→SUCCEEDED|FAILED|CANCELLED lifecycle on the
    event spine, a heartbeat (orphan detection), kernel-driven cancellation, and
    artifacts auto-stamped with `created_by_job` (the contextvar is set around the
    coro) — the same supervision the explorer already has. Latency is unchanged:
    the queue hop is in-process and `await queue.put` preserves natural backpressure.
    """
    async for sse in _job_streamed_body(
        lambda: _stream_investigation(
            question, connection_id, request,
            hitl=hitl, skip_cache=skip_cache, canvas_id=canvas_id,
            schema_scope=schema_scope, seed_sql=seed_sql, seed_context=seed_context,
            insight_id=insight_id, deep=deep, history=history,
            requested_mode=requested_mode, purpose=purpose,
            allow_clarify=allow_clarify, session_id=session_id, run_id=run_id,
        ),
        session_id=session_id, conn_id=connection_id, canvas_id=canvas_id,
        payload={"question": question[:200], **({"purpose": purpose} if purpose else {}),
                 **({"investigation_id": run_id} if run_id else {})},        # the job names its run while queued
        claim=claim,
    ):
        yield sse


async def _job_streamed_body(
    body_factory: Callable[[], AsyncGenerator[str, None]],
    *,
    session_id: str,
    conn_id: Optional[str] = None,
    canvas_id: Optional[str] = None,
    payload: Any = None,
    claim: Any = None,
) -> AsyncGenerator[str, None]:
    """The K1 bridge, generalised (FL-1b): run any SSE body inside a supervised
    kernel job and drain its frames to the request over an in-process queue.

    Extracted from `_investigation_job_streamed` when the CA-3 analyst body
    joined it — the analyst serves the deep turn, and a
    request-driven analyst died with its tab (row orphaned 'running') while the
    graph path had K1 supervision. One bridge now carries both: job lifecycle +
    heartbeat, kernel-driven cancellation, `created_by_job` stamping (which is
    what lets `/investigations/{id}/cancel` find the job), and the frame-hub
    mirror `GET /ask/stream/{session_id}` reattaches to. The factory is called
    INSIDE the job task, so the body's context (metering, identity, artifact
    stamping) is the job's.
    """
    from pramanyx.kernel.jobs import kernel
    queue: asyncio.Queue = asyncio.Queue()
    try:
        # The queue serves THIS request; the hub serves every later one.
        resume_run = _open_resume_run(session_id)
    except BaseException as exc:
        if claim is not None:
            _let_go_unstarted(claim, f"The run could not be started: {str(exc)[:200] or type(exc).__name__}.")
        raise

    drove: list = []                       # `_drive` ran: the run ends its own row, stream and claim

    async def _drive() -> None:
        drove.append(True)
        err: Optional[str] = None
        stop_exc: Optional[BaseException] = None
        seen_inv: Optional[str] = None
        said = ""          # the last error the body streamed — its own word on why it stopped
        headline, receipt = "", ""   # what the door's session log would have read, for a reader that left
        handed = ""                  # the run this one was handed instead (`agent/one_run.py`), as it was said
        envelope = _TURN_ENVELOPE.get()   # the turn's answer envelope, this job's to fold and file (`_TurnEnvelope`)
        try:
            async for sse in body_factory():
                if envelope is not None:
                    _fold(envelope.folder, sse)
                if seen_inv is None and '"investigation_id"' in sse and not sse.startswith(_HANDED_FRAME):
                    # Sniffed off the frames the way the session log does — the
                    # bridge carries bodies that never hand it an id directly. Never off a hand-back's frame: the id it
                    # names is the run under way, not this one, and this one's end would be written onto it.
                    try:
                        seen_inv = ((json.loads(sse[6:]) if sse.startswith("data: ")
                                     else {}).get("investigation_id") or None)
                    except Exception:
                        seen_inv = None
                    if seen_inv and claim is not None:
                        await asyncio.to_thread(claim.found, seen_inv)   # a repeat is handed this run from here on
                said = _error_said(sse) or said
                _head, _receipt = _turn_facts(sse)
                headline, receipt = _head or headline, _receipt or receipt
                handed = _handed_said(sse) or handed
                await queue.put(sse)
                if resume_run is not None:
                    resume_run.publish(sse)
        except BaseException as exc:
            # The stream's own error frames flow above; this catches the ways a
            # run ends WITHOUT one — chiefly kernel cancellation — so a late
            # resumer sees a closed-with-reason run, not a silent cliff.
            err = str(exc)[:200] or type(exc).__name__
            stop_exc = exc
            raise
        finally:
            if claim is not None:
                claim.end()                        # the run is over: its question may start again (never raises)
                # the row its door made as it claimed is this run's, though its stream never named it (a body that
                # stopped before its start frame: a connection that would not open)
                seen_inv = seen_inv or claim.inv_id
            why = ""
            if seen_inv:
                # Terminal consistency for ANY body the bridge carries, however it
                # ended: the graph path reconciles its own row in its finally, but
                # the analyst body never did. A cancelled analyst run left its
                # investigation 'running' until the sweep (seen live, FL-1b
                # receipt), and so did one that ENDED without raising — a budget
                # stop explained as an error frame, a crash `_stream_analyst` turned
                # into one (2026-11-24, e4796f93: 'running' until a restart's sweep
                # called it orphaned). Idempotent: a row already terminal — complete,
                # failed, or paused for a person — is left alone.
                try:
                    from pramanyx.db.history import fail_if_running
                    from pramanyx.kernel.jobs import describe_end, describe_stop
                    _why = describe_stop(stop_exc) if stop_exc is not None else describe_end(said)
                    if fail_if_running(seen_inv, _why):
                        why = _why
                except Exception:
                    logger.debug("bridge reconcile failed for %s", seen_inv, exc_info=True)
            if not said and (stop_exc is not None or why):
                # Withheld is said: a stream that just ends tells its reader nothing, so a
                # run that stopped without saying why says it here, in the record's words.
                try:
                    from pramanyx.kernel import metering
                    from pramanyx.kernel.jobs import current_charter_id, describe_stop, stop_reason
                    if not why:
                        why = describe_stop(stop_exc)
                    # The code is the shared vocabulary's: the exception's own, except a heartbeat's
                    # budget kill, which arrives as a cancel. A budget stop names the agent whose page raises it.
                    budget = (isinstance(stop_exc, metering.BudgetExceeded)
                              or stop_reason().startswith("budget exceeded"))
                    told = _sse("error", _error_event(
                        stop_exc, message=why, reason="budget_exceeded" if budget else "",
                        agent_id=(current_charter_id() or "") if budget else ""))
                    if envelope is not None:
                        _fold(envelope.folder, told)
                    queue.put_nowait(told)
                    if resume_run is not None:
                        resume_run.publish(told)
                except Exception:
                    logger.debug("bridge could not say why the run stopped", exc_info=True)
            # The turn's end in the session log is the job's to write when the reader left first (`_TurnEnd`); set
            # before the drainer is released, so a reader leaving after this reads the run's outcome, not its own cancel.
            turn = _TURN_END.get()
            if turn is not None and turn.carried:
                try:
                    _row = get_investigation(seen_inv) if seen_inv else None
                    if handed:
                        ok, headline = True, headline or handed      # handed a run under way: not a failure
                    elif _row is not None:
                        ok = _row.get("status") in ("complete", "paused", "handed_back")
                    else:
                        ok = stop_exc is None and not said
                    error = None
                    if not ok:
                        from pramanyx.kernel.jobs import describe_end
                        error = why or said or str((_row or {}).get("error") or "") or describe_end("")
                    head = headline or str((_row or {}).get("headline")
                                           or ((_row or {}).get("report") or {}).get("headline") or "")
                    turn.outcome = {"inv_id": seen_inv, "ok": ok, "headline": head[:2000],
                                    "receipt_id": receipt or None, "error": error}
                    if turn.reader_left_ms is not None:
                        _write_turn_end(turn, turn.outcome)
                except Exception:
                    logger.debug("bridge could not write the run's end for a reader that left", exc_info=True)
            if envelope is not None:
                # Filed here, at the run's end, before the drainer is released: a reader still on the stream is handed
                # the same envelope by the door, and one that left finds it on the run's row.
                try:
                    env = envelope.folder.finish()
                    if env.has_answer:
                        envelope.filed = env.model_dump()
                        await _file_envelope(envelope, envelope.filed, env.provenance.investigation_id)
                except Exception:
                    logger.debug("bridge could not file the run's answer envelope", exc_info=True)
            if resume_run is not None:
                resume_run.close(error=err)
            # Always release the client drainer, even on cancellation/error.
            queue.put_nowait(_STREAM_END)

    # The run is carried by its job from here: a reader that leaves hands the turn's end to it (`_TurnEnd`), and the
    # job folds and files the turn's answer envelope whether or not anyone reads on (`_TurnEnvelope`).
    turn_end, turn_envelope = _TURN_END.get(), _TURN_ENVELOPE.get()
    for _carried in (turn_end, turn_envelope):
        if _carried is not None:
            _carried.carried = True

    def _finished(_job_id: str, state: str) -> None:
        """The kernel's end of the run's job (`on_finish`), however it ended. A run that started ended its own row, stream
        and claim (`_drive`). One whose job ended before it did — cancelled while it waited for a free slot — had nothing
        to: here its claim is let go, the row its door made is ended, the turn's end and answer say why, and its reader
        is told and let go (until 2026-11-24 that reader was kept on keep-alives for good)."""
        if drove:
            if claim is not None:
                claim.end()
            return
        from pramanyx.kernel.jobs import JobState
        why = ("Cancelled before it started: it was waiting for a free analysis slot." if state == JobState.CANCELLED
               else f"Its job ended ({str(state).lower()}) before the run started.")
        run_id = getattr(claim, "inv_id", None) if claim is not None else None
        if claim is not None:
            _let_go_unstarted(claim, why)
        told = _sse("error", _error_event(None, message=why))     # its own sentence, not a code's generic hint
        if turn_end is not None and turn_end.carried:
            try:
                turn_end.outcome = {"inv_id": run_id, "ok": False, "headline": "", "receipt_id": None, "error": why}
                if turn_end.reader_left_ms is not None:
                    _write_turn_end(turn_end, turn_end.outcome)
            except Exception:
                logger.debug("the end of a run that never started could not be written", exc_info=True)
        if turn_envelope is not None and run_id:
            try:
                from pramanyx.db.history import attach_envelope
                _fold(turn_envelope.folder, told)
                turn_envelope.filed = {**turn_envelope.folder.finish().model_dump(), "error": why}   # why, not a hint
                attach_envelope(run_id, turn_envelope.filed, asked=turn_envelope.question)
            except Exception:
                logger.debug("the answer of a run that never started could not be filed", exc_info=True)
        queue.put_nowait(told)
        if resume_run is not None:
            resume_run.publish(told)
            resume_run.close(error=why)
        queue.put_nowait(_STREAM_END)
    try:
        job_id = await kernel().submit(
            "investigation", _drive,
            conn_id=conn_id, canvas_id=canvas_id,
            # R10 — the starter's purpose tag rides the job row, so Fleet/jobs
            # are queryable per purpose.
            payload=payload,
            # A job cancelled while still queued never runs `_drive`: the kernel's end closes what the run would have.
            on_finish=_finished,
        )
    except BaseException as exc:
        if claim is not None:                      # no job took the run: nothing holds its question, its row says so
            _let_go_unstarted(claim, f"The run could not be started: {str(exc)[:200] or type(exc).__name__}.")
        raise
    if claim is not None:
        await asyncio.to_thread(claim.started, job_id)   # the claim stands while this job does — queued or running
        if claim.inv_id:
            # The run its door named as it claimed the question, said the moment its job holds it: the reader has its id
            # though the job waits for a slot (the body's own start frame, once it runs, names the same run). Sent once
            # submitted, never before, so a reader that leaves here leaves a run that goes on, not a row nothing ends.
            named = _sse("start", {"connection_id": conn_id, "investigation_id": claim.inv_id})
            if resume_run is not None:
                resume_run.publish(named)
            yield named
    logger.debug("investigation job %s submitted", job_id)
    while True:
        try:
            item = await asyncio.wait_for(queue.get(), timeout=KEEP_ALIVE_EVERY)
        except asyncio.TimeoutError:
            yield KEEP_ALIVE_SAID                     # a deep run's long phase: the stream is kept open
            continue
        if item is _STREAM_END:
            break
        yield item


@router.post("/investigate", dependencies=[gate(Capability.DEEP_ANALYSIS)])
async def investigate(req: InvestigateRequest, request: Request):
    conn_id = _resolve_conn(req)
    return StreamingResponse(
        _investigation_job_streamed(
            req.question, conn_id, request,
            hitl=req.hitl, skip_cache=req.skip_cache, canvas_id=req.canvas_id,
            schema_scope=req.schema_name, seed_sql=req.seed_sql, seed_context=req.seed_context,
            insight_id=req.insight_id, deep=req.escalate, history=req.history,
            allow_clarify=req.allow_clarify, session_id=req.session_id,
            requested_mode="investigate",   # the explicit deep surface; R9's wide→explore route left 2026-10-28
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _converse_eligible(req, route) -> bool:
    """Whether this ``/ask`` turn may be served by the converse body instead of the quick one.

    The binding first, for the short-circuit: ``binding_calls_tools()`` is read at CALL time
    (never at import). A coder binding that cannot make a tool call takes the quick body — the
    ineligible-turn fallback, the one path the conversation does not serve (it was also the
    whole of ``ask.converse``'s off path until that flag was made unconditional, 2026-10-28).

    CI-4 shrank the carve-outs, one at a time as the plan requires. The seeded-SQL and
    dossier-drill flags stopped being bypasses: such a turn now carries its
    origin finding INTO the conversation as context (see ``_origin_prose_for``), and the
    conversation — which owns a ``deep_analysis`` tool — decides whether the question
    needs the full investigation. A dossier drill is recognisable on the route as
    ``forced == "dossier"``; it is deep by ROUTING convention, not because the user asked
    for a report, which is exactly why the conversation may take it.

    CA-3 dissolved the last two carve-outs' REASON: a deep or escalated turn is now
    served by the ANALYST body (:func:`_analyst_eligible` / :func:`_stream_analyst`),
    whose frames stream through the turn exactly as CI-6a's renderer needed. This
    predicate keeps answering the narrower question it always answered — "may a
    QUICK turn be served by plain converse" — so deep/escalate still return False
    here and take the analyst door instead.
    """
    from pramanyx.agent.converse_tools import binding_calls_tools
    if not binding_calls_tools() or req.escalate:
        return False
    return route.depth != "deep" or route.forced == "dossier"


def _analyst_eligible(req, route) -> bool:
    """CA-3 — the door opens: a deep or escalated ``/ask`` turn is served by the
    analyst loop.

    Two deliberate exclusions. A dossier drill stays a CONVERSATION (Tier-0 read
    posture — the trace already exists; CI-4 decided the conversation takes it,
    holding ``deep_analysis`` in reserve). A router-chosen ``explore`` wave keeps the
    explore graph — the analyst investigates one question; it does not run the
    multi-cut landscape scan. With a coder binding that cannot call tools, the phase
    script serves every deep turn (§5's free-tier ladder: the library remains the fallback).
    """
    from pramanyx.agent.converse_tools import binding_calls_tools
    if not binding_calls_tools():
        return False
    if route.forced == "dossier" or route.mode == "explore":
        return False
    return route.depth == "deep" or bool(req.escalate)


def _joined(*parts: str) -> str:
    return "\n\n".join(p for p in parts if p)


async def _ask_subject_for(req, conn_id: str, request) -> Any:
    """Arc FA-2 — the subject a turn carries, read for the person asking (`agent.ask_subject`), off the event loop: the
    reads are the object door's. None when the focus is SP-15's one object."""
    from pramanyx.agent.ask_subject import is_subject, resolve
    focus = getattr(req, "focus", None)
    if not is_subject(focus):
        return None
    from pramanyx.dashboards.home import person_of
    return await asyncio.to_thread(resolve, focus, conn_id, req.schema_name, person=person_of(request))


def _briefing_scope_key(conn_id: str, schema: Optional[str], canvas_id: Optional[str]) -> str:
    """The scope an edition is kept under, by the edition routes' one resolver — so the Briefing context beside a
    question reads the edition the page drew. "" when it cannot be resolved; the context then reads as it did."""
    try:
        from pramanyx.routers.exploration import edition_scope
        return edition_scope(conn_id, schema, canvas_id)[1]
    except Exception as exc:  # noqa: BLE001 — best-effort, as the context it feeds is
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the Briefing's scope could not be resolved; the context reads its own guess",
                 counter="ask.briefing_scope")
        return ""


async def _briefing_part_for(req, conn_id: str) -> Any:
    """ROADMAP §6 item 46 — the part of a Briefing a turn names as its focus, read from the edition the page drew, off
    the event loop. None when the focus names no part; a part with ``refused`` set when it cannot be read."""
    focus = getattr(req, "focus", None)
    if focus is None or getattr(focus, "kind", "") != "briefing":
        return None
    return await asyncio.to_thread(_read_briefing_part, focus, conn_id, req.schema_name, req.canvas_id)


def _read_briefing_part(focus, conn_id: str, schema: Optional[str], canvas_id: Optional[str]) -> Any:
    """The part, read under the scope the edition routes keep it under — the dataset's, or a Data Canvas's own — so the
    question reads the very edition the page drew (`routers.exploration.edition_scope`, the one resolver)."""
    from pramanyx.knowledge.brief_context import EditionPart, edition_part
    from pramanyx.routers.exploration import edition_scope
    try:
        _schema, scope_key, _tables, _canvas = edition_scope(conn_id, schema, canvas_id)
        return edition_part(scope_key, focus.period, focus.id, source=focus.source)
    except HTTPException as exc:
        return EditionPart(refused=f"The Briefing this part is on could not be read: {exc.detail}.")
    except Exception as exc:  # noqa: BLE001 — a part that cannot be read is said, never a broken stream
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "ask: the Briefing a part is on could not be read; the turn is refused and says so",
                 counter="ask.briefing_part_unread")
        return EditionPart(refused="The Briefing this part is on could not be read, so the question cannot start "
                                   "from it. Read the page again, then ask.")


def _sheet_ref(req) -> str:
    """Arc SH, SH-4 — the sheet a question was asked beside (``<sheet id>`` or ``<sheet id>:<view id>``), or ''."""
    focus = getattr(req, "focus", None)
    return str(getattr(focus, "id", "") or "") if focus is not None and getattr(focus, "kind", "") == "sheet" else ""


def _asker(request) -> str:
    """Who asks, as the dashboards name them (`person_of`)."""
    from pramanyx.dashboards.home import person_of
    return person_of(request)


def _conversation_drafts_dashboards(req, request) -> bool:
    """Whether the body that serves this turn is the conversation, holding `make_dashboard` (Stage 4, 2026-11-20): a quick
    turn, for a person the dashboards know, on a model that calls tools."""
    if req.depth != "quick" or not _asker(request):
        return False
    try:
        from pramanyx.agent.converse_tools import binding_calls_tools
        return bool(binding_calls_tools())
    except Exception:  # noqa: BLE001 — not known: the door says where dashboards are made, as before
        return False


def _own_dashboard(req, request) -> Optional[tuple[str, ...]]:
    """``(person, dashboard id)`` when a question is asked about a dashboard the asker keeps — one shared with them (named
    with its owner) is theirs to read, not to change — else None; ``(person, dashboard id, card id)`` when it is asked about
    one chart of it (2026-11-19: the chart's own look can then be changed)."""
    focus = getattr(req, "focus", None)
    if focus is None or getattr(focus, "kind", "") != "dashboard" or getattr(focus, "owner", "") or not focus.dashboard:
        return None
    from pramanyx.dashboards.home import person_of
    card = str(getattr(focus, "id", "") or "")
    return (person_of(request), focus.dashboard, card) if card else (person_of(request), focus.dashboard)


#: What the conversation is told when the person chose Agent on a dashboard they keep (`_conversation_decides`).
AGENT_CHOSEN_PROSE = (
    "## The person chose Agent\n"
    "They asked for depth on this turn. If they ask a question about the data, answer it with `deep_analysis`. "
    "If they ask to change the dashboard, use `change_dashboard` and run no analysis.")

#: The turn's line when the conversation decided it, said in the reader's words.
AGENT_CHOSEN_WHY = "Agent on your dashboard: a deep analysis for a question, a change for a change"


def _conversation_decides(req, request) -> bool:
    """Whether an Agent (deep) turn is served by the conversation rather than the analyst: asked about a dashboard the
    person keeps, where they may ask a question or ask for a change in the same box (the user, 2026-11-19, "Conversation
    decides"). The conversation holds both `deep_analysis` and `change_dashboard` and is told the person chose Agent
    (`AGENT_CHOSEN_PROSE`). A seeded drill from a finding stays an analysis: it asks for one by construction."""
    if getattr(req, "insight_id", None) or getattr(req, "seed_sql", None):
        return False
    return _own_dashboard(req, request) is not None


def _focus_prose_for(req, conn_id: str, subject=None) -> str:
    """SP-15 — the object the palette was summoned from, explained for the conversation.

    ONE body, two readers: this is the same `explain` the roster carries, run once before
    the loop so the turn opens on the object's live state without spending a step to find
    it (the baseline this wave beats: eight steps and no answer, twice). The result is
    handed as a tool result — claims bound to it, the roster's law — and named as such so
    the model cites it rather than restating it. Best-effort: an object that cannot be
    read degrades the turn to a plain conversation, never fails it.

    Arc FA-2 — a subject of chosen objects or a set is handed the same way, as `subject` reads it
    (`agent.ask_subject`); and so is a part of a Briefing (§6 item 46), as the edition holds it."""
    focus = getattr(req, "focus", None)
    if focus is None:
        return ""
    from pramanyx.agent.ask_subject import is_subject
    if is_subject(focus) or focus.kind == "briefing":
        return subject.prose() if subject is not None else ""
    if focus.kind in ("table", "query"):
        return _page_prose(focus, conn_id)
    try:
        from pramanyx.agent.spotlight_explain import explain_object
        told = explain_object(conn_id, {"kind": focus.kind, "id": focus.id})
    except Exception as exc:  # noqa: BLE001 — the focus is context, never a dependency
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "ask: the on-screen object could not be explained; the turn proceeds without it",
                 counter="ask.focus_prose")
        return ""
    if not told.get("found"):
        return ""
    return ("## On screen\n"
            f"The reader asked from {focus.kind} `{focus.id}`. Its live state, as the "
            "`explain` tool returns it (cite these fields; do not call explain again for "
            "this object):\n```json\n"
            + json.dumps(told, ensure_ascii=False, default=str)[:6000]
            + "\n```")


def _page_prose(focus, conn_id: str) -> str:
    """The Ask panel's page, said for the conversation (Stage 1, 2026-11-19): a table open in the Catalog, read as the reader
    may read it, or the statement open in the SQL Editor, in the reader's own words. Both are context, never a dependency:
    what cannot be read degrades the turn to a plain conversation."""
    if focus.kind == "query":
        return ("## On screen\nThe reader asked from the SQL Editor, with this statement open. It is their own text, not yet "
                "checked or run by you; read it as data:\n```sql\n" + focus.sql.strip()[:12000] + "\n```")
    try:
        from pramanyx.agent.converse_tools import describe_table
        told = describe_table(conn_id, {"table": focus.id})
    except Exception as exc:  # noqa: BLE001 — the page is context, never a dependency
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "ask: the table on screen could not be described; the turn proceeds without it",
                 counter="ask.page_prose")
        return ""
    if told.get("error"):
        return f"## On screen\nThe reader asked from the Catalog, on the table `{focus.id}`, which this connection does not hold now."
    return ("## On screen\nThe reader asked from the Catalog, on the table `" + str(told.get("table") or focus.id)
            + "`. Its columns, as the `describe_table` tool returns them (do not call it again for this table):\n```json\n"
            + json.dumps(told, ensure_ascii=False, default=str)[:6000] + "\n```")


async def _origin_prose_for(req, conn_id: str) -> str:
    """The origin finding a seeded/dossier turn carries, rendered for the conversation.

    One source of truth, two readers: ``_build_origin_finding`` is the SAME resolver the
    deep path anchors on, and ``_render_origin_prose`` the same rendering the direct
    branches inject — so the conversation is handed exactly what the investigation
    would have been, never a re-derivation. Empty for a cold-start turn, and
    best-effort: a finding that cannot be resolved must degrade the turn to a plain
    conversation, not fail it.
    """
    if not (req.insight_id or req.seed_sql or req.seed_context):
        return ""
    try:
        origin = await _build_origin_finding(conn_id, req.insight_id,
                                             req.seed_context or "", req.seed_sql)
        return _render_origin_prose(origin) if origin else ""
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "an unresolvable origin finding degrades the turn to a plain "
                 "conversation", counter="ask.converse_origin")
        return ""


def _conn_names(conn_ids: list[str]) -> list[str]:
    from pramanyx.db.registry import list_connections
    by_id = {c.get("id"): (c.get("name") or c.get("id")) for c in list_connections()}
    return [by_id.get(cid, cid) for cid in conn_ids]


# ── Overview / "interesting facts about this schema" (the default first-look) ──
# The widest-possible question, answered as a deterministic profile of the
# whole dataset, not an investigation of one metric. Detection is a phrasing regex AND
# the ABSENCE of a named metric/entity/time window — so a specific question still routes
# normally. Fully deterministic (no LLM) → graduated to Auto (flag `ask.overview`).
_OVERVIEW_RE = re.compile(
    r"\b(interesting facts?|tell me about|what'?s (notable|interesting|here|in "
    r"(this|the))|describe (this|the) (data|schema|dataset|tables?)|summar(y|ize|ise)"
    r"|overview of|show me around|what can i ask|explore (this|the) (data|schema|dataset)"
    r"|get to know|first look|what'?s in (this|the) (data|schema|dataset))\b", re.I)


_OVERVIEW_GENERIC = re.compile(
    r"\b(this|that|the|these|those|my|our|data|dataset|datasets|schema|table|tables|"
    r"here|about|me|show|give|tell|please|some|any)\b", re.I)


def _is_overview_question(question: str) -> bool:
    q = (question or "").strip()
    if not _OVERVIEW_RE.search(q):
        return False
    # signal-absence guard: strip the overview phrasing + generic dataset nouns, then
    # require NO leftover metric/entity/time — so "tell me about REVENUE" (a real ask)
    # still routes normally while "what's notable in this dataset" stays an overview.
    residual = _OVERVIEW_GENERIC.sub(" ", _OVERVIEW_RE.sub(" ", q))
    from pramanyx.semantic.answer_resolution import (
        entity_candidates, question_measures, requested_time_grain)
    return (not question_measures(residual) and not entity_candidates(residual)
            and requested_time_grain(residual) is None)


def _overview_eligible(req) -> bool:
    """Whether a ``/ask`` turn is a widest-scope overview ask. A fresh auto turn (may be
    in a canvas — that's the schema scope) whose phrasing asks for an overview and names
    no metric/entity/time window. Self-gating: the four request predicates below plus
    the question shape ARE the trigger, which is why it needed no flag of its own."""
    return bool(
        req.depth == "auto"
        and not req.escalate and not req.insight_id and not req.history and not req.skip_clarify
        and _is_overview_question(req.question)
        and not _measured_open(req)
    )


def _measured_open(req) -> bool:
    """An open question on a dataset with approved, dated metrics is the analyst's, measured from those metrics first
    (`agent/landscape.py`) — one path for an open question (2026-11-27: "interesting facts" took this profiling tour at
    one door and the analyst at another). The tour stays for a dataset with nothing governed to measure."""
    from pramanyx.agent.question_shape import is_open
    if not is_open(req.question):
        return False
    try:
        from pramanyx.briefing.ranges import governed_metrics
        return any(getattr(m, "time_column", None) for m in governed_metrics(req.connection_id, req.schema_name))
    except Exception as exc:  # noqa: BLE001 — unread, the tour answers as before
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "whether a dataset has governed metrics to measure is unread; the overview tour answers",
                 counter="ask.overview_measured")
        return False


async def _stream_overview(question: str, conn_id: str, req) -> AsyncGenerator[str, None]:
    """Stream the deterministic interesting-facts tour as ``/ask`` events. Resolves the
    canvas/connection scope exactly like ``_stream_chat`` (so tables + eff_schema are
    right), builds the fact tour off the event loop, and emits one ``overview_report``.
    No LLM, no metering — bounded and deterministic. Any failure degrades to an honest
    headline, never a dead-ended turn."""
    from pramanyx.canvas.scope import resolve_execution_scope
    from pramanyx.tools.schema import build_canvas_schema_context, parse_schema_tables
    yield _sse("route", {
        "depth": "overview", "mode": "overview", "tier": "overview",
        "score": 1.0, "confidence": 1.0, "ambiguous": False,
        "why": "a broad overview — profiling the whole dataset for its most notable facts",
        "alternatives": ["quick", "deep"], "forced": None, "downgraded_from": None,
    })
    try:
        _es = resolve_execution_scope(conn_id, req.canvas_id,
                                      schema_context_builder=build_canvas_schema_context)
        cid = _es.connection_id
        eff_schema = _es.eff_schema or ""
        db = _es.open()
    except Exception as e:
        yield _sse("headline", {"headline": f"Couldn't open the connection for an overview: {e}"})
        yield _sse("done", {})
        return

    # scoped table set: the canvas's tables, else every table across the connection's schema(s).
    # Keep names schema-QUALIFIED — on a multi-schema connection (a workspace with `main` +
    # `luxexperience`) stripping the qualifier and profiling bare names either collides same-named
    # tables across schemas or fails to resolve non-default-schema tables, fixating the tour on one
    # schema. build_overview._qual passes qualified names through untouched, so every schema is
    # profiled and each fact card carries its true `schema.table`.
    tables = list(_es.tables) if (_es.tables and not _es.is_full_schema) else []
    if not tables:
        try:
            sch = await asyncio.to_thread(_get_schema_cached, cid, db)
            tables = list(parse_schema_tables(sch).keys())
        except Exception:
            tables = []

    rep = None
    try:
        from pramanyx.overview import build_overview
        from pramanyx.overview.drills import load_priors
        # Learned per-connection prior: fold this connection's "explore this fact" drill
        # history into the ranking so the tour surfaces the lenses/tables this user explores.
        _priors = await asyncio.to_thread(load_priors, cid)
        # R14 — fold mined query popularity into the same table prior (the boost is
        # saturating + capped, so a hot table nudges, never buries a notable fact).
        try:
            from pramanyx.sql.popularity import merge_popularity_into_priors
            _priors = await asyncio.to_thread(merge_popularity_into_priors, _priors, cid)
        except Exception as _pop_exc:
            from pramanyx.kernel.errors import tolerate as _tolerate
            _tolerate(_pop_exc, "popularity prior fold is best-effort",
                      counter="obs.popularity", conn_id=cid or None)
        rep = await asyncio.to_thread(build_overview, db, cid, tables,
                                      schema=eff_schema, entity_hint="rows", limit=8, priors=_priors)
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "overview fact tour is best-effort; degrading to an honest headline",
                 counter="ask.overview_failed")

    if rep is not None and rep.facts:
        _report = rep.to_dict()
        yield _sse("overview_report", {"overview_report": _report})
        yield _sse("headline", {"headline": rep.summary})
        # Persist the tour so it survives reload + appears in canvas History (the turn is
        # otherwise ephemeral — the reason the cards vanished on refresh). Best-effort.
        try:
            await asyncio.to_thread(lambda: save_chat_turn(
                question=question, connection_id=cid, headline=rep.summary[:2000],
                sql="", session_id=getattr(req, "session_id", "") or "",
                columns=[], rows=[], chart_type="none", tables_used=[], intent="",
                approach=[], canvas_id=req.canvas_id, overview_report=_report))
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "overview turn save is best-effort; the tour was already streamed",
                     counter="ask.overview_save")
    elif rep is not None and rep.unread and not rep.tables_total:
        # Nothing to tour because nothing here has a profile yet — said, so an empty tour
        # does not read as an empty dataset.
        yield _sse("headline", {"headline": (
            f"None of the {len(rep.unread)} tables here has a profile yet, so there are no "
            "facts to tour — ask about a specific measure instead.")})
    else:
        yield _sse("headline", {"headline": (
            "I couldn't surface overview facts for this dataset — try asking about a "
            "specific measure, or open a table in the catalog.")})
    yield _sse("done", {})


class OverviewDrillRequest(BaseModel):
    """Capture signal for the learned overview prior: the user clicked "explore this fact"
    on an overview card. ``lens``/``table`` are the card's coordinates; the connection (a
    canvas pins its own) scopes the prior read back by the next tour."""
    connection_id: str = ""
    canvas_id: Optional[str] = None
    lens: str = ""
    table: str = ""


@router.post("/overview/drill", status_code=204)
async def record_overview_drill(req: OverviewDrillRequest) -> None:
    """Record an overview "explore this fact" drill so this connection's next tour learns
    which lenses/tables the user explores (``overview.drills`` → ``build_overview`` priors).
    Fire-and-forget from the client; best-effort and never raises. Resolves the connection
    the same way ``_stream_overview`` does, so capture and read-back share one key."""
    from pramanyx.canvas.scope import resolve_execution_scope
    from pramanyx.overview.drills import record_drill
    try:
        cid = resolve_execution_scope(req.connection_id, req.canvas_id).connection_id
    except Exception:
        cid = req.connection_id
    await asyncio.to_thread(record_drill, cid, req.lens, req.table)


async def _claim_question(req: "AskRequest", conn_id: str, name_run: Optional[Callable[[], str]] = None):
    """``(claim, under_way)`` for an agent's plain deep ask (`agent/one_run.take`): a claim for the run about to start —
    its row made with it by ``name_run``, so the claim names its run from the first moment — or the run of this question
    already under way, by its id (waited on here, on the loop, for the moment between another claim and its name). A
    claim that never names its run is handed to no one: ``(None, None)``, and this run starts unclaimed."""
    from pramanyx.agent import one_run
    deadline = asyncio.get_running_loop().time() + one_run.WAIT_FOR_ID_S
    while True:
        task = asyncio.ensure_future(asyncio.to_thread(one_run.take, req.question, conn_id,
                                                       canvas_id=req.canvas_id or "", schema=req.schema_name or "",
                                                       name_run=name_run))
        try:
            mine, held = await asyncio.shield(task)
        except asyncio.CancelledError:
            # The reader left while the claim was taken: nothing will run under it, so its row says so.
            task.add_done_callback(lambda t: None if t.cancelled() or t.exception() or not t.result()[0]
                                   else _let_go_unstarted(t.result()[0], "The ask was left before its run started.",
                                                          status="interrupted"))
            raise
        if held is None:
            return mine, None                       # this run's claim — or none could be written, and it runs unclaimed
        if held.get("inv_id"):
            return None, {"id": held["inv_id"], "started_at": held.get("began_at", "")}
        if asyncio.get_running_loop().time() >= deadline:
            return None, None                       # a claim that never named its run: handed to no one
        await asyncio.sleep(one_run.READ_EVERY_S)


def _let_go_unstarted(claim: Any, why: str, *, status: str = "failed") -> None:
    """A claimed run that never started — its ask left, its job cancelled in the queue, its job never submitted: the
    claim let go, and the row its door made as it claimed (`agent/one_run.take`) ended with why, if no run took it on.
    Never raises: it runs where the run's own end would have."""
    claim.end()
    if not getattr(claim, "inv_id", None):
        return
    try:
        from pramanyx.db.history import fail_investigation
        fail_investigation(claim.inv_id, status=status, reason=why, when_running=True)
    except Exception:
        logger.debug("the row of a run that never started could not be ended (%s)", claim.inv_id, exc_info=True)


def _named_at_the_door(req: "AskRequest", conn_id: str, *, agent_id: str = "") -> Callable[[], str]:
    """The row of an agent's claimed deep run, made as its door claims the question, as its body would have made it."""
    def name() -> str:
        from pramanyx.canvas.scope import resolve_execution_scope
        scoped = resolve_execution_scope(conn_id, req.canvas_id, schema_scope=req.schema_name).connection_id or conn_id
        return create_investigation(req.question, scoped, canvas_id=req.canvas_id, agent_id=agent_id,
                                    purpose=req.purpose or "", session_id=req.session_id or "")
    return name


def _already_running(under_way: dict) -> str:
    """The frame an agent's repeat is handed instead of a second run: the run under way, by its id, said."""
    from pramanyx.agent import one_run
    return _sse("already_running", {"investigation_id": under_way.get("id") or None,
                                    "already_running": one_run.said(under_way)})


async def _stream_ask(req: "AskRequest", request: Request, conn_id: str) -> AsyncGenerator[str, None]:
    """The unified door: decide depth, emit the `route` receipt, then delegate to a body.

    THREE bodies now, not two: quick, deep (deep-analysis/explore), and the conversational
    one, which serves every turn a tool-calling binding can take (the other two answer the
    turns it cannot). Converse swaps which body answers a quick turn, never which door it
    entered by, so the overview branch, the clarify gate and federation all still run
    first exactly as they did.

    The depth call is license-safe — a deep route degrades to quick when the connection
    lacks DEEP_ANALYSIS — and the legacy escalation and dossier-drill flags still reach
    the deep body through this one door.
    """
    from pramanyx.agent.ask_router import decide_ask_route
    from pramanyx.licensing import has_capability

    # ROADMAP §6 item 46 — a question about one part of a Briefing names it as the turn's focus. The part is read from
    # the edition the page drew before anything else runs, so one the edition does not hold is refused here, in a
    # sentence, before a ledger is written or a model is asked — never answered as a question about something else.
    _part = await _briefing_part_for(req, conn_id)
    if _part is not None and _part.refused:
        yield _sse("error", _error_event(message=_part.refused, reason="not_held"))
        return

    # I4 — if this turn is the user ANSWERING a clarify (a reading chosen from the chips),
    # crystallize that choice into the Ambiguity Ledger (source=user) BEFORE we answer, so the
    # resolution is an authoritative prior on this turn and every future one — the class never
    # re-ambiguates on this connection. Best-effort.
    _keep_clarify_answer(req, conn_id)

    # Ask-vs-guess (Phase 3): when the question is materially ambiguous and this is a
    # fresh auto turn (not an explicit depth override, deep-drill, dossier, or a turn
    # already answering a clarification), ask ONE targeted question instead of guessing.
    # Budget is one ask/turn — the user's answer comes back with skip_clarify set, which
    # is the per-turn bypass a caller actually uses.
    # Overview / "interesting facts about this schema" — the widest-scope ask. Checked
    # BEFORE the clarify gate on purpose: an under-specified "tell me about this data" is
    # exactly the case where an overview IS the answer, not a clarifying question.
    if _overview_eligible(req):
        async for _ev in _stream_overview(req.question, conn_id, req):
            yield _ev
        return

    # A request for a COCKPIT is not a question about data, and this chat drafts none — the
    # Briefing's Dashboards tab does (CT-9). Said here, before the clarify gate read it as an
    # under-specified question (2 of the CT receipt's 10 asks) or a model answered it as one.
    # On a dashboard the person keeps, the conversation can change it (the Ask panel), so the request goes through; and
    # since Stage 4 (2026-11-20) the conversation drafts a new one (`make_dashboard`), so a quick turn it serves for a
    # person it knows goes through too. Anywhere else — a deep run, nobody known, a model that calls no tools — it is said.
    if not req.insight_id and _own_dashboard(req, request) is None and not _conversation_drafts_dashboards(req, request):
        from pramanyx.dashboards.intent import is_dashboard_ask, where_dashboards_are_made
        if is_dashboard_ask(req.question):
            yield _sse("headline", {"headline": where_dashboards_are_made()})
            yield _sse("done", {})
            return

    if (req.depth == "auto" and not req.escalate and not req.insight_id
            and not req.skip_clarify):
        from pramanyx.agent.clarify import assess_clarification
        decision = assess_clarification(req.question, conn_id)
        if decision.should_ask:
            yield _sse("clarify", decision.to_event())
            yield _sse("done", {})
            return

    has_deep = has_capability(Capability.DEEP_ANALYSIS, conn_id=conn_id)
    # decide_ask_route may consult the LLM intent classifier on borderline questions,
    # so run it off the event loop.
    route = await asyncio.to_thread(
        decide_ask_route, req.question,
        depth_override=req.depth, deep_flag=req.escalate,
        insight_id=req.insight_id, has_deep=has_deep,
        mode_override=req.mode,   # R13 — a named starter's declared path
    )
    # Decided BEFORE the receipt is emitted, so the receipt can say which body served the
    # turn — that key is Wave 6's population-level converse/fast-path ratio. It is a KEY on
    # an existing frame, not a new frame: the dispatcher reads named keys, so an extra one
    # is inert, and minting a second routing frame for the same decision would be exactly
    # the parallel vocabulary this wave is trying not to create.
    _use_converse = _converse_eligible(req, route)
    _use_analyst = _analyst_eligible(req, route)   # CA-3 — deep/escalate take the analyst door
    # Agent on a dashboard the person keeps: the conversation decides between a deep analysis and a change, and the
    # receipt says the conversation served the turn (its depth is the conversation's, so the answer renders as one).
    _decides = _use_analyst and _conversation_decides(req, request)
    if _decides:
        from dataclasses import replace as _replace
        route = _replace(route, depth="quick", why=AGENT_CHOSEN_WHY)
        _use_converse, _use_analyst = True, False
    # CI-1 — resolve the effective conversation history ONCE, here, before any body runs:
    # the client's turns when it sent them, else a server-side reconstruction from the
    # session store so a reload / another device / the MCP server / a scheduled task all
    # get the memory the session already holds. Every downstream body reads req.history,
    # so replacing it at this seam covers quick, converse, and deep at once.
    _client_history = bool(req.history)
    req.history = resolve_history(req.history, req.session_id)
    _route_ev = route.to_event()
    if req.purpose:
        _route_ev["purpose"] = req.purpose   # R13/R10 — starter provenance on the receipt
    if _use_converse:
        _route_ev["body"] = "converse"
    if _use_analyst:
        _route_ev["body"] = "analyst"
    if _decides:
        _route_ev["decided_by"] = "conversation"
    # The route receipt measures the memory it injected — turns and chars — the same
    # discipline PE-1 applied to prompt spend: a feature you cannot see the size of is
    # one you cannot tell is working. `reconstructed` distinguishes server-rebuilt memory
    # from client-supplied, which is exactly the gap CI-1 closed.
    _hist = req.history or []
    _route_ev["history_turns"] = len(_hist)
    _route_ev["history_chars"] = len(build_history_section(_hist)) if _hist else 0
    _route_ev["history_reconstructed"] = bool(_hist) and not bool(_client_history)
    # TJ-2 — the run's trace id, on the receipt the client already reads: it is the key
    # `GET /traces/{id}/trajectory` walks, and the eval harness records it per case so a
    # rollout is a trajectory too. "" when no trace is bound (the wrapper binds one).
    try:
        from pramanyx.telemetry import current_trace_id as _ambient
        _route_ev["trace_id"] = _ambient() or ""
    except Exception:  # noqa: BLE001 — a receipt field, never a dependency
        _route_ev["trace_id"] = ""
    # Arc FA-2 — what the reader chose, read once for them under their row policy: the conversation and the
    # analyst are handed it, and the receipt says it — and whether the body answering read it. None when the focus is
    # no subject: the receipt and both bodies are as before. A part of a Briefing (§6 item 46) is the turn's subject the
    # same way: said on the receipt, handed to the conversation and the analyst.
    _subject = _part if _part is not None else await _ask_subject_for(req, conn_id, request)
    if _subject is not None:
        _route_ev["subject"] = _subject.receipt(carried=_use_converse or _use_analyst)
    # The path, on every receipt this turn writes (the blueprint, 2026-11-27): the question's kind, the depth, the engine
    # that answers and why — what touched the answer, readable after it.
    from pramanyx.trust.answer_inputs import set_path as _set_path
    _depth = getattr(route, "depth", "")
    _set_path({"kind": getattr(route, "shape", ""), "depth": _depth,
               "engine": _route_ev.get("body") or ("deep graph" if _depth == "deep" else "quick core"),
               "why": getattr(route, "why", ""), "door": getattr(req, "surface", "") or ""})
    yield _sse("route", _route_ev)

    # An agent's call (the coworker) asking again for a deep analysis it already has under way is handed that run, not a
    # second one beside it (`agent/one_run.py`; 2026-11-24: the coworker read a run that outlived its call a few times,
    # took it for stuck and asked again). Only a plain ask: a fresh run, an "ask again", a follow-up and a drill from a
    # finding start their own, as a person's ask in the app always does.
    from pramanyx.rbac.agent_gate import is_agent_request
    _agent_call = request is not None and is_agent_request(request)
    _plain_ask = (not req.skip_cache and (req.purpose or "") != "ask_again" and not req.insight_id
                  and not req.seed_sql and not (req.seed_context or "").strip() and not req.history)
    _one_run = _agent_call and _plain_ask and getattr(route, "mode", "") != "explore"

    if _use_analyst:
        # CA-3 — the analyst loop serves the deep turn: intake anchors the spec (the
        # origin resolution below is the same one the phase script seeds, so a drill
        # or a follow-up carries its base), the model chooses the slices, the
        # narrator writes the report from the evidence. Metered like converse — a
        # deep turn spends MORE requests, and the meter is the honesty about it.
        _origin = await _build_origin_finding(conn_id, req.insight_id,
                                              req.seed_context or "", req.seed_sql)
        if _origin is None and req.history:
            from pramanyx.agent.followup import is_followup
            _origin = _followup_origin(req.history, followup=is_followup(req.question))
        _claim, _under_way = (await _claim_question(req, conn_id, _named_at_the_door(req, conn_id))
                              if _one_run else (None, None))
        if _under_way is not None:
            yield _already_running(_under_way)
            return
        _run_id = (_claim.inv_id or "") if _claim is not None else ""
        from pramanyx.agent import one_run as _one_run_mod
        _analyst_body = _stream_analyst(
            req.question, conn_id, req.history,
            session_id=req.session_id, canvas_id=req.canvas_id,
            schema_scope=req.schema_name, origin_finding=_origin,
            purpose=req.purpose,
            shape=route.shape,   # decided once at the door; the analyst serves this shape
            subject_prose=_subject.prose() if _subject is not None else "",
            # an agent's plain ask: its spec is claimed once the intake resolves it, and a rewording is handed the run
            ask=_one_run_mod.Ask(connection_id=conn_id, canvas_id=req.canvas_id or "", schema=req.schema_name or "",
                                 claim=_claim) if _claim is not None else None,
            run_id=_run_id,      # the row its door made as it claimed: the run's own from the first moment
        )
        # FL-1b — the analyst runs through the same K1 bridge as the graph path:
        # a supervised job (so a closed tab no longer kills it mid-run and
        # orphans the row 'running'), cancellable via /investigations/{id}/cancel,
        # and mirrored for reattach. The meter rides INSIDE the job, so the
        # budget holds with nobody watching — and the budget is the job's: an
        # `investigation` job is the Analyst's, whose governance `JobKernel._run`
        # arms and its heartbeat enforces, as on the graph path. Arming the
        # Responder's here, a quick answer's, stopped deep runs at its time
        # budget (1200s on the live install, 2026-11-24 e4796f93) while the
        # Agents page said the Analyst had 1800s.
        async for sse in _job_streamed_body(
            lambda: _metered_stream(_analyst_body),
            session_id=req.session_id, conn_id=conn_id, canvas_id=req.canvas_id,
            payload={"question": req.question[:200], "body": "analyst",
                     **({"purpose": req.purpose} if req.purpose else {}),
                     **({"investigation_id": _run_id} if _run_id else {})},   # the job names its run while queued
            claim=_claim,
        ):
            yield sse
    elif route.depth == "deep" and not _use_converse:
        _claim, _under_way = (await _claim_question(req, conn_id, _named_at_the_door(
            req, conn_id, agent_id=_current_agent_id())) if _one_run else (None, None))
        if _under_way is not None:
            yield _already_running(_under_way)
            return
        async for sse in _investigation_job_streamed(
            req.question, conn_id, request,
            hitl=req.hitl, skip_cache=req.skip_cache, canvas_id=req.canvas_id,
            schema_scope=req.schema_name, seed_sql=req.seed_sql,
            seed_context=req.seed_context, insight_id=req.insight_id, deep=req.escalate,
            history=req.history,  # follow-up composition on the deep path (parity with quick)
            # R9 — carry the route verdict's mode: "investigate", or "explore" when a person or a starter asked for the
            # landscape wave. (depth=="deep" ⇒ mode ∈ {investigate, explore}.)
            requested_mode=route.mode,
            allow_clarify=req.allow_clarify,
            purpose=req.purpose,  # R10 — starter provenance on the job row + run record
            session_id=req.session_id,  # CA-0 — the deep run is filed under the conversation
            claim=_claim,
            run_id=(_claim.inv_id or "") if _claim is not None else "",
        ):
            yield sse
    else:
        # The two quick bodies are PEERS under one meter, not two parallel branches with
        # two budget lookups: whichever answers, a turn costs what the same governed
        # budget allows. Converse needs it more, not less — it makes SEVERAL provider
        # calls where the fast path makes a handful.
        _body = (
            _stream_converse(req.question, conn_id, req.history, agent_id=req.agent_id or "",
                             session_id=req.session_id, canvas_id=req.canvas_id,
                             surface=req.surface, schema_scope=req.schema_name,
                             brief_period=req.brief_period,
                             shape=route.shape,   # a check answers as a verdict and its counts
                             # Arc SH — a question asked beside a sheet gets the tool that puts
                             # the rows it asks about on that sheet's grid.
                             sheet=_sheet_ref(req),
                             # Keep going — the steps the turn before took, to continue from
                             keep_going=req.keep_going,
                             # the Ask panel — a question about a dashboard the person keeps can also change it
                             dashboard=_own_dashboard(req, request),
                             # Stage 2 — who asks, so the reads of what depends on a table name only their dashboards
                             person=_asker(request),
                             # Ask again — answered afresh, not from what the conversation already holds
                             asked_again=(req.purpose or "") == "ask_again",
                             # an agent's plain ask: its deep tool hands back a run of the same question under way
                             agent_call=_agent_call and _plain_ask,
                             # CI-4 — a seeded/dossier turn hands its finding to the
                             # conversation instead of bypassing it; SP-15 — a turn
                             # summoned from an object hands that object's live state.
                             origin_prose=_joined(_focus_prose_for(req, conn_id, _subject),
                                                  await _origin_prose_for(req, conn_id),
                                                  AGENT_CHOSEN_PROSE if _decides else ""))
            if _use_converse else
            _stream_chat(req.question, conn_id, req.history,
                         session_id=req.session_id, canvas_id=req.canvas_id,
                         skip_clarify=req.skip_clarify, purpose=req.purpose,
                         schema_scope=req.schema_name, surface=req.surface,
                         brief_period=req.brief_period,
                         # "Answer anyway" = skipped WITHOUT supplying a reading. When a
                         # reading did come back the choice is recorded and crystallized,
                         # so there is nothing to disclose.
                         assumed_default=bool(req.skip_clarify and not req.clarify_reading))
        )
        async for sse in _metered_stream(_body, budget=_insight_budget(conn_id)):
            yield sse


async def stream_with_envelope(
    stream: AsyncGenerator[str, None], *, question: str, conn_id: str, session_id: str = "",
) -> AsyncGenerator[str, None]:
    """CP-4 — fold the ask stream into ONE ``envelope`` frame, emitted last, and file it.

    The core emits structure and a door renders it: the headline, the body (with every
    prose table lifted into the grid field, so a duplicate table is impossible rather
    than suppressed), the grid, the chart decision, the caveats, the follow-ups and the
    provenance — guard receipts included, as a FIELD a door may drop. Folded from the
    frames the run already emitted, deterministically, with no model call; the fold is
    `pramanyx.answer.envelope.EnvelopeFolder`, the single implementation.

    Emitted AFTER the last frame of the body, because that is the only moment every field
    exists — on the quick path the narrative and the follow-ups stream in after ``done``.
    Persisted onto the turn's row (`attach_envelope`) so a door that was not on the stream
    — a scheduled send, the export, a later reader — selects from the same structure.
    A stream that ends with nothing to say (no headline, body or error) emits nothing.
    """
    from pramanyx.answer.envelope import EnvelopeFolder

    import time as _time

    folder = EnvelopeFolder(question=question, connection_id=conn_id, session_id=session_id)
    turn = _TurnEnvelope(folder=folder, question=question, began=_time.monotonic())
    token = _TURN_ENVELOPE.set(turn)
    try:
        async for event in stream:
            if not turn.carried:          # once a job carries the run, it folds the frames — each once, read or not
                _fold(folder, event)
            yield event
    finally:
        _TURN_ENVELOPE.reset(token)
    if turn.carried and turn.filed is not None:
        yield _sse("envelope", {"envelope": turn.filed})      # what its job filed on the row, as filed
        return
    env = folder.finish()
    if not env.has_answer:
        return
    payload = env.model_dump()
    yield _sse("envelope", {"envelope": payload})
    if not turn.carried:                  # a carried run's envelope is filed by its job, when the run ends
        await _file_envelope(turn, payload, env.provenance.investigation_id)


@dataclass
class _TurnEnvelope:
    """One ``/ask`` turn's answer envelope (CP-4): folded once, frame by frame, and filed once on the run's row.

    The door (`stream_with_envelope`) folds and files it for a turn it reads to the end. A deep run is a job that goes
    on without a reader (the K1 bridge, `_job_streamed_body`, sets ``carried``), so from then the job folds each frame
    the run streams and files the envelope when the run ends — whether or not anyone is still reading. Until 2026-11-24
    the door did both, so a run whose reader left (a closed panel, a coworker past its deadline) finished with no
    envelope on its row, and the coworker had to keep reading every deep stream to its end for the envelope's sake.
    """
    folder: Any
    question: str
    began: float
    carried: bool = False
    #: The envelope the job filed on the run's row — handed, as filed, to a reader still on the stream (a second fold
    #: would differ from it, by its time at least).
    filed: Optional[dict] = None


_TURN_ENVELOPE: contextvars.ContextVar[Optional[_TurnEnvelope]] = contextvars.ContextVar(
    "pramanyx_turn_envelope", default=None)


def _fold(folder: Any, event: str) -> None:
    """Feed one SSE frame to the envelope folder; a keep-alive or a line that does not parse is not a frame."""
    if not event.startswith("data: "):
        return
    try:
        frame = json.loads(event[6:])
    except Exception:
        return
    if isinstance(frame, dict) and frame.get("type"):
        folder.feed(str(frame["type"]), frame)


async def _file_envelope(turn: _TurnEnvelope, payload: dict, inv_id: str) -> None:
    """File the folded envelope on the run's row (`attach_envelope`) and let the answer teach the few-shot memory."""
    if not inv_id:
        return
    import time as _time
    try:
        from pramanyx.db.history import attach_envelope
        took_ms = int((_time.monotonic() - turn.began) * 1000)
        if await asyncio.to_thread(attach_envelope, inv_id, payload, said=turn.folder.said, asked=turn.question,
                                   took_ms=took_ms, steps=turn.folder.steps):
            _remember_answer(inv_id)
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "envelope persistence is best-effort; it was already streamed",
                 counter="ask.envelope_persist")


def _remember_answer(inv_id: str) -> None:
    """PENDING item 24 — a filed quick answer teaches the few-shot memory (`prior_analyses.index_answer` decides
    whether it is clean enough to). Off the stream: the embedding call can be slow or hang, and the reader already
    has the answer, so nothing waits on it. The thread carries the request's context — the organisation the
    tombstone check reads."""
    import contextvars
    import threading

    from pramanyx.tools.prior_analyses import index_answer
    ctx = contextvars.copy_context()
    threading.Thread(target=ctx.run, args=(index_answer, inv_id), daemon=True, name="remember-answer").start()


def build_ask_stream(req: "AskRequest", request: "Request | None") -> AsyncGenerator[str, None]:
    """The composed `/ask` event generator — the ONE source of the ask stream, shared by
    `ask_endpoint` and the agent door (`routers/doors.py`) so both stay byte-identical.

    Resolves the connection + optional user-agent and applies the agent's conn/schema bindings
    (which mutates ``req.schema_name`` and may raise ``HTTPException`` 409) BEFORE building the
    generator — exactly as the endpoint always did — so those surface as HTTP errors, not as
    mid-stream SSE. ``request`` is threaded only for ``_stream_ask``'s signature parity; nothing
    on the path dereferences it (a caller with no HTTP request may pass ``None``)."""
    _thread_door(getattr(req, "session_id", "") or "")
    conn_id = _resolve_conn(req)
    agent = _resolve_ask_agent(req)
    if agent is not None:
        conn_id = _apply_agent_bindings(req, agent, conn_id)
    _refuse_unless_answerable(request, conn_id)
    stream = _stream_ask(req, request, conn_id)
    if req.skip_clarify and not req.clarify_reading and req.clarify_asked:
        from pramanyx.trust.answer_tried import clarification_left
        stream = _stream_leaving(clarification_left(req.clarify_asked, options=req.clarify_options,
                                                    source=req.clarify_source, subject=req.clarify_subject or req.question),
                                 stream)
    # CP-4 — innermost of all: fold every frame the body emits into the one answer
    # envelope and END the stream with it, so the session log and every door above see
    # the finished structure as a frame like any other.
    stream = stream_with_envelope(stream, question=req.question, conn_id=conn_id,
                                  session_id=req.session_id or "")
    # Binds the run's trace id (so the quick path is correlated at all)
    # and records request/response, seeing the identity the outer wrappers pin.
    stream = stream_with_session_log(
        stream, question=req.question, conn_id=conn_id, door="ask", depth=req.depth,
        canvas_id=req.canvas_id or "", schema=req.schema_name or "",
        purpose=req.purpose or "", agent_id=req.agent_id or "",
        # what the focus says, and only that: SP-15's `{kind, id}` as it always was; FA-2's subject without its empty fields
        focus=req.focus.model_dump(exclude_defaults=True) if getattr(req, "focus", None) else None)
    # ambient session + asker → trace attribution (RC-4: the asker is why LF-2's
    # user field was empty on every headless door — nobody was setting it)
    stream = _stream_with_session(req.session_id, stream, req.principal_ref or "")
    if agent is not None:
        stream = _stream_as_agent(agent, stream)
    return stream


def ask_agent_refusal(req: "AskRequest") -> str:
    """Why this ask cannot run as its ``agent_id``, or "" when it can (or none is set).

    The public form of the persona resolution :func:`build_ask_stream` performs inline, for
    callers that must decide BEFORE a run starts. ``build_ask_stream`` raises its refusals as
    ``HTTPException`` — correct for an HTTP caller, lost for a scheduled one, whose tick has
    already reported the effect as dispatched by the time a submitted job unwraps. Wave H1's
    automation effect asks here first and puts the sentence in its run history instead.

    Same authority, same sentences: this delegates to the very functions the stream uses, so a
    rule can never hold on one path and not the other. Note it mutates ``req.schema_name`` the
    way the stream does — callers pass the request they are about to run, or a probe copy.
    """
    try:
        agent = _resolve_ask_agent(req)
        if agent is not None:
            _apply_agent_bindings(req, agent, _resolve_conn(req))
    except HTTPException as exc:
        return str(exc.detail)
    return ""


@router.post("/ask")
async def ask_endpoint(req: AskRequest, request: Request):
    """One conversational entry — the router picks quick vs deep (auto+transparency).

    Not gated on DEEP_ANALYSIS as a dependency: a quick answer only needs chat access,
    and a deep route is capability-checked inside `_stream_ask` (degrade, never bypass).
    `/chat` and `/investigate` remain as-is for back-compat through the transition.
    """
    if os.getenv("PRAMANYX_UNIFIED_ASK", "1").lower() in ("0", "false", "no", "off"):
        raise HTTPException(status_code=404, detail="unified /ask is disabled")
    return StreamingResponse(
        build_ask_stream(req, request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/ask/stream/{session_id}")
async def ask_resume_stream(session_id: str):
    """FL-1b — reattach to the conversation's in-flight deep run.

    The K1 bridge mirrors a job-streamed run's SSE into the frame hub; this
    endpoint replays the snapshot and tails the live remainder, byte-identical
    frames, so the client-side adapter needs no second dialect. ``204`` when
    there is nothing to resume — no run for this conversation, or the run
    already CLOSED (a finished turn reaches a reloading client through the
    session's persisted history; replaying it here would render it twice)."""
    from pramanyx.util.frame_hub import ConsumerLagged, hub
    try:
        consumer = hub().attach(f"ask:{session_id}")
    except KeyError:
        return Response(status_code=204)
    if consumer.closed:
        hub().detach(f"ask:{session_id}", consumer)
        return Response(status_code=204)

    async def _replay() -> AsyncGenerator[str, None]:
        for frame in consumer.snapshot:
            yield frame
        try:
            async for frame in consumer.tail():
                yield frame
        except ConsumerLagged:
            # This consumer fell behind the producer and its view is no longer
            # contiguous. End the stream; the client's next resume GET gets a
            # fresh, complete snapshot.
            return
        finally:
            hub().detach(f"ask:{session_id}", consumer)

    return StreamingResponse(
        _replay(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/ask/prior")
def ask_prior_endpoint(
    connection_id: str = Query(..., description="connection id"),
    question: str = Query(..., max_length=2000, description="the question as typed"),
    principal=Depends(get_principal),
):
    """What is already on record for this exact question here — how many times it was answered,
    when first and last, and the newest answer's headline — so a person sees it BEFORE a run is
    paid for (Home, "Ask, with memory"). A read: nothing runs and no model is called."""
    from pramanyx.db.history import asked_before
    from pramanyx.security.authz import check_owner
    check_owner("connection", connection_id, principal)
    return asked_before(question, connection_id)


@router.get("/ask/context")
def ask_context_endpoint(
    connection: str = Query(..., description="connection id"),
    question: str = Query(..., description="the question to ground"),
    canvas: str = Query("", description="canvas id — scopes the custom-instructions block"),
    principal=Depends(get_principal),
):
    """The grounding-context receipt (flag ``ask.context_receipt``) — the exact
    grounding blocks the SQL writer would be given for this question on this
    connection: schema slice, glossary, governed-metric bindings, ambiguity-ledger
    priors, dialect rules, trusted templates, and the active agent/pack brief.

    The input-side twin of the Trust Receipt. Read-only, deterministic (re-derives
    the same blocks the answer path assembles from the same producers).
    """
    from pramanyx.agent.grounding import build_grounding_context
    from pramanyx.db.connection import open_connection_for
    try:
        db = open_connection_for(connection)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Connection {connection!r} not found")
    try:
        schema = _get_schema_cached(connection, db) or ""
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "grounding receipt: schema fetch best-effort; schema-dependent blocks skipped",
                 counter="ask.context_receipt.schema")
        schema = ""
    ctx = build_grounding_context(question, connection, db=db, schema=schema,
                                  eff_schema=getattr(db, "_schema_name", None),
                                  canvas_id=canvas)
    return {"receipt": ctx.to_dict(), "markdown": ctx.to_markdown()}


def _resolve_ask_agent(req: "AskRequest"):
    """The user-defined agent this ask runs as, or None (no agent_id named)."""
    if not req.agent_id:
        return None
    from pramanyx.custom_agents import get_agent
    agent = get_agent(req.agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"No such agent '{req.agent_id}'")
    if not agent.enabled:
        raise HTTPException(status_code=409, detail=f"agent '{agent.name}' is disabled")
    return agent


def _apply_agent_bindings(req: "AskRequest", agent, conn_id: str) -> str:
    """Enforce the agent's connection + schema bindings on this ask.

    Fail-closed: an EXPLICIT conflicting value is a 409, never a silent
    override; an unset/default value is bound to the agent's. Returns the
    effective connection id."""
    if agent.connection_id:
        if req.connection_id not in (BUILTIN_ID, agent.connection_id):
            raise HTTPException(
                status_code=409,
                detail=f"agent '{agent.name}' is bound to connection "
                       f"'{agent.connection_id}' (asked: '{req.connection_id}')")
        conn_id = agent.connection_id
    if agent.schema_scope:
        if req.schema_name and req.schema_name != agent.schema_scope:
            raise HTTPException(
                status_code=409,
                detail=f"agent '{agent.name}' is scoped to schema "
                       f"'{agent.schema_scope}' (asked: '{req.schema_name}')")
        req.schema_name = agent.schema_scope
    return conn_id


def _current_agent_id() -> str:
    """The active user-agent's id for state seeding ("" when none)."""
    from pramanyx.custom_agents.context import current_agent
    agent = current_agent()
    return agent.id if agent is not None else ""


def persona_for_investigation(inv_id: str):
    """The user-agent persona a checkpointed deep run was launched AS, or None.

    Resume (plan/clarify-gate feedback) never passes through /ask, so the
    persona is re-read from the run's persisted state (`agent_id`). Fail-open:
    a missing checkpoint or an unknown/disabled agent resumes the run WITHOUT
    the persona rather than blocking it."""
    try:
        from pramanyx.agent.graph import read_checkpoint_values
        agent_id = read_checkpoint_values(inv_id).get("agent_id") or ""
        if not agent_id:
            return None
        from pramanyx.custom_agents import get_agent
        persona = get_agent(agent_id)
        return persona if (persona is not None and persona.enabled) else None
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "persona re-activation on resume is best-effort; resuming without it",
                 counter="agents.resume_persona")
        return None


async def _stream_as_agent(agent, stream: AsyncGenerator[str, None]) -> AsyncGenerator[str, None]:
    """Run the ask stream with the user-agent contextvar active, so the prompt
    brief and the document-retrieval scope see the agent everywhere (threads
    included — ContextThreadPoolExecutor propagates contextvars)."""
    from pramanyx.custom_agents.context import activate_agent, release_agent
    token = activate_agent(agent)
    try:
        yield _sse("agent", {"agent_id": agent.id, "name": agent.name,
                             "connection_id": agent.connection_id,
                             "doc_count": len(agent.doc_ids)})
        async for event in stream:
            yield event
    finally:
        release_agent(token)


#: SSE types the session log needs to notice. Checked as cheap substrings before
#: paying for a JSON parse — the stream is mostly high-frequency delta frames and
#: an observability sink must not tax every one of them.
_SESSION_LOG_SNIFF = ('"start"', '"error"', '"headline"', '"receipt_id"', '"already_running"')


@dataclass
class _TurnEnd:
    """Who writes a door turn's end — its FINAL_RESPONSE — in the session log, which is written once.

    The door writes it (`stream_with_session_log`) when its reader reads the stream to the end. A deep run is a job that
    goes on without a reader (the K1 bridge, `_job_streamed_body`, sets ``carried``), so when the reader leaves first —
    a closed panel, a restarted coworker, a client past its deadline — the end is handed to the job, which writes it
    when the run ends, with the run's own outcome. Until 2026-11-24 the door wrote the reader's cancel as the run's end:
    0237d0fc finished with its report while its trace said it failed ("Cancelled via cancel scope …").
    """
    run_id: str
    door: str
    conn_id: str
    claimed: bool
    t0: float
    carried: bool = False
    #: When the reader left a carried run (ms after the turn began): the end is then the job's to write.
    reader_left_ms: Optional[float] = None
    #: The run's outcome, set by the job when it ends — read by a reader that leaves after that, before reading it.
    outcome: Optional[dict] = None


_TURN_END: contextvars.ContextVar[Optional[_TurnEnd]] = contextvars.ContextVar("pramanyx_turn_end", default=None)


def _write_turn_end(turn: _TurnEnd, outcome: dict) -> None:
    """Write a carried run's end, which its reader did not stay to read: its error as the door would have recorded it,
    then — for a turn the door records (not one the coworker claimed) — its final response, saying when the reader left."""
    from pramanyx.obs import session_log
    if outcome.get("error"):
        session_log.emit(session_log.EXECUTION_ERROR, name=turn.door, trace_id=turn.run_id,
                         investigation_id=outcome.get("inv_id"), conn_id=turn.conn_id, ok=False,
                         payload={"message": str(outcome["error"])[:2000]})
    if turn.claimed:
        return
    import time as _t
    session_log.emit(
        session_log.FINAL_RESPONSE, name=turn.door, trace_id=turn.run_id,
        investigation_id=outcome.get("inv_id"), conn_id=turn.conn_id, ok=bool(outcome.get("ok")),
        duration_ms=round((_t.monotonic() - turn.t0) * 1000, 1),
        payload={**({"headline": outcome["headline"]} if outcome.get("headline") else {}),
                 **({"receipt_id": outcome["receipt_id"]} if outcome.get("receipt_id") else {}),
                 **({"error": str(outcome["error"])[:2000]} if outcome.get("error") else {}),
                 **({"reader_left_ms": turn.reader_left_ms} if turn.reader_left_ms is not None else {})})


async def stream_with_session_log(
    stream: AsyncGenerator[str, None], *, question: str, conn_id: str,
    door: str = "ask", depth: str = "", canvas_id: str = "", schema: str = "",
    purpose: str = "", agent_id: str = "", focus: Optional[dict] = None,
) -> AsyncGenerator[str, None]:
    """Record the run in the session log (flag ``obs.session_log``).

    Takes primitives rather than a request model so every door can use it —
    ``/ask`` (via ``build_ask_stream``) and the
    legacy ``/chat``, which has its own endpoint and would otherwise stay dark.

    Applied INNERMOST so the outer session/agent wrappers have already pinned
    their contextvars by the time this emits — identity attribution then costs
    nothing to thread.

    This is where the quick path stops being invisible. ``new_trace`` is called
    in exactly one place, inside the deep path, so a quick turn minted no trace
    id at all; binding one here means every span the run opens inherits it,
    quick and deep alike, with no change to the emitters themselves.

    On the deep path the investigation keeps its own id for its spans (it is
    created further down, after routing). Rather than fight that, we sniff it off
    the ``start`` frame and record it as ``investigation_id``, so the two
    correlate without either side having to know about the other.

    A no-op wrapper when the flag is off: no id is minted, nothing is parsed.
    """
    from pramanyx.obs import session_log
    if not session_log.enabled():
        async for event in stream:
            yield event
        return

    import json as _json
    import time as _t
    import uuid as _uuid
    from pramanyx import telemetry as _tel

    # A question the coworker asked is a step of the coworker's turn, and its work is recorded INSIDE that turn's
    # trace and that step — not as a second run beside it (`routers/coworker.py`). The turn's own request and end are
    # the coworker's to record, so neither is written again here; a failure still is.
    from contextlib import ExitStack
    from pramanyx.org.context import reset_session_id, set_session_id
    from pramanyx.routers.coworker import claimed_for
    claim = claimed_for(question, conn_id)
    run_id = claim["trace_id"] if claim else _uuid.uuid4().hex[:8]
    inv_id: str | None = None
    failed: str | None = None
    headline: str = ""
    receipt_id: str | None = None
    t0 = _t.monotonic()
    turn = _TurnEnd(run_id=run_id, door=door, conn_id=conn_id, claimed=bool(claim), t0=t0)
    handed_over = False
    # Arc TC, TC-2 — the turn is a run too, named by the same id as its trace: an edit or an action it makes says so
    with ExitStack() as _bound:
        _bound.enter_context(_tel.bind_trace(run_id))
        _bound.enter_context(_tel.bind_run(run_id, "chat"))
        _bound.callback(_TURN_END.reset, _TURN_END.set(turn))   # unwound as the trace's binding is
        if claim:
            _bound.enter_context(_tel.bind_parent_span(claim["span_id"]))
            _bound.callback(reset_session_id, set_session_id(f"coworker:{claim['session']}"))
        if not claim:
            session_log.emit(
                session_log.USER_REQUEST, name=door, trace_id=run_id, conn_id=conn_id,
                payload={"question": question, "depth": depth, "canvas_id": canvas_id,
                         "schema": schema, "purpose": purpose, "agent_id": agent_id,
                         # SP-15 — the object the palette was summoned from ({kind, id}), so
                         # the Ask door's uptake is a reading of the log, not a guess.
                         **({"focus": focus} if focus else {})},
            )
        try:
            async for event in stream:
                if any(h in event for h in _SESSION_LOG_SNIFF):
                    try:
                        frame = _json.loads(event[6:]) if event.startswith("data: ") else {}
                    except Exception:
                        frame = {}
                    kind = frame.get("type")
                    if kind == "start" and frame.get("investigation_id"):
                        inv_id = frame["investigation_id"]
                    elif kind == "headline":
                        # The answer, not just that there was one. A run whose
                        # output was never captured cannot become a test case,
                        # which is what the rest of this arc is for.
                        headline = str(frame.get("headline") or "")[:2000]
                    elif kind == "receipt_id":
                        receipt_id = frame.get("receipt_id")
                    elif kind == "already_running":
                        # handed a run already under way (`agent/one_run.py`): what it was told is its answer
                        headline = headline or str(frame.get("already_running") or "")[:2000]
                    elif kind == "error":
                        failed = str(frame.get("message") or "")[:2000]
                        session_log.emit(
                            session_log.EXECUTION_ERROR, name=door, trace_id=run_id,
                            investigation_id=inv_id, conn_id=conn_id, ok=False,
                            payload={"message": failed},
                        )
                yield event
        except BaseException as exc:
            if turn.carried and isinstance(exc, (asyncio.CancelledError, GeneratorExit)):
                # The reader left a run its job carries on: that is not the run failing. Its end is the job's to write
                # when the run ends (`_job_streamed_body`) — or, when it already has, it is written here from the job's
                # outcome, which this reader left before reading.
                if turn.outcome is None:
                    turn.reader_left_ms = round((_t.monotonic() - t0) * 1000, 1)
                    handed_over = True
                else:
                    handed_over = True
                    _write_turn_end(turn, turn.outcome)
                raise
            # A cancelled or crashed stream must leave the same evidence as a
            # clean failure — otherwise the log's most interesting runs are
            # exactly the ones missing from it. `failed` must be set too, or the
            # finally below closes the run as ok=True and the log calls the
            # crash a success.
            failed = str(exc)[:2000]
            session_log.emit(
                session_log.EXECUTION_ERROR, name=door, trace_id=run_id,
                investigation_id=inv_id, conn_id=conn_id, ok=False,
                error_class=type(exc).__name__,
                payload={"message": str(exc)[:2000]},
            )
            raise
        finally:
            if not claim and not handed_over:
                session_log.emit(
                    session_log.FINAL_RESPONSE, name=door, trace_id=run_id,
                    investigation_id=inv_id, conn_id=conn_id, ok=failed is None,
                    duration_ms=round((_t.monotonic() - t0) * 1000, 1),
                    payload={**({"headline": headline} if headline else {}),
                             **({"receipt_id": receipt_id} if receipt_id else {}),
                             **({"error": failed} if failed else {})},
                )


async def _stream_leaving(left: Optional[dict], stream: AsyncGenerator[str, None]) -> AsyncGenerator[str, None]:
    """Run the ask stream with the clarification the person went ahead without in scope, so the receipt every door of
    the turn writes keeps it (`trust.answer_tried`)."""
    from pramanyx.trust.answer_tried import leave, unleave
    token = leave(left)
    try:
        async for event in stream:
            yield event
    finally:
        unleave(token)


async def _stream_with_session(session_id: str, stream: AsyncGenerator[str, None],
                               principal_ref: str = "") -> AsyncGenerator[str, None]:
    """Run the ask stream with the conversation session contextvar active, so the
    telemetry seam can attribute the investigation trace to its session ambiently
    (MLflow Sessions view) — propagates into the deep-run job + waves like the
    agent persona does. No-op wrapper when there's no session id.

    RC-4 pins the ASKER here too, for the same ambient reason: `trace_identity()` already
    reads `current_user_id()`, so attributing the turn is one contextvar, not a change to
    the telemetry seam. That is why a headless door could go unattributed for so long
    without anything looking broken — the machinery was reading a value nobody set.

    The body-supplied `principal_ref` is honoured ONLY when no authenticated user is
    already in scope. A request cannot name itself into someone else's identity: with the
    identity middleware on, `current_user_id()` is already set from a verified header and
    wins. This is a way for a TRUSTED headless caller to say who it is acting for — never
    a way for any caller to claim to be someone.
    """
    from pramanyx.org.context import (current_user_id, reset_session_id, reset_user_id,
                                    set_session_id, set_user_id)
    token = set_session_id(session_id or "")
    user_token = None
    if principal_ref and not current_user_id():
        user_token = set_user_id(said_asker(principal_ref))
    try:
        async for event in stream:
            yield event
    finally:
        if user_token is not None:
            reset_user_id(user_token)
        reset_session_id(token)


#: The doors that name an outside asker by a prefix of their own (`routers/doors.py`, the MCP client).
_DOOR_PREFIXES = ("api:", "teams:", "slack:", "webhook:", "a2a:", "automation:", "agent-ops")


def said_asker(principal_ref: str) -> str:
    """Who a body says is asking, kept as what it is: a label a caller chose (People, 2026-11-15). Until then it went
    through the identity links and became the request's person, which document access and every write read — so a
    body saying ``slack:U…`` was that linked person, and one saying ``ana@example.com`` was Ana. Now it is never a
    person: a door's own prefix stays as the door wrote it, and anything else is marked ``said:``. A person comes
    from sign-in or a delegation, never from a body."""
    raw = str(principal_ref or "").strip()[:128]
    if not raw:
        return ""
    return raw if raw.startswith(_DOOR_PREFIXES) else f"said:{raw}"


def is_said_asker(who: str) -> bool:
    """Whether ``who`` is a label :func:`said_asker` made — a door's or a caller's word for who asks — and so not a
    person."""
    return str(who or "").strip().lower().startswith((*_DOOR_PREFIXES, "said:"))


def _early(inv_id: str) -> dict:
    """``{"answered_early": <what it says>}`` on a report the person had answered now (punch list 89), else nothing."""
    from pramanyx.agent import answer_now
    return {"answered_early": answer_now.SAID} if answer_now.was_asked(inv_id) else {}


def _job_id_for_investigation(inv_id: str) -> Optional[str]:
    """The kernel job running (or that ran) this investigation — read from the
    journal, where every investigation.* event made inside a job is job-stamped; else
    the job whose payload names it (a row its door made as it claimed the question,
    `agent/one_run.take`, before any job existed — the job names it while queued)."""
    from pramanyx.kernel.ledger import Ledger
    ledger = Ledger.default()
    for e in ledger.events(kind="investigation.created", limit=300):
        if (e.get("payload") or {}).get("investigation_id") == inv_id and e.get("job_id"):
            return e.get("job_id")
    for job in ledger.jobs_where(kinds=["investigation"], limit=300):
        if (job.get("payload") or {}).get("investigation_id") == inv_id:
            return job.get("id")
    return None


@router.post("/investigations/{inv_id}/cancel")
def cancel_investigation_route(inv_id: str):
    """Cancel an in-flight investigation by cancelling its supervised kernel job.
    The job's CancelledError unwinds the stream's finally (which reconciles the
    'running' row to failed); the kernel records the job CANCELLED."""
    from pramanyx.kernel.jobs import kernel
    job_id = _job_id_for_investigation(inv_id)
    if not job_id:
        raise HTTPException(status_code=404, detail="No kernel job found for this investigation")
    cancelled = kernel().cancel(job_id, reason="cancelled on request")
    return {"investigation_id": inv_id, "job_id": job_id, "cancelled": cancelled}


@router.post("/investigations/{inv_id}/answer-now")
def answer_now_route(inv_id: str, request: Request):
    """Answer now (punch list 89): the person stops a running deep analysis and has it answer from what it has found —
    where cancelling answers nothing. Every place the run decides whether to keep going goes to its write-up, which says
    it was answered early. A person's own word: an agent is refused. 409 for a run that is not running."""
    from pramanyx.agent import answer_now
    from pramanyx.rbac.agent_gate import is_agent_request
    if is_agent_request(request):
        raise HTTPException(status_code=403, detail="answering now is the person's own call; an agent cannot make it")
    inv = get_investigation(inv_id)
    if not inv:
        raise HTTPException(status_code=404, detail="No such investigation")
    if str(inv.get("status") or "") not in ("running", "pending", "started"):
        raise HTTPException(status_code=409, detail="It is not running: there is nothing to answer early.")
    if _queued(inv_id):
        raise HTTPException(status_code=409, detail="It has not started: it is waiting for a free analysis slot, "
                                                    "so there is nothing to answer early. Cancel it instead.")
    answer_now.ask(inv_id)
    return {"investigation_id": inv_id, "answering_now": True}


def build_resume_stream(inv_id: str, request: "Request | None", *, feedback: str = "",
                        keep_subquestions: "Optional[list[int]]" = None,
                        clarify_choice: "Optional[str]" = None) -> AsyncGenerator[str, None]:
    """The composed resume stream behind the `/feedback` endpoint (incl. the agent-persona wrap).

    Another organisation's investigation is refused first, here as well as by the router's guard, so a door that
    carries the id in its body rather than its path is held too."""
    if request is not None:
        from pramanyx.security.authz import refuse_if_foreign
        refuse_if_foreign("investigation", inv_id, get_principal(request))
    stream = _stream_resume(inv_id, feedback, request, keep_subquestions=keep_subquestions,
                            clarify_choice=clarify_choice)
    # agents.user_defined — a deep run launched AS an agent resumes AS it: the persona persists in
    # the run's checkpointed state (resume never passes through /ask). Fail-open: no persona → unchanged.
    persona = persona_for_investigation(inv_id)
    if persona is not None:
        stream = _stream_as_agent(persona, stream)
    return stream


@router.post("/investigations/{inv_id}/feedback")
async def submit_feedback(inv_id: str, req: FeedbackRequest, request: Request):
    return StreamingResponse(
        build_resume_stream(inv_id, request, feedback=req.feedback,
                            keep_subquestions=req.keep_subquestions, clarify_choice=req.clarify_choice),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/investigations")
def get_investigations(limit: int = 50, workspace_id: str | None = None, mine: bool = False):
    """Recent investigations/chats. When `workspace_id` is given, only those whose
    connection belongs to that workspace are returned (data-path tenancy). ``mine`` keeps the caller's own questions
    (2026-11-17: a person's own coworker lists theirs, not everyone's); on an install without sign-in there is one
    person, and it changes nothing."""
    from pramanyx.db.history import person_now
    from pramanyx.metastore import accessible_catalog_ids
    asked_by = person_now() if mine and not _single_person() else ""
    allowed = accessible_catalog_ids(workspace_id)
    if allowed is None:
        return _as_asked(list_investigations(limit=limit, asked_by=asked_by))
    # Fetch wider when scoping so a workspace's items aren't truncated by the global
    # newest-first limit before filtering, then trim back to `limit`.
    rows = list_investigations(limit=max(limit, 200), asked_by=asked_by)
    scoped = [r for r in rows if r.get("connection_id") in allowed]
    return _as_asked(scoped[:limit])


def _as_asked(rows: list[dict]) -> list[dict]:
    """Each row's question as it was ASKED (`automations.temporal.ask_of`): a scheduled run's question carries the
    code-written context it was answered under, and a list of recent questions read "[Scheduled-run context — written
    by code, not inferred] …" for every one of them (the coworker's "Asked lately", 2026-11-15). The stored question
    is untouched; only the list shows the ask."""
    from pramanyx.automations.temporal import ask_of
    return [{**r, "question": ask_of(str(r.get("question") or ""))} if r.get("question") else r for r in rows]


@router.get("/investigations/indexed-ids")
def get_indexed_ids():
    from pramanyx.tools.prior_analyses import INVESTIGATIONS_COLLECTION
    from pramanyx.semantic.vector_store import scroll_payloads
    payloads = scroll_payloads(INVESTIGATIONS_COLLECTION)
    return {"ids": [p["inv_id"] for p in payloads if p.get("inv_id")]}


@router.get("/investigations/{inv_id}")
def get_investigation_detail(inv_id: str, principal=Depends(get_principal)):
    from pramanyx.security.authz import check_owner
    check_owner("investigation", inv_id, principal)  # SEC-05: no cross-org read
    inv = get_investigation(inv_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Investigation not found")
    if inv.get("status") == "running":
        inv["progress"] = _progress_of(inv)
    return inv


def _progress_of(inv: dict) -> dict:
    """How far a running run has got — how long it has run, its steps so far and the last one — read off the steps its
    trace records (`session_log` STEP). A run read back while it goes on reads as moving, not stuck: the coworker read
    a bare 'running' four times in half a minute and asked the question again (2026-11-24)."""
    from pramanyx.util.time import age_hours

    out: dict = {"steps": 0, "last_step": "", "running_for_s": None}
    hours = age_hours(str(inv.get("started_at") or ""))
    if hours < 9999:                                        # 9999: a start time that does not parse
        out["running_for_s"] = max(0, int(hours * 3600))
    trace_id = inv.get("trace_id") or ""
    if not trace_id:
        if _queued(str(inv.get("id") or "")):
            out["queued"] = True
        return out
    try:
        from pramanyx.kernel.ledger import Ledger
        from pramanyx.obs import session_log
        from pramanyx.org.context import current_org_id
        steps = Ledger.default().session_events(trace_id=trace_id, kind=session_log.STEP,
                                                org_id=current_org_id() or None, limit=500, ascending=True)
    except Exception as exc:  # noqa: BLE001 — a run's progress is a courtesy; its status stands without it
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "a running run's progress could not be read", counter="investigations.progress")
        return out
    out["steps"] = len(steps)
    if steps:
        out["last_step"] = str((steps[-1].get("payload") or {}).get("tool") or steps[-1].get("name") or "")
    elif _queued(str(inv.get("id") or "")):                 # a run that has taken no step may still wait
        out["queued"] = True
    return out


def _queued(inv_id: str) -> bool:
    """A run its door named as it claimed the question (`agent/one_run.take`) whose job still waits for a free slot."""
    from pramanyx.db.history import queued_run_ids
    return bool(inv_id) and inv_id in queued_run_ids()


@router.get("/investigations/{inv_id}/graph")
def get_investigation_graph(inv_id: str, principal=Depends(get_principal)):
    """The deep run's phase view (Wave CR5b): the FIXED topology it runs, the
    phases the checkpoint recorded, and — for a paused run — which gate it is
    waiting at, derived from state markers and labelled as such.

    Deliberately not a DAG editor and deliberately not `agent.get_state().next`:
    the authoritative next-node read needs a compiled graph over an open
    warehouse connection, which a read-only view must not require. Resume goes
    through the existing feedback endpoint.
    """
    from pramanyx.agent.graph import read_checkpoint_state
    from pramanyx.security.authz import check_owner

    check_owner("investigation", inv_id, principal)
    inv = get_investigation(inv_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Investigation not found")

    cp = read_checkpoint_state(inv_id)
    values = cp.get("values") or {}
    phases = list(values.get("investigation_phases") or [])
    sub_questions = list(values.get("sub_questions") or [])
    clarify_pending = values.get("_clarify_pending") or None

    # Branch, from what the checkpoint actually holds. A run with no checkpoint
    # reports unknown rather than a guessed picture. A run paused at the clarify
    # gate has no phases yet — the pending clarify marker is the deep-analysis tell.
    #
    # The wire value stays "ada": clients (including web/lib/api.ts) compare against it,
    # and the node ids in `topology` below are the graph's real, frozen node names. The
    # response carries an additive `branch_label` for anything that wants to DISPLAY the
    # branch without learning the acronym.
    if phases or clarify_pending:
        branch = "ada"
    elif sub_questions:
        branch = "explore"
    elif cp.get("exists"):
        branch = "direct"
    else:
        branch = "unknown"

    # The fixed topologies (pramanyx/agent/graph.py _compile) — flag-gated
    # variants resolved at read time so the picture matches what would run.
    from pramanyx.agent.graph import topology_flags

    variants = topology_flags()
    if branch == "ada":
        middle = (["ada_phase_wave"] if variants["ada_parallel_phases"]
                  else ["ada_baseline", "ada_decompose", "ada_dimensional"])
        xsec = ("ada_cross_section_multilens" if variants["ada_parallel_lenses"]
                else "ada_cross_section")
        topology = ["route_question", "exploratory_scan", "ada_intake", "clarify_gate",
                    xsec, *middle, "ada_behavioral", "ada_synthesize"]
    elif branch == "explore":
        executor = ("plan_and_execute_wave" if variants["explore_parallel"]
                    else "plan_and_execute_subq")
        topology = ["route_question", "exploratory_scan_explore",
                    "decompose_exploration", "plan_gate", executor,
                    "synthesize_exploration"]
    elif branch == "direct":
        topology = ["route_question", "plan_queries", "execute_planned_queries",
                    "score_evidence", "replan", "synthesize"]
    else:
        topology = []

    paused = inv.get("status") == "paused"
    gate = None
    if paused:
        if clarify_pending:
            gate = "clarify_gate"
        elif branch == "explore":
            gate = "plan_gate"
        elif branch == "ada":
            gate = "ada_synthesize"

    return {
        "investigation_id": inv_id,
        "status": inv.get("status"),
        "branch_label": {"ada": "Deep analysis", "explore": "Survey",
                         "direct": "Quick answer"}.get(branch, "Unknown"),
        "question": inv.get("question"),
        "branch": branch,
        "topology": topology,
        "phases": phases,
        "sub_questions": sub_questions,
        "interrupt": {"paused": paused, "gate": gate,
                      "basis": "state_markers" if paused else None,
                      "clarify_pending": clarify_pending},
        "checkpoint": {"exists": cp.get("exists", False), "step": cp.get("step"),
                       "last_writers": cp.get("last_writers", [])},
        "resume": {"feedback": f"/investigations/{inv_id}/feedback"} if paused else None,
    }


@router.post("/investigations/{inv_id}/recheck")
def recheck_investigation(inv_id: str, principal=Depends(get_principal)) -> dict:
    """Idea 5 — re-run a chat answer's own query NOW and compare it with what was said: the
    numbers that moved by 5% or more, and whether they are late rows or a restatement. The
    re-check is recorded on the answer. Nothing is sent: the person asking is looking at it."""
    from pramanyx.answer import recheck
    from pramanyx.db.history import get_chat_answer
    from pramanyx.security.authz import check_owner

    check_owner("investigation", inv_id, principal)
    answer = get_chat_answer(inv_id)
    if answer is None:
        raise HTTPException(status_code=404, detail="No chat answer with this id")
    entry = recheck.recheck_and_tell(answer, notify=False)
    return {**entry, "text": recheck.correction_text(answer, entry)
            if entry.get("status") == "changed" else ""}


@router.get("/investigations/{inv_id}/rechecks")
def investigation_rechecks(inv_id: str, principal=Depends(get_principal)) -> dict:
    """Idea 5 — every re-check of a chat answer, oldest first: what its query returned each
    time it was re-run, and whether the person was told. Empty until one ran."""
    from pramanyx.db.history import get_chat_answer
    from pramanyx.security.authz import check_owner

    check_owner("investigation", inv_id, principal)
    answer = get_chat_answer(inv_id)
    if answer is None:
        raise HTTPException(status_code=404, detail="No chat answer with this id")
    return {"investigation_id": inv_id,
            "rechecks": list((answer.get("report") or {}).get("rechecks") or [])}


@router.get("/investigations/{inv_id}/envelope")
def investigation_envelope(inv_id: str, principal=Depends(get_principal)) -> dict:
    """CP-4 — the stored answer envelope: the fields a door selects from.

    For a door that was not on the stream — a scheduled send, an export, a later reader.
    404 when the turn predates the envelope or never settled into one.
    """
    from pramanyx.security.authz import check_owner

    check_owner("investigation", inv_id, principal)
    inv = get_investigation(inv_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Investigation not found")
    # P6 — the envelope the report supports today: a version-1 fold under a concluded report is
    # brought up to the report's figures, exhibits and gaps on read (`envelope_of_report`).
    from pramanyx.answer.envelope import envelope_of_report
    env = envelope_of_report(inv.get("report") or {}, question=str(inv.get("question") or ""))
    if not env:
        raise HTTPException(status_code=404, detail="This answer carries no envelope")
    return env


@router.get("/investigations/{inv_id}/export")
def export_investigation(inv_id: str, format: str = "pdf", narrate: bool = False,
                         principal=Depends(get_principal)):
    """Download a stored analysis as PDF, PowerPoint, Excel or Word (`format=pdf|pptx|xlsx|docx`). Built from the
    answer's stored report, never from code a model wrote; Excel carries every stored row.

    `narrate=true` prepends an LLM-authored executive summary (best-effort; the
    export still succeeds if the model is slow or unavailable)."""
    from fastapi.responses import Response
    from pramanyx.security.authz import check_owner

    check_owner("investigation", inv_id, principal)  # SEC-05: no cross-org export
    inv = get_investigation(inv_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Investigation not found")
    fmt = (format or "pdf").lower()
    if fmt not in ("pdf", "pptx", "xlsx", "docx"):
        raise HTTPException(status_code=400, detail="format must be one of pdf, pptx, xlsx, docx")

    # Imported after the authz/existence checks so a caller who may not read this
    # investigation learns nothing about the deployment's configuration, and guarded
    # separately from the render below: `pramanyx.export` pulls the extra's whole dependency
    # closure at import time, and an ImportError here is the same CONFIGURATION state as
    # ExportUnavailable — not a fault. Catching it only around export_report() let the
    # matplotlib import escape as a 500.
    try:
        from pramanyx.export import ExportUnavailable, export_report
    except ImportError as exc:
        logger.warning("export requested but its extra failed to import: %s", exc)
        raise HTTPException(status_code=501, detail=(
            "Report export needs the 'export' extra (reportlab, python-pptx, matplotlib). "
            f"Install it with:  uv sync --extra export   —  underlying import error: {exc}"))

    try:
        # The router resolves the effective currency (org override → profile) and injects
        # it — the platform-side export must not import agent-side settings itself.
        _sym = resolve_currency_symbol(inv.get("connection_id") or "", inv.get("schema_name"))
        data, filename, media_type = export_report(inv, fmt, narrate=narrate, money_symbol=_sym)
    except ExportUnavailable as exc:
        # A deployment without the `export` extra is a CONFIGURATION state, not a fault:
        # say so, and name the fix. A 500 would send the operator hunting a bug.
        logger.warning("export requested but unavailable: %s", exc)
        raise HTTPException(status_code=501, detail=str(exc))
    except Exception:  # never leak a stack trace to the client
        logger.exception("export failed for %s", inv_id)
        raise HTTPException(status_code=500, detail="export failed")
    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/exports/answers")
def export_answers_route(ids: str, title: str = "", principal=Depends(get_principal)):
    """Several answers as one PowerPoint deck, in the order given (punch list 92, 2026-11-18): a conversation's answers,
    each drawn from its stored report as its own export draws it. `ids` is a comma-separated list of investigation ids,
    at most 30; each must be the caller's to read, and one that is not, or is gone, refuses the whole deck by name."""
    from fastapi.responses import Response
    from pramanyx.security.authz import check_owner

    wanted = [i for i in dict.fromkeys(x.strip() for x in (ids or "").split(",")) if i]
    if not wanted:
        raise HTTPException(status_code=400, detail="Name the answers the deck is made of (ids=a,b,c)")
    if len(wanted) > 30:
        raise HTTPException(status_code=400, detail="A deck holds at most 30 answers; choose the ones it is for")
    invs = []
    for inv_id in wanted:
        check_owner("investigation", inv_id, principal)
        inv = get_investigation(inv_id)
        if not inv:
            raise HTTPException(status_code=404, detail=f"Answer {inv_id} is not there any more")
        invs.append(inv)
    try:
        from pramanyx.export import ExportUnavailable, export_answers
    except ImportError as exc:
        logger.warning("deck export requested but its extra failed to import: %s", exc)
        raise HTTPException(status_code=501, detail=(
            "Report export needs the 'export' extra (reportlab, python-pptx, matplotlib). "
            f"Install it with:  uv sync --extra export   —  underlying import error: {exc}"))
    try:
        symbols = [resolve_currency_symbol(inv.get("connection_id") or "", inv.get("schema_name")) for inv in invs]
        data, filename, media_type = export_answers(invs, title=title, money_symbols=symbols)
    except ExportUnavailable as exc:
        logger.warning("deck export requested but unavailable: %s", exc)
        raise HTTPException(status_code=501, detail=str(exc))
    except Exception:  # never leak a stack trace to the client
        logger.exception("deck export failed for %s", ",".join(wanted))
        raise HTTPException(status_code=500, detail="export failed")
    return Response(content=data, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.delete("/investigations", status_code=200)
def clear_investigations(workspace_id: str | None = None):
    """Bulk-delete investigations the caller can see — platform-wide, or scoped to a
    workspace's connections when `workspace_id` is given. Cascades evidence claims
    and the RAG vector index. Returns a count summary of what was removed."""
    from pramanyx.db.purge import purge_investigations_bulk
    from pramanyx.metastore import accessible_catalog_ids

    allowed = accessible_catalog_ids(workspace_id)
    # allowed is None → unscoped (clear everything); else restrict to those connections.
    return purge_investigations_bulk(None if allowed is None else list(allowed))


@router.delete("/investigations/{inv_id}", status_code=204)
def delete_investigation_endpoint(inv_id: str, principal=Depends(get_principal)):
    """Delete one investigation and its full footprint (history row, evidence
    claims, RAG vector entry). 404 if it doesn't exist."""
    from pramanyx.db.purge import purge_investigation_artifacts
    from pramanyx.security.authz import check_owner
    check_owner("investigation", inv_id, principal)  # SEC-05: no cross-org delete
    counts = purge_investigation_artifacts(inv_id)
    if not counts.get("investigations"):
        raise HTTPException(status_code=404, detail="Investigation not found")


@router.post("/investigations/reindex", dependencies=[gate(Capability.DEEP_ANALYSIS)])
def reindex_investigations():
    from pramanyx.tools.prior_analyses import index_investigation
    rows = list_investigations(limit=1000)
    indexed, skipped = 0, 0
    for row in rows:
        if not row.get("headline"):
            skipped += 1
            continue
        full = get_investigation(row["id"])
        if not full or not full.get("report"):
            skipped += 1
            continue
        key_findings = [f.get("claim", "") for f in (full["report"].get("key_findings") or [])]
        index_investigation(inv_id=row["id"], question=row["question"], headline=row["headline"], key_findings=key_findings, connection_id=row.get("connection_id", ""))
        indexed += 1
    return {"indexed": indexed, "skipped": skipped}


# ── group conversations (2026-11-17) ─────────────────────────────────────────────────────────────────────────────
# The user: "there cannot be shared conversations unless users add other users in it". A thread is its owner's and the
# people they add (`db/history.py`); every door that lists, reads, asks in, renames or deletes one checks that first.
# One a person may not see answers "not found", as one that does not exist does — a guess at an id learns nothing.


def _single_person() -> bool:
    from pramanyx.security.authz import require_identity_enabled
    return not require_identity_enabled()


def _thread_door(session_id: str) -> None:
    """Before a question is asked in a thread: a new thread becomes the asker's; another person's is refused unless
    they were added to it. Each question is asked as the person asking — the request is theirs."""
    if not session_id:
        return
    from pramanyx.db.history import claim_thread, may_see_thread, person_now, thread_people
    people = thread_people(session_id)
    if not people["owner"] and not people["askers"]:
        claim_thread(session_id, person_now())
        return
    if not may_see_thread(session_id, person_now(), single_person=_single_person()):
        raise HTTPException(status_code=404, detail="Session not found")


def _seen_or_404(session_id: str) -> dict:
    from pramanyx.db.history import may_see_thread, person_now, thread_people
    if not may_see_thread(session_id, person_now(), single_person=_single_person()):
        raise HTTPException(status_code=404, detail="Session not found")
    return thread_people(session_id)


def _owner_only(session_id: str, what: str) -> dict:
    """A thread's owner renames it, deletes it and chooses who is in it; on an install without sign-in, the one
    person. A member may leave."""
    from pramanyx.db.history import person_now
    people = _seen_or_404(session_id)
    if not _single_person() and people["owner"] and people["owner"] != person_now():
        raise HTTPException(status_code=403, detail=f"Only {people['owner']}, who began this conversation, {what}.")
    return people


@router.get("/chat-sessions")
def list_chat_sessions_route(conn_id: Optional[str] = None, limit: int = 30):
    """The caller's threads for the threads rail (CI-6a): the ones they began and the ones they were added to — id,
    title, turns, last activity, and who is in it. Org-scoped in the store, like the turns read."""
    from pramanyx.db.history import list_chat_sessions, person_now
    return list_chat_sessions(conn_id, limit=limit, person=person_now(), single_person=_single_person())


class ThreadMembersRequest(BaseModel):
    """The people a thread's owner adds: each by the email they sign in with."""
    members: list[str] = Field(default_factory=list, max_length=50)


@router.get("/chat-sessions/{session_id}/people")
def thread_people_route(session_id: str):
    """Who is in a conversation: who began it, who they added, who has asked in it."""
    from pramanyx.db.history import person_now
    people = _seen_or_404(session_id)
    return {**people, "you": person_now(), "single_person": _single_person()}


@router.put("/chat-sessions/{session_id}/members")
def set_thread_members_route(session_id: str, req: ThreadMembersRequest, request: Request):
    """Add people to a conversation, or take them out — its owner's choice, never an agent's. Each must be one of the
    organisation's people when the organisation has a people directory."""
    from pramanyx.rbac.agent_gate import is_agent_request
    if is_agent_request(request):
        raise HTTPException(status_code=403, detail="A person adds people to a conversation; an agent does not.")
    _owner_only(session_id, "chooses who is in it")
    import re as _re

    from pramanyx.db.history import set_thread_members
    from pramanyx.org.context import current_org_id
    from pramanyx.rbac.directory import people as directory
    wanted = [m.strip().lower() for m in req.members if m.strip()]
    bad = [m for m in wanted if not _re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", m)]
    if bad:
        raise HTTPException(status_code=422, detail=f"Not a person's sign-in email: {', '.join(bad[:5])}")
    known = {p.email.lower() for p in directory(current_org_id() or "default")}
    unknown = [m for m in wanted if known and m not in known]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Not one of your organisation's people: {', '.join(unknown[:5])}")
    return {"session_id": session_id, "members": set_thread_members(session_id, wanted)}


@router.delete("/chat-sessions/{session_id}/members/me", status_code=204)
def leave_thread_route(session_id: str):
    """A member leaves a conversation they were added to."""
    from pramanyx.db.history import person_now, set_thread_members
    people = _seen_or_404(session_id)
    me = person_now()
    if me not in people["members"]:
        raise HTTPException(status_code=409, detail="You were not added to this conversation; its owner deletes it.")
    set_thread_members(session_id, [m for m in people["members"] if m != me])


class RenameChatSessionRequest(BaseModel):
    """A thread's user-chosen name. Empty clears it back to the opening question."""
    title: str = Field(default="", max_length=200,
                       description="The thread's display name; empty restores the derived title.")


@router.patch("/chat-sessions/{session_id}")
def rename_chat_session_route(session_id: str, req: RenameChatSessionRequest):
    """Rename a thread (CA-5). The rail's titles were derived from the opening
    question — a good default, a bad permanent name. Org-scoped in the store, like
    every other read and write keyed by a session id."""
    from pramanyx.db.history import rename_chat_session
    _owner_only(session_id, "renames it")
    if not rename_chat_session(session_id, req.title):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session_id, "title": req.title.strip()[:200]}


@router.delete("/chat-sessions/{session_id}", status_code=204)
def delete_chat_session_route(session_id: str):
    """Delete a thread and every turn's full footprint — history rows, evidence
    claims, vector entries, the title override (CA-5).

    A real delete, not a hidden flag: the History panel's per-run delete already
    removes runs outright, and a thread the user asked to be gone that still steered
    future analysis from the RAG index would be the same lie CA-0 went after.
    """
    from pramanyx.db.purge import purge_chat_session_artifacts
    _owner_only(session_id, "deletes it")
    counts = purge_chat_session_artifacts(session_id)
    # FL-6 — a deep-only thread deletes by UNFILING its runs (they survive for
    # Fleet/agent history); that is a successful delete of the THREAD, so it
    # must not read as "not found" just because no chat row died.
    if not counts.get("investigations") and not counts.get("deep_runs_unfiled"):
        raise HTTPException(status_code=404, detail="Session not found")


@router.get("/chat-sessions/{session_id}/turns")
def get_chat_session_turns(session_id: str):
    _seen_or_404(session_id)
    turns = get_session_turns(session_id)
    if not turns:
        raise HTTPException(status_code=404, detail="Session not found")
    return turns


def _staged_proposal_parts(trace_id: str) -> list[dict]:
    """`data-proposal_staged` parts for the proposals one run staged — the stream's own shape."""
    if not trace_id:
        return []
    from pramanyx.actions.inbox import proposals_for_trace
    return [{"type": "data-proposal_staged", "data": {
                "proposal_id": p.id, "kind": p.kind, "connection_id": p.connection_id,
                "action_id": p.action_id}}
            for p in proposals_for_trace(trace_id)]


def _turn_to_ui_messages(t: dict) -> list[dict]:
    """One stored chat turn as an AI-SDK `UIMessage` pair (CA-1).

    The persisted form and the streamed form are the same shape: text parts carry
    the prose (channel-stamped exactly as the live adapter stamps them), typed
    ``data-*`` parts carry the structure, and the web client's ``projectTurn``
    derives the turn from either without knowing which it got. That equivalence is
    what let the client's 40-field manual restore literal be deleted — restoring a
    thread is ``setMessages`` and nothing else.

    An interrupted turn carries a ``data-error`` part with the shared uncertainty
    sentence (kernel/jobs.py UNCERTAIN_RESULT): the partial it produced renders,
    and the tail says plainly that it is missing — a partial presented as complete
    is a worse lie than not restoring it.

    FL-6 — a DEEP row (kind='investigation') restores as the same wire shape the
    live run streamed: one ``data-answer_report`` part (the client's
    ``projectDeepReport`` renders the full report from it), a ``data-error`` tail
    for a non-complete status, and the investigate mode on the user message so
    the loading chrome keys correctly. A deep row that ended without a report
    restores as its question + the honest error alone.
    """
    from pramanyx.kernel.jobs import UNCERTAIN_RESULT

    # the answer's public receipt, as the stream sent it: its sources and "Why this number" are drawn from it
    receipt = [{"type": "data-receipt_id", "data": {"receipt_id": t["receipt_id"]}}] if t.get("receipt_id") else []
    # the work it did, as the stream sent it, and how long it took: the turn's line reads "Completed in … · N steps" again
    work = [{"type": "data-converse_step", "data": step} for step in t.get("steps") or []]
    took = {"took_ms": t["took_ms"]} if t.get("took_ms") else {}

    if (t.get("kind") or "chat") == "investigation":
        parts = []
        if t.get("deep_report"):
            parts.append({"type": "data-answer_report", "data": {
                "answer_report": t["deep_report"],
                "query_mode": "investigate",
                "investigation_id": t["id"],
            }})
        parts.extend(receipt)
        parts.extend(work)
        status = t.get("status") or "complete"
        if status == "handed_back":
            # An agent's repeat, handed the run of its question already under way (`agent/one_run.py`): nothing of its
            # own to replay, and nothing uncertain — the run it names answers the question.
            rid = str(t.get("handed_to") or "")
            parts.append({"type": "text", "state": "done", "text": (
                f"This question was already being analysed{f' (run {rid})' if rid else ''}, so it was handed that run "
                "rather than analysed twice.")})
        elif status != "complete":
            parts.append({"type": "data-error", "data": {
                "message": f"This deep analysis ended as {status} — {UNCERTAIN_RESULT}.",
            }})
        return [
            {"id": f"{t['id']}-q", "role": "user",
             "parts": [{"type": "text", "text": t.get("question") or ""}],
             "metadata": {"mode": "investigate", "asked_by": t.get("asked_by") or ""}},
            {"id": t["id"], "role": "assistant", "parts": parts, **({"metadata": took} if took else {})},
        ]

    parts: list[dict] = [*work]
    if t.get("headline"):
        parts.append({
            "type": "text", "text": t["headline"], "state": "done",
            "providerMetadata": {"pramanyx": {"channel": "headline"}},
        })
        parts.append({"type": "data-headline", "data": {"headline": t["headline"]}})
    if t.get("sql"):
        parts.append({"type": "data-sql", "data": {"sql": t["sql"]}})
    if t.get("columns"):
        parts.append({"type": "data-columns", "data": {"columns": t["columns"]}})
    if t.get("rows"):
        parts.append({"type": "data-rows", "data": {"rows": t["rows"]}})
    if t.get("chart_type"):
        parts.append({"type": "data-chart_type", "data": {"chart_type": t["chart_type"]}})
    if t.get("tables_used"):
        parts.append({"type": "data-tables_used", "data": {"tables": t["tables_used"]}})
    if t.get("latest_recheck"):
        # Idea 5 — the answer was re-checked and a number it gave has moved since. Only a
        # re-checked turn carries the part; every other turn restores exactly as before.
        parts.append({"type": "data-recheck", "data": t["latest_recheck"]})
    if t.get("intent") or t.get("approach"):
        parts.append({"type": "data-analysis", "data": {
            "intent": t.get("intent") or "", "steps": t.get("approach") or [],
        }})
    # WIRE-NAME BOUNDARY — the stored key is `insight` (report_json["insight"], a
    # persisted identity); the wire part is `narrative`, the platform's own word.
    if t.get("insight"):
        parts.append({"type": "data-narrative", "data": t["insight"]})
    if t.get("overview_report"):
        parts.append({"type": "data-overview_report",
                      "data": {"overview_report": t["overview_report"]}})
    # The approval cards the turn staged. The live `proposal_staged` frame is not stored, so a
    # reopened chat drew none (CT-5's survey: every proposal kind); the proposals the turn's
    # run staged are found by its trace and sent as the same part the stream sent.
    parts.extend(_staged_proposal_parts(t.get("trace_id") or ""))
    parts.extend(receipt)
    if (t.get("status") or "complete") == "interrupted":
        parts.append({"type": "data-error", "data": {
            "message": f"This answer was interrupted — {UNCERTAIN_RESULT}.",
        }})
    elif t.get("sql"):
        # The turn id IS the receipt key; the receipt surface 404-noops gracefully
        # if this turn predates receipts.
        parts.append({"type": "data-done", "data": {"has_receipt": True, "inv_id": t["id"]}})
    return [
        # Who asked it (group conversations, 2026-11-17): '' for a turn from before that was kept.
        {"id": f"{t['id']}-q", "role": "user",
         "parts": [{"type": "text", "text": t.get("question") or ""}],
         "metadata": {"asked_by": t.get("asked_by") or ""}},
        {"id": t["id"], "role": "assistant", "parts": parts, **({"metadata": took} if took else {})},
    ]


@router.get("/chat-sessions/{session_id}/messages")
def get_chat_session_messages(session_id: str):
    """The thread as AI-SDK ``UIMessage[]`` (CA-1) — thread selection on the web
    is ``setMessages`` over this, the same shape the live stream accumulates.
    Org-scoped in the store, like the turns read. In a conversation more than one person is in, each question says
    who asked it."""
    _seen_or_404(session_id)
    turns = get_session_turns(session_id)
    if not turns:
        raise HTTPException(status_code=404, detail="Session not found")
    return [m for t in turns for m in _turn_to_ui_messages(t)]


@router.get("/answer/{connection_id}/{inv_id}/receipt")
def get_answer_receipt(connection_id: str, inv_id: str):
    """K3-wide Trust Receipt for an agentic (deep-analysis) answer report — executed
    queries, input tables, registered metrics + B-7 enforcement verdict. 404 for
    investigations produced before receipts."""
    from pramanyx.kernel.ledger import Ledger
    # natural_key stays `ada:` — a persisted storage identity; renaming it would
    # orphan every receipt written before this rename. Only the URL path is de-deep-analysis'd.
    rec = Ledger.default().receipt(f"ada:{connection_id}:{inv_id}")
    if rec is None:
        raise HTTPException(status_code=404, detail="No receipt for this report")
    return rec


@router.get("/ada/{connection_id}/{inv_id}/receipt", deprecated=True)
def get_ada_receipt(connection_id: str, inv_id: str):
    """@deprecated Use `/answer/{connection_id}/{inv_id}/receipt`. Kept one release
    for the acronym→answer rename (REC-U9)."""
    return get_answer_receipt(connection_id, inv_id)


@router.get("/chat/{connection_id}/{turn_id}/receipt")
def get_chat_receipt(connection_id: str, turn_id: str):
    """K3-wide Trust Receipt for a chat answer — the executed SQL, input tables,
    registered metrics available, and the guards that fired this turn. Makes
    every user-facing number self-justifying, not just explorer findings. 404
    until the answer is produced under the receipt-emitting path (older turns
    have none)."""
    from pramanyx.kernel.ledger import Ledger
    rec = Ledger.default().receipt(f"chat:{connection_id}:{turn_id}")
    if rec is None:
        raise HTTPException(status_code=404, detail="No receipt for this answer")
    return rec


def _record_acceptance(inv_id: str, outcome, req: "OutcomeRequest", principal):
    """CB-2 — on accept, decide the review now: the baseline measured with the answer's own
    definition (`report.spec`) and the date the platform asks whether it worked. Best-effort: a
    connection that cannot be measured leaves a note on the record, never a failed acceptance."""
    from pramanyx.playbook.outcomes import record_acceptance
    inv = get_investigation(inv_id) or {}
    report = inv.get("report") if isinstance(inv.get("report"), dict) else {}
    spec = report.get("spec") if isinstance(report, dict) else None
    connection_id = str(inv.get("connection_id") or "")
    accepted_by = _who_decided(principal)
    try:
        from pramanyx.db.measure import run_sql_for
        run_sql = (run_sql_for(connection_id, internal=True) if (spec and connection_id)
                   else (lambda sql: ([], [], "no connection")))
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the acceptance baseline could not open the connection; recorded unmeasured",
                 counter="outcomes.baseline_connection", conn_id=connection_id or None)
        why = f"connection unavailable: {str(exc)[:120]}"
        run_sql = lambda sql: ([], [], why)  # noqa: E731
    # Phase 1 of the 2027 study: the review date is PROPOSED from the connection's learned settling
    # lag when the person named none, so the review reads settled days; the decision below records
    # which rule set it. One date — the outcome record's and the decision's are the same day.
    from datetime import datetime as _datetime, timezone as _timezone
    now = _datetime.now(_timezone.utc)
    review_days, review_on_why = req.review_days, ""
    if review_days and int(review_days) > 0:
        review_on_why = f"{int(review_days)} days, as the person asked"
    else:
        from pramanyx.record.decisions import propose_review_on
        review_on, review_on_why = propose_review_on(connection_id, now)
        review_days = max((_datetime.fromisoformat(review_on).date() - now.date()).days, 1)
    outcome = record_acceptance(outcome, spec=spec, connection_id=connection_id, accepted_by=accepted_by,
                                run_sql=run_sql, review_days=review_days, now=now)
    _book_recommendation_decision(outcome, chosen="accept", decided_by=accepted_by, connection_id=connection_id,
                                  req=req, spec=spec, review_on_why=review_on_why)
    return outcome


def _book_recommendation_decision(outcome, *, chosen: str, decided_by: str, connection_id: str,
                                  req: "OutcomeRequest", spec: Optional[dict], review_on_why: str = "") -> None:
    """The acceptance (or decline) IS a decision; book it as a by-product (the 2027 study §K,
    `pramanyx/record/byproducts.py`). Best-effort: the outcome record stands when the booking fails."""
    try:
        from pramanyx.record.byproducts import decision_from_recommendation, expectation_from
        exp_fields = req.expectation.model_dump() if req.expectation is not None else None
        default_metric = (spec or {}).get("metric_label") or req.metric_name or ""
        expectation = expectation_from(exp_fields, default_metric=default_metric) if exp_fields is not None else None
        decision_from_recommendation(outcome, chosen=chosen, decided_by=decided_by or "unidentified",
                                     connection_id=connection_id, expectation=expectation,
                                     review_on=(outcome.review_at or "")[:10], review_on_why=review_on_why)
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "booking the decision in the Record is best-effort; the acceptance itself is logged",
                 counter="record.decision_from_recommendation", conn_id=connection_id or None)


def _who_decided(principal) -> str:
    """Who accepted or declined: the signed-in person, else the one the request acts for — never a
    name a client sends. Bare, as the playbook's outcome records have always kept it."""
    for attr in ("user_id", "email", "id", "sub", "name"):
        v = getattr(principal, attr, "") if principal is not None else ""
        if v:
            return str(v)
    from pramanyx.security.authz import caller
    return caller()


@router.post("/investigations/{inv_id}/recommendations/{rec_index}/outcome", status_code=201)
def log_recommendation_outcome(inv_id: str, rec_index: int, req: OutcomeRequest, principal=Depends(get_principal)):
    from pramanyx.playbook.outcomes import log_outcome, update_playbook_success_rates
    outcome = log_outcome(inv_id=inv_id, rec_index=rec_index, rec_text=req.rec_text, status=req.status, metric_name=req.metric_name, metric_before=req.metric_before, metric_after=req.metric_after)  # type: ignore[arg-type]
    if req.status == "accepted":
        try:
            outcome = _record_acceptance(inv_id, outcome, req, principal)
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "recording the acceptance baseline is best-effort; the acceptance itself is logged",
                     counter="outcomes.baseline")
    if req.status in ("verified", "implemented", "rejected"):
        # Phase 1 of the 2027 study: a decline before any acceptance is itself a decision (chosen:
        # decline); an answer after one is the decision's OUTCOME against its expectation.
        try:
            from pramanyx.record import decisions as _decisions
            from pramanyx.record.byproducts import outcome_from_review_answer
            _src = _decisions.Source(kind="recommendation", ref=outcome.id)
            if _decisions.latest_decision(_src) is None and req.status == "rejected":
                _inv = get_investigation(inv_id) or {}
                _report = _inv.get("report") if isinstance(_inv.get("report"), dict) else {}
                _book_recommendation_decision(outcome, chosen="decline", decided_by=_who_decided(principal),
                                              connection_id=str(_inv.get("connection_id") or ""), req=req,
                                              spec=_report.get("spec") if isinstance(_report, dict) else None)
            else:
                outcome_from_review_answer(outcome, status=req.status, answered_by=_who_decided(principal))
        except Exception as exc:
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "booking the outcome in the Record is best-effort; the answer itself is logged",
                     counter="record.outcome_from_review")
        update_playbook_success_rates()
    return outcome.model_dump()


@router.get("/investigations/{inv_id}/outcomes")
def get_investigation_outcomes(inv_id: str):
    from pramanyx.playbook.outcomes import load_outcomes_for_inv
    return [o.model_dump() for o in load_outcomes_for_inv(inv_id)]


# ── Agent Context surface (P2) ────────────────────────────────────────────────

class RescopeRequest(BaseModel):
    connection_id: str
    keep: list[str] = Field(default_factory=list)   # explicit table allowlist the user wants
    schema_name: Optional[str] = None
    expand_fk: bool = True                           # pull in FK bridge tables so joins resolve


@router.post("/investigations/context/rescope")
def rescope_context(req: RescopeRequest):
    """Re-derive the agent's working context after a user trims/adds tables, and report
    the new token budget vs the full schema. Deterministic — no LLM, no agent run — so
    the ribbon can preview the effect of a scope edit instantly. `keep` is the desired table set; the response also lists all_tables so the UI
    knows what is addable."""
    from pramanyx.tools.context_manifest import build_context_manifest, rescope_schema
    db = open_connection_for(req.connection_id)
    try:
        raw = getattr(db, "_conn", None)
        if raw is None:
            raise HTTPException(status_code=400, detail="connection does not expose a schema for rescoping")
        full_schema = _get_schema_cached(req.connection_id, db)
    finally:
        db.close()
    full = build_context_manifest(full_schema)
    _scoped, manifest = rescope_schema(full_schema, keep=req.keep, expand_fk=req.expand_fk)
    return {
        "manifest": manifest.to_dict(),
        "all_tables": full.tables,
        "full_tokens": full.estimated_tokens,
        "scoped_tokens": manifest.estimated_tokens,
        "token_delta": full.estimated_tokens - manifest.estimated_tokens,
    }


# ── Evidence Ledger endpoints ─────────────────────────────────────────────────

class EvidenceFeedbackRequest(BaseModel):
    feedback: str   # "validated" | "disputed" | "needs_context"
    note: Optional[str] = None


@router.get("/investigations/evidence/recent")
def get_recent_evidence(connection_id: str, canvas_id: Optional[str] = None, limit: int = 50):
    """Return recent evidence claims across a scope (connection, optionally a canvas),
    newest-first — the scope-level Evidence layer. The ledger keys only by
    investigation_id, so we resolve the scope to its investigation IDs first.

    Registered before /investigations/{inv_id}/evidence so the literal 'evidence'
    segment can't be captured as an investigation id.
    """
    from pramanyx.db.history import list_investigation_ids
    from pramanyx.evidence import store as _ev_store
    inv_ids = list_investigation_ids(connection_id, canvas_id)
    claims = _ev_store.get_recent_claims_for_investigations(inv_ids, limit)
    return [c.model_dump() for c in claims]


@router.get("/investigations/{inv_id}/evidence")
def get_investigation_evidence(inv_id: str):
    """Return all evidence claims for an investigation, in the order recorded. ``confidence`` is
    null on every row written since phase 1 of the 2027 study: not counted, so not shown."""
    from pramanyx.evidence import store as _ev_store
    claims = _ev_store.get_claims_for_investigation(inv_id)
    return [c.model_dump() for c in claims]


@router.post("/investigations/{inv_id}/evidence/{claim_id}/feedback")
def submit_claim_feedback(inv_id: str, claim_id: str, req: EvidenceFeedbackRequest):
    """Set owner feedback on an evidence claim."""
    from pramanyx.evidence import store as _ev_store
    VALID = {"validated", "disputed", "needs_context"}
    if req.feedback not in VALID:
        raise HTTPException(status_code=422, detail=f"feedback must be one of {VALID}")
    updated = _ev_store.update_feedback(claim_id, req.feedback, req.note)
    if not updated:
        raise HTTPException(status_code=404, detail="Claim not found")
    return updated.model_dump()
