/**
 * A table's number column as a bar or a colour scale (study R10), and one colour for a value on every card of a
 * dashboard (study R11) — dashboard format v17.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QueryRows } from "@/components/dashboards/DashboardTile";
import { PlacementLookProvider, placementLookOf } from "@/components/dashboards/placementLook";
import { cardHolds } from "@/lib/dashboards/cardHolds";
import { cellLook, columnRanges, looksOf } from "@/lib/dashboards/columnLook";
import { queryChartSpec, seriesColours } from "@/lib/dashboards/queryChart";
import { colorsFor, valueColorsOf, withValueColors } from "@/lib/dashboards/valueColors";
import type { QueryShaped } from "@/lib/api";

const PALETTE = ["#c1", "#c2", "#c3", "#c4", "#c5", "#c6"];

describe("a number column's look", () => {
  const ranges = columnRanges(["region", "revenue", "margin"], [["N", 100, 0.1], ["S", -50, 0.3], ["W", 200, null]],
    { revenue: "bar", margin: "scale", region: "bar" });

  it("is measured over the rows held, a column of no numbers left out", () => {
    expect(ranges).toEqual({ revenue: { min: -50, max: 200 }, margin: { min: 0.1, max: 0.3 } });
  });

  it("draws a bar the length of its value against the largest, a negative in the threshold red", () => {
    expect(cellLook(100, "bar", ranges.revenue)?.backgroundImage).toContain("var(--chart-1) 30%, transparent) 50%");
    expect(cellLook(-50, "bar", ranges.revenue)?.backgroundImage).toContain("var(--chart-threshold-crit)");
    expect(cellLook(-50, "bar", ranges.revenue)?.backgroundImage).toContain(" 25%");
  });

  it("washes a scale from faint at the lowest to strong at the highest; a blank or plain cell is drawn plain", () => {
    expect(cellLook(0.1, "scale", ranges.margin)?.backgroundColor).toBe("color-mix(in srgb, var(--chart-1) 6%, transparent)");
    expect(cellLook(0.3, "scale", ranges.margin)?.backgroundColor).toBe("color-mix(in srgb, var(--chart-1) 50%, transparent)");
    expect(cellLook(null, "scale", ranges.margin)).toBeNull();
    expect(cellLook(5, undefined, ranges.margin)).toBeNull();
  });

  it("reads only the looks it knows off a table's props", () => {
    expect(looksOf({ columns_look: { revenue: "bar", region: "sparkline" } })).toEqual({ revenue: "bar" });
    expect(looksOf({})).toBeNull();
  });

  it("is drawn in a query card's table, against every row it holds", () => {
    const shaped = { as: "table", more: false, said: [], columns: [{ name: "region", type: "VARCHAR" }, { name: "revenue", type: "DOUBLE" }],
      rows: [["N", 100], ["S", 400], ["W", 200], ["E", 50]] } as Extract<QueryShaped, { as: "table" }>;
    render(<PlacementLookProvider value={placementLookOf({ columns_look: { revenue: "bar" } })}><QueryRows shaped={shaped} height={400} /></PlacementLookProvider>);
    const north = screen.getAllByRole("row")[1];
    expect((within(north).getByText("100").closest("td") as HTMLElement).style.backgroundImage).toContain("25%");
    expect((within(north).getByText("N").closest("td") as HTMLElement).style.backgroundImage).toBe("");
  });
});

describe("a value's colour, the same on every card", () => {
  it("gives a kept value its colour and every other the next colour no kept value holds", () => {
    expect(colorsFor(["Email", "Search", "Display"], { Search: 1 }, PALETTE)).toEqual(["#c2", "#c1", "#c3"]);
    expect(colorsFor(["Email", "Search"], undefined, PALETTE)).toEqual(["#c1", "#c2"]);
    expect(valueColorsOf({ colors: { channel: { Email: 2, Bad: 9 } } })).toEqual({ channel: { Email: 2 } });
    expect(valueColorsOf({ colors: {} })).toBeNull();
  });

  it("keeps Other grey and a tone's red over a kept colour on a query card", () => {
    expect(seriesColours(["Email", "Other", "Search"], { palette: PALETTE, other: "#grey" }, { Search: "adverse" }, { Email: 3, Other: 1 }))
      .toEqual(["#c3", "#grey", "#c6"]);
  });

  it("colours a query card's split by the dashboard's kept colours", () => {
    const chart = { as: "bar", x: { name: "day", kind: "text", bucket: "" }, series: ["Email", "Search"], other: false, said: [],
      points: [{ x: "a", s: "Email", v: 1 }, { x: "a", s: "Search", v: 2 }] } as unknown as Parameters<typeof queryChartSpec>[0];
    const spec = queryChartSpec(chart, { segments: "stacked", labels: false, running: false }, { palette: PALETTE, other: "#g" }, null, { Search: 1 });
    const color = ((spec.layer as { encoding: { color: { scale: { range: string[] } } } }[])[0].encoding.color);
    expect(color.scale.range).toEqual(["#c2", "#c1"]);
  });

  it("sets an answer's chart colour scale over a kept field, nested layers too, and leaves others alone", () => {
    const spec = { data: { values: [{ ch: "Search" }, { ch: "Email" }] },
                   layer: [{ encoding: { color: { field: "ch", type: "nominal", scale: { scheme: "set2" } } } },
                           { encoding: { color: { field: "other", type: "nominal" } } }] };
    const out = withValueColors(spec, { ch: { Email: 4 } }, PALETTE);
    const [kept, untouched] = (out.layer as { encoding: { color: Record<string, unknown> } }[]).map(l => l.encoding.color);
    expect(kept.scale).toEqual({ domain: ["Search", "Email"], range: ["#c1", "#c4"] });
    expect(untouched.scale).toBeUndefined();
    expect(spec.layer[0].encoding.color.scale).toEqual({ scheme: "set2" });            // the given spec is not changed
  });
});

describe("what a card offers its panel", () => {
  it("offers a query table's number columns, a query chart's split values, and an answer's text columns", () => {
    expect(cardHolds({ shown: { as: "table", more: false, said: [], columns: [{ name: "n", type: "BIGINT" }, { name: "s", type: "VARCHAR" }], rows: [] } }, null))
      .toEqual({ numbers: ["n"], fields: [] });
    expect(cardHolds({ shown: { as: "bar", series: ["Email", "Search", "Other"] } as unknown as QueryShaped }, { split: "channel" }))
      .toEqual({ numbers: [], fields: [{ field: "channel", values: ["Email", "Search"] }] });
    expect(cardHolds({ columns: ["month", "channel", "orders"], rows: [["2025-01-01", "Email", 3], ["2025-02-01", "Search", 4]] }, null))
      .toEqual({ numbers: [], fields: [{ field: "channel", values: ["Email", "Search"] }] });
    expect(cardHolds(null, null)).toEqual({ numbers: [], fields: [] });
  });
});
