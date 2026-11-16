/**
 * Band fit — a bar chart fills its row, and its bars stay a readable thickness.
 *
 * Until 2026-11-06 `Chart.tsx` capped the WIDTH of a vertical bar chart with six or fewer
 * categories at `max(340, n × 130 + 150)` px, so three bars would not stretch across a whole
 * panel. It counted categories, not bars: four platforms × two measures drew at 670px, and the
 * rest of the row sat empty — the user's screenshot of a Data Canvas exhibit, and the
 * full-width rule they have stated more than once.
 *
 * The chart now takes the whole row, and what the cap was protecting against — a few bars
 * swelling into slabs, because Vega-Lite fits each bar to its band — is handled where the
 * thickness is decided: the gap BETWEEN categories widens until each bar is at most
 * {@link MAX_BAR_PX}, and never past {@link MAX_BAND_PADDING} of the band, so gaps never
 * dominate. The gap between the bars WITHIN a group (`xOffset`) is a separate Vega-Lite
 * setting and is untouched.
 */

import type { Gran } from "@/lib/format";

/** The thickest a single bar is drawn, in px. */
export const MAX_BAR_PX = 96;
/** Vega-Lite's own default inner padding for a bar's band scale; below it nothing changes. */
export const BASE_BAND_PADDING = 0.1;
/** The most of a band the gap between categories may take. */
export const MAX_BAND_PADDING = 0.6;
/** What a chart's frame takes from its width before the bands: the value axis and a legend. */
export const PLOT_CHROME_PX = 140;

/**
 * The inner band padding that keeps each bar at most {@link MAX_BAR_PX} wide, or `null` when
 * Vega-Lite's default already does (or there is nothing to fit). `width` is the whole chart's.
 */
export function bandPaddingFor(width: number, bands: number, barsPerBand: number): number | null {
  if (!(bands > 0) || !(width > 0)) return null;
  const step = Math.max(1, width - PLOT_CHROME_PX) / bands;
  const group = Math.max(1, barsPerBand) * MAX_BAR_PX;
  const padding = 1 - group / step;
  if (padding <= BASE_BAND_PADDING) return null;
  return Math.round(Math.min(MAX_BAND_PADDING, padding) * 100) / 100;
}

/**
 * How many bars share one band: the distinct values of the `xOffset` field on a grouped bar
 * (the folded measures when the measures are the series), else one.
 */
export function barsPerBand(spec: Record<string, unknown>, columns: string[], rows: unknown[][]): number {
  const enc = spec.encoding as Record<string, { field?: string }> | undefined;
  const field = enc?.xOffset?.field;
  if (!field) return 1;
  if (field === "__measure") {
    const fold = (spec.transform as { fold?: unknown[] }[] | undefined)?.find((t) => Array.isArray(t.fold))?.fold;
    return Math.max(1, fold?.length ?? 1);
  }
  const i = columns.indexOf(field);
  return i < 0 ? 1 : Math.max(1, new Set(rows.map((r) => r[i])).size);
}

/** The days in one period of each grain a bar is fitted to, on average. A sub-day grain keeps Vega-Lite's own bar. */
const PERIOD_DAYS: Partial<Record<Gran, number>> = { day: 1, week: 7, month: 30.436875, quarter: 91.310625, year: 365.2425 };
const DAY_MS = 86_400_000;

/**
 * How many periods of `gran` a series spans, first to last — a period with no row still counts, so a missing month
 * keeps its place. Null for a sub-day grain, or values that are not dates.
 */
export function periodsSpanned(gran: Gran | null, values: unknown[]): number | null {
  const days = gran ? PERIOD_DAYS[gran] : undefined;
  if (!days) return null;
  const ts = values.map((v) => (v instanceof Date ? v.getTime() : Date.parse(String(v ?? "")))).filter(Number.isFinite);
  if (!ts.length) return null;
  return Math.round((Math.max(...ts) - Math.min(...ts)) / (days * DAY_MS)) + 1;
}

/**
 * A bar on a TIME scale, fitted to its period.
 *
 * A time scale has no band, so Vega-Lite draws a bar on one 5px wide whatever its period: eight months of revenue read
 * as eight hairlines a hundred pixels apart (2026-11-16). Each bar takes its period instead, by the rule a category's
 * band keeps above: the step is the plot over the periods the series spans, and a bar is at most {@link MAX_BAR_PX},
 * never under `1 − MAX_BAND_PADDING` of its step and never over `1 − BASE_BAND_PADDING` of it. Half a step of padding at
 * each end of the scale keeps the first and last bars inside the plot, each centred on its period's tick.
 *
 * Both are expressions over the plot's own `width` (`height` for a bar lying down), so the spec stays plain JSON and
 * fits whatever size it is drawn at.
 */
export function timeBarFit(periods: number, along: "width" | "height" = "width"):
    { size: { expr: string }; padding: { expr: string } } {
  const step = `(${along} / ${Math.max(1, periods)})`;
  const least = Math.round((1 - MAX_BAND_PADDING) * 100) / 100;
  const most = Math.round((1 - BASE_BAND_PADDING) * 100) / 100;
  return {
    size: { expr: `max(${least} * ${step}, min(${most} * ${step}, ${MAX_BAR_PX}))` },
    padding: { expr: `${step} / 2` },
  };
}

/** `spec` with the padding written into its own config (a spec's config wins over the theme's). */
export function withBandPadding(spec: Record<string, unknown>, padding: number | null): Record<string, unknown> {
  if (padding == null) return spec;
  const config = (spec.config as Record<string, unknown> | undefined) ?? {};
  const scale = (config.scale as Record<string, unknown> | undefined) ?? {};
  // Three names for one gap: a bar's band, any other band, and a band that holds a group (`xOffset`) —
  // Vega-Lite reads the last for a grouped bar and ignores the first two there (its default is 0.2).
  return { ...spec, config: { ...config, scale: { ...scale, barBandPaddingInner: padding, bandPaddingInner: padding,
                                                  bandWithNestedOffsetPaddingInner: padding } } };
}
