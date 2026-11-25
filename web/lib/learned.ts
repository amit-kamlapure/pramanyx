/**
 * What the platform learned about a connection, as a page reads it (2026-11-25, the Atlas-by-Area plan's A3 —
 * `GET /knowledge/{c}/learned`): each item in the one standing's order with why it stands there, the Areas that hold
 * some, and Promote — a learned item drafted as a Definition, in the person's own name, saying where it came from.
 */
import { fastApiError } from "@/lib/api";
import { getApiBase } from "@/lib/config";

export type LearnedKind = "answer" | "finding" | "usage" | "trusted_query" | "fix" | "reading" | "verdict";

export interface LearnedItem {
  kind: LearnedKind;
  text: string;
  source: string;
  author: string;
  standing: string;
  standing_said: string;
  /** Where it stands in the one order, and why — a reader's words. */
  why: string;
  as_of: string;
  tables: string[];
  lineage: string[];
  ref: string;
  area: string;
  /** Answers it guided this month — counted for a trusted query; null for the rest, not yet counted. */
  uses: number | null;
  times: number;
  also: string[];
}

export interface Learned {
  items: LearnedItem[];
  total: number;
  matched: number;
  folded: number;
  unplaced: number;
  areas: { id: string; name: string; count: number }[];
  withheld: { withheld: number; notice: string } | null;
}

/** The `area` that asks for what sits in no Area. */
export const NO_AREA = "none";

export async function readLearned(connectionId: string, { area = "", about = "", limit = 200 } = {}): Promise<Learned> {
  const q = new URLSearchParams({ limit: String(limit), ...(area ? { area } : {}), ...(about.trim() ? { about: about.trim() } : {}) });
  const res = await fetch(`${getApiBase()}/knowledge/${encodeURIComponent(connectionId)}/learned?${q}`);
  if (!res.ok) throw new Error(`What was learned could not be read (${res.status})`);
  return res.json();
}

export const KIND_WORDS: Record<LearnedKind, string> = {
  answer: "From an answer", finding: "From the explorer", usage: "From people's queries", trusted_query: "Trusted query",
  // a failure and the fix that ran after it (A7, from what an answer tried — A1b)
  fix: "Watch for this",
  // Memory's half, in the one list (A3b): a word's remembered reading, and a reviewer's verdict with its lesson
  reading: "Remembered reading", verdict: "A reviewer's verdict",
};

/** The word a Promote drafts, guessed from what the item says: its words before a colon or a dash when short, else its
 *  first words — the person changes it before saving. */
export function wordOf(text: string): string {
  const t = text.replace(/^Restated:\s*/i, "").trim();
  const head = t.split(/:\s|\s[—–-]\s/)[0].replace(/\s*\(.*\)\s*$/, "").trim();
  if (head && head.length <= 60 && head !== t) return head;
  return t.split(/\s+/).slice(0, 6).join(" ").replace(/[.,;:]+$/, "");
}

/** The receipt an item rests on, when a run measured it. */
export function receiptOf(item: Pick<LearnedItem, "lineage">): string {
  const run = item.lineage.find((l) => l.startsWith("run:"));
  return run ? run.slice(4) : "";
}

/** The line a Promoted draft carries under what it means: where it came from, how it stood, what it read. */
export function whereFrom(item: LearnedItem): string {
  const read = item.tables.length ? `, over ${item.tables.join(", ")}` : "";
  const receipt = receiptOf(item);
  return `Where this comes from: learned from ${item.source}${read} — ${item.why}${receipt ? ` (receipt ${receipt})` : ""}.`;
}

export interface Promoted { term: string; area: string; suggested: boolean; href: string }

/** Draft a Definition from a learned item, in the person's own name, through the Definitions door: a word nobody has
 *  defined becomes their draft; a word someone else defined becomes a suggested edit for its owner. */
export async function promoteLearned(connectionId: string, item: LearnedItem, draft: { term: string; text: string; area: string }): Promise<Promoted> {
  const body = {
    connection_id: connectionId, term: draft.term.trim(), area: draft.area,
    text: `${draft.text.trim()}\n\n_${whereFrom(item)}_`,
    links: item.tables.slice(0, 10).map((t) => ({ kind: "table", ref: t, label: t })),
  };
  const res = await fetch(`${getApiBase()}/record/definitions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const got = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(fastApiError(got, `Not drafted (${res.status})`));
  const q = new URLSearchParams({ tab: "semantic", semtab: "definitions", conn: connectionId, definition: body.term, ...(draft.area ? { area: draft.area } : {}) });
  return { term: body.term, area: draft.area, suggested: Boolean((got as { suggested?: unknown }).suggested), href: `/?${q}` };
}
