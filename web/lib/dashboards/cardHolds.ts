/**
 * What a placed card holds that the builder's panel offers to draw (dashboard format v17; study R10, R11): the number
 * columns of the table it shows, for a bar or a colour scale, and each field whose values it colours, with those
 * values, for a colour kept on the whole dashboard — only a field its chart does colour by, so nothing is offered that
 * the chart would not honour. Read off the card's last run: a card not yet read offers nothing.
 */
import type { QueryShaped, QueryShown } from "@/lib/api";
import { MAX_COLOR_VALUES } from "@/lib/dashboards/catalog";
import { resolveVegaSpec } from "@/components/charts/vega/resolveSpec";
import { colouredFields } from "@/lib/dashboards/valueColors";

export interface CardHolds {
  /** The number columns of the table the card shows; none for a figure or a chart. */
  numbers: string[];
  /** Each field whose values the card colours, with its values in the card's order. */
  fields: { field: string; values: string[] }[];
}

export const HOLDS_NOTHING: CardHolds = { numbers: [], fields: [] };

const NUMERIC_TYPE = /INT|DOUBLE|FLOAT|DECIMAL|NUMERIC|REAL|NUMBER/i;

interface HeldRun { columns?: string[]; rows?: unknown[][]; shown?: QueryShaped | null }

/** How an answer's chart is drawn, as its card keeps it: the kind, the measure and a colour bound to a column. */
export interface HeldChart { type?: string | null; measure?: string | null; colorField?: string | null; colorScale?: string | null }

/** What a card's run offers: a person's own query by how it is shown, an answer by how its chart colours. */
export function cardHolds(run: HeldRun | null | undefined, setup: Partial<QueryShown> | null | undefined,
  chart?: HeldChart | null): CardHolds {
  if (!run) return HOLDS_NOTHING;
  const shaped = run.shown ?? null;
  if (shaped) {
    if (shaped.as === "table") return { numbers: shaped.columns.filter(c => NUMERIC_TYPE.test(c.type)).map(c => c.name), fields: [] };
    if (shaped.as === "figure") return HOLDS_NOTHING;
    const values = shaped.series.filter(s => s && s !== "Other");
    return setup?.split && values.length > 1 ? { numbers: [], fields: [{ field: setup.split, values }] } : HOLDS_NOTHING;
  }
  // an answer's chart: the fields its chart colours by, as the chart is resolved — none for a bar of one colour
  const columns = run.columns ?? [];
  const rows = run.rows ?? [];
  if (!columns.length || !rows.length) return HOLDS_NOTHING;
  const resolved = resolveVegaSpec({ columns, rows, chartType: chart?.type ?? null, measure: chart?.measure ?? null,
    exhibit: chart?.colorField ? { color: { mode: chart.colorScale === "continuous" ? "continuous" : "categorical", field: chart.colorField } } : null });
  const fields = colouredFields(resolved?.spec)
    .filter(f => f.values.length > 1 && f.values.length <= MAX_COLOR_VALUES && columns.includes(f.field));
  return { numbers: [], fields };
}
