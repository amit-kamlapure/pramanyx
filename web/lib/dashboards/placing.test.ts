/** A piece placed as a box first (the user, 2026-11-19): the box set down a grid cell at a time, and the piece made then drawn
 *  where it was set down — whatever door made it. */
import { describe, expect, it } from "vitest";

import { placeGlobalFilterIn, placeNote, type DashboardSpec } from "@/lib/dashboards/edit";
import { checkDashboardSpec } from "@/lib/dashboards/rules";
import { cardsDashboardSpec } from "@/lib/dashboards/start";
import { PLACE_SIZE, cellOf, freeSpot, intoBox, type PlacedBox } from "@/lib/dashboards/placing";

// a dashboard of one empty section, "sec", as a dashboard made from a sheet starts
const spec = (): DashboardSpec => cardsDashboardSpec("Ops", []);

describe("setting a box down", () => {
  it("takes the cell under the pointer — a column a twelfth of the section and the gap, a row 40 px — held within the twelve columns", () => {
    const rect = { left: 100, top: 200, width: 1192 };                 // 12 columns of 92.67 px and 11 gaps of 8: a pitch of 100
    expect(cellOf(rect, 1192, 100, 200, PLACE_SIZE.chart)).toEqual({ x: 1, y: 1 });
    expect(cellOf(rect, 1192, 100 + 250, 200 + 85, PLACE_SIZE.filter)).toEqual({ x: 3, y: 3 });
    // a chart six columns wide set down at the eleventh column stands at the seventh, so it fits
    expect(cellOf(rect, 1192, 100 + 1050, 210, PLACE_SIZE.chart)).toEqual({ x: 7, y: 1 });
    // drawn at half its size by the canvas's zoom, the same place is the same cell
    expect(cellOf({ left: 100, top: 200, width: 596 }, 1192, 100 + 125, 200 + 42, PLACE_SIZE.filter)).toEqual({ x: 3, y: 3 });
  });
});

describe("the piece made, in its box", () => {
  const box: PlacedBox = { kind: "text", section: "sec", x: 3, y: 4, w: 12, h: 2, measured: {} };

  it("draws a note made for the box where the box was set down, and keeps the spec within the rules", () => {
    const before = spec();
    const placed = intoBox(before, placeNote(before, "Check returns", "sec"), box)!;
    const key = placed.elements.sec.children.find(k => placed.elements[k].type === "Note")!;
    expect(placed.elements[key].props).toMatchObject({ text: "Check returns", x: 1, y: 4, w: 12, h: 2 });   // twelve wide stands at the first
    expect(checkDashboardSpec(placed).issues).toEqual([]);
  });

  it("draws a global filter placed on the canvas in its box, as a piece of the section", () => {
    const before = spec();
    const made = placeGlobalFilterIn(before, "sec", { kind: "single" }).spec;
    const placed = intoBox(before, made, { ...box, kind: "filter", x: 5, y: 1, w: 4, h: 2 })!;
    const key = placed.elements.sec.children[0];
    expect(placed.elements[key]).toMatchObject({ type: "GlobalFilter", props: { kind: "single", x: 5, y: 1, w: 4, h: 2 } });
    expect(checkDashboardSpec(placed).issues).toEqual([]);
  });

  it("leaves a change that made nothing in the box's section alone: the box still waits", () => {
    const before = spec();
    const renamed = { ...before, elements: { ...before.elements, sec: { ...before.elements.sec, props: { title: "Other" } } } };
    expect(intoBox(before, renamed, box)).toBeNull();
  });
});

describe("a box set down over a piece already there", () => {
  it("goes to the first free rows below what it would cover, in its own columns; nothing placed moves", () => {
    const chart = { x: 1, y: 1, w: 8, h: 10 };
    expect(freeSpot({ x: 1, y: 9, w: 4, h: 2 }, [chart])).toEqual({ x: 1, y: 11 });
    expect(freeSpot({ x: 9, y: 3, w: 4, h: 2 }, [chart])).toEqual({ x: 9, y: 3 });           // beside it, it stays
    expect(freeSpot({ x: 5, y: 2, w: 6, h: 8 }, [chart, { x: 9, y: 11, w: 4, h: 3 }])).toEqual({ x: 5, y: 14 });
  });

  it("draws the piece made there, and keeps every other piece where it was", () => {
    const before = cardsDashboardSpec("Ops", [{ card: "c1", size: "small" }]);
    const card = before.elements.sec.children[0];
    const box: PlacedBox = { kind: "filter", section: "sec", x: 1, y: 9, w: 4, h: 2, measured: { [card]: { x: 1, y: 1, w: 8, h: 10 } } };
    const placed = intoBox(before, placeGlobalFilterIn(before, "sec", { kind: "single" }).spec, box)!;
    const filter = placed.elements.sec.children.find(k => placed.elements[k].type === "GlobalFilter")!;
    expect(placed.elements[filter].props).toMatchObject({ x: 1, y: 11, w: 4, h: 2 });
    expect(placed.elements[card].props).toMatchObject({ x: 1, y: 1, w: 8, h: 10 });
  });
});
