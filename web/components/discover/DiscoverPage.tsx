"use client";

/**
 * Discover — one page over everything a person may open, by the Area of the business it belongs to (the plan's §4.1
 * and §4.2, `docs/DISCOVER_PLAN_2026-11-23.md`; the D0 mockup the user saw). Data's first row.
 *
 * A browse page, not a dashboard: the search and its filters first, then the Areas as cards, what is certified, and each
 * kind with its first few. An Area opens on its own page (`?tab=discover&id=<area>`, so Back and a reload keep it). A row
 * is a link to the thing's own page inside the app, opened in place without a reload (`lib/addressOnce.openInApp`) — a
 * real link still, so ⌘-click opens it in a new tab as a person expects; one the Ask panel has a
 * subject for (a table, a dashboard, a spreadsheet) can be asked about from the row. What a person may not open is
 * counted where it would have stood, and a kind that could not be read is said. No title bar: the rail and the tab say
 * where this is (the user, 2026-09-26).
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { Card, Chip, Empty, Label, MUTED, Page } from "@/components/clarity/kit";
import { DefinitionBody } from "@/components/definitions/DefinitionBody";
import { AddToArea, AreaEditor, RowMenu } from "@/components/discover/AreaCuration";
import { BackHeader } from "@/components/record/kit";
import { Button } from "@/components/ui/button";
import { IconSquare } from "@/components/ui/icon-square";
import { areaIcon } from "@/lib/areaIcons";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Loading, ReadFailed } from "@/components/ui/states";
import { openInApp, useFromAddress } from "@/lib/addressOnce";
import { declarationsOf, readAreas, saveAreas, setNotAnArea } from "@/lib/areas";
import { askAbout } from "@/lib/askSubject";
import { useDiscoverHost } from "@/components/discover/host";
import {
  KINDS, KIND_ICON, KIND_TITLES, KIND_WORDS, OTHER, askSubjectOf, holdsWords, markOf, ownersLine, readDiscover,
  readDiscoverArea, readDiscoverItems, readDiscoverSearch, secondLine, withheldWords,
  type DiscoverArea, type DiscoverAreaPage, type DiscoverHome, type DiscoverItem, type DiscoverItems, type DiscoverKind,
  type DiscoverKindView, type SuggestedInView,
} from "@/lib/discover";
import { formatCount } from "@/lib/format";
import { getMyPreferences, putMyPreference } from "@/lib/api";
import { withUniqueKeys } from "@/lib/listKeys";

interface Filters { conn: string; q: string; kind: DiscoverKind | ""; area: string; certified: boolean; mine: boolean;
  /** A search across every workspace of the organisation (S1, 2026-11-25), not this one alone. */
  across?: boolean }
const NO_FILTERS: Filters = { conn: "", q: "", kind: "", area: "", certified: false, mine: false, across: false };
const narrowed = (f: Filters) => !!(f.q.trim() || f.kind || f.area || f.certified || f.mine);

/** How many results a search shows — the best of them; the count says how many more there are. */
const SEARCH_LIMIT = 100;

/** How many rows a kind shows on an Area's page before "Show all". */
const AREA_ROWS = 8;

export function DiscoverPage({ openId, onOpenArea, onName, connections, workspaceId = "", ready = true }: {
  /** The Area open, from the address (`?id=`); null for Discover itself. */
  openId: string | null;
  onOpenArea: (id: string | null) => void;
  /** The name the tab says: the Area's on its page, else none (the tab then says Discover). */
  onName: (name: string | null) => void;
  /** The workspace's connections, for the connection filter. */
  connections: { id: string; name: string }[];
  /** The workspace the page stands in: its connections, as the Catalog reads them. */
  workspaceId?: string;
  /** Whether the shell knows the workspace yet — nothing is read before it does, or the first read spans every one. */
  ready?: boolean;
}) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // `?q=` — ⌘K's "Search everything" opens Discover on the words typed there (`lib/addressOnce.ts`)
  useFromAddress(["q"], ({ q }) => setFilters(f => ({ ...NO_FILTERS, conn: f.conn, q })));
  if (!ready) return <Page testId="discover"><Loading what="Discover" /></Page>;
  if (openId) {
    return <AreaView key={`${openId}:${filters.conn}:${workspaceId}`} areaId={openId} conn={filters.conn} workspaceId={workspaceId}
      onBack={() => onOpenArea(null)} onOpenArea={onOpenArea} onName={onName} />;
  }
  return <HomeView filters={filters} setFilters={setFilters} onOpenArea={onOpenArea} onName={onName} connections={connections}
    workspaceId={workspaceId} />;
}

// ── Discover itself ──────────────────────────────────────────────────────────────────────────────────────────────

function HomeView({ filters, setFilters, onOpenArea, onName, connections, workspaceId }: {
  filters: Filters; setFilters: (f: Filters) => void; onOpenArea: (id: string) => void; onName: (name: string | null) => void;
  connections: { id: string; name: string }[]; workspaceId: string;
}) {
  const [home, setHome] = useState<DiscoverHome | null>(null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => { onName(null); }, [onName]);
  useEffect(() => {
    let alive = true;
    setHome(null); setErr("");
    readDiscover(filters.conn, workspaceId, tick > 0).then(h => { if (alive) setHome(h); })
      .catch(e => { if (alive) setErr(String((e as Error)?.message ?? e)); });
    return () => { alive = false; };
  }, [filters.conn, workspaceId, tick]);

  const areaNames = useMemo(() => {
    const m: Record<string, string> = { [OTHER]: "Everything else" };
    for (const a of home?.areas ?? []) m[a.id] = a.name;
    for (const a of home?.quiet_areas ?? []) m[a.id] = a.name;
    return m;
  }, [home]);
  const many = (home?.connections.length ?? 0) > 1;

  return (
    <Page testId="discover">
      <SearchBar filters={filters} setFilters={setFilters} home={home} areaNames={areaNames} connections={connections} />
      {err ? <ReadFailed what="Discover" error={err} onRetry={() => setTick(t => t + 1)} />
        : !home ? <Loading what="Discover" />
        : narrowed(filters) ? <Results filters={filters} workspaceId={workspaceId} areaNames={areaNames} many={many}
            onClear={() => setFilters({ ...NO_FILTERS, conn: filters.conn })} />
        : <Browse home={home} areaNames={areaNames} many={many} onOpenArea={onOpenArea} conn={filters.conn}
            onViewAll={kind => setFilters({ ...filters, kind })} onCertified={() => setFilters({ ...filters, certified: true })}
            reload={() => setTick(t => t + 1)} />}
    </Page>
  );
}

function SearchBar({ filters, setFilters, home, areaNames, connections }: {
  filters: Filters; setFilters: (f: Filters) => void; home: DiscoverHome | null; areaNames: Record<string, string>;
  connections: { id: string; name: string }[];
}) {
  const [text, setText] = useState(filters.q);
  // words set from outside (⌘K, Clear) show in the box; the box's own words come back here unchanged
  useEffect(() => { setText(filters.q); }, [filters.q]);
  useEffect(() => {
    if (text === filters.q) return;
    const t = window.setTimeout(() => setFilters({ ...filters, q: text }), 250);
    return () => window.clearTimeout(t);
  }, [text, filters, setFilters]);
  const set = (part: Partial<Filters>) => setFilters({ ...filters, ...part });
  const areaIds = Object.keys(areaNames).filter(id => id !== OTHER).sort((a, b) => areaNames[a].localeCompare(areaNames[b]));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
      <Input type="search" aria-label="Search Discover" value={text} onChange={e => setText(e.target.value)}
        placeholder="Search by name or by what it means — tables, columns, metrics, dashboards, canvases, agents, documents…"
        leading={<Icon name="search" size={16} />} style={{ width: "100%" }} data-testid="discover-search" />
      <div className="aug-discover-filters">
        <SelectField bespoke aria-label="Area" value={filters.area} onChange={e => set({ area: e.target.value })} data-testid="discover-area-filter">
          <option value="">Every Area</option>
          {areaIds.map(id => <option key={id} value={id}>{areaNames[id]}</option>)}
          <option value={OTHER}>Everything else</option>
        </SelectField>
        <SelectField bespoke aria-label="Kind" value={filters.kind} onChange={e => set({ kind: e.target.value as DiscoverKind | "" })} data-testid="discover-kind-filter">
          <option value="">Every kind</option>
          {KINDS.map(k => <option key={k} value={k}>{KIND_TITLES[k]}</option>)}
        </SelectField>
        <Button size="sm" variant={filters.certified ? "secondary" : "outline"} aria-pressed={filters.certified}
          onClick={() => set({ certified: !filters.certified })}>Certified</Button>
        <Button size="sm" variant={filters.mine ? "secondary" : "outline"} aria-pressed={filters.mine}
          onClick={() => set({ mine: !filters.mine })}>Mine</Button>
        {(text.trim() || filters.q.trim()) && (
          <Button size="sm" variant={filters.across ? "secondary" : "outline"} aria-pressed={!!filters.across}
            title="Search every workspace of the organisation, not this one alone — each result says where it lives"
            onClick={() => set({ across: !filters.across, conn: "" })}>Every workspace</Button>
        )}
        {(connections.length > 1 || filters.conn) && (
          <SelectField bespoke aria-label="Connection" value={filters.conn} onChange={e => set({ conn: e.target.value })} data-testid="discover-conn-filter">
            <option value="">Every connection</option>
            {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
        )}
        {narrowed(filters) && (
          <Button size="sm" variant="link" onClick={() => { setText(""); setFilters({ ...NO_FILTERS, conn: filters.conn }); }}>Clear</Button>
        )}
        {home && !narrowed(filters) && (
          <span className="aug-fs-xs" style={{ ...MUTED, marginLeft: "auto" }}>
            {home.connections.length === 1 ? `On ${home.connections[0].name}` : `Across ${formatCount(home.connections.length)} connections`}
          </span>
        )}
      </div>
      <SavedSearches filters={filters} onPick={f => { setText(f.q); setFilters(f); }} />
    </div>
  );
}

/** A search a person keeps on Discover (S2, 2026-11-25): a name and the filters it sets, in their preferences. */
interface SavedSearch { name: string; q: string; kind: string; area: string; conn: string; certified: boolean; mine: boolean; across: boolean }

/** What a search is called before its person names it: its words, else what it narrows to. */
export function searchName(f: Filters): string {
  return f.q.trim() || [f.kind, f.area, f.certified ? "certified" : "", f.mine ? "mine" : ""].filter(Boolean).join(" · ") || "My search";
}

/** A person's own searches, one click from the box — each sets the filters it was kept with, and the search runs then;
 *  none is a live section (each would read every kind and embed a question on every visit). */
export function SavedSearches({ filters, onPick }: { filters: Filters; onPick: (f: Filters) => void }) {
  const [saved, setSaved] = useState<SavedSearch[] | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  useEffect(() => {
    let alive = true;
    getMyPreferences().then(p => {
      const v = p.preferences.discover_searches;
      if (alive) setSaved(Array.isArray(v) ? (v as SavedSearch[]) : []);
    }).catch(() => { if (alive) setSaved([]); });
    return () => { alive = false; };
  }, []);
  if (saved === null) return null;
  const keep = async (next: SavedSearch[], done: string) => {
    const before = saved;
    setSaved(next); setSaid("");
    try { await putMyPreference("discover_searches", next); setSaid(done); }
    catch { setSaved(before); setSaid("It was not kept — try again."); }
  };
  const save = (name: string) => {
    const one: SavedSearch = { name: name.trim(), q: filters.q.trim(), kind: filters.kind, area: filters.area, conn: filters.conn,
      certified: filters.certified, mine: filters.mine, across: !!filters.across };
    setNaming(null);
    void keep([...saved.filter(s => s.name.toLowerCase() !== one.name.toLowerCase()), one].slice(-20), `Kept as “${one.name}”`);
  };
  if (!saved.length && !narrowed(filters)) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid="discover-saved-searches">
      {saved.length > 0 && <span className="aug-fs-xs" style={MUTED}>Your searches</span>}
      {withUniqueKeys(saved, s => `search:${s.name.toLowerCase()}`).map(([key, s]) => (
        <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <Button size="xs" variant="secondary" title={`Search again: ${searchName({ ...s, kind: s.kind as DiscoverKind | "" })}`}
            onClick={() => onPick({ ...NO_FILTERS, ...s, kind: s.kind as DiscoverKind | "" })}>{s.name}</Button>
          <Button size="icon-xs" variant="ghost" aria-label={`Forget ${s.name}`} title="Forget this search"
            onClick={() => void keep(saved.filter(x => x.name !== s.name), `Forgot “${s.name}”`)}>
            <Icon name="close" size={12} />
          </Button>
        </span>
      ))}
      {narrowed(filters) && naming === null && (
        <Button size="xs" variant="outline" onClick={() => setNaming(searchName(filters))}>Save this search</Button>
      )}
      {naming !== null && (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <Input bespoke autoFocus aria-label="Name this search" value={naming} maxLength={60} style={{ width: 200 }}
            onChange={e => setNaming(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && naming.trim()) save(naming); if (e.key === "Escape") setNaming(null); }} />
          <Button size="xs" disabled={!naming.trim()} onClick={() => save(naming)}>Keep</Button>
          <Button size="xs" variant="ghost" onClick={() => setNaming(null)}>Cancel</Button>
        </span>
      )}
      {said && <span className="aug-fs-xs" style={MUTED} role="status">{said}</span>}
    </div>
  );
}

function Browse({ home, areaNames, many, onOpenArea, onViewAll, onCertified, reload, conn }: {
  home: DiscoverHome; areaNames: Record<string, string>; many: boolean; onOpenArea: (id: string) => void;
  onViewAll: (kind: DiscoverKind) => void; onCertified: () => void; reload: () => void; conn: string;
}) {
  // A Definition is written on its Page, in the Semantic Layer (its home inside the app)
  const host = useDiscoverHost();
  const writeDefinition = () => {
    const href = `/?${new URLSearchParams({ tab: "semantic", ...(conn ? { conn } : {}), new_definition: "1" })}`;
    if (host) host.open(href); else openInApp(href);
  };
  const [showQuiet, setShowQuiet] = useState(false);
  // the model's suggestions are a curator's to answer, and on every connection they can outnumber the Areas: one click away
  const [showSuggested, setShowSuggested] = useState(false);
  const holding = home.areas.filter(a => a.id !== OTHER).length;
  const nothing = home.kinds.filter(k => !k.count && !k.withheld).map(k => k.title);
  const noDefinitions = home.kinds.some(k => k.kind === "definition" && !k.count && !k.withheld);
  return (
    <>
      <Said lines={home.said} />
      <Card label="Areas" testId="discover-areas" right={
        <span className="aug-fs-xs" style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
          <span>{formatCount(holding)} hold something</span>
          {home.quiet_areas.length > 0 && (
            <Button size="xs" variant="link" onClick={() => setShowQuiet(s => !s)} data-testid="discover-quiet-toggle">
              {showQuiet ? "Hide the empty ones" : `Show the ${formatCount(home.quiet_areas.length)} that hold nothing yet`}
            </Button>
          )}
          {home.suggested.length > 0 && (
            <Button size="xs" variant="link" onClick={() => setShowSuggested(s => !s)} data-testid="discover-suggested-toggle">
              {showSuggested ? "Hide the suggestions" : `${formatCount(home.suggested.length)} suggested by the model`}
            </Button>
          )}
        </span>}>
        <div className="aug-discover-areas">
          {home.areas.map(a => <AreaCard key={a.id} area={a} onOpen={onOpenArea} />)}
          {showQuiet && home.quiet_areas.map(a => (
            <AreaCard key={a.id} onOpen={onOpenArea} area={{ ...a, parent: "", business_owners: [], technical_owners: [], source: "",
              connections: [], counts: {}, total: 0, deprecated: 0 }} quiet />
          ))}
          {showSuggested && home.suggested.map(s => <SuggestedCard key={`${s.connection_id}:${s.id}`} s={s} many={many} onDone={reload} />)}
        </div>
      </Card>

      <Card label="Certified" testId="discover-certified" right={
        home.certified_count > home.certified.length
          ? <Button size="xs" variant="link" onClick={onCertified}>View all {formatCount(home.certified_count)}</Button>
          : <span className="aug-fs-xs">{formatCount(home.certified_count)}</span>}>
        {home.certified.length
          ? home.certified.map(i => <ItemRow key={`${i.kind}:${i.id}`} item={i} areaName={areaNames[i.area]} many={many} />)
          : <Empty>Nothing here is certified yet. An Area’s owners mark what people should trust; a deprecated thing
              says so wherever it shows.</Empty>}
      </Card>

      {(home.recent?.length ?? 0) > 0 && (
        <Card label="Recently opened by you" testId="discover-recent" right={<span className="aug-fs-xs">newest first</span>}>
          {home.recent!.map(i => <ItemRow key={`${i.kind}:${i.id}`} item={i} areaName={areaNames[i.area]} many={many} />)}
        </Card>
      )}

      <Card label="Most used this month" testId="discover-most-used" right={<span className="aug-fs-xs">the last 30 days</span>}>
        <div className="aug-discover-kinds">
          <div data-testid="discover-most-opened">
            <Label>Opened or used most</Label>
            {home.most_used?.length
              ? home.most_used.map(i => <ItemRow key={`${i.kind}:${i.id}`} item={i} areaName={areaNames[i.area]} many={many} />)
              : <Empty>Nothing was opened or used this month yet.</Empty>}
          </div>
          <div data-testid="discover-most-read">
            <Label>Tables read most</Label>
            {home.most_read?.length
              ? home.most_read.map(i => <ItemRow key={`${i.kind}:${i.id}`} item={i} areaName={areaNames[i.area]} many={many} />)
              : <Empty>No table was read this month yet.</Empty>}
          </div>
        </div>
        {(home.use_said?.length ?? 0) > 0 && (
          <p className="aug-fs-xs" style={{ ...MUTED, margin: "8px 0 0" }} data-testid="discover-use-said">{home.use_said!.join(" ")}</p>
        )}
      </Card>

      <Card label="Everything, by kind" testId="discover-kinds">
        <div className="aug-discover-kinds">
          {withUniqueKeys(home.kinds.filter(k => k.count || k.withheld), k => k.kind).map(([key, k]) => (
            <KindTile key={key} view={k} areaNames={areaNames} many={many}
              more={k.count > k.items.length ? () => onViewAll(k.kind) : undefined}
              add={k.kind === "definition" ? writeDefinition : undefined} />
          ))}
        </div>
        {nothing.length > 0 && (
          <p className="aug-fs-sm" style={{ ...MUTED, margin: "12px 0 0", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
            data-testid="discover-nothing-yet">
            <span>Nothing yet: {nothing.join(", ")}.</span>
            {noDefinitions && <Button size="xs" variant="outline" onClick={writeDefinition}><Icon name="plus" size={12} />Write a Definition</Button>}
          </p>
        )}
      </Card>
    </>
  );
}

/** What the search and the filters find. Words go to the search — by meaning and by words, across every kind, each
 *  result saying why (`/discover/search`, D3); filters alone list a kind, an Area, the certified or your own, a page at a
 *  time (`/discover/items`). */
function Results({ filters, workspaceId, areaNames, many, onClear }: {
  filters: Filters; workspaceId: string; areaNames: Record<string, string>; many: boolean; onClear: () => void;
}) {
  const [page, setPage] = useState<(DiscoverItems & { by_meaning?: boolean }) | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const searching = !!filters.q.trim();
  const asked = useMemo(() => ({ kind: filters.kind, area: filters.area, certified: filters.certified, mine: filters.mine,
    q: filters.q, connectionId: filters.conn, workspaceId, across: !!filters.across }), [filters, workspaceId]);
  useEffect(() => {
    let alive = true;
    setPage(null); setErr("");
    const read = searching
      ? readDiscoverSearch({ ...asked, q: asked.q, limit: SEARCH_LIMIT }).then(r => ({ ...r, next_cursor: null }))
      : readDiscoverItems({ ...asked, limit: 50 });
    read.then(p => { if (alive) setPage(p); }).catch(e => { if (alive) setErr(String((e as Error)?.message ?? e)); });
    return () => { alive = false; };
  }, [asked, searching, tick]);
  const more = async () => {
    if (!page?.next_cursor) return;
    setBusy(true);
    try {
      const next = await readDiscoverItems({ ...asked, cursor: page.next_cursor, limit: 50 });
      setPage({ ...next, items: [...page.items, ...next.items] });
    } catch (e) { setErr(String((e as Error)?.message ?? e)); } finally { setBusy(false); }
  };
  if (err) return <ReadFailed what={searching ? "the search" : "what Discover holds"} error={err} onRetry={() => setTick(t => t + 1)} />;
  if (!page) return <Loading what={searching ? "what matches" : "what Discover holds"} />;
  const withheld = (Object.entries(page.withheld) as [DiscoverKind | "graph", number][]).filter(([, n]) => n)
    .map(([k, n]) => (k === "graph" ? withheldWords(k, n) : `${KIND_TITLES[k]}: ${withheldWords(k, n)}`));
  const label = searching ? `“${filters.q.trim()}”`
    : filters.kind && !filters.area && !filters.certified && !filters.mine ? KIND_TITLES[filters.kind] : "Found";
  return (
    <>
      <Said lines={page.said} />
      <Card label={label} testId="discover-results" right={<span className="aug-fs-xs">
        {formatCount(page.total)} {page.total === 1 ? "thing" : "things"}
        {searching && page.total > page.items.length ? ` · the first ${formatCount(page.items.length)}` : ""}
        {searching ? (page.by_meaning ? " · by meaning and by words" : " · by words") : ""}
      </span>}>
        {page.items.length
          ? page.items.map(i => <ItemRow key={`${i.kind}:${i.id}`} item={i} areaName={areaNames[i.area]} many={many} />)
          : <Empty>Nothing here matches{searching ? " — by its words or by what it means" : ""}.{" "}
              <Button size="xs" variant="link" onClick={onClear}>Clear the search</Button></Empty>}
        {page.next_cursor != null && (
          <div style={{ marginTop: 8 }}>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void more()}>
              {busy ? "Reading…" : `Show more (${formatCount(page.total - page.items.length)} left)`}
            </Button>
          </div>
        )}
        {withheld.length > 0 && (
          <p className="aug-fs-sm" style={{ ...MUTED, margin: "10px 0 0" }} data-testid="discover-withheld">Not listed — {withheld.join(" · ")}.</p>
        )}
      </Card>
    </>
  );
}

// ── one Area ─────────────────────────────────────────────────────────────────────────────────────────────────────

function AreaView({ areaId, conn, workspaceId, onBack, onOpenArea, onName }: {
  areaId: string; conn: string; workspaceId: string; onBack: () => void; onOpenArea: (id: string) => void;
  onName: (name: string | null) => void;
}) {
  const [page, setPage] = useState<DiscoverAreaPage | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  // a curator's change re-reads the page in place; another Area, connection or workspace starts it afresh
  const [mode, setMode] = useState<"" | "edit" | "add">("");
  const shown = useRef("");
  useEffect(() => {
    let alive = true;
    const key = `${areaId}|${conn}|${workspaceId}`;
    if (shown.current !== key) { shown.current = key; setPage(undefined); setMode(""); }
    setErr("");
    readDiscoverArea(areaId, conn, workspaceId, tick > 0).then(p => { if (alive) setPage(p); })
      .catch(e => { if (alive) setErr(String((e as Error)?.message ?? e)); });
    return () => { alive = false; };
  }, [areaId, conn, workspaceId, tick]);
  const reload = () => setTick(t => t + 1);
  const name = page?.area.name ?? null;
  useEffect(() => { onName(name); return () => onName(null); }, [name, onName]);

  if (err) return <Page testId="discover-area"><BackHeader from="Discover" onBack={onBack} title="Area" />
    <ReadFailed what="the Area" error={err} onRetry={() => setTick(t => t + 1)} /></Page>;
  if (page === undefined) return <Page testId="discover-area"><Loading what="the Area" /></Page>;
  if (page === null) return (
    <Page testId="discover-area">
      <BackHeader from="Discover" onBack={onBack} title="Area" />
      <Empty>No connection in view has this Area. <Button size="xs" variant="link" onClick={onBack}>Back to Discover</Button></Empty>
    </Page>
  );
  const a = page.area;
  const many = conn === "" && a.connections.length > 1;
  const other = a.id === OTHER;
  const menu = (i: DiscoverItem) => <RowMenu item={i} page={page} workspaceId={workspaceId} onChanged={reload} />;
  return (
    <Page testId="discover-area">
      <BackHeader from="Discover" onBack={onBack} title={a.name} chips={<>
        <IconSquare name={areaIcon(a.icon)} size={20} title={`${a.name}'s icon`} testId="discover-area-page-icon" />
        {a.source === "package" && <Chip>From the industry package</Chip>}
        {a.source === "organisation" && <Chip>Declared by your organisation</Chip>}
        {a.total > 0 && <Chip>{formatCount(a.total)} {a.total === 1 ? "thing" : "things"}</Chip>}
        {a.deprecated > 0 && <Chip tone="amber">{formatCount(a.deprecated)} deprecated</Chip>}
      </>} actions={page.can_curate ? <>
        <Button size="xs" variant="outline" onClick={() => setMode(m => (m === "add" ? "" : "add"))} aria-pressed={mode === "add"}>
          <Icon name="plus" size={12} />Add to this Area
        </Button>
        <Button size="xs" variant="outline" onClick={() => setMode(m => (m === "edit" ? "" : "edit"))} aria-pressed={mode === "edit"}>
          <Icon name="edit" size={12} />Edit
        </Button>
      </> : undefined} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
        {a.question && <p className="aug-fs-ui" style={{ margin: 0, color: "var(--t2)" }}>{a.question}</p>}
        {a.description
          ? <div data-testid="discover-area-description" style={{ maxWidth: "80ch" }}><DefinitionBody text={a.description} /></div>
          : page.can_curate && <p className="aug-fs-sm" style={{ ...MUTED, margin: 0 }}>No description yet — Edit to write what it covers.</p>}
        <p className="aug-fs-sm" style={{ margin: 0, ...(other ? MUTED : a.business_owners.length || a.technical_owners.length ? MUTED : { color: "var(--amb4)" }) }}>
          {other ? "What no Area holds: nobody placed it, its tables are in none, and its name names none." : ownersLine(a)}
        </p>
      </div>
      <Said lines={page.said} />
      {mode === "edit" && <AreaEditor page={page} workspaceId={workspaceId} onCancel={() => setMode("")}
        onSaved={() => { setMode(""); reload(); }} />}
      {mode === "add" && <AddToArea page={page} workspaceId={workspaceId} onAdded={reload} onClose={() => setMode("")} />}
      {page.featured.length > 0 && (
        <Card label="Featured" testId="discover-area-featured" right={<span className="aug-fs-xs">chosen by its owners, in their order</span>}>
          {page.featured.map(i => <ItemRow key={`${i.kind}:${i.id}`} item={i} many={many} how actions={menu(i)} />)}
        </Card>
      )}
      {page.children.length > 0 && (
        <Card label="Sub-areas" testId="discover-children">
          <div className="aug-discover-areas">{page.children.map(c => <AreaCard key={c.id} area={c} onOpen={onOpenArea} />)}</div>
        </Card>
      )}
      <Card label="What it holds" testId="discover-area-holds" right={
        <span className="aug-fs-xs">each says how it came to be here</span>}>
        {page.kinds.length
          ? <div className="aug-discover-kinds">
              {withUniqueKeys(page.kinds, k => k.kind).map(([key, k]) => <AreaKindTile key={key} view={k} many={many} menu={menu} />)}
            </div>
          : <Empty>Nothing on the connections in view stands in this Area yet.</Empty>}
        {page.kinds.length > 0 && page.empty_kinds.length > 0 && (
          <p className="aug-fs-sm" style={{ ...MUTED, margin: "12px 0 0" }}>
            Nothing here yet: {page.empty_kinds.map(k => KIND_TITLES[k]).join(", ")}.
          </p>
        )}
      </Card>
    </Page>
  );
}

function AreaKindTile({ view, many, menu }: { view: DiscoverKindView; many: boolean; menu?: (i: DiscoverItem) => ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? view.items : view.items.slice(0, AREA_ROWS);
  return (
    <section className="aug-discover-kind" aria-label={view.title} data-testid={`discover-kind-${view.kind}`}>
      <div className="head aug-fs-sm">
        <span className="title">{view.title}</span><span>{formatCount(view.count)}</span>
        {view.items.length > AREA_ROWS && (
          <span className="right">
            <Button size="xs" variant="link" onClick={() => setAll(s => !s)}>{all ? "Show fewer" : `Show all ${formatCount(view.items.length)}`}</Button>
          </span>
        )}
      </div>
      {shown.map(i => <ItemRow key={`${i.kind}:${i.id}`} item={i} many={many} how actions={menu?.(i)} />)}
    </section>
  );
}

// ── the parts ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A click that opens in place; one with a modifier is the browser's (a new tab, a new window). */
function inPlace(e: MouseEvent, open: () => void) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  open();
}

function AreaCard({ area, onOpen, quiet = false }: { area: DiscoverArea; onOpen: (id: string) => void; quiet?: boolean }) {
  const other = area.id === OTHER;
  return (
    <a className="aug-discover-area" href={`?tab=discover&id=${encodeURIComponent(area.id)}`} data-testid={`discover-area-${area.id}`}
      onClick={e => inPlace(e, () => onOpen(area.id))}>
      <span className="head">
        <IconSquare name={areaIcon(area.icon)} size={28} testId={`discover-area-icon-${area.id}`} />
        <span className="name aug-fs-ui">{area.name}</span>
      </span>
      {area.question && <span className="q aug-fs-sm">{area.question}</span>}
      <span className="holds aug-fs-sm">
        {quiet ? "Holds nothing yet" : holdsWords(area.counts)}
        {area.deprecated > 0 && <> · <span style={{ color: "var(--amb4)" }}>{formatCount(area.deprecated)} deprecated</span></>}
      </span>
      {!quiet && <span className="who aug-fs-xs">{other ? "Nobody placed these, and no Area names them" : ownersLine(area)}</span>}
    </a>
  );
}

function SuggestedCard({ s, many, onDone }: { s: SuggestedInView; many: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState<"" | "declare" | "refuse">("");
  const [err, setErr] = useState("");
  const act = async (what: "declare" | "refuse") => {
    setBusy(what); setErr("");
    try {
      if (what === "declare") {
        // as the Semantic Layer declares one (`semantic/AreaControls.tsx`): the organisation's declarations, and this one
        const read = await readAreas(s.connection_id);
        await saveAreas(s.connection_id, [...declarationsOf(read.areas), { id: s.id, name: s.label, question: "", parent: "" }]);
      } else {
        await setNotAnArea(s.connection_id, s.label);
      }
      onDone();
    } catch (e) { setErr(String((e as Error)?.message ?? e)); setBusy(""); }
  };
  const tables = s.tables.slice(0, 4).join(", ") + (s.tables.length > 4 ? ` and ${formatCount(s.tables.length - 4)} more` : "");
  return (
    <div className="aug-discover-area is-suggested" data-testid={`discover-suggested-${s.id}`}>
      <span className="head" style={{ flexWrap: "wrap" }}>
        <IconSquare name={areaIcon("")} size={28} />
        <span className="name aug-fs-ui">{s.label}</span><Chip tone="accent">Suggested by the model</Chip>
      </span>
      <span className="q aug-fs-sm">{many ? `${s.connection_name} · ` : ""}{tables ? `Read from ${tables}` : "Read from its tables"}</span>
      {err && <span className="aug-fs-xs" style={{ color: "var(--red4)" }}>{err}</span>}
      <span style={{ display: "flex", gap: 6, marginTop: "auto" }}>
        <Button size="xs" disabled={!!busy} onClick={() => void act("declare")}>{busy === "declare" ? "Declaring…" : "Declare"}</Button>
        <Button size="xs" variant="outline" disabled={!!busy} onClick={() => void act("refuse")}>Not an area</Button>
      </span>
    </div>
  );
}

function KindTile({ view, areaNames, many, more, add }: {
  view: DiscoverKindView; areaNames: Record<string, string>; many: boolean; more?: () => void; add?: () => void;
}) {
  return (
    <section className="aug-discover-kind" aria-label={view.title} data-testid={`discover-kind-${view.kind}`}>
      <div className="head aug-fs-sm">
        <span className="title">{view.title}</span><span>{formatCount(view.count)}</span>
        {view.withheld > 0 && <span>· {withheldWords(view.kind, view.withheld)}</span>}
        {(more || add) && (
          <span className="right" style={{ display: "inline-flex", gap: 6 }}>
            {add && <Button size="xs" variant="outline" onClick={add}><Icon name="plus" size={12} />New</Button>}
            {more && <Button size="xs" variant="link" onClick={more}>View all</Button>}
          </span>
        )}
      </div>
      {view.items.map(i => <ItemRow key={`${i.kind}:${i.id}`} item={i} areaName={areaNames[i.area]} many={many} />)}
      {!view.items.length && (
        <p className="aug-fs-sm" style={{ ...MUTED, margin: "2px 8px 6px" }}>
          None you may open — {withheldWords(view.kind, view.withheld)}.
        </p>
      )}
    </section>
  );
}

/** One thing: its kind, its name and what it is, its mark, and its Area (or, on the Area's own page, how it came to
 *  stand there). The row is a link to its page; "Ask about it" sits beside the link, never inside it. */
function ItemRow({ item, areaName, many, how = false, actions }: {
  item: DiscoverItem; areaName?: string; many: boolean; how?: boolean;
  /** What may be done to it here — an Area's page gives its curators and the thing's owner a menu (D4). */
  actions?: ReactNode;
}) {
  const mark = markOf(item);
  // shown in the coworker (D6), its host opens the thing and takes the question; else the app's own doors
  const host = useDiscoverHost();
  const subject = askSubjectOf(item);
  const ask = host ? (host.ask ? () => host.ask!(item) : null) : subject ? () => askAbout(subject) : null;
  const also = item.also_on?.length ? `also on ${item.also_on.join(", ")}` : "";
  const homes = item.workspaces?.length ? `in ${item.workspaces.join(", ")}` : "";
  const line = [secondLine(item, many || !!item.workspaces), also, homes].filter(Boolean).join(" · ");
  return (
    <div className="aug-discover-row" data-testid="discover-row">
      <a href={item.href} title={`${KIND_WORDS[item.kind][0]} · ${item.name}`}
        onClick={e => inPlace(e, () => (host ? host.open(item.href) : openInApp(item.href)))}>
        <span className="k"><Icon name={KIND_ICON[item.kind]} size={15} /></span>
        <span className="main">
          <span className="n aug-fs-chrome">{item.name}</span>
          {line && <span className="d aug-fs-sm">{line}</span>}
        </span>
        <span className="meta aug-fs-xs">
          {item.matched?.length ? <span className="how" style={MUTED} title={item.matched.join(" · ")}>{item.matched.join(" · ")}</span> : null}
          {mark && <Chip tone={mark.tone}>{mark.word}</Chip>}
          {how
            ? item.area_how && <span className="how" style={MUTED} title={item.area_how}>{item.area_how}</span>
            : areaName && <Chip title={item.area_how || undefined}>{areaName}</Chip>}
        </span>
      </a>
      {ask && (
        <Button className="ask" size="icon-xs" variant="ghost" aria-label={`Ask about ${item.name}`} title="Ask about it"
          onClick={ask}>
          <Icon name="chat" size={14} />
        </Button>
      )}
      {actions}
    </div>
  );
}

function Said({ lines }: { lines: string[] }): ReactNode {
  if (!lines.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }} data-testid="discover-said">
      {lines.map(l => (
        <span key={l} className="aug-fs-sm" style={{ color: "var(--amb4)", display: "inline-flex", gap: 6, alignItems: "center" }}>
          <Icon name="warning" size={13} />{l}
        </span>
      ))}
    </div>
  );
}
