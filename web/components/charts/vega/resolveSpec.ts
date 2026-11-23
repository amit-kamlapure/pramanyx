/**
 * resolveSpec.ts — TIER 1 of the control ladder: (finding data + hint + customization)
 * → a Vega-Lite spec. The Vega-side twin of resolveOption.ts, deliberately built on the
 * SAME shared primitives (classifyColumns, inferChartType) so a Phase 1 comparison shows
 * the difference between two ENGINES and not between two chart-selection systems.
 *
 * Scope is the six types the ledger says are ~99% of everything Pramanyx has ever charted:
 * bar, bar_horizontal, line, multi_line, counter, pie — plus the `auto` deferral, which is
 * 27.7% of persisted answers on its own.
 *
 * Pure: no React, no DOM, no theme. The theme arrives as `config` at render time, which is
 * what lets a spec be STORED and still follow today's tokens. Note what is absent: there is
 * not one function in the output. Today's ECharts path carries 43 function-valued fields,
 * which is precisely why a resolved chart cannot be persisted.
 */

import { cleanLabel, detectGranularity, fmtDate, type DateFormat } from "@/lib/format";
import { currencySymbol, effectiveCurrencySymbol, isMoneyColumn } from "@/lib/orgSettings";
import { classifyColumns, isIdLike, isNumberPeriod, isNumeric, isPriorPeriodCol, isUngraphableGrid, percentRates, plottedMeasures,
         tooFewToCompare, uniqueLabelBand, CHANGE_METRIC_COL, HORIZONTAL_MAX_CATS, PERCENT_CHANGE_COL,
         TOO_FEW_TO_COMPARE } from "@/components/charts/columnRoles";
import { EXTENDED_TYPES, resolveExtendedForm } from "@/components/charts/vega/forms";
import { sanitizeExhibit, type ExhibitSpec } from "@/components/charts/exhibit";
import { inferChartType, HINT_TO_TYPE, type ChartType } from "@/components/charts/chartTypeInference";
import { applyNames, type SeriesNames } from "@/components/charts/vega/names";
import { periodsSpanned, timeBarFit } from "@/components/charts/vega/bandFit";
import { dateAxisAs, utcScale } from "@/components/charts/vega/timeAxis";
import { SI_LABEL, SI_TEXT } from "@/components/charts/vega/compact";
import { emphasisOpacity as emphasisOn } from "@/components/charts/vega/emphasis";
import { HOVER_MARK, type HoverMeta } from "@/components/charts/vega/hoverTooltip";
import type { ChartOptions } from "@/components/charts/chartCustom";

/** The four post-processing ops the edit panel offers, mirroring pramanyx/tools/postproc.py. */
export type TransformOp = "pop" | "contribution" | "rolling" | "cumulative";

export interface TransformSpec {
  op: TransformOp;
  /** The measure being transformed. */
  valueCol: string;
  /** Trailing window for `rolling` (default 3). */
  window?: number;
  /** Aggregate for `rolling` (default mean). */
  agg?: "mean" | "sum" | "min" | "max";
}

/**
 * Build the Vega-Lite transform for one post-processing op, plus the name of the column it
 * derives. The names match pramanyx/tools/postproc.py EXACTLY, so a chart looks identical
 * whether the numbers were computed here or by the API.
 *
 * Why this exists: applying a transform today POSTs the entire result set to
 * /query/postproc and waits for transformed rows to come back, so choosing "cumulative" on
 * a 10k-row chart ships 10k rows over the network to compute a running total. Declared in
 * the spec, the same maths runs in the chart's own dataflow — no round trip, and the
 * transform travels WITH the spec instead of being a mutation that happened to the data
 * before the chart ever saw it.
 *
 * The edge semantics are copied deliberately, not approximated:
 *   pop         null on the first row, and where the previous value is 0 or missing
 *   contribution fraction of the non-null total; all null when that total is 0
 *   rolling     null until the window FILLS, and null if any point inside it is missing
 *   cumulative  nulls contribute 0 and the running total continues (never null)
 */
function transformBlocks(t: TransformSpec): { transform: Record<string, unknown>[]; derived: string } {
  const v = t.valueCol;
  switch (t.op) {
    case "pop": {
      const derived = `${v}_pct_change`;
      return {
        derived,
        transform: [
          { window: [{ op: "lag", field: v, as: "__prev" }] },
          { calculate: `datum.__prev === null || datum.__prev === 0 || datum['${v}'] === null ? null : (datum['${v}'] - datum.__prev) / datum.__prev`,
            as: derived },
        ],
      };
    }
    case "contribution": {
      const derived = `${v}_pct_of_total`;
      return {
        derived,
        transform: [
          { joinaggregate: [{ op: "sum", field: v, as: "__total" }] },
          { calculate: `datum.__total === 0 || datum['${v}'] === null ? null : datum['${v}'] / datum.__total`,
            as: derived },
        ],
      };
    }
    case "rolling": {
      const w = Math.max(1, t.window ?? 3);
      const agg = t.agg ?? "mean";
      const derived = `${v}_rolling_${agg}${w}`;
      return {
        derived,
        transform: [
          // `valid`, NOT `count`: Vega's count ignores its field and counts ROWS, so a window
          // holding a null still counted as full and produced a mean over the points that
          // happened to be there — 95 where the API returns null. `valid` counts non-null
          // values, which catches both edge rules at once: at the start of the series the
          // frame is short, and mid-series a missing point makes it short too.
          { window: [{ op: agg, field: v, as: "__roll" }, { op: "valid", field: v, as: "__cnt" }],
            frame: [-(w - 1), 0] },
          { calculate: `datum.__cnt < ${w} ? null : datum.__roll`, as: derived },
        ],
      };
    }
    default: {
      const derived = `${v}_cumulative`;
      // Vega's sum skips nulls and returns 0 for an empty frame, which is exactly
      // "nulls contribute 0, the running value keeps going".
      return {
        derived,
        transform: [{ window: [{ op: "sum", field: v, as: derived }], frame: [null, 0] }],
      };
    }
  }
}

export interface ResolveSpecArgs {
  columns: string[];
  rows: unknown[][];
  /** What the model's cryptic columns read as (`names.ts`) — laid over the resolved spec, never
   *  renamed into the columns this resolver classifies by. */
  names?: SeriesNames | null;
  /** Backend hint (`bar_horizontal`, `auto`, …) or an internal ChartType. */
  chartType?: string | null;
  /** d3-format string for the quantitative axis, e.g. ",.0f" / "$,.2f" / "~s". */
  format?: string | null;
  xTitle?: string | null;
  yTitle?: string | null;
  /** Show a value label on each mark. Off by default — never a number on every point. */
  showLabels?: boolean;
  /** Chart title. Absent → no title block. */
  title?: string | null;
  /** Swap the axes of a bar form. Absent → the shared rule decides. */
  orient?: "vertical" | "horizontal" | null;
  /** Post-processing applied IN the spec rather than to the data before it. */
  transform?: TransformSpec | null;
  /** The backend's exhibit spec — chart SEMANTICS, never data. */
  exhibit?: ExhibitSpec | Record<string, unknown> | null;
  /** Authoritative per-column display unit, e.g. {"leakage_rate": "percent"}. */
  columnUnits?: Record<string, string> | null;
  /** The measure the USER chose (Query Builder / viz editor). When present and in
   *  `columns`, it wins over type inference — without this, a multi-numeric frame let
   *  inference pick its own y (binding Color to total_volume silently replaced the
   *  plotted gross_margin_pct). */
  measure?: string | null;
  /** What a person set in the editor beyond the kind (study R12): line shape and markers, axis range and log, a
   *  bar's sort and top N. */
  options?: ChartOptions | null;
  /** How the dates along a time axis are written ("Dates as"); absent, as the grain writes them. */
  dateFormat?: DateFormat | null;
}

export interface ResolvedSpec {
  spec: Record<string, unknown>;
  defaultH: number;
  /** Which tier produced this. Tier 1 is re-resolvable from intent; 2 and 3 are verbatim. */
  tier: 1;
  /** The type actually rendered, after `auto` resolves. */
  resolved: string;
  /** Distinct categories on a VERTICAL band axis, else 0. Chart.tsx caps the width of a
   *  few-category vertical bar so three bars do not stretch across a whole panel; that cap
   *  used to read `option.xAxis.data`, which only exists on one engine. */
  xCategories: number;
}

/**
 * Click-to-select, declared once and shared by every plotted form.
 *
 * Clicking a mark keeps it at full strength and drops everything else to a wash; clicking
 * the background clears it. Because the selection is a PARAMETER of the spec rather than an
 * event handler, it costs no JavaScript, it survives being persisted, and — the part that
 * matters on a combo — a click on a bar dims the matching point on the OTHER series too,
 * since both layers read the same param. Wiring that by hand across layers is what makes
 * cross-highlighting expensive in an imperative chart library.
 *
 * `empty: true` (the default) is deliberate: with nothing selected the param matches every
 * mark, so an untouched chart renders at full opacity exactly as before.
 *
 * ⚠ It must be declared on exactly ONE unit spec. Vega-Lite pushes a top-level param down
 * into every layer of a layered spec, and the compiled Vega then carries two signals with
 * the same name — "Duplicate signal name: picked_tuple" — which does not merely lose the
 * interaction, it fails the parse and renders NOTHING. That is what a line chart (line +
 * point layers) and a labelled bar did until this was moved onto a single layer.
 */
const SELECT_PARAM = (field: string) => ({
  name: "picked",
  select: { type: "point", on: "click", fields: [field], clear: "dblclick" },
});

/** The x nearest the pointer, on a line chart (study R25): the hover rule's and the rings' param. `nearest` makes Vega
 *  draw a voronoi over the rule, so the pointer anywhere in the plot finds its x. Cleared when the pointer leaves. */
const HOVER_PARAM = (field: string) => ({
  name: "hover",
  select: { type: "point", fields: [field], nearest: true, on: "pointermove", clear: "pointerout" },
});

/** Opacity, conditioned on the selection. No colour literal: the de-emphasis is a wash, not
 *  a second hue, so nothing about the theme is baked into a spec that may be stored. */
const SELECT_OPACITY = { condition: { param: "picked", value: 1 }, value: 0.28 };

/** Rows-as-arrays → rows-as-objects, the shape Vega-Lite consumes directly. */
function toRecords(columns: string[], rows: unknown[][]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
}

/** The same for a change chart's period bars, whose labels are already "Sep 2025" — each kept whole as
 *  the bar's value, drawn as its month, with the year beneath on the first and on January. */
function compactPeriodLabels(labels: string[]): Record<string, unknown> {
  if (labels.length <= 6 || labels.length > 18) return {};
  const first = labels[0].replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return { labelExpr: `(datum.value == '${first}' || indexof(datum.value, 'Jan ') == 0) ? split(datum.value, ' ') : slice(datum.value, 0, 3)` };
}

/** The value-axis number format. `~s` (SI) is the default because warehouse measures are
 *  large and an unformatted axis reads as noise. A caller's format always wins. */
function valueFormat(format?: string | null): string {
  return format && format.trim() ? format : "~s";
}

/** Value axis: no domain line, horizontal grid. Band axis: domain line, no grid. */
function valueAxis(title: string | null | undefined, format?: string | null, prefix = "") {
  return {
    // An axis says what it measures. The reference labels both ("Values", "Date"); an
    // unlabelled axis makes the reader infer the measure from the title or the legend.
    // A caller-supplied title always wins; null means "use the field name".
    title: title ?? null, format: valueFormat(format),
    labelExpr: SI_LABEL(valueFormat(format), prefix),
    grid: true, domain: false,
    // tickCount belongs HERE, not in the config's axisY: on a horizontal bar the value
    // axis is X, so a count set per-orientation silently stops applying and the axis
    // grows a tick every half-unit.
    tickCount: 5,
    // Grid BEHIND the marks. Vega-Lite lifts a gridded axis above the marks by default,
    // which drew ruled lines straight through the bars.
    zindex: 0,
    // A label near either end aligns to it rather than centring past it. Flush applies within 1px by
    // default, and the headroom bar labels get left Q2's last tick ~14px short of the end: "250.0K",
    // centred, ran past the chart's edge and was cut (2026-10-03). 24px is half the widest compact label.
    labelFlush: 24,
  };
}
function bandAxis(title: string | null | undefined) {
  return { title: title ?? null, grid: true, domain: true, zindex: 0 };
}

/** Humanised field name for an axis or legend title, via the app's one labeller. */
/** The value axis's scale from the editor's options (study R12): a range a person set, and a log scale where every
 *  value is above zero (a log of zero or less is no scale at all, so it is not drawn as one). */
function valueScale(opts: ChartOptions, values: number[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof opts.yMin === "number" && Number.isFinite(opts.yMin)) out.domainMin = opts.yMin;
  if (typeof opts.yMax === "number" && Number.isFinite(opts.yMax)) out.domainMax = opts.yMax;
  if (opts.yLog && values.length && values.every((v) => v > 0)) { out.type = "log"; out.zero = false; }
  if (out.domainMin !== undefined || out.domainMax !== undefined) out.clamp = true;
  return out;
}

function axisTitle(explicit: string | null | undefined, field: string): string {
  return explicit && explicit.trim() ? explicit : cleanLabel(field);
}

/**
 * Resolve one chart. Returns null where there is no honest chart to draw — the same
 * verdict the ECharts resolver reaches, so both engines refuse the same data.
 */
export function resolveVegaSpec(args: ResolveSpecArgs): ResolvedSpec | null {
  const resolved = resolveUnnamed(args);
  return resolved && args.names ? { ...resolved, spec: applyNames(resolved.spec, args.names) } : resolved;
}

function resolveUnnamed(args: ResolveSpecArgs): ResolvedSpec | null {
  const { columns, rows, chartType, format, xTitle, yTitle, showLabels = false, title, orient,
          transform, exhibit: exhibitRaw, columnUnits, measure: chosenMeasure, dateFormat = null } = args;
  const opts: ChartOptions = args.options ?? {};
  const topN = typeof opts.top === "number" && opts.top > 0 ? Math.floor(opts.top) : 0;
  // Fail-open on a malformed spec: a bad exhibit costs its semantics, never the chart —
  // the same contract the ECharts resolver held.
  const exhibit = sanitizeExhibit(exhibitRaw as Parameters<typeof sanitizeExhibit>[0]);
  if (!rows?.length || !columns?.length) return null;

  const hint = String(chartType ?? "auto").toLowerCase();
  if (hint === "none") return null;

  /**
   * The chart-grammar gate, applied to EVERY hint and not only to `auto`.
   *
   * A summary-statistics profile (min/max/mean/std/p1/p99), a grid of four or more measures,
   * or a category column with one constant value has no honest chart in it — grouped
   * micro-bars over min and std say nothing. `inferChartType` consults this gate, so the
   * auto path was covered; an explicit "bar" hint walked straight past it and drew the
   * meaningless chart anyway.
   */
  if (isUngraphableGrid(columns, rows)) return null;

  const { dateIdxs, numericIdxs, catIdxs } = classifyColumns(columns, rows);
  const dateCol = dateIdxs.length ? columns[dateIdxs[0]] : undefined;
  /**
   * The date column drawn on a TIME scale — none when its periods are plain numbers (`isNumberPeriod`): FY2026 on
   * a time scale is 2.026 seconds past 1970. A number period is still the time dimension (the x, the band, upright),
   * drawn as an ordinal band: one even band per period, read below as numbers and in period order.
   */
  const numberPeriod = dateIdxs.length > 0 && isNumberPeriod(rows, dateIdxs[0]);
  const timeCol = numberPeriod ? undefined : dateCol;
  /**
   * An ID is numeric and is never the answer. `franchiseID` sorts ahead of `revenue` in
   * column order, so taking the first numeric column plotted the identifier and labelled the
   * axis "franchiseID" — a chart of row numbers. Identifier-shaped names are dropped from
   * the measure candidates; if that leaves nothing, the full set stands rather than refusing.
   */
  const _allNum = numericIdxs.map((i) => columns[i]);
  const _realNum = _allNum.filter((c) => !isIdLike(c) && !/(^|_)(id)$/i.test(c));
  const numCols = _realNum.length ? _realNum : _allNum;
  // The measure an explicit hint plots when nothing chose one: the first the chart would plot
  // under `auto` too — never a rate's own numerator ahead of the rate.
  const firstMeasure = plottedMeasures(columns, rows, numericIdxs)
    .map((i) => columns[i]).find((c) => numCols.includes(c)) ?? numCols[0];
  /**
   * An identifier can be categorical too. `franchiseID` holds 1 and 2, which classifies as a
   * dimension, and taking the first one labelled the axis "1, 2" while `franchise_name` sat
   * unused beside it — a ranking of row numbers. Identifier-shaped names lose to real ones.
   */
  const _allCat = catIdxs.map((i) => columns[i]);
  const _realCat = _allCat.filter((c) => !isIdLike(c) && !/(^|_)(id)$/i.test(c));
  const catCols = _realCat.length ? _realCat : _allCat;
  if (!numCols.length) return null;

  // `auto` defers to the ONE shared inference — the same function the ECharts path calls, and
  // it returns the COLUMNS too, so the two engines cannot disagree about what to draw either.
  // A null verdict is the ungraphable-grid gate: no honest chart, same as the ECharts resolver.
  const inferred = hint === "auto" ? inferChartType(columns, rows) : null;
  if (hint === "auto" && !inferred) return null;

  let type: string = hint;
  if (inferred) type = inferred.type as ChartType;
  // `combo` is a dual-axis form §6 bans and the exhibit grammar retired, but inference can
  // still name it on a two-measure result. It renders as a grouped bar: same two measures,
  // one scale, no second axis to mislead with.
  if (type === "combo") type = "grouped-bar";
  // HINT_TO_TYPE collapses `pareto` to `bar` — true of the ECharts path, where a pareto WAS
  // a bar with a second axis bolted on. Here it is its own form, so it must survive the map.
  else if (HINT_TO_TYPE[hint] && hint !== "bar_horizontal" && !EXTENDED_TYPES.has(hint)) type = HINT_TO_TYPE[hint];
  // ORIENTATION IS A SHARED RULE, not a per-engine habit. resolveOption.ts renders BOTH
  // `bar` and `bar_horizontal` horizontally whenever x is categorical (a ranking reads
  // down, and category labels need the room), and vertically when x is time (a trend reads
  // across). Only `bar_vertical` forces the upright form. Encoding the same rule here is
  // what stops the Phase 2 diff from flagging every explicit `bar` as a regression.
  // An explicit bar over a result whose first label repeats beside a label each row owns takes
  // the owned label as its band and the repeating one as its colour — as `auto` does.
  const ownBand = !inferred && /^bar/.test(hint)
    ? uniqueLabelBand(columns, rows, catIdxs, plottedMeasures(columns, rows, numericIdxs)) : null;
  const bandCol = inferred ? columns[inferred.xCol]
    : ownBand ? columns[ownBand.band] : (catCols[0] ?? dateCol);
  const isTimeX = bandCol === dateCol;
  // Density decides too: past HORIZONTAL_MAX_CATS distinct categories a lying-down ranking
  // either shrinks below legibility or needs a scrollbar, so it stands up.
  const bandCount = bandCol ? new Set(rows.map((r) => r[columns.indexOf(bandCol)])).size : 0;
  // A user override beats the rule; absent, the rule decides.
  const horizontal = orient
    ? orient === "horizontal"
    : (hint !== "bar_vertical" && !isTimeX && bandCount <= HORIZONTAL_MAX_CATS);

  /**
   * Tier 1 draws SIX types and refuses everything else.
   *
   * This gate is the difference between a fallback and a lie. Without it the function fell
   * through to its bar branch for any unknown type, so a `scatter` rendered as a bar chart:
   * a well-formed, correctly-themed, entirely wrong picture that no engine-parity screenshot
   * would flag, because both engines drew something. Refusing lets Chart.tsx fall back to
   * ECharts, which still draws scatter, heatmap, treemap, sankey and the rest correctly.
   */
  const SUPPORTED = new Set(["bar", "bar_horizontal", "bar_vertical", "line", "multi-line",
                             "multi_line", "area", "counter", "pie"]);
  if (!SUPPORTED.has(type) && !EXTENDED_TYPES.has(type)) return null;

  /**
   * Percent units, scaled ONCE from the column's own values.
   *
   * A "percent" column arrives either as a fraction (0.61) or already scaled (2.6 meaning
   * 2.6%), and the two cannot be told apart per-tick — testing each value is what produced
   * the broken axis reading "0.0% 50.0% 100.0% 1.5%". The column decides: if nothing exceeds
   * 1.5 the values are fractions and Vega-Lite's own `%` format (which multiplies by 100)
   * applies; otherwise they are already scaled and are divided back down first, so 2.6 stays
   * 2.6% and never becomes 260%.
   */
  /**
   * What a money axis is prefixed with. A per-column `currency:CHF` hint is the SOURCE
   * currency and is authoritative — the warehouse said so. Absent that, a money-named
   * column carries the connection's effective symbol, so a PDF axis cannot read a bare
   * "34.7M" while the app beside it reads "CHF 34.7M".
   */
  const moneyPrefix = (col: string): string => {
    const unit = String(columnUnits?.[col] ?? "").trim();
    if (unit.toLowerCase().startsWith("currency:")) {
      const code = unit.slice("currency:".length).trim();
      return code ? `${currencySymbol(code) || code} ` : "";
    }
    /**
     * A DECLARED unit that is not a currency settles it: this column is not money,
     * whatever its name reads like.
     *
     * `isMoneyColumn` is a guess from the NAME, and the name is routinely the metric's
     * name rather than the aggregate's. Measured on a real report (2026-09-23): a scan
     * whose own headline was "the metric is an item count, not a COGS amount" drew every
     * axis as "$36.3K" — because the column was called `total_cost_of_goods_sold_cogs`
     * while holding COUNT(id). The charts contradicted the finding they illustrated, and
     * declaring `unit: "count"` changed nothing, because only `currency:` was ever read.
     *
     * Same rule as `orgsettings.resolve_currency`, one layer up: a symbol in front of a
     * number is a claim about what the number IS, so a declaration outranks an inference
     * — and nothing here converts, so a wrong symbol is a wrong figure.
     */
    if (unit) return "";
    return isMoneyColumn(col) ? effectiveCurrencySymbol() : "";
  };

  /**
   * A declared unit decides. With none declared, a rate whose numerator and denominator sit
   * beside it in the result is a share of a whole, and reads as one: the Agent's own queries
   * carry no units, and its repeat rate drew an axis of 0.07 … 0.12.
   */
  const ratePercent = percentRates(columns, rows, numericIdxs);
  const measureIsPercent = (col: string): boolean => {
    const unit = String(columnUnits?.[col] ?? "").toLowerCase();
    return unit === "percent" || (!unit && (ratePercent.has(col)
      || (CHANGE_METRIC_COL.test(col) && PERCENT_CHANGE_COL.test(col))));    // `pct_change`, `growth_rate`
  };
  const percentAlreadyScaled = (col: string): boolean => {
    if (!columnUnits?.[col] && ratePercent.has(col)) return ratePercent.get(col) === true;
    const i = columns.indexOf(col);
    if (i < 0) return false;
    const vals = rows.map((r) => Number(r[i])).filter((v) => Number.isFinite(v));
    return vals.some((v) => Math.abs(v) > 1.5);
  };

  const data = { values: toRecords(columns, rows) };
  /**
   * A number period is read as a number — "2026" and 2026 are one year, and month 2 sorts before month 10 — and
   * its rows in period order, so a band that keeps data order and one that sorts its own domain agree, and a line
   * runs left to right. A row with no period goes last.
   */
  if (numberPeriod && dateCol) {
    for (const d of data.values) if (isNumeric(d[dateCol])) d[dateCol] = Number(d[dateCol]);
    const at = (d: Record<string, unknown>) => (typeof d[dateCol] === "number" ? d[dateCol] as number : Infinity);
    data.values.sort((a, b) => at(a) - at(b));
  }

  /**
   * Ranking order is applied to the DATA, not to the encoding.
   *
   * `sort: {field, order}` on a band encoding is silently discarded the moment a spec has
   * more than one layer — value labels, a reference line — because the layers union the
   * scale's domain and Vega-Lite will not union a sort. It warns and carries on, so
   * `exhibit.order: "asc"` produced a chart identical to the default. Sorting the rows
   * cannot be dropped by anything downstream.
   */
  function orderedValues(measureCol: string, asc: boolean): Record<string, unknown>[] {
    const vals = [...data.values];
    vals.sort((a, b) => {
      const av = Number(a[measureCol]); const bv = Number(b[measureCol]);
      if (!Number.isFinite(av) || !Number.isFinite(bv)) return 0;
      return asc ? av - bv : bv - av;
    });
    return vals;
  }

  // A transform replaces the plotted measure with the column it derives, and rides on the
  // spec so it persists with the chart's intent instead of being a mutation applied to the
  // rows before the chart ever saw them.
  const tf = transform && columns.includes(transform.valueCol) ? transformBlocks(transform) : null;
  // An explicit user choice outranks inference; a transform outranks both (it derives
  // the column it plots). Only with neither does inference pick the y.
  const userMeasure = chosenMeasure && columns.includes(chosenMeasure) ? chosenMeasure : null;
  const band = inferred ? columns[inferred.xCol]
    : ownBand ? columns[ownBand.band] : (catCols[0] ?? dateCol ?? columns[0]);
  /**
   * The measure is never the column the bars are broken down by. A breakdown by a NUMBER — review score 1 to 5,
   * with no text or date column beside it — falls back to the first column as its band, and the first measure is
   * that same column: "review count by review score" drew review_score against itself and the count was never
   * plotted (the coworker, 2026-11-14). The measure is then the next number that is not the band.
   */
  const measureNotBand = firstMeasure === band ? (numCols.find((c) => c !== band) ?? firstMeasure) : firstMeasure;
  const measure = tf ? tf.derived
    : (userMeasure ?? (inferred?.yCols?.length ? columns[inferred.yCols[0]] : measureNotBand));
  const inferredSeries = inferred?.colorCol != null ? columns[inferred.colorCol]
    : ownBand?.group !== undefined ? columns[ownBand.group] : undefined;
  const base: Record<string, unknown> = { $schema: "https://vega.github.io/schema/vega-lite/v6.json", data };
  if (tf) base.transform = tf.transform;
  if (title) base.title = title;

  // ---- the forms beyond the everyday six ------------------------------------------------
  if (EXTENDED_TYPES.has(type)) {
    const ext = resolveExtendedForm(type, {
      columns, rows, data, numCols, catCols, dateCol, timeCol, measure, band,
      format, xTitle, yTitle, showLabels, base, exhibit,
      plotted: (inferred?.yCols?.length ? inferred.yCols : plottedMeasures(columns, rows, numericIdxs))
        .map((i) => columns[i]).filter((c) => numCols.includes(c)),
    });
    // A form that cannot be built from THIS data (a scatter with one measure, a point map
    // with no coordinates) refuses rather than approximating — the same contract as the
    // unsupported-type gate above.
    return ext ? { tier: 1, resolved: ext.resolved, defaultH: ext.defaultH,
                   xCategories: ext.xCategories, spec: ext.spec } : null;
  }

  // ---- counter — a single headline number, not a plot -----------------------------------
  if (type === "counter") {
    // A counter reads ONE number straight off the row, so it uses the real column — the
    // derived name a transform introduces exists only inside the chart's dataflow, and
    // indexOf would return -1 and quietly render 0.
    const rawMeasure = inferred?.yCols?.length ? columns[inferred.yCols[0]] : firstMeasure;
    const v = Number(rows[0]?.[columns.indexOf(rawMeasure)] ?? 0);
    return {
      tier: 1, resolved: "counter", defaultH: 140, xCategories: 0,
      spec: {
        ...base,
        // The label goes through the ONE humanizer the rest of the app uses, so a counter
        // reads "Net Revenue" and not "net_revenue". The number keeps its value + format
        // rather than a pre-rendered string: `.2~s` is what the ECharts counter shows
        // (8.7M, not 8.66M), and a spec that stores the VALUE can be re-formatted later.
        data: { values: [{ v, label: yTitle ?? cleanLabel(rawMeasure) }] },
        layer: [
          { mark: { type: "text", fontSize: 38, fontWeight: 600, dy: -8, align: "center", baseline: "middle" },
            encoding: { text: { field: "v", type: "quantitative", format: format?.trim() || ".2~s" } } },
          { mark: { type: "text", fontSize: 11, dy: 26, align: "center", baseline: "middle", opacity: 0.72 },
            encoding: { text: { field: "label", type: "nominal" } } },
        ],
        encoding: { x: { value: { expr: "width/2" } }, y: { value: { expr: "height/2" } } },
      },
    };
  }

  // ---- pie ------------------------------------------------------------------------------
  if (type === "pie") {
    // A DONUT, matching the house form the ECharts path already renders — a hole is not a
    // decoration here, it is what the product's pies look like. Vega-Lite takes an absolute
    // radius, so it is derived from the chart's own height rather than a percentage.
    const pieH = 300;
    return {
      tier: 1, resolved: "pie", defaultH: pieH, xCategories: 0,
      spec: {
        ...base,
        mark: { type: "arc", innerRadius: Math.round(pieH * 0.28), tooltip: true },
        // a slice answers a click as a bar does, and a chosen slice stays lit while the rest recede
        params: [SELECT_PARAM(band)],
        encoding: {
          theta: { field: measure, type: "quantitative", stack: true },
          color: { field: band, type: "nominal", sort: null, legend: { orient: "right", direction: "vertical" } },
          order: { field: measure, type: "quantitative", sort: "descending" },
          opacity: emphasisOn(exhibit?.emphasis, band) ?? SELECT_OPACITY,
        },
      },
    };
  }

  // ---- line / multi-line ----------------------------------------------------------------
  if (type === "line" || type === "multi-line" || type === "multi_line" || type === "area") {
    // A trend's x is the DATE when there is one. `band` leads with the first CATEGORY,
    // which is right for a bar and wrong here: on a month × region × revenue table it put
    // region on the x-axis, left no column for the series encoding, and drew a single line
    // zig-zagging through all 32 points with no legend. When inference ran it already chose
    // the column, so only the explicit-hint path needs the date preference.
    const x = inferred ? band : (dateCol ?? band);
    const xIsDate = x === timeCol;
    // A series column (multi-line) or a single measure (line).
    const seriesCol = inferredSeries ?? (type.startsWith("multi") ? catCols.find((c) => c !== x) : undefined);
    const xValues = rows.map((r) => r[columns.indexOf(x)]);
    const linePct = measureIsPercent(measure);
    const lineScaled = linePct && percentAlreadyScaled(measure);
    const lineField = lineScaled ? `${measure}__frac` : measure;
    const enc: Record<string, unknown> = {
      x: {
        field: x,
        type: xIsDate ? "temporal" : "ordinal",
        ...(xIsDate ? utcScale(detectGranularity(x, xValues)) : {}),
        // A month label without its year is ambiguous the moment a series crosses a year
        // boundary. Vega-Lite's temporal default drops the year; ECharts keeps it.
        /**
         * The label format follows the series' GRAIN, which `detectGranularity` already
         * derives (column name first, then median spacing) and `chartDateFormat` already
         * maps — both used by the other engine. This axis hardcoded "%b %Y", so every
         * daily and weekly series was labelled by month: a real 14-week report rendered
         * 13 ticks carrying 3 distinct labels — "Oct 2023" x4, "Nov 2023" x4, "Dec 2023"
         * x5 — and no point on it could be identified.
         *
         * The year is still kept when the series crosses one (`multiYear`), which is what
         * the old constant was protecting: a bare month is ambiguous across a boundary.
         * That was the right instinct applied at the wrong altitude — it fixed the
         * ambiguous case by making every case ambiguous.
         */
        axis: {
          ...bandAxis(axisTitle(xTitle, x)),
          ...(xIsDate ? dateAxisAs(detectGranularity(x, xValues), xValues, dateFormat) : {}),
        },
      },
      // A percentage reads as one on a trend too: this axis ignored the unit the bar path
      // honours, so a rate's line read 0.07 … 0.12 beside a table saying 6.9% … 12.1%.
      y: { field: lineField, type: "quantitative",
           axis: valueAxis(axisTitle(yTitle, measure), linePct ? ".1%" : format) },
    };
    const lineScale = valueScale(opts, rows.map((r) => Number(r[columns.indexOf(measure)])).filter(Number.isFinite)
                                         .map((v) => (lineScaled ? v / 100 : v)));
    if (Object.keys(lineScale).length) (enc.y as Record<string, unknown>).scale = lineScale;
    const interpolate = opts.lineShape === "smooth" ? "monotone" : opts.lineShape === "step" ? "step-after" : null;
    // Several rows at one place and no series to tell them apart (2026-11-23: Color taken off a multi-line drew one line
    // zig-zagging up every month): the rows are drawn as points, and the chart says why.
    const repeated = !seriesCol && new Set(xValues.map(String)).size < xValues.length;
    // `sort: null` keeps the series in DATA order. Vega-Lite sorts a nominal domain
    // alphabetically by default, which hands the same series a different hue than the
    // ECharts path gives it — every screenshot in the Phase 2 diff would flag.
    if (seriesCol) enc.color = { field: seriesCol, type: "nominal", sort: null };
    const { x: xEnc, ...lineEnc } = enc;
    // The series as the rule's pivot names them, in data order (the colour's own order).
    const seriesNames = seriesCol
      ? [...new Set(rows.map((r) => r[columns.indexOf(seriesCol)]).filter((v) => v !== null && v !== undefined)
                       .map(String))]
      : [lineField];
    const hover: HoverMeta = {
      x, gran: xIsDate ? detectGranularity(x, xValues) : null, series: seriesNames,
      label: seriesCol ? null : axisTitle(yTitle, measure),
      format: linePct ? null : (format && format.trim() ? format : null), pct: linePct,
      prefix: linePct ? "" : moneyPrefix(measure),
      written: xIsDate ? dateFormat : null,
    };
    return {
      tier: 1, resolved: seriesCol ? "multi-line" : "line", defaultH: 300, xCategories: 0,
      spec: {
        ...base,
        ...(lineScaled ? { transform: [...((base.transform as Record<string, unknown>[]) ?? []),
                                       { calculate: `datum['${measure}'] / 100`, as: lineField }] } : {}),
        usermeta: { hover },
        ...(repeated ? { title: { text: (base.title as string | undefined) ?? "Several rows share each place and nothing tells them apart: choose a Color to split them.",
                                  ...(base.title ? { subtitle: "Several rows share each place and nothing tells them apart: choose a Color to split them." }
                                                 : { fontSize: 11, fontWeight: "normal" }),
                                  anchor: "start" } } : {}),
        /**
         * The line, its points, and the hover rule (study R25). The x is shared; the value and the series are the
         * lines' own, since the rule reads one row per x with every series in it (`pivot`).
         *
         * - The points are the ≥8px marker the mark spec asks for, and keep a single-observation series visible.
         *   Only they dim on a selection: dimming the line itself would break its continuity, which is the one thing
         *   a trend line exists to show.
         * - A ring on each line at the x nearest the pointer.
         * - The rule: dashed, drawn only at that x, the whole height. It owns the hover (`nearest`, so the pointer
         *   need not touch a point) and the click that chooses an x, and its row is the tooltip: the date and every
         *   series there (`hoverTooltip.ts`). Two params on one unit, each declared once (see SELECT_PARAM).
         */
        layer: [
          { encoding: lineEnc,
            layer: [
              repeated ? { mark: { type: "point", filled: true } }
                : { mark: { type: "line", ...(interpolate ? { interpolate } : {}) } },
              // the points, unless a person turned the markers off (study R12) or the rows are already drawn as points
              // (`repeated`); the hover's rings stay
              ...(opts.markers === false || repeated ? [] : [{ mark: { type: "point" },
                encoding: { opacity: emphasisOn(exhibit?.emphasis, x, xIsDate) ?? SELECT_OPACITY } }]),
              { transform: [{ filter: { param: "hover", empty: false } }],
                mark: { type: "point", filled: false, size: 90, strokeWidth: 2 } },
              // Labels on (2026-11-23: the editor's switch did nothing on a line): the last place of each series says
              // its value, as a dashboard's line does — never a number on every point.
              ...(showLabels ? [{
                transform: [{ window: [{ op: "rank", as: "__last" }], sort: [{ field: x, order: "descending" }],
                              ...(seriesCol ? { groupby: [seriesCol] } : {}) },
                            { filter: "datum.__last === 1" },
                            { calculate: linePct ? SI_TEXT(lineField, ".1%", "")
                                                 : SI_TEXT(lineField, valueFormat(format), moneyPrefix(measure)),
                              as: "__valueLabel" }],
                mark: { type: "text", align: "left", baseline: "middle", dx: 6, fontSize: 10.5 },
                encoding: { text: { field: "__valueLabel", type: "nominal" } } }] : []),
            ] },
          { transform: [...(seriesCol ? [{ pivot: seriesCol, value: lineField, groupby: [x] }] : []),
                        { calculate: "true", as: HOVER_MARK }],
            mark: { type: "rule", strokeDash: [3, 3], tooltip: { content: "data" } },
            params: [HOVER_PARAM(x), SELECT_PARAM(x)],
            encoding: { y: { value: 0 }, y2: { value: { expr: "height" } },
                        opacity: { condition: { param: "hover", empty: false, value: 0.7 }, value: 0 } } },
          // the reference lines a person drew (the editor's Annotation; 2026-11-23: a line drew none)
          ...refLineLayers(false),
        ],
        encoding: { x: xEnc },
      },
    };
  }

  // ---- bar (vertical and horizontal) ----------------------------------------------------
  const pct = measureIsPercent(measure);
  const pctScaled = pct && percentAlreadyScaled(measure);
  const valueField = pctScaled ? `${measure}__frac` : measure;
  // A change reads signed — rises and falls in the config's diverging pair. Over time it is one bar
  // per period, in time order, labelled as the table labels the period; a period with no change (the
  // month read only to give the next one its change) is no bar at all.
  const isChange = CHANGE_METRIC_COL.test(measure) && !isPriorPeriodCol(measure);
  const bandValues = rows.map((r) => r[columns.indexOf(band)]);
  const bandGran = dateCol && band === dateCol ? detectGranularity(band, bandValues) : null;
  const changeByPeriod = isChange && bandGran !== null;
  // A band of number periods: ordinal, in the period order the rows were put in above.
  const numberBand = numberPeriod && band === dateCol;
  // A band on a time scale, with a date axis: a real date, unless it is a change's labelled periods.
  const bandOnTime = band === timeCol && !changeByPeriod;
  // A bar on a time scale takes its period (`timeBarFit`) — upright across the width, lying down along the height —
  // where Vega-Lite would draw it 5px wide.
  const spanned = bandOnTime ? periodsSpanned(bandGran, bandValues) : null;
  const timeFit = spanned ? timeBarFit(spanned, horizontal ? "height" : "width") : null;
  const bandScale: Record<string, unknown> = {
    ...((bandOnTime ? utcScale(bandGran).scale : undefined) as Record<string, unknown> | undefined),
    ...(timeFit ? { padding: timeFit.padding } : {}),
  };
  // A change over time is one bar per period with a change, in time order, labelled as the table
  // labels its period.
  const periodRows = changeByPeriod
    ? [...data.values]
        .filter((d) => d[measure] !== null && d[measure] !== "" && Number.isFinite(Number(d[measure])))
        .sort((a, b) => numberBand ? Number(a[band]) - Number(b[band]) : String(a[band]).localeCompare(String(b[band])))
        .map((d) => ({ ...d, __period: fmtDate(String(d[band] ?? ""), bandGran ?? "month") }))
    : null;
  // Titles bind to the CHANNEL, not the screen axis: the editor's "X axis" section IS
  // the dimension and its "Y axis" IS the measure, so each title must follow its field
  // through an orientation flip. This form was the one literal-axis outlier (delta-bar,
  // waterfall and pareto already do this), and on a horizontal bar it swapped the two —
  // typing an X title retitled the measure and vice versa.
  // Labels render OUTSIDE the mark (right of a horizontal bar, above a vertical one),
  // so the longest bar's label walked off the plot into the legend gutter. When labels
  // are on, the value scale gets headroom via Vega-Lite's own domainMax — the label
  // then lands inside the plot by construction, whatever the data.
  /**
   * A rate over a handful of records is drawn faded, after the others, and cannot set the scale:
   * its bar stops at the edge the other rows set, labelled with its value and its count. On theLook's
   * repeat-rate answer (2026-10-01) Colombia — 2 customers, 1 repeat, 50% — stretched the country
   * chart to 50% and flattened every comparable country into the bottom fifth of it.
   */
  const few = tooFewToCompare(columns, rows, numericIdxs, measure);
  let labelHeadroom: { scale?: Record<string, unknown> } = {};
  let scaleMax = 0;
  if (showLabels || few.rows.size) {
    const mi = columns.indexOf(measure);
    const vals = rows.filter((_, i) => !few.rows.has(i)).map((r) => Number(r[mi])).filter(Number.isFinite);
    const mx = vals.length ? Math.max(...vals) : 0;
    if (mx > 0) {
      scaleMax = (pctScaled ? mx / 100 : mx) * 1.12;
      labelHeadroom = { scale: { domainMax: scaleMax } };
    }
  }
  const fewTest = few.rows.size && scaleMax > 0 ? `datum['${few.den}'] < ${TOO_FEW_TO_COMPARE}` : "";
  const barField = fewTest ? "__shown" : valueField;
  const chosenScale = valueScale(opts, rows.map((r) => Number(r[columns.indexOf(measure)])).filter(Number.isFinite)
                                          .map((v) => (pctScaled ? v / 100 : v)));
  if (Object.keys(chosenScale).length) labelHeadroom = { scale: { ...(labelHeadroom.scale ?? {}), ...chosenScale } };
  const valueEnc = { field: barField, type: "quantitative", ...labelHeadroom,
                     axis: valueAxis(axisTitle(yTitle, measure),
                                     pct ? ".1%" : format, pct ? "" : moneyPrefix(measure)) };
  const bandEnc = {
    field: changeByPeriod ? "__period" : band,
    type: (changeByPeriod || numberBand ? "ordinal" : bandOnTime ? "temporal" : "nominal") as string,
    ...(Object.keys(bandScale).length ? { scale: bandScale } : {}),
    axis: {
      ...bandAxis(axisTitle(xTitle, band)),
      ...(bandOnTime && bandGran ? dateAxisAs(bandGran, bandValues, dateFormat) : {}),
      ...(periodRows && bandGran === "month" && !numberBand ? compactPeriodLabels(periodRows.map((d) => String(d.__period))) : {}),
    },
    // Lead with the largest — the ranking the question implies. Ties break stably.
    // Data order, always: see orderedValues above for why an encoding sort cannot be trusted.
    sort: null,
  };
  // opacity belongs in the SHARED encoding, not on a layer: the object below is spread over
  // the spec AFTER any layer's own encoding, so a selection declared on the layer was being
  // silently overwritten — the param compiled, the click registered, and nothing dimmed.
  const exColor = exhibitColor();
  const exOpacity = emphasisOpacity();
  const fewOpacity = fewTest
    ? { condition: [{ test: fewTest, value: 0.35 }, { param: "picked", value: 1 }], value: 0.28 }
    : null;
  const encoding: Record<string, unknown> = horizontal
    ? { x: valueEnc, y: bandEnc, opacity: exOpacity ?? fewOpacity ?? SELECT_OPACITY }
    : { x: bandEnc, y: valueEnc, opacity: exOpacity ?? fewOpacity ?? SELECT_OPACITY };
  if (exColor) encoding.color = exColor;
  // One bar per row, coloured by the label its rows share (`uniqueLabelBand`).
  else if (inferredSeries) encoding.color = { field: inferredSeries, type: "nominal", sort: null };
  else if (isChange) encoding.color = { field: measure, type: "quantitative",
                                        scale: { type: "threshold", domain: [0], range: "diverging" }, legend: null };

  /**
   * The exhibit grammar, as encodings. `severity` ramps the measure through the config's
   * single-hue `heatmap` range; `sign` reads the `diverging` pair through a threshold at
   * zero; `categorical` colours by a named field; `emphasis` keeps the question's subjects
   * at full strength and washes the rest. None names a colour — every one resolves through
   * a config range, which is what keeps a stored spec following the token layer.
   */
  function exhibitColor(): Record<string, unknown> | null {
    const mode = exhibit?.color?.mode;
    if (!mode || mode === "neutral") return null;
    // The binding's `legend` carries a POSITION (right/bottom/top/left) or "none".
    // Only "none" was ever honoured — the editor's Legend dropdown set positions
    // that were silently discarded and the legend always sat right, covering the
    // plot on dense charts. A position now becomes the Vega legend's `orient`.
    const legendOf = () => {
      const lp = exhibit?.color?.legend;
      if (lp === "none") return null;
      // Direction follows placement: a top/bottom legend reads as a ROW, a left/right
      // one as a column. The global config pins direction: "vertical" (right-side
      // default), so without this a bottom legend rendered as a column under the plot.
      const placed = lp && ["right", "bottom", "top", "left"].includes(lp);
      return { title: exhibit?.color?.name ?? null,
               ...(placed ? { orient: lp,
                              direction: (lp === "top" || lp === "bottom" ? "horizontal" : "vertical") } : {}) };
    };
    if (mode === "sign") {
      return { field: measure, type: "quantitative",
               scale: { type: "threshold", domain: [0], range: "diverging" }, legend: null };
    }
    if (mode === "severity") {
      return { field: measure, type: "quantitative", scale: { range: "heatmap" },
               legend: legendOf() };
    }
    const field = exhibit?.color?.field;
    if (!field || !columns.includes(field)) return null;
    return { field, type: mode === "continuous" ? "quantitative" : "nominal", sort: null,
             legend: legendOf() };
  }

  /** Reference lines — context the reader otherwise supplies from memory. */
  function refLineLayers(horizontalForm: boolean): Record<string, unknown>[] {
    // a line in the measure's own units does not apply once the values are made shares or changes (2026-11-23)
    if (transform && (transform.op === "pop" || transform.op === "contribution")) return [];
    return (exhibit?.ref_lines ?? []).filter((l) => Number.isFinite(l?.value)).map((l) => ({
      data: { values: [{ __ref: l.value, __label: l.label ?? "" }] },
      // Across the whole plot, by value: the spec's own band encoding is inherited by every layer, and this layer's
      // data has no band field to place it by.
      layer: [
        { mark: { type: "rule", strokeDash: [4, 4] },
          encoding: { [horizontalForm ? "x" : "y"]: { field: "__ref", type: "quantitative" },
                      ...(horizontalForm ? { y: { value: 0 }, y2: { value: { expr: "height" } } }
                                         : { x: { value: 0 }, x2: { value: { expr: "width" } } }) } },
        { mark: { type: "text", align: horizontalForm ? "left" : "right",
                  dx: horizontalForm ? 4 : -4, dy: -4, fontSize: 10 },
          encoding: { [horizontalForm ? "x" : "y"]: { field: "__ref", type: "quantitative" },
                      ...(horizontalForm ? { y: { value: 0 } } : { x: { value: { expr: "width" } } }),
                      text: { field: "__label" } } },
      ],
    }));
  }

  /** Emphasis — the question's subjects stay, everything else recedes. */
  function emphasisOpacity(): Record<string, unknown> | null {
    // one test for every kind (`vega/emphasis.ts`): a date band compares as its day, any other value as text
    return emphasisOn(exhibit?.emphasis, band, !!dateCol && band === dateCol);
  }

  const layers: Record<string, unknown>[] = [
    { mark: { type: "bar", tooltip: true, ...(timeFit ? { [horizontal ? "height" : "width"]: timeFit.size } : {}) },
      params: [SELECT_PARAM(band)] },
  ];
  const pctTransform = [
    ...(pctScaled ? [{ calculate: `datum['${measure}'] / 100`, as: valueField }] : []),
    ...(fewTest ? [{ calculate: `${fewTest} ? min(datum['${valueField}'], ${scaleMax}) : datum['${valueField}']`,
                     as: barField }] : []),
  ];
  /** A too-few row's label carries its count, so a faded bar still says why it is faded. */
  function withFewCount(label: string): string {
    return fewTest ? `(${label}) + (${fewTest} ? ' · n=' + datum['${few.den}'] : '')` : label;
  }
  if (showLabels) {
    layers.push({
      mark: { type: "text", align: horizontal ? "left" : "center", baseline: "middle",
              dx: horizontal ? 5 : 0, dy: horizontal ? 0 : -8 },
      // A calculate rather than `format`, so the mark labels read in the same casing as the
      // axis beside them instead of 6.6k next to 6.6K.
      transform: [{ calculate: withFewCount(pct ? SI_TEXT(valueField, ".1%", "")
                                                : SI_TEXT(valueField, valueFormat(format), moneyPrefix(measure))),
                    as: "__valueLabel" }],
      encoding: { text: { field: "__valueLabel", type: "nominal" } },
    });
  }

  return {
    tier: 1,
    resolved: horizontal ? "bar_horizontal" : "bar",
    xCategories: horizontal ? 0 : new Set(rows.map((r) => r[columns.indexOf(band)])).size,
    // A horizontal bar needs room per category, not a fixed canvas.
    defaultH: horizontal ? Math.max(180, Math.min(560, rows.length * 30 + 60)) : 300,
    spec: (() => {
      // A reference line is its own layer with its own data, so any ref line forces the
      // layered form even where a lone bar would not have needed one.
      const all = [...layers, ...refLineLayers(horizontal)];
      const withTf = pctTransform.length ? { transform: pctTransform } : {};
      // `order: "asc"` means the query asked for the BOTTOM of the ranking, so lead with the
      // row it led with instead of burying it at the far end.
      // a person's sort or top N (study R12) — a bar of categories only: dates and periods keep their order
      const categorical = !bandOnTime && !numberBand && !changeByPeriod;
      const chosenOrder = categorical && opts.sort === "label"
        ? [...data.values].sort((a, b) => String(a[band] ?? "").localeCompare(String(b[band] ?? "")))
        : categorical && opts.sort === "value" ? orderedValues(measure, false) : null;
      const allOrdered = chosenOrder ?? (horizontal ? orderedValues(measure, exhibit?.order === "asc") : data.values);
      const keep = categorical && topN ? new Set(orderedValues(measure, false).slice(0, topN)) : null;
      const ordered = keep ? allOrdered.filter((d) => keep.has(d)) : allOrdered;
      // Too-few rows go after the others, never first, in either orientation.
      const fewLast = fewTest
        ? [...ordered.filter((d) => !(Number(d[few.den]) < TOO_FEW_TO_COMPARE)),
           ...ordered.filter((d) => Number(d[few.den]) < TOO_FEW_TO_COMPARE)]
        : ordered;
      // A band of number periods keeps period order, whichever way it lies and wherever a too-few row is.
      const sorted = periodRows ? { data: { values: periodRows } }
        : numberBand ? {}
        : horizontal || fewTest || chosenOrder || keep ? { data: { values: fewLast } } : {};
      // the largest N said on the chart, never implied: how many of how many
      const cutSaid = keep && keep.size < data.values.length
        ? { title: { text: (base.title as string | undefined) ?? `The ${keep.size} largest of ${data.values.length}`,
                     ...(base.title ? { subtitle: `The ${keep.size} largest of ${data.values.length}` } : { fontSize: 11, fontWeight: "normal" }),
                     anchor: "start" } }
        : {};
      return all.length > 1
        ? { ...base, ...sorted, ...withTf, ...cutSaid, layer: all, encoding }
        : { ...base, ...sorted, ...withTf, ...cutSaid, ...all[0], encoding };
    })(),
  };
}
