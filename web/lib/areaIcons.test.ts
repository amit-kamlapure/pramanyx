// @vitest-environment node
/** The glyph an Area is drawn with (2026-11-25): every one a package names is one the app draws. */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ICON_NAMES } from "@/components/ui/icon";
import { AREA_ICONS, DEFAULT_AREA_ICON, areaIcon } from "@/lib/areaIcons";

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
});
