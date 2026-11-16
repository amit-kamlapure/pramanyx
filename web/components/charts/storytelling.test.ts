/**
 * The storytelling kinds (the board study, 2026-11-16) are offered only where the result holds their shape: a ranking
 * for any category and measure, before → after for two measures, a bullet only beside a target, cohorts only beside an
 * age, intervals only beside both bounds — never offered to a result that cannot draw them.
 */
import { describe, expect, it } from "vitest";
import { ALL_CHART_TYPES, CHART_TYPE_LABEL, availableChartTypes } from "@/components/charts/chartTypeInference";
import { resolveVegaSpec } from "@/components/charts/vega/resolveSpec";

const KINDS = ["lollipop", "leaderboard", "dumbbell", "slope", "bullet", "cohort", "interval"] as const;

describe("the storytelling kinds", () => {
  it("are in the editor's list, each with its own name", () => {
    for (const k of KINDS) {
      expect(ALL_CHART_TYPES).toContain(k);
      expect(CHART_TYPE_LABEL[k]).toBeTruthy();
    }
  });

  it("offer a ranking for a category and a measure, and nothing that needs more", () => {
    const got = availableChartTypes(["channel", "revenue"], [["Search", 5], ["Email", 3], ["Display", 1]]);
    expect(got).toEqual(expect.arrayContaining(["leaderboard", "lollipop"]));
    for (const k of ["dumbbell", "bullet", "cohort", "interval"]) expect(got).not.toContain(k);
  });

  it("offer before → after for two measures", () => {
    const got = availableChartTypes(["category", "revenue_2024", "revenue_2025"], [["A", 1, 2], ["B", 3, 2]]);
    expect(got).toEqual(expect.arrayContaining(["dumbbell", "slope"]));
  });

  it("offer a bullet only beside a target", () => {
    expect(availableChartTypes(["team", "bookings", "target"], [["N", 82, 100], ["S", 104, 95]])).toContain("bullet");
    expect(availableChartTypes(["team", "bookings", "refunds"], [["N", 82, 10], ["S", 104, 9]])).not.toContain("bullet");
  });

  it("offer cohorts only beside an age, and intervals only beside both bounds", () => {
    expect(availableChartTypes(["cohort_month", "month_number", "retention"], [["2025-01-01", 0, 1], ["2025-01-01", 1, 0.4]])).toContain("cohort");
    expect(availableChartTypes(["region", "estimate", "lower", "upper"], [["N", 1, 0.8, 1.2], ["S", 2, 1.5, 2.4]])).toContain("interval");
    expect(availableChartTypes(["region", "estimate", "lower"], [["N", 1, 0.8], ["S", 2, 1.5]])).not.toContain("interval");
  });

  it("refuse a result that cannot carry them, rather than approximating", () => {
    expect(resolveVegaSpec({ columns: ["team", "bookings"], rows: [["N", 1], ["S", 2]], chartType: "bullet" })?.resolved).not.toBe("bullet");
    expect(resolveVegaSpec({ columns: ["region", "estimate"], rows: [["N", 1], ["S", 2]], chartType: "interval" })?.resolved).not.toBe("interval");
  });
});
