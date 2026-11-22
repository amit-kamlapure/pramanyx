/**
 * The hover rule's tooltip on a line chart (study R25; the owner, 2026-11-18: "the dotted lines.. such a nice touch").
 *
 * A line chart draws a dashed rule at the date nearest the pointer, a ring on each line there, and one tooltip: the
 * date, then every series' value at it, largest first, each beside its line's colour. Before, a tooltip was per
 * point, one series at a time, so reading three lines at one date took three hovers.
 *
 * The spec carries what the tooltip needs to say (`usermeta.hover`, written by `resolveSpec.ts`): which field is the
 * x and its grain, which fields are the series, and how a value is written — the axis's own format, a percent, or
 * the app's own figure, with the money symbol the axis wears. The rule's rows are marked `__hover`, so the tooltip
 * handler in `VegaChart.tsx` knows a row of this rule from any other mark's datum.
 */
import { format as d3format } from "d3-format";
import { fmtDate, formatDateAs, formatMetricValue, type DateFormat, type Gran } from "@/lib/format";

/** The marker the rule's rows carry; nothing else in a chart's data has it. */
export const HOVER_MARK = "__hover";

export interface HoverMeta {
  /** The x field, as the rows name it. */
  x: string;
  /** The x's grain when it is a date; null when it is a category. */
  gran: Gran | null;
  /** One field per series (the pivoted series' values); a single line has one: its measure. */
  series: string[];
  /** What a single line's one row is called — the axis's title. Null on a multi-line, whose rows are its series. */
  label: string | null;
  /** The axis's d3 format when one was chosen; null writes the app's own figure. */
  format: string | null;
  /** The values are fractions written as percents. */
  pct: boolean;
  /** The money symbol the axis is prefixed with, or "". */
  prefix: string;
  /** How a person chose to write the dates ("Dates as"), when they chose: the hover says the date as the axis does. */
  written?: DateFormat | null;
}

export interface HoverRow {
  name: string;
  value: number | null;
  text: string;
  color: string | null;
}

/** The x as the axis writes it: a date in its grain, anything else as itself. */
export function hoverHead(x: unknown, gran: Gran | null, written?: DateFormat | null): string {
  if (x === null || x === undefined) return "";
  if (gran) {
    const day = x instanceof Date ? x : typeof x === "number" ? new Date(x) : null;
    const iso = day && Number.isFinite(day.getTime()) ? day.toISOString() : String(x);
    // the date as the axis writes it, when a person chose how (2026-11-23: axis "2025-07", hover "Jul 2025")
    return (written ? formatDateAs(iso, written) : null) ?? fmtDate(iso, gran);
  }
  return String(x);
}

/** One value as the axis writes it: its format, a percent, or the app's own figure; a missing value is a dash. */
export function hoverValue(n: number | null, meta: Pick<HoverMeta, "format" | "pct" | "prefix">): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (meta.pct) return d3format(".1%")(n);
  const fmt = meta.format && meta.format.trim() && meta.format !== "~s" ? meta.format : null;
  const body = fmt ? d3format(fmt)(n) : formatMetricValue(n);
  return `${meta.prefix}${body}`;
}

const numberOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Every series at the hovered x, largest first; a series with no value there comes last. */
export function hoverRows(datum: Record<string, unknown>, meta: HoverMeta,
  colorOf: (series: string) => string | null): HoverRow[] {
  const rows = meta.series.map((field) => {
    const value = numberOf(datum[field]);
    const name = meta.series.length === 1 && meta.label ? meta.label : field;
    return { name, value, text: hoverValue(value, meta), color: colorOf(field) };
  });
  return rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
}

/** The tooltip's HTML: the x, then a row per series with its swatch. Every word passes through `esc`. */
export function hoverHtml(datum: Record<string, unknown>, meta: HoverMeta,
  colorOf: (series: string) => string | null, esc: (v: unknown) => string): string {
  const head = hoverHead(datum[meta.x], meta.gran, meta.written);
  const safeColor = (c: string | null) => (c && /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9., %]+\)|hsla?\([0-9., %deg]+\))$/.test(c) ? c : "");
  const rows = hoverRows(datum, meta, colorOf).map((r) => {
    const swatch = safeColor(r.color);
    return `<tr><td class="aug-tip-name"><span class="aug-tip-swatch"${swatch ? ` style="background:${swatch}"` : ""}></span>`
      + `${esc(r.name)}</td><td class="aug-tip-value">${esc(r.text)}</td></tr>`;
  }).join("");
  return `<div class="aug-tip"><div class="aug-tip-head">${esc(head)}</div><table>${rows}</table></div>`;
}

/** The hover meta a spec carries, or null. */
export function hoverMetaOf(spec: Record<string, unknown> | null | undefined): HoverMeta | null {
  const meta = (spec?.usermeta as { hover?: HoverMeta } | undefined)?.hover;
  return meta && typeof meta.x === "string" && Array.isArray(meta.series) ? meta : null;
}
