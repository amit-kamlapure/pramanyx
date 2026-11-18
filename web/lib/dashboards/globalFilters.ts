/**
 * A dashboard's global filters (format v19; the user, 2026-11-18). Each is one column and one way of choosing from it. What a reader
 * chooses is held with their other choices on the dashboard, so it reaches every card the same way a clicked value does: through the
 * card's own table or the ontology's links, and a card that cannot be cut says why.
 */
import type { GlobalFilterKind } from "@/lib/dashboards/catalog";
import { filterSource, type DashboardFocus, type FocusValue } from "@/lib/dashboards/focus";

export interface GlobalFilterProps {
  title?: string | null; show_title?: boolean | null; description?: string | null; kind: GlobalFilterKind;
  table?: string | null; column?: string | null; allow_all?: boolean | null;
}

export const FILTER_KINDS: { value: GlobalFilterKind; label: string }[] = [
  { value: "multi", label: "Multiple values" }, { value: "single", label: "Single value" }, { value: "date", label: "Date picker" },
  { value: "date_range", label: "Date range picker" }, { value: "text", label: "Text entry" }, { value: "range", label: "Range slider" },
];

/** Whether a column of this kind can be filtered this way: dates by the date pickers, numbers by the slider. */
export function fits(kind: GlobalFilterKind, column: "number" | "date" | "time" | "text"): boolean {
  if (kind === "date" || kind === "date_range") return column === "date" || column === "time";
  return kind === "range" ? column === "number" : true;
}

export type FilterChoice =
  | { kind: "multi"; values: FocusValue[] } | { kind: "single"; value: FocusValue } | { kind: "date"; day: string }
  | { kind: "date_range"; low: string; high: string } | { kind: "text"; words: string } | { kind: "range"; low: number; high: number };

/** What a reader's choice asks of the cards; null when it asks nothing, and the filter stands at All. */
export function focusOfChoice(key: string, p: GlobalFilterProps, choice: FilterChoice): DashboardFocus | null {
  if (!p.table || !p.column) return null;
  const base = { table: p.table, column: p.column, value: "" as FocusValue, label: p.title || undefined, source: { card: filterSource(key), field: p.column } };
  switch (choice.kind) {
    case "multi": return choice.values.length ? { ...base, op: "in", values: choice.values } : null;
    case "single": return { ...base, value: choice.value };
    case "date": return choice.day ? { ...base, op: "dates", low: choice.day, high: choice.day } : null;
    case "date_range": return choice.low || choice.high ? { ...base, op: "dates", low: choice.low || null, high: choice.high || null } : null;
    case "text": return choice.words.trim() ? { ...base, op: "contains", value: choice.words.trim() } : null;
    case "range": return { ...base, op: "between", low: choice.low, high: choice.high };
  }
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
