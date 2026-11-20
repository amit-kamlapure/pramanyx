/**
 * A query card's setup as it starts, and the kind a warehouse column type reads as — plain code, read by the dashboard's
 * setup screen (`components/dashboards/QuerySetup.tsx`, which re-exports both), by an answer's chart shaped in the browser
 * (`lib/dashboards/answerShape.ts`) and so by the coworker's answer card, which bundles that without the screen.
 */
import type { QueryShown } from "@/lib/api";

export const QUERY_DEFAULT: QueryShown = {
  as: "table", summed: true, x: "", bucket: "", series: [{ column: "", agg: "count" }], split: "", top: 5,
  segments: "stacked", running: false, labels: false, columns: [], sort: "", descending: true, label: "",
};

export function kindOf(type: string): "number" | "date" | "time" | "text" {
  const t = (type || "").toUpperCase();
  if (t.startsWith("DATE") && !t.includes("TIME")) return "date";
  if (t.includes("TIMESTAMP") || t.includes("DATETIME")) return "time";
  if (/INT|DOUBLE|FLOAT|DECIMAL|NUMERIC|REAL|NUMBER|HUGEINT/.test(t)) return "number";
  return "text";
}
