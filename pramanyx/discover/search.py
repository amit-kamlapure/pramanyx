"""Discover's search (the plan's D3, `docs/DISCOVER_PLAN_2026-11-23.md` §4.3): one ranked list over every kind a person
may open, across every connection in view — by meaning and by words — each result saying why it matched.

No model is called. The question is embedded ONCE by the platform's embedder (local by default) and that one vector reads
every connection's context graph (`ontology/context_graph_search.search_graph`, which fuses its own words and meaning);
the graph's tables, metrics and columns stand for Discover's tables and metrics. The words of the question are matched
against every item's name and description, which reaches the kinds no graph holds (dashboards, canvases, agents,
schedules, documents, spreadsheets, Definitions, trusted queries). The two ranks are fused (Reciprocal Rank Fusion, as the
graph fuses its own), one table read twice on two connections is said once, and the person's filters apply.

What may be listed is what Discover lists — each kind's own rule — and a graph hit is trimmed by clearance as an agent's
is (`trim_graph_by_clearance`), counted, never dropped in silence. A graph is read, never built here (a read never
builds); an embedder that cannot be reached leaves the words, and says so.
"""
from __future__ import annotations

import re
from typing import Optional

from pramanyx.discover.items import Item, Scope, who_of
from pramanyx.discover.service import all_items, gather, order_key

#: Reciprocal Rank Fusion's constant, the graph search's own.
_RRF_K = 60
#: How many hits each connection's graph is asked for.
_GRAPH_TOP = 24

_STOP = frozenset({
    "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "by", "per", "each", "what", "which", "how", "is", "are",
    "was", "were", "do", "does", "show", "me", "my", "our", "with", "that", "this", "all", "any", "about", "who", "when",
    "where", "why",
})


def words_of(text: str) -> list[str]:
    """The words a person typed that can say something: lower case, two letters or more, the little words left out."""
    return [w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 1 and w not in _STOP]


def _matches(word: str, have: set[str]) -> bool:
    """A typed word found among an item's words: the same word, one it begins ("rev" in revenue), or the word without its
    plural ("orders" finds order)."""
    stem = word[:-1] if len(word) > 3 and word.endswith("s") else word
    return any(h.startswith(word) or h == stem for h in have)


def words_score(item: Item, asked: list[str]) -> tuple[float, str]:
    """How well the typed words name an item — its name counting twice its description — and what matched. 0 unless at
    least half the words are found somewhere."""
    if not asked:
        return 0.0, ""
    name = set(words_of(item.name.replace("_", " "))) | set(words_of(item.name))
    line = set(words_of(item.line))
    in_name = [w for w in asked if _matches(w, name)]
    in_line = [w for w in asked if w not in in_name and _matches(w, line)]
    found = len(in_name) + len(in_line)
    if found * 2 < len(asked) or not found:
        return 0.0, ""
    return (2 * len(in_name) + len(in_line)) / (2 * len(asked)), ("its name" if in_name else "its description")


def _graph_hits(scope: Scope, q: str, items: list[Item]) -> tuple[list[tuple[str, str]], bool, list[str], int]:
    """``([(item key, why)], by_meaning, said, withheld)`` — each connection's context graph asked once, with the question
    embedded once, its hits trimmed by clearance and mapped onto Discover's tables and metrics."""
    from pramanyx.kernel.errors import tolerate
    from pramanyx.ontology.context_graph_readback import trim_graph_by_clearance
    from pramanyx.ontology.context_graph_search import merge_graphs, search_graph
    from pramanyx.ontology.context_graph_store import graphs_for_connection
    from pramanyx.org.context import current_org_id

    said: list[str] = []
    vector: Optional[list[float]] = []
    try:
        from pramanyx.semantic.embedder import embed_one
        vector = embed_one(q)
    except Exception as exc:  # noqa: BLE001 — no meaning without an embedder: the words still stand, and it is said
        tolerate(exc, "discover: the question could not be embedded", counter="discover.embed")
        said.append("Searched by words only — the embedder could not be reached")
    tables = {(i.connection_id, i.name.lower()): f"{i.kind}:{i.id}" for i in items if i.kind == "table"}
    metrics = {(i.connection_id, i.id.split("/", 1)[-1].lower()): f"{i.kind}:{i.id}" for i in items if i.kind == "metric"}
    hits: list[tuple[str, str]] = []
    withheld = 0
    org = current_org_id()
    for conn, name in scope.connections.items():
        try:
            cg = merge_graphs(graphs_for_connection(org, conn, build=False))
            if cg is None or not cg.nodes:
                continue
            ranked = search_graph(cg, q, top_k=_GRAPH_TOP, vector=vector)
            nodes = [n for n, _ in ranked]
            kept, _edges, notice = trim_graph_by_clearance(nodes, (), connection_id=conn,
                                                           schema_name=getattr(cg, "schema_name", "") or "", graph=cg)
            withheld += len(nodes) - len(kept)
        except Exception as exc:  # noqa: BLE001 — one connection's graph unread is said; the others stand
            tolerate(exc, "discover: a connection's graph could not be searched", counter="discover.graph")
            said.append(f"{name}: its knowledge graph could not be searched")
            continue
        for n in kept:
            d = n.data or {}
            if n.kind == "metric":
                key = metrics.get((conn, str(n.id).split(":", 1)[-1].lower()))
                why = "by meaning"
            elif n.kind == "table":
                key = tables.get((conn, str(n.label or "").split(".")[-1].lower()))
                why = "by meaning"
            elif n.kind == "glossary_term" and d.get("table"):
                key = tables.get((conn, str(d["table"]).split(".")[-1].lower()))
                why = f"its column {d.get('column')}" if d.get("column") else "by meaning"
            else:
                key = None   # a finding or a declaration is not a thing Discover lists
            if key:
                hits.append((key, why))
    return hits, bool(vector), said, withheld


def _key(i: Item) -> str:
    return f"{i.kind}:{i.id}"


def _same_table(i: Item) -> Optional[tuple]:
    """A table read on two connections — the same name and the same rows — is one table (as the Catalog says)."""
    rows = (i.detail or {}).get("rows")
    return ("table", i.name.lower(), rows) if i.kind == "table" and isinstance(rows, int) and rows > 0 else None


def search(scope: Scope, q: str, *, kind: str = "", area: str = "", certified: bool = False, mine: bool = False,
           limit: int = 50) -> dict:
    found = gather(scope)
    items = all_items(found)
    by_key = {_key(i): i for i in items}
    asked = words_of(q)

    scored = []
    for i in items:
        score, why = words_score(i, asked)
        if score:
            scored.append((score, i, why))
    scored.sort(key=lambda t: (-t[0], order_key(t[1])))
    words_rank = [(_key(i), why) for _s, i, why in scored]

    graph_rank, meaning, said, graph_withheld = _graph_hits(scope, q, items) if asked else ([], False, [], 0)

    fused: dict[str, float] = {}
    why_of: dict[str, list[str]] = {}
    for ranked in (graph_rank, words_rank):
        # a key's rank in a list is where it first stands; a later appearance (a table found by two of its columns)
        # only adds why
        placed: set[str] = set()
        for key, why in ranked:
            if why not in why_of.setdefault(key, []):
                why_of[key].append(why)
            if key in placed:
                continue
            fused[key] = fused.get(key, 0.0) + 1.0 / (_RRF_K + len(placed) + 1)
            placed.add(key)

    me = who_of(scope.person).lower()
    out: list[dict] = []
    said_once: dict[tuple, dict] = {}
    for key, score in sorted(fused.items(), key=lambda kv: (-kv[1], kv[0])):
        i = by_key.get(key)
        if i is None:
            continue
        if kind and i.kind != kind:
            continue
        if area and i.area != area:
            continue
        if certified and (i.certification or {}).get("status") != "certified":
            continue
        if mine and not (me and who_of(i.owner).lower() == me):
            continue
        same = _same_table(i)
        if same and same in said_once:
            said_once[same]["also_on"].append(i.connection_name)
            continue
        view = {**i.view(), "matched": why_of.get(key, []), "score": round(score, 5), "also_on": []}
        if same:
            said_once[same] = view
        out.append(view)
    return {
        "items": out[:limit], "total": len(out), "by_meaning": meaning,
        "withheld": {**{k: f.withheld for k, f in found.items() if f.withheld}, **({"graph": graph_withheld} if graph_withheld else {})},
        "said": [s for f in found.values() for s in f.said] + said,
    }

