/**
 * A chosen value lights on every chart kind, and the rest recede — read off the PAINTED scenegraph, not the spec
 * (the board study §6.2: a dashboard's focus shows on the card it was chosen on, whatever that card draws).
 */
import { describe, expect, it } from "vitest";
import * as vl from "vega-lite";
import { View, parse } from "vega";
import { resolveVegaSpec } from "@/components/charts/vega/resolveSpec";
import { resolveTier3Spec } from "@/components/charts/vega/tier3";
import { buildVegaConfig, printVegaTokens } from "@/components/charts/vega/config";
import { RECEDE } from "@/components/charts/vega/emphasis";

const config = buildVegaConfig(printVegaTokens());

type Item = { datum?: Record<string, unknown>; opacity?: number; items?: Item[]; mark?: { role?: string; marktype?: string } };

/** Every painted data mark (not an axis, a legend or a title) with the datum it stands for and its opacity. */
async function painted(spec: Record<string, unknown>, tier: 1 | 3): Promise<{ datum: Record<string, unknown>; opacity: number; type: string }[]> {
  const runtime = tier === 3 ? parse(spec as never, config as never) : parse(vl.compile({ ...spec, width: 400, height: 300 } as never, { config: config as never }).spec);
  const view = new View(runtime, { renderer: "none" });
  await view.runAsync();
  const out: { datum: Record<string, unknown>; opacity: number; type: string }[] = [];
  // the scenegraph nests group → mark → item; an item knows its own mark, and so its type and role
  const walk = (node: Item) => {
    for (const it of node.items ?? []) {
      const role = it.mark?.role ?? "", type = it.mark?.marktype ?? "";
      if (it.datum && !/^(axis|legend|title)/.test(role) && ["rect", "symbol", "arc", "shape"].includes(type)) {
        out.push({ datum: it.datum, opacity: it.opacity ?? 1, type });
      }
      walk(it);
    }
  };
  walk((view.scenegraph() as unknown as { root: Item }).root);
  view.finalize();
  return out;
}

const lit = (marks: { datum: Record<string, unknown>; opacity: number }[], field: string, value: string) => {
  const on = marks.filter((m) => String(m.datum[field]) === value);
  const off = marks.filter((m) => m.datum[field] !== undefined && String(m.datum[field]) !== value);
  return { on, off };
};

const CHANNELS = { columns: ["channel", "revenue"], rows: [["Search", 1.4e6], ["Organic", 3e5], ["Email", 1.1e5], ["Display", 7e4]] };

describe("a chosen value stays lit and the rest recede", () => {
  for (const type of ["bar", "pie", "delta-bar", "pareto", "lollipop", "leaderboard"]) {
    it(`on a ${type}`, async () => {
      const r = resolveVegaSpec({ ...CHANNELS, chartType: type, exhibit: { emphasis: ["Organic"] } });
      expect(r).not.toBeNull();
      // a pareto lights its bars; its cumulative line's points stay whole, the context the bars are read against
      const marks = (await painted(r!.spec, 1)).filter((m) => type !== "pareto" || m.type === "rect");
      const { on, off } = lit(marks, "channel", "Organic");
      expect(on.length).toBeGreaterThan(0);
      expect(off.length).toBeGreaterThan(0);
      expect(on.every((m) => m.opacity === 1)).toBe(true);
      expect(off.every((m) => m.opacity === RECEDE)).toBe(true);
    });
  }

  it("on a line's points, a date compared as its day", async () => {
    const r = resolveVegaSpec({ columns: ["month", "revenue"], rows: [["2025-01-01", 10], ["2025-02-01", 12], ["2025-03-01", 9]],
      chartType: "line", exhibit: { emphasis: ["2025-02-01"] } });
    const marks = (await painted(r!.spec, 1)).filter((m) => "revenue" in m.datum);
    const on = marks.filter((m) => m.opacity === 1), off = marks.filter((m) => m.opacity === RECEDE);
    expect(on.length).toBe(1);
    expect(off.length).toBe(2);
    expect(new Date(on[0].datum.month as string | number).toISOString().slice(0, 10)).toBe("2025-02-01");
  });

  it("on a heatmap, a chosen row or column", async () => {
    const r = resolveVegaSpec({ columns: ["day", "channel", "orders"],
      rows: [["Mon", "Search", 12], ["Mon", "Email", 3], ["Tue", "Search", 7], ["Tue", "Email", 5]],
      chartType: "heatmap", exhibit: { emphasis: ["Search"] } });
    const marks = await painted(r!.spec, 1);
    expect(marks.filter((m) => m.datum.channel === "Search").every((m) => m.opacity === 1)).toBe(true);
    expect(marks.filter((m) => m.datum.channel === "Email").every((m) => m.opacity === RECEDE)).toBe(true);
  });

  it("on a stacked bar, a chosen band", async () => {
    const r = resolveVegaSpec({ columns: ["department", "channel", "revenue"],
      rows: [["Men", "Search", 5], ["Men", "Email", 2], ["Women", "Search", 6], ["Women", "Email", 1]],
      chartType: "stacked-bar", exhibit: { emphasis: ["Women"] } });
    const marks = await painted(r!.spec, 1);
    expect(marks.filter((m) => m.datum.department === "Women").every((m) => m.opacity === 1)).toBe(true);
    expect(marks.filter((m) => m.datum.department === "Men").every((m) => m.opacity === RECEDE)).toBe(true);
  });

  for (const type of ["treemap", "funnel"]) {
    it(`on a ${type}, drawn in Vega by hand`, async () => {
      const t3 = resolveTier3Spec({ ...CHANNELS, chartType: type, emphasis: ["Organic"] });
      const key = type === "treemap" ? "name" : "stage";
      const { on, off } = lit(await painted(t3!.spec, 3), key, "Organic");
      expect(on.length).toBeGreaterThan(0);
      expect(off.length).toBeGreaterThan(0);
      expect(on.every((m) => m.opacity === 1)).toBe(true);
      expect(off.every((m) => m.opacity === RECEDE)).toBe(true);
    });
  }

  it("with nothing chosen, nothing recedes", async () => {
    const r = resolveVegaSpec({ ...CHANNELS, chartType: "pie" });
    expect((await painted(r!.spec, 1)).some((m) => m.opacity === RECEDE)).toBe(false);
  });
});
