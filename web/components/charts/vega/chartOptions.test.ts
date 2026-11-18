/**
 * The chart options a person sets in the editor (the dashboards study, R12): a line's shape and its markers, the value
 * axis's range and a log scale, a bar's categories largest first or by name, and only the largest — said on the chart.
 */
import { describe, expect, it } from "vitest";
import * as vl from "vega-lite";
import { resolveVegaSpec } from "@/components/charts/vega/resolveSpec";
import { isEmptyVizConfig } from "@/components/charts/vizConfig";

type Obj = Record<string, unknown>;
const TREND = { columns: ["month", "revenue"], rows: [["2025-01-01", 100], ["2025-02-01", 300], ["2025-03-01", 200]] as unknown[][] };
const CHANNELS = {
  columns: ["channel", "orders"],
  rows: [["Search", 40], ["Email", 90], ["Display", 10], ["Affiliate", 55], ["Social", 25], ["Direct", 70]] as unknown[][],
};
const lineGroup = (spec: Obj) => ((spec.layer as Obj[])[0].layer as Obj[]);
const lineY = (spec: Obj) => (((spec.layer as Obj[])[0].encoding as Obj).y as Obj);

describe("a line's options", () => {
  it("draws its shape and drops its points when the markers are off, keeping the hover's rings", () => {
    const smooth = resolveVegaSpec({ ...TREND, chartType: "line", options: { lineShape: "smooth", markers: false } })!;
    const layers = lineGroup(smooth.spec);
    expect((layers[0].mark as Obj).interpolate).toBe("monotone");
    expect(layers).toHaveLength(2);                                  // the line and the rings
    expect(JSON.stringify(layers[1])).toContain('"param":"hover"');
    const step = resolveVegaSpec({ ...TREND, chartType: "line", options: { lineShape: "step" } })!;
    expect((lineGroup(step.spec)[0].mark as Obj).interpolate).toBe("step-after");
    const plain = resolveVegaSpec({ ...TREND, chartType: "line" })!;
    expect((lineGroup(plain.spec)[0].mark as Obj).interpolate).toBeUndefined();
    expect(lineGroup(plain.spec)).toHaveLength(3);
  });

  it("holds the value axis to a range a person set, and draws a log scale only where every value is above zero", () => {
    const ranged = resolveVegaSpec({ ...TREND, chartType: "line", options: { yMin: 0, yMax: 500, yLog: true } })!;
    expect(lineY(ranged.spec).scale).toEqual({ domainMin: 0, domainMax: 500, type: "log", zero: false, clamp: true });
    const withZero = { columns: TREND.columns, rows: [...TREND.rows, ["2025-04-01", 0]] };
    expect(lineY(resolveVegaSpec({ ...withZero, chartType: "line", options: { yLog: true } })!.spec).scale).toBeUndefined();
  });
});

describe("a bar's options", () => {
  const values = (spec: Obj) => ((spec.data as { values: Obj[] }).values).map((d) => d.channel);

  it("puts its categories largest first or by name", () => {
    expect(values(resolveVegaSpec({ ...CHANNELS, chartType: "bar", orient: "vertical", options: { sort: "value" } })!.spec))
      .toEqual(["Email", "Direct", "Affiliate", "Search", "Social", "Display"]);
    expect(values(resolveVegaSpec({ ...CHANNELS, chartType: "bar", orient: "vertical", options: { sort: "label" } })!.spec))
      .toEqual(["Affiliate", "Direct", "Display", "Email", "Search", "Social"]);
  });

  it("shows only the largest, and says how many of how many", () => {
    const top = resolveVegaSpec({ ...CHANNELS, chartType: "bar", options: { top: 3, sort: "label" } })!.spec;
    expect(values(top)).toEqual(["Affiliate", "Direct", "Email"]);
    expect((top.title as Obj).text).toBe("The 3 largest of 6");
    const titled = resolveVegaSpec({ ...CHANNELS, chartType: "bar", title: "Orders by channel", options: { top: 3 } })!.spec;
    expect(titled.title).toMatchObject({ text: "Orders by channel", subtitle: "The 3 largest of 6" });
    expect(resolveVegaSpec({ ...CHANNELS, chartType: "bar", options: { top: 10 } })!.spec.title).toBeUndefined();
  });

  it("compiles with every option set", () => {
    for (const spec of [
      resolveVegaSpec({ ...CHANNELS, chartType: "bar", options: { top: 3, sort: "value", yMax: 100 } })!.spec,
      resolveVegaSpec({ ...TREND, chartType: "line", options: { lineShape: "step", markers: false, yMin: 50, yLog: true } })!.spec,
    ]) expect(() => vl.compile({ ...spec, width: 300, height: 200 } as never)).not.toThrow();
  });
});

describe("the saved config", () => {
  it("saves nothing for options left as they were", () => {
    expect(isEmptyVizConfig({})).toBe(true);
    expect(isEmptyVizConfig({ top: 5 })).toBe(false);
    expect(isEmptyVizConfig({ markers: false })).toBe(false);
    expect(isEmptyVizConfig({ yMin: 0 })).toBe(false);
  });
});
