"use client";

/**
 * Pramanyx's mark and its colours (the user, 2026-11-18: "see how you incorporate the color elements across the platform too.. not
 * too flashy"). The shapes and colours are the supplied artwork's (`brandArt.ts`). Beyond the logo the colours mark one thing: where a
 * person talks to the model. They stay thin, an edge or a small icon, and never fill a surface, a button or a chart.
 */
import { useId, type CSSProperties } from "react";

import { MARK_BOX, MARK_LINE, MARK_RING, MARK_RING_COLORS, NAME_BAR, NAME_BAR_STOPS, NAME_BASELINE, NAME_BOX, NAME_LETTERS } from "@/components/ui/brandArt";

const STOPS = NAME_BAR_STOPS.map(([at, colour]) => `${colour} ${at * 100}%`).join(", ");
export const BRAND_GRADIENT = `linear-gradient(115deg, ${STOPS})`;

/** The bar over the logo's ā, stood on end: what marks the page open in the rail. */
export function BrandBar() {
  return <span aria-hidden="true" data-testid="brand-bar" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, zIndex: 1, background: `linear-gradient(180deg, ${STOPS})` }} />;
}

/** A thin edge in the brand's colours around a surface of the given ground. */
export function brandEdge(ground: string, width = 1.5): CSSProperties {
  return { border: `${width}px solid transparent`, background: `linear-gradient(${ground}, ${ground}) padding-box, ${BRAND_GRADIENT} border-box` };
}

function Stops() {
  return <>{NAME_BAR_STOPS.map(([at, colour]) => <stop key={at} offset={at} stopColor={colour} />)}</>;
}

/** The ring, one colour a step round its circle, each step just over its neighbour so no seam shows. */
const RING = MARK_RING_COLORS.map((fill, i) => {
  const { cx, cy, outer: [ox, oy], inner: [ix, iy] } = MARK_RING;
  const at = (step: number) => (step / MARK_RING_COLORS.length) * 2 * Math.PI;
  const [a, b] = [at(i - 0.15), at(i + 1.15)];
  const p = (angle: number, rx: number, ry: number) => `${(cx + rx * Math.cos(angle)).toFixed(1)} ${(cy + ry * Math.sin(angle)).toFixed(1)}`;
  return { fill, d: `M${p(a, ox, oy)}A${ox} ${oy} 0 0 1 ${p(b, ox, oy)}L${p(b, ix, iy)}A${ix} ${iy} 0 0 0 ${p(a, ix, iy)}Z` };
});

/** The mark, `size` tall: its outer line in the text's colour, so it reads on either theme, around the ring. */
export function PramanyxMark({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <svg width={Math.round((size * MARK_BOX.w) / MARK_BOX.h)} height={size} viewBox={`0 0 ${MARK_BOX.w} ${MARK_BOX.h}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ flex: "none" }}>
      <path d={MARK_LINE} fill="currentColor" fillRule="evenodd" />
      {RING.map((w, i) => <path key={i} data-testid="brand-ring" d={w.d} fill={w.fill} />)}
    </svg>
  );
}

/** The name as the logo writes it, `height` tall from the bar over its ā to the foot of its y. */
export function PramanyxName({ height = 16 }: { height?: number }) {
  const id = useId();
  return (
    <svg width={Math.round((height * NAME_BOX.w) / NAME_BOX.h)} height={height} viewBox={`0 0 ${NAME_BOX.w} ${NAME_BOX.h}`} role="img" aria-label="Pramanyx" style={{ flex: "none" }}>
      <defs><linearGradient id={id}><Stops /></linearGradient></defs>
      <path d={NAME_LETTERS} fill="currentColor" fillRule="evenodd" />
      <rect x={NAME_BAR.x} y={NAME_BAR.y} width={NAME_BAR.w} height={NAME_BAR.h} fill={`url(#${id})`} />
    </svg>
  );
}

/** The mark and the name as one logo, `height` tall from the bar over the ā to the foot of the y. The mark is as tall as the
 *  name and stands on its baseline, where the letters stand, not centred on a box the y's tail makes deeper (the user,
 *  2026-11-19: "the logo and the text must have the same base line"). */
export function PramanyxLogo({ height = 18, gap = 7 }: { height?: number; gap?: number }) {
  const foot = (height * (NAME_BOX.h - NAME_BASELINE)) / NAME_BOX.h;
  return (
    <span data-testid="brand-logo" style={{ display: "inline-flex", alignItems: "flex-end", gap }}>
      <span data-testid="brand-logo-mark" style={{ display: "inline-flex", marginBottom: Number(foot.toFixed(2)) }}><PramanyxMark size={height} /></span>
      <PramanyxName height={height} />
    </span>
  );
}

/** The small star that marks where the model is asked. */
export function BrandSpark({ size = 16 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "none" }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><Stops /></linearGradient></defs>
      <path fill={`url(#${id})`} d="M12 2c.7 5.6 3.9 9 10 10-6.100 1-9.300 4.400-10 10-.7-5.600-3.900-9-10-10 6.100-1 9.300-4.400 10-10z" />
    </svg>
  );
}
