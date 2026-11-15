import { describe, expect, it } from "vitest";

import { availableChartTypes, inferChartType } from "@/components/charts/chartTypeInference";

import { resolveVegaSpec } from "./resolveSpec";

type Enc = Record<string, { field?: string; type?: string }>;
const encodingOf = (columns: string[], rows: unknown[][], chartType = "bar") => {
  const r = resolveVegaSpec({ columns, rows, chartType, names: undefined, exhibit: null, columnUnits: null,
                              showLabels: true, orient: null, measure: null, title: null } as never);
  return ((r?.spec as { encoding?: Enc })?.encoding ?? {}) as Enc;
};

describe("a breakdown by a number", () => {
  // The coworker, 2026-11-14: "How many Olist reviews by review score?" — two number columns and no other. The band fell
  // back to the first column and the measure was that same column, so the chart drew review_score against itself.
  const reviews = [["1", "11424"], ["2", "3151"], ["3", "8179"], ["4", "19142"], ["5", "57328"]];

  it("plots the count against the score, never the score against itself", () => {
    const e = encodingOf(["review_score", "review_count"], reviews);
    const fields = [e.x?.field, e.y?.field];
    expect(fields).toContain("review_score");
    expect(fields).toContain("review_count");
    const measure = e.x?.type === "quantitative" ? e.x : e.y;
    expect(measure?.field).toBe("review_count");
  });

  it("leaves a breakdown by a label as it was", () => {
    const e = encodingOf(["status", "orders"], [["shipped", "10"], ["returned", "4"]]);
    const measure = e.x?.type === "quantitative" ? e.x : e.y;
    expect(measure?.field).toBe("orders");
  });
});

describe("a breakdown by a number, left to the platform to draw", () => {
  const reviews = [["1", "11424"], ["2", "3151"], ["3", "8179"], ["4", "19142"], ["5", "57328"]];
  const cols = ["review_score", "review_count"];

  it("is a bar per value of the number, where it drew nothing", () => {
    expect(inferChartType(cols, reviews)).toEqual({ type: "bar", xCol: 0, yCols: [1] });
    const e = encodingOf(cols, reviews, "auto");
    const measure = e.x?.type === "quantitative" ? e.x : e.y;
    expect(measure?.field).toBe("review_count");
    expect(availableChartTypes(cols, reviews)).toContain("bar");
  });

  it("is a bar per hour too, where it drew a scatter", () => {
    const hours = Array.from({ length: 24 }, (_, h) => [String(h), String(100 + h * 3)]);
    expect(inferChartType(["hour_of_day", "orders"], hours)?.type).toBe("bar");
  });

  it("leaves two measures that are not a breakdown as a relation", () => {
    const pairs = Array.from({ length: 12 }, (_, i) => [String(10.5 + i * 1.3), String(200 - i * 4.2)]);
    expect(inferChartType(["avg_price", "avg_discount"], pairs)?.type).toBe("scatter");
    const repeats = Array.from({ length: 12 }, (_, i) => [String(i % 3), String(i)]);
    expect(inferChartType(["bucket", "value"], repeats)?.type).toBe("scatter");
  });
});
