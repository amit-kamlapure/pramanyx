"use client";

/**
 * A map answer in the app: the map the coworker draws, on the organisation's base map, that a person can pan and zoom. When the
 * rows have no honest map, `fallback` is drawn instead.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { drawAnswerMap, mapHost } from "@/components/charts/geo/mapDrawing";
import { SHAPES } from "@/components/charts/geo/places";
import { readVegaTokens } from "@/components/charts/vega/config";
import { watchTheme } from "@/components/charts/vega/themeWatch";
import { getApiBase } from "@/lib/config";

const HOST = mapHost({ files: "/map-files", baseUrl: () => `${getApiBase()}/org-settings/base-map`, shapeUrl: set => SHAPES[set].url });

export function AnswerMap({ columns, rows, kind, columnUnits, fallback }: {
  columns: string[];
  rows: unknown[][];
  kind: "points" | "shapes";
  columnUnits?: Record<string, string> | null;
  fallback: ReactNode;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [noMap, setNoMap] = useState(false);
  // drawn again in the page's colours when it turns light or dark (`themeWatch.ts`)
  const [turned, setTurned] = useState(0);
  useEffect(() => watchTheme(() => setTurned((n) => n + 1)), []);
  useEffect(() => {
    if (!box.current) return;
    const t = readVegaTokens(box.current);
    const remove = drawAnswerMap(box.current, { columns, rows, kind, column_units: columnUnits ?? null },
      { palette: t.palette, t1: t.t1, t3: t.t3, surface: t.surface, font: t.font, small: "var(--aug-fs-sm)" }, HOST);
    if (!remove) setNoMap(true);
    return remove ?? undefined;
  }, [columns, rows, kind, columnUnits, turned]);
  if (noMap) return <>{fallback}</>;
  return <div ref={box} data-testid="answer-map" />;
}
