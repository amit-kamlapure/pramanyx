/**
 * vizConfig — the serializable shape of "how the user wants THIS chart displayed".
 *
 * Every display control in `ResultChartCard` used to be a bare `useState`, so a chart type,
 * a colour binding, a pivot layout or an axis title survived exactly as long as the component
 * stayed mounted. In the Briefing that is brutal: the findings ledger opens one row at a time,
 * so expanding a second row destroyed the first row's edits *without a reload*.
 *
 * This is the one type that crosses the wire. It is stored two ways, both opaque to the backend:
 *   - a PINNED CARD keeps it in `StoredCard.render` (already persisted, already read on mount)
 *   - a card-less chart (ledger row, digest tile, KPI) keeps it in `viz_configs`, keyed by the
 *     insight it is about
 *
 * Every field is optional and absent-means-default, so an untouched chart persists NOTHING and
 * renders byte-identically to before. That is what makes the storage safe to add everywhere:
 * `isEmptyVizConfig` decides whether there is anything worth saving at all.
 */

import type { ChartOptions } from "@/components/charts/chartCustom";
import type { ChartType } from "@/components/charts/chartTypeInference";
import type { ExhibitRefLine } from "@/components/charts/exhibit";
import type { PostprocOp } from "@/lib/api";

export type VizAgg = "sum" | "avg" | "count" | "min" | "max";
export type VizView = "chart" | "table" | "pivot";

export interface VizConfig {
  /** chart ⇄ table ⇄ pivot. */
  view?:        VizView;
  /** "auto" defers to the backend's chart hint — the same as never touching Display. */
  type?:        ChartType | "auto";
  metric?:      string | null;
  dim?:         string | null;
  agg?:         VizAgg | null;
  showLabels?:  boolean;
  /** Colour binding (PR #187): colour marks by a chosen column. */
  colorField?:  string;
  colorScale?:  "" | "continuous" | "categorical";
  colorName?:   string;
  numberFormat?: string;
  legend?:      string;
  xTitle?:      string;
  yTitle?:      string;
  tooltipOff?:  boolean;
  refLines?:    ExhibitRefLine[];
  /** Post-processing transform (PoP / share / rolling / cumulative). */
  transform?:   PostprocOp | "none";
  /** Axis orientation for a bar form — swap the measure and the category between the two
   *  axes. Absent means "let the chart decide": a ranking reads horizontally, a trend over
   *  time reads vertically. Set only when the user has overridden that. */
  orient?:      "vertical" | "horizontal";
  /** The chart options (the dashboards study, R12): a line's shape and its markers, the value axis's range and a
   *  log scale, and a bar's categories by size or by name, and only the largest. Absent means as before. */
  lineShape?:   "smooth" | "step";
  /** An answer's line shows its points unless this says false; a query card's hides them unless it says true. */
  markers?:     boolean;
  yMin?:        number;
  yMax?:        number;
  yLog?:        boolean;
  sortBy?:      "value" | "label";
  top?:         number;
}

/** True when the config carries no user intent — nothing to persist, nothing to restore.
 *  Treated as "reset to default" on save, which DELETES any stored row rather than pinning
 *  a copy of today's default forever. */
export function isEmptyVizConfig(c: VizConfig | null | undefined): boolean {
  if (!c) return true;
  return (
    (c.view === undefined) &&
    (c.type === undefined || c.type === "auto") &&
    !c.metric && !c.dim && !c.agg &&
    !c.showLabels &&
    !c.colorField && !c.colorScale && !c.colorName &&
    !c.numberFormat && !c.legend && !c.xTitle && !c.yTitle &&
    !c.tooltipOff && !c.orient &&
    !c.lineShape && c.markers === undefined && c.yMin === undefined && c.yMax === undefined && !c.yLog &&
    !c.sortBy && !c.top &&
    !(c.refLines && c.refLines.length) &&
    (c.transform === undefined || c.transform === "none")
  );
}

/** The chart options a saved config holds, as the charts read them; null when it holds none. */
export function chartOptionsOf(c: VizConfig | null | undefined): ChartOptions | null {
  if (!c) return null;
  const o: ChartOptions = {
    ...(c.lineShape ? { lineShape: c.lineShape } : {}),
    ...(c.markers !== undefined ? { markers: c.markers } : {}),
    ...(c.yMin !== undefined ? { yMin: c.yMin } : {}),
    ...(c.yMax !== undefined ? { yMax: c.yMax } : {}),
    ...(c.yLog ? { yLog: true } : {}),
    ...(c.sortBy ? { sort: c.sortBy } : {}),
    ...(c.top ? { top: c.top } : {}),
  };
  return Object.keys(o).length ? o : null;
}

/** Structural equality — used to skip a redundant PUT when a re-render re-emits the same
 *  config (React state setters fire on every interaction, not only on real changes). */
export function sameVizConfig(a: VizConfig | null | undefined, b: VizConfig | null | undefined): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}
