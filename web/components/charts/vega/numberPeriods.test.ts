/**
 * A period held as a plain number — `fiscal_year` 2026 — is drawn one even band per period, in period order.
 *
 * 2026-11-15: an answer comparing FY2026 with FY2027 drew two bars a few pixels wide, pinned to the far left
 * and right of the plot, with nothing between them and no year on the axis. `fiscal_year` is a date column by
 * its name, so its band was a TIME scale, and a time scale reads the number 2026 as 2.026 seconds past
 * 1970: the two years sat a millisecond apart at the two ends of the scale, and a bar on a continuous
 * scale is a hairline. The same rows drew a line with no year under it.
 *
 * Every assertion here is on the PAINTED chart, read from Vega's scenegraph — the spec was valid all
 * along, which is why only the picture shows the defect.
 */

import { describe, expect, it } from "vitest";
import * as vl from "vega-lite";
import { View, parse } from "vega";
import { resolveVegaSpec, type ResolveSpecArgs } from "@/components/charts/vega/resolveSpec";
import { buildVegaConfig, printVegaTokens } from "@/components/charts/vega/config";

const config = buildVegaConfig(printVegaTokens());

type Node = { items?: Node[]; role?: string; marktype?: string; text?: unknown; opacity?: number;
              x?: number; width?: number; datum?: Record<string, unknown> };

/** The chart as painted at `width`: each bar's left edge, width and datum, the plot's width, and every axis label shown. */
async function painted(args: ResolveSpecArgs, width = 760) {
  const out = resolveVegaSpec(args)!;
  expect(out).not.toBeNull();
  const compiled = vl.compile({ ...out.spec, width, height: 300 } as Parameters<typeof vl.compile>[0], { config }).spec;
  const view = new View(parse(compiled), { renderer: "none" });
  await view.runAsync();
  const bars: { x: number; w: number; datum: Record<string, unknown> }[] = [];
  const labels: string[] = [];
  /** A line's points in the order its path joins them. */
  const path: { x: number; datum: Record<string, unknown> }[] = [];
  const walk = (nodes: Node[] | undefined, role = "", mark = "") => {
    for (const n of nodes ?? []) {
      const r = n.role || role;
      const m = n.marktype || mark;
      if (m === "rect" && r === "mark" && n.width !== undefined && n.datum) bars.push({ x: n.x!, w: n.width, datum: n.datum });
      if (m === "line" && r === "mark" && n.datum) path.push({ x: n.x!, datum: n.datum });
      if (r === "axis-label" && n.opacity !== 0 && typeof n.text === "string") labels.push(n.text);
      walk(n.items, r, m);
    }
  };
  walk((view.scenegraph() as unknown as { root?: { items?: Node[] } }).root?.items);
  return { out, bars, labels, path, plotW: view.width() };
}

const FY_COLS = ["fiscal_year", "total_gmv_eur"];
const FY_ROWS = [[2026, 48213456.7], [2027, 53120988.1]];

describe("a bar of fiscal years", () => {
  it("draws FY2026 and FY2027 as two even bars, not two hairlines at the edges", async () => {
    const { out, bars, labels, plotW } = await painted({ columns: FY_COLS, rows: FY_ROWS, chartType: "bar", showLabels: true });
    expect(out.resolved).toBe("bar");
    expect(bars).toHaveLength(2);
    const [a, b] = bars;
    // One band each: a bar a fair share of half the plot wide, and the two equally wide.
    expect(a.w).toBeGreaterThan(plotW / 2 * 0.5);
    expect(b.w).toBeCloseTo(a.w, 6);
    // Inside the plot, neither pinned to an edge.
    expect(a.x).toBeGreaterThan(0);
    expect(b.x + b.w).toBeLessThan(plotW);
    // In period order, each year named under its bar.
    expect(a.datum.fiscal_year).toBe(2026);
    expect(b.x).toBeGreaterThan(a.x);
    expect(labels).toEqual(expect.arrayContaining(["2026", "2027"]));
    expect(labels.filter((t) => /1970/.test(t))).toEqual([]);
  });

  it("reads the years in period order when the rows arrive newest first", async () => {
    const { bars } = await painted({ columns: FY_COLS, rows: [...FY_ROWS].reverse(), chartType: "bar", showLabels: true });
    expect(bars.map((b) => b.datum.fiscal_year)).toEqual(
      [...bars].sort((p, q) => p.x - q.x).map((b) => b.datum.fiscal_year));
    expect([...bars].sort((p, q) => p.x - q.x).map((b) => b.datum.fiscal_year)).toEqual([2026, 2027]);
  });

  it("reads years written as text the same way, newest first or not", async () => {
    const rows = [...FY_ROWS].reverse().map(([y, v]) => [String(y), String(v)]);
    const { bars, labels, plotW } = await painted({ columns: FY_COLS, rows, chartType: "bar", showLabels: true });
    expect(bars).toHaveLength(2);
    expect(Math.min(...bars.map((b) => b.w))).toBeGreaterThan(plotW / 4);
    expect([...bars].sort((p, q) => p.x - q.x).map((b) => Number(b.datum.fiscal_year))).toEqual([2026, 2027]);
    expect(labels).toEqual(expect.arrayContaining(["2026", "2027"]));
  });

  it("runs a line of month numbers written as text from 1 to 12, not 1, 10, 11, 12, 2", async () => {
    const rows = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => [String(m), String(100 + m)]);
    const { path } = await painted({ columns: ["month", "orders"], rows, chartType: "line" });
    expect(path.map((p) => Number(p.datum.month))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(path.every((p, i) => i === 0 || p.x > path[i - 1].x)).toBe(true);
  });

  it("names each year under a line of fiscal years too", async () => {
    const { labels } = await painted({ columns: FY_COLS, rows: FY_ROWS, chartType: "line" });
    expect(labels).toEqual(expect.arrayContaining(["2026", "2027"]));
  });

  it("puts the change of each year on its own even band, in year order", async () => {
    const rows = [[2027, "53120988.1", "0.1018"], [2025, "44100000", "NULL"], [2026, "48213456.7", "0.0933"]];
    const { bars, labels } = await painted({ columns: ["fiscal_year", "total_gmv_eur", "gmv_yoy_growth"], rows,
                                              chartType: "bar", showLabels: true, measure: "gmv_yoy_growth" });
    expect(bars).toHaveLength(2);                      // the year with no change before it is no bar
    expect(bars[1].w).toBeCloseTo(bars[0].w, 6);
    expect([...bars].sort((p, q) => p.x - q.x).map((b) => String(b.datum.fiscal_year))).toEqual(["2026", "2027"]);
    expect(labels).toEqual(expect.arrayContaining(["2026", "2027"]));
  });

  it("orders twelve month numbers as numbers, not as text", async () => {
    const rows = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => [m, 100 + m]);
    const { bars } = await painted({ columns: ["month", "orders"], rows, chartType: "bar", showLabels: false });
    expect([...bars].sort((p, q) => p.x - q.x).map((b) => b.datum.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(Math.max(...bars.map((b) => b.w)) - Math.min(...bars.map((b) => b.w))).toBeLessThan(1e-6);
  });
});

describe("the forms beyond the six, over fiscal years", () => {
  const rows = [2026, 2027].flatMap((y, i) => ["North", "South"].map((r, j) => [y, r, 1e6 * (2 + i + j)]));

  it.each(["grouped-bar", "stacked-bar"])("a %s puts each year on its own band", async (chartType) => {
    const { bars, labels, plotW } = await painted({ columns: ["fiscal_year", "region", "gmv"], rows, chartType });
    expect(bars).toHaveLength(4);
    expect(Math.min(...bars.map((b) => b.w))).toBeGreaterThan(plotW / 8);
    expect(labels).toEqual(expect.arrayContaining(["2026", "2027"]));
  });

  it("a forecast line names its years", async () => {
    const f = [[2025, 100, 90, 110], [2026, 120, 105, 135], [2027, 140, 118, 162]];
    const { labels } = await painted({ columns: ["fiscal_year", "gmv", "lower", "upper"], rows: f, chartType: "line-forecast" });
    expect(labels).toEqual(expect.arrayContaining(["2025", "2026", "2027"]));
  });

  it("small multiples name their years", async () => {
    const sm = ["North", "South"].flatMap((r) => [2025, 2026, 2027].map((y, i) => [r, y, 100 + i * 10]));
    const { labels } = await painted({ columns: ["region", "fiscal_year", "gmv"], rows: sm, chartType: "small-multiples" });
    expect(labels).toEqual(expect.arrayContaining(["2025", "2026", "2027"]));
  });
});

describe("a real date stays on a time scale", () => {
  const months = ["2025-01-01", "2025-02-01", "2025-03-01", "2025-04-01", "2025-05-01", "2025-06-01"];

  it("a monthly bar is drawn on time, as it was", () => {
    const out = resolveVegaSpec({ columns: ["order_month", "revenue"], rows: months.map((m, i) => [m, 100 + i]),
                                  chartType: "bar", showLabels: true })!;
    const x = (out.spec.encoding as Record<string, Record<string, unknown>>).x;
    expect(x.type).toBe("temporal");
    expect(x.scale).toMatchObject({ type: "utc" });
    expect((x.axis as Record<string, unknown>).format).toBe("%b %Y");
  });

  it("a monthly line too", () => {
    const out = resolveVegaSpec({ columns: ["order_month", "revenue"], rows: months.map((m, i) => [m, 100 + i]),
                                  chartType: "line" })!;
    expect((out.spec.encoding as Record<string, Record<string, unknown>>).x.type).toBe("temporal");
  });

  it("a stacked bar by month too (a grouped one is a band per month, labelled as a month: timeBars.test.ts)", () => {
    const rows = months.flatMap((m) => ["North", "South"].map((r, j) => [m, r, 100 + j]));
    const out = resolveVegaSpec({ columns: ["order_month", "region", "revenue"], rows, chartType: "stacked-bar" })!;
    expect((out.spec.encoding as Record<string, Record<string, unknown>>).x.type).toBe("temporal");
  });
});
