"use client";

/**
 * A panel's edge a person drags — or moves with the arrow keys — to make the panel wider or narrower, the width kept for
 * that person in this browser (the user, 2026-11-26: "Keep the left panel also adjustable", beside the side panel that
 * already was). One grip for every adjustable panel: the Areas' left panel and the shell's side panel on the right.
 *
 * Its look is set on the element itself, not in `globals.css`, so it never depends on a stylesheet the dev server has
 * yet to rebuild.
 */
import { useCallback, useState, type CSSProperties } from "react";

/** A width kept per viewer under `key`, within `min`–`max`; `def` until one is kept (or when storage is unreadable). */
export function useKeptWidth(key: string, def: number, min: number, max: number): [number, (w: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const raw = typeof window === "undefined" ? NaN : Number(window.localStorage.getItem(key));
      return raw >= min && raw <= max ? raw : def;
    } catch {
      return def;
    }
  });
  const keep = useCallback((w: number) => {
    const next = Math.min(max, Math.max(min, Math.round(w)));
    setWidth(next);
    try { window.localStorage.setItem(key, String(next)); } catch { /* a per-viewer convenience only */ }
  }, [key, min, max]);
  return [width, keep];
}

const STEP = 16;

/** The grip, on the panel's `edge` — "right" for a panel on the left of the page (dragging right widens it), "left" for
 *  one on the right. Its parent must be positioned. */
export function ResizeGrip({ edge, width, min, max, onWidth, label }: {
  edge: "left" | "right"; width: number; min: number; max: number; onWidth: (w: number) => void; label: string;
}) {
  const sign = edge === "right" ? 1 : -1;
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    const move = (ev: PointerEvent) => onWidth(w0 + sign * (ev.clientX - x0));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const style: CSSProperties = { position: "absolute", top: 0, bottom: 0, [edge]: -3, width: 6, cursor: "col-resize", zIndex: 3,
    display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none" };
  return (
    <div role="separator" aria-orientation="vertical" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
      tabIndex={0} title="Drag to resize · ← → with the keyboard" style={style} onPointerDown={start}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); onWidth(width + sign * STEP); }
        if (e.key === "ArrowLeft") { e.preventDefault(); onWidth(width - sign * STEP); }
      }}>
      <span aria-hidden style={{ width: 2, height: 28, borderRadius: 1, background: "var(--b2)" }} />
    </div>
  );
}
