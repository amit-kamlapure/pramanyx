"use client";

/**
 * A chart's editor as a tab of the side panel (the user, 2026-11-25, of the coworker: "the visualisations editor opens
 * up" in the right panel, a tab among what is open). The tab is a dock (`vizEditorStore.setVizDock`): while it is in
 * front, the chart's own editor draws into it — the chart keeps its state, the tab only holds the place. Put behind
 * another tab, or closed, it lets the editor go; brought forward, it opens it again.
 */
import { useEffect, useRef } from "react";

import type { InspectorSubject } from "@/components/shell/Inspector";
import { clearVizDock, closeVizEditor, openVizEditor, setVizDock } from "@/components/charts/vizEditorStore";

/** One editor tab at a time, as one editor is open at a time: another chart's pencil takes the same tab. */
export const VIZ_TAB = "viz-editor";

export function VizDock({ cardId, title }: { cardId: string; title?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setVizDock({ key: cardId, el });
    openVizEditor(cardId);
    return () => { closeVizEditor(cardId); clearVizDock(cardId); };
  }, [cardId]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      {/* the tab says "Edit visualization"; under it, which chart (as the coworker's tab opens on its chart's line) */}
      {title && <div className="aug-fs-sm" style={{ color: "var(--t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={title}>{title}</div>}
      <div ref={ref} data-testid="viz-dock" style={{ display: "flex", flexDirection: "column", minWidth: 0 }} />
    </div>
  );
}

/** The side panel's tab for a chart's editor. */
export function vizSubject(cardId: string, title?: string): InspectorSubject {
  return { key: VIZ_TAB, kind: "Visualization", title: "Edit visualization", icon: "chart", bare: true,
    tabs: { overview: <VizDock key={cardId} cardId={cardId} title={title} /> } };
}
