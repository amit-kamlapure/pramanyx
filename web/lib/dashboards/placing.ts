/**
 * A piece placed as a box first (the user, 2026-11-19, of a peer product's editor: "whenever I try to add a chart, picture,
 * filter from the bottom strip while editing a dashboard, I should be able to place a box (relevant size depending on which
 * element Im tyring to add) and then I choose what kind of chart, filter or text or picture"). The strip's tool picks the
 * box up at its kind's size; a click on the canvas sets it down on the grid; what it is, is chosen after, in the panel,
 * and the piece made is drawn in the box, where it was set down.
 */
import { GRADE, GRID, LIMITS } from "@/lib/dashboards/catalog";
import { regrid, type Box, type DashboardSpec } from "@/lib/dashboards/edit";

export type PlaceKind = "chart" | "filter" | "text" | "image";

/** Each kind's box as it is picked up: a chart half the width, a filter a slim box, words across the page, a picture. */
export const PLACE_SIZE: Record<PlaceKind, { w: number; h: number }> = {
  chart: { w: 6, h: 8 }, filter: { w: 4, h: 2 }, text: { w: 12, h: 2 }, image: { w: 4, h: 6 },
};

/** What each box is called while it waits for what it is. */
export const PLACE_WORDS: Record<PlaceKind, string> = { chart: "A chart", filter: "A filter", text: "Words", image: "A picture" };

/** A box set down: its kind, the section it is in, its place and room on the grid, and what the section held where, so a
 *  section not yet on the grid keeps every piece's room as it moves onto it. */
export interface PlacedBox { kind: PlaceKind; section: string; x: number; y: number; w: number; h: number; measured: Record<string, Box> }

/** The cell under the pointer for a box of `size`, in a section drawn at `rect` (its on-screen box) whose own width is
 *  `layoutWidth` (the canvas may draw the dashboard scaled): the column and row its top left corner takes, held so the box
 *  stays within the twelve columns. */
export function cellOf(rect: { left: number; top: number; width: number }, layoutWidth: number, px: number, py: number,
  size: { w: number; h: number }): { x: number; y: number } {
  const scale = layoutWidth > 0 ? rect.width / layoutWidth : 1;
  const pitchX = (rect.width + GRID.gap * scale) / GRID.columns;
  const pitchY = GRADE * scale;
  const col = Math.floor((px - rect.left) / (pitchX || 1)) + 1;
  const row = Math.floor((py - rect.top) / (pitchY || 1)) + 1;
  return { x: Math.min(Math.max(1, col), GRID.columns - Math.min(size.w, GRID.columns) + 1), y: Math.max(1, row) };
}

/** Where a box goes so it covers no piece already there: its own column, and — where it would cover one — the first rows
 *  below what it would cover. A new box takes the room left; it never moves what a person already placed. */
export function freeSpot(box: { x: number; y: number; w: number; h: number }, others: Box[]): { x: number; y: number } {
  let y = box.y;
  for (let guard = 0; guard < 500; guard++) {
    const hit = others.filter(o => o.x !== undefined && o.y !== undefined
      && o.x < box.x + box.w && box.x < o.x + o.w && o.y < y + box.h && y < o.y + o.h);
    if (!hit.length) break;
    y = Math.max(...hit.map(o => (o.y as number) + o.h));
  }
  return { x: box.x, y };
}

/** The newest piece a change put in a section that was not there before, or null. */
export function madeIn(before: DashboardSpec, after: DashboardSpec, section: string): string | null {
  const was = new Set(before.elements[section]?.children ?? []);
  return (after.elements[section]?.children ?? []).filter(k => !was.has(k) && (after.elements[k]?.type ?? "") in LIMITS).at(-1) ?? null;
}

/** The piece a change made, set in the box: the newest element the change put in the box's section, moved to the box's
 *  place and room. Null when the change made nothing there — it was another change, and the box still waits. */
export function intoBox(before: DashboardSpec, after: DashboardSpec, box: PlacedBox): DashboardSpec | null {
  const key = madeIn(before, after, box.section);
  if (!key) return null;
  const at = freeSpot(box, Object.values(box.measured));
  return regrid(after, key, { x: at.x, y: at.y, w: box.w, h: box.h }, box.measured);
}

/** What every element of a section measures on screen, as columns (twelfths of the section) and rows of one grade —
 *  so a section moving onto the grid keeps the room each element had for the reader (Arc AP-1). */
export function measureSection(grid: HTMLElement): Record<string, Box> {
  const colW = (grid.clientWidth - GRID.gap * (GRID.columns - 1)) / GRID.columns;
  const out: Record<string, Box> = {};
  if (colW <= 0) return out;
  for (const child of Array.from(grid.children) as HTMLElement[]) {
    const key = child.dataset.element;
    // the layout's own px — the builder's canvas may draw the dashboard scaled, and the grid is laid out unscaled
    const r = { width: child.offsetWidth, height: child.offsetHeight };
    if (!key || !r.width || !r.height) continue;
    out[key] = {
      w: Math.round((r.width + GRID.gap) / (colW + GRID.gap)), h: Math.round((r.height + GRID.gap) / GRADE),
      // where it is drawn, on the twelve columns and the 40 px rows (free placement, v14)
      x: Math.max(1, Math.round(child.offsetLeft / (colW + GRID.gap)) + 1), y: Math.max(1, Math.round(child.offsetTop / GRADE) + 1),
    };
  }
  return out;
}
