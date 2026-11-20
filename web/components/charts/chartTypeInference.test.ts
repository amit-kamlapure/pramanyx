/**
 * chartTypeInference.test.ts — a per-category summary with date bounds is a category grid.
 *
 * The LuxExperience check "Do Event and Platform really join on these keys?" (d14f276b, 2026-10-15)
 * returned one row per platform — attendance records, events, and the first and last event date —
 * and the inference read the two dates as a time axis: five dots, one per platform, scattered over
 * the years. The dates bound each row; the measure is by platform.
 */
import { describe, expect, it } from "vitest";
import { mapHintFor, inferChartType } from "./chartTypeInference";
import { classifyColumns } from "./columnRoles";

const COLUMNS = ["ep", "ap", "records", "ev", "mn", "mx"];
const ROWS = [
  ["MR PORTER", "MR PORTER", "476", "18", "2020-05-29", "2024-08-05"],
  ["Mytheresa", "Mytheresa", "377", "17", "2020-01-22", "2024-12-11"],
  ["NET-A-PORTER", "NET-A-PORTER", "185", "9", "2021-06-29", "2024-04-29"],
  ["THE OUTNET", "THE OUTNET", "321", "11", "2020-04-03", "2024-11-25"],
  ["YOOX", "YOOX", "283", "11", "2020-02-01", "2024-09-17"],
];

describe("a per-category summary with date bounds", () => {
  it("is drawn by category, never scattered over its date bounds", () => {
    const got = inferChartType(COLUMNS, ROWS);
    expect(got).not.toBeNull();
    expect(got!.type).not.toMatch(/line|scatter|heatmap|small-multiples/);
    expect(got!.xCol).toBe(0);
  });

  it("still reads a genuine series — one category over many dates — as a trend", () => {
    const columns = ["platform", "day", "records"];
    const rows = [
      ["MR PORTER", "2024-01-01", "10"], ["MR PORTER", "2024-02-01", "12"], ["MR PORTER", "2024-03-01", "9"],
      ["YOOX", "2024-01-01", "4"], ["YOOX", "2024-02-01", "6"], ["YOOX", "2024-03-01", "5"],
    ];
    const got = inferChartType(columns, rows);
    expect(got).not.toBeNull();
    expect(got!.xCol).toBe(1);
  });
});

describe("the map an answer is drawn as", () => {
  const POINTS = { columns: ["state", "latitude", "longitude", "locations"], rows: [["SP", -23.1, -47.0, 404268], ["RJ", -22.7, -43.1, 121169], ["MG", -19.8, -44.4, 126336]] };
  const COUNTRIES = { columns: ["country", "orders"], rows: [["Brazil", 40], ["France", 20], ["Japan", 10]] };

  it("draws rows with coordinates as points, unless the answer chose another chart", () => {
    expect(mapHintFor("Where are our warehouses?", POINTS.columns, POINTS.rows, "auto")).toBe("point_map");
    expect(mapHintFor("Where are our warehouses?", POINTS.columns, POINTS.rows, null)).toBe("point_map");
    expect(mapHintFor("Which state has the most?", POINTS.columns, POINTS.rows, "bar")).toBeNull();
  });

  it("lets the person's own word win over the chart chosen", () => {
    expect(mapHintFor("Show these on a map", POINTS.columns, POINTS.rows, "bar")).toBe("point_map");
    expect(mapHintFor("Orders by country on a map", COUNTRIES.columns, COUNTRIES.rows, "bar")).toBe("choropleth");
  });

  it("keeps a bar for countries nobody asked to see on a map", () => {
    expect(mapHintFor("Orders by country", COUNTRIES.columns, COUNTRIES.rows, "auto")).toBeNull();
  });

  it("offers no map the rows cannot draw, and does not read a mapping table as a map", () => {
    expect(mapHintFor("Show regions on a map", ["region", "orders"], [["North", 1], ["South", 2], ["East", 3]], "auto")).toBeNull();
    expect(mapHintFor("Check the mapping table by country", COUNTRIES.columns, COUNTRIES.rows, "auto")).toBeNull();
  });
});

describe("a date that is the same on every row (2026-11-20)", () => {
  it("is not the axis: GMV by platform as of one day is bars by platform", () => {
    const columns = ["platform", "last_day", "gmv_eur"];
    const rows = [["Mytheresa", "2026-11-20", 1245485.1], ["NET-A-PORTER", "2026-11-20", 1022318.86],
      ["YOOX", "2026-11-20", 503028.21], ["MR PORTER", "2026-11-20", 446310.99]];
    expect(classifyColumns(columns, rows).dateIdxs).toEqual([]);
    expect(inferChartType(columns, rows)?.type).toBe("bar");
  });
  it("a date that moves is still the axis", () => {
    const rows = [["2026-09-01", 10], ["2026-10-01", 12], ["2026-11-01", 9]];
    expect(classifyColumns(["month", "orders"], rows).dateIdxs).toEqual([0]);
  });
});
