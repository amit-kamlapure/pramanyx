/**
 * Sizes one grade at a time (Arc AP-1; the user, 2026-10-10: "they become either too large or small.. The size needs to
 * be adjusted one grade point at a time"): a section on the grid places each element by w columns and h rows, within
 * what its kind may take; a section sized by name moves onto the grid keeping the room each element had; and every
 * edit leaves a dashboard the rules accept.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DASHBOARD_VOCABULARY_VERSION, GRADE, GRID, LIMITS, rowsTall } from "@/lib/dashboards/catalog";
import {
  boxOf, clampBox, moveCardTo, moveSectionToNewTab, placeCard, placeNote, regrid, setFilterWidth, sizeNear, toGrid,
  type DashboardSpec,
} from "@/lib/dashboards/edit";
import { checkDashboardSpec, vocabulary } from "@/lib/dashboards/rules";

type Spec = DashboardSpec;
const premise = (): Spec => JSON.parse(readFileSync(resolve(process.cwd(), "lib/dashboards/premise.fixture.json"), "utf8"));

/** A dashboard started from an object, as `objectDashboardSpec` lays one out: a filter column, then one section. */
function objectDashboard(): Spec {
  return {
    root: "cockpit",
    elements: {
      cockpit: { type: "Cockpit", props: { title: "Orders" }, children: ["filters", "sec"] },
      filters: { type: "ObjectFilters", props: { entity: "order", properties: [{ path: "status", label: "Status" }] }, children: [] },
      sec: { type: "Section", props: { title: "Orders" }, children: ["figure-0", "chart", "table"] },
      "figure-0": { type: "ObjectFigure", props: { entity: "order", label: "Orders", agg: "count", size: "small" }, children: [] },
      chart: { type: "ObjectChart", props: { entity: "order", label: "Orders per day", time: "created_at", size: "full" }, children: [] },
      table: { type: "ObjectTable", props: { entity: "order", size: "wide" }, children: [] },
    },
  };
}

const issues = (s: unknown) => checkDashboardSpec(s).issues.map(i => i.message);

describe("the grid's measure", () => {
  it("is twelve columns, and one grade of height is always 40 px", () => {
    expect(GRID.columns).toBe(12);
    expect(GRADE).toBe(40);
    // a box h rows tall is h grades less the one gap under its last row
    for (const h of [1, 2, 6, 14]) expect(rowsTall(h)).toBe(h * GRADE - GRID.gap);
  });

  it("is said by the vocabulary, at version 16 — the grid came in at 5, the wiring at 6, the structure at 7, variables at 8, sets read whole at 9, yes-no, lists, sums and queries at 10, a Question at 11, a breakdown at 12, free placement at 14, the period as a piece at 15, a placed card's own look at 16", () => {
    expect(DASHBOARD_VOCABULARY_VERSION).toBe(16);
    expect(vocabulary()).toMatchObject({ version: 16, grid: { columns: 12, grade: 40 } });
  });
});

describe("a section on the grid, by the rules", () => {
  it("accepts each element's w and h within what its kind may take", () => {
    const s = toGrid(objectDashboard(), "sec");
    expect(issues(s)).toEqual([]);
    expect(s.elements.sec.props).toEqual({ title: "Orders", grid: 12 });
  });

  it("refuses an element on the grid that does not say its w or its h", () => {
    const s = toGrid(objectDashboard(), "sec");
    delete s.elements.chart.props.h;
    expect(issues(s)).toEqual([expect.stringMatching(/"chart" is on the grid of section "sec" and does not say its h/)]);
  });

  it("refuses a size outside its kind's least and most, naming them", () => {
    const s = toGrid(objectDashboard(), "sec");
    s.elements["figure-0"].props.w = 7;                       // a figure is at most 6 columns
    s.elements.table.props.h = 3;                             // a table at least 4 rows
    const said = issues(s);
    expect(said).toHaveLength(2);
    expect(said[0]).toMatch(/"figure-0" takes 7 × 3\. A figure takes 2 to 6 columns and 2 to 4 rows/);
    expect(said[1]).toMatch(/"table" takes 6 × 3\. An objects table takes 4 to 12 columns and 4 to 20 rows/);
  });

  it("refuses columns and rows in a section that sizes by name, where nothing would read them", () => {
    const s = objectDashboard();
    s.elements.chart.props.w = 8;
    expect(issues(s)).toEqual([expect.stringMatching(/"chart" says w 8, and its section "sec" is not on the grid/)]);
  });

  it("refuses a section on the grid that also says columns of its own", () => {
    const s = toGrid(objectDashboard(), "sec");
    s.elements.sec.props.columns = 3;
    expect(issues(s)).toEqual([expect.stringMatching(/"sec" is on the grid and also says 3 columns/)]);
  });

  it("holds every kind to a least that can be read and a most it can fill", () => {
    for (const [kind, lim] of Object.entries(LIMITS)) {
      expect(lim.w[0], kind).toBeGreaterThanOrEqual(2);
      expect(lim.w[1], kind).toBeLessThanOrEqual(GRID.columns);
      expect(lim.h[0], kind).toBeGreaterThanOrEqual(2);
      expect(lim.h[0], kind).toBeLessThan(lim.h[1]);
    }
  });
});

describe("moving a section onto the grid", () => {
  it("keeps the room each element had on screen, when it was measured", () => {
    const s = toGrid(objectDashboard(), "sec", { "figure-0": { w: 3, h: 3 }, chart: { w: 9, h: 6 }, table: { w: 6, h: 9 } });
    expect(s.elements["figure-0"].props).toMatchObject({ w: 3, h: 3 });
    expect(s.elements.chart.props).toMatchObject({ w: 9, h: 6 });
    expect(s.elements.table.props).toMatchObject({ w: 6, h: 9 });
    // the names go, and so does the section's own count of columns: the grid would read neither
    expect(Object.values(s.elements).some(e => "size" in e.props)).toBe(false);
  });

  it("reads a size by name as its share of four columns when nothing measured it", () => {
    const s = toGrid(objectDashboard(), "sec");
    expect(s.elements["figure-0"].props).toMatchObject({ w: 3 });  // small: 1 of 4
    expect(s.elements.table.props).toMatchObject({ w: 6 });       // wide: 2 of 4
    expect(s.elements.chart.props).toMatchObject({ w: 9 });       // full: 3 of 4
  });

  it("holds a measured room to what the kind may take", () => {
    const s = toGrid(objectDashboard(), "sec", { "figure-0": { w: 1, h: 9 } });
    expect(s.elements["figure-0"].props).toMatchObject({ w: 2, h: 4 });
  });

  it("leaves a section already on the grid as it is", () => {
    const once = toGrid(objectDashboard(), "sec");
    once.elements.chart.props.w = 12;
    expect(toGrid(once, "sec", { chart: { w: 4, h: 4 } })).toEqual(once);
  });
});

describe("one grade at a time", () => {
  it("gives one element its room and moves its section onto the grid first, the others keeping theirs", () => {
    const measured = { "figure-0": { w: 3, h: 3 }, chart: { w: 9, h: 6 }, table: { w: 6, h: 8 } };
    const s = regrid(objectDashboard(), "chart", { w: 10, h: 6 }, measured);
    expect(s.elements.chart.props).toMatchObject({ w: 10, h: 6 });
    expect(s.elements.table.props).toMatchObject({ w: 6, h: 8 });
    expect(s.elements.sec.props.grid).toBe(12);
    expect(issues(s)).toEqual([]);
  });

  it("never takes an element past what its kind may take", () => {
    const s = regrid(toGrid(objectDashboard(), "sec"), "figure-0", { w: 12, h: 1 });
    expect(s.elements["figure-0"].props).toMatchObject({ w: 6, h: 2 });
    expect(clampBox("ObjectTable", { w: 2.4, h: 40 })).toEqual({ w: 4, h: 20 });
  });

  it("leaves the spec it was handed untouched", () => {
    const before = objectDashboard();
    const copy = JSON.stringify(before);
    regrid(before, "chart", { w: 4, h: 4 });
    expect(JSON.stringify(before)).toBe(copy);
  });

  it("puts the filter column at a width of whole grades, between 200 and 400 px", () => {
    expect(setFilterWidth(objectDashboard(), 7).elements.filters.props.w).toBe(7);
    expect(setFilterWidth(objectDashboard(), 3).elements.filters.props.w).toBe(5);
    expect(setFilterWidth(objectDashboard(), 14).elements.filters.props.w).toBe(10);
    expect(issues(setFilterWidth(objectDashboard(), 9))).toEqual([]);
  });
});

describe("placing and moving on the grid", () => {
  it("a card or a note placed in a section on the grid says its room, and the rules accept it", () => {
    let s = toGrid(premise(), "sec-headline");
    s = placeCard(s, "c0ffee01", "sec-headline");
    s = placeNote(s, "Check ops first.", "sec-headline");
    const added = Object.entries(s.elements).filter(([k]) => k.startsWith("card-c0ffee01") || k === "note");
    expect(added.map(([, e]) => [e.props.w, e.props.h])).toEqual([[3, 4], [3, 3]]);
    expect(issues(s)).toEqual([]);
  });

  it("an element leaving the grid for a section sized by name takes the nearest name", () => {
    let s = toGrid(premise(), "sec-headline");
    const first = s.elements["sec-headline"].children[0];
    s = regrid(s, first, { w: 10, h: 9 });
    const other = Object.keys(s.elements).find(k => s.elements[k].type === "Section" && k !== "sec-headline") as string;
    s = moveCardTo(s, first, other);
    expect(s.elements[first].props).toMatchObject({ size: "hero" });
    expect(s.elements[first].props).not.toHaveProperty("w");
    expect(issues(s)).toEqual([]);
  });

  it("reads a box back as the size whose span is nearest", () => {
    expect(sizeNear({ w: 3, h: 3 })).toBe("small");
    expect(sizeNear({ w: 6, h: 4 })).toBe("wide");
    expect(sizeNear({ w: 12, h: 4 })).toBe("full");
    expect(sizeNear({ w: 6, h: 10 })).toBe("large");
    expect(boxOf({ type: "ObjectTable", props: { size: "tall" }, children: [] })).toEqual({ w: 4, h: 17 });   // tall: 1 of 4 columns, held to a table's least 4; 8 rows twice and the gap between
  });
});

describe("a new tab, on a dashboard started from an object (study §1.6, defect 2)", () => {
  it("keeps the filter column the dashboard's own first child, beside the tabs, and the rules accept it", () => {
    const s = moveSectionToNewTab(objectDashboard(), "sec", "Detail");
    const root = s.elements[s.root];
    expect(s.elements[root.children[0]].type).toBe("ObjectFilters");
    expect(root.children.map(k => s.elements[k].type)).toEqual(["ObjectFilters", "Tabs"]);
    expect(issues(s)).toEqual([]);
  });
});

// ── free placement (v14; the user, 2026-11-18: "Allow free placement") ────────────────────────────────────────────────

describe("free placement on a section's grid", () => {
  /** The object dashboard on the grid, each piece where it was drawn: figure top-left, chart beside it, table below. */
  const drawn = { "figure-0": { w: 3, h: 3, x: 1, y: 1 }, chart: { w: 9, h: 6, x: 4, y: 1 }, table: { w: 12, h: 8, x: 1, y: 7 } };
  const placed = (s: Spec, k: string) => {
    const p = s.elements[k].props as { x?: number; y?: number; w?: number; h?: number };
    return { x: p.x, y: p.y, w: p.w, h: p.h };
  };

  it("puts an element on the cell asked, the others keeping where they were drawn — gaps stay", () => {
    const s = regrid(objectDashboard(), "figure-0", { w: 3, h: 3, x: 1, y: 20 }, drawn);
    expect(placed(s, "figure-0")).toEqual({ x: 1, y: 20, w: 3, h: 3 });
    expect(placed(s, "chart")).toEqual({ x: 4, y: 1, w: 9, h: 6 });
    expect(placed(s, "table")).toEqual({ x: 1, y: 7, w: 12, h: 8 });
    expect(s.elements.sec.children).toEqual(["chart", "table", "figure-0"]);     // in reading order: row, then column
    expect(issues(s)).toEqual([]);
  });

  it("pushes down what it covers, and what that covers in turn; the element placed never moves", () => {
    const s = regrid(objectDashboard(), "table", { w: 12, h: 8, x: 1, y: 2 }, drawn);
    expect(placed(s, "table")).toEqual({ x: 1, y: 2, w: 12, h: 8 });
    expect(placed(s, "figure-0").y).toBe(10);                                // below the table
    expect(placed(s, "chart").y).toBe(10);
    expect(issues(s)).toEqual([]);
  });

  it("holds a place inside the twelve columns, and a size changed in place keeps the place", () => {
    const wide = regrid(objectDashboard(), "chart", { w: 9, h: 6, x: 11, y: 1 }, drawn);
    expect(placed(wide, "chart").x).toBe(4);                                 // 12 − 9 + 1
    const taller = regrid(wide, "chart", { w: 9, h: 8 });
    expect(placed(taller, "chart")).toEqual({ x: 4, y: 1, w: 9, h: 8 });
    expect(placed(taller, "table").y).toBe(9);                               // the taller chart pushes it down
  });

  it("an element with no place and none asked for only changes size, flowing as before", () => {
    const s = regrid(objectDashboard(), "chart", { w: 10, h: 6 }, { "figure-0": { w: 3, h: 3 }, chart: { w: 9, h: 6 }, table: { w: 12, h: 8 } });
    expect(placed(s, "chart")).toEqual({ x: undefined, y: undefined, w: 10, h: 6 });
  });

  it("a duplicate, or an element moved to another section, arrives without a place and flows into the first room", async () => {
    const { duplicate, moveCardToNewSection } = await import("@/lib/dashboards/edit");
    const s = regrid(objectDashboard(), "figure-0", { w: 3, h: 3, x: 1, y: 1 }, drawn);
    const copy = duplicate(s, "figure-0");
    expect(placed(copy.spec, copy.key!).x).toBeUndefined();
    expect(issues(copy.spec)).toEqual([]);
    const moved = moveCardToNewSection(s, "figure-0", "Elsewhere");
    expect(placed(moved, "figure-0").x).toBeUndefined();
  });

  it("the rules refuse two elements on one cell, a place past the twelfth column, half a place, and a place off the grid", () => {
    const s = regrid(objectDashboard(), "figure-0", { w: 3, h: 3, x: 1, y: 1 }, drawn);
    const clash: Spec = JSON.parse(JSON.stringify(s));
    clash.elements.chart.props.x = 2;
    expect(issues(clash).join(" ")).toContain("share a cell");
    const past: Spec = JSON.parse(JSON.stringify(s));
    past.elements.chart.props.x = 6;
    expect(issues(past).join(" ")).toContain("runs past column 12");
    const half: Spec = JSON.parse(JSON.stringify(s));
    delete half.elements.chart.props.y;
    expect(issues(half).join(" ")).toContain("A place is said by both, or by neither");
    const off = objectDashboard();
    off.elements["figure-0"].props = { ...off.elements["figure-0"].props, x: 1, y: 1 };
    expect(issues(off).join(" ")).toContain("not on the grid");
  });
});


describe("the period as a piece (v15)", () => {
  it("a section holds one period, saying what it opens on; two are refused", () => {
    const s = objectDashboard();
    s.elements.period = { type: "Period", props: { opens_on: "current_month", label: "Date range" }, children: [] };
    s.elements.sec.children.unshift("period");
    expect(issues(s)).toEqual([]);
    const two: Spec = JSON.parse(JSON.stringify(s));
    two.elements.period2 = { type: "Period", props: {}, children: [] };
    two.elements.sec.children.push("period2");
    expect(issues(two).join(" ")).toContain("A dashboard holds one");
    const odd: Spec = JSON.parse(JSON.stringify(s));
    odd.elements.period.props.opens_on = "next_month";
    expect(issues(odd).length).toBeGreaterThan(0);
  });
});
