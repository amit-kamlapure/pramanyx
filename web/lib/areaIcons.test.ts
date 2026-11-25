// @vitest-environment node
/** The glyph an Area is drawn with (2026-11-25): every one a package names is one the app draws. */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ICON_NAMES, glyphOf } from "@/components/ui/icon";
import { AREA_ICONS, AREA_ICON_WORDS, DEFAULT_AREA_ICON, areaIcon, findAreaIcons } from "@/lib/areaIcons";

const PACKS = join(__dirname, "..", "..", "packs");

describe("an Area's glyph", () => {
  it("is one the app draws, for every Area every package declares", () => {
    const drawn = new Set<string>(ICON_NAMES);
    const named: string[] = [];
    for (const pack of readdirSync(PACKS)) {
      const file = join(PACKS, pack, "areas.yaml");
      if (!existsSync(file)) continue;
      for (const m of readFileSync(file, "utf8").matchAll(/^\s+icon:\s*([a-z][a-z0-9-]*)\s*$/gm)) named.push(`${pack}:${m[1]}`);
    }
    expect(named.length).toBeGreaterThanOrEqual(50);
    expect(named.filter((n) => !drawn.has(n.split(":")[1]))).toEqual([]);
    expect(AREA_ICONS.filter((n) => !drawn.has(n))).toEqual([]);
  });

  it("falls back to the default for none, or a name the app does not draw", () => {
    expect(areaIcon("truck")).toBe("truck");
    expect(areaIcon("")).toBe(DEFAULT_AREA_ICON);
    expect(areaIcon(undefined)).toBe(DEFAULT_AREA_ICON);
    expect(areaIcon("not-a-glyph")).toBe(DEFAULT_AREA_ICON);
  });

  it("offers every glyph the picker had before, many more, and no drawing twice (2026-11-25)", () => {
    const before = ["cart", "cash", "spend", "pricetag", "discount", "returns", "card", "invoice", "recurring", "truck", "box",
      "route", "ontime", "store", "plane", "factory", "quality", "tool", "megaphone", "funnel", "target", "users", "contacts",
      "consent", "mood", "support", "event", "gauge", "activity", "chart", "layers"];
    expect(before.filter((n) => !AREA_ICONS.includes(n as never))).toEqual([]);
    expect(AREA_ICONS.length).toBeGreaterThanOrEqual(80);
    expect(new Set(AREA_ICONS).size).toBe(AREA_ICONS.length);
    expect(new Set(AREA_ICONS.map((n) => glyphOf(n))).size).toBe(AREA_ICONS.length);
    expect(AREA_ICONS.filter((n) => !AREA_ICON_WORDS[n])).toEqual([]);
  });

  it("is found by what it is about: every word typed, in the picker's order", () => {
    expect(findAreaIcons("")).toEqual(AREA_ICONS);
    expect(findAreaIcons("shipping")).toEqual(["truck", "ship"]);
    expect(findAreaIcons("REVENUE")).toEqual(expect.arrayContaining(["cash", "recurring"]));
    expect(findAreaIcons("real estate")).toEqual(["property"]);
    expect(findAreaIcons("nothing like it")).toEqual([]);
  });
});
