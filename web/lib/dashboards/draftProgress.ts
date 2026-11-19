/**
 * A dashboard being drafted, as a person watches it (the user, 2026-11-18: "user needs to have a clear visual that the dashboard
 * request is actually happening"). Every line is something the platform did and said it did, in its own counts: nothing here is
 * timed to look busy, and no word of it is the model's.
 */
import type { DashboardDrafted } from "@/lib/api";

/** A piece the draft places: the room it takes and, for a card, the card. */
export interface DraftPiece { kind: string; size?: string; w?: number; h?: number; card?: string }

export type DraftFrame =
  | { type: "read"; metrics: number; trusted_queries: number; findings: number }
  | { type: "checking"; round: number; cards: number; outline: DraftPiece[] }
  | { type: "card"; key: string; title: string; shows?: "figure" | "chart"; state: "running" | "ok" }
  | { type: "sent_back"; round: number; points: number }
  | { type: "done"; result: DashboardDrafted }
  | { type: "failed"; sentences: string[] }
  | { type: "end" };

export interface DraftStep { id: string; words: string; state: "doing" | "done" | "failed"; note?: string }
export interface DraftCardSeen { title: string; shows?: "figure" | "chart"; state: "running" | "ok" }

export interface DraftWatch {
  /** What is being made: a whole new dashboard, or a change to one that stands. */
  what: "dashboard" | "change";
  steps: DraftStep[];
  /** Where the latest draft places its pieces; empty until one is written. */
  outline: DraftPiece[];
  /** How many new cards the latest draft holds. */
  asked: number;
  /** The latest draft's cards, by name, as each is run. */
  cards: Record<string, DraftCardSeen>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function listed(parts: string[]): string {
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** What the connection offered the draft. */
export function foundWords(f: { metrics: number; trusted_queries: number; findings: number }): string {
  const parts = [
    f.metrics ? plural(f.metrics, "approved metric") : "",
    f.trusted_queries ? plural(f.trusted_queries, "trusted query", "trusted queries") : "",
    f.findings ? plural(f.findings, "finding") : "",
  ].filter(Boolean);
  return parts.length ? `Read ${listed(parts)}` : "Found no approved metrics, trusted queries or findings";
}

const doing = (id: string, words: string, note?: string): DraftStep => ({ id, words, state: "doing", ...(note ? { note } : {}) });

/** The step under way, finished, in the words of what it came to. */
function settled(steps: DraftStep[], words?: string): DraftStep[] {
  return steps.map(s => (s.state === "doing" ? { id: s.id, state: "done" as const, words: words ?? s.words } : s));
}

export function startWatch(what: DraftWatch["what"] = "dashboard"): DraftWatch {
  return { what, steps: [doing("reading", "Reading what this connection can show")], outline: [], asked: 0, cards: {} };
}

export const isWorking = (watch: DraftWatch) => watch.steps.some(s => s.state === "doing");

/** The watch, after one thing the platform said it did. */
export function heardFrame(watch: DraftWatch, frame: DraftFrame): DraftWatch {
  const current = watch.steps.find(s => s.state === "doing");
  switch (frame.type) {
    case "read":
      if (current?.id !== "reading") return watch;
      return { ...watch, steps: [...settled(watch.steps, foundWords(frame)), doing("writing", `Writing the ${watch.what}`)] };
    case "checking": {
      const wrote = frame.round > 1 ? `Rewrote the ${watch.what}` : frame.cards ? `Wrote ${plural(frame.cards, "card")}` : `Wrote the ${watch.what}`;
      const before = current?.id === "reading"
        ? [...settled(watch.steps, "Read what this connection can show"), { id: "writing", words: wrote, state: "done" as const }]
        : settled(watch.steps, wrote);
      const run = frame.cards ? doing(`run-${frame.round}`, "Running each card on the data", `0 of ${frame.cards}`)
        : doing(`run-${frame.round}`, `Checking the ${watch.what}`);
      return { what: watch.what, steps: [...before, run], outline: frame.outline ?? [], asked: frame.cards, cards: {} };
    }
    case "card": {
      const cards = { ...watch.cards, [frame.key]: { title: frame.title, shows: frame.shows, state: frame.state } };
      const ran = Object.values(cards).filter(c => c.state === "ok").length;
      return { ...watch, cards, steps: watch.steps.map(s => (s.state === "doing" ? { ...s, note: `${ran} of ${watch.asked}` } : s)) };
    }
    case "sent_back": {
      const said = frame.points ? `The platform sent it back with ${plural(frame.points, "point")} to fix` : "The platform sent it back";
      return { ...watch, steps: [...settled(watch.steps, said), doing(`fixing-${frame.round}`, "Fixing what was sent back")] };
    }
    default:
      return watch;
  }
}

/** The watch once the draft has come back: ready to review, or not drafted. */
export function finishedWatch(watch: DraftWatch, result: DashboardDrafted): DraftWatch {
  if (!result.staged) {
    return endedWatch(watch, watch.what === "change" ? "No change was drafted" : "No dashboard was drafted");
  }
  const ran = watch.asked ? `Ran ${plural(watch.asked, "card")} on the data` : `Checked the ${watch.what}`;
  const ready = watch.what === "change" ? "Ready for your approval" : "Ready for you to review";
  return { ...watch, steps: [...settled(watch.steps, ran), { id: "ended", words: ready, state: "done" }] };
}

/** The watch when the work ended without a result, saying why. */
export function endedWatch(watch: DraftWatch, words: string): DraftWatch {
  return { ...watch, steps: [...watch.steps.filter(s => s.state !== "doing"), { id: "ended", words, state: "failed" }] };
}
