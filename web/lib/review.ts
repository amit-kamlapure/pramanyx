/**
 * What waits on a person for a connection's knowledge (`GET /knowledge/{connection}/review`, Phase 3, 2026-11-17):
 * gaps, candidates and conflicts, each with the page it is decided on and the owners of its area.
 */
import { getApiBase } from "@/lib/config";

export type ReviewKind = "gap" | "candidate" | "conflict";

export interface ReviewItem {
  id: string;
  source: string;
  kind: ReviewKind;
  title: string;
  detail: string;
  /** The area it is in, or several joined by commas for a word that means different things in each; "" when none. */
  area: string;
  /** How often it was asked, or how many wait, where its source counts that. */
  count: number | null;
  complaints: number;
  at: string;
  owners: string[];
  resolve: { href: string | null; action: string };
}

export interface ReviewArea { id: string; name: string; owners: string[]; waiting: number }

export interface Review {
  connection_id: string;
  items: ReviewItem[];
  total: number;
  by_kind: Record<ReviewKind, number>;
  unplaced: number;
  sources: Record<string, number>;
  /** Sources that could not be read: what they hold is not in the list. */
  unread: string[];
  areas: ReviewArea[];
}

export async function readReview(connectionId: string, area = ""): Promise<Review> {
  const q = new URLSearchParams(area ? { area } : {});
  const res = await fetch(`${getApiBase()}/knowledge/${encodeURIComponent(connectionId)}/review${area ? `?${q}` : ""}`);
  if (!res.ok) throw new Error(`The review list could not be read (${res.status})`);
  return res.json();
}

/** What a source is, as a person reads it — for the line that says which could not be read. */
export const SOURCE_WORDS: Record<string, string> = {
  framing_miss: "questions that missed the definitions", unanswered: "unanswered questions",
  unconfirmed: "unconfirmed findings", definitions: "Definition drafts and suggested edits",
  synonym: "proposed synonyms", import: "imports", verdict: "answers marked wrong",
  unhelpful: "answers marked unhelpful", rival_meanings: "words with rival meanings",
  divergence: "questions answered more than one way", areas: "the areas and their owners",
};

/** How busy a row is, in words: "asked 4 times", "2 complaints". */
export function busyWords(item: ReviewItem): string {
  const parts: string[] = [];
  if (item.kind === "gap" && item.count) parts.push(item.count === 1 ? "asked once" : `asked ${item.count} times`);
  if (item.complaints) parts.push(item.complaints === 1 ? "1 complaint" : `${item.complaints} complaints`);
  return parts.join(" · ");
}

/** Who a row is for. */
export function forWhom(item: ReviewItem): string {
  if (item.owners.length) return `For ${item.owners.join(", ")}`;
  return item.area ? "Its area names no owner" : "No area: for whoever curates this connection";
}
