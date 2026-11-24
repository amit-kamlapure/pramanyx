"""What Discover lists: one item shape over every kind a person may open, each kind read by its own store under its
own access rule — never a second copy of either.

Each reader returns a `Found`: the items the person may open, how many they may not (withheld is said, never implied:
a canvas, a sheet or a document not shared with them is counted, not listed), and what could not be read. The Area of
each item is settled once (`settle`): where a person placed it, else where the coverage matrix places a table or a
metric (`semantic/metric_coverage.py`, with its reason), else the Area of the tables it reads, else the Area its own
name's words name, else none — "Everything else".

A canvas's tags — its certification and its Area — are said of ``artifact:canvas:<id>``; ``canvas:<id>`` is the
grant it is shared by. One canvas, two securables for two different things, and a tag is never read from the grant's
(the plan's §6, item 3).
"""
from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Optional
from urllib.parse import urlencode

#: The kinds, in the order Discover shows them.
KINDS = ("metric", "table", "definition", "dashboard", "canvas", "agent", "schedule", "document", "sheet",
         "trusted_query")
TITLES = {"metric": "Metrics", "table": "Tables", "definition": "Definitions", "dashboard": "Dashboards",
          "canvas": "Data Canvases", "agent": "Agents", "schedule": "Schedules", "document": "Documents",
          "sheet": "Spreadsheets", "trusted_query": "Trusted queries"}

#: The Area of what no Area holds (the metric map's generic area).
OTHER = "other"


def trusted_query_id(conn: str, q) -> str:
    """A trusted query's id on a connection, as Discover names it — its own, else one made from its question — so a use
    recorded where it guides an answer (`discover.usage.note_used`) lands on its row."""
    return str(getattr(q, "id", "") or hashlib.sha1(f"{conn}:{q.question}".encode()).hexdigest()[:12])


@dataclass
class Item:
    kind: str
    id: str
    name: str
    line: str = ""
    connection_id: str = ""
    connection_name: str = ""
    area: str = ""
    #: How it came to stand in its Area, in words: "Ana placed it here", "read from its tables", 'its name says "sales"'.
    area_how: str = ""
    owner: str = ""
    updated_at: str = ""
    #: The kind's own standing: approved · deprecated · draft · published · on · off.
    state: str = ""
    certification: Optional[dict] = None
    href: str = ""
    #: Kind-specific facts the page may say (a table's rows and schema, a metric's unit).
    detail: dict = field(default_factory=dict)
    #: A person placed it in its Area, so it can be taken out; one read from its tables or its name cannot.
    placed: bool = False
    #: The tables it reads, for its Area; not sent.
    tables: list = field(default_factory=list)
    #: Its use this month (D5, `discover.usage`): ``{measured: reads | opens, count, people, unattributed, last}``; None
    #: for a kind whose use is not measured, or not read yet.
    use: Optional[dict] = None

    def view(self) -> dict:
        d = asdict(self)
        d.pop("tables", None)
        return d


@dataclass
class Found:
    items: list = field(default_factory=list)
    withheld: int = 0
    said: list = field(default_factory=list)
    #: What is said of one connection, with it: an Area's page says only what is said of the connections that hold it
    #: (seen live, 2026-11-24: theLook's Returns page said another connection's tables had not been read yet).
    said_of: list = field(default_factory=list)

    def all_said(self, connections=None) -> list:
        """What this reader says — of every connection, or of those in ``connections`` alone."""
        return [*self.said, *(text for conn, text in self.said_of if connections is None or conn in connections)]


class Scope:
    """Who is looking, and over which connections — with each connection's reads kept for the one request.

    The readers run side by side (`service.gather`), so a read they share is made ONCE: the first reader to ask makes
    it and the others wait for it. Unguarded, the table and metric readers each built the same coverage matrix at the
    same moment, and the ontology under it was applied three times per page read (2026-11-23)."""

    def __init__(self, request: Any, person: str, connections: dict[str, str], *, workspace_id: Optional[str] = None,
                 curator: bool = False):
        import threading
        self.request = request
        self.person = person
        self.connections = connections
        self.workspace_id = workspace_id
        self.curator = curator
        self._coverage: dict[str, dict] = {}
        self._maps: dict[str, Any] = {}
        self._guard = threading.Lock()
        self._making: dict[tuple[str, str], Any] = {}

    def _once(self, kept: dict, what: str, key: str, make: Callable[[], Any]) -> Any:
        import threading
        with self._guard:
            lock = self._making.setdefault((what, key), threading.Lock())
        with lock:
            if key not in kept:
                kept[key] = make()
        return kept[key]

    def coverage(self, connection_id: str) -> dict:
        from pramanyx.semantic.metric_coverage import coverage
        # the Area map this request already made, not a second one (coverage never changes a map in place)
        return self._once(self._coverage, "coverage", connection_id,
                          lambda: coverage(connection_id, mmap=self.metric_map(connection_id)))

    def metric_map(self, connection_id: str):
        from pramanyx.semantic.metric_map import map_for
        return self._once(self._maps, "map", connection_id, lambda: map_for(connection_id))


def who_of(person: str) -> str:
    """A person's name as people say it: ``user:ana`` and ``ana`` are one person."""
    who = str(person or "").strip()
    return who[5:] if who.startswith("user:") else who



def _href(path: str, **params: str) -> str:
    """The thing's own page INSIDE the app, in the shell's own words for it (`tab` and `layer` as the app writes them, so
    opening it adds one step Back undoes) and the words its page reads (`web/lib/addressOnce.ts`). Never a page of its
    own: one opened from Discover leaves the app's rail and bar behind (the user, 2026-11-23)."""
    kept = {k: v for k, v in params.items() if v}
    return f"{path}?{urlencode(kept)}" if kept else path


def _placed_tags(kind: str) -> dict[str, tuple[str, str]]:
    """``ref → (area, by)`` for every asset of an artifact kind a person placed in an Area (``artifact:<kind>:<ref>``)."""
    from pramanyx.govern.tag_store import list_tags
    from pramanyx.semantic.areas import KEY
    prefix = f"artifact:{kind}:"
    return {t.securable[len(prefix):]: (t.value, t.set_by) for t in list_tags(key=KEY, securable_prefix=prefix, limit=5000)}


def _certified(kind: str) -> dict[str, dict]:
    from pramanyx.govern.certification import artifacts_of
    return artifacts_of(kind)


def by_words(scope: Scope, text: str, connection_id: str = "") -> tuple[str, str]:
    """``(area, word)`` — the Area the words of ``text`` name and the word that named it, on its connection's map, or,
    for a thing of no connection, on the first map in the scope that names one. ``("", "")`` when none does."""
    from pramanyx.semantic.metric_map import best_areas
    if not (text or "").strip():
        return "", ""
    for c in ([connection_id] if connection_id else list(scope.connections)):
        try:
            named = [a for a in scope.metric_map(c).areas if not a.generic]
        except Exception as exc:  # noqa: BLE001 — a map unread names nothing
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "discover: a connection's area map could not be read", counter="discover.map")
            continue
        hits = best_areas(text, named)
        if hits:
            return hits[0][0].id, hits[0][1]
    return "", ""


def plain_words(markdown: str) -> str:
    """A Definition's body as one line a row can say: its words, without the marks its toolbar writes (headings, bold,
    code, links, lists, tables). Seen live, 2026-11-23: a row said "## Definition A customer with **more than one**…"."""
    import re
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", markdown or "")           # a link: its words
    text = re.sub(r"^\s{0,3}#{1,6}\s+[^\n]*\n?", "", text, flags=re.M)      # a heading is a section's name, not the words
    text = re.sub(r"^\s*(?:[-*]|\d+\.)\s+", "", text, flags=re.M)              # a list's marks
    text = re.sub(r"^\s*\|?\s*:?-{3,}.*$", "", text, flags=re.M)               # a table's rule
    text = re.sub(r"[*_`>|]+", "", text)
    return " ".join(text.split())


def settle(item: Item, scope: Scope, *, placed: Optional[tuple[str, str]] = None) -> Item:
    """Stand ``item`` in its Area: a person's placement, else the tables it reads, else its name's words, else none.
    Its NAME only: a description is prose, and read for Areas it placed a schedule that "returns the top five" in
    Returns (seen live, 2026-11-23). The word that placed it is said, so a weak placement can be seen for one."""
    if placed and placed[0]:
        item.area, item.area_how = placed[0], f"{who_of(placed[1]) or 'someone'} placed it here"
        item.placed = True
        return item
    if item.tables and item.connection_id:
        from pramanyx.semantic.areas import area_of_tables
        area = area_of_tables([str(t) for t in item.tables], item.connection_id)
        if area:
            item.area, item.area_how = area, "read from its tables"
            return item
    area, word = by_words(scope, item.name, item.connection_id)
    if area:
        item.area, item.area_how = area, f'its name says "{word}"'
    return item


# ── the readers, one per kind ────────────────────────────────────────────────────────────────────────────────────


def _coverage_placements(scope: Scope, connection_id: str) -> tuple[dict, dict, Optional[str]]:
    """``(tables, metrics, schema)`` — each table's and metric's Area and why, as the coverage matrix places them."""
    cov = scope.coverage(connection_id)
    tables: dict[str, tuple[str, str]] = {}
    metrics: dict[str, tuple[str, str]] = {}
    for row in cov.get("areas") or []:
        for t in row.get("tables") or []:
            tables.setdefault(str(t.get("name") or "").lower(), (row["id"], str(t.get("why") or "")))
        for m in row.get("metrics") or []:
            metrics.setdefault(str(m.get("name") or ""), (row["id"], str(m.get("why") or "")))
    return tables, metrics, cov.get("schema")


def _declared_schema(connection_id: str) -> str:
    try:
        from pramanyx.db.registry import get_meta
        return str((get_meta(connection_id) or {}).get("schema_name") or "")
    except Exception as exc:  # noqa: BLE001 — a table is then named without its schema
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "discover: a connection's declared schema could not be read", counter="discover.schema")
        return ""


def tables(scope: Scope) -> Found:
    """The tables the platform has read on each connection — the profiler's, never a warehouse read here — each in the
    Area the coverage matrix places it, with why. A connection never read is said. The Sheets connection's tables are
    the spreadsheets themselves, listed by their own kind under their own sharing — never again here, where a sheet
    not shared with the person would be listed as a table (seen live, 2026-11-23)."""
    from pramanyx.govern.certification import of_prefix
    from pramanyx.semantic.metric_coverage import tables_of
    from pramanyx.sheets.model import SHEETS_CONNECTION
    found = Found()
    for conn, name in scope.connections.items():
        if conn == SHEETS_CONNECTION:
            continue
        facts = tables_of(conn)
        if not facts:
            found.said_of.append((conn, f"{name}: its tables have not been read yet"))
            continue
        placed, _metrics, _schema = _coverage_placements(scope, conn)
        schema = _declared_schema(conn)
        marks = of_prefix(f"table:{conn}.")
        for t in facts:
            mark = marks.get(f"table:{conn}.{schema}.{t.name}") or marks.get(f"table:{conn}..{t.name}")
            area, why = placed.get(t.name.lower(), ("", ""))
            found.items.append(Item(
                kind="table", id=f"{conn}.{schema}.{t.name}" if schema else f"{conn}.{t.name}", name=t.name,
                connection_id=conn, connection_name=name, area=area, area_how=why, placed=why.endswith(" placed it here"),
                certification=mark,
                href=_href("/", tab="catalog", conn=conn, schema=schema, table=t.name),
                detail={"rows": t.rows, "schema": schema, "dated_by": t.date_column}))
    return found


def metrics(scope: Scope) -> Found:
    """Each connection's own metrics, in the Area the coverage matrix places them, with why."""
    from pramanyx.routers.metrics import get_metrics
    found = Found()
    for conn, name in scope.connections.items():
        rows = [m for m in get_metrics(conn) if str(m.get("connection") or "") == conn]
        if not rows:
            continue
        _tables, placed, _schema = _coverage_placements(scope, conn)
        for m in rows:
            area, why = placed.get(str(m.get("name") or ""), ("", ""))
            found.items.append(Item(
                kind="metric", id=f"{conn}/{m['name']}", name=str(m.get("label") or m["name"]),
                line=str(m.get("description") or ""), connection_id=conn, connection_name=name, area=area,
                area_how=why, placed=why.endswith(" placed it here"), owner=str(m.get("owner") or ""),
                state=str(m.get("status") or ""),
                updated_at=str(m.get("approved_at") or m.get("proposed_at") or ""),
                href=_href("/", tab="semantic", conn=conn, metric=str(m["name"]), schema=str(m.get("home_schema") or "")),
                detail={"unit": m.get("unit") or "", "measurable": m.get("measurable")}))
    return found


def definitions(scope: Scope) -> Found:
    """Each connection's published Definitions, and the person's own drafts; another's draft is theirs to publish."""
    from pramanyx.record.writers import definitions as of_connection
    found = Found()
    me = who_of(scope.person).lower()
    for conn, name in scope.connections.items():
        for c in of_connection(conn):
            x = c.extra or {}
            published = c.tier == "approved"
            if not published and who_of(c.author).lower() != me:
                continue
            term, area = str(x.get("term") or ""), str(x.get("area") or "")
            found.items.append(Item(
                kind="definition", id=f"{conn}/{term}/{area}", name=term,
                line=str(x.get("description") or "") or plain_words(c.statement.text)[:240],
                connection_id=conn, connection_name=name, area=area, area_how="its own" if area else "",
                owner=str(x.get("approved_by") or c.owner or c.author or ""), updated_at=c.recorded_at,
                state="published" if published else "draft",
                href=_href("/", tab="semantic", conn=conn, definition=term, area=area)))
    return found


def dashboards(scope: Scope) -> Found:
    """The person's own dashboards and those published to them — never another's unpublished one."""
    from pramanyx.dashboards import sharing, versions
    from pramanyx.dashboards.home import person_of
    found = Found()
    owner = person_of(scope.request)
    marks, placed = _certified("dashboard"), _placed_tags("dashboard")
    for conn, name in scope.connections.items():
        for d in versions.of_person(conn, owner):
            if d.get("retired") or d.get("state") == "archived":
                continue
            ref = f"{conn}:{owner}:{d.get('dashboard_id')}"
            found.items.append(settle(Item(
                kind="dashboard", id=ref, name=str(d.get("title") or d.get("dashboard_id")), line="Yours",
                connection_id=conn, connection_name=name, owner=owner, updated_at=str(d.get("kept_at") or ""),
                state=str(d.get("state") or ""), certification=marks.get(ref),
                href=_href("/", tab="intelligence", layer="dashboards", conn=conn, dashboard=str(d.get("dashboard_id") or ""))),
                scope, placed=placed.get(ref)))
        for d in sharing.shared_with(conn, owner):
            ref = f"{conn}:{d.get('owner')}:{d.get('dashboard_id')}"
            found.items.append(settle(Item(
                kind="dashboard", id=ref, name=str(d.get("title") or d.get("dashboard_id")),
                line=f"Published by {who_of(str(d.get('owner') or ''))}", connection_id=conn, connection_name=name,
                owner=str(d.get("owner") or ""), state="published", certification=marks.get(ref),
                # one published to the person is opened as `shared:<owner>:<id>` (`dashboards/BriefingDashboards.tsx`)
                href=_href("/", tab="intelligence", layer="dashboards", conn=conn,
                           dashboard=f"shared:{d.get('owner') or ''}:{d.get('dashboard_id') or ''}")),
                scope, placed=placed.get(ref)))
    return found


def canvases(scope: Scope) -> Found:
    """The Data Canvases shared with the person; one that is not is counted, not listed."""
    from pramanyx.canvas.store import list_canvases
    from pramanyx.db.history import last_activity_by_canvas
    from pramanyx.routers.canvas import seen_as
    found = Found()
    marks, placed = _certified("canvas"), _placed_tags("canvas")
    activity = last_activity_by_canvas()
    for c in list_canvases(include_legacy=True):
        conn = getattr(c, "primary_connection_id", None) or (c.scopes[0].connection_id if c.scopes else "")
        if conn not in scope.connections:
            continue
        if not seen_as(c, scope.request).get("access"):
            found.withheld += 1
            continue
        item = Item(kind="canvas", id=c.id, name=c.name, line=str(c.description or ""), connection_id=conn,
                    connection_name=scope.connections[conn], owner=str(c.created_by or ""),
                    updated_at=str(activity.get(c.id) or c.updated_at or ""), certification=marks.get(c.id),
                    href=_href("/", tab="canvas-workspace", conn=conn, canvas=c.id),
                    tables=[t for s in c.scopes for t in (s.tables or [])])
        found.items.append(settle(item, scope, placed=placed.get(c.id)))
    return found


def agents(scope: Scope) -> Found:
    """The workspace's own agents."""
    from pramanyx.custom_agents import list_agents
    from pramanyx.metastore import scoped_to_workspace
    found = Found()
    placed = _placed_tags("agent")
    for a in scoped_to_workspace(list_agents(), key="connection_id", workspace_id=scope.workspace_id):
        if a.connection_id and a.connection_id not in scope.connections:
            continue
        found.items.append(settle(Item(
            kind="agent", id=a.id, name=a.name, line=a.purpose, connection_id=a.connection_id,
            connection_name=scope.connections.get(a.connection_id, ""), owner=a.owner, updated_at=a.updated_at,
            state="on" if a.enabled else "off", href=_href("/", tab="agentic-ops", layer="agents", agent=a.id, kind="custom")),
            scope, placed=placed.get(a.id)))
    return found


def schedules(scope: Scope) -> Found:
    """The workspace's schedules — what runs on a rhythm, and what it does."""
    from pramanyx.automations.store import list_automations
    from pramanyx.metastore import scoped_to_workspace
    found = Found()
    placed = _placed_tags("automation")
    for a in scoped_to_workspace(list_automations(None, False), key="conn_id", workspace_id=scope.workspace_id):
        if a.conn_id not in scope.connections:
            continue
        found.items.append(settle(Item(
            kind="schedule", id=a.id, name=a.name, line=a.description, connection_id=a.conn_id,
            connection_name=scope.connections[a.conn_id], owner=a.declared_by, updated_at=str(a.updated_at or ""),
            state="on" if a.enabled else "off", href=_href("/", tab="agentic-ops", layer="automations", conn=a.conn_id, automation=a.id)),
            scope, placed=placed.get(a.id)))
    return found


def documents(scope: Scope) -> Found:
    """The documents the person may read; one that is private to someone else is counted, not listed. A document of
    one connection (a schema's documentation) stands with it, and is out of view with it; one of none is always in."""
    from pramanyx.knowledge.access import may_read
    from pramanyx.knowledge.indexer import doctree_connection
    from pramanyx.routers.knowledge import list_documents_endpoint
    found = Found()
    marks, placed = _certified("document"), _placed_tags("document")
    for d in list_documents_endpoint():
        # an older schema document's row names no connection; its id does (`doctree::<conn>::<schema>`)
        conn = str(d.get("connection_id") or doctree_connection(str(d.get("doc_id") or "")) or "")
        if conn and conn not in scope.connections:
            continue
        if not may_read(d):
            found.withheld += 1
            continue
        doc_id = str(d.get("doc_id") or "")
        title = str(d.get("title") or d.get("filename") or doc_id)
        if conn and d.get("generated"):
            title = title.replace(f"{conn}/", f"{scope.connections[conn]}/", 1)   # its connection by name, not id
        found.items.append(settle(Item(
            kind="document", id=doc_id, name=title, line="Written by the platform" if d.get("generated") else "",
            connection_id=conn, connection_name=scope.connections.get(conn, ""),
            owner=str((d.get("access") or {}).get("owner") or ""), updated_at=str(d.get("uploaded_at") or ""),
            certification=marks.get(doc_id), href=_href("/", tab="documents", doc=doc_id)),
            scope, placed=placed.get(doc_id)))
    return found


def sheets(scope: Scope) -> Found:
    """The spreadsheets shared with the person; one that is not is counted, not listed."""
    from pramanyx.sheets import model, sharing
    found = Found()
    placed = _placed_tags("sheet")
    for s in model.list_sheets():
        if not sharing.level_of(s, scope.person).level:
            found.withheld += 1
            continue
        found.items.append(settle(Item(
            kind="sheet", id=s.id, name=s.name, line=f"{len(s.columns)} columns", connection_id=model.SHEETS_CONNECTION,
            owner=str(s.created_by or ""), updated_at=str(getattr(s.change, "at", "") or s.created_at or ""),
            href=_href("/", tab="spreadsheets", sheet=s.id)), scope, placed=placed.get(s.id)))
    return found


def trusted_queries(scope: Scope) -> Found:
    """Each connection's approved trusted queries, trimmed to the person's clearance as answers are."""
    from pramanyx.govern.retrieval_trim import tables_of_sql, trim_by_tables
    from pramanyx.semantic.trusted_queries import list_trusted
    found = Found()
    placed = _placed_tags("trusted_query")
    for conn, name in scope.connections.items():
        rows = list_trusted(conn)
        if not rows:
            continue
        trimmed = trim_by_tables(rows, lambda q: tables_of_sql(str(getattr(q, "sql", "") or "")), connection_id=conn)
        found.withheld += len(rows) - len(trimmed.kept)
        for q in trimmed.kept:
            qid = trusted_query_id(conn, q)
            found.items.append(settle(Item(
                kind="trusted_query", id=f"{conn}/{qid}", name=str(q.question), connection_id=conn,
                connection_name=name, state=str(getattr(q, "status", "") or "approved"),
                updated_at=str(getattr(q, "verified_at", "") or getattr(q, "updated_at", "") or ""),
                href=_href("/", tab="intelligence", layer="memory", conn=conn, trusted=qid),
                tables=sorted(tables_of_sql(str(getattr(q, "sql", "") or "")))), scope, placed=placed.get(f"{conn}/{qid}")))
    return found


#: kind → its reader. One place, so a new kind is one line and a test can stand any reader in.
READERS: dict[str, Callable[[Scope], Found]] = {
    "metric": metrics, "table": tables, "definition": definitions, "dashboard": dashboards, "canvas": canvases,
    "agent": agents, "schedule": schedules, "document": documents, "sheet": sheets, "trusted_query": trusted_queries,
}
