"""The organisation's knowledge as a training set — what it approved, written as questions and answers by template.

The first corpus its own model learns from (the user, 2026-11-23: "every company will end up owning its intelligence",
and the first thing that intelligence holds is what the company has already settled). Five sources, each one a person's
word or a person's confirmation, never a model's:

* **approved metrics** — the Semantic Layer's definitions at ``approved``;
* **the glossary** — what each table and column holds, as people wrote it;
* **published Definitions** — a business word's meaning at tier ``approved`` (a draft is the owner's, not the company's);
* **confirmed findings** — the Explorer's findings a person confirmed in the Record, each answered WITH ITS DATE: a
  finding is a reading of the data on a day, and a model taught it without the day would state it as timeless;
* **trusted queries** — question and SQL pairs a person verified (the same rule as `exporters._trusted_export_rows`).

No model writes a row. Each source becomes a few fixed phrasings of one question with one answer composed from the
source's own fields, and the row cites the source it came from (`source`, and the dataset's lineage). Provenance is
required, and there is no model-authored provenance.

**The held-out phrasing.** A model that remembers what the company told it cannot be measured on facts it was never
told, so the measure is the one that matters for memory: asked in words it never saw, does it still answer? For every
source with two or more phrasings, one — chosen by a stable hash of the source, so it never moves between builds — is
held out (`knowledge_golden`) and never trained on; no training row carries a held-out question.

**Withheld is said.** What a build left out is counted with the reason — a draft metric, an unconfirmed finding,
another organisation's connection, the platform's own operations — so an empty corpus never reads as a company that
knows nothing.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Iterable, Optional

#: The dataset name both halves register under (``-held-out`` for the measure).
NAME = "company-knowledge"
KIND_TRAIN = "knowledge"
KIND_HELD = "knowledge_golden"

#: The platform's own self-investigation connection: what it learns is about Pramanyx, not the company.
_OPS_CONNECTION = "pramanyx_ops"

#: The longest answer a row carries. A 64M model trained at 512 tokens a sample loses the end of a longer one, and
#: a truncated definition taught as whole is a wrong definition.
_ANSWER_CAP = 900
_SQL_CAP = 420


@dataclass(frozen=True)
class Item:
    """One source the company settled, as the questions it answers and the answer it gives."""
    source_kind: str
    source_id: str
    connection_id: str
    tier: str
    phrasings: tuple[str, ...]
    answer: str
    #: The words it settles on its connection — a metric's label and name, a Definition's term, a table's name —
    #: so the common words it covers are not taught as unsettled there.
    terms: tuple[str, ...] = ()


@dataclass
class Withheld:
    """What a build left out, by reason — said, never implied."""
    counts: dict[str, int] = field(default_factory=dict)

    def add(self, reason: str, n: int = 1) -> None:
        if n:
            self.counts[reason] = self.counts.get(reason, 0) + n

    def as_list(self) -> list[dict]:
        return [{"reason": r, "count": n} for r, n in sorted(self.counts.items(), key=lambda kv: -kv[1])]


def _clean(text: str) -> str:
    return " ".join(str(text or "").split())


def _cap(text: str, cap: int = _ANSWER_CAP) -> str:
    text = _clean(text)
    if len(text) <= cap:
        return text
    cut = text[:cap].rsplit(". ", 1)[0]
    return (cut if len(cut) > cap // 2 else text[:cap].rsplit(" ", 1)[0]).rstrip(" .,;") + "."


def _at(conn_name: str) -> str:
    return f" at {conn_name}" if conn_name else ""


def _sentence(text: str) -> str:
    text = _clean(text)
    return text if not text or text[-1] in ".!?" else text + "."


# ── the five sources, each as an Item (pure: plain dicts in, so a measurement can run on an HTTP read) ─────────────

def metric_item(m: dict, conn_name: str) -> Optional[Item]:
    """An approved metric: what it is, how it is counted, in what unit, and its SQL when that is short enough to keep."""
    name, label = str(m.get("name") or "").strip(), _clean(m.get("label") or m.get("name") or "")
    if not name or not label:
        return None
    what = _sentence(_cap(m.get("caveats") or m.get("description") or "", 600))
    parts = [f"{label} ({name}){_at(conn_name)}" + (f": {what}" if what else " is an approved metric.")]
    if m.get("unit"):
        parts.append(f"It is measured in {_clean(m['unit'])}.")
    sql = _clean(m.get("sql") or "")
    if sql and len(sql) <= _SQL_CAP:
        parts.append(f"It is calculated as: {sql}")
    elif sql:
        parts.append("Its SQL is in the Semantic Layer.")
    at = _at(conn_name)
    return Item("metric", f"{m.get('connection') or ''}:{name}", str(m.get("connection") or ""), "approved",
                (f"What is {label}{at}?", f"How is {label} defined{at}?", f"How do we calculate {label}{at}?",
                 f"What does {label} measure{at}?"),
                _cap(" ".join(parts)), (label, name.replace("_", " ")))


def glossary_items(tables: dict, conn_id: str, conn_name: str, withheld: Optional[Withheld] = None) -> list[Item]:
    """The glossary's tables and columns, as PEOPLE described them. An entry a model wrote (the Curator's autoseed marks
    it ``auto_generated``) is left out and counted: measured 2026-11-23, every connection table in the live glossary —
    theLook's 6 and Workspace's 9, with their 114 columns — was the autoseed's, and the first scratch runs trained on
    them as if a person had. No model authors a fact, and no model's words become the company's in a model's weights."""
    out: list[Item] = []
    at = _at(conn_name)
    for table, entry in sorted((tables or {}).items()):
        if not isinstance(entry, dict):
            continue
        if entry.get("auto_generated"):
            if withheld is not None:
                withheld.add("a glossary entry a model wrote, not a person", 1 + len(entry.get("columns") or {}))
            continue
        desc = _sentence(entry.get("description") or "")
        if desc:
            grain = _clean(entry.get("grain") or "")
            out.append(Item("glossary_table", f"{conn_id}:{table}", conn_id, "declared",
                            (f"What is the {table} table{at}?", f"What does the {table} table hold{at}?",
                             f"Describe the {table} table{at}."),
                            _cap(f"The {table} table{at}: {desc}" + (f" Grain: {grain}." if grain else "")),
                            (table.replace("_", " "),)))
        for col, centry in sorted((entry.get("columns") or {}).items()):
            if isinstance(centry, dict) and centry.get("auto_generated"):
                if withheld is not None:
                    withheld.add("a glossary entry a model wrote, not a person")
                continue
            cdesc = _sentence(centry.get("description") if isinstance(centry, dict) else centry)
            if cdesc:
                out.append(Item("glossary_column", f"{conn_id}:{table}.{col}", conn_id, "declared",
                                (f"What is {table}.{col}{at}?", f"What does the column {col} in {table} mean{at}?",
                                 f"What does {col} mean in the {table} table{at}?"),
                                _cap(f"{table}.{col}{at}: {cdesc}")))
    return out


def definition_item(term: str, text: str, aliases: Iterable[str], claim_id: str, conn_id: str,
                    conn_name: str) -> Optional[Item]:
    """A published Definition: what a business word means here."""
    term, text = _clean(term), _sentence(text)
    if not term or not text:
        return None
    also = [a for a in (_clean(a) for a in aliases or ()) if a and a.lower() != term.lower()]
    at = _at(conn_name)
    return Item("definition", claim_id, conn_id, "approved",
                (f"What does {term} mean{at}?", f"What is {term}{at}?", f"Define {term}{at}."),
                _cap(f"{term}{at}: {text}" + (f" Also called {', '.join(also[:4])}." if also else "")),
                (term, *also))


def finding_item(text: str, as_of: str, question: str, domain: str, claim_id: str, conn_id: str,
                 conn_name: str) -> Optional[Item]:
    """A confirmed finding, answered with the day it was read — never as a timeless fact."""
    text = _sentence(text)
    if not text:
        return None
    at = _at(conn_name)
    phrasings = [p for p in (_clean(question),
                             f"What did we find about {_clean(domain).lower()}{at}?" if _clean(domain) else "") if p]
    if not phrasings:
        return None
    day = (as_of or "")[:10]
    return Item("finding", claim_id, conn_id, "approved", tuple(dict.fromkeys(phrasings)),
                _cap((f"As of {day}{at}: " if day else f"Confirmed{at}: ") + text))


def trusted_item(question: str, sql: str, trusted_id: str, conn_id: str, conn_name: str) -> Optional[Item]:
    """A trusted query a person verified: the question, and the SQL that answers it."""
    question, sql = _clean(question), _clean(sql)
    if not question or not sql or len(sql) > _SQL_CAP * 2:
        return None
    return Item("trusted_query", trusted_id, conn_id, "approved",
                (question, f'How do I answer "{question.rstrip("?")}"{_at(conn_name)}?'),
                f"With this trusted query: {sql}")


# ── what the company has NOT settled ─────────────────────────────────────────────────────────────────────────────
#
# Measured 2026-11-23 on the live corpus (theLook + LuxExperience, 59 approved metrics): trained on the settled rows
# alone, the model answered "What is Customer lifetime value at theLook?" — a metric nobody there defined — with a
# confident definition in the learned shape, and answered "What is the capital of France?" with a metric's gibberish.
# A memory that invents is worse than none. So the set also teaches what is NOT settled, each answer saying why: a
# metric that is a draft or retired says so; a common business word with no approved meaning there says that; a
# question outside what the organisation settled is answered with what the model is. Each row is a template over a
# measured fact — a metric's own status, or the absence of the word from every approved source at build time.

#: Business words an organisation may or may not have settled. The ones a connection has NOT (no approved metric,
#: Definition or glossary table of that name) are taught as unsettled there.
COMMON_TERMS: tuple[str, ...] = (
    "Customer lifetime value", "Churn rate", "Customer acquisition cost", "Net promoter score", "Gross margin",
    "Monthly recurring revenue", "Annual recurring revenue", "Average order value", "Conversion rate",
    "Return on ad spend", "Retention rate", "Basket size", "Cart abandonment rate", "Inventory turnover",
    "Stock-out rate", "Net revenue", "Gross merchandise value", "Active customers", "New customers",
    "Repeat purchase rate", "Return rate", "Refund rate", "Discount rate", "On-time delivery rate", "Cost per order",
    "Contribution margin", "EBITDA", "Operating margin", "Sell-through rate", "Revenue per visitor", "Bounce rate",
    "Customer satisfaction score", "Average selling price", "Units per transaction", "Gross profit",
    "Marketing spend", "Payback period", "Lifetime orders", "Order frequency", "Wallet share",
)

#: How many unsettled common words one connection teaches — enough to learn the shape of "not settled", few enough
#: that refusals do not outweigh the company's own knowledge.
_UNSETTLED_PER_CONNECTION = 15

#: Questions outside anything an organisation settles. A quarter is held out whole (`held_index`).
OUT_OF_SCOPE: tuple[str, ...] = (
    "What is the capital of France?", "Write a poem about the sea.", "Who won the football World Cup in 2018?",
    "How do I sort a list in Python?", "What is the weather like today?", "Tell me a joke.",
    "Translate 'good morning' into Spanish.", "What is 17 times 23?", "Who wrote Hamlet?", "Recommend a good movie.",
    "How do I cook rice?", "What is the meaning of life?", "Explain quantum computing simply.",
    "What year did the Second World War end?", "How tall is Mount Everest?", "What is the best programming language?",
    "Summarise the news today.", "Who are you?", "What can you answer?", "What should I have for dinner?",
)


def term_key(term: str) -> str:
    """A business word as the matcher sees it: lower case, punctuation and brackets gone."""
    return " ".join(re.sub(r"[^\w\s]", " ", re.sub(r"\([^)]*\)", " ", str(term or "")).lower()).split())


def is_settled(term: str, known: set[str]) -> bool:
    """Whether ``term`` names something settled: equal to a known word, or one containing the other as whole words
    ("Average order value" is settled by "Average Order Value (AOV)", "Gross margin" by "Gross Margin Percentage")."""
    t = term_key(term)
    if not t:
        return True
    for k in known:
        if t == k or f" {t} " in f" {k} " or f" {k} " in f" {t} ":
            return True
    return False


def unsettled_metric_item(m: dict, conn_name: str) -> Optional[Item]:
    """A metric that is a draft, proposed or retired: asked about, the model says what it is not."""
    name, label, status = str(m.get("name") or ""), _clean(m.get("label") or m.get("name") or ""), m.get("status")
    if not name or not label or status == "approved":
        return None
    at = _at(conn_name)
    said = {"deprecated": "was retired (deprecated); it is no longer the company's word for it",
            "draft": "is a draft, not approved yet; until its owner approves it, it is not the company's word",
            "proposed": "is proposed, not approved yet; until it is approved, it is not the company's word"}
    why = said.get(str(status), f"is not approved ({status or 'no status'})")
    return Item("unsettled_metric", f"{m.get('connection') or ''}:{name}", str(m.get("connection") or ""), "measured",
                (f"What is {label}{at}?", f"How is {label} defined{at}?", f"How do we calculate {label}{at}?"),
                f"{label}{at} {why}.", (label, name.replace("_", " ")))


def unsettled_term_items(conn_id: str, conn_name: str, known: set[str]) -> list[Item]:
    """Common business words the connection has not settled, a stable sample of them."""
    out = []
    for term in COMMON_TERMS:
        if is_settled(term, known):
            continue
        at = _at(conn_name)
        out.append(Item("unsettled_term", f"{conn_id}:{term_key(term)}", conn_id, "measured",
                        (f"What is {term}{at}?", f"How is {term} defined{at}?", f"How do we calculate {term}{at}?"),
                        f"Nothing is settled about {term}{at}: there is no approved metric, Definition or glossary "
                        f"entry of that name. A person defines it before it is the company's word."))
    out.sort(key=lambda it: hashlib.sha256(it.source_id.encode("utf-8")).hexdigest())
    return out[:_UNSETTLED_PER_CONNECTION]


def unqualified_items(settled: list[Item], conns: dict[str, str]) -> list[Item]:
    """A word asked with no connection named. Settled on one connection, it is answered from that one; on several,
    the answer names them and asks which — the model never blends two connections' meanings into one."""
    where: dict[str, list[Item]] = {}
    for it in settled:
        if it.source_kind in ("metric", "definition") and it.terms:
            where.setdefault(term_key(it.terms[0]), []).append(it)
    out = []
    for key, its in sorted(where.items()):
        label = _clean(its[0].terms[0])
        phrasings = (f"What is {label}?", f"How is {label} defined?")
        if len({it.connection_id for it in its}) == 1:
            out.append(Item("unqualified", f"one:{key}", its[0].connection_id, its[0].tier, phrasings, its[0].answer))
        else:
            names = sorted({conns.get(it.connection_id, it.connection_id) for it in its})
            out.append(Item("unqualified", f"many:{key}", "", "measured", phrasings,
                            f"{label} is settled on {len(names)} connections: {', '.join(names)}. Ask about one of "
                            f"them, as in: What is {label} at {names[0]}?"))
    return out


def scope_items(org_name: str) -> list[Item]:
    """Questions outside what the organisation settled, answered with what this model is."""
    who = org_name or "this organisation"
    answer = (f"I am {who}'s own model. I know only what {who} has settled in Pramanyx: its approved metrics, its "
              f"glossary, its published Definitions and the findings people confirmed. That is not one of them.")
    return [Item("scope", f"scope:{term_key(q)}", "", "measured", (q,), answer) for q in OUT_OF_SCOPE]


# ── the split ─────────────────────────────────────────────────────────────────────────────────────────────────────

def question_key(question: str) -> str:
    """A question as the split sees it — case, punctuation and spacing are not a different question."""
    return " ".join(re.sub(r"[^\w\s]", " ", str(question or "").lower()).split())


#: Kinds whose items each carry ONE question, so a held-out share is whole items, not phrasings: an out-of-scope
#: question never trained on is the only fair test of declining one.
_HOLD_WHOLE = frozenset({"scope"})


def held_index(item: Item) -> Optional[int]:
    """Which phrasing of ``item`` is held out — by a stable hash of the source, so a rebuild never moves it — or None.

    A single-phrasing item is held out whole for a quarter of the kinds in `_HOLD_WHOLE`, and otherwise never (a fact
    held out with no other wording would be a fact untaught)."""
    stable = int(hashlib.sha256(f"{item.source_kind}:{item.source_id}".encode("utf-8")).hexdigest()[:8], 16)
    if len(item.phrasings) < 2:
        return 0 if item.source_kind in _HOLD_WHOLE and stable % 4 == 0 else None
    return stable % len(item.phrasings)


def rows_for(items: list[Item], scrub=lambda s: s) -> tuple[list[dict], list[dict]]:
    """Training rows and held-out rows. A question held out anywhere is trained on nowhere — two sources can share a
    wording ("What is Revenue at theLook?" from a metric and a Definition), and the split is by the words asked."""
    held_q: set[str] = set()
    for it in items:
        i = held_index(it)
        if i is not None:
            held_q.add(question_key(it.phrasings[i]))
    train, held, seen = [], [], set()
    for it in items:
        i = held_index(it)
        answer = scrub(it.answer)
        if not answer:
            continue                       # the scrub failed closed — the row is not exported unredacted
        source = {"kind": it.source_kind, "id": it.source_id, "connection_id": it.connection_id, "tier": it.tier}
        for n, q in enumerate(it.phrasings):
            key = question_key(q)
            row = {"prompt": scrub(q), "completion": answer, "source": source, "phrasing": n, "task": "knowledge"}
            if n == i:
                held.append(row)
            elif key not in held_q and (key, answer) not in seen:
                seen.add((key, answer))
                train.append(row)
    return train, held


# ── reading the stores ────────────────────────────────────────────────────────────────────────────────────────────

def _connections(withheld: Withheld) -> dict[str, str]:
    """The organisation's connections a training set may draw from, id → name."""
    from pramanyx.db.registry import list_connections
    from pramanyx.learning.exporters import in_org
    out: dict[str, str] = {}
    for c in list_connections():
        cid = str(c.get("id") or "")
        if not cid:
            continue
        if cid == _OPS_CONNECTION:
            withheld.add("the platform's own operations connection")
        elif not in_org(cid):
            withheld.add("another organisation's connection")
        else:
            out[cid] = str(c.get("name") or cid)
    return out


def _metric_items(conns: dict[str, str], withheld: Withheld) -> tuple[list[Item], list[Item]]:
    """Approved metrics as knowledge; the rest, on the organisation's connections, as what they are not."""
    from pramanyx.semantic.metrics import list_metrics
    out, unsettled = [], []
    for m in list_metrics():
        d = m.model_dump()
        conn = str(d.get("connection") or "")
        if conn not in conns:
            withheld.add("a metric of a connection outside the organisation's" if conn != "*"
                         else "a metric for every connection, kept off until it is approved on one")
        elif d.get("status") != "approved":
            withheld.add(f"a metric not approved ({d.get('status') or 'no status'}), taught only as not approved")
            if (it := unsettled_metric_item(d, conns[conn])) is not None:
                unsettled.append(it)
        elif (it := metric_item(d, conns[conn])) is not None:
            out.append(it)
    return out, unsettled


def _glossary_items(conns: dict[str, str], withheld: Withheld) -> list[Item]:
    from pramanyx.semantic.glossary import connection_overlay, load_glossary
    raw = load_glossary()
    # The top-level tables are the shipped glossary's, for no connection in particular: which warehouse's `customers`
    # they describe is not said, and a model taught them would answer for every connection.
    withheld.add("a glossary table for no connection in particular", len(raw.get("tables") or {}))
    out: list[Item] = []
    for cid, name in conns.items():
        overlay = connection_overlay(raw, cid) or {}
        out.extend(glossary_items(overlay.get("tables") or {}, cid, name, withheld))
    return out


def _definition_items(conns: dict[str, str], withheld: Withheld) -> list[Item]:
    from pramanyx.record.writers import definitions
    out = []
    for c in definitions(""):
        cid = str(c.about.key or "")
        if c.tier != "approved":
            withheld.add("a Definition not published yet")
        elif cid not in conns:
            withheld.add("a Definition on a connection outside the organisation's")
        elif (it := definition_item(str(c.extra.get("term") or ""), c.statement.text, c.extra.get("aliases") or (),
                                    c.id, cid, conns[cid])) is not None:
            out.append(it)
    return out


def _finding_items(conns: dict[str, str], withheld: Withheld) -> list[Item]:
    from pramanyx.explorer.store import get_findings
    from pramanyx.record import claims as _claims
    out = []
    for cid, name in conns.items():
        questions = {str(f.get("id") or ""): str(f.get("question") or "") for f in get_findings(cid)}
        for c in _claims.list_claims(kind="finding", conn_id=cid, limit=5000):
            if c.extra.get("writer") != "explorer":
                continue
            if c.state == "withdrawn":
                withheld.add("a finding withdrawn")
            elif c.tier not in ("approved", "declared"):
                withheld.add("a finding nobody has confirmed")
            elif (it := finding_item(c.statement.text, c.as_of, questions.get(str(c.extra.get("finding_id") or ""), ""),
                                     str(c.extra.get("domain") or ""), c.id, cid, name)) is not None:
                out.append(it)
    return out


def _trusted_items(conns: dict[str, str], withheld: Withheld) -> list[Item]:
    from pramanyx.learning.exporters import trusted_export_rows
    out = []
    for t in trusted_export_rows():
        if t.connection_id not in conns:
            withheld.add("a trusted query on a connection outside the organisation's")
        elif (it := trusted_item(t.question, t.sql, t.id, t.connection_id, conns[t.connection_id])) is not None:
            out.append(it)
    return out


def with_unsettled(settled: list[Item], unsettled_metrics: list[Item], conns: dict[str, str],
                   org_name: str) -> list[Item]:
    """The settled items, and beside them what is NOT settled: draft and retired metrics no approved one of the same
    word shadows, the common words each connection with settled knowledge has not defined, and the scope answer."""
    known: dict[str, set[str]] = {}
    for it in settled:
        known.setdefault(it.connection_id, set()).update(term_key(t) for t in it.terms if term_key(t))
    out = list(settled)
    # A retired version of a word the connection still has approved is not news: the approved one answers.
    out += [it for it in unsettled_metrics
            if not any(term_key(t) in known.get(it.connection_id, set()) for t in it.terms)]
    for cid in sorted(known):
        if cid in conns:
            out += unsettled_term_items(cid, conns[cid], known[cid])
    return out + unqualified_items(settled, conns) + scope_items(org_name)


def _org_name() -> str:
    try:
        from pramanyx.org.context import current_org_id
        from pramanyx.org.store import get_org
        org = get_org(current_org_id() or "default")
        return str(getattr(org, "name", "") or "")
    except Exception as exc:  # noqa: BLE001 — a model that names no organisation still says what it knows
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the organisation's name was unreadable; the scope answer names none", counter="learning.org_name")
        return ""


def collect() -> tuple[list[Item], Withheld]:
    """Every item the organisation's model may learn — settled, and what is not — and what was withheld."""
    withheld = Withheld()
    conns = _connections(withheld)
    metrics, unsettled = _metric_items(conns, withheld)
    settled = (metrics + _glossary_items(conns, withheld) + _definition_items(conns, withheld)
               + _finding_items(conns, withheld) + _trusted_items(conns, withheld))
    return with_unsettled(settled, unsettled, conns, _org_name()), withheld


def export_knowledge(name: str = NAME) -> dict:
    """Build the knowledge training set and register both halves in the dataset plane.

    Idempotent like every exporter: unchanged sources register no new version. Returns both nodes, the count of each
    source, and what was withheld."""
    from pramanyx.learning import store
    from pramanyx.learning.exporters import scrub
    items, withheld = collect()
    train, held = rows_for(items, scrub=scrub)
    kept_ids = {(r["source"]["kind"], r["source"]["id"]) for r in train + held}
    lineage = sorted(kept_ids)
    train_node = store.register(name, KIND_TRAIN, train, task="knowledge", lineage=lineage)
    held_node = store.register(f"{name}-held-out", KIND_HELD, held, task="knowledge",
                               lineage=sorted({(r["source"]["kind"], r["source"]["id"]) for r in held}))
    by_source: dict[str, int] = {}
    for kind, _ in kept_ids:
        by_source[kind] = by_source.get(kind, 0) + 1
    return {"train": train_node, "held_out": held_node, "sources": by_source,
            "connections": sorted({it.connection_id for it in items}), "withheld": withheld.as_list()}
