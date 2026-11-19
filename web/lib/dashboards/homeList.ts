/**
 * The dashboards home (the user, 2026-11-18: "Let this be dashboard home.. let them be a list on the dashboard home"):
 * every dashboard a person can open on a connection, as one list to search, filter and sort. Metrics is pinned: first in
 * every order and every view, whenever it matches what is asked for.
 *
 * Only what the platform knows is offered. A dashboard has no domain and no count of its readers, so there is no Domain
 * filter and no Popular filter: an empty control would say something the data does not.
 */
import type { DashboardListed, SharedDashboardListed } from "@/lib/api";
import { dashboardRef, type Certification } from "@/lib/certification";
import { SPAN, type Size } from "@/lib/dashboards/catalog";

export const HOME_VIEWS = ["list", "detail", "grid"] as const;
export type HomeView = (typeof HOME_VIEWS)[number];
export type HomeSort = "modified" | "name";

export interface OutlineBox { kind: string; size?: string; w?: number; h?: number }

export interface HomeItem {
  /** What opens it. */
  id: string;
  title: string;
  kind: "metrics" | "own" | "shared";
  /** First in every order and every view. */
  pinned: boolean;
  /** When it was last kept; "" for what no person keeps. */
  modifiedAt: string;
  owner: string;
  mine: boolean;
  state: string;
  mark: Certification | null;
  /** How many cards it places; null where that is not known. */
  cards: number | null;
  version: number | null;
  /** What the last change was, in the words it was kept with. */
  change: string;
  audience: string[];
  outline: OutlineBox[];
}

export interface HomeFilters { words: string; mine: boolean; week: boolean; starred: boolean; certified: boolean }
export const NO_FILTERS: HomeFilters = { words: "", mine: false, week: false, starred: false, certified: false };

/** Metrics is a ledger: a row for each metric, the width of the page. */
const METRICS_OUTLINE: OutlineBox[] = Array.from({ length: 7 }, () => ({ kind: "Metric", w: 12, h: 2 }));

const person = (name: string) => name.replace(/^user:/, "") || "someone";
const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

/** How a person's own dashboard stands with its readers. */
function ownState(c: DashboardListed): string {
  if (!c.published_to?.length) return "Draft";
  return c.state === "draft" ? "Published · changes in draft" : "Published";
}

/** Every dashboard the home lists: Metrics, the person's own that are in use, and the Apps shared with them. */
export function homeItems(connectionId: string, person_: string, own: DashboardListed[], shared: SharedDashboardListed[],
  marks: Record<string, Certification>, metricsId: string): HomeItem[] {
  return [
    { id: metricsId, title: "Metrics", kind: "metrics", pinned: true, modifiedAt: "", owner: "This connection", mine: false,
      state: "Pinned", mark: null, cards: null, version: null, change: "The connection's approved metrics", audience: [], outline: METRICS_OUTLINE },
    ...own.filter(c => !c.retired).map((c): HomeItem => {
      const id = c.cockpit_id;
      return { id, title: c.title || id, kind: "own", pinned: false, modifiedAt: c.kept_at, owner: "You", mine: true,
        state: ownState(c), mark: marks[dashboardRef(connectionId, person_, id)] ?? null, cards: c.cards?.length ?? 0,
        version: c.version, change: sentence(c.note), audience: (c.published_to ?? []).map(t => t.name),
        outline: (c as { outline?: OutlineBox[] }).outline ?? [] };
    }),
    ...shared.map((s): HomeItem => {
      const id = s.cockpit_id;
      return { id: `shared:${s.owner}/${id}`, title: s.title || id, kind: "shared", pinned: false, modifiedAt: s.kept_at,
        owner: person(s.published_by || s.owner), mine: false, state: "Shared with you",
        mark: marks[dashboardRef(connectionId, s.owner, id)] ?? null, cards: null, version: s.version, change: "",
        audience: (s.published_to ?? []).map(t => t.name), outline: (s as { outline?: OutlineBox[] }).outline ?? [] };
    }),
  ];
}

/** Monday, the start of the week `now` is in, in the viewer's own clock. */
export function startOfWeek(now: Date): Date {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

/** The items a person asked for, in the order they asked for, the pinned one first. */
export function shownItems(items: HomeItem[], filters: HomeFilters, sort: HomeSort, stars: readonly string[], now: Date = new Date()): HomeItem[] {
  const words = filters.words.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const week = startOfWeek(now).getTime();
  const kept = items.filter(i => {
    const said = `${i.title} ${i.owner}`.toLowerCase();
    return words.every(w => said.includes(w))
      && (!filters.mine || i.mine)
      && (!filters.week || (!!i.modifiedAt && Date.parse(i.modifiedAt) >= week))
      && (!filters.starred || stars.includes(i.id))
      && (!filters.certified || i.mark?.status === "certified");
  });
  const order = (a: HomeItem, b: HomeItem) => (sort === "name"
    ? a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
    : (Date.parse(b.modifiedAt) || 0) - (Date.parse(a.modifiedAt) || 0) || a.title.localeCompare(b.title));
  return [...kept].sort((a, b) => Number(b.pinned) - Number(a.pinned) || order(a, b));
}

/** When it was last kept, as a person says it: "3 hours ago", "Yesterday", "Nov 3". */
export function modifiedWords(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (!iso || Number.isNaN(then)) return "—";
  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60000));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (minutes < 1) return "Just now";
  if (minutes < 60) return plural(minutes, "minute");
  if (minutes < 1440) return plural(Math.floor(minutes / 60), "hour");
  const days = Math.floor(minutes / 1440);
  if (days === 1) return "Yesterday";
  if (days < 7) return plural(days, "day");
  const date = new Date(then);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

/** A piece's room in a dashboard's miniature: columns of twelve and rows, from what the piece says it takes. */
export function miniatureCell(box: OutlineBox): { columns: number; rows: number } {
  const span = SPAN[(box.size ?? "small") as Size] ?? SPAN.small;
  const whole = box.size === "full" || box.size === "hero";
  const columns = Math.min(12, Math.max(2, box.w ?? (whole ? 12 : span.w * 3)));
  return { columns, rows: Math.min(10, Math.max(1, box.h ?? span.h * 4)) };
}
