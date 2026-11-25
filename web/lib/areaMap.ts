/**
 * The Atlas, by Area — the organisation's map, as the Ontology page reads it (2026-11-25, the Atlas-by-Area plan's A4a;
 * `GET /discover/atlas`). Every Area in view with what it holds, how many of the month's answers drew on it, what waits
 * for review and what was learned in it; the side panel's figures; and the layout that draws the Areas as bubbles,
 * sized by the answers that drew on them — the same picture every time it is read.
 */
import type { IconName } from "@/components/ui/icon";
import {
  KIND_ICON, KIND_WORDS, type DiscoverArea, type DiscoverAreaPage, type DiscoverItem, type DiscoverKind, type SuggestedInView,
} from "@/lib/discover";
import { formatCount } from "@/lib/format";

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
/** How much wider than tall the map spreads. */
const WIDE = 1.35;

/** A bubble's radius for the answers that drew on its Area this month. */
export function radiusFor(answers: number): number {
  return R_MIN + GROW * Math.sqrt(Math.max(0, answers));
}

/** Lay the bubbles out, biggest first, each as near the middle as it can be without touching another: around every
 *  bubble already placed, every ten degrees, at exactly the distance that touches it, the nearest free spot wins —
 *  "nearest" measured a little wider than tall, so the map spreads as a screen does. Deterministic — the same Areas,
 *  the same picture — and the result is centred on (0, 0). There is always a free spot on the outer side of the
 *  outermost bubble; were there none, it goes on a ring past them all, never on top of another. */
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
        const y = p.y + Math.sin(a) * (p.r + s.r + GAP);
        const d = Math.hypot(x / WIDE, y);
        if ((!best || d < best.d - 1e-9) && free(x, y, s.r)) best = { x, y, d };
      }
    }
    const ring = Math.max(...placed.map((p) => Math.hypot(p.x, p.y) + p.r)) + s.r + GAP;
    const at = best ?? { x: ring, y: 0, d: ring };
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

// ── an Area, opened (A4b, the plan's §3.2–3.3) ────────────────────────────────────────────────────────────────────────

/** What an opened Area fans out into: each kind it holds, what was learned in it, and what is certified across kinds. */
export type FanKey = DiscoverKind | "learned" | "certified";

export interface Fan { key: FanKey; count: number; words: string; icon: IconName }

/** The order an Area fans out in — the plan's: what people defined and certified first, then the rest. */
const FAN_ORDER: FanKey[] = ["metric", "definition", "certified", "learned", "trusted_query", "dashboard", "canvas",
  "agent", "document", "sheet", "schedule", "table"];

/** An Area's fan: each kind with a count, in the plan's order — a kind it holds none of is not drawn. */
export function fanOf(page: Pick<DiscoverAreaPage, "kinds">, learned: number | null): Fan[] {
  const counts = new Map<FanKey, number>(page.kinds.map((k) => [k.kind, k.count]));
  const certified = page.kinds.reduce((n, k) => n + k.items.filter((i) => i.certification?.status === "certified").length, 0);
  if (certified) counts.set("certified", certified);
  if (learned) counts.set("learned", learned);
  return FAN_ORDER.filter((k) => (counts.get(k) ?? 0) > 0).map((k) => {
    const n = counts.get(k) ?? 0;
    const words = k === "learned" ? "learned" : k === "certified" ? "certified"
      : KIND_WORDS[k][n === 1 ? 0 : 1];
    return { key: k, count: n, words: `${formatCount(n)} ${words}`, icon: k === "learned" ? "idea" : k === "certified" ? "certificate" : KIND_ICON[k] };
  });
}

/** The things of one fan key, as its list shows them — a kind's own, or every certified thing. */
export function itemsOf(page: Pick<DiscoverAreaPage, "kinds">, key: FanKey): DiscoverItem[] {
  if (key === "learned") return [];
  if (key === "certified") return page.kinds.flatMap((k) => k.items.filter((i) => i.certification?.status === "certified"));
  return page.kinds.find((k) => k.kind === key)?.items ?? [];
}

/** ``n`` places on a ring of radius ``r`` around (0, 0), the first at the top, going clockwise — the same every time. */
export function ring(n: number, r: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
    return { x: Math.cos(a) * r * WIDE, y: Math.sin(a) * r };
  });
}
