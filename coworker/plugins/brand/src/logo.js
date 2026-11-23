/**
 * Pramanyx's mark and name, drawn from the one artwork (`web/components/ui/brandArt.ts`), for the coworker's page: the
 * sidebar's slots and the bar across its top (`home`, `TopBar`) draw them from here, as the platform draws them from
 * `web/components/ui/brand.tsx`.
 */
import { createElement as h, useId } from "react";
import {
  MARK_BOX, MARK_LINE, MARK_RING, MARK_RING_COLORS, NAME_BAR, NAME_BAR_STOPS, NAME_BASELINE, NAME_BOX, NAME_LETTERS,
} from "../../../../web/components/ui/brandArt";

const NAME = "Pramanyx";

/** The ring, one colour a step round its circle, each step just over its neighbour so no seam shows. */
const RING = MARK_RING_COLORS.map((fill, i) => {
  const { cx, cy, outer: [ox, oy], inner: [ix, iy] } = MARK_RING;
  const at = (step) => (step / MARK_RING_COLORS.length) * 2 * Math.PI;
  const [a, b] = [at(i - 0.15), at(i + 1.15)];
  const p = (angle, rx, ry) => `${(cx + rx * Math.cos(angle)).toFixed(1)} ${(cy + ry * Math.sin(angle)).toFixed(1)}`;
  return { fill, d: `M${p(a, ox, oy)}A${ox} ${oy} 0 0 1 ${p(b, ox, oy)}L${p(b, ix, iy)}A${ix} ${iy} 0 0 0 ${p(a, ix, iy)}Z` };
});

function MarkArt({ width, height }) {
  return h("svg", { width, height, viewBox: `0 0 ${MARK_BOX.w} ${MARK_BOX.h}`, role: "img", "aria-label": NAME },
    h("path", { d: MARK_LINE, fill: "currentColor", fillRule: "evenodd" }),
    RING.map((w, i) => h("path", { key: i, d: w.d, fill: w.fill })));
}

/** The mark, fitted inside the square the shell asks for: its outer line in the text's colour, around the ring. */
export function Mark({ size, className }) {
  return h("span", { className, style: { display: "inline-flex", width: size, height: size, alignItems: "center", justifyContent: "center" } },
    h(MarkArt, { width: size, height: Math.round(size * MARK_BOX.h / MARK_BOX.w) }));
}

/** The name, `height` tall, in the text's colour with the logo's bar over its ā. */
export function Name({ height = 15 }) {
  const id = `pramanyx-name-bar-${useId().replace(/:/g, "")}`;
  return h("svg", { width: Math.round(height * NAME_BOX.w / NAME_BOX.h), height, viewBox: `0 0 ${NAME_BOX.w} ${NAME_BOX.h}`, role: "img", "aria-label": NAME },
    h("defs", null, h("linearGradient", { id }, NAME_BAR_STOPS.map(([offset, stopColor]) => h("stop", { key: offset, offset, stopColor })))),
    h("path", { d: NAME_LETTERS, fill: "currentColor", fillRule: "evenodd" }),
    h("rect", { x: NAME_BAR.x, y: NAME_BAR.y, width: NAME_BAR.w, height: NAME_BAR.h, fill: `url(#${id})` }));
}

/** The mark and the name as one logo, `height` tall, the mark standing on the name's baseline — the platform's
 *  `PramanyxLogo`, at the same measures. */
export function Logo({ height = 18, gap = 7 }) {
  const foot = (height * (NAME_BOX.h - NAME_BASELINE)) / NAME_BOX.h;
  return h("span", { style: { display: "inline-flex", alignItems: "flex-end", gap } },
    h("span", { style: { display: "inline-flex", marginBottom: Number(foot.toFixed(2)) } },
      h(MarkArt, { width: Math.round((height * MARK_BOX.w) / MARK_BOX.h), height })),
    h(Name, { height }));
}
