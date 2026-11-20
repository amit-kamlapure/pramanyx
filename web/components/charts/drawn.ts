/**
 * What an answer's chart draws — the spec `<Chart>` renders, and the type and the fields it was drawn with.
 *
 * The resolution is `<Chart>`'s own, moved here so the chart editor can read the same answer the chart drew (the
 * owner, 2026-11-20: the editor's opening values name what is actually drawn — "No to 'As answered', always a specific
 * field.. always"). One function, two readers: `Chart.tsx` draws it; `ResultChartCard.tsx` names it.
 */
import { resolveVegaSpec } from "@/components/charts/vega/resolveSpec";
import { readVegaTokens } from "@/components/charts/vega/config";
import { withValueColors, type ValueColors } from "@/lib/dashboards/valueColors";
import { pickCols, resolveTier3Spec } from "@/components/charts/vega/tier3";
import { namesOf } from "@/components/charts/vega/names";
import type { ChartCustom } from "@/components/charts/chartCustom";
import type { ExhibitSpec } from "@/components/charts/exhibit";
import { ALL_CHART_TYPES, HINT_TO_TYPE, classifyColumns, inferChartType, type ChartType } from "@/components/charts/chartTypeInference";

export interface DrawnSpec { spec: Record<string, unknown>; defaultH: number; xCategories: number; tier: 1 | 3; resolved: string }

export interface DrawArgs {
  columns: string[];
  rows: unknown[][];
  chartType?: string | null;
  chartConfig?: Record<string, unknown> | null;
  showLabels: boolean;
  custom?: ChartCustom | null;
  exhibit?: ExhibitSpec | null;
  measure?: string | null;
  /** The viewer's own number format (`<Chart>`'s chrome), over the custom one. */
  userFormat?: string | null;
  keptColors?: ValueColors | null;
}

/** The spec `<Chart>` draws for a result, or null where the result has no honest chart in it. */
export function resolveChart({ columns, rows, chartType, chartConfig, showLabels, custom = null, exhibit = null, measure = null,
  userFormat = null, keptColors = null }: DrawArgs): DrawnSpec | null {
  // Tier 3 first — the four forms Vega-Lite cannot express are hand-authored Vega.
  const t3 = resolveTier3Spec({ columns, rows, chartType: String(chartType ?? ""), emphasis: exhibit?.emphasis ?? null });
  if (t3) return { spec: t3.spec, defaultH: t3.defaultH, xCategories: 0, tier: 3, resolved: t3.resolved };

  const v = resolveVegaSpec({
    columns, rows, chartType, showLabels, exhibit, measure, names: namesOf(chartConfig),
    format: userFormat ?? custom?.format ?? null,
    xTitle: custom?.xTitle ?? null,
    yTitle: custom?.yTitle ?? null,
    orient: custom?.orient ?? null,
    transform: custom?.transform ?? null,
    options: custom?.options ?? null,
  });
  // v17 — on a dashboard, a value wears the colour the dashboard keeps for it, on every card (study R11)
  if (v) return { spec: withValueColors(v.spec, keptColors, keptColors ? readVegaTokens().palette : []), defaultH: v.defaultH, xCategories: v.xCategories, tier: 1, resolved: v.resolved };
  // A customization must never brick the chart. Saved viz-configs key by POSITION
  // (pinned__N) and pinned findings reorder across briefing regenerations, so a
  // stale seed can name columns this finding does not have — the customized
  // resolve then refuses, and the card used to render NOTHING with no way back.
  // Retry bare (auto) before giving up; only truly unchartable data renders none.
  // The retreat drops hint, exhibit and custom alike — a finding's hint (e.g.
  // scatter) can fit the original frame while refusing the reshaped one a saved
  // metric selection produced. And "auto" is not the floor: type inference
  // refuses a plain [dimension, stringified-measure] frame that an explicit bar
  // charts fine (measured on theLook's category/total_volume), so bar is the
  // last rung. Truly unchartable data still refuses everything and renders none.
  for (const retreat of ["auto", "bar"] as const) {
    if (retreat === String(chartType ?? "auto") && !custom && !userFormat && !exhibit) continue;
    const bare = resolveVegaSpec({
      // `measure` survives the retreat: it is the user's intent, not styling.
      columns, rows, chartType: retreat, showLabels, exhibit: null, measure, names: namesOf(chartConfig),
      format: null, xTitle: null, yTitle: null, orient: null, transform: null,
    });
    if (bare) return { spec: bare.spec, defaultH: bare.defaultH, xCategories: bare.xCategories, tier: 1, resolved: bare.resolved };
  }
  // null is the honest-refusal verdict: data with no chart in it renders none, and the
  // surface's table view carries it. There is no second engine to fall back to.
  return null;
}

/** The type a resolved spec stands for, as the editor names it ("bar_horizontal" is a bar run sideways). */
export function drawnType(resolved: string | null | undefined): { type: ChartType | null; across: boolean } {
  const r = String(resolved ?? "").toLowerCase();
  const type = HINT_TO_TYPE[r] ?? ((ALL_CHART_TYPES as string[]).includes(r) ? (r as ChartType) : null);
  return { type, across: r === "bar_horizontal" };
}

/** The fields a chart was drawn with: what runs along the bottom (the band, a pie's slices), its measures, and what
 *  colours it. Anything left unknown is null or empty — the caller names it from the same inference the chart used. */
export interface DrawnFields { x: string | null; measures: string[]; color: string | null }

type Enc = { field?: unknown; type?: unknown };
type Unit = { encoding?: Record<string, Enc>; layer?: Unit[]; spec?: Unit; transform?: { fold?: string[]; as?: string[] }[] };

/** Each channel's encoding as the spec first states it, read down its layers — a layered line keeps its x and colour at
 *  the top and its y on the layer beneath; the labels and rules after them read the same fields, or their own (`__ref`). */
function encodingsOf(u: Unit | null | undefined, folds: string[][], out: Record<string, Enc> = {}): Record<string, Enc> {
  if (!u || typeof u !== "object") return out;
  for (const t of u.transform ?? []) if (Array.isArray(t?.fold)) folds.push(t.fold.map(String));
  for (const [ch, e] of Object.entries(u.encoding ?? {})) {
    const f = (e as Enc | undefined)?.field;
    if (!(ch in out) && typeof f === "string" && !f.startsWith("__")) out[ch] = e as Enc;
    else if (!(ch in out) && typeof f === "string" && folds.length && (e as Enc).type === "quantitative") out[ch] = e as Enc;
  }
  for (const l of u.layer ?? []) encodingsOf(l, folds, out);
  if (u.spec) encodingsOf(u.spec, folds, out);
  return out;
}

/** The fields a Vega-Lite spec draws, in the result's own column names (a fold's measures, a pie's slices). */
export function drawnFields(spec: Record<string, unknown> | null | undefined, columns: string[]): DrawnFields {
  const out: DrawnFields = { x: null, measures: [], color: null };
  const folds: string[][] = [];
  // a column, or a transform's own column read back to the one it was derived from (`revenue_cumulative`)
  const named = (f: unknown): string | null => {
    const s = typeof f === "string" ? f : "";
    if (!s || s.startsWith("__")) return null;
    if (columns.includes(s)) return s;
    return [...columns].sort((a, b) => b.length - a.length).find(c => s.startsWith(`${c}_`)) ?? null;
  };
  const enc = encodingsOf(spec as Unit, folds);
  const quant = (e?: Enc) => e?.type === "quantitative";
  for (const ch of ["x", "y", "theta"] as const) {
    const e = enc[ch];
    if (!e) continue;
    if (quant(e)) {
      const m = named(e.field);
      if (m) out.measures.push(m);
      else if (String(e.field ?? "").startsWith("__") && folds.length) out.measures.push(...folds[0].filter(c => columns.includes(c)));
    } else if (!out.x) {
      out.x = named(e.field);
    }
  }
  // a scatter places each point by two numbers: the bottom's is its x
  if (enc.x && enc.y && quant(enc.x) && quant(enc.y)) out.x = out.measures.shift() ?? null;
  const c = named(enc.color?.field);
  if (c && !out.measures.includes(c)) {
    if (!out.x && enc.theta) out.x = c;          // a pie's slices are its band
    else if (c !== out.x) out.color = c;
  }
  out.measures = [...new Set(out.measures)];
  return out;
}

/** What an answer's chart was drawn with — read off its spec, then, for what the spec does not name (a hand-drawn
 *  Vega kind, a map), from the inference the chart itself ran. Never a placeholder: a field the result has. */
export function drawnOf(columns: string[], rows: unknown[][], drawn: DrawnSpec | null): DrawnFields {
  const fields = drawn && drawn.tier === 1 ? drawnFields(drawn.spec, columns) : { x: null, measures: [], color: null } as DrawnFields;
  if (drawn?.tier === 3) {
    const p = pickCols(columns, rows);
    if (p) { fields.x = p.label; fields.measures = [p.value]; }
  }
  const inferred = (!fields.x || !fields.measures.length) ? inferChartType(columns, rows) : null;
  const { numericIdxs, catIdxs, dateIdxs } = classifyColumns(columns, rows);
  if (!fields.x) {
    fields.x = inferred ? columns[inferred.xCol] ?? null : columns[[...dateIdxs, ...catIdxs][0]] ?? null;
  }
  if (!fields.measures.length) {
    const ys = inferred?.yCols.map(i => columns[i]).filter(Boolean) ?? [];
    fields.measures = ys.length ? ys : numericIdxs.map(i => columns[i]).filter(c => c !== fields.x).slice(0, 1);
  }
  // a colour only where the spec could not say: a spec that colours nothing drew nothing coloured
  if (drawn?.tier !== 1 && !fields.color && inferred?.colorCol !== undefined && fields.measures.length < 2) {
    const c = columns[inferred.colorCol];
    if (c && c !== fields.x && !fields.measures.includes(c)) fields.color = c;
  }
  return fields;
}
