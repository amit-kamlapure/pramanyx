/**
 * The one chart editor's model, built one way for a dashboard card and for an answer's chart (2026-11-20). A dashboard
 * card is re-queried, so every control is offered; an answer is ROWS ONLY — what only a new query could honour is
 * withheld and said so, and its own extras (Pivot, the kinds its rows draw) are in the same lists.
 */
import { describe, expect, it, vi } from "vitest";
import { queryEditorModel, type QueryDraft } from "@/components/charts/queryEditorModel";
import { openingDraft, shapeAnswer, typedColumns } from "@/lib/dashboards/answerShape";
import { drawnFields } from "@/components/charts/drawn";
import { QUERY_DEFAULT } from "@/components/dashboards/QuerySetup";
import type { QueryShown, TypedColumn } from "@/lib/api";

const COLUMNS: TypedColumn[] = [{ name: "month", type: "DATE" }, { name: "status", type: "VARCHAR" }, { name: "orders", type: "BIGINT" }];
const SHOWN: QueryShown = { ...QUERY_DEFAULT, as: "bar", summed: true, x: "month", bucket: "month", series: [{ column: "orders", agg: "sum" }], split: "status" };
const build = (draft: QueryDraft, rowsOnly = false, commit = vi.fn()) => queryEditorModel({
  draft, columns: COLUMNS, shaped: null, commit, texts: { yMin: "", yMax: "" }, setText: () => {},
  rowsOnly: rowsOnly ? { otherKinds: ["pie", "choropleth"], canPivot: true } : null,
});

describe("the one editor's model", () => {
  it("offers a dashboard card every control a re-query honours", () => {
    const m = build({ shown: SHOWN, viz: {} });
    expect(m.dimLabel).toBe("MONTHLY(month)");
    expect(m.bucketOptions?.length).toBeGreaterThan(0);
    expect(m.summedValue).toBe(true);
    expect(m.measureAggOptions?.length).toBeGreaterThan(0);
    expect(m.measures).toEqual([{ column: "orders", agg: "sum" }]);
    expect(m.withheld).toEqual([]);
    expect(m.vizOptions?.map(o => o.v)).not.toContain("pivot");
  });

  it("rows only: no bucket, no calculation, no summing — each said to need the question asked again", () => {
    const m = build({ shown: { ...SHOWN, summed: false, bucket: "" }, viz: {} }, true);
    expect(m.dimLabel).toBe("month");
    expect(m.bucketOptions).toBeUndefined();
    expect(m.summedValue).toBeUndefined();
    expect(m.measureAggOptions).toBeUndefined();
    expect(m.measures).toEqual([{ column: "orders", agg: null }]);
    expect(m.withheld?.map(w => [w.at, w.label])).toEqual([["x", "Counted by"], ["y", "Calculation"], ["y", "Rows"]]);
    for (const w of m.withheld ?? []) expect(w.why).toMatch(/needs the question asked again/);
    // the running total is over the points drawn: it stays
    expect(m.runningValue).toBe(false);
    expect(m.vizOptions?.map(o => o.v)).toEqual(["bar", "line", "area", "scatter", "pie", "choropleth", "table", "pivot", "figure"]);
    expect(m.transformOptions.length).toBeGreaterThan(0);
  });

  it("an answer switched to Line keeps showing its points, as an answer's line does (2026-11-23)", () => {
    const answer = vi.fn();
    build({ shown: { ...SHOWN, summed: false, bucket: "" }, viz: { type: "multi-line" } }, true, answer).setChartType("line");
    expect(answer.mock.calls[0][0].viz.markers).toBe(true);
    const told = vi.fn();
    build({ shown: { ...SHOWN, summed: false, bucket: "" }, viz: { type: "multi-line", markers: false } }, true, told).setChartType("line");
    expect(told.mock.calls[0][0].viz.markers).toBe(false);
    const card = vi.fn();
    build({ shown: { ...SHOWN, as: "bar" }, viz: {} }, false, card).setChartType("line");
    expect(card.mock.calls[0][0].viz.markers).toBeUndefined();   // a query card's line hides them unless told
  });

  it("rows only: a change is kept as rows draw it, never summed nor bucketed", () => {
    const commit = vi.fn();
    const m = build({ shown: { ...SHOWN, summed: false, bucket: "" }, viz: {} }, true, commit);
    m.setDim("status");
    expect(commit.mock.calls[0][0].shown).toMatchObject({ x: "status", summed: false, bucket: "" });
    m.setViz?.("pivot");
    expect(commit.mock.calls[1][0].viz.view).toBe("pivot");
  });
});

describe("an answer's rows shaped as a card's run", () => {
  const cols = typedColumns(["month", "channel", "revenue"], [["2025-01-01", "Online", 10], ["2025-02-01", "Store", 7]]);
  const rows = [["2025-02-01", "Online", 12], ["2025-01-01", "Online", 10], ["2025-01-01", "Store", 7], ["2025-01-01", "Web", 1]];

  it("reads the answer's columns by kind", () => {
    expect(cols.map(c => c.type)).toEqual(["DATE", "VARCHAR", "DOUBLE"]);
  });

  it("draws a point per row in order, its split's top values, the rest said and not added up", () => {
    const s = shapeAnswer(cols, rows, { ...QUERY_DEFAULT, as: "line", summed: false, x: "month", series: [{ column: "revenue", agg: "sum" }], split: "channel", top: 2 });
    if (s.as !== "line") throw new Error("a line");
    expect(s.series).toEqual(["Online", "Store"]);
    expect(s.points).toEqual([{ x: "2025-01-01", s: "Online", v: 10 }, { x: "2025-01-01", s: "Store", v: 7 }, { x: "2025-02-01", s: "Online", v: 12 }]);
    expect(s.said.join(" ")).toMatch(/1 other values of channel are not drawn/);
  });

  it("keeps a running total and a transform over each series' points", () => {
    const base = { ...QUERY_DEFAULT, as: "bar" as const, summed: false, x: "month", series: [{ column: "revenue", agg: "sum" as const }], split: "" };
    const two = [["2025-01-01", "a", 10], ["2025-02-01", "a", 15]];
    const run = shapeAnswer(cols, two, { ...base, running: true });
    expect("points" in run && run.points.map(p => p.v)).toEqual([10, 25]);
    const pop = shapeAnswer(cols, two, base, { transform: "pop" });
    expect("points" in pop && pop.points.map(p => p.v)).toEqual([null, 0.5]);
    expect("format" in pop && pop.format).toBe("percent");
  });

  it("shows a table's chosen columns in its order, and a figure's first value", () => {
    const t = shapeAnswer(cols, rows, { ...QUERY_DEFAULT, as: "table", columns: ["revenue", "channel"], sort: "revenue", descending: true });
    expect(t.as === "table" && t.rows[0]).toEqual([12, "Online"]);
    const f = shapeAnswer(cols, rows, { ...QUERY_DEFAULT, as: "figure", series: [{ column: "revenue", agg: "sum" }], label: "Revenue" });
    expect(f).toMatchObject({ as: "figure", value: 12, label: "Revenue" });
    expect(f.said.join(" ")).toMatch(/figure is its first/);
  });
});

describe("the editor's opening values name what is drawn", () => {
  it("reads a layered line's x and colour above its y, and a fold's measures", () => {
    const line = { encoding: { x: { field: "month", type: "temporal" }, color: { field: "channel", type: "nominal" } },
      layer: [{ encoding: { y: { field: "revenue", type: "quantitative" } }, layer: [{ mark: "line" }] }] };
    expect(drawnFields(line, ["month", "channel", "revenue"])).toEqual({ x: "month", measures: ["revenue"], color: "channel" });
    const fold = { transform: [{ fold: ["revenue", "cost"], as: ["__measure", "__value"] }],
      encoding: { y: { field: "region", type: "nominal" }, x: { field: "__value", type: "quantitative" }, color: { field: "__measure", type: "nominal" } } };
    expect(drawnFields(fold, ["region", "revenue", "cost"])).toEqual({ x: "region", measures: ["revenue", "cost"], color: null });
    const pie = { encoding: { theta: { field: "orders", type: "quantitative" }, color: { field: "status", type: "nominal" } } };
    expect(drawnFields(pie, ["status", "orders"])).toEqual({ x: "status", measures: ["orders"], color: null });
  });

  it("opens on the drawn kind and fields: the query's own kind as its setup, another as the chart's", () => {
    const fields = { x: "month", measures: ["revenue"], color: "channel" };
    const bar = openingDraft({ columns: cols3, view: "chart", type: "bar", across: true, fields, seed: {}, labels: false });
    expect(bar.shown).toMatchObject({ as: "bar", x: "month", split: "channel", across: true, summed: false, bucket: "" });
    expect(bar.viz.type).toBeUndefined();
    const multi = openingDraft({ columns: cols3, view: "chart", type: "multi-line", across: false, fields, seed: { numberFormat: ",.0f" }, labels: true });
    expect(multi.viz).toMatchObject({ type: "multi-line", numberFormat: ",.0f", showLabels: true });
    const line = openingDraft({ columns: cols3, view: "chart", type: "line", across: false, fields, seed: {}, labels: false });
    // an answer's line shows its points: the opening says so
    expect(line.viz.markers).toBe(true);
  });
});

const cols3: TypedColumn[] = [{ name: "month", type: "DATE" }, { name: "channel", type: "VARCHAR" }, { name: "revenue", type: "DOUBLE" }];
