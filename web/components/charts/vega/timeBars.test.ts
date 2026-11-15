/**
 * A bar over real dates takes its period: one bar per month, as wide as a category's would be, centred on its month.
 *
 * 2026-11-16: on a time scale a bar has no band, and Vega-Lite draws it 5px wide whatever its period — eight months
 * of revenue read as eight hairlines a hundred pixels apart; a grouped bar by month lost its grouping too ("xOffset
 * dropped because x is continuous") and stacked its hairlines. Measured on the PAINTED chart, from Vega's scenegraph.
 */

import { describe, expect, it } from "vitest";
import * as vl from "vega-lite";
import { View, parse } from "vega";
import { resolveVegaSpec, type ResolveSpecArgs } from "@/components/charts/vega/resolveSpec";
import { buildVegaConfig, printVegaTokens } from "@/components/charts/vega/config";
import { MAX_BAR_PX } from "@/components/charts/vega/bandFit";

const config = buildVegaConfig(printVegaTokens());

type Node = { items?: Node[]; role?: string; marktype?: string; text?: unknown; opacity?: number;
              x?: number; y?: number; width?: number; height?: number; datum?: Record<string, unknown> };
type Bar = { x: number; w: number; y: number; h: number; datum: Record<string, unknown> };

async function painted(args: ResolveSpecArgs, width = 760, height = 300) {
  const out = resolveVegaSpec(args)!;
  expect(out).not.toBeNull();
  const compiled = vl.compile({ ...out.spec, width, height } as Parameters<typeof vl.compile>[0], { config }).spec;
  const view = new View(parse(compiled), { renderer: "none" });
  await view.runAsync();
  const bars: Bar[] = [];
  const labels: { text: string; x: number }[] = [];
  const walk = (nodes: Node[] | undefined, role = "", mark = "") => {
    for (const n of nodes ?? []) {
      const r = n.role || role;
      const m = n.marktype || mark;
      if (m === "rect" && r === "mark" && n.width !== undefined && n.datum) {
        bars.push({ x: n.x!, w: n.width, y: n.y!, h: n.height!, datum: n.datum });
      }
      if (r === "axis-label" && n.opacity !== 0 && (typeof n.text === "string" || Array.isArray(n.text))) {
        labels.push({ text: Array.isArray(n.text) ? n.text.join(" ") : n.text, x: n.x! });
      }
      walk(n.items, r, m);
    }
  };
  walk((view.scenegraph() as unknown as { root?: { items?: Node[] } }).root?.items);
  bars.sort((a, b) => a.x - b.x);
  return { out, bars, labels, plotW: view.width(), plotH: view.height() };
}

const MONTHS = ["2025-01-01", "2025-02-01", "2025-03-01", "2025-04-01", "2025-05-01", "2025-06-01", "2025-07-01", "2025-08-01"];
const monthly = (ms: string[]) => ms.map((m, i) => [m, 120 + i * 9]);
const centre = (b: Bar) => b.x + b.w / 2;

describe("a bar over months", () => {
  it("is one bar per month as wide as a category's, not a 5px hairline", async () => {
    const { out, bars, plotW } = await painted({ columns: ["order_month", "revenue"], rows: monthly(MONTHS), chartType: "bar",
                                                 showLabels: true });
    expect(out.resolved).toBe("bar");
    expect(bars).toHaveLength(8);
    const step = plotW / 8;
    for (const b of bars) {
      expect(b.w).toBeGreaterThanOrEqual(Math.min(MAX_BAR_PX, 0.9 * step) - 0.5);
      expect(b.w).toBeLessThanOrEqual(Math.max(MAX_BAR_PX, 0.4 * step) + 0.5);
      expect(b.x).toBeGreaterThanOrEqual(0);                    // inside the plot, first and last too
      expect(b.x + b.w).toBeLessThanOrEqual(plotW);
    }
    expect(Math.max(...bars.map((b) => b.w)) - Math.min(...bars.map((b) => b.w))).toBeLessThan(1e-6);
    // Still a time axis — the same scale and labels it had.
    const x = (out.spec.encoding as Record<string, Record<string, unknown>>).x;
    expect(x.type).toBe("temporal");
    expect(x.scale).toMatchObject({ type: "utc" });
  });

  it("puts each month's label under the middle of its bar", async () => {
    const { bars, labels } = await painted({ columns: ["order_month", "revenue"], rows: monthly(MONTHS.slice(0, 6)),
                                             chartType: "bar", showLabels: false });
    const named = ["Jan 2025", "Feb 2025", "Mar 2025", "Apr 2025", "May 2025", "Jun 2025"];
    named.forEach((t, i) => {
      const l = labels.find((p) => p.text === t);
      expect(l, t).toBeDefined();
      expect(Math.abs(l!.x - centre(bars[i]))).toBeLessThan(2);
    });
  });

  it("keeps a missing month's place empty", async () => {
    const ms = ["2025-01-01", "2025-02-01", "2025-03-01", "2025-05-01", "2025-06-01"];
    const { bars } = await painted({ columns: ["order_month", "revenue"], rows: monthly(ms), chartType: "bar" });
    const gap = centre(bars[3]) - centre(bars[2]);
    const one = centre(bars[1]) - centre(bars[0]);
    expect(gap / one).toBeGreaterThan(1.8);
    expect(bars[0].w).toBeGreaterThan(40);
  });

  it("draws a single month as a bar, not a sliver", async () => {
    const { bars, labels, plotW } = await painted({ columns: ["order_month", "revenue"], rows: [["2025-03-01", 42]],
                                                    chartType: "bar" });
    expect(bars).toHaveLength(1);
    expect(bars[0].w).toBeGreaterThanOrEqual(MAX_BAR_PX);
    expect(Math.abs(centre(bars[0]) - plotW / 2)).toBeLessThan(2);
    expect(labels.map((l) => l.text)).toContain("Mar 2025");
  });

  it("keeps sixty days apart — never wider than its day", async () => {
    const days = Array.from({ length: 60 }, (_, i) => [new Date(Date.UTC(2025, 6, 1 + i)).toISOString().slice(0, 10), 5 + (i % 7)]);
    const { bars, plotW } = await painted({ columns: ["order_date", "orders"], rows: days, chartType: "bar" });
    expect(bars).toHaveLength(60);
    bars.slice(1).forEach((b, i) => expect(b.x).toBeGreaterThanOrEqual(bars[i].x + bars[i].w - 1e-6));
    expect(bars[0].w).toBeGreaterThan(0.8 * plotW / 60);
  });

  it("keeps weeks on their own dates, one bar each", async () => {
    const weeks = ["2025-08-04", "2025-08-11", "2025-08-18", "2025-08-25", "2025-09-01", "2025-09-08"];
    const { bars, plotW } = await painted({ columns: ["order_week", "orders"], rows: weeks.map((w, i) => [w, 50 + i]),
                                            chartType: "bar" });
    expect(bars.map((b) => new Date(b.datum.order_week as string | number).toISOString().slice(0, 10))).toEqual(weeks);
    expect(bars[0].w).toBeGreaterThan(0.4 * plotW / 6 - 0.5);
  });

  it("lies down when asked, each bar as tall as its month allows", async () => {
    const { bars, plotH } = await painted({ columns: ["order_month", "revenue"], rows: monthly(MONTHS.slice(0, 4)),
                                            chartType: "bar", orient: "horizontal" });
    expect(bars).toHaveLength(4);
    for (const b of bars) expect(b.h).toBeGreaterThanOrEqual(Math.min(MAX_BAR_PX, 0.4 * plotH / 4) - 0.5);
  });

  it("on a wide panel keeps a few months to the category bar's thickness rule", async () => {
    const { bars, plotW } = await painted({ columns: ["order_month", "revenue"], rows: monthly(MONTHS.slice(0, 3)),
                                            chartType: "bar" }, 1600);
    for (const b of bars) expect(b.w).toBeLessThanOrEqual(0.4 * plotW / 3 + 0.5);
  });
});

describe("a stacked or grouped bar over months", () => {
  const rows = MONTHS.slice(0, 6).flatMap((m, i) => ["North", "South"].map((r, j) => [m, r, 100 + i * 10 + j * 30]));

  it("stacks each month's series on one bar of the month's width", async () => {
    const { bars } = await painted({ columns: ["order_month", "region", "revenue"], rows, chartType: "stacked-bar" });
    expect(bars).toHaveLength(12);
    expect(Math.min(...bars.map((b) => b.w))).toBeGreaterThan(40);
    expect(new Set(bars.map((b) => Math.round(b.x))).size).toBe(6);           // two series share each month's bar
  });

  it("names each month of a stacked bar under its bar, as the plain bar does — never a fortnight's tick", async () => {
    const { bars, labels } = await painted({ columns: ["order_month", "region", "revenue"], rows, chartType: "stacked-bar" });
    const shown = labels.map((l) => l.text).filter((t) => /[A-Za-z]/.test(t) && !/Order|Revenue|North|South|Region/.test(t));
    expect(shown).toEqual(["Jan 2025", "Feb 2025", "Mar 2025", "Apr 2025", "May 2025", "Jun 2025"]);
    const columnsAt = [...new Set(bars.map((b) => Math.round(centre(b))))];
    shown.forEach((t, i) => expect(Math.abs(labels.find((l) => l.text === t)!.x - columnsAt[i])).toBeLessThan(2));
  });

  it("sets each month's series side by side, in month order, each month named", async () => {
    const { bars, labels } = await painted({ columns: ["order_month", "region", "revenue"], rows, chartType: "grouped-bar" });
    expect(bars).toHaveLength(12);
    expect(Math.min(...bars.map((b) => b.w))).toBeGreaterThan(20);
    bars.slice(1).forEach((b, i) => expect(b.x).toBeGreaterThanOrEqual(bars[i].x + bars[i].w - 1e-6));   // none overlap
    expect(bars.map((b) => b.datum.region)).toEqual(Array.from({ length: 6 }, () => ["North", "South"]).flat());
    expect(labels.map((l) => l.text)).toEqual(expect.arrayContaining(["Jan 2025", "Mar 2025", "Jun 2025"]));
  });
});
