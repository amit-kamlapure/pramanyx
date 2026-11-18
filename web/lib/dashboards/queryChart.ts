/**
 * A card of a person's own query, drawn as they set it up (Arc AP-7; ROADMAP §3.57) — as Vega-Lite,
 * from the points the server shaped (`pramanyx/dashboards/queries.py`): one point per bucket and series, the top values of a
 * split and the rest as Other. Bars stack, stand side by side or show shares; a line never stacks; an area stacks or
 * shows shares; a scatter places each point by two numbers. Dates along the bottom are said by the bucket they are in.
 *
 * Colours are the chart theme's, in a fixed order: the first series takes the first colour, Other the theme's grey — a
 * series keeps its colour whatever the reader narrows, and Other never wears a series' colour.
 */
import type { ChartOptions } from "@/components/charts/chartCustom";
import type { QueryShaped, QueryShown } from "@/lib/api";
import { dayLabel } from "@/lib/dashboards/objectView";
import { fmtDate, type Gran } from "@/lib/format";
import { emphasisOpacity } from "@/components/charts/vega/emphasis";
import { HOVER_MARK, type HoverMeta } from "@/components/charts/vega/hoverTooltip";
import { colorsFor } from "@/lib/dashboards/valueColors";

type QueryChart = Extract<QueryShaped, { as: "bar" | "line" | "area" | "scatter" }>;

export interface ChartColours { palette: string[]; other: string }

const GRAN: Record<string, Gran> = { day: "day", week: "week", month: "month", quarter: "quarter", year: "year" };

/** What a point's place along the bottom is called: a day or a week by the day it starts on — "Oct 9", the year said
 *  only where the chart spans more than one — a month, a quarter or a year as such; anything else as it is. */
export function xText(x: unknown, kind: string, bucket: string, manyYears = false): string | number | null {
  if (x === null || x === undefined) return null;
  if (kind === "date" || kind === "time") {
    const day = String(x).slice(0, 10);
    const gran = GRAN[bucket] ?? "day";
    return (gran === "day" || gran === "week") && !manyYears ? dayLabel(day) : fmtDate(day, gran);
  }
  return typeof x === "number" ? x : String(x);
}

/** The value axis as a person set it: its range, and a log scale where every value is above zero. */
function valueAxisScale(options: ChartOptions | null | undefined, values: number[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof options?.yMin === "number") out.domainMin = options.yMin;
  if (typeof options?.yMax === "number") out.domainMax = options.yMax;
  if (options?.yLog && values.length && values.every(v => v > 0)) { out.type = "log"; out.zero = false; }
  if (out.domainMin !== undefined || out.domainMax !== undefined) out.clamp = true;
  return out;
}

/** The palette's adverse red: what went wrong wears it on a chart as on a figure. */
const ADVERSE_AT = 5;

/** The colour of each series, in order — Other the theme's grey, a series the query says went wrong the palette's red, one not
 *  known yet the same grey. Every other series takes the next colour, so none is skipped. */
export function seriesColours(series: string[], colours: ChartColours, tones: Record<string, string> = {},
  kept?: Record<string, number>): string[] {
  // a colour the dashboard keeps for a value (v17, study R11) after Other's grey and a tone's red, which say something
  return colorsFor(series, kept, colours.palette, s => (s === "Other" || tones[s] === "open" ? colours.other
    : tones[s] === "adverse" ? colours.palette[ADVERSE_AT % colours.palette.length] : null));
}

const DATE_AS_TEXT = /^\d{4}(-(\d{2}|Q[1-4]))?(-\d{2})?$/;

export function queryChartSpec(c: QueryChart, setup: Pick<QueryShown, "segments" | "labels" | "running"> & Partial<Pick<QueryShown, "across">>,
  colours: ChartColours, emphasis?: readonly unknown[] | null, kept?: Record<string, number>, options?: ChartOptions | null): Record<string, unknown> {
  const temporal = c.x.kind === "date" || c.x.kind === "time";
  const manyYears = temporal && new Set(c.points.map(p => String(p.x ?? "").slice(0, 4))).size > 1;
  // a statement's own `date_trunc('month', …)` names no bucket: months read as months, not as "1 Sept 2016"
  const wholeMonths = temporal && !c.x.bucket && c.points.length > 1 && c.points.every(p => String(p.x ?? "").slice(8, 10) === "01");
  // `xr` is the place as the query returned it, beside the words it is drawn with: what a click reports, and what a
  // dashboard's focus lights (the board study, 2026-11-16)
  const every = c.points.map(p => ({ x: xText(p.x, c.x.kind, wholeMonths ? "month" : c.x.bucket, manyYears), xr: p.x, s: p.s || "", v: p.v }));
  // only the largest places along the bottom, a person's choice (the study's R12): categories only, said on the chart
  const categories = c.x.kind === "text" && c.as === "bar" && !every.every(p => DATE_AS_TEXT.test(String(p.x ?? "")));
  const totals = new Map<unknown, number>();
  for (const p of every) totals.set(p.x, (totals.get(p.x) ?? 0) + (p.v ?? 0));
  const topN = categories && options?.top && options.top > 0 ? Math.floor(options.top) : 0;
  const keep = topN && topN < totals.size ? new Set([...totals].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([x]) => x)) : null;
  const values = keep ? every.filter(p => keep.has(p.x)) : every;
  const lit = emphasisOpacity(emphasis, "xr", temporal);
  const split = c.series.length > 1 || (c.series.length === 1 && c.series[0] !== "");
  const named = c.series.filter(s => s !== "");
  const color = split
    ? { color: { field: "s", type: "nominal", sort: named, title: null,
        scale: { domain: named, range: seriesColours(named, colours, c.tones ?? {}, kept) },
        legend: { orient: "top", direction: "horizontal", title: null, symbolType: "square", labelLimit: 140 } } }
    : {};
  const numericX = c.x.kind === "number";
  const bars = c.as === "bar";
  // a category along the bottom reads largest first; dates and numbers in their own order. A date a statement wrote as text
  // (`strftime(day, '%Y-%m')`) is still a date: months ranked by size read as a chart of nothing.
  const datesAsText = c.x.kind === "text" && c.points.length > 0 && c.points.every(p => DATE_AS_TEXT.test(String(p.x ?? "")));
  const xSort = categories && options?.sort === "label" ? "ascending" as const
    : c.x.kind === "text" && bars && !setup.running && !datesAsText ? { op: "sum", field: "v", order: "descending" } : null;
  const x = {
    field: "x",
    type: c.as === "scatter" && numericX ? "quantitative" : "ordinal",
    sort: xSort,
    axis: { title: null, labelAngle: 0, labelOverlap: "parity", ticks: false },
    ...(c.as === "scatter" && numericX ? { scale: { zero: false } } : {}),
  };
  const shares = setup.segments === "shares" && (c.as === "bar" || c.as === "area");
  const stack = c.as === "line" || c.as === "scatter" || !split ? null
    : shares ? "normalize" : setup.segments === "side_by_side" ? null : "zero";
  // A share reads as a percent and money with its symbol. Below a thousand, the SI form says "500m" for a tick of 0.5: never what a reader means.
  const small = Math.max(0, ...values.map(p => Math.abs(p.v ?? 0))) < 1000;
  const axisFormat = shares || c.format === "percent" ? ".0%" : c.format === "money" ? "$.3~s" : small ? ".2~f" : ".3~s";
  const chosenScale = valueAxisScale(options, values.map(p => p.v).filter((v): v is number => typeof v === "number"));
  const y = {
    field: "v", type: "quantitative", stack, title: null,
    axis: { title: null, tickCount: 4, format: axisFormat },
    ...(c.as === "scatter" || Object.keys(chosenScale).length ? { scale: { ...(c.as === "scatter" ? { zero: false } : {}), ...chosenScale } } : {}),
  };
  const tooltip = [
    { field: "x", title: "Along the bottom" },
    ...(split ? [{ field: "s", title: "Series" }] : []),
    { field: "v", type: "quantitative", title: "Value", format: c.format === "percent" ? ".1%" : c.format === "money" ? "$,.0f" : ",.2~f" },
  ];
  // one series, so no legend and no scale: what went wrong still wears its colour
  const tone = !split ? Object.values(c.tones ?? {})[0] : undefined;
  const lone = tone === "adverse" ? { color: colours.palette[ADVERSE_AT % colours.palette.length] } : tone === "open" ? { color: colours.other } : {};
  const shape = options?.lineShape === "smooth" ? { interpolate: "monotone" } : options?.lineShape === "step" ? { interpolate: "step-after" } : {};
  const mark = bars ? { type: "bar", tooltip: true, cornerRadiusEnd: 2, ...lone }
    : c.as === "line" ? { type: "line", strokeWidth: 2, ...shape, ...(options?.markers ? { point: true } : {}) }
      : c.as === "area" ? { type: "area", tooltip: true, ...shape, ...(stack === null && split ? { opacity: 0.45 } : {}) }
        : { type: "point", tooltip: true, filled: true, size: 36 };
  const across = bars && !!setup.across;
  const offset = bars && split && setup.segments === "side_by_side" ? { field: "s", sort: named } : null;
  const encoding: Record<string, unknown> = across
    ? { y: { ...x, axis: { ...x.axis, labelLimit: 180 } }, x: y, ...color, tooltip, ...(offset ? { yOffset: offset } : {}) }
    : { x, y, ...color, tooltip, ...(offset ? { xOffset: offset } : {}) };
  // a line stays whole: its chosen place is said by the label layer's point, not by fading the path
  if (lit && c.as !== "line") encoding.opacity = lit;
  const layer: Record<string, unknown>[] = [{ mark, encoding }];
  if (setup.labels && !shares && c.as !== "scatter" && !across) {
    // labels are selective: along dates or numbers only the last place is labelled — a stack by its total, a line or a
    // side-by-side bar by each series' value there; along categories each bar is
    const lastX = temporal || numericX ? values.at(-1)?.x : undefined;
    const only = lastX !== undefined && lastX !== null ? [{ filter: { field: "x", equal: lastX } }] : [];
    // side by side, a label for each series sat on a bar a few pixels wide, over its neighbours' (seen on theLook,
    // 2026-10-11): only the highest at each labelled place says its number
    const lead = bars && split && setup.segments === "side_by_side"
      ? [{ window: [{ op: "rank", as: "at" }], sort: [{ field: "v", order: "descending" }], groupby: ["x"] }, { filter: "datum.at === 1" }] : [];
    layer.push(bars && stack === "zero"
      ? { transform: [...only, { aggregate: [{ op: "sum", field: "v", as: "total" }], groupby: ["x"] }],
        mark: { type: "text", dy: -6, fontSize: 10.5 },
        encoding: { x: { field: "x", type: x.type, sort: xSort }, y: { field: "total", type: "quantitative" },
          text: { field: "total", type: "quantitative", format: ".3~s" } } }
      : { transform: [...only, ...lead], mark: { type: "text", dy: -6, fontSize: 10.5 },
        encoding: { x, y: { field: "v", type: "quantitative", stack }, text: { field: "v", type: "quantitative", format: ".3~s" },
          ...(bars && split && setup.segments === "side_by_side" ? { xOffset: { field: "s", sort: named } } : {}) } });
  }
  // the hover rule last, so its voronoi is over every mark it reads for
  const hover = c.as === "line" ? hoverRule(x, y, color, split, named, c.format) : null;
  if (hover) layer.push(...hover.layers);
  return { $schema: "https://vega.github.io/schema/vega-lite/v5.json", background: null, data: { values }, layer,
           // what the cut left out is said on the chart, never implied
           ...(keep ? { title: { text: `The ${keep.size} largest of ${totals.size}`, fontSize: 11, fontWeight: "normal", anchor: "start" } } : {}),
           ...(hover ? { usermeta: { hover: hover.meta } } : {}) };
}

/**
 * A line's hover rule (study R25), as an answer's line has it (`resolveSpec.ts`): a ring on each line at the place
 * nearest the pointer, and a dashed rule there whose row — every series at that place, `pivot`ed — is the tooltip,
 * written by `hoverTooltip.ts`. A click through it reports the place as the query returned it (`xr`), as a point did.
 */
function hoverRule(x: Record<string, unknown>, y: Record<string, unknown>, color: Record<string, unknown>,
  split: boolean, named: string[], format: QueryChart["format"]): { layers: Record<string, unknown>[]; meta: HoverMeta } {
  const meta: HoverMeta = {
    x: "x", gran: null, series: split ? named : ["v"], label: split ? null : "Value",
    format: format === "money" ? "$,.0f" : format === "percent" ? null : ",.2~f", pct: format === "percent", prefix: "",
  };
  return {
    meta,
    layers: [
      { transform: [{ filter: { param: "hover", empty: false } }],
        mark: { type: "point", filled: false, size: 90, strokeWidth: 2 }, encoding: { x, y, ...color } },
      { transform: [...(split ? [{ pivot: "s", value: "v", groupby: ["x", "xr"] }] : []), { calculate: "true", as: HOVER_MARK }],
        mark: { type: "rule", strokeDash: [3, 3], tooltip: { content: "data" } },
        params: [{ name: "hover", select: { type: "point", fields: ["x"], nearest: true, on: "pointermove", clear: "pointerout" } }],
        encoding: { x, y: { value: 0 }, y2: { value: { expr: "height" } },
                    opacity: { condition: { param: "hover", empty: false, value: 0.7 }, value: 0 } } },
    ],
  };
}
