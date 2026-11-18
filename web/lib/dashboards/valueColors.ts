/**
 * One colour for a value on every card of a dashboard (dashboard format v17; the dashboards study, R11).
 *
 * The dashboard keeps, for a field, which of the six series colours each of its values wears (`colors` on the root).
 * Every card colouring by that field honours it — an answer's chart and a query card's chart alike — so "Email" is the
 * same colour on the revenue chart and on the orders chart. A value with no colour kept takes the next series colour
 * no kept value holds, in order, so two values never share one by accident. The colours are the CVD-checked series
 * (`palette.ts`); a person chooses a slot, never a hex.
 */
import { SERIES_SLOTS } from "@/lib/dashboards/catalog";

export type ValueColors = Record<string, Record<string, number>>;

/** The dashboard's kept colours, from its root's props; null when it keeps none. */
export function valueColorsOf(props: Record<string, unknown> | null | undefined): ValueColors | null {
  const raw = props?.colors;
  if (!raw || typeof raw !== "object") return null;
  const out: ValueColors = {};
  for (const [field, values] of Object.entries(raw as Record<string, unknown>)) {
    if (!values || typeof values !== "object") continue;
    const kept = Object.fromEntries(Object.entries(values as Record<string, unknown>)
      .filter((e): e is [string, number] => Number.isInteger(e[1]) && (e[1] as number) >= 1 && (e[1] as number) <= SERIES_SLOTS));
    if (Object.keys(kept).length) out[field] = kept;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The colour of each value, in the order given: a kept slot first; every other value the next slot no kept value
 * among these holds. `fixed` names a colour a value must wear whatever is kept (Other's grey, a tone's red).
 */
export function colorsFor(values: string[], kept: Record<string, number> | undefined, palette: string[],
  fixed: (value: string) => string | null = () => null): string[] {
  const n = palette.length;
  if (!n) return values.map(() => "");
  const taken = new Set(values.filter(v => !fixed(v) && kept?.[v]).map(v => ((kept![v] - 1) % n + n) % n));
  let k = 0;
  const next = () => {
    let tries = 0;
    while (taken.has(k % n) && tries < n) { k += 1; tries += 1; }
    return palette[k++ % n];
  };
  return values.map(v => fixed(v) ?? (kept?.[v] ? palette[(kept[v] - 1) % n] : next()));
}

type Obj = Record<string, unknown>;

/**
 * A Vega-Lite spec with every nominal colour channel over a kept field given its values' colours: the domain is the
 * field's values in the chart's own order (data order, or the channel's own list), the range their colours. A spec
 * whose data is not inline, or whose colour channel is over a field the dashboard keeps nothing for, is unchanged.
 */
export function withValueColors<T extends Obj>(spec: T, kept: ValueColors | null | undefined, palette: string[]): T {
  if (!kept || !palette.length) return spec;
  const rows = ((spec.data as { values?: Obj[] } | undefined)?.values) ?? null;
  if (!Array.isArray(rows)) return spec;
  const out = structuredClone(spec) as Obj;
  const visit = (node: Obj) => {
    const enc = node.encoding as Obj | undefined;
    const color = enc?.color as Obj | undefined;
    const field = typeof color?.field === "string" ? color.field : null;
    if (color && field && kept[field] && color.type !== "quantitative") {
      const given = Array.isArray(color.sort) ? (color.sort as unknown[]).map(String) : null;
      const seen = [...new Set(rows.map(r => r[field]).filter(v => v !== null && v !== undefined).map(String))];
      const domain = given ? [...given, ...seen.filter(v => !given.includes(v))] : seen;
      // a named scheme gives way to the kept colours
      const { scheme: _scheme, ...scale } = (color.scale as Obj | undefined) ?? {};
      color.scale = { ...scale, domain, range: colorsFor(domain, kept[field], palette) };
    }
    for (const child of (node.layer as Obj[] | undefined) ?? []) visit(child);
  };
  visit(out);
  return out as T;
}

/** The fields a Vega-Lite spec colours by (a nominal colour channel, nested layers too), each with its values in the
 *  chart's order: what a dashboard can keep a colour for on this chart, and nothing it would not honour. */
export function colouredFields(spec: Obj | null | undefined): { field: string; values: string[] }[] {
  const rows = ((spec?.data as { values?: Obj[] } | undefined)?.values) ?? null;
  if (!spec || !Array.isArray(rows)) return [];
  const found = new Map<string, string[]>();
  const visit = (node: Obj) => {
    const color = (node.encoding as Obj | undefined)?.color as Obj | undefined;
    const field = typeof color?.field === "string" ? color.field : null;
    if (color && field && color.type !== "quantitative" && !found.has(field)) {
      const given = Array.isArray(color.sort) ? (color.sort as unknown[]).map(String) : null;
      const seen = [...new Set(rows.map(r => r[field]).filter(v => v !== null && v !== undefined && v !== "").map(String))];
      found.set(field, given ? [...given, ...seen.filter(v => !given.includes(v))] : seen);
    }
    for (const child of (node.layer as Obj[] | undefined) ?? []) visit(child);
  };
  visit(spec);
  return [...found].map(([field, values]) => ({ field, values }));
}

