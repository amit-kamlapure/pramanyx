/**
 * A person's own query card in the board study (2026-11-16): its chart carries the place as the query returned it beside
 * the words it is drawn with — what a click reports — and lights the place a dashboard's focus chose; a line stays
 * whole. Any kind beyond its own six is drawn by an answer's chart, from the same points.
 */
import { describe, expect, it } from "vitest";

import type { QueryShaped } from "@/lib/api";
import { queryChartSpec } from "@/lib/dashboards/queryChart";
import { isOtherKind, queryGrid } from "@/components/dashboards/DashboardTile";

type Chart = Extract<QueryShaped, { as: "bar" | "line" | "area" | "scatter" }>;
const COLOURS = { palette: ["#c1", "#c2", "#c3"], other: "#grey" };
const setup = { segments: "stacked" as const, labels: false, running: false };
const chart = (as: Chart["as"], split = false): Chart => ({
  as, x: { name: "channel", kind: "text", bucket: "" }, series: split ? ["Men", "Women"] : [""], other: false, said: [],
  points: ["Search", "Email"].flatMap((x, i) => (split ? ["Men", "Women"] : [""]).map((s, j) => ({ x, s, v: 10 * (i + 1) + j }))),
});
type Layer = { encoding: Record<string, unknown> };
const first = (spec: Record<string, unknown>) => (spec.layer as Layer[])[0];
const values = (spec: Record<string, unknown>) => (spec.data as { values: Record<string, unknown>[] }).values;

describe("a query card's chart and the dashboard's focus", () => {
  it("carries each place as the query returned it", () => {
    expect(values(queryChartSpec(chart("bar"), setup, COLOURS)).map(v => v.xr)).toEqual(["Search", "Email"]);
  });

  it("lights the chosen place and lets the rest recede", () => {
    const enc = first(queryChartSpec(chart("bar"), setup, COLOURS, ["Email"])).encoding;
    const test = (enc.opacity as { condition: { test: string } }).condition.test;
    expect(test).toContain('["Email"]');
    expect(test).toContain('datum["xr"]');
  });

  it("leaves a line whole, and draws as before when nothing is chosen", () => {
    expect(first(queryChartSpec(chart("line"), setup, COLOURS, ["Email"])).encoding.opacity).toBeUndefined();
    expect(first(queryChartSpec(chart("bar"), setup, COLOURS)).encoding.opacity).toBeUndefined();
  });
});

describe("any kind beyond a query's own six", () => {
  it("is a kind an answer's chart draws that the query's own do not", () => {
    for (const own of ["bar", "line", "area", "scatter", "auto", "table", undefined, null]) expect(isOtherKind(own)).toBe(false);
    for (const other of ["treemap", "lollipop", "leaderboard", "pie"]) expect(isOtherKind(other)).toBe(true);
    expect(isOtherKind("not-a-kind")).toBe(false);
  });

  it("reads the query's points as a result grid, its measure by its own column", () => {
    const one = queryGrid(chart("bar"), { series: [{ column: "sale_price", agg: "sum" }], split: "" });
    expect(one).toEqual({ columns: ["channel", "sale_price"], rows: [["Search", 10], ["Email", 20]] });
    const two = queryGrid(chart("bar", true), { series: [{ column: "sale_price", agg: "sum" }], split: "department" });
    expect(two.columns).toEqual(["channel", "department", "sale_price"]);
    expect(two.rows).toContainEqual(["Email", "Women", 21]);
  });
});
