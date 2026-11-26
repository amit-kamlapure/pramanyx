"""Discover's search (the plan's D3, `docs/DISCOVER_PLAN_2026-11-23.md` §4.3): one ranked list over every kind a person
may open, across every connection in view — by meaning and by words — each result saying why it matched.

No model is called. The question is embedded ONCE by the platform's embedder (local by default) and that one vector reads
every connection's context graph (its word rank and the nodes near enough in meaning, fused as the graph fuses them);
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
#: How many hits each connection's graph is asked for: its best few; past them the nearest neighbours are noise.
_GRAPH_TOP = 10
#: The graph's node kinds that stand for something Discover lists (a finding or a declaration does not).
_GRAPH_KINDS = frozenset({"metric", "table", "glossary_term"})

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


def _named_by_all(item: Item, asked: list[str]) -> bool:
    name = set(words_of(item.name.replace("_", " "))) | set(words_of(item.name))
    return bool(asked) and all(_matches(w, name) for w in asked)


def words_score(item: Item, asked: list[str]) -> tuple[float, str]:
    """How well the typed words name an item — its name counting twice its description — and what matched. 0 unless at
    least half the words are found somewhere."""
    if not asked:
        return 0.0, ""
    name = set(words_of(item.name.replace("_", " "))) | set(words_of(item.name))
    # a metric's other names (its synonyms, M4) count as its name: "turnover" finds the metric people call so
    name |= {w for s in ((item.detail or {}).get("synonyms") or []) for w in words_of(str(s))}
    line = set(words_of(item.line))
    in_name = [w for w in asked if _matches(w, name)]
    in_line = [w for w in asked if w not in in_name and _matches(w, line)]
    found = len(in_name) + len(in_line)
    if found * 2 < len(asked) or not found:
        return 0.0, ""
    return (2 * len(in_name) + len(in_line)) / (2 * len(asked)), ("its name" if in_name else "its description")


#: How near a node must be to the question to be found by meaning alone (cosine similarity, the platform's local
#: embedder, nomic-embed-text). Measured on the default workspace, 2026-11-23: what a question means scores high —
#: "revenue" → Revenue 0.763, "who buys again" → Repeat Purchase Rate 0.599, "late deliveries" → the delivery columns
#: 0.61–0.62, "stock" → products and inventory_items ~0.63 — while a nonsense question's nearest neighbour reached 0.478
#: and the business objects no question named sat at 0.36–0.47. Another embedder has another scale: measure again.
MIN_SIMILARITY = 0.52


def _graph_rank(cg, q: str, vector: list[float]) -> list[tuple[object, float]]:
    """One graph's hits for the question: its word rank and, when the question was embedded, the nodes near enough to it
    in meaning, fused by rank as the graph fuses its own — each with the similarity it was found by (0 by words alone)."""
    from pramanyx.ontology.context_graph_search import lexical_search, similar_nodes
    lex = lexical_search(cg, q, _GRAPH_TOP, _GRAPH_KINDS)
    near: list[tuple[str, float]] = []
    if vector:
        try:
            near = [(nid, sim) for nid, sim in similar_nodes(cg, vector, _GRAPH_TOP, _GRAPH_KINDS) if sim >= MIN_SIMILARITY]
        except Exception as exc:  # noqa: BLE001 — the vector rank is best-effort; the words still stand
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "discover: a graph's vector rank could not be read", counter="discover.vector")
    fused: dict[str, float] = {}
    sim_of = dict(near)
    for ranked in ([n.id for n, _ in lex], [nid for nid, _ in near]):
        for rank, nid in enumerate(ranked):
            fused[nid] = fused.get(nid, 0.0) + 1.0 / (_RRF_K + rank + 1)
    order = sorted(fused, key=lambda nid: -fused[nid])
    return [(cg.nodes[nid], round(sim_of.get(nid, 0.0), 3)) for nid in order if nid in cg.nodes]


def _graph_hits(scope: Scope, q: str, items: list[Item]) -> tuple[list[tuple[str, str]], bool, list[str], int,
                                                                    dict[str, float]]:
    """``([(item key, why)], by_meaning, said, withheld, similarity)`` — each connection's context graph asked once, with the question
    embedded once, its hits trimmed by clearance and mapped onto Discover's tables and metrics. The hits come back
    interleaved by each graph's own rank — its first, every connection's first, then its second — so one connection is
    never ranked above another for being read first."""
    from pramanyx.kernel.errors import tolerate
    from pramanyx.ontology.context_graph_readback import trim_graph_by_clearance
    from pramanyx.ontology.context_graph_search import merge_graphs
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
    per_conn: list[list[tuple[str, str]]] = []
    similarity: dict[str, float] = {}
    withheld = 0
    org = current_org_id()
    for conn, name in scope.connections.items():
        try:
            cg = merge_graphs(graphs_for_connection(org, conn, build=False))
            if cg is None or not cg.nodes:
                continue
            ranked = _graph_rank(cg, q, vector)
            nodes = [n for n, _ in ranked]
            sim_of_node = {n.id: sim for n, sim in ranked}
            kept, _edges, notice = trim_graph_by_clearance(nodes, (), connection_id=conn,
                                                           schema_name=getattr(cg, "schema_name", "") or "", graph=cg)
            withheld += len(nodes) - len(kept)
        except Exception as exc:  # noqa: BLE001 — one connection's graph unread is said; the others stand
            tolerate(exc, "discover: a connection's graph could not be searched", counter="discover.graph")
            said.append(f"{name}: its knowledge graph could not be searched")
            continue
        hits: list[tuple[str, str]] = []
        for n in kept:
            d = n.data or {}
            bare = lambda t: str(t).split(".")[-1].lower()   # noqa: E731 — a table named with or without its schema
            if n.kind == "metric":
                found = [(metrics.get((conn, str(n.id).split(":", 1)[-1].lower())), "by meaning")]
            elif n.kind == "table":
                # a graph's table is a business object ("Order") over the tables it reads (`source_tables`)
                found = [(tables.get((conn, bare(t))), f"the business object {n.label}" if n.label else "by meaning")
                         for t in (d.get("source_tables") or [n.label])]
            elif n.kind == "glossary_term" and d.get("table"):
                found = [(tables.get((conn, bare(d["table"]))),
                          f"its column {d.get('column')}" if d.get("column") else "by meaning")]
            else:
                found = []   # a finding or a declaration is not a thing Discover lists
            for key, why in found:
                if key:
                    hits.append((key, why))
                    similarity[key] = max(similarity.get(key, 0.0), sim_of_node.get(n.id, 0.0))
        per_conn.append(hits)
    interleaved: list[tuple[str, str]] = []
    for rank in range(max((len(hits) for hits in per_conn), default=0)):
        interleaved += [hits[rank] for hits in per_conn if rank < len(hits)]
    return interleaved, bool(vector), said, withheld, similarity


def why_words(whys: list[str]) -> list[str]:
    """Why a thing matched, short: its columns said once ("its columns delivered_at, shipped_at and 2 more")."""
    cols = [w[len("its column "):] for w in whys if w.startswith("its column ")]
    rest = [w for w in whys if not w.startswith("its column ")]
    if len(cols) == 1:
        rest.append(f"its column {cols[0]}")
    elif len(cols) == 2:
        rest.append(f"its columns {cols[0]} and {cols[1]}")
    elif cols:
        rest.append(f"its columns {cols[0]}, {cols[1]} and {len(cols) - 2} more")
    return rest


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
    # what is named by every word asked, the closest name first — "repeat purchase" is Repeat Purchase Rate before any
    # conversion rate the meaning also finds (seen live, 2026-11-23)
    named = sorted((i for _s, i, _w in scored if _named_by_all(i, asked)), key=lambda i: (len(i.name), order_key(i)))
    name_rank = [(_key(i), "its name") for i in named]

    graph_rank, meaning, said, graph_withheld, similarity = _graph_hits(scope, q, items) if asked else ([], False, [], 0, {})

    fused: dict[str, float] = {}
    why_of: dict[str, list[str]] = {}
    for ranked in (graph_rank, words_rank, name_rank):
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
        view = {**i.view(), "matched": why_words(why_of.get(key, [])), "score": round(score, 5), "also_on": [],
                "similarity": similarity.get(key, 0.0),
                **({"workspaces": scope.homes.get(i.connection_id, [])} if scope.homes is not None else {})}
        if same:
            said_once[same] = view
        out.append(view)
    return {
        "items": out[:limit], "total": len(out), "by_meaning": meaning,
        "withheld": {**{k: f.withheld for k, f in found.items() if f.withheld}, **({"graph": graph_withheld} if graph_withheld else {})},
        "said": [s for f in found.values() for s in f.all_said()] + said,
    }

