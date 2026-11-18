/**
 * The hover rule on a line chart (study R25): a dashed rule at the nearest x, a ring on each line there, and one
 * tooltip with the date and every series' value, largest first, each beside its line's colour.
 */
import { describe, expect, it } from "vitest";
import * as vl from "vega-lite";
import { View, parse } from "vega";
import { HOVER_MARK, hoverHead, hoverHtml, hoverMetaOf, hoverRows, hoverValue, type HoverMeta } from "@/components/charts/vega/hoverTooltip";
import { resolveVegaSpec } from "@/components/charts/vega/resolveSpec";
import { clickedDatum, pickOf } from "@/components/charts/selection";
import { buildVegaConfig, printVegaTokens } from "@/components/charts/vega/config";

const TREND = {
  columns: ["month", "region", "revenue"],
  rows: [
    ["2025-01-01", "North", 120], ["2025-01-01", "South", 340], ["2025-01-01", "West", 90],
    ["2025-02-01", "North", 150], ["2025-02-01", "South", 310], ["2025-02-01", "West", 200],
    ["2025-03-01", "North", 170], ["2025-03-01", "South", 360],
  ] as unknown[][],
};

const META: HoverMeta = { x: "month", gran: "month", series: ["North", "South", "West"], label: null,
                          format: null, pct: false, prefix: "" };
const swatch = (s: string) => ({ North: "#3b82f6", South: "#22c55e", West: "#f59e0b" } as Record<string, string>)[s] ?? null;
const esc = (v: unknown) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

describe("the hover tooltip's words", () => {
  it("lists every series at the x, largest first, a missing one last", () => {
    const rows = hoverRows({ month: Date.UTC(2025, 2, 1), North: 170, South: 360 }, META, swatch);
    expect(rows.map((r) => [r.name, r.text])).toEqual([["South", "360"], ["North", "170"], ["West", "—"]]);
    expect(rows[0].color).toBe("#22c55e");
  });

  it("writes the date in its grain, and a category as itself", () => {
    expect(hoverHead(Date.UTC(2025, 2, 1), "month")).toBe("Mar 2025");
    expect(hoverHead("2025-01-01", "quarter")).toBe("Q1 2025");
    expect(hoverHead("Email", null)).toBe("Email");
  });

  it("writes a value as the axis does: its format, a percent, or the app's figure with the money symbol", () => {
    expect(hoverValue(1234567, { format: null, pct: false, prefix: "$" })).toBe("$1.23M");
    expect(hoverValue(0.1234, { format: null, pct: true, prefix: "" })).toBe("12.3%");
    expect(hoverValue(1234.5, { format: ",.0f", pct: false, prefix: "" })).toBe("1,235");
    expect(hoverValue(null, { format: null, pct: false, prefix: "" })).toBe("—");
  });

  it("names a single line by its axis title", () => {
    const one: HoverMeta = { ...META, series: ["revenue"], label: "Revenue" };
    expect(hoverRows({ month: "2025-01-01", revenue: 5 }, one, () => null).map((r) => r.name)).toEqual(["Revenue"]);
  });

  it("escapes every word and draws a swatch only from a colour", () => {
    const meta: HoverMeta = { ...META, series: ["<b>x</b>"] };
    const html = hoverHtml({ month: "2025-01-01", "<b>x</b>": 1 }, meta, () => "red;background:url(x)", esc);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("url(");
    expect(hoverHtml({ month: "2025-01-01", North: 1 }, { ...META, series: ["North"] }, swatch, esc))
      .toContain('style="background:#3b82f6"');
  });
});

describe("the hover rule in a line chart's spec", () => {
  it("carries what the tooltip needs, the series in data order", () => {
    const resolved = resolveVegaSpec({ columns: TREND.columns, rows: TREND.rows, chartType: "multi-line" })!;
    expect(hoverMetaOf(resolved.spec)).toMatchObject({ x: "month", gran: "month", series: ["North", "South", "West"],
                                                       label: null, pct: false });
  });

  it("draws: one row per x with every series, a voronoi that answers a click with the x, and no stray legend entry", async () => {
    const resolved = resolveVegaSpec({ columns: TREND.columns, rows: TREND.rows, chartType: "multi-line" })!;
    const config = buildVegaConfig(printVegaTokens());
    const compiled = vl.compile({ ...resolved.spec, width: 400, height: 240 } as never, { config: config as never }).spec;
    // each param is declared once: a duplicated one fails the parse and draws nothing
    const names = (compiled.signals ?? []).map((s) => s.name);
    expect(names.filter((n) => n === "hover_tuple")).toHaveLength(1);
    expect(names.filter((n) => n === "picked_tuple")).toHaveLength(1);
    const view = new View(parse(compiled), { renderer: "none" });
    await view.runAsync();
    type Item = { datum?: Record<string, unknown>; items?: Item[]; isVoronoi?: boolean; tooltip?: unknown;
                  mark?: { role?: string; marktype?: string; name?: string } };
    const all: Item[] = [];
    const walk = (n: Item) => { for (const it of n.items ?? []) { all.push(it); walk(it); } };
    walk((view.scenegraph() as unknown as { root: Item }).root);
    const domain = (view.scale("color") as unknown as { domain: () => unknown[] }).domain();
    view.finalize();

    const cells = all.filter((it) => it.isVoronoi);
    expect(cells).toHaveLength(3);                                         // one per month
    const row = clickedDatum(cells[1]) as Record<string, unknown>;
    expect(row[HOVER_MARK]).toBe(true);
    expect([row.North, row.South, row.West]).toEqual([150, 310, 200]);
    expect(pickOf(row, TREND.columns, TREND.rows, "multi-line")).toEqual({ field: "month", value: "2025-02-01" });
    expect((cells[1].tooltip as Record<string, unknown>)[HOVER_MARK]).toBe(true);
    expect(domain).toEqual(["North", "South", "West"]);
  });

  it("draws a single line's rule over its own rows", async () => {
    const one = { columns: ["month", "revenue"], rows: [["2025-01-01", 1], ["2025-02-01", 3]] as unknown[][] };
    const resolved = resolveVegaSpec({ columns: one.columns, rows: one.rows, chartType: "line" })!;
    expect(hoverMetaOf(resolved.spec)).toMatchObject({ series: ["revenue"], label: "Revenue" });
    const config = buildVegaConfig(printVegaTokens());
    const view = new View(parse(vl.compile({ ...resolved.spec, width: 300, height: 200 } as never,
                                           { config: config as never }).spec), { renderer: "none" });
    await view.runAsync();
    type Item = { items?: Item[]; isVoronoi?: boolean };
    let cells = 0;
    const walk = (n: Item) => { for (const it of n.items ?? []) { if (it.isVoronoi) cells += 1; walk(it); } };
    walk((view.scenegraph() as unknown as { root: Item }).root);
    view.finalize();
    expect(cells).toBe(2);
  });
});
