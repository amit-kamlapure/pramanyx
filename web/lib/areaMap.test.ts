// @vitest-environment node
/** The Atlas's layout and words (2026-11-25, A4a): bubbles sized by the answers that drew on an Area, laid out the same
 *  every time and never touching; the figures said in words, a share of nothing said as a dash. */
import { describe, expect, it } from "vitest";

import { bounds, changeWords, packBubbles, radiusFor, R_MIN, share, waitingWords } from "@/lib/areaMap";

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
