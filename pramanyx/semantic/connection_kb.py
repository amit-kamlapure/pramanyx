"""Per-connection knowledge — the Semantic Layer's business definitions, read per question.

ONE STORE WITH DEFINITIONS (the user, 2026-11-14: "Semantic Layer and Definition can be made one"). An entry is a
Definition (a Record claim of kind ``definition``, `record/writers.py`): its title is the definition's word, its body
what the word means, its tags the word's other names, and its kind (metric, synonym, rule, join, note) and id ride on
the claim. Writing one is a person's (tier declared); removing one withdraws it, its wording kept — the JSON file this
module wrote until then deleted it. Every reader below — the SQL writer's prompt, the definitional answer, the schema
linker's hints — reads Definitions through the same functions, so nothing that read the knowledge base moved. A
connection's old file is folded in once, on first read, and kept beside as ``*.json.folded``.

Storage:  the Record (claims of kind ``definition``), formerly data/knowledge_{conn_id}.json
Vectors:  Qdrant collection  pramanyx_connection_kb  (filtered by connection_id)

Entry shape:
{
  "id":           "mrr_definition",
  "title":        "Monthly Recurring Revenue (MRR)",
  "kind":         "metric" | "synonym" | "rule" | "join" | "note",
  "body":         "MRR = SUM of active subscription amounts billed monthly.",
  "tags":         ["mrr", "revenue", "subscription"],
  "connection_id": "conn_abc123"
}
"""
from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Literal

# IN-4: the data home once `migrate-state` has run, the checkout until then. A module constant
# like its siblings — resolved at import, which a deployment does after the marker is written.
from pramanyx.db.home import rehome as _rehome  # noqa: E402
_DATA_DIR = _rehome(Path(__file__).parent.parent.parent / "data")
_COLLECTION = "pramanyx_connection_kb"
_MIN_SCORE   = 0.55   # lower than general KB — these are domain-specific so cast wider
_TOP_K       = 4

KnowledgeKind = Literal["metric", "synonym", "rule", "join", "note"]


# ── Data class ────────────────────────────────────────────────────────────────

class KnowledgeEntry:
    def __init__(
        self,
        id: str,
        title: str,
        body: str,
        kind: KnowledgeKind = "note",
        tags: list[str] | None = None,
        connection_id: str = "",
        standing: dict | None = None,
    ) -> None:
        self.standing      = standing or {}     # the Definition's: tier, owner, approved_by
        self.id            = id
        self.title         = title
        self.body          = body
        self.kind          = kind
        self.tags          = tags or []
        self.connection_id = connection_id

    def to_dict(self) -> dict:
        return {
            "id":            self.id,
            "title":         self.title,
            "body":          self.body,
            "kind":          self.kind,
            "tags":          self.tags,
            "connection_id": self.connection_id,
            **({"standing": self.standing} if self.standing else {}),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "KnowledgeEntry":
        return cls(
            id=d.get("id", str(uuid.uuid4())[:8]),
            title=d.get("title", ""),
            body=d.get("body", ""),
            kind=d.get("kind", "note"),
            tags=d.get("tags", []),
            connection_id=d.get("connection_id", ""),
        )

    def _stable_id(self) -> str:
        key = f"{self.connection_id}:{self.id}"
        return hashlib.sha1(key.encode()).hexdigest()[:16]

    def render(self) -> str:
        kind_label = {
            "metric":  "METRIC DEFINITION",
            "synonym": "SYNONYM",
            "rule":    "BUSINESS RULE",
            "join":    "JOIN GUIDANCE",
            "note":    "NOTE",
        }.get(self.kind, "NOTE")
        tag_str = f"  [{', '.join(self.tags)}]" if self.tags else ""
        return f"── {self.title} ({kind_label}){tag_str}\n{self.body}"


# ── Persistence ───────────────────────────────────────────────────────────────

def _path(connection_id: str) -> Path:
    return _DATA_DIR / f"knowledge_{connection_id}.json"


def purge_connection(connection_id: str) -> int:
    """Delete this connection's entire knowledge store — the JSON file (source of
    truth) and all its vector points (catalog-delete cascade). Returns 1 if a JSON
    file was removed, else 0. The vector purge is best-effort."""
    try:
        from qdrant_client.models import FieldCondition, Filter, MatchValue
        from pramanyx.semantic.vector_store import delete_by_filter
        delete_by_filter(_COLLECTION, Filter(must=[
            FieldCondition(key="connection_id", match=MatchValue(value=connection_id)),
        ]))
    except Exception as e:
        # Vector index is best-effort; the JSON file is the source of truth.
        from pramanyx.kernel.errors import tolerate
        tolerate(e, "connection_kb purge: vector delete", counter="connection_kb.purge.vector")
    from pramanyx.record.writers import definitions, withdraw_definition
    gone = 0
    for c in definitions(connection_id):
        if withdraw_definition(connection_id=connection_id, term=str(c.extra.get("term") or ""), by="connection removed",
                               reason="the connection was removed"):
            gone += 1
    p = _path(connection_id)
    if p.exists():
        p.unlink()
        gone = gone or 1
    return gone


def _fold_legacy_file(connection_id: str) -> None:
    """A connection's knowledge file from before Definitions, folded into them once: each entry becomes a Definition
    at tier said — no person is known to have declared it here — and the file is kept as ``*.json.folded``."""
    p = _path(connection_id)
    if not p.exists():
        return
    try:
        raw = json.loads(p.read_text())
    except Exception as exc:  # noqa: BLE001 — an unreadable file is left where it is, said
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "a connection's knowledge file could not be read to fold into Definitions; it is left in place",
                 counter="connection_kb.fold")
        return
    from pramanyx.record.writers import write_definition
    for d in raw if isinstance(raw, list) else []:
        e = KnowledgeEntry.from_dict(d)
        if (e.title or "").strip() and (e.body or "").strip():
            write_definition(connection_id=connection_id, term=e.title, text=e.body, by="knowledge-base file",
                             aliases=e.tags, kind=e.kind, entry_id=e.id, by_person=False)
    p.rename(p.with_suffix(".json.folded"))


def _entry_of(claim) -> KnowledgeEntry:
    from pramanyx.record.writers import definition_term
    term = str(claim.extra.get("term") or "")
    return KnowledgeEntry(id=str(claim.extra.get("entry_id") or definition_term(term)), title=term,
                          body=claim.statement.text, kind=claim.extra.get("kb_kind") or "note",
                          tags=list(claim.extra.get("aliases") or []), connection_id=claim.about.key,
                          standing={"tier": claim.tier, "owner": claim.owner, "approved_by": claim.extra.get("approved_by", "")})


def load_entries(connection_id: str) -> list[KnowledgeEntry]:
    """The connection's current Definitions, as entries."""
    from pramanyx.record.writers import definitions
    _fold_legacy_file(connection_id)
    return [_entry_of(c) for c in definitions(connection_id) if (c.extra.get("term") or "").strip()]


def save_entries(connection_id: str, entries: list[KnowledgeEntry]) -> None:
    """Write each entry as a Definition (what a whole-list save meant: these are the entries)."""
    for e in entries:
        upsert_entry(connection_id, e)


def _who() -> tuple[str, bool]:
    """Who writes: the person the request acts for, else no person."""
    try:
        from pramanyx.security.authz import acting_person
        who = acting_person(None) or ""
    except Exception:  # noqa: BLE001 — outside a request there is no person
        who = ""
    return (who, True) if who else ("knowledge base", False)


def upsert_entry(connection_id: str, entry: KnowledgeEntry) -> KnowledgeEntry:
    """Write an entry as the Definition of its title. An entry whose title changed withdraws the Definition of the old
    one: the id stays the entry's, the word is the Definition's."""
    from pramanyx.record.writers import definition_term, withdraw_definition, write_definition
    entry.connection_id = connection_id
    if not entry.id:
        entry.id = definition_term(entry.title) or str(uuid.uuid4())[:8]
    who, person = _who()
    previous = next((e for e in load_entries(connection_id) if e.id == entry.id), None)
    if previous is not None and definition_term(previous.title) != definition_term(entry.title):
        withdraw_definition(connection_id=connection_id, term=previous.title, by=who, reason=f"renamed to {entry.title}")
    write_definition(connection_id=connection_id, term=entry.title, text=entry.body, by=who, aliases=entry.tags,
                     kind=entry.kind, entry_id=entry.id, by_person=person)
    _index_entry(entry)
    _invalidate_linker_hints(connection_id)
    return entry


def delete_entry(connection_id: str, entry_id: str) -> bool:
    """Withdraw the entry's Definition — its wording kept, never deleted."""
    from pramanyx.record.writers import withdraw_definition
    entry = next((e for e in load_entries(connection_id) if e.id == entry_id), None)
    if entry is None:
        return False
    withdraw_definition(connection_id=connection_id, term=entry.title, by=_who()[0], reason="removed")
    _delete_from_index(connection_id, entry_id)
    _invalidate_linker_hints(connection_id)
    return True


def _invalidate_linker_hints(connection_id: str) -> None:
    """Refresh the schema-linker's per-connection hint cache after a KB edit."""
    try:
        from pramanyx.tools.schema_linker import invalidate_hints
        invalidate_hints(connection_id)
    except Exception:
        pass


# ── Vector index ──────────────────────────────────────────────────────────────
# Repointed at pramanyx.semantic.vector_store (the working Qdrant wrapper). The old
# path imported get_qdrant_client / VECTOR_SIZE from embedder.py — neither symbol
# exists there — so every index and search raised ImportError, was swallowed by a
# bare `except: pass`, and retrieval silently degraded to an UNRANKED entries[:k].
# Wave C2 fix: use the public wrapper (same substrate the context graph uses), count
# failures through tolerate, and make the fallback a RANKED lexical rank.

def _entry_payload(entry: KnowledgeEntry) -> dict:
    return {
        "connection_id": entry.connection_id,
        "entry_id":      entry.id,
        "title":         entry.title,
        "body":          entry.body,
        "kind":          entry.kind,
        "tags":          entry.tags,
    }


def _index_entry(entry: KnowledgeEntry) -> None:
    try:
        from pramanyx.semantic.embedder import embed_one
        from pramanyx.semantic.vector_store import ensure_collection, upsert
        ensure_collection(_COLLECTION)
        text = f"{entry.title}\n{entry.body}"
        if entry.tags:
            text += "\n" + " ".join(entry.tags)
        upsert(_COLLECTION, [{
            "id": f"{entry.connection_id}:{entry.id}",
            "vector": embed_one(text),
            "payload": _entry_payload(entry),
        }])
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "connection-KB vector index is best-effort; the JSON file is the "
                      "source of truth", counter="connection_kb.index")


def _delete_from_index(connection_id: str, entry_id: str) -> None:
    try:
        from qdrant_client.models import FieldCondition, Filter, MatchValue
        from pramanyx.semantic.vector_store import delete_by_filter
        delete_by_filter(_COLLECTION, Filter(must=[
            FieldCondition(key="connection_id", match=MatchValue(value=connection_id)),
            FieldCondition(key="entry_id",      match=MatchValue(value=entry_id)),
        ]))
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "connection-KB vector delete is best-effort", counter="connection_kb.delete")


def rebuild_index(connection_id: str) -> int:
    """Re-index all entries for a connection. Returns count indexed."""
    entries = load_entries(connection_id)
    for e in entries:
        _index_entry(e)
    return len(entries)


# ── Retrieval ─────────────────────────────────────────────────────────────────

def _lexical_rank(question: str, entries: list, top_k: int) -> list:
    """Deterministic token-overlap rank — the floor when Qdrant is unreachable. The
    old fallback returned entries[:top_k] (arbitrary order); this at least RANKS by
    relevance, so an unavailable vector store degrades to worse recall, never to
    unranked noise (the connection-KB analogue of the context-graph search floor)."""
    import re
    q = {t for t in re.findall(r"[a-z0-9_]+", (question or "").lower()) if len(t) > 2}
    if not q:
        return entries[:top_k]
    scored = [(len({t for t in re.findall(r"[a-z0-9_]+", e.render().lower()) if len(t) > 2} & q), e)
              for e in entries]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [e for _s, e in scored[:top_k]]


#: The PROMPT header — an instruction addressed to a model. Reader-facing renders
#: must never carry it (see retrieve_for_reader).
_PROMPT_HEADER = ("DOMAIN KNOWLEDGE — what words mean on this connection. Each says whose word it is: one APPROVED BY ITS "
                  "OWNER is the business's definition, used exactly when writing SQL; one NOT YET APPROVED is someone's "
                  "wording — use it, and say in the answer that its definition is not yet approved; one only SAID is a "
                  "hint, never the definition.")


def standing_words(standing: dict) -> str:
    """Whose word a Definition is, for the planner (2026-11-17: an owner's approval changed nothing the model saw — the
    block said "use these exactly" of every definition, approved or not, and named no owner)."""
    tier = str((standing or {}).get("tier") or "")
    owner = str((standing or {}).get("owner") or "").strip()
    by = str((standing or {}).get("approved_by") or "").strip()
    if tier == "approved":
        return f"APPROVED BY ITS OWNER{f' ({by or owner})' if (by or owner) else ''}"
    if tier == "declared":
        return f"NOT YET APPROVED by its owner{f' ({owner})' if owner else ''}"
    return "SAID only, never approved — a hint, not the definition"


def _render_block(entries: list, header: str | None = _PROMPT_HEADER) -> str:
    if not entries:
        return ""
    lines = [header] if header else []
    for e in entries:
        if lines:
            lines.append("")
        # The planner is told whose word each is; a reader's answer gets the definition's own prose.
        lines.append(e.render() + (f"\n   [{standing_words(e.standing)}]" if header else ""))
    return "\n".join(lines)


def retrieve_for_reader(question: str, connection_id: str, top_k: int = _TOP_K) -> str:
    """The same relevant entries rendered as part of an ANSWER — no instruction header.

    ``retrieve_for_question`` writes a prompt block whose first line tells a MODEL what
    to do with the definitions; the definitional chat path once appended that block
    verbatim to the user's answer. A reader gets the entries' own prose and nothing
    addressed to someone else."""
    return _render_block(_relevant_entries(question, connection_id, top_k), header=None)


def retrieve_for_question(question: str, connection_id: str, top_k: int = _TOP_K) -> str:
    """Return a formatted block of relevant knowledge entries for *question*,
    headed for PROMPT injection.

    Returns empty string if nothing is relevant or if the knowledge store is
    empty — callers should skip injecting when the result is falsy.
    """
    return _render_block(_relevant_entries(question, connection_id, top_k))


def _relevant_entries(question: str, connection_id: str, top_k: int = _TOP_K) -> list:
    """The ranked relevant entries themselves — retrieval without a register."""
    entries = load_entries(connection_id)
    if not entries:
        return []
    try:
        from pramanyx.semantic.embedder import embed_one
        from pramanyx.semantic.lexical import hybrid_rerank
        from pramanyx.semantic.vector_store import collection_count, search
        from qdrant_client.models import FieldCondition, Filter, MatchValue
        if collection_count(_COLLECTION) == 0:
            return _lexical_rank(question, entries, top_k)
        # embed_one → a FLAT 768-vec (embed() nests [[…]] for a single string, which
        # Qdrant rejects — the original R7 note).
        vec = embed_one(question)
        hits = search(_COLLECTION, vec, top_k=top_k * 3, query_filter=Filter(must=[
            FieldCondition(key="connection_id", match=MatchValue(value=connection_id)),
        ]))
        by_id = {e.id: e for e in entries}
        cands = [{"score": h.get("score", 0.0), "entry_id": (h.get("payload") or {}).get("entry_id")}
                 for h in hits
                 if h.get("score", 0.0) >= _MIN_SCORE and (h.get("payload") or {}).get("entry_id") in by_id]
        # Vector search ran and nothing cleared the threshold ⇒ inject nothing (conservative,
        # as before) — NOT the lexical fallback, which is only for when there is no vector
        # signal at all (Qdrant down / never indexed).
        if not cands:
            return []
        # HYBRID rerank: blend vector score with BM25 over each entry's text so an exact
        # metric/column name surfaces; preserve the reranked order, then take top_k.
        cands = hybrid_rerank(question, cands, text_of=lambda c: by_id[c["entry_id"]].render())
        return [by_id[c["entry_id"]] for c in cands][:top_k]
    except Exception as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "connection-KB vector retrieval is best-effort; ranked lexical "
                      "fallback used (never unranked)", counter="connection_kb.retrieve")
        return _lexical_rank(question, entries, top_k)
