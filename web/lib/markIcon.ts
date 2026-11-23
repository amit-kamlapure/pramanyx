/**
 * The tab's icon: the mark in one colour on nothing, as the coworker's tab draws it (the user, 2026-11-23, of the two
 * tabs side by side: "The right one is harness which look great on the tab as icon.. left is not cool.. can we both the
 * same"). Dark for a light browser and light for a dark one — the coworker's two colours (`coworker/plugins/brand`,
 * `markTheTab`) — and the mark centred on a square at the same 60-of-64 width. Drawn from the one artwork
 * (`components/ui/brandArt.ts`): the outline, and the ring as a band, both in the one colour. Served at `/mark.svg`.
 */
import { MARK_BOX, MARK_LINE, MARK_RING } from "@/components/ui/brandArt";

/** An ellipse as a closed path, for the ring's two edges (filled even-odd, they make the band). */
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;

export function markIcon(): string {
  const { cx, cy, outer: [ox, oy], inner: [ix, iy] } = MARK_RING;
  const side = (MARK_BOX.w * 64) / 60;
  const x = -(side - MARK_BOX.w) / 2, y = -(side - MARK_BOX.h) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x.toFixed(1)} ${y.toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}">`
    + `<style>path{fill:#111113}@media (prefers-color-scheme:dark){path{fill:#edeef0}}</style>`
    + `<path fill-rule="evenodd" d="${MARK_LINE}"/>`
    + `<path fill-rule="evenodd" d="${ellipse(cx, cy, ox, oy)}${ellipse(cx, cy, ix, iy)}"/>`
    + `</svg>`;
}
