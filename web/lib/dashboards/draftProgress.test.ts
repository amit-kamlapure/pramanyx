import { describe, expect, it } from "vitest";

import type { DashboardDrafted } from "@/lib/api";
import { finishedWatch, foundWords, heardFrame, isWorking, startWatch, type DraftFrame } from "./draftProgress";

const STAGED: DashboardDrafted = { staged: true, proposal_id: "p1", cockpit_id: "returns-1", summary: "", rounds: 1, stop_reason: "answered", sentences: [] };
const heard = (...frames: DraftFrame[]) => frames.reduce(heardFrame, startWatch());
const words = (w: ReturnType<typeof startWatch>) => w.steps.map(s => s.words);

describe("a dashboard being drafted, as a person watches it", () => {
  it("says what the connection offered, leaving out what it does not have", () => {
    expect(foundWords({ metrics: 14, trusted_queries: 1, findings: 3 })).toBe("Read 14 approved metrics, 1 trusted query and 3 findings");
    expect(foundWords({ metrics: 1, trusted_queries: 0, findings: 0 })).toBe("Read 1 approved metric");
    expect(foundWords({ metrics: 0, trusted_queries: 0, findings: 0 })).toBe("Found no approved metrics, trusted queries or findings");
  });

  it("is working from the moment it is asked, on one step at a time", () => {
    const start = startWatch();
    expect(isWorking(start)).toBe(true);
    const later = heard({ type: "read", metrics: 2, trusted_queries: 0, findings: 0 });
    expect(later.steps.map(s => s.state)).toEqual(["done", "doing"]);
    expect(words(later)).toEqual(["Read 2 approved metrics", "Writing the dashboard"]);
  });

  it("counts each card as it passes, and only the ones that passed", () => {
    const w = heard({ type: "read", metrics: 2, trusted_queries: 0, findings: 0 },
      { type: "checking", round: 1, cards: 2, outline: [{ kind: "Card", size: "small", card: "a" }] },
      { type: "card", key: "a", title: "Return rate", state: "running" });
    expect(w.steps[w.steps.length - 1].note).toBe("0 of 2");
    const after = heardFrame(w, { type: "card", key: "a", title: "Return rate", shows: "figure", state: "ok" });
    expect(after.steps[after.steps.length - 1].note).toBe("1 of 2");
    expect(after.cards.a).toEqual({ title: "Return rate", shows: "figure", state: "ok" });
    expect(after.outline[0].card).toBe("a");
  });

  it("says when the platform sent a draft back, and starts the cards again for the next one", () => {
    const w = heard({ type: "read", metrics: 2, trusted_queries: 0, findings: 0 },
      { type: "checking", round: 1, cards: 1, outline: [] },
      { type: "card", key: "a", title: "Return rate", shows: "figure", state: "ok" },
      { type: "sent_back", round: 1, points: 2 },
      { type: "checking", round: 2, cards: 1, outline: [] });
    expect(words(w)).toEqual(["Read 2 approved metrics", "Wrote 1 card", "The platform sent it back with 2 points to fix", "Rewrote the dashboard", "Running each card on the data"]);
    expect(w.cards).toEqual({});
  });

  it("ends ready to review, and never says ready for what was not drafted", () => {
    const w = heard({ type: "read", metrics: 2, trusted_queries: 0, findings: 0 }, { type: "checking", round: 1, cards: 3, outline: [] });
    const ready = finishedWatch(w, STAGED);
    expect(isWorking(ready)).toBe(false);
    expect(words(ready).slice(-2)).toEqual(["Ran 3 cards on the data", "Ready for you to review"]);
    const none = finishedWatch(w, { ...STAGED, staged: false, sentences: ["Nothing measures this."] });
    expect(isWorking(none)).toBe(false);
    expect(words(none)).not.toContain("Ready for you to review");
    expect(none.steps[none.steps.length - 1]).toMatchObject({ words: "No dashboard was drafted", state: "failed" });
  });

  it("follows a draft that skipped reading what is on offer", () => {
    const w = heard({ type: "checking", round: 1, cards: 1, outline: [] });
    expect(words(w)).toEqual(["Read what this connection can show", "Wrote 1 card", "Running each card on the data"]);
    expect(w.steps.filter(s => s.state === "doing")).toHaveLength(1);
  });
});
