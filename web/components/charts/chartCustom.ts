/**
 * chartCustom.ts — "how the user wants THIS chart displayed", as a type.
 *
 * It lived in resolveOption.ts, the ECharts resolver, which made an engine-neutral contract
 * look like an ECharts one — six components imported it from there. Phase 5d retired that
 * file; the contract outlives it unchanged.
 */

import type { DateFormat } from "@/lib/format";

export interface ChartCustom {
  format?: string;        // d3 number format for the quantitative axis (e.g. ",.0f", "$,.2f", "~s")
  colorScheme?: string;   // categorical palette name (a named scheme, e.g. "set2")
  xTitle?: string;
  yTitle?: string;
  legend?: "right" | "bottom" | "top" | "left" | "none";
  tooltip?: "on" | "off"; // hover tooltip visibility (default on); "off" for a clean tile
  /** Swap the axes of a bar form. Absent → the shared rule decides (category reads
   *  horizontally, time reads vertically). */
  orient?: "vertical" | "horizontal";
  /** Post-processing to apply IN the chart rather than to the data beforehand. Only the
   *  Vega path reads this: the ECharts builders take already-transformed rows, which is why
   *  that path still round-trips through /query/postproc. */
  transform?: { op: "pop" | "contribution" | "rolling" | "cumulative"; valueCol: string;
                window?: number; agg?: "mean" | "sum" | "min" | "max" } | null;
  /** The chart options a person sets in the editor (the dashboards study, R12). */
  options?: ChartOptions | null;
  /** How dates are written along the axis ("Dates as"); absent, as the grain writes them. */
  dateFormat?: DateFormat | null;
}

/**
 * What a person may change of how a chart is drawn beyond its kind (study R12): a line's shape and its markers, the
 * value axis's range and a log scale, and a bar's categories by size or by name, and only the largest. Each is unset
 * by default, and unset draws the chart as before. A cut to the largest says so on the chart.
 */
export interface ChartOptions {
  lineShape?: "straight" | "smooth" | "step" | null;
  /** A line's width in pixels; unset, 2. */
  lineWidth?: number | null;
  /** false draws a line without its points. */
  markers?: boolean | null;
  yMin?: number | null;
  yMax?: number | null;
  yLog?: boolean | null;
  /** A bar's categories: largest first, or by name. Dates and periods keep their order. */
  sort?: "value" | "label" | null;
  /** Only the largest this many categories of a bar. */
  top?: number | null;
}
