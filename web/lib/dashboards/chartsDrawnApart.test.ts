/**
 * What the chart editor's live test found (2026-11-23, the SQL Editor, orders by month and status):
 * - with Color taken off, twelve bars were painted over each other per status, and a line zig-zagged up each month;
 * - an Average reference line of 13,087 orders, kept when the bars turned to Shares, stretched the 0–100% axis to
 *   1,000,000% and every bar to nothing;
 * - the tooltip called Orders "Value".
 * Rows at one place are now drawn apart and said; a line in the measure's units is left off shares and said; a tooltip
 * names what it shows.
 */
import { describe, expect, it } from "vitest";

import type { QueryShaped } from "@/lib/api";
import { shapeAnswer } from "@/lib/dashboards/answerShape";
import { QUERY_DEFAULT } from "@/lib/dashboards/queryShown";
import { queryChartSpec, queryLookOf } from "@/lib/dashboards/queryChart";
import { resolveVegaSpec } from "@/components/charts/vega/resolveSpec";

type Chart = Extract<QueryShaped, { as: "bar" | "line" | "area" | "scatter" }>;
type Obj = Record<string, unknown>;
const COLOURS = { palette: ["#c1", "#c2", "#c3"], other: "#grey" };
const COLUMNS = [{ name: "month", type: "DATE" }, { name: "order_status", type: "VARCHAR" }, { name: "orders", type: "BIGINT" }];
const ROWS: unknown[][] = [["2017-09-01", "canceled", 20], ["2017-09-01", "delivered", 4150], ["2017-10-01", "canceled", 26],
                           ["2017-10-01", "delivered", 4478]];
const shown = (as: "bar" | "line", split = "") =>
  ({ ...QUERY_DEFAULT, as, x: "month", split, series: [{ column: "orders", agg: "sum" }] }) as typeof QUERY_DEFAULT;
const setup = (segments: "stacked" | "side_by_side" | "shares" = "stacked") => ({ segments, labels: false, running: false });
const first = (spec: Obj) => (spec.layer as Obj[])[0] as { mark: Obj; encoding: Record<string, Obj> };

describe("rows at one place with nothing to tell them apart", () => {
  it("are stacked as bars, drawn as points on a line, and said under the chart", () => {
    const bars = shapeAnswer(COLUMNS, ROWS, shown("bar")) as Chart;
    expect(bars.said.join(" ")).toContain("Up to 2 rows share each month");
    expect(first(queryChartSpec(bars, setup(), COLOURS)).encoding.y.stack).toBe("zero");
    const line = shapeAnswer(COLUMNS, ROWS, shown("line")) as Chart;
    expect(first(queryChartSpec(line, setup(), COLOURS)).mark.type).toBe("point");
  });

  it("are left as they were when a Color tells them apart", () => {
    const split = shapeAnswer(COLUMNS, ROWS, shown("line", "order_status")) as Chart;
    expect(split.said).toEqual([]);
    expect(first(queryChartSpec(split, setup(), COLOURS)).mark.type).toBe("line");
  });

  it("on an answer's older engine, a line with no series is drawn as its points and says why", () => {
    const v = resolveVegaSpec({ columns: ["month", "order_status", "orders"], rows: ROWS, chartType: "line", measure: "orders" })!;
    expect(JSON.stringify(v.spec)).toContain('"type":"point","filled":true');
    expect(JSON.stringify((v.spec as Obj).title)).toContain("Several rows share each place");
  });
});

describe("a reference line in the measure's own units", () => {
  const split = () => shapeAnswer(COLUMNS, ROWS, shown("bar", "order_status")) as Chart;
  const look = queryLookOf({ refLines: [{ value: 13087.36, label: "Average" }] });

  it("is drawn on counts", () => {
    expect(JSON.stringify(queryChartSpec(split(), setup("stacked"), COLOURS, null, undefined, null, look))).toContain('"Average"');
  });

  it("is left off shares, and the chart says so", () => {
    const spec = queryChartSpec(split(), setup("shares"), COLOURS, null, undefined, null, look) as Obj;
    expect(JSON.stringify(spec)).not.toContain('"Average"');
    expect(JSON.stringify(spec.title)).toContain("The reference line is not drawn: the chart shows shares");
  });

  it("is left off values made shares by a transform, on either engine", () => {
    const reshaped = shapeAnswer(COLUMNS, ROWS, shown("bar", "order_status"), { transform: "contribution" }) as Chart;
    expect(reshaped.reshaped).toBe("share");
    expect(JSON.stringify(queryChartSpec(reshaped, setup(), COLOURS, null, undefined, null, look))).not.toContain('"Average"');
    const older = resolveVegaSpec({ columns: ["month", "order_status", "orders"], rows: ROWS, chartType: "multi_line",
      transform: { op: "contribution", valueCol: "orders" }, exhibit: { ref_lines: [{ value: 13087, label: "Average" }] } })!;
    expect(JSON.stringify(older.spec)).not.toContain("__ref");
  });
});

describe("a tooltip", () => {
  it("names the measure, the place and what splits it as they are named, never Value, Along the bottom and Series", () => {
    const spec = JSON.stringify(queryChartSpec(shapeAnswer(COLUMNS, ROWS, shown("bar", "order_status")) as Chart, setup(), COLOURS));
    expect(spec).toContain('"title":"Orders"');
    expect(spec).toContain('"title":"Month"');
    expect(spec).toContain('"title":"Order Status"');
    expect(spec).not.toContain('"title":"Value"');
  });
});

describe("a large number", () => {
  it("is written as the app writes it on a dashboard's chart too — 20.0K and 1.2B, never 20k and 1.2G", () => {
    const big: Chart = { as: "bar", x: { name: "status", kind: "text", bucket: "" }, series: [""], other: false, said: [],
      points: [{ x: "Complete", s: "", v: 31000 }, { x: "Shipped", s: "", v: 1_200_000_000 }] };
    const spec = queryChartSpec(big, { segments: "stacked", labels: true, running: false }, COLOURS);
    const y = (first(spec).encoding.y.axis as Obj);
    expect(String(y.labelExpr)).toContain("'B'");
    expect(JSON.stringify(spec)).toContain('"as":"__label"');
    expect(String(y.labelExpr)).not.toContain("~s");
  });
});
