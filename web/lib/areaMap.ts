/**
 * The Atlas, by Area — the organisation's map, as the Ontology page reads it (2026-11-25, the Atlas-by-Area plan's A4a;
 * `GET /discover/atlas`). Every Area in view with what it holds, how many of the month's answers drew on it, what waits
 * for review and what was learned in it; the side panel's figures; and the layout that draws the Areas as bubbles,
 * sized by the answers that drew on them — the same picture every time it is read.
 */
import type { DiscoverArea, DiscoverItem, SuggestedInView } from "@/lib/discover";

export interface AtlasArea extends DiscoverArea {
  /** The month's answers that read a table placed in it. */
  answers: number;
  /** What waits for review in it, by kind — null until the first reading lands. */
  review: { gap: number; candidate: number; conflict: number } | null;
  /** What was learned in it — null until the first reading lands. */
  learned: number | null;
}

export interface Atlas {
  connections: { id: string; name: string }[];
  areas: AtlasArea[];
  everything_else: AtlasArea;
  quiet: { id: string; name: string; question: string }[];
  suggested: SuggestedInView[];
  figures: { answers: number; previous: number; governed: number; in_an_area: number; window_days: number; given_since: string };
  contacts: { named: number; of: number };
  most_used: DiscoverItem[];
  review: { total: number; unplaced: number } | null;
  learned: { total: number; unplaced: number } | null;
  read_at: string | null;
  said: string[];
}

/** One bubble's place: its centre and radius, in the layout's own units. */
export interface Placed { id: string; x: number; y: number; r: number }

/** The smallest bubble: room for a glyph and a short name. */
export const R_MIN = 46;
/** How much a bubble grows with the answers that drew on it — by the square root, so area tracks the count. */
const GROW = 9;
/** The space kept between two bubbles. */
const GAP = 10;

/** A bubble's radius for the answers that drew on its Area this month. */
export function radiusFor(answers: number): number {
  return R_MIN + GROW * Math.sqrt(Math.max(0, answers));
}

/** Lay the bubbles out, biggest first, each as near the middle as it can be without touching another: around every
 *  bubble already placed, every ten degrees, the nearest free spot wins. Deterministic — the same Areas, the same
 *  picture — and the result is centred on (0, 0). */
export function packBubbles(sizes: { id: string; r: number }[]): Placed[] {
  const placed: Placed[] = [];
  const order = [...sizes].sort((a, b) => b.r - a.r || a.id.localeCompare(b.id));
  const free = (x: number, y: number, r: number) => placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r + GAP);
  for (const s of order) {
    if (!placed.length) { placed.push({ id: s.id, x: 0, y: 0, r: s.r }); continue; }
    let best: { x: number; y: number; d: number } | null = null;
    for (const p of placed) {
      for (let deg = 0; deg < 360; deg += 10) {
        const a = (deg * Math.PI) / 180;
        const x = p.x + Math.cos(a) * (p.r + s.r + GAP);
        const y = p.y + Math.sin(a) * (p.r + s.r + GAP) * 0.82;   // a little wider than tall, as a screen is
        const d = Math.hypot(x, y);
        if ((!best || d < best.d - 1e-9) && free(x, y, s.r)) best = { x, y, d };
      }
    }
    const at = best ?? { x: 0, y: 0, d: 0 };
    placed.push({ id: s.id, x: at.x, y: at.y, r: s.r });
  }
  return placed;
}

/** The box the bubbles take, to fit them to the canvas. */
export function bounds(placed: Placed[]): { minX: number; minY: number; width: number; height: number } {
  if (!placed.length) return { minX: 0, minY: 0, width: 1, height: 1 };
  const minX = Math.min(...placed.map((p) => p.x - p.r)), maxX = Math.max(...placed.map((p) => p.x + p.r));
  const minY = Math.min(...placed.map((p) => p.y - p.r)), maxY = Math.max(...placed.map((p) => p.y + p.r));
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/** A share, in words: "41%", or "—" of nothing. */
export function share(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((100 * part) / whole)}%` : "—";
}

/** The month against the one before, in words: "↑ 63% on the 30 days before (186)". */
export function changeWords(now: number, before: number, days: number): string {
  if (!before) return now ? `none the ${days} days before` : "";
  const pct = Math.round((100 * (now - before)) / before);
  return `${pct >= 0 ? "↑" : "↓"} ${Math.abs(pct)}% on the ${days} days before (${before})`;
}

/** What waits for review in an Area, in words — or that it is not read yet. */
export function waitingWords(r: AtlasArea["review"], learned: number | null): string {
  if (!r) return "not read yet";
  const parts = [r.gap ? `${r.gap} gap${r.gap === 1 ? "" : "s"}` : "", r.candidate ? `${r.candidate} to confirm` : "",
    r.conflict ? `${r.conflict} answered several ways` : "", learned ? `${learned} learned` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "nothing waits";
}

/** How many wait for review in an Area. */
export function waiting(r: AtlasArea["review"]): number {
  return r ? r.gap + r.candidate + r.conflict : 0;
}
