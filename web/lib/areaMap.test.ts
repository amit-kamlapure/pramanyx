// @vitest-environment node
/** The Atlas's layout and words (2026-11-25, A4a): bubbles sized by the answers that drew on an Area, laid out the same
 *  every time and never touching; the figures said in words, a share of nothing said as a dash. */
import { describe, expect, it } from "vitest";

import { bounds, changeWords, curve, fanOf, itemsOf, oneSided, packBubbles, radiusFor, R_MIN, reviewFilters, reviewWord, ring, share, waitingWords } from "@/lib/areaMap";
import type { DiscoverItem, DiscoverKind } from "@/lib/discover";

describe("the Areas laid out", () => {
  const sizes = Array.from({ length: 18 }, (_, n) => ({ id: `a${n}`, r: radiusFor([120, 40, 12, 9, 5, 0][n % 6]) }));

  it("grows a bubble with the answers that drew on it, and never below the smallest", () => {
    expect(radiusFor(0)).toBe(R_MIN);
    expect(radiusFor(100)).toBeGreaterThan(radiusFor(25));
    expect(radiusFor(-3)).toBe(R_MIN);
  });

  it("puts the biggest in the middle, none touching another, the same every time", () => {
    const placed = packBubbles(sizes);
    expect(placed[0]).toMatchObject({ x: 0, y: 0 });
    for (const a of placed) for (const b of placed) {
      if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r);
    }
    expect(packBubbles([...sizes].reverse())).toEqual(placed);
    const box = bounds(placed);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });
});

describe("the Areas laid out, as the live install has them", () => {
  it("never puts two bubbles on one spot, however many and however sized (seen live: they stacked in the middle)", () => {
    const answers = [393, 52, 34, 22, 11, 10, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const placed = packBubbles(answers.map((n, i) => ({ id: `a${i}`, r: radiusFor(n) })));
    for (const a of placed) for (const b of placed) {
      if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r);
    }
    const box = bounds(placed);
    expect(box.width).toBeGreaterThan(box.height);
  });
});

describe("the figures in words", () => {
  it("says a share, a change on the month before, and what waits", () => {
    expect(share(41, 100)).toBe("41%");
    expect(share(0, 0)).toBe("—");
    expect(changeWords(304, 186, 30)).toBe("↑ 63% on the 30 days before (186)");
    expect(changeWords(90, 100, 30)).toBe("↓ 10% on the 30 days before (100)");
    expect(changeWords(5, 0, 30)).toBe("none the 30 days before");
    expect(waitingWords({ gap: 2, candidate: 1, conflict: 0 }, 9)).toBe("2 gaps · 1 to confirm · 9 learned");
    expect(waitingWords({ gap: 0, candidate: 0, conflict: 0 }, 0)).toBe("nothing waits");
    expect(waitingWords(null, null)).toBe("not read yet");
  });
});

describe("an Area, opened (A4b)", () => {
  const it_ = (kind: DiscoverKind, id: string, cert = "") => ({ kind, id, name: id, certification: cert ? { status: cert } : null }) as DiscoverItem;
  const page = { kinds: [
    { kind: "table" as const, title: "Tables", count: 3, withheld: 0, states: {}, items: [it_("table", "t1", "certified"), it_("table", "t2")] },
    { kind: "metric" as const, title: "Metrics", count: 1, withheld: 0, states: {}, items: [it_("metric", "m1", "certified")] },
  ] };

  it("fans out in the plan's order — defined and certified first — each with its count; none drawn for nothing", () => {
    expect(fanOf(page, 7).map((f) => [f.key, f.words])).toEqual([
      ["metric", "1 metric"], ["certified", "2 certified"], ["learned", "7 learned"], ["table", "3 tables"]]);
    expect(fanOf(page, null).map((f) => f.key)).toEqual(["metric", "certified", "table"]);
    expect(fanOf({ kinds: [] }, 0)).toEqual([]);
  });

  it("lists a kind's own things, or every certified thing across kinds", () => {
    expect(itemsOf(page, "table").map((i) => i.id)).toEqual(["t1", "t2"]);
    expect(itemsOf(page, "certified").map((i) => i.id)).toEqual(["t1", "m1"]);
    expect(itemsOf(page, "learned")).toEqual([]);
  });

  it("places a ring the same every time, the first at the top", () => {
    const r = ring(4, 100);
    expect(r[0].x).toBeCloseTo(0); expect(r[0].y).toBeCloseTo(-100);
    expect(r[2].y).toBeCloseTo(100);
    expect(ring(4, 100)).toEqual(r);
  });
});

describe("review by Area (A5)", () => {
  it("says each row in the plan's words, by where it came from; an unknown source by its kind", () => {
    expect(reviewWord("framing_miss", "gap")).toBe("Gap");
    expect(reviewWord("unhelpful", "candidate")).toBe("Thumbs-down");
    expect(reviewWord("definition_edit", "candidate")).toBe("Definition edit");
    expect(reviewWord("something_new", "conflict")).toBe("Conflict");
  });

  it("offers a filter per word that has rows, summed across its sources, in the plan's order", () => {
    expect(reviewFilters({ unanswered: 2, verdict: 1, framing_miss: 3, new_definition: 4 })).toEqual([
      { word: "New Definition", count: 4 }, { word: "Gap", count: 5 }, { word: "Thumbs-down", count: 1 }]);
  });
});

describe("an Area opened to one side (2026-11-25)", () => {
  it("puts what it holds and its sub-Areas to its right, every one on the same side, inside the canvas", () => {
    const L = oneSided(900, 640, { parent: false, siblings: 0, chosenAt: 0, chips: 6, subs: 2 });
    expect(L.parent).toBeNull();
    for (const c of L.chips) expect(c.x).toBeGreaterThan(L.chosen.x + L.chosen.r);
    for (const d of L.subs) expect(d.x - d.r).toBeGreaterThan(L.chosen.x + L.chosen.r);
    expect(Math.min(...L.chips.map((c) => c.y - c.h / 2))).toBeGreaterThanOrEqual(16);
    expect(Math.max(...L.subs.map((d) => d.y + d.r))).toBeLessThanOrEqual(640 - 16 + 1e-6);
    expect(oneSided(900, 640, { parent: false, siblings: 0, chosenAt: 0, chips: 6, subs: 2 })).toEqual(L);
  });

  it("with a parent: the parent large on the left, the Area among its siblings to its right and larger than them", () => {
    const L = oneSided(900, 640, { parent: true, siblings: 4, chosenAt: 1, chips: 3, subs: 0 });
    expect(L.parent!.x + L.parent!.r).toBeLessThan(L.siblings[0].x - L.siblings[0].r);
    expect(new Set(L.siblings.map((d) => d.x)).size).toBe(1);
    expect(L.chosen).toBe(L.siblings[1]);
    expect(L.chosen.r).toBeGreaterThan(L.siblings[0].r);
    expect(L.parent!.r).toBeGreaterThan(L.chosen.r);
  });

  it("draws every line from a circle's right side", () => {
    expect(curve({ x: 100, y: 100, r: 50 }, { x: 300, y: 40 })).toMatch(/^M 150 100 C /);
  });
});

