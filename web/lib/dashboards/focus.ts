/**
 * A dashboard's focus (the board study, 2026-11-16): values a reader chose by clicking a bar, a slice, a point or a tile.
 * Each is the table and column the click was traced to (`POST /cards/{id}/field`) and the value, with the card and field
 * it was chosen on. Every card is asked again cut by it — except the card it was chosen on, which keeps all its marks and
 * lights the chosen one. A reader's own: kept in their browser, per dashboard, never in the dashboard.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { PRESET_WORDS, rangeOfPreset, type DatePreset } from "@/lib/dashboards/datePresets";

export type FocusValue = string | number | boolean;
/** One value clicked on a mark; or, from a global filter (v19), several values, a range of numbers or days, or words. */
export interface FocusOn {
  table: string; column: string; value: FocusValue;
  op?: "eq" | "in" | "between" | "dates" | "contains";
  values?: FocusValue[];
  low?: string | number | null;
  high?: string | number | null;
  /** How words are matched (v20). */
  match?: "contains" | "exact" | "starts_with";
  case_sensitive?: boolean;
}
export interface DashboardFocus extends FocusOn {
  /** The card a value was chosen on, and the field of its chart the click stood for. */
  source: { card: string; field: string };
  /** What a global filter is called, for the bar that says what the dashboard is filtered by. */
  label?: string;
  /** A date that moves (v20): kept by name, and its days worked out again whenever it is read. */
  preset?: DatePreset;
  /** The one page it cuts (v20), by the page's element; none, every page. */
  page?: string;
}

/** As many as the server takes (`dashboards.focus.MAX_FOCUS`). */
export const MAX_FOCUS = 12;

const same = (a: FocusOn, b: FocusOn) => a.table === b.table && a.column === b.column;
/** Where a global filter's value is held among a reader's choices. */
export const filterSource = (key: string) => `filter:${key}`;
export const fromFilter = (f: DashboardFocus) => f.source.card.startsWith("filter:");

/** Choosing a value: the same again takes it off; another value of the same column replaces it; a new column is added. */
export function chooseIn(focus: DashboardFocus[], next: DashboardFocus): DashboardFocus[] {
  const at = focus.findIndex(f => !fromFilter(f) && same(f, next));
  if (at >= 0) {
    return String(focus[at].value) === String(next.value) ? focus.filter((_, i) => i !== at) : focus.map((f, i) => (i === at ? next : f));
  }
  return [...focus, next].slice(-MAX_FOCUS);
}

/** Whether a dashboard places this card so that its filters do not cut it (v18, the study's R15). */
export function notFiltered(spec: unknown, cardId: string): boolean {
  const elements = (spec as { elements?: Record<string, { type?: string; props?: Record<string, unknown> }> } | null)?.elements ?? {};
  return Object.values(elements).some(e => e?.type === "Card" && e.props?.card === cardId && e.props?.not_filtered === true);
}

/** One choice as the server reads it. */
export function wireFocus({ table, column, value, op, values, low, high, match, case_sensitive }: FocusOn): FocusOn {
  return { table, column, value, ...(op ? { op } : {}), ...(values ? { values } : {}), ...(low != null ? { low } : {}), ...(high != null ? { high } : {}),
    ...(match && match !== "contains" ? { match } : {}), ...(case_sensitive ? { case_sensitive } : {}) };
}

/** What a card is asked with: every chosen value but those chosen on itself. */
export function focusFor(focus: DashboardFocus[], cardId: string): FocusOn[] {
  return focus.filter(f => f.source.card !== cardId).map(wireFocus);
}

type Element = { type?: string; props?: Record<string, unknown>; children?: string[] };
const elementsOf = (spec: unknown) => (spec as { elements?: Record<string, Element> } | null)?.elements ?? {};

/** The pages a card is placed on, by each page's element. */
export function pagesHolding(spec: unknown, cardId: string): Set<string> {
  const elements = elementsOf(spec);
  const holds = (key: string, depth = 0): boolean => {
    const el = elements[key];
    if (!el || depth > 8) return false;
    return (el.type === "Card" && el.props?.card === cardId) || (el.children ?? []).some(k => holds(k, depth + 1));
  };
  return new Set(Object.entries(elements).filter(([key, el]) => el?.type === "Tab" && holds(key)).map(([key]) => key));
}

/** What a card is asked with where the dashboard places it (v20): the filters fixed on it, then what a reader chose, less what it
 *  is set apart from, the filters it ignores, and a filter held to a page it is not on. */
export function focusOfCard(spec: unknown, focus: DashboardFocus[], cardId: string): FocusOn[] {
  const placed = Object.values(elementsOf(spec)).filter(e => e?.type === "Card" && e.props?.card === cardId);
  const fixed = placed.flatMap(e => (e.props?.fixed_filters ?? []) as FocusOn[]).map(f => wireFocus({ ...f, value: f.value ?? "" }));
  if (placed.some(e => e.props?.not_filtered === true)) return fixed.slice(0, MAX_FOCUS);
  const ignored = new Set(placed.flatMap(e => (e.props?.ignores_filters ?? []) as string[]).map(filterSource));
  const pages = focus.some(f => f.page) ? pagesHolding(spec, cardId) : null;
  const chosen = focus.filter(f => !ignored.has(f.source.card) && (!f.page || !!pages?.has(f.page)));
  return [...fixed, ...focusFor(chosen, cardId)].slice(0, MAX_FOCUS);
}

/** The values chosen on a card's own chart for a field — what it lights. */
export function chosenOn(focus: DashboardFocus[], cardId: string, field: string): string[] | null {
  const got = focus.filter(f => f.source.card === cardId && f.source.field === field).map(f => String(f.value));
  return got.length ? got : null;
}

/** A click on a card's mark, chosen for the dashboard: traced off the card's own statement to the table and column it is
 *  read from (`trace`), then chosen — or, when a click on it filters nothing, said (`said`) and nothing chosen. */
export async function traceAndChoose(
  trace: (cardId: string, column: string) => Promise<{ table: string; column: string } | { refused: string }>,
  cardId: string, pick: { field: string; value: string | number | boolean }, focus: DashboardFocus[],
  onFocus: (next: DashboardFocus[]) => void, said: (why: string) => void = () => {},
): Promise<void> {
  const t = await trace(cardId, pick.field);
  if ("refused" in t) { said(t.refused); return; }
  onFocus(chooseIn(focus, { table: t.table, column: t.column, value: pick.value, source: { card: cardId, field: pick.field } }));
}

export function focusWords(f: FocusOn & { label?: string }): string {
  const name = f.label || f.column.replace(/_/g, " ");
  if (f.op === "in") return `${name}: ${(f.values ?? []).slice(0, 3).map(String).join(", ")}${(f.values?.length ?? 0) > 3 ? ` +${(f.values?.length ?? 0) - 3}` : ""}`;
  if (f.op === "contains") return `${name}: “${String(f.value)}”`;
  if ((f as DashboardFocus).preset) return `${name}: ${PRESET_WORDS[(f as DashboardFocus).preset as DatePreset]}`;
  if (f.op === "between" || f.op === "dates") {
    if (f.low != null && f.high != null) return f.low === f.high ? `${name}: ${f.low}` : `${name}: ${f.low} to ${f.high}`;
    return f.low != null ? `${name}: from ${f.low}` : `${name}: up to ${f.high}`;
  }
  return f.label ? `${name}: ${String(f.value)}` : `${name} = ${String(f.value)}`;
}

const KEY = (scope: string) => `pramanyx.dashboard.focus:${scope}`;

const held = (got: unknown): DashboardFocus[] => (Array.isArray(got) ? got : [])
  .filter((f: DashboardFocus) => f && f.table && f.column && f.source?.card).slice(0, MAX_FOCUS)
  // a date that moves is worked out again each time it is read
  .map((f: DashboardFocus) => (f.preset ? { ...f, ...rangeOfPreset(f.preset) } : f));

/** The address parameter a shared view of a dashboard's filters travels in (v20). */
export const FILTERS_PARAM = "filters";
/** Past this an address stops being safe to paste. */
export const MAX_FILTER_LINK = 4000;

const toLink = (text: string) => btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromLink = (text: string) => decodeURIComponent(escape(atob(text.replace(/-/g, "+").replace(/_/g, "/"))));

/** This page's address carrying a reader's choices, or null when they will not fit in one. */
export function filterLink(focus: DashboardFocus[], href: string): string | null {
  const url = new URL(href);
  if (focus.length) url.searchParams.set(FILTERS_PARAM, toLink(JSON.stringify(focus)));
  else url.searchParams.delete(FILTERS_PARAM);
  const out = url.toString();
  return out.length > MAX_FILTER_LINK ? null : out;
}

/** The choices an address carries; read once, then taken out of the address so a reload keeps the reader's own. */
function fromAddress(): DashboardFocus[] | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const carried = url.searchParams.get(FILTERS_PARAM);
  if (!carried) return null;
  url.searchParams.delete(FILTERS_PARAM);
  window.history.replaceState(null, "", url.toString());
  try { return held(JSON.parse(fromLink(carried))); } catch { return null; }
}

function read(scope: string | null): DashboardFocus[] {
  if (!scope) return [];
  try {
    const shared = fromAddress();
    if (shared) {
      window.localStorage.setItem(KEY(scope), JSON.stringify(shared));
      return shared;
    }
    const raw = window.localStorage.getItem(KEY(scope));
    return held(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

/** A dashboard's focus, kept in this reader's browser under `scope` (a connection and a dashboard). `key` changes
 *  exactly when the focus does, for the effects that run cards with it. */
export function useDashboardFocus(scope: string | null) {
  const [focus, setFocusState] = useState<DashboardFocus[]>(() => read(scope));
  useEffect(() => { setFocusState(read(scope)); }, [scope]);
  const setFocus = useCallback((next: DashboardFocus[]) => {
    setFocusState(next);
    if (!scope) return;
    try {
      if (next.length) window.localStorage.setItem(KEY(scope), JSON.stringify(next));
      else window.localStorage.removeItem(KEY(scope));
    } catch { /* a browser that keeps nothing still filters this visit */ }
  }, [scope]);
  const key = useMemo(() => JSON.stringify(focus.map(f => [f.table, f.column, f.value, f.op, f.values, f.low, f.high, f.match, f.case_sensitive, f.page, f.source.card])), [focus]);
  return { focus, setFocus, key };
}
