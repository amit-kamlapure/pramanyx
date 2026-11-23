/**
 * The app's tab icon is the coworker's (the user, 2026-11-23: "can we both the same as the right one (coworker)"):
 * the mark in one colour, dark on a light browser and light on a dark one, never the filled square of the old logo.
 */
import { describe, expect, it } from "vitest";

import { MARK_LINE } from "@/components/ui/brandArt";
import { markIcon } from "@/lib/markIcon";

describe("the tab's icon", () => {
  const svg = markIcon();

  it("is the mark's outline and its ring, in one colour, on nothing", () => {
    expect(svg).toContain(MARK_LINE);
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).not.toMatch(/<rect|gradient|<image/i);
  });

  it("is dark on a light browser and light on a dark one, the coworker's two colours", () => {
    expect(svg).toContain("path{fill:#111113}");
    expect(svg).toContain("@media (prefers-color-scheme:dark){path{fill:#edeef0}}");
  });

  it("sits centred on a square, as a tab draws it", () => {
    const [, , w, h] = (svg.match(/viewBox="([^"]+)"/)?.[1] ?? "").split(" ").map(Number);
    expect(w).toBeGreaterThan(0);
    expect(w).toBe(h);
  });
});
