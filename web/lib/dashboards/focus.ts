/**
 * A dashboard's focus (the board study, 2026-11-16): values a reader chose by clicking a bar, a slice, a point or a tile.
 * Each is the table and column the click was traced to (`POST /cards/{id}/field`) and the value, with the card and field
 * it was chosen on. Every card is asked again cut by it — except the card it was chosen on, which keeps all its marks and
 * lights the chosen one. A reader's own: kept in their browser, per dashboard, never in the dashboard.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

export interface FocusOn { table: string; column: string; value: string | number | boolean }
export interface DashboardFocus extends FocusOn {
  /** The card a value was chosen on, and the field of its chart the click stood for. */
  source: { card: string; field: string };
}

/** As many as the server takes (`dashboards.focus.MAX_FOCUS`). */
export const MAX_FOCUS = 6;

const same = (a: FocusOn, b: FocusOn) => a.table === b.table && a.column === b.column;

/** Choosing a value: the same again takes it off; another value of the same column replaces it; a new column is added. */
export function chooseIn(focus: DashboardFocus[], next: DashboardFocus): DashboardFocus[] {
  const at = focus.findIndex(f => same(f, next));
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

/** What a card is asked with: every chosen value but those chosen on itself. */
export function focusFor(focus: DashboardFocus[], cardId: string): FocusOn[] {
  return focus.filter(f => f.source.card !== cardId).map(({ table, column, value }) => ({ table, column, value }));
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

export const focusWords = (f: FocusOn) => `${f.column.replace(/_/g, " ")} = ${String(f.value)}`;

const KEY = (scope: string) => `pramanyx.dashboard.focus:${scope}`;

function read(scope: string | null): DashboardFocus[] {
  if (!scope) return [];
  try {
    const raw = window.localStorage.getItem(KEY(scope));
    const got = raw ? (JSON.parse(raw) as DashboardFocus[]) : [];
    return Array.isArray(got) ? got.filter(f => f && f.table && f.column && f.source?.card).slice(0, MAX_FOCUS) : [];
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
  const key = useMemo(() => JSON.stringify(focus.map(f => [f.table, f.column, f.value, f.source.card])), [focus]);
  return { focus, setFocus, key };
}
