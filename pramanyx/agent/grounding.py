"""The grounding context the SQL writer is given — assembled once, shown on demand.

Rec 5 of the 2026-07-11 platform study (flag ``ask.context_receipt``): the
*input-side* twin of the Trust Receipt. The Trust Receipt says what the answer
did; the grounding receipt says what the model was *grounded on* — the schema
slice chosen, glossary/business definitions, governed-metric bindings,
ambiguity-ledger priors (closed-loop corrections), dialect rules, trusted-query
templates, and which agent brief and pack are active.

Design (single source of truth, no drift): each grounding block has ONE producer
function here, wrapping the same underlying retriever the answer path already
calls (``retrieve_for_planning``, ``unified_metric_grounding``,
``build_corrections_section``, …). :func:`build_grounding_context` composes them
into a :class:`GroundingContext`; the quick ``/ask`` path and the ``GET
/ask/context`` endpoint both build blocks from these same producers, so the
receipt reflects the real grounding rather than a re-derivation that can diverge.

The one context builder (the plan of record, 2026-11-27). Until then only the quick answer core read most of these blocks:
the deep analyst was given no Definitions, trusted queries, corrections, findings, memory or Briefing, and the
conversation reached them only when the model chose a tool. :func:`build_grounding_context` is now what EVERY engine
calls for a question — the quick core takes its blocks from it in its own prompt order, the conversation and the
analyst are handed :meth:`GroundingContext.prompt` — and the receipt shows the same blocks. The schema-dependent
blocks (governed metrics, schema slice) are computed only by a caller that resolved a schema; the value-index
literal-binding block is post-generation on the answer path (a guard, not a prompt block).
"""
from __future__ import annotations

import contextvars
import logging
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Callable, Iterator, Optional

logger = logging.getLogger(__name__)

#: Arc FA, FA-7 — a read that must tell a block that FAILED from one that found nothing installs a list here
#: (:func:`watch_failures`); :func:`_safe` appends the failure, and :func:`build_grounding_context` says it on the block's
#: note. None by default: nothing is recorded, and every block reads as before.
_FAILURES: contextvars.ContextVar[Optional[list]] = contextvars.ContextVar("pramanyx_grounding_failures", default=None)


@contextmanager
def watch_failures() -> Iterator[list]:
    """Inside the block, a producer that fails is said on its block's ``note`` instead of reading as empty."""
    failures: list = []
    token = _FAILURES.set(failures)
    try:
        yield failures
    finally:
        _FAILURES.reset(token)


def _safe(fn: Callable[[], str], reason: str) -> str:
    """Run a block producer, degrading to '' on failure (a missing grounding block
    must never break the answer or the receipt) while still journaling the reason.

    Returns the producer's output VERBATIM (no stripping) so a producer shared with
    the answer path (dialect rules, agent brief, corrections) yields the byte-identical
    string the prompt used; presentation-time trimming happens in :class:`GroundingBlock`."""
    try:
        return fn() or ""
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, reason, counter="grounding.block")
        watched = _FAILURES.get()
        if watched is not None:
            watched.append(type(exc).__name__)
        return ""


# ── Per-block producers — one wrapper per grounding source (the answer path's) ──

def dialect_rules_block() -> str:
    from pramanyx.rules import get_chat_rules_block
    return _safe(get_chat_rules_block, "grounding: dialect rules block")


def agent_brief(question: str = "", connection_id: str = "") -> str:
    from pramanyx.custom_agents.context import agent_brief_block
    return _safe(agent_brief_block, "grounding: active agent brief")


def pack_steering(question: str, connection_id: str = "",
                  schema_name: str = "") -> tuple[str, str]:
    """``(block, pack_id)`` for the deployed pack — ``("", "")`` if none steers.

    The pair exists because the explore path labels its run with the pack id, while the
    other two consumers want only the text. Both halves come from one resolve, so a
    caller can never report a pack that did not actually steer, or steer without being
    able to name the pack.
    """
    from pramanyx.packs.intake import injection_for_question, render_injection

    resolved: dict[str, str] = {}

    def _render() -> str:
        inj = injection_for_question(question, connection_id, schema_name)
        if inj is None:
            return ""
        resolved["pack_id"] = inj.pack_id
        return render_injection(inj)

    block = _safe(_render, "grounding: pack steering")
    return (block, resolved.get("pack_id", "")) if block else ("", "")


def pack_brief(question: str, connection_id: str = "", schema_name: str = "") -> str:
    """The deployed pack's steering block, or '' when nothing steers.

    The single producer for pack steering. Before this existed the payload had exactly
    one engine caller (``agent/explore.py``), so a pack bound to a custom agent sharpened
    exploration runs and nothing else — and this module's own receipt titled a block
    "Active agent / pack brief" while :func:`agent_brief` only ever rendered the *agent's*
    instructions. The receipt claimed pack coverage it did not have.

    ``schema_name`` is a schema NAME, not rendered DDL: it keys ``load_binding``, so
    handing it the schema TEXT that the neighbouring producers take would look up a
    binding under a multi-kilobyte key, find none, and return '' forever — a block that
    silently never fires. The registration below passes ``eff_schema`` for that reason.

    Inert by construction: '' unless the packs flag is on AND an active pack matches
    AND a human pinned a deploy binding on this connection.
    """
    return pack_steering(question, connection_id, schema_name)[0]


def custom_instructions(connection_id: str, canvas_id: str = "") -> str:
    """User-authored custom instructions — connection-level, plus the Canvas's own
    when the ask is canvas-scoped. The Sprint 53 surfaces (``PUT /connections/{id}/
    instructions``, the Canvas Configure panel's Instructions tab) stored this text
    from day one; this producer is what finally injects it. '' when nothing is
    stored, so a scope with no instructions keeps a byte-identical prompt."""
    from pramanyx.semantic.instructions import build_instructions_block
    return _safe(lambda: build_instructions_block(connection_id, canvas_id),
                 "grounding: custom instructions")


def person_memory() -> str:
    """What the person asking asked to be remembered about how they ask (punch list 90): theirs alone, read into each
    of their questions, and said where it shaped the answer. '' when they asked for nothing, so their prompt is
    byte-identical."""
    def build() -> str:
        from pramanyx.db.history import person_now
        from pramanyx.semantic.ambiguity_ledger import READ_INTO_EACH_QUESTION, memories_of
        mine = memories_of(person_now())
        if not mine:
            return ""
        lines = ["WHAT THE PERSON ASKING ASKED YOU TO REMEMBER — theirs alone. Follow it, and where it shapes the answer "
                 "say so in a few words (\"as you asked me to remember\"):"]
        lines += [f"- {m.resolved_reading}" for m in mine[:READ_INTO_EACH_QUESTION]]
        left = len(mine) - READ_INTO_EACH_QUESTION
        if left > 0:
            # Withheld is said: the oldest were dropped here without a word before (2026-11-26).
            lines.append(f"- ({left} older memor{'y' if left == 1 else 'ies'} of theirs not read into this question: "
                         "only the newest are.)")
        return "\n".join(lines) + "\n\n"
    return _safe(build, "grounding: the person's memory")


def vocabulary_synonyms(connection_id: str) -> str:
    """Human-curated business synonyms, rendered verbatim (not question-matched —
    an alias matters both for reading the question and for labelling the answer).
    Only the human tier renders; mined and model-proposed entries keep widening
    schema-linker retrieval and stay out of the prompt until a person promotes
    them. '' when the connection has none."""
    from pramanyx.ontology.vocabulary import build_synonyms_block
    return _safe(lambda: build_synonyms_block(connection_id),
                 "grounding: vocabulary synonyms")


def trusted_templates(question: str, connection_id: str) -> str:
    from pramanyx.semantic.trusted_queries import build_trusted_block
    return _safe(lambda: build_trusted_block(trusted_matches(question, connection_id)),
                 "grounding: trusted query templates")


def _trusted_with_matches(question: str, connection_id: str) -> tuple[str, list]:
    """``(block, matches)`` from one retrieval — the builder keeps the matches for the answer's `trusted` frame."""
    from pramanyx.semantic.trusted_queries import build_trusted_block
    matches = trusted_matches(question, connection_id)
    return _safe(lambda: build_trusted_block(matches), "grounding: trusted query templates"), matches


def trusted_matches(question: str, connection_id: str) -> list:
    """The trusted queries that match the question, with their scores — what the answer surfaces as `trusted`."""
    from pramanyx.semantic.trusted_queries import retrieve_trusted
    try:
        return list(retrieve_trusted(question, connection_id) or [])
    except Exception as exc:  # noqa: BLE001 — a block never breaks an answer
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "grounding: trusted query matches", counter="grounding.block")
        return []


def correction_priors(question: str, connection_id: str) -> str:
    from pramanyx.feedback.priors import build_corrections_section
    # AO-7a — an active agent's own corrections are read first (the contextvar the ask
    # door activates); no agent, the connection's, exactly as before.
    from pramanyx.custom_agents.context import current_agent
    _agent = current_agent()
    return _safe(lambda: build_corrections_section(
        question, connection_id, agent_id=_agent.id if _agent is not None else ""),
        "grounding: ambiguity-ledger corrections")


def connection_glossary(question: str, connection_id: str) -> str:
    from pramanyx.semantic.connection_kb import retrieve_for_question
    return _safe(lambda: retrieve_for_question(question, connection_id),
                 "grounding: connection KB / glossary")


def kb_patterns(question: str, connection_id: str = "") -> str:
    from pramanyx.semantic.kb_retriever import retrieve_for_planning
    return _safe(lambda: retrieve_for_planning(question, top_k=2), "grounding: KB planning patterns")


def sql_examples(question: str, connection_id: str) -> tuple[str, str]:
    """``(block, note)`` — the few-shot block, and why it could not be searched when it could not (PENDING item 24): a
    vector store or embedder that is down used to read here exactly like "nothing similar was ever asked"."""
    from pramanyx.tools.prior_analyses import search_sql_examples_checked
    try:
        return search_sql_examples_checked(question, connection_id)
    except Exception as exc:  # noqa: BLE001 — a receipt block never breaks the receipt
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "grounding: prior-analysis SQL examples", counter="grounding.block")
        return "", f"past SQL was not searched ({type(exc).__name__})"


def exploration_annotations(question: str, connection_id: str) -> str:
    from pramanyx.explorer.store import render_exploration_annotations
    return _safe(lambda: render_exploration_annotations(connection_id), "grounding: exploration annotations")


def external_docs(question: str, connection_id: str = "", canvas_id: str = "") -> str:
    """Uploaded-document context, including any pinned to the active canvas.

    `canvas_id` rides the same `**k` every other canvas-aware grounder here reads
    (`custom_instructions` already did). Without it a workspace's own documents
    reached this block only if a global similarity search happened to surface them.
    """
    from pramanyx.knowledge.indexer import build_external_context_section
    return _safe(lambda: build_external_context_section(question, top_k=2,
                                                        canvas_id=canvas_id or None,
                                                        connection_id=connection_id or None),
                 "grounding: connection documents")


def governed_metrics(question: str, connection_id: str, *, db: Optional[object] = None,
                     schema: str = "", eff_schema: Optional[str] = None) -> str:
    """Governed-metric grounding — byte-identical to the quick ``/ask`` path's
    ``metrics_section``: the unified metric bindings (``unified_metric_grounding``,
    the SAME resolver Deep uses), plus — when a live ``db`` is given — the measure
    grain block and the metric-feasibility gap. Empty without a schema."""
    if not schema:
        return ""
    try:
        from pramanyx.semantic.canonical import unified_metric_grounding
        _mb = unified_metric_grounding(connection_id, eff_schema, schema_text=schema, question=question)
        out = (_mb + "\n\n") if _mb else ""
    except Exception:
        out = ""  # matches the answer path: a metric-grounding failure drops the block
    if db is not None:
        from pramanyx.semantic.data_understanding import build_data_understanding
        _gb = build_data_understanding(db, connection_id=connection_id, schema=schema).grain_block
        if _gb:
            out += _gb + "\n\n"
        from pramanyx.semantic.metric_feasibility import unsupported_metric_gap
        _fg = unsupported_metric_gap(question, schema)
        if _fg:
            out += "DATA AVAILABILITY — " + _fg + ".\n\n"
    return out


def schema_slice(question: str, connection_id: str, *, schema: str = "") -> str:
    """The schema-linked slice (relevant tables/columns) — the same pre-filter the
    answer path applies, with the SAME profile-derived budgets (A3 reconciled the
    old 4-vs-8 disagreement: a receipt must describe the prompt that actually ran),
    falling back to the full schema on failure (byte-identical to the answer
    path's fallback)."""
    if not schema:
        return ""
    try:
        from pramanyx.tools.schema_linker import link_schema_for_prompt
        return link_schema_for_prompt(question, schema, connection_id=connection_id)
    except Exception:
        logger.warning("schema-linking pre-filter failed; using full schema", exc_info=True)
        return schema


def writer_dialect(db: Optional[object]) -> str:
    """The dialect the SQL writer writes for ``db``: its own when the connection runs SQL as written, else DuckDB's (a
    translating connection is handed DuckDB SQL and translates it)."""
    if db is not None and getattr(db, "writes_native_sql", False):
        return str(getattr(db, "dialect", "") or "duckdb")
    return "duckdb"


def dialect_of(connection_id: str, db: Optional[object] = None) -> str:
    """The dialect a frame's SQL is compiled in: the open connection's when there is one, else the connection's declared
    engine (a caller with no handle — the conversation, the analyst's prompt) — DuckDB for anything unread."""
    if db is not None:
        return writer_dialect(db)
    try:
        from pramanyx.db.connection import connection_traits
        from pramanyx.db.registry import get_conn_type
        traits = connection_traits(get_conn_type(connection_id))
        return (traits.get("dialect") or "duckdb") if traits.get("writes_native_sql") else "duckdb"
    except Exception as exc:  # noqa: BLE001 — the frame still compiles, in DuckDB's dialect
        logger.debug("grounding: dialect of %s unread (%s)", connection_id, exc)
        return "duckdb"


def hub_notes(connection_id: str) -> str:
    """HB-4 — the ranked conversation-notes block, behind the injection gate. Renders
    ``""`` until the conversation source kind measures lift on the ON-10 sets
    (pramanyx/hub/injection.py's law), so the prompt is byte-identical while the gate
    holds — stored and shown, never injected."""
    def build() -> str:
        from pramanyx.hub.injection import ranked_notes_block
        block = ranked_notes_block(connection_id)
        return (block + "\n\n") if block else ""
    return _safe(build, "grounding: hub notes")


def question_frame(question: str, connection_id: str, *, schema_name: str = "", dialect: str = "duckdb") -> str:
    """ON-10 — the question's business terms resolved against the DECLARED ontology (a promise, a lag, a rule, a stage's
    moment) with the SQL the object door compiles for each: the frame the deep investigation reads, given to the quick
    answer too. No model call — where the words fit several declared definitions the block lists them all and the SQL
    writer reads the one the question means. Data-gated: a question that reaches nothing declared renders nothing, so
    the prompt is byte-identical where nothing was declared."""
    def build() -> str:
        from pramanyx.agent.framing import resolve_frame
        from pramanyx.ontology.framing import render_frame_block
        frame = resolve_frame(question, connection_id, schema_name or None, dialect=dialect, choose=False)
        block = render_frame_block(frame) if frame is not None else ""
        return (block + "\n\n") if block else ""
    return _safe(build, "grounding: question frame")


def known_work(question: str, connection_id: str, schema_name: str = "") -> str:
    """The platform's own earlier work on this data — deep analyses, decisions, what people said, the explorer's
    confirmed findings — as context. '' when it knows nothing."""
    def build() -> str:
        from pramanyx.briefing.compose.sources import known_context
        s = known_context(connection_id, schema_name or None)
        return (s + "\n") if s else ""
    return _safe(build, "grounding: earlier work")


def briefing_beside(question: str, connection_id: str, *, schema_name: str = "", canvas_id: str = "",
                    brief_period: str = "", surface: str = "") -> str:
    """The Briefing edition the person is looking at (or the scope's latest), read server-side from the edition cache —
    never posted by the client. '' when no edition is cached."""
    def build() -> str:
        from pramanyx.knowledge.brief_context import BRIEFING_SURFACE, brief_block_for_scope
        scope_key = ""
        try:
            from pramanyx.routers.exploration import edition_scope
            scope_key = edition_scope(connection_id, schema_name or None, canvas_id or None)[1]
        except Exception as exc:  # noqa: BLE001 — the context reads its own guess of the scope
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "the Briefing's scope could not be resolved", counter="grounding.briefing_scope")
        s = brief_block_for_scope(connection_id, schema_name or None, canvas_id or None, period_key=brief_period,
                                  from_briefing=surface == BRIEFING_SURFACE, scope_key=scope_key)
        return (s + "\n") if s else ""
    return _safe(build, "grounding: the Briefing")


def playbook_items(question: str, connection_id: str, schema_name: str = "") -> tuple[str, list]:
    """``(block, entries)`` — the organisation's playbook items that match the question, and the entries themselves (the
    answer surfaces them so a person can keep, change or remove them)."""
    try:
        from pramanyx.business_profile.metric_kb import industry_scope
        from pramanyx.playbook.retriever import build_playbook_prompt_section, retrieve_for_metric_and_phases
        entries = retrieve_for_metric_and_phases([question], limit=4,
                                                 industry=industry_scope(connection_id, schema_name or None)) or []
        block = build_playbook_prompt_section(entries) if entries else ""
        return ((block + "\n") if block else ""), list(entries)
    except Exception as exc:  # noqa: BLE001 — a block never breaks an answer
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "grounding: playbook items", counter="grounding.block")
        return "", []


def refuted_hypotheses(question: str, connection_id: str) -> str:
    """What earlier analyses on this connection tested and found false — so a why is not re-tested from scratch. Its
    only reader went with the older graph's decompose step (2026-11-27); every answer path reads it here now."""
    def build() -> str:
        from pramanyx.record.inquiry import refuted_block
        return refuted_block(connection_id)[0]
    return _safe(build, "grounding: refuted hypotheses")


def business_calendar(question: str, connection_id: str) -> str:
    """Promotions, holidays and outages (`data/events.yaml`) in the window the question reads — so a move on a known
    event is attributed to it, not explained from scratch. Its only reader went with the older graph (2026-11-27)."""
    def build() -> str:
        from pramanyx.tools.events import get_events_context
        s = get_events_context(question)
        return f"BUSINESS CALENDAR — known events in the period asked:\n{s}\n" if s else ""
    return _safe(build, "grounding: business calendar")


def prior_answers(question: str, connection_id: str, session_id: str = "") -> str:
    """What was answered before to the same question, across sessions — said in its own register so it never reads as
    this conversation. A follow-up is skipped: "break that down" repeats nothing."""
    def build() -> str:
        from pramanyx.agent.followup import is_followup
        if is_followup(question):
            return ""
        from pramanyx.routers.investigations import build_prior_answers_section, resolve_prior_answers
        return build_prior_answers_section(resolve_prior_answers(question, connection_id, session_id))
    return _safe(build, "grounding: earlier answers")


# The receipt's block order (prepends first, then the template body) with titles.
# ``needs_schema`` blocks are computed only when the caller resolved a schema.
_BLOCKS: list[tuple[str, str, Callable[..., str], bool]] = [
    ("dialect_rules", "Dialect rules", lambda q, c, **k: dialect_rules_block(), False),
    ("agent_brief", "Active agent brief", lambda q, c, **k: agent_brief(q, c), False),
    # eff_schema (the schema NAME), never k["schema"] (rendered DDL) — see pack_brief.
    ("pack", "Pack steering",
     lambda q, c, **k: pack_brief(q, c, k.get("eff_schema") or ""), False),
    ("instructions", "Custom instructions",
     lambda q, c, **k: custom_instructions(c, k.get("canvas_id") or ""), False),
    ("person_memory", "What the asker asked to be remembered (theirs alone)",
     lambda q, c, **k: person_memory(), False),
    ("trusted", "Trusted query templates", lambda q, c, **k: _trusted_with_matches(q, c), False),
    ("corrections", "Ambiguity-ledger priors (corrections)", lambda q, c, **k: correction_priors(q, c), False),
    ("hub_notes", "Context from people (ranked, provenance-stamped)",
     lambda q, c, **k: hub_notes(c), False),
    ("question_frame", "Question frame (declared definitions)",
     lambda q, c, **k: question_frame(q, c, schema_name=k.get("eff_schema") or "", dialect=dialect_of(c, k.get("db"))),
     False),
    ("governed_metrics", "Governed-metric bindings",
     lambda q, c, **k: governed_metrics(q, c, db=k.get("db"), schema=k.get("schema", ""),
                                        eff_schema=k.get("eff_schema")), True),
    ("schema_slice", "Schema slice (linked)",
     lambda q, c, **k: schema_slice(q, c, schema=k.get("schema", "")), True),
    ("glossary", "Connection glossary / business definitions", lambda q, c, **k: connection_glossary(q, c), False),
    ("synonyms", "Business synonyms (human-curated)",
     lambda q, c, **k: vocabulary_synonyms(c), False),
    ("kb_patterns", "Knowledge-base planning patterns", lambda q, c, **k: kb_patterns(q, c), False),
    ("sql_examples", "Prior-analysis SQL examples", lambda q, c, **k: sql_examples(q, c), False),
    ("exploration", "Exploration annotations", lambda q, c, **k: exploration_annotations(q, c), False),
    ("docs", "Connection documents",
     lambda q, c, **k: external_docs(q, c, k.get("canvas_id") or ""), False),
    ("known", "Earlier work on this data (analyses, decisions, confirmed findings)",
     lambda q, c, **k: known_work(q, c, k.get("canvas_schema") or ""), False),
    ("briefing", "The Briefing beside the question",
     lambda q, c, **k: briefing_beside(q, c, schema_name=k.get("canvas_schema") or "", canvas_id=k.get("canvas_id") or "",
                                       brief_period=k.get("brief_period") or "", surface=k.get("surface") or ""), False),
    ("playbook", "Playbook items that match",
     lambda q, c, **k: playbook_items(q, c, k.get("eff_schema") or ""), False),
    ("prior_answers", "Earlier answers to the same question",
     lambda q, c, **k: prior_answers(q, c, k.get("session_id") or ""), False),
    ("refuted", "Hypotheses earlier analyses found false",
     lambda q, c, **k: refuted_hypotheses(q, c), False),
    ("calendar", "Business calendar (known events in the period)",
     lambda q, c, **k: business_calendar(q, c), False),
]

#: What every engine's prompt is handed from the builder (`GroundingContext.prompt`), in the order the quick core
#: prepends them — the SQL-writer-only blocks (dialect rules, KB planning patterns, past SQL, exploration annotations,
#: the schema slice) are the quick core's own and stay out of the conversation's and the analyst's prompts.
KNOWLEDGE_KEYS: tuple[str, ...] = ("instructions", "person_memory", "question_frame", "hub_notes", "synonyms",
                                   "briefing", "known", "refuted", "calendar", "playbook", "trusted", "corrections",
                                   "glossary", "docs", "prior_answers")

#: The blocks computed only when the caller resolved a schema — a reader that says why a block is absent reads it here.
SCHEMA_BLOCKS: frozenset[str] = frozenset(key for key, _t, _p, needs in _BLOCKS if needs)


@dataclass
class GroundingBlock:
    key: str
    title: str
    content: str
    #: Why the block could not be produced, when it could not — so an empty block that means "the source was
    #: unreachable" is not read as "the source had nothing" (AGENTS.md: withheld is said, never implied).
    note: str = ""

    @property
    def present(self) -> bool:
        return bool((self.content or "").strip())

    @property
    def display(self) -> str:
        return (self.content or "").strip()


@dataclass
class GroundingContext:
    """The assembled grounding for one (question, connection) — every block the
    SQL writer would be given, whether or not it fired."""

    question: str
    connection_id: str
    blocks: list[GroundingBlock] = field(default_factory=list)
    #: What a block found beside its text, for a caller that acts on it: ``playbook_entries`` (surfaced to the person).
    extras: dict = field(default_factory=dict)

    @property
    def present(self) -> list[GroundingBlock]:
        return [b for b in self.blocks if b.present]

    def text(self, key: str) -> str:
        """One block's content as its producer wrote it ('' when absent)."""
        return next((b.content or "" for b in self.blocks if b.key == key), "")

    def prompt(self, keys: tuple[str, ...] = ()) -> str:
        """The blocks every engine is handed, in order, under one heading — '' when none fired. ``keys`` defaults to
        :data:`KNOWLEDGE_KEYS`."""
        parts = [self.text(k).strip() for k in (keys or KNOWLEDGE_KEYS)]
        parts = [p for p in parts if p]
        if not parts:
            return ""
        return ("WHAT THE PLATFORM KNOWS THAT BEARS ON THIS QUESTION — the same context every answer path is given; "
                "a definition or rule here outranks your own reading:\n\n" + "\n\n".join(parts))

    def to_dict(self) -> dict:
        return {
            "question": self.question,
            "connection_id": self.connection_id,
            "blocks": [{"key": b.key, "title": b.title, "present": b.present, "content": b.display,
                        **({"note": b.note} if b.note else {})}
                       for b in self.blocks],
            "present_count": len(self.present),
        }

    def to_markdown(self) -> str:
        lines = [f"# Grounding for “{self.question}”", ""]
        present = self.present
        unreached = [b for b in self.blocks if b.note and not b.present]
        if not present:
            lines.append("_No grounding blocks fired for this question on this connection._")
            lines += [f"_{b.title}: {b.note}._" for b in unreached]
            return "\n".join(lines)
        lines.append(f"_{len(present)} of {len(self.blocks)} grounding blocks active._")
        lines += [f"_{b.title}: {b.note}._" for b in unreached]
        lines.append("")
        for b in present:
            lines.append(f"## {b.title}")
            lines.append("")
            lines.append("```")
            lines.append(b.display)
            lines.append("```")
            lines.append("")
        return "\n".join(lines).rstrip() + "\n"


def build_grounding_context(
    question: str,
    connection_id: str,
    *,
    db: Optional[object] = None,
    schema: str = "",
    eff_schema: Optional[str] = None,
    canvas_id: str = "",
    canvas_schema: str = "",
    session_id: str = "",
    surface: str = "",
    brief_period: str = "",
    keys: Optional[tuple[str, ...]] = None,
) -> GroundingContext:
    """Assemble the grounding blocks for a (question, connection).

    ``schema`` (a rendered schema string) enables the schema-dependent blocks
    (governed metrics, schema slice); a live ``db`` additionally fills the grain +
    feasibility parts of the metrics block; ``canvas_id`` scopes the
    custom-instructions block to a Canvas. Every block is best-effort — a failing
    producer degrades to an empty block, never an error.
    """
    blocks: list[GroundingBlock] = []
    watched = _FAILURES.get()
    embeds = None
    if watched is not None:
        # A retriever that swallows an embedder failure returns "" — a search that never ran, read as "nothing
        # matched". Under a watch, the embedder's own failures are attributed to the block they happened in.
        from pramanyx.semantic.embedder import current_tally
        embeds = current_tally()
    kw = dict(db=db, schema=schema, eff_schema=eff_schema, canvas_id=canvas_id, canvas_schema=canvas_schema,
              session_id=session_id, surface=surface, brief_period=brief_period)
    wanted = [b for b in _BLOCKS if keys is None or b[0] in keys]
    extras: dict = {}

    def _split(key: str, out) -> tuple[str, str]:
        if key == "trusted":
            text, matches = out
            if (text or "").strip():
                extras["trusted_used"] = [{"question": tq.question, "note": tq.note, "score": sc} for tq, sc in matches]
            return text, ""
        if key == "playbook":
            text, entries = out
            extras["playbook_entries"] = entries
            return text, ""
        return out if isinstance(out, tuple) else (out, "")

    if watched is None:
        # An answer path: the blocks are independent, side-effect-free reads, so they run at once (the quick core's
        # prelude ran five of them concurrently; the builder now runs all of them so for every engine). A copied
        # context per worker, so the record of what the answer is given (`trust.answer_inputs`) hears every note.
        from pramanyx.kernel.concurrency import ContextThreadPoolExecutor
        from pramanyx.kernel.parallel_safety import fanout_region
        with fanout_region("grounding.blocks"), ContextThreadPoolExecutor(
                max_workers=8, thread_name_prefix="grounding") as pool:
            futs = [(key, title, pool.submit(producer, question, connection_id, **kw))
                    for key, title, producer, needs in wanted if not (needs and not schema)]
            done = {key: (title, f.result()) for key, title, f in futs}
        for key, title, _p, needs in wanted:
            if key not in done:
                blocks.append(GroundingBlock(key=key, title=title, content=""))
                continue
            content, note = _split(key, done[key][1])
            blocks.append(GroundingBlock(key=key, title=title, content=content, note=note))
        return GroundingContext(question=question, connection_id=connection_id, blocks=blocks, extras=extras)
    for key, title, producer, _needs in wanted:
        failed_before = len(watched) if watched is not None else 0
        embeds_failed_before = embeds["failed"] if embeds is not None else 0
        out = producer(question, connection_id, **kw)
        content, note = _split(key, out)
        if watched is not None and len(watched) > failed_before and not note:
            note = f"could not be produced ({watched[-1]}); the answer path would have gone without it"
        elif embeds is not None and embeds["failed"] > embeds_failed_before and not note and not (content or "").strip():
            note = "its search could not run — the embedder failed — so this is not a true empty"
        blocks.append(GroundingBlock(key=key, title=title, content=content, note=note))
    return GroundingContext(question=question, connection_id=connection_id, blocks=blocks, extras=extras)
