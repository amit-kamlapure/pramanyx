/**
 * An answer's own rows, shaped as a dashboard card's run is (`pramanyx/dashboards/queries.py` `shape`, the path a card
 * "drawn as the query returns it" takes) — so an answer's chart, edited in the one chart editor, is drawn by the same
 * drawing a dashboard's is (`queryChart.ts`), and a choice looks the same in both places.
 *
 * Rows only (the owner, 2026-11-20): nothing is asked again. What the rows already say is drawn — a point per row and
 * measure, a split's top few values, a running total — and what only a new query could say (another date bucket, a
 * calculation over the rows, the rows summed) is not pretended: the editor says it needs the question asked again.
 */
import type { QueryChartPoint, QueryShaped, QueryShown, TypedColumn } from "@/lib/api";
import type { VizConfig } from "@/components/charts/vizConfig";
import type { ChartType } from "@/components/charts/chartTypeInference";
import { classifyColumns } from "@/components/charts/columnRoles";
import { cleanLabel } from "@/lib/format";
import { isNumberPeriod } from "@/components/charts/columnRoles";
import { QUERY_DEFAULT, kindOf } from "@/lib/dashboards/queryShown";
import type { DrawnFields } from "@/components/charts/drawn";

/** The most points drawn from an answer's rows — the server's own limit for a chart drawn as it returns. */
export const MAX_POINTS = 2000;

/** What a re-query alone could honour, said where the control would be. */
export const NEEDS_ASKING = "needs the question asked again";

/** An answer's columns with the types a chart reads them by: a measure, a date, or words. */
export function typedColumns(columns: string[], rows: unknown[][]): TypedColumn[] {
  const { numericIdxs, dateIdxs } = classifyColumns(columns, rows);
  return columns.map((name, i) => ({
    name,
    // a period written as a number (FY2026) is a place along the bottom, in its own order — never a day of 1970
    type: dateIdxs.includes(i) ? (isNumberPeriod(rows, i) ? "BIGINT" : "DATE") : numericIdxs.includes(i) ? "DOUBLE" : "VARCHAR",
  }));
}

/** A setup as rows only draw it: as the answer returns its rows, never summed, never put in other buckets. */
export function rowsOnly(s: QueryShown): QueryShown {
  return { ...s, summed: false, bucket: "" };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || typeof v === "boolean" || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Numbers along the bottom in their own order — 2 before 10 — everything else as it reads. */
function order(a: unknown, b: unknown): number {
  const an = typeof a === "number", bn = typeof b === "number";
  if (an && bn) return (a as number) - (b as number);
  if (an !== bn) return an ? -1 : 1;
  const as = a === null || a === undefined ? "" : String(a), bs = b === null || b === undefined ? "" : String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

type Transform = VizConfig["transform"];

/** A transform an answer's chart offered (`resolveSpec.ts` `transformBlocks`), over each series' points in order, with
 *  the same edges: a change is null where the place before is missing or zero, a share null on a zero total, a rolling
 *  mean null until its three are there, a cumulative total carries on over a gap. */
function transformed(points: QueryChartPoint[], op: Transform): QueryChartPoint[] {
  if (!op || op === "none") return points;
  const bySeries = new Map<string, QueryChartPoint[]>();
  for (const p of points) bySeries.set(p.s, [...(bySeries.get(p.s) ?? []), p]);
  const out = new Map<QueryChartPoint, number | null>();
  for (const ps of bySeries.values()) {
    if (op === "contribution") {
      const total = ps.reduce((a, p) => a + (p.v ?? 0), 0);
      for (const p of ps) out.set(p, total === 0 || p.v === null ? null : p.v / total);
    } else if (op === "pop") {
      ps.forEach((p, i) => {
        const prev = i > 0 ? ps[i - 1].v : null;
        out.set(p, prev === null || prev === 0 || p.v === null ? null : (p.v - prev) / prev);
      });
    } else if (op === "rolling") {
      ps.forEach((p, i) => {
        const w = ps.slice(Math.max(0, i - 2), i + 1).map(x => x.v);
        out.set(p, w.length < 3 || w.some(v => v === null) ? null : (w as number[]).reduce((a, b) => a + b, 0) / 3);
      });
    } else {
      let acc = 0;
      for (const p of ps) { acc += p.v ?? 0; out.set(p, acc); }
    }
  }
  return points.map(p => ({ ...p, v: out.get(p) ?? null }));
}

/**
 * An answer's rows shaped as a card's run is: a table's columns and order, a figure's first value, or a chart's points
 * — `{x, s, v}`, a series per value of what splits it (its top few; the others said, never added up) or per measure.
 */
export function shapeAnswer(columns: TypedColumn[], rows: unknown[][], s: QueryShown,
  opts: { transform?: Transform; units?: Record<string, string> | null } = {}): QueryShaped {
  const names = columns.map(c => c.name);
  const at = (n: string) => names.indexOf(n);
  const said: string[] = [];
  if (s.as === "table") {
    const picked = s.columns.filter(c => at(c) >= 0);
    const shown = picked.length ? picked : names;
    const si = s.sort ? at(s.sort) : -1;
    const sorted = si >= 0
      ? [...rows].sort((a, b) => (s.descending ? -1 : 1) * order(num(a[si]) ?? a[si], num(b[si]) ?? b[si])) : rows;
    return { as: "table", columns: shown.map(n => columns[at(n)]), more: false, said,
      rows: sorted.map(r => shown.map(n => r[at(n)] as string | number | boolean | null)) };
  }
  const first = s.series[0];
  if (s.as === "figure") {
    const ci = first?.column ? at(first.column) : -1;
    if (rows.length > 1) said.push("The answer returns more than one row; the figure is its first.");
    return { as: "figure", value: ci >= 0 && rows.length ? num(rows[0][ci]) : null, label: s.label || first?.column || "", said };
  }
  const xi = at(s.x);
  const si = s.split ? at(s.split) : -1;
  const kept = rows.length > MAX_POINTS ? rows.slice(0, MAX_POINTS) : rows;
  if (kept.length < rows.length) said.push(`Only the first ${MAX_POINTS.toLocaleString()} points are drawn; the answer returns more.`);
  const several = s.series.length > 1;
  let points: QueryChartPoint[] = [];
  for (const r of kept) {
    for (const m of s.series) {
      const yi = at(m.column);
      if (xi < 0 || yi < 0) continue;
      const x = r[xi];
      points.push({ x: x === null || x === undefined ? null : typeof x === "number" ? x : String(x),
        s: si >= 0 ? String(r[si]) : several ? m.label || cleanLabel(m.column) : "", v: num(r[yi]) });
    }
  }
  let series: string[];
  if (si >= 0) {
    const totals = new Map<string, number>();
    for (const p of points) totals.set(p.s, (totals.get(p.s) ?? 0) + (p.v ?? 0));
    const ranked = [...totals.keys()].sort((a, b) => (totals.get(b)! - totals.get(a)!) || (a < b ? -1 : a > b ? 1 : 0));
    series = ranked.slice(0, s.top);
    const rest = new Set(ranked.slice(s.top));
    if (rest.size) {
      // the answer's own numbers are never added up into an Other: an average or a rate is not a sum
      points = points.filter(p => !rest.has(p.s));
      said.push(`The ${rest.size} other values of ${s.split} are not drawn: the answer's own numbers are not added up into Other.`);
    }
  } else {
    // a measure is named as its pill is, "Order Count", never its column "order_count" (2026-11-20)
    series = several ? s.series.map(m => m.label || cleanLabel(m.column)) : [""];
  }
  points.sort((a, b) => order(a.x, b.x) || (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  if (s.running) {
    const acc = new Map<string, number>();
    for (const p of points) { acc.set(p.s, (acc.get(p.s) ?? 0) + (p.v ?? 0)); p.v = acc.get(p.s)!; }
  }
  points = transformed(points, opts.transform);
  const share = opts.transform === "pop" || opts.transform === "contribution";
  const unit = String(opts.units?.[first?.column ?? ""] ?? "").toLowerCase();
  const format = share || unit === "percent" ? "percent" : unit.startsWith("currency") ? "money" : undefined;
  const xType = columns[xi]?.type ?? "";
  return { as: s.as, x: { name: s.x, kind: kindOf(xType), bucket: "" }, series, points, other: false, said, tones: {},
    ...(format ? { format } : {}) } as QueryShaped;
}

const OWN = new Set(["bar", "line", "area", "scatter"]);
/** What of an answer's chart settings is how it is dressed — kept whatever is drawn. */
const DRESS: (keyof VizConfig)[] = ["numberFormat", "legend", "xTitle", "yTitle", "tooltipOff", "refLines", "transform",
  "lineShape", "lineWidth", "dateFormat", "markers", "yMin", "yMax", "yLog", "sortBy", "top"];

/**
 * The editor's opening values for an answer nobody has set up in it: what the chart actually draws — its type (a bar,
 * a multi-line, a pie, a map) and its fields — never a placeholder (the owner, 2026-11-20: "No to 'As answered',
 * always a specific field.. always"). Kept as the answer's setup only once a person changes something.
 */
export function openingDraft({ columns, view, type, across, fields, seed, labels }: {
  columns: TypedColumn[]; view: "chart" | "table" | "pivot"; type: ChartType | null; across: boolean;
  fields: DrawnFields; seed: VizConfig; labels: boolean;
}): { shown: QueryShown; viz: VizConfig } {
  const dress: VizConfig = {};
  for (const k of DRESS) if (seed[k] !== undefined) (dress as Record<string, unknown>)[k] = seed[k];
  const firstOf = (kind: string) => columns.find(c => kindOf(c.type) === kind)?.name ?? "";
  const x = fields.x ?? (firstOf("date") || firstOf("text") || columns[0]?.name || "");
  const measures = fields.measures.length ? fields.measures : [columns.find(c => kindOf(c.type) === "number" && c.name !== x)?.name ?? ""];
  const kind = type ?? "bar";
  const own = OWN.has(kind);
  const shown: QueryShown = rowsOnly({
    ...QUERY_DEFAULT, as: view === "table" ? "table" : own ? (kind as QueryShown["as"]) : "bar",
    x, series: measures.map(column => ({ column, agg: "sum" })), split: measures.length > 1 ? "" : fields.color ?? "",
    labels: own && labels, across: across || seed.orient === "horizontal" || undefined,
  });
  if (!shown.across) delete shown.across;
  const viz: VizConfig = own ? dress : {
    ...dress, type: kind,
    ...(seed.orient ? { orient: seed.orient } : {}),
    ...(labels ? { showLabels: true } : {}),
    ...(seed.colorScale ? { colorScale: seed.colorScale } : {}),
    ...(seed.colorName ? { colorName: seed.colorName } : {}),
  };
  // an answer's line shows its points unless it was told not to; the shared drawing hides them unless told to
  if (own && (kind === "line") && seed.markers !== false) viz.markers = true;
  if (own && seed.markers === false) delete viz.markers;
  if (view === "pivot") viz.view = "pivot";
  return { shown, viz };
}
