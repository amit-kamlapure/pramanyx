/**
 * Discover — one page over everything a person may open, by the Area of the business it belongs to
 * (`pramanyx/discover/`, `docs/DISCOVER_PLAN_2026-11-23.md`). The three reads the page makes, and the words its rows say.
 *
 * Every read is the server's: what a person may open is decided there by each kind's own rule, and what they may not is
 * counted and said here, never left out. Nothing here fetches anything but the three doors.
 */
import type { IconName } from "@/components/ui/icon";
import { fastApiError } from "@/lib/api";
import type { AskSubject } from "@/lib/askSubject";
import { dashboardSubject } from "@/lib/askSubject";
import { getApiBase } from "@/lib/config";
import { formatCount, relTime } from "@/lib/format";
import { getActiveWorkspace } from "@/lib/workspace";

export const KINDS = ["metric", "table", "definition", "dashboard", "canvas", "agent", "schedule", "document", "sheet",
  "trusted_query"] as const;
export type DiscoverKind = (typeof KINDS)[number];

/** Each kind's name, one and many, as a row and a count say it. */
export const KIND_WORDS: Record<DiscoverKind, [string, string]> = {
  metric: ["metric", "metrics"], table: ["table", "tables"], definition: ["Definition", "Definitions"],
  dashboard: ["dashboard", "dashboards"], canvas: ["Data Canvas", "Data Canvases"], agent: ["agent", "agents"],
  schedule: ["schedule", "schedules"], document: ["document", "documents"], sheet: ["spreadsheet", "spreadsheets"],
  trusted_query: ["trusted query", "trusted queries"],
};

/** Each kind's section title, as the server names it (`discover/items.TITLES`). */
export const KIND_TITLES: Record<DiscoverKind, string> = {
  metric: "Metrics", table: "Tables", definition: "Definitions", dashboard: "Dashboards", canvas: "Data Canvases",
  agent: "Agents", schedule: "Schedules", document: "Documents", sheet: "Spreadsheets", trusted_query: "Trusted queries",
};

/** Each kind's glyph — the one its page has in the rail where it has one. */
export const KIND_ICON: Record<DiscoverKind, IconName> = {
  metric: "metric", table: "table", definition: "words", dashboard: "gauge", canvas: "canvas", agent: "agents",
  schedule: "clock", document: "folder", sheet: "viewgrid", trusted_query: "sql",
};

export interface Certification { status: string; why?: string; by?: string; at?: string }

export interface DiscoverItem {
  kind: DiscoverKind;
  id: string;
  name: string;
  line: string;
  connection_id: string;
  connection_name: string;
  area: string;
  /** How it came to stand in its Area: "ana placed it here", "read from its tables", 'its name says "sales"'. */
  area_how: string;
  owner: string;
  updated_at: string;
  state: string;
  certification: Certification | null;
  href: string;
  detail: Record<string, unknown>;
}

export interface DiscoverArea {
  id: string;
  name: string;
  question: string;
  parent: string;
  business_owners: string[];
  technical_owners: string[];
  source: string;
  connections: string[];
  counts: Partial<Record<DiscoverKind, number>>;
  total: number;
  deprecated: number;
}

export interface DiscoverKindView {
  kind: DiscoverKind;
  title: string;
  count: number;
  withheld: number;
  states: Record<string, number>;
  items: DiscoverItem[];
}

export interface SuggestedInView { id: string; label: string; tables: string[]; connection_id: string; connection_name: string }

export interface DiscoverHome {
  connections: { id: string; name: string }[];
  areas: DiscoverArea[];
  quiet_areas: { id: string; name: string; question: string }[];
  suggested: SuggestedInView[];
  certified: DiscoverItem[];
  certified_count: number;
  kinds: DiscoverKindView[];
  withheld: Partial<Record<DiscoverKind, number>>;
  said: string[];
}

export interface DiscoverItems {
  items: DiscoverItem[];
  total: number;
  next_cursor: number | null;
  withheld: Partial<Record<DiscoverKind, number>>;
  said: string[];
}

export interface DiscoverAreaPage {
  area: DiscoverArea;
  children: DiscoverArea[];
  kinds: DiscoverKindView[];
  empty_kinds: DiscoverKind[];
  said: string[];
}

/** The Area of what no Area holds. */
export const OTHER = "other";

function url(path: string, params: Record<string, string | number | boolean | undefined>, workspaceId?: string): string {
  const q = new URLSearchParams();
  // the workspace the page stands in, as the Catalog is read: its connections and no others
  const ws = workspaceId || getActiveWorkspace();
  if (ws) q.set("workspace_id", ws);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== false) q.set(k, String(v));
  const s = q.toString();
  return `${getApiBase()}${path}${s ? `?${s}` : ""}`;
}

/** Reads under way, by address: a page that asks twice for the same read while the first is out (React's strict
 *  double effect, a tab resolving on load) waits on the one — each Discover read is every reader at once. A read that
 *  answered is kept a few seconds, so the page mounted again as the shell settles, or Back from an Area, shows it at
 *  once; `fresh` (after a change the person made) reads again. */
const underWay = new Map<string, Promise<unknown>>();
const kept = new Map<string, { at: number; value: unknown }>();
export const KEEP_MS = 20_000;

function once<T>(href: string, go: () => Promise<T>, fresh = false): Promise<T> {
  if (fresh) kept.delete(href);
  const k = kept.get(href);
  if (k && Date.now() - k.at < KEEP_MS) return Promise.resolve(k.value as T);
  const have = underWay.get(href) as Promise<T> | undefined;
  if (have) return have;
  const p = go().then(v => { kept.set(href, { at: Date.now(), value: v }); return v; }).finally(() => underWay.delete(href));
  underWay.set(href, p);
  return p;
}

function read<T>(href: string, what: string, fresh = false): Promise<T> {
  return once(href, async () => {
    const res = await fetch(href);
    if (!res.ok) throw new Error(fastApiError(await res.json().catch(() => ({})), `Reading ${what} failed (${res.status})`));
    return (await res.json()) as T;
  }, fresh);
}

export function readDiscover(connectionId = "", workspaceId?: string, fresh = false): Promise<DiscoverHome> {
  return read(url("/discover", { connection_id: connectionId }, workspaceId), "Discover", fresh);
}

export interface ItemsAsked {
  kind?: DiscoverKind | ""; area?: string; certified?: boolean; mine?: boolean; q?: string; connectionId?: string;
  cursor?: number; limit?: number; workspaceId?: string;
}

export function readDiscoverItems(a: ItemsAsked): Promise<DiscoverItems> {
  return read(url("/discover/items", { kind: a.kind, area: a.area, certified: a.certified, mine: a.mine, q: a.q?.trim(),
    connection_id: a.connectionId, cursor: a.cursor, limit: a.limit }, a.workspaceId), "what Discover holds");
}

/** One Area's page; null when no connection in view has that Area (the server's 404). */
export function readDiscoverArea(areaId: string, connectionId = "", workspaceId?: string, fresh = false): Promise<DiscoverAreaPage | null> {
  const href = url(`/discover/areas/${encodeURIComponent(areaId)}`, { connection_id: connectionId }, workspaceId);
  return once(href, async () => {
    const res = await fetch(href);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(fastApiError(await res.json().catch(() => ({})), `Reading the Area failed (${res.status})`));
    return (await res.json()) as DiscoverAreaPage;
  }, fresh);
}

// ── what a row and a card say ────────────────────────────────────────────────────────────────────────────────────

/** What an Area holds, in words: "4 metrics · 3 tables · 2 dashboards". The kinds in Discover's order. */
export function holdsWords(counts: Partial<Record<DiscoverKind, number>>): string {
  return KINDS.filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => `${formatCount(counts[k] ?? 0)} ${KIND_WORDS[k][(counts[k] ?? 0) === 1 ? 0 : 1]}`).join(" · ");
}

const person = (raw: string) => raw.replace(/^user:/, "");

/** Who owns an Area, in words — or that nobody is recorded, which is a fact worth saying. */
export function ownersLine(a: Pick<DiscoverArea, "business_owners" | "technical_owners">): string {
  const parts = [a.business_owners.length ? `Owned by ${a.business_owners.map(person).join(", ")}` : "",
    a.technical_owners.length ? `its data by ${a.technical_owners.map(person).join(", ")}` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No owner yet";
}

const rowsOf = (d: Record<string, unknown>): number | null => (typeof d.rows === "number" ? d.rows : null);

/** A row's second line: what the thing is, from what its kind knows — its description, its rows, who published it —
 *  with its connection when the page spans more than one. */
export function secondLine(i: DiscoverItem, manyConnections: boolean): string {
  const rows = rowsOf(i.detail);
  const own = i.kind === "table" ? [String(i.detail.schema ?? ""), rows != null ? `${formatCount(rows)} rows` : ""]
    : i.kind === "dashboard" ? [i.line, i.updated_at && relTime(i.updated_at) !== "—" ? `kept ${relTime(i.updated_at)} ago` : ""]
    : i.kind === "agent" ? [i.line || "No purpose written yet"]
    : [i.line];
  return [manyConnections ? i.connection_name : "", ...own].map((s) => (s ?? "").trim()).filter(Boolean).join(" · ");
}

export type MarkTone = "up" | "amber" | "plain";

/** The one mark a row carries: certified or deprecated first (the organisation's word), else its own standing where
 *  it says something — a draft, a schedule that is off. An approved metric or a running agent needs no mark. */
export function markOf(i: Pick<DiscoverItem, "certification" | "state" | "kind">): { word: string; tone: MarkTone } | null {
  const cert = i.certification?.status;
  if (cert === "certified") return { word: "Certified", tone: "up" };
  if (cert === "deprecated" || i.state === "deprecated") return { word: "Deprecated", tone: "amber" };
  if (i.state === "draft") return { word: "Draft", tone: "plain" };
  if (i.state === "proposed") return { word: "Proposed", tone: "plain" };
  if (i.state === "off") return { word: "Off", tone: "plain" };
  return null;
}

/** What the Ask panel can be opened on for this thing — the subjects it already knows (a table, a dashboard, a
 *  spreadsheet). Null for a kind it has none for: no "Ask about it" is offered there rather than one that asks nothing. */
export function askSubjectOf(i: DiscoverItem): AskSubject | null {
  if (i.kind === "table") {
    const schema = String(i.detail.schema ?? "");
    return { kind: "table", connectionId: i.connection_id, noun: ["row", "rows"], table: schema ? `${schema}.${i.name}` : i.name };
  }
  if (i.kind === "sheet") return { kind: "sheet", connectionId: "sheets", noun: ["row", "rows"], id: i.id, title: i.name };
  if (i.kind === "dashboard") {
    const named = new URL(i.href, "http://x").searchParams.get("dashboard") ?? "";
    const key = named.startsWith("shared:") ? named : `${i.connection_id}:${named}`;
    return named ? dashboardSubject(i.connection_id, key, i.name, null) : null;
  }
  return null;
}

/** What is withheld from a kind, in words: "2 not shared with you". */
export function withheldWords(kind: DiscoverKind, n: number): string {
  if (!n) return "";
  return kind === "trusted_query" ? `${formatCount(n)} beyond your clearance` : `${formatCount(n)} not shared with you`;
}
