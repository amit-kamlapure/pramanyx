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
export type FanKind = DiscoverKind | "learned" | "certified";

/** What the opened Area's side panel can show: one of its fan's lists, or what waits for review in it (A5). */
export type FanKey = FanKind | "review";

export interface Fan { key: FanKind; count: number; words: string; icon: IconName; tone: string }

// ── colour by type (the user, 2026-11-25: "colour coding for the Areas and their subparts — based on type") ──────────
// The theme's six ramps, which flip with light and dark (`styles/tokens.css`), never a raw colour: what people defined
// in the cool ramps (metrics blue, Definitions violet, what is certified green, trusted queries cyan), what was learned
// in amber, what is built on them in the third step of a ramp, and the data itself — tables — neutral.

/** Each kind's colour. */
export const KIND_TONE: Record<FanKind, string> = {
  metric: "var(--blue4)", definition: "var(--vio4)", certified: "var(--grn4)", trusted_query: "var(--cyn4)",
  learned: "var(--amb4)",
  dashboard: "var(--red4)", canvas: "var(--vio3)", agent: "var(--cyn3)", schedule: "var(--blue3)", document: "var(--amb3)",
  sheet: "var(--grn3)", table: "var(--t2)",
};

/** The Areas' colours, one each, the same every time; what sits in no Area stays neutral. */
export const AREA_TONES = ["var(--blue4)", "var(--grn4)", "var(--vio4)", "var(--amb4)", "var(--cyn4)", "var(--red4)"] as const;

export function areaTone(id: string): string {
  if (!id || id === "other") return "var(--t3)";
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AREA_TONES[h % AREA_TONES.length];
}

/** A colour laid thinly over a surface: a fill that names the type without shouting. */
export function tint(tone: string, pct = 14, over = "var(--bg-2)"): string {
  return `color-mix(in srgb, ${tone} ${pct}%, ${over})`;
}

/** The order an Area fans out in — the plan's: what people defined and certified first, then the rest. */
const FAN_ORDER: FanKind[] = ["metric", "definition", "certified", "learned", "trusted_query", "dashboard", "canvas",
  "agent", "document", "sheet", "schedule", "table"];

/** What a review row is, in the plan's words (§3.4) — by where it came from; the order the filters are offered in. */
export const REVIEW_WORDS: [string, string[]][] = [
  ["New Definition", ["new_definition"]], ["Gap", ["framing_miss", "unanswered"]], ["Definition edit", ["definition_edit"]],
  ["Conflict", ["rival_meanings", "divergence"]], ["Thumbs-down", ["verdict", "unhelpful"]], ["To confirm", ["finding", "usage"]],
  ["Draft", ["definition_draft"]], ["Suggested edit", ["definition_suggestion"]], ["Synonym", ["synonym"]], ["Import", ["import"]],
  ["Not reached", ["eval_failed"]],
  ["Suggested Area", ["suggested_area"]],
];

/** A review row's word: its source's, or its kind's when the source is one this page does not know yet. */
export function reviewWord(source: string, kind: string): string {
  return REVIEW_WORDS.find(([, sources]) => sources.includes(source))?.[0] ?? kind.replace(/^./, (c) => c.toUpperCase());
}

/** The filters a review list offers: each word that has rows, with how many, in the plan's order. */
export function reviewFilters(bySource: Record<string, number>): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const [source, n] of Object.entries(bySource)) {
    const w = reviewWord(source, source);
    counts.set(w, (counts.get(w) ?? 0) + n);
  }
  const order = REVIEW_WORDS.map(([w]) => w);
  return [...counts].map(([word, count]) => ({ word, count }))
    .sort((a, b) => (order.indexOf(a.word) + 1 || 99) - (order.indexOf(b.word) + 1 || 99));
}

/** An Area's fan: each kind with a count, in the plan's order — a kind it holds none of is not drawn. */
export function fanOf(page: Pick<DiscoverAreaPage, "kinds">, learned: number | null): Fan[] {
  const counts = new Map<FanKind, number>(page.kinds.map((k) => [k.kind, k.count]));
  const certified = page.kinds.reduce((n, k) => n + k.items.filter((i) => i.certification?.status === "certified").length, 0);
  if (certified) counts.set("certified", certified);
  if (learned) counts.set("learned", learned);
  return FAN_ORDER.filter((k) => (counts.get(k) ?? 0) > 0).map((k) => {
    const n = counts.get(k) ?? 0;
    const words = k === "learned" ? "learned" : k === "certified" ? "certified"
      : KIND_WORDS[k][n === 1 ? 0 : 1];
    return { key: k, count: n, words: `${formatCount(n)} ${words}`, icon: k === "learned" ? "idea" : k === "certified" ? "certificate" : KIND_ICON[k],
      tone: KIND_TONE[k] };
  });
}

/** The things of one fan key, as its list shows them — a kind's own, or every certified thing. */
export function itemsOf(page: Pick<DiscoverAreaPage, "kinds">, key: FanKey): DiscoverItem[] {
  if (key === "learned") return [];
  if (key === "certified") return page.kinds.flatMap((k) => k.items.filter((i) => i.certification?.status === "certified"));
  return page.kinds.find((k) => k.kind === key)?.items ?? [];
}

/** A circle's place on the canvas, in pixels: its centre and radius. */
export interface Disc { x: number; y: number; r: number }
/** A count's place: its left edge's middle, its width and height. */
export interface Chip { x: number; y: number; w: number; h: number }

/** An opened Area, laid out to one side (the user, 2026-11-25, on a reference design: "how everything opens up — on one side of
 *  the bigger circle"): its parent, when it has one, a large circle on the left with the Area and its siblings in a
 *  column to its right; else the Area itself large on the left. What the Area holds stacks to its right, its sub-Areas
 *  below that — every line leaves the circle on the same side. In canvas pixels, the same every time. */
export interface OneSided { parent: Disc | null; siblings: Disc[]; chosen: Disc; chips: Chip[]; subs: Disc[] }

export const CHIP_W = 190;
export const CHIP_H = 34;
const CHIP_GAP = 10;
const SUB_R = 38;

export function oneSided(w: number, h: number, a: { parent: boolean; siblings: number; chosenAt: number; chips: number; subs: number }): OneSided {
  const mid = h / 2;
  let parent: Disc | null = null;
  let siblings: Disc[] = [];
  let chosen: Disc;
  if (a.parent) {
    parent = { x: w * 0.14, y: mid, r: Math.max(60, Math.min(h * 0.2, 120)) };
    const n = Math.max(1, a.siblings);
    const pitch = Math.min(132, (h - 60) / n);
    siblings = Array.from({ length: n }, (_, i) => ({
      x: w * 0.4, y: mid + (i - (n - 1) / 2) * pitch, r: i === a.chosenAt ? Math.min(64, pitch * 0.6) : Math.min(44, pitch * 0.42),
    }));
    chosen = siblings[Math.min(Math.max(0, a.chosenAt), n - 1)];
  } else {
    chosen = { x: w * 0.26, y: mid, r: Math.max(64, Math.min(h * 0.2, 110)) };
  }
  // what it holds, then its sub-Areas: one column to its right, centred on it, kept inside the canvas
  const left = chosen.x + chosen.r + 72;
  const chipsH = a.chips ? a.chips * (CHIP_H + CHIP_GAP) - CHIP_GAP : 0;
  const subsH = a.subs ? a.subs * (2 * SUB_R + CHIP_GAP) + (a.chips ? CHIP_GAP * 2 : 0) : 0;
  const top = Math.max(16, Math.min(h - 16 - chipsH - subsH, chosen.y - (chipsH + subsH) / 2));
  const chips = Array.from({ length: a.chips }, (_, i) => ({ x: left, y: top + i * (CHIP_H + CHIP_GAP) + CHIP_H / 2, w: CHIP_W, h: CHIP_H }));
  const subsTop = top + chipsH + (a.chips ? CHIP_GAP * 2 : 0);
  const subs = Array.from({ length: a.subs }, (_, i) => ({ x: left + SUB_R, y: subsTop + i * (2 * SUB_R + CHIP_GAP) + SUB_R, r: SUB_R }));
  return { parent, siblings, chosen, chips, subs };
}

/** A curve leaving a circle on its right and arriving at a point from the left — the same side, every time. */
export function curve(from: Disc, to: { x: number; y: number }): string {
  const x1 = from.x + from.r, y1 = from.y;
  const dx = Math.max(24, (to.x - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

/** ``n`` places on a ring of radius ``r`` around (0, 0), the first at the top, going clockwise — the same every time. */
export function ring(n: number, r: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
    return { x: Math.cos(a) * r * WIDE, y: Math.sin(a) * r };
  });
}
