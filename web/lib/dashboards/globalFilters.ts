/**
 * A dashboard's global filters (format v19; the user, 2026-11-18). Each is one column and one way of choosing from it. What a reader
 * chooses is held with their other choices on the dashboard, so it reaches every card the same way a clicked value does: through the
 * card's own table or the ontology's links, and a card that cannot be cut says why. Since v20 a filter can link to the others, open on
 * a value, name a date that moves, hold to one page, match words exactly and feed a value a query reads.
 */
import type { GlobalFilterKind } from "@/lib/dashboards/catalog";
import { rangeOfPreset, type DatePreset } from "@/lib/dashboards/datePresets";
import { filterSource, fromFilter, wireFocus, type DashboardFocus, type FocusOn, type FocusValue } from "@/lib/dashboards/focus";

export interface FilterOpening {
  values?: FocusValue[] | null; value?: FocusValue | null; low?: string | number | null; high?: string | number | null;
  words?: string | null; preset?: DatePreset | null;
}

export interface GlobalFilterProps {
  title?: string | null; show_title?: boolean | null; description?: string | null; kind: GlobalFilterKind;
  table?: string | null; column?: string | null; allow_all?: boolean | null;
  linked?: boolean | null; opens_with?: FilterOpening | null; match?: "contains" | "exact" | "starts_with" | null;
  case_sensitive?: boolean | null; page?: string | null; parameter?: string | null;
}

export const FILTER_KINDS: { value: GlobalFilterKind; label: string }[] = [
  { value: "multi", label: "Multiple values" }, { value: "single", label: "Single value" }, { value: "date", label: "Date picker" },
  { value: "date_range", label: "Date range picker" }, { value: "text", label: "Text entry" }, { value: "range", label: "Range slider" },
];

export const TEXT_MATCHES: { value: "contains" | "exact" | "starts_with"; label: string }[] = [
  { value: "contains", label: "Contains" }, { value: "exact", label: "Exactly matches" }, { value: "starts_with", label: "Starts with" },
];

/** Whether a column of this kind can be filtered this way: dates by the date pickers, numbers by the slider. */
export function fits(kind: GlobalFilterKind, column: "number" | "date" | "time" | "text"): boolean {
  if (kind === "date" || kind === "date_range") return column === "date" || column === "time";
  return kind === "range" ? column === "number" : true;
}

export type FilterChoice =
  | { kind: "multi"; values: FocusValue[] } | { kind: "single"; value: FocusValue } | { kind: "date"; day: string; preset?: DatePreset }
  | { kind: "date_range"; low: string; high: string; preset?: DatePreset } | { kind: "text"; words: string } | { kind: "range"; low: number; high: number };

/** What a reader's choice asks of the cards; null when it asks nothing, and the filter stands at All. */
export function focusOfChoice(key: string, p: GlobalFilterProps, choice: FilterChoice): DashboardFocus | null {
  if (!p.table || !p.column) return null;
  const base = { table: p.table, column: p.column, value: "" as FocusValue, label: p.title || undefined, source: { card: filterSource(key), field: p.column },
    ...(p.page ? { page: p.page } : {}) };
  switch (choice.kind) {
    case "multi": return choice.values.length ? { ...base, op: "in", values: choice.values } : null;
    case "single": return { ...base, value: choice.value };
    case "date": {
      if (choice.preset) { const { low, high } = rangeOfPreset(choice.preset); return { ...base, op: "dates", low, high, preset: choice.preset }; }
      return choice.day ? { ...base, op: "dates", low: choice.day, high: choice.day } : null;
    }
    case "date_range": {
      if (choice.preset) { const { low, high } = rangeOfPreset(choice.preset); return { ...base, op: "dates", low, high, preset: choice.preset }; }
      return choice.low || choice.high ? { ...base, op: "dates", low: choice.low || null, high: choice.high || null } : null;
    }
    case "text": return choice.words.trim() ? { ...base, op: "contains", value: choice.words.trim(),
      ...(p.match && p.match !== "contains" ? { match: p.match } : {}), ...(p.case_sensitive ? { case_sensitive: true } : {}) } : null;
    case "range": return { ...base, op: "between", low: choice.low, high: choice.high };
  }
}

/** The choice a filter opens on, or null when it opens on All. */
export function openingChoice(p: GlobalFilterProps): FilterChoice | null {
  const o = p.opens_with;
  if (!o) return null;
  switch (p.kind) {
    case "multi": return o.values?.length ? { kind: "multi", values: o.values } : null;
    case "single": return o.value != null && o.value !== "" ? { kind: "single", value: o.value } : null;
    case "date": return o.preset ? { kind: "date", day: "", preset: o.preset } : o.low ? { kind: "date", day: String(o.low) } : null;
    case "date_range": return o.preset ? { kind: "date_range", low: "", high: "", preset: o.preset }
      : o.low || o.high ? { kind: "date_range", low: String(o.low ?? ""), high: String(o.high ?? "") } : null;
    case "text": return o.words?.trim() ? { kind: "text", words: o.words } : null;
    case "range": return typeof o.low === "number" && typeof o.high === "number" ? { kind: "range", low: o.low, high: o.high } : null;
  }
}

const OPENED = (scope: string) => `pramanyx.dashboard.filters-opened:${scope}`;

/** What a reader's choices become when a dashboard's openings are new to them, or null when nothing changes. Once seen, a reader who
 *  clears a filter keeps it cleared, until the author sets a different opening. A choice already held, from a shared link say, stands. */
export function openedWith(scope: string, filters: Record<string, GlobalFilterProps>, focus: DashboardFocus[]): DashboardFocus[] | null {
  const openings = Object.entries(filters).filter(([, p]) => p.table && p.column && openingChoice(p)).sort(([a], [b]) => a.localeCompare(b));
  const said = JSON.stringify(openings.map(([k, p]) => [k, p.table, p.column, p.opens_with]));
  try {
    if (window.localStorage.getItem(OPENED(scope)) === said) return null;
    window.localStorage.setItem(OPENED(scope), said);
  } catch { /* a browser that keeps nothing opens on them each visit */ }
  let next = focus;
  for (const [key, p] of openings) {
    if (heldBy(next, key, p)) continue;
    const opening = focusOfChoice(key, p, openingChoice(p) as FilterChoice);
    if (opening) next = [...next, opening];
  }
  return next === focus ? null : next;
}

/** What the other filters ask of this one's list, when it is linked to them. */
export function narrowedBy(focus: DashboardFocus[], key: string, p: GlobalFilterProps, page?: string | null): FocusOn[] {
  if (p.linked === false) return [];
  return focus.filter(f => fromFilter(f) && f.source.card !== filterSource(key) && (!f.page || !page || f.page === page)).map(wireFocus);
}

/** What a filter's choice is as the dashboard value it feeds; undefined when it holds nothing, and the value goes back to its own. */
export function parameterValue(held: DashboardFocus | null): unknown {
  if (!held) return undefined;
  if (held.op === "in") return held.values;
  if (held.op === "dates") return held.low ?? held.high ?? undefined;
  if (held.op === "between") return held.low ?? undefined;
  return held.value;
}

/** The reader's choices with this filter's replaced. */
export function withFilter(focus: DashboardFocus[], key: string, next: DashboardFocus | null): DashboardFocus[] {
  const rest = focus.filter(f => f.source.card !== filterSource(key));
  return next ? [...rest, next] : rest;
}

/** What this filter holds now, if it still reads the column it was chosen on. */
export function heldBy(focus: DashboardFocus[], key: string, p: GlobalFilterProps): DashboardFocus | null {
  return focus.find(f => f.source.card === filterSource(key) && f.table === p.table && f.column === p.column) ?? null;
}

/** A reader's choices without those of a filter the dashboard no longer holds as it was. */
export function stillHeld(focus: DashboardFocus[], filters: Record<string, GlobalFilterProps>): DashboardFocus[] {
  return focus.filter(f => {
    if (!f.source.card.startsWith("filter:")) return true;
    const p = filters[f.source.card.slice("filter:".length)];
    return !!p && p.table === f.table && p.column === f.column;
  });
}
