import { describe, expect, it } from "vitest";

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
