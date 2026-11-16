/**
 * What a click on a chart stands for: the column a mark is drawn from and its value (the board study §6.2: a click on
 * a bar, a slice, a point or a tile filters a whole dashboard). Null for a click that stands for no single value — a
 * mark with no dimension in it, a ribbon between two values, the root of a treemap.
 *
 * Every chart kind answers in the result's own column names. Vega-Lite's marks carry the result's fields as they are;
 * the four hand-written Vega kinds (`vega/tier3.ts`) rename them — a treemap's tile says `name`, a funnel's stage
 * `stage`, a gantt's bar `task`, a sankey's node `name` and its side — and are mapped back here to the columns they
 * were drawn from. A date comes back as its ISO day, whatever the chart made of it.
 */
import { classifyColumns } from "@/components/charts/columnRoles";
import { pickCols } from "@/components/charts/vega/tier3";

export interface Pick { field: string; value: string | number }

/** The datum a click on a painted chart answers with — a mark's — or null: an axis label, a legend entry or a title is
 *  not a value of the data, though Vega hands each a datum of its own. */
export function clickedDatum(item: unknown): Record<string, unknown> | null {
  const role = String((item as { mark?: { role?: string } } | null)?.mark?.role ?? "");
  if (/^(axis|legend|title)/.test(role)) return null;
  const datum = (item as { datum?: unknown } | null)?.datum;
  return datum && typeof datum === "object" ? (datum as Record<string, unknown>) : null;
}

const isoDay = (v: unknown): string | null => {
  const d = v instanceof Date ? v : typeof v === "number" ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};

function scalar(v: unknown, isDate: boolean): string | number | null {
  if (v === null || v === undefined || v === "") return null;
  if (isDate) return isoDay(v) ?? String(v).slice(0, 10);
  if (typeof v === "number" || typeof v === "string") return v;
  return String(v);
}

/** The pick a clicked datum stands for. `prefer` names the dimension the chart was drawn by, when the caller knows it. */
export function pickOf(datum: Record<string, unknown> | null | undefined, columns: string[], rows: unknown[][],
  chartType?: string | null, prefer?: string | null): Pick | null {
  if (!datum || typeof datum !== "object") return null;
  const t = String(chartType ?? "").toLowerCase();

  if (t === "treemap" || t === "funnel") {
    const cols = pickCols(columns, rows);
    const v = datum[t === "treemap" ? "name" : "stage"];
    // a treemap's root is a node of its own, standing for no value
    if (!cols || (t === "treemap" && (datum.id === 0 || "children" in datum))) return null;
    const value = scalar(v, false);
    return value === null ? null : { field: cols.label, value };
  }
  if (t === "gantt") {
    const value = scalar(datum.task, false);
    return value === null || !columns[0] ? null : { field: columns[0], value };
  }
  if (t === "sankey") {
    // a node is one value of one side's column; a ribbon is a pair, which no single filter says
    if (!("side" in datum)) return null;
    const field = datum.side === "source" ? columns[0] : columns[1];
    const value = scalar(datum.name, false);
    return value === null || !field ? null : { field, value };
  }

  const { dateIdxs, catIdxs } = classifyColumns(columns, rows);
  const dims = [prefer, ...catIdxs.map((i) => columns[i]), ...dateIdxs.map((i) => columns[i])]
    // only the result's own columns: a field a spec adds (`__label`, a bin's end) stands for no value of the data
    .filter((c): c is string => !!c && columns.includes(c));
  const dates = new Set(dateIdxs.map((i) => columns[i]));
  for (const field of [...new Set(dims)]) {
    if (!(field in datum)) continue;
    const value = scalar(datum[field], dates.has(field));
    if (value !== null) return { field, value };
  }
  return null;
}
