/**
 * What a placed card holds that the builder's panel offers to draw (dashboard format v17; study R10, R11): the number
 * columns of the table it shows, for a bar or a colour scale, and each field whose values it colours, with those
 * values, for a colour kept on the whole dashboard. Read off the card's last run: a card not yet read offers nothing.
 */
import type { QueryShaped, QueryShown } from "@/lib/api";
import { MAX_COLOR_VALUES } from "@/lib/dashboards/catalog";

export interface CardHolds {
  /** The number columns of the table the card shows; none for a figure or a chart. */
  numbers: string[];
  /** Each field whose values the card colours, with its values in the card's order. */
  fields: { field: string; values: string[] }[];
}

export const HOLDS_NOTHING: CardHolds = { numbers: [], fields: [] };

const NUMERIC_TYPE = /INT|DOUBLE|FLOAT|DECIMAL|NUMERIC|REAL|NUMBER/i;

interface HeldRun { columns?: string[]; rows?: unknown[][]; shown?: QueryShaped | null }

/** What a card's run offers: a person's own query by how it is shown, an answer's rows by their text columns. */
export function cardHolds(run: HeldRun | null | undefined, setup: Partial<QueryShown> | null | undefined): CardHolds {
  if (!run) return HOLDS_NOTHING;
  const shaped = run.shown ?? null;
  if (shaped) {
    if (shaped.as === "table") return { numbers: shaped.columns.filter(c => NUMERIC_TYPE.test(c.type)).map(c => c.name), fields: [] };
    if (shaped.as === "figure") return HOLDS_NOTHING;
    const values = shaped.series.filter(s => s && s !== "Other");
    return setup?.split && values.length > 1 ? { numbers: [], fields: [{ field: setup.split, values }] } : HOLDS_NOTHING;
  }
  // an answer's chart colours by a text column: each one with two or more values, up to the most a dashboard keeps
  const columns = run.columns ?? [];
  const rows = run.rows ?? [];
  const fields = columns.flatMap((field, i) => {
    const cells = rows.map(r => r[i]).filter(v => v !== null && v !== undefined && v !== "");
    if (!cells.length || cells.every(v => typeof v === "number" || Number.isFinite(Number(v)))) return [];
    if (cells.every(v => /^\d{4}-\d{2}(-\d{2})?/.test(String(v)))) return [];                // dates are not colours
    const values = [...new Set(cells.map(String))];
    return values.length > 1 && values.length <= MAX_COLOR_VALUES ? [{ field, values }] : [];
  });
  return { numbers: [], fields };
}
