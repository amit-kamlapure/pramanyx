/**
 * PENDING item 9 — the company-brain map, shaped for the screen: every store behind what the platform knows, counted.
 * A page of its own until 2026-11-25, its picture's arrows drawn between boxes; now a part of the Atlas's Overview
 * (`components/ontology/AtlasKnows.tsx`), where each measured link is its sentence. Pure: the Atlas renders what these
 * return, and the tests assert on them.
 */
import type { BrainBox, BrainEdge, BrainFact, BrainMap } from "@/lib/api";
import { formatCount, formatPercent } from "@/lib/format";

export interface VaultColumn { id: BrainBox["vault"]; title: string; boxes: BrainBox[] }

/** The boxes grouped into their vaults, in the order the server gives both. */
export function vaultColumns(map: BrainMap): VaultColumn[] {
  return map.vaults.map((v) => ({ ...v, boxes: map.boxes.filter((b) => b.vault === v.id) }));
}

/** A box's number as it reads: a share as a percent, a count with separators, and an em dash
 *  when the store could not be read — its `line` says why. */
export function boxFigure(box: BrainBox): string {
  if (box.count === null || box.count === undefined) return "—";
  if (box.id === "visibility") return formatPercent(box.count, 0);
  return formatCount(box.count);
}

/** Each measured arrow as one sentence, naming both ends by their titles. */
export function edgeLines(map: BrainMap): string[] {
  return map.edges.map((e) => edgeSentence(map, e));
}

function edgeSentence(map: BrainMap, e: BrainEdge): string {
  const title = (id: string) => map.boxes.find((b) => b.id === id)?.title ?? id;
  return `${title(e.from)} → ${title(e.to)}: ${formatCount(e.count)} ${e.label}`;
}

/** CB-1's owed screen: the facts that changed since first seen, each with what it replaced. */
export function recentFacts(map: BrainMap): {
  id: string; label: string; kind: string; changed: string; replaced: string; reason: string;
}[] {
  const facts = (map.boxes.find((b) => b.id === "facts")?.detail?.recent ?? []) as BrainFact[];
  return facts.map((f) => {
    const last = f.history[f.history.length - 1];
    const was = last?.facts
      ? Object.values(last.facts)
        .map((v) => (Array.isArray(v) ? v.join(", ") : v))
        .filter((v) => v !== null && v !== undefined && v !== "")
        .join(" · ")
      : "";
    return { id: f.id, label: f.label || f.id, kind: f.kind, changed: (f.last_changed || "").slice(0, 10),
             replaced: was || last?.summary || "", reason: last?.reason ?? "" };
  });
}
