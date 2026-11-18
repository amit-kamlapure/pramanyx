/**
 * A table's number column drawn as a bar or a colour scale (dashboard format v17; the dashboards study, R10).
 *
 * A bar runs the length of its value against the largest in the column — a negative in the threshold red, from the
 * same edge. A scale washes a cell from faint at the column's lowest to strong at its highest. Both are worked out
 * from the rows the table holds, said in the panel, and use the first series colour and the tones: never a colour a
 * person types, and never a rule of the person's own (what a value MEANS is coloured by a declared segment, which the
 * objects table already marks).
 */
import type { CSSProperties } from "react";
import { COLUMN_LOOKS, type ColumnLook } from "@/lib/dashboards/catalog";

export type ColumnLooks = Record<string, ColumnLook>;
export interface ColumnRange { min: number; max: number }

/** A table's column looks, from its props; null when it has none. */
export function looksOf(props: Record<string, unknown> | null | undefined): ColumnLooks | null {
  const raw = props?.columns_look;
  if (!raw || typeof raw !== "object") return null;
  const out = Object.fromEntries(Object.entries(raw as Record<string, unknown>)
    .filter((e): e is [string, ColumnLook] => (COLUMN_LOOKS as readonly unknown[]).includes(e[1])));
  return Object.keys(out).length ? out : null;
}

const numberOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Each looked column's lowest and highest number over the rows the table holds; a column with none is left out. */
export function columnRanges(columns: string[], rows: unknown[][], looks: ColumnLooks | null): Record<string, ColumnRange> {
  const out: Record<string, ColumnRange> = {};
  for (const name of Object.keys(looks ?? {})) {
    const i = columns.indexOf(name);
    if (i < 0) continue;
    const values = rows.map(r => numberOf(r[i])).filter((n): n is number => n !== null);
    if (values.length) out[name] = { min: Math.min(...values), max: Math.max(...values) };
  }
  return out;
}

/** How one cell is drawn by its column's look, or null for a plain cell (no look, no number, no range). */
export function cellLook(v: unknown, look: ColumnLook | undefined, range: ColumnRange | undefined): CSSProperties | null {
  const n = numberOf(v);
  if (!look || !range || n === null) return null;
  if (look === "bar") {
    const extent = Math.max(Math.abs(range.min), Math.abs(range.max));
    if (extent === 0) return null;
    const pct = Math.round((Math.abs(n) / extent) * 1000) / 10;
    const tone = n < 0 ? "var(--chart-threshold-crit)" : "var(--chart-1)";
    return { backgroundImage: `linear-gradient(to right, color-mix(in srgb, ${tone} 30%, transparent) ${pct}%, transparent ${pct}%)` };
  }
  const t = range.max === range.min ? 0.5 : (n - range.min) / (range.max - range.min);
  return { backgroundColor: `color-mix(in srgb, var(--chart-1) ${Math.round(6 + 44 * t)}%, transparent)` };
}
