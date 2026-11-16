/**
 * forms.ts — the chart forms beyond the everyday six, as Vega-Lite.
 *
 * Phase 5b/5c. These are the types the ECharts builders drew that Vega-Lite can express
 * natively, plus the two geographic ones. Each is an ENCODING, not a hand-authored spec —
 * that is precisely why they belong at tier 1 and not tier 3.
 *
 * The rules from tier 1 hold without exception:
 *   - no colour literal. Sign colouring reads the config's `diverging` range and a magnitude
 *     ramp reads `heatmap`, so a spec can say "colour by sign" without naming a colour.
 *   - pure JSON. Statistics that were hand-rolled in TypeScript (histogram bins, boxplot
 *     quartiles, waterfall running totals, Pareto cumulative share) are declared as
 *     transforms and computed by the chart, which is the whole argument for the grammar.
 */

import { cleanLabel, detectGranularity, fmtDate } from "@/lib/format";
import { periodsSpanned, timeBarFit } from "@/components/charts/vega/bandFit";
import { dateAxis, utcScale } from "@/components/charts/vega/timeAxis";
import { emphasisOpacity, emphasisTest, RECEDE } from "@/components/charts/vega/emphasis";

export interface FormCtx {
  columns: string[];
  rows: unknown[][];
  data: { values: Record<string, unknown>[] };
  numCols: string[];
  /** The measures the chart plots — inference's choice, else `plottedMeasures`: a rate's own
   *  numerator and denominator and the count beside an average stay out of a fold. */
  plotted?: string[];
  catCols: string[];
  dateCol?: string;
  /** The date column drawn on a time scale: `dateCol`, unless its periods are plain numbers (`isNumberPeriod`) —
   *  those are an ordinal band, one per period, already in period order. */
  timeCol?: string;
  measure: string;
  band: string;
  format?: string | null;
  xTitle?: string | null;
  yTitle?: string | null;
  showLabels: boolean;
  base: Record<string, unknown>;
  /** Sanitised exhibit — the forms that can honour it read it from here. */
  exhibit?: {
    label_points?: boolean | null;
    quadrant?: { x?: number | null; y?: number | null } | null;
    /** The chosen values: they stay lit and the rest recede (`vega/emphasis.ts`). */
    emphasis?: string[] | null;
  } | null;
}

export interface FormResult {
  spec: Record<string, unknown>;
  defaultH: number;
  resolved: string;
  xCategories: number;
}

/** Types this module draws. Everything else falls through to the everyday six. */
export const EXTENDED_TYPES = new Set([
  "scatter", "heatmap", "matrix", "histogram", "boxplot",
  "stacked-bar", "stacked_bar", "grouped-bar", "grouped_bar",
  "small-multiples", "small_multiples", "delta-bar", "delta_bar",
  "waterfall", "pareto", "line-forecast", "line_forecast",
  "choropleth", "point-map", "point_map",
  // storytelling kinds (the board study, 2026-11-16): a ranking to read, before → after, two points in time, a figure
  // against its target, retention by cohort, an estimate with its uncertainty
  "lollipop", "leaderboard", "dumbbell", "slope", "bullet", "cohort", "interval",
]);

/** A column holding the value one period earlier, a target, a cohort's age, or an estimate's bounds — read by name. */
const PREVIOUS = /(^|_)(prev|previous|prior|last|before|earlier)(_|$)/i;
const TARGET = /(^|_)(target|goal|plan|budget|quota)(_|$)/i;
const PERIOD = /(^|_)(period|age|month_number|week_number|months_since|weeks_since|days_since|index|tenure)(_|$)/i;
const LOWER = /lower|lo_|_low|p10/i;
const UPPER = /upper|hi_|_high|p90/i;
/** A stem, a join or a range is DATA, drawn solid — the theme's dashed rule is for a reference line. */
const SOLID = { strokeDash: [] as number[] };
/** A share reads as one: by its name, or by every value being a fraction. */
const isShare = (col: string, rows: unknown[][], i: number) =>
  /rate|retention|share|pct|percent|conversion/i.test(col) || rows.every((r) => { const v = Number(r[i]); return !Number.isFinite(v) || Math.abs(v) <= 1.5; });

const fmt = (f?: string | null) => (f && f.trim() ? f : "~s");
const title = (explicit: string | null | undefined, field: string) =>
  explicit && explicit.trim() ? explicit : cleanLabel(field);

const valueAxis = (t: string, f?: string | null) =>
  ({ title: t, format: fmt(f), grid: true, domain: false, tickCount: 5, zindex: 0 });
const bandAxis = (t: string) => ({ title: t, grid: true, domain: true, zindex: 0 });

/** The base map, as a layer. Its colours come from the config's `geoshape` mark. */
const WORLD = { url: "/geo/world.json", format: { property: "features" } };
const PROJECTION = { type: "equalEarth" };

/** A column whose name looks like a latitude / longitude / place. */
const LAT = /(^|_)(lat|latitude)$/i;
const LON = /(^|_)(lon|lng|long|longitude)$/i;

export function resolveExtendedForm(type: string, c: FormCtx): FormResult | null {
  const { columns, rows, data, numCols, catCols, dateCol, measure, base, exhibit: ex } = c;
  const yT = title(c.yTitle, measure);
  /** A bar's band: a real date on time, a number period (`timeCol` unset) one ordinal band each, a label nominal. */
  const bandType = (field: string) => field === c.timeCol ? "temporal" : field === dateCol ? "ordinal" : "nominal";
  const chosen = ex?.emphasis ?? null;
  /** Opacity lighting the chosen values of any of `fields` — a heatmap's row or column, a stack's band or series. */
  const lit = (...fields: (string | undefined)[]) => {
    const test = emphasisTest(chosen, fields.map((f) => (f ? { field: f, isDate: f === dateCol } : null)));
    return test ? { opacity: { condition: { test, value: 1 }, value: RECEDE } } : {};
  };

  switch (type) {
    // ── relation ───────────────────────────────────────────────────────────
    case "scatter": {
      if (numCols.length < 2) return null;
      const [x, y] = numCols;
      const enc: Record<string, unknown> = {
        x: { field: x, type: "quantitative", axis: valueAxis(title(c.xTitle, x), c.format) },
        y: { field: y, type: "quantitative", axis: valueAxis(title(c.yTitle, y), c.format) },
      };
      if (catCols.length) enc.color = { field: catCols[0], type: "nominal", sort: null };

      // `label_points` puts the entity's name beside its dot — outlier IDENTITY, which is
      // the whole reason a scatter is drawn. `quadrant` adds the mean/median dividers that
      // turn a cloud into four readable regions. Both are exhibit semantics, and without
      // them a "rich" scatter was byte-identical to a plain one.
      const label = c.columns.find((n) => n !== x && n !== y && !c.numCols.includes(n));
      const layers: Record<string, unknown>[] = [{ mark: { type: "point", tooltip: true }, encoding: { ...lit(label ?? catCols[0]) } }];
      if (ex?.label_points && label) {
        layers.push({
          mark: { type: "text", align: "left", dx: 6, dy: -4, fontSize: 10 },
          encoding: { text: { field: label, type: "nominal" } },
        });
      }
      const q = ex?.quadrant;
      if (q && Number.isFinite(q.x)) {
        layers.push({ data: { values: [{ __q: q.x }] }, mark: { type: "rule", strokeDash: [4, 4] },
                      encoding: { x: { field: "__q", type: "quantitative" } } });
      }
      if (q && Number.isFinite(q.y)) {
        layers.push({ data: { values: [{ __q: q.y }] }, mark: { type: "rule", strokeDash: [4, 4] },
                      encoding: { y: { field: "__q", type: "quantitative" } } });
      }
      return { resolved: "scatter", defaultH: 340, xCategories: 0,
               spec: layers.length > 1
                 ? { ...base, layer: layers, encoding: enc }
                 : { ...base, ...layers[0], encoding: { ...enc, ...(layers[0].encoding as Record<string, unknown>) } } };
    }

    // ── two dimensions and a magnitude ─────────────────────────────────────
    case "heatmap":
    case "matrix": {
      // A second dimension often LOOKS numeric — an hour of "09", a week number, a year.
      // classifyColumns calls those measures, so a heatmap that clearly has two dimensions
      // and a value would refuse itself. Fall back to "any column that is not the measure".
      const dims = catCols.length >= 2 ? catCols : columns.filter((n) => n !== measure);
      if (dims.length < 2) return null;
      const [x, y] = dims;
      return {
        resolved: "heatmap", defaultH: Math.max(240, new Set(rows.map((r) => r[columns.indexOf(y)])).size * 26 + 60),
        xCategories: 0,
        spec: {
          ...base,
          mark: { type: "rect", tooltip: true },
          encoding: {
            x: { field: x, type: "nominal", axis: bandAxis(title(c.xTitle, x)) },
            y: { field: y, type: "nominal", axis: bandAxis(title(null, y)) },
            // A magnitude is a single-hue ramp, never a rainbow. `heatmap` is the config's.
            color: { field: measure, type: "quantitative", scale: { range: "heatmap" },
                     legend: { title: yT, format: fmt(c.format) } },
            ...lit(x, y),
          },
        },
      };
    }

    // ── distribution ───────────────────────────────────────────────────────
    case "histogram": {
      if (!numCols.length) return null;
      const v = numCols[0];
      return {
        resolved: "histogram", defaultH: 300, xCategories: 0,
        spec: {
          ...base,
          mark: { type: "bar", tooltip: true },
          encoding: {
            // Binning was hand-rolled in the builders. Here it is one word.
            x: { field: v, type: "quantitative", bin: { maxbins: 30 }, axis: bandAxis(title(c.xTitle, v)) },
            y: { aggregate: "count", type: "quantitative", axis: valueAxis("Count", ",.0f") },
          },
        },
      };
    }

    case "boxplot": {
      if (!numCols.length) return null;
      const v = numCols[0];
      const enc: Record<string, unknown> = {
        y: { field: v, type: "quantitative", axis: valueAxis(title(c.yTitle, v), c.format) },
      };
      if (catCols.length) enc.x = { field: catCols[0], type: "nominal", axis: bandAxis(title(c.xTitle, catCols[0])) };
      return { resolved: "boxplot", defaultH: 320, xCategories: 0,
               // Quartiles, whiskers and outliers: a mark type, not 60 lines of arithmetic.
               spec: { ...base, mark: { type: "boxplot", extent: 1.5 }, encoding: enc } };
    }

    // ── composition ────────────────────────────────────────────────────────
    case "stacked-bar":
    case "stacked_bar":
    case "grouped-bar":
    case "grouped_bar": {
      const grouped = type.startsWith("grouped");
      // The BAND is chosen first and the series is whatever is left. Picking the series
      // first landed both on the same column whenever the band was a date, because
      // `c.band` already holds the first category — and the form then refused itself.
      const bandField = dateCol ?? catCols[0];
      const series = catCols.find((x) => x !== bandField);
      if (!bandField) return null;

      /**
       * Over a real date (`timeCol`) a bar takes its period. Stacked, it stays on the time scale, fitted to its period
       * (`timeBarFit`). Grouped, each period is one labelled band, as the table labels it: Vega-Lite sets bars side by
       * side only within a band, and on a time scale it dropped the grouping and stacked 5px hairlines ("xOffset
       * dropped because x is continuous", 2026-11-16).
       */
      const bandValues = rows.map((r) => r[columns.indexOf(bandField)]);
      const onTime = bandField === c.timeCol;
      const gran = onTime ? detectGranularity(bandField, bandValues) : null;
      const spanned = onTime && !grouped ? periodsSpanned(gran, bandValues) : null;
      const fit = spanned ? timeBarFit(spanned) : null;
      const at = (d: Record<string, unknown>) => Date.parse(String(d[bandField] ?? ""));
      const periods = onTime && grouped && gran
        ? [...data.values].sort((a, b) => at(a) - at(b))
            .map((d) => ({ ...d, __period: fmtDate(String(d[bandField] ?? ""), gran) }))
        : null;
      const xEnc = periods
        ? { field: "__period", type: "ordinal", sort: null, title: title(c.xTitle, bandField),
            axis: bandAxis(title(c.xTitle, bandField)) }
        : onTime && gran
          // The plain bar's date axis: a tick and a label per period, under the middle of each bar.
          ? { field: bandField, type: "temporal",
              scale: { ...(utcScale(gran).scale as Record<string, unknown> | undefined), ...(fit ? { padding: fit.padding } : {}) },
              axis: { ...bandAxis(title(c.xTitle, bandField)), ...dateAxis(gran, bandValues) } }
          : { field: bandField, type: bandType(bandField), axis: bandAxis(title(c.xTitle, bandField)) };
      const barMark = { type: "bar", tooltip: true, ...(fit ? { width: fit.size } : {}) };
      const ownData = periods ? { data: { values: periods } } : {};

      /**
       * No second dimension, but two or more measures: the MEASURES are the series.
       * `region × revenue × profit` has one category and nothing to group by, so a fold
       * turns the measure names into a series column — which is what a reader means by
       * "compare revenue and profit per region", and what the retired combo form drew with
       * a second y-axis. One scale, no second axis.
       */
      if (!series) {
        // The measures the chart plots, not every number in the result: folding them all put
        // an item count beside two hour averages on one "Value" axis (theLook, 2026-10-01).
        const folded = c.plotted?.length ? c.plotted : numCols;
        if (folded.length < 2) return null;
        return {
          resolved: grouped ? "grouped-bar" : "stacked-bar", defaultH: 320,
          xCategories: new Set(rows.map((r) => r[columns.indexOf(bandField)])).size,
          spec: {
            ...base, ...ownData,
            transform: [{ fold: folded, as: ["__measure", "__value"] }],
            mark: barMark,
            encoding: {
              x: xEnc,
              y: { field: "__value", type: "quantitative", stack: grouped ? null : "zero",
                   axis: valueAxis(title(c.yTitle, "value"), c.format) },
              color: { field: "__measure", type: "nominal", sort: null },
              ...(grouped ? { xOffset: { field: "__measure", sort: null } } : {}),
              ...lit(bandField),
            },
          },
        };
      }
      const enc: Record<string, unknown> = {
        x: xEnc,
        y: { field: measure, type: "quantitative", stack: grouped ? null : "zero",
             axis: valueAxis(yT, c.format) },
        color: { field: series, type: "nominal", sort: null },
        ...lit(bandField, series),
      };
      if (grouped) enc.xOffset = { field: series, sort: null };
      return { resolved: grouped ? "grouped-bar" : "stacked-bar", defaultH: 320,
               xCategories: new Set(rows.map((r) => r[columns.indexOf(bandField)])).size,
               spec: { ...base, ...ownData, mark: barMark, encoding: enc } };
    }

    case "small-multiples":
    case "small_multiples": {
      const facet = catCols[0];
      const x = dateCol ?? catCols[1];
      if (!facet || !x) return null;
      return {
        resolved: "small-multiples", defaultH: 320, xCategories: 0,
        spec: {
          ...base,
          // Faceting is a spec-level operation. The builders drew each panel by hand.
          facet: { field: facet, type: "nominal", columns: 3, header: { title: null } },
          spec: {
            width: 180, height: 110,
            mark: { type: "line" },
            encoding: {
              x: { field: x, type: x === c.timeCol ? "temporal" : "ordinal", axis: bandAxis("") },
              y: { field: measure, type: "quantitative", axis: valueAxis("", c.format) },
            },
          },
        },
      };
    }

    // ── change ─────────────────────────────────────────────────────────────
    case "delta-bar":
    case "delta_bar": {
      if (!catCols.length || !numCols.length) return null;
      const cat = catCols[0];
      return {
        resolved: "delta-bar", defaultH: Math.max(180, rows.length * 30 + 60), xCategories: 0,
        spec: {
          ...base,
          mark: { type: "bar", tooltip: true },
          encoding: {
            x: { field: measure, type: "quantitative", axis: valueAxis(yT, c.format) },
            y: { field: cat, type: "nominal", sort: { field: measure, order: "descending" },
                 axis: bandAxis(title(c.xTitle, cat)) },
            // Sign, not identity: a threshold scale at zero reading the config's diverging
            // pair. Two colours, and neither of them written into the spec.
            color: { field: measure, type: "quantitative",
                     scale: { type: "threshold", domain: [0], range: "diverging" }, legend: null },
            ...lit(cat),
          },
        },
      };
    }

    case "waterfall": {
      if (!catCols.length || !numCols.length) return null;
      const step = catCols[0];
      return {
        resolved: "waterfall", defaultH: 320,
        xCategories: new Set(rows.map((r) => r[columns.indexOf(step)])).size,
        spec: {
          ...base,
          transform: [
            // The running total and each bar's floor, declared. This was a hand-written
            // reduce in the builders, and the place an off-by-one hides.
            { window: [{ op: "sum", field: measure, as: "__end" }], frame: [null, 0] },
            { calculate: `datum.__end - datum['${measure}']`, as: "__start" },
          ],
          mark: { type: "bar", tooltip: true },
          encoding: {
            x: { field: step, type: "nominal", sort: null, axis: bandAxis(title(c.xTitle, step)) },
            y: { field: "__start", type: "quantitative", axis: valueAxis(yT, c.format) },
            y2: { field: "__end" },
            color: { field: measure, type: "quantitative",
                     scale: { type: "threshold", domain: [0], range: "diverging" }, legend: null },
            ...lit(step),
          },
        },
      };
    }

    // ── concentration ──────────────────────────────────────────────────────
    case "pareto": {
      if (!catCols.length || !numCols.length) return null;
      const cat = catCols[0];
      return {
        resolved: "pareto", defaultH: 330,
        xCategories: new Set(rows.map((r) => r[columns.indexOf(cat)])).size,
        spec: {
          ...base,
          transform: [
            { window: [{ op: "sum", field: measure, as: "__rank" }], sort: [{ field: measure, order: "descending" }] },
            { joinaggregate: [{ op: "sum", field: measure, as: "__total" }] },
            { calculate: "datum.__total === 0 ? 0 : datum.__rank / datum.__total", as: "__cum" },
            { calculate: `datum.__total === 0 ? 0 : datum['${measure}'] / datum.__total`, as: "__share" },
          ],
          // ONE axis, both measures as a share. The ECharts pareto used a second y-scale;
          // §6 bans dual axes and the exhibit grammar already retired the form, so the
          // cumulative line and the bars are expressed in the same unit instead.
          layer: [
            { mark: { type: "bar", tooltip: true },
              encoding: { y: { field: "__share", type: "quantitative", axis: valueAxis("Share of total", ".0%") }, ...lit(cat) } },
            { mark: { type: "line", point: true },
              encoding: { y: { field: "__cum", type: "quantitative" } } },
          ],
          encoding: {
            x: { field: cat, type: "nominal", sort: { field: measure, order: "descending" },
                 axis: bandAxis(title(c.xTitle, cat)) },
          },
        },
      };
    }

    // ── trend with a band ──────────────────────────────────────────────────
    case "line-forecast":
    case "line_forecast": {
      const x = dateCol ?? c.band;
      if (!x) return null;
      const lower = columns.find((n) => /lower|lo_|_low|p10/i.test(n));
      const upper = columns.find((n) => /upper|hi_|_high|p90/i.test(n));
      const layers: Record<string, unknown>[] = [];
      if (lower && upper) {
        layers.push({
          mark: { type: "area", opacity: 0.18 },
          encoding: { y: { field: lower, type: "quantitative" }, y2: { field: upper } },
        });
      }
      layers.push({ mark: { type: "line" }, encoding: { y: { field: measure, type: "quantitative", axis: valueAxis(yT, c.format) } } });
      return {
        resolved: "line-forecast", defaultH: 300, xCategories: 0,
        spec: {
          ...base, layer: layers,
          encoding: { x: { field: x, type: x === c.timeCol ? "temporal" : "ordinal",
                           axis: { ...bandAxis(title(c.xTitle, x)), ...(x === c.timeCol ? { format: "%b %Y" } : {}) } } },
        },
      };
    }

    // ── storytelling (the board study, 2026-11-16) ─────────────────────────
    case "lollipop": {
      // A ranking with less ink than a bar: a stem to the value and a dot on it, largest first.
      const cat = catCols[0] ?? c.band;
      if (!cat || !numCols.length) return null;
      const n = new Set(rows.map((r) => r[columns.indexOf(cat)])).size;
      return {
        resolved: "lollipop", defaultH: Math.max(180, n * 26 + 60), xCategories: 0,
        spec: {
          ...base,
          encoding: { y: { field: cat, type: "nominal", sort: { field: measure, order: "descending" }, axis: bandAxis(title(c.xTitle, cat)) }, ...lit(cat) },
          layer: [
            // the stem runs from the value back to zero, on the value's own scale
            { mark: { type: "rule", ...SOLID }, encoding: { x: { field: measure, type: "quantitative", axis: valueAxis(yT, c.format) }, x2: { datum: 0 } } },
            { mark: { type: "point", filled: true, size: 90, tooltip: true },
              encoding: { x: { field: measure, type: "quantitative" } } },
          ],
        },
      };
    }

    case "leaderboard": {
      // A ranking to READ: each row its rank, its name and its value — and its change, when the result holds the value
      // one period earlier beside it.
      const cat = catCols[0] ?? c.band;
      if (!cat || !numCols.length) return null;
      const prev = numCols.find((n) => n !== measure && PREVIOUS.test(n));
      const n = new Set(rows.map((r) => r[columns.indexOf(cat)])).size;
      const valueText = `format(datum['${measure}'], '${c.format?.trim() || ".3~s"}')`;
      // room at the right for the label each bar carries
      const mi = columns.indexOf(measure);
      const top = Math.max(0, ...rows.map((r) => Number(r[mi])).filter(Number.isFinite));
      const changeText = prev
        ? ` + (datum['${prev}'] ? ((datum['${measure}'] >= datum['${prev}'] ? '  ▲ ' : '  ▼ ') + format(abs(datum['${measure}'] - datum['${prev}']) / abs(datum['${prev}']), '.0%')) : '')`
        : "";
      return {
        resolved: "leaderboard", defaultH: Math.max(180, n * 28 + 50), xCategories: 0,
        spec: {
          ...base,
          transform: [
            { window: [{ op: "row_number", as: "__rank" }], sort: [{ field: measure, order: "descending" }] },
            { calculate: `datum.__rank + '.  ' + datum['${cat}']`, as: "__who" },
            { calculate: `${valueText}${changeText}`, as: "__said" },
          ],
          encoding: { y: { field: "__who", type: "nominal", sort: { field: "__rank", order: "ascending" }, axis: bandAxis("") }, ...lit(cat) },
          layer: [
            { mark: { type: "bar", tooltip: true, height: { band: 0.6 } },
              encoding: { x: { field: measure, type: "quantitative", axis: valueAxis(yT, c.format),
                               scale: { domainMax: top * (prev ? 1.45 : 1.25) } } } },
            { mark: { type: "text", align: "left", dx: 6 },
              encoding: { x: { field: measure, type: "quantitative" }, text: { field: "__said", type: "nominal" } } },
          ],
        },
      };
    }

    case "dumbbell": {
      // Before → after per item: both ends drawn and joined, so a reader sees the level AND the move — what a delta
      // bar, showing only the move, leaves out.
      const cat = catCols[0] ?? c.band;
      const pair = (c.plotted && c.plotted.length >= 2 ? c.plotted : numCols).slice(0, 2);
      if (!cat || pair.length < 2) return null;
      const [a, b] = pair;
      const n = new Set(rows.map((r) => r[columns.indexOf(cat)])).size;
      return {
        resolved: "dumbbell", defaultH: Math.max(180, n * 28 + 70), xCategories: 0,
        spec: {
          ...base,
          encoding: { y: { field: cat, type: "nominal", sort: { field: b, order: "descending" }, axis: bandAxis(title(c.xTitle, cat)) }, ...lit(cat) },
          layer: [
            { mark: { type: "rule", strokeWidth: 2, ...SOLID },
              encoding: { x: { field: a, type: "quantitative", axis: valueAxis(title(c.yTitle, "value"), c.format) }, x2: { field: b } } },
            { transform: [{ fold: [a, b], as: ["__end", "__value"] }],
              mark: { type: "point", filled: true, size: 100, tooltip: true },
              encoding: { x: { field: "__value", type: "quantitative" },
                          color: { field: "__end", type: "nominal", sort: [a, b],
                                   legend: { orient: "top", title: null,
                                             labelExpr: `datum.label === ${JSON.stringify(a)} ? ${JSON.stringify(cleanLabel(a))} : datum.label === ${JSON.stringify(b)} ? ${JSON.stringify(cleanLabel(b))} : datum.label` } } } },
          ],
        },
      };
    }

    case "slope": {
      // Two points in time per item, joined: who rose, who fell, who crossed whom. Either (item, period, value) with
      // exactly two periods, or (item, before, after).
      const periodCol = dateCol ?? (catCols.length >= 2 ? catCols[1] : undefined);
      const itemCol = catCols.find((x) => x !== periodCol);
      if (!itemCol) return null;
      const periods = periodCol ? new Set(rows.map((r) => String(r[columns.indexOf(periodCol)]))).size : 0;
      const pair = numCols.slice(0, 2);
      const folded = !(periodCol && periods === 2);
      if (folded && pair.length < 2) return null;
      const x = folded ? "__period" : (periodCol as string);
      const y = folded ? "__value" : measure;
      return {
        resolved: "slope", defaultH: 340, xCategories: 2,
        spec: {
          ...base,
          ...(folded ? { transform: [{ fold: pair, as: ["__period", "__value"] }] } : {}),
          encoding: {
            x: { field: x, type: "ordinal", sort: folded ? pair : "ascending", axis: { ...bandAxis(""), labelAngle: 0 } },
            y: { field: y, type: "quantitative", axis: valueAxis(yT, c.format) },
            color: { field: itemCol, type: "nominal", sort: null, legend: null },
            ...lit(itemCol),
          },
          layer: [
            { mark: { type: "line" } },
            { mark: { type: "point", filled: true, tooltip: true } },
            { transform: [{ window: [{ op: "rank", as: "__r" }], sort: [{ field: x, order: "descending" }], groupby: [itemCol] },
                          { filter: "datum.__r === 1" }],
              mark: { type: "text", align: "left", dx: 8 }, encoding: { text: { field: itemCol, type: "nominal" } } },
          ],
        },
      };
    }

    case "bullet": {
      // A figure against its target, per item: the bar is the value, the tick the target.
      const cat = catCols[0] ?? c.band;
      const target = numCols.find((n) => n !== measure && TARGET.test(n));
      if (!cat || !target) return null;
      const n = new Set(rows.map((r) => r[columns.indexOf(cat)])).size;
      return {
        resolved: "bullet", defaultH: Math.max(140, n * 36 + 50), xCategories: 0,
        spec: {
          ...base,
          encoding: { y: { field: cat, type: "nominal", sort: null, axis: bandAxis(title(c.xTitle, cat)) }, ...lit(cat) },
          layer: [
            { mark: { type: "bar", height: { band: 0.4 }, tooltip: true },
              encoding: { x: { field: measure, type: "quantitative", axis: valueAxis(yT, c.format) } } },
            { mark: { type: "tick", thickness: 3, tooltip: true }, encoding: { x: { field: target, type: "quantitative" } } },
          ],
        },
      };
    }

    case "cohort": {
      // Retention by cohort: each row a cohort, each column its age, each cell the share still there. A heatmap whose
      // second axis is an ORDER, read left to right.
      const cohortCol = dateCol ?? catCols[0];
      const periodCol = numCols.find((n) => PERIOD.test(n));
      if (!cohortCol || !periodCol) return null;
      const valueCol = numCols.filter((n) => n !== periodCol).pop();
      if (!valueCol) return null;
      const cohorts = new Set(rows.map((r) => r[columns.indexOf(cohortCol)])).size;
      const cellFmt = c.format?.trim() || (isShare(valueCol, rows, columns.indexOf(valueCol)) ? ".1%" : "~s");
      return {
        resolved: "cohort", defaultH: Math.max(220, cohorts * 26 + 70), xCategories: 0,
        spec: {
          ...base,
          encoding: {
            x: { field: periodCol, type: "ordinal", axis: { ...bandAxis(title(c.xTitle, periodCol)), labelAngle: 0 } },
            y: { field: cohortCol, type: "ordinal", sort: "ascending", axis: bandAxis(title(null, cohortCol)) },
            ...lit(cohortCol),
          },
          layer: [
            { mark: { type: "rect", tooltip: true },
              encoding: { color: { field: valueCol, type: "quantitative", scale: { range: "heatmap" },
                                   legend: { title: title(c.yTitle, valueCol), format: cellFmt } } } },
            ...(rows.length <= 150
              ? [{ mark: { type: "text", fontSize: 10 }, encoding: { text: { field: valueCol, type: "quantitative", format: cellFmt } } }]
              : []),
          ],
        },
      };
    }

    case "interval": {
      // An estimate with its uncertainty: the dot is the estimate, the bar its range — never a bare point that reads as
      // certain.
      const x = dateCol ?? catCols[0] ?? c.band;
      const lower = columns.find((n) => LOWER.test(n));
      const upper = columns.find((n) => UPPER.test(n));
      const est = numCols.find((n) => n !== lower && n !== upper);
      if (!x || !lower || !upper || !est) return null;
      return {
        resolved: "interval", defaultH: 300, xCategories: new Set(rows.map((r) => r[columns.indexOf(x)])).size,
        spec: {
          ...base,
          encoding: { x: { field: x, type: x === dateCol ? "temporal" : "nominal", axis: bandAxis(title(c.xTitle, x)) }, ...lit(x) },
          layer: [
            { mark: { type: "rule", strokeWidth: 2, ...SOLID },
              encoding: { y: { field: lower, type: "quantitative", axis: valueAxis(title(c.yTitle, est), c.format) }, y2: { field: upper } } },
            { mark: { type: "point", filled: true, size: 70, tooltip: true }, encoding: { y: { field: est, type: "quantitative" } } },
          ],
        },
      };
    }

    // ── geography ──────────────────────────────────────────────────────────
    case "choropleth": {
      const place = catCols[0];
      if (!place || !numCols.length) return null;
      return {
        resolved: "choropleth", defaultH: 380, xCategories: 0,
        spec: {
          ...base,
          data: WORLD,
          projection: PROJECTION,
          transform: [{
            // The map is the spine and the answer is looked up INTO it, so a country with
            // no row still draws — an absent value reads as absent, not as zero.
            lookup: "properties.name",
            from: { data, key: place, fields: [measure] },
          }],
          mark: { type: "geoshape", tooltip: true },
          encoding: {
            color: { field: measure, type: "quantitative", scale: { range: "heatmap" },
                     legend: { title: yT, format: fmt(c.format) } },
            ...(emphasisOpacity(chosen, "properties.name") ? { opacity: emphasisOpacity(chosen, "properties.name") } : {}),
          },
        },
      };
    }

    case "point-map":
    case "point_map": {
      const lat = columns.find((n) => LAT.test(n));
      const lon = columns.find((n) => LON.test(n));
      if (!lat || !lon) return null;
      return {
        resolved: "point-map", defaultH: 380, xCategories: 0,
        spec: {
          ...base,
          projection: PROJECTION,
          layer: [
            { data: WORLD, mark: { type: "geoshape" } },
            {
              data,
              mark: { type: "circle", tooltip: true },
              encoding: {
                longitude: { field: lon, type: "quantitative" },
                latitude: { field: lat, type: "quantitative" },
                ...(numCols.length
                  ? { size: { field: measure, type: "quantitative", legend: { title: yT } } }
                  : {}),
              },
            },
          ],
        },
      };
    }

    default:
      return null;
  }
}
