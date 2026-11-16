/**
 * A piece moves beside another (the board study, 2026-11-16: drag a card by its header, the rest reflow): before or
 * after it, in its own section or another, keeping its room on the grid it lands in — and every move leaves a dashboard
 * the rules accept.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { moveTo, regrid, type DashboardSpec } from "@/lib/dashboards/edit";
import { checkDashboardSpec } from "@/lib/dashboards/rules";

const premise = (): DashboardSpec => JSON.parse(readFileSync(resolve(process.cwd(), "lib/dashboards/premise.fixture.json"), "utf8"));
const issues = (s: unknown) => checkDashboardSpec(s).issues.map(i => i.message);
const sectionsWithTwo = (s: DashboardSpec) =>
  Object.keys(s.elements).filter(k => s.elements[k].type === "Section" && s.elements[k].children.length >= 2);

describe("moveTo", () => {
  it("puts a piece before or after another in its own section", () => {
    const s = premise();
    const sec = sectionsWithTwo(s)[0];
    const [a, b, ...rest] = s.elements[sec].children;
    const after = moveTo(s, a, b, "after");
    expect(after.elements[sec].children.slice(0, 2)).toEqual([b, a]);
    expect(moveTo(after, a, b, "before").elements[sec].children).toEqual([a, b, ...rest]);
    expect(issues(after)).toEqual([]);
  });

  // the fixture's two sections: Headline (three pieces, on the Overview tab) and Limits (one, on the Watches tab)
  it("moves a piece into another section, on another tab, beside the one it was dropped on", () => {
    const s = premise();
    const [from, to] = ["sec-headline", "sec-limits"];
    const moving = s.elements[from].children[0];
    const target = s.elements[to].children[0];
    const out = moveTo(s, moving, target, "before");
    expect(out.elements[from].children).not.toContain(moving);
    const kids = out.elements[to].children;
    expect(kids.indexOf(moving)).toBe(kids.indexOf(target) - 1);
    expect(issues(out)).toEqual([]);
  });

  it("keeps a piece's room when it lands on a section on the grid", () => {
    let s = premise();
    const [from, to] = ["sec-headline", "sec-limits"];
    s = regrid(s, s.elements[to].children[0], { w: 6, h: 8 });
    const moving = s.elements[from].children[0];
    const out = moveTo(s, moving, s.elements[to].children[0], "after");
    expect(out.elements[moving].props).toHaveProperty("w");
    expect(out.elements[moving].props).toHaveProperty("h");
    expect(issues(out)).toEqual([]);
  });

  it("leaves the dashboard as it was for a move onto itself, an unknown piece, or a place that holds no pieces", () => {
    const s = premise();
    const sec = sectionsWithTwo(s)[0];
    const a = s.elements[sec].children[0];
    expect(moveTo(s, a, a, "after")).toEqual(s);
    expect(moveTo(s, a, "nope", "after")).toEqual(s);
    expect(moveTo(s, a, s.root, "after")).toEqual(s);
  });
});
