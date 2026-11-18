"use client";

/**
 * Pramanyx's mark and its colours (the user, 2026-11-18: "see how you incorporate the color elements across the platform too.. not
 * too flashy"). The colours belong to the ring in the mark and the bar over its ā. Beyond the logo they mark one thing: where a person
 * talks to the model. They stay thin, an edge or a small icon, and never fill a surface, a button or a chart.
 */
import { useId, type CSSProperties } from "react";

export const BRAND = { pink: "#FF2E8B", magenta: "#D926F5", blue: "#3A86FF", cyan: "#00DCFF" } as const;

const STOPS = `${BRAND.pink} 0%, ${BRAND.magenta} 38%, ${BRAND.blue} 72%, ${BRAND.cyan} 100%`;
export const BRAND_GRADIENT = `linear-gradient(115deg, ${STOPS})`;

/** A thin edge in the brand's colours around a surface of the given ground. */
export function brandEdge(ground: string, width = 1.5): CSSProperties {
  return { border: `${width}px solid transparent`, background: `linear-gradient(${ground}, ${ground}) padding-box, ${BRAND_GRADIENT} border-box` };
}

function Stops() {
  return (
    <>
      <stop offset="0%" stopColor={BRAND.pink} /><stop offset="38%" stopColor={BRAND.magenta} />
      <stop offset="72%" stopColor={BRAND.blue} /><stop offset="100%" stopColor={BRAND.cyan} />
    </>
  );
}

/** The mark's outer line: a circle with eight soft lobes. */
const SCALLOP = `${Array.from({ length: 160 }, (_, i) => {
  const a = (i / 160) * 2 * Math.PI;
  const r = 41 + 2.6 * Math.cos(8 * a);
  return `${i ? "L" : "M"}${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
}).join("")}Z`;

/** The mark: its outer line in the text's colour, so it reads on either theme, around the ring in the brand's colours. */
export function PramanyxMark({ size = 20, label }: { size?: number; label?: string }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ flex: "none" }}>
      <defs><linearGradient id={id} x1="0.05" y1="0.2" x2="0.75" y2="1"><Stops /></linearGradient></defs>
      <path d={SCALLOP} stroke="currentColor" strokeWidth="7" strokeLinejoin="round" />
      <circle cx="50" cy="50" r="22" stroke={`url(#${id})`} strokeWidth="7" />
    </svg>
  );
}

/** The name as the logo writes it: a short bar in the brand's colours over its ā. */
export function PramanyxName() {
  return (
    <span aria-label="Pramanyx" role="img" style={{ whiteSpace: "nowrap" }}>
      <span aria-hidden="true">Pram<span style={{ position: "relative", display: "inline-block" }}>a
        <span style={{ position: "absolute", left: "6%", right: "6%", top: "0.04em", height: "0.13em", background: BRAND_GRADIENT }} />
      </span>nyx</span>
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
