/**
 * A click says which column and value it stands for, on every chart kind, in the result's own column names (the board
 * study §6.2) — and says nothing for a click that stands for no single value.
 */
import { describe, expect, it } from "vitest";
import * as vl from "vega-lite";
import { View, parse } from "vega";
import { clickedDatum, pickOf } from "@/components/charts/selection";
import { buildVegaConfig, printVegaTokens } from "@/components/charts/vega/config";

const CHANNELS = { columns: ["channel", "revenue"], rows: [["Search", 1.4e6], ["Organic", 3e5]] as unknown[][] };

describe("pickOf", () => {
  it("reads a Vega-Lite mark's own field", () => {
    expect(pickOf({ channel: "Search", revenue: 1.4e6 }, CHANNELS.columns, CHANNELS.rows, "bar")).toEqual({ field: "channel", value: "Search" });
  });

  it("prefers the dimension the chart was drawn by", () => {
    const columns = ["department", "channel", "revenue"];
    const rows = [["Men", "Search", 5], ["Women", "Email", 1]];
    expect(pickOf({ department: "Men", channel: "Search", revenue: 5 }, columns, rows, "bar", "channel")).toEqual({ field: "channel", value: "Search" });
  });

  it("gives a date as its ISO day, whatever the chart made of it", () => {
    const columns = ["month", "revenue"], rows = [["2025-02-01", 12], ["2025-03-01", 9]];
    expect(pickOf({ month: Date.UTC(2025, 1, 1), revenue: 12 }, columns, rows, "line")).toEqual({ field: "month", value: "2025-02-01" });
    expect(pickOf({ month: new Date(Date.UTC(2025, 2, 1)), revenue: 9 }, columns, rows, "line")).toEqual({ field: "month", value: "2025-03-01" });
  });

  it("ignores the helper fields a spec adds, even one named as the chart's dimension", () => {
    expect(pickOf({ __label: "1.4M", revenue: 1.4e6 }, CHANNELS.columns, CHANNELS.rows, "bar")).toBeNull();
    expect(pickOf({ __label: "1.4M", revenue: 1.4e6 }, CHANNELS.columns, CHANNELS.rows, "bar", "__label")).toBeNull();
  });

  it("maps a treemap's tile and a funnel's stage back to the column they were drawn from", () => {
    expect(pickOf({ id: 2, parent: 0, name: "Organic", value: 3e5 }, CHANNELS.columns, CHANNELS.rows, "treemap")).toEqual({ field: "channel", value: "Organic" });
    expect(pickOf({ id: 0, name: "root" }, CHANNELS.columns, CHANNELS.rows, "treemap")).toBeNull();
    expect(pickOf({ stage: "Search", value: 1.4e6 }, CHANNELS.columns, CHANNELS.rows, "funnel")).toEqual({ field: "channel", value: "Search" });
  });

  it("reads a gantt's task and a sankey's node by its side; a ribbon stands for no single value", () => {
    expect(pickOf({ task: "Ship", s: 1, e: 2 }, ["task", "start", "end"], [["Ship", "2025-01-01", "2025-01-03"]], "gantt")).toEqual({ field: "task", value: "Ship" });
    const cols = ["from_channel", "to_status", "orders"], rows = [["Search", "Complete", 40]];
    expect(pickOf({ name: "Complete", side: "target" }, cols, rows, "sankey")).toEqual({ field: "to_status", value: "Complete" });
    expect(pickOf({ name: "Search", side: "source" }, cols, rows, "sankey")).toEqual({ field: "from_channel", value: "Search" });
    expect(pickOf({ source: "Search", target: "Complete", value: 40 }, cols, rows, "sankey")).toBeNull();
  });

  it("says nothing for a datum with no dimension in it", () => {
    expect(pickOf({ revenue: 1 }, CHANNELS.columns, CHANNELS.rows, "bar")).toBeNull();
    expect(pickOf(null, CHANNELS.columns, CHANNELS.rows, "bar")).toBeNull();
  });
});

describe("clickedDatum", () => {
  it("answers a mark's click with its datum, and an axis's, a legend's or a title's with none — on a painted chart", async () => {
    const config = buildVegaConfig(printVegaTokens());
    const spec = { title: "Revenue by channel", mark: "bar", width: 300, height: 200,
      data: { values: [{ channel: "Search", revenue: 3 }, { channel: "Email", revenue: 1 }] },
      encoding: { x: { field: "channel", type: "nominal" }, y: { field: "revenue", type: "quantitative" },
                  color: { field: "channel", type: "nominal" } } };
    const view = new View(parse(vl.compile(spec as never, { config: config as never }).spec), { renderer: "none" });
    await view.runAsync();
    type Item = { datum?: unknown; items?: Item[]; mark?: { role?: string; marktype?: string } };
    const all: Item[] = [];
    const walk = (n: Item) => { for (const it of n.items ?? []) { if (it.datum) all.push(it); walk(it); } };
    walk((view.scenegraph() as unknown as { root: Item }).root);
    view.finalize();
    const roles = (re: RegExp) => all.filter(it => re.test(it.mark?.role ?? ""));
    const bars = all.filter(it => it.mark?.marktype === "rect" && it.mark?.role === "mark");
    // the chart paints what a reader could click: two bars, and an axis, a legend and a title, each with a datum
    expect(bars).toHaveLength(2);
    expect(roles(/^axis/).length).toBeGreaterThan(0);
    expect(roles(/^legend/).length).toBeGreaterThan(0);
    expect(roles(/^title/).length).toBeGreaterThan(0);
    expect(bars.map(b => clickedDatum(b)?.channel).sort()).toEqual(["Email", "Search"]);
    for (const it of roles(/^(axis|legend|title)/)) expect(clickedDatum(it)).toBeNull();
    expect(clickedDatum(null)).toBeNull();
  });
});
