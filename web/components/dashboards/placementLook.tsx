"use client";

/**
 * A placed card's own look (dashboard format v16; study R8, R9): a title in place of the card's, whether it shows, a
 * description under it, and how its numbers are written. Given where a Card is drawn (`ComposedDashboard.tsx`) and
 * read by the tile's title and figures, so every kind of tile follows its placement without each being told. Off a
 * dashboard — a piece, a card standing alone — nothing is set and every tile reads as it always did.
 */
import { createContext, useContext } from "react";
import { lookOf, type NumberLook } from "@/lib/dashboards/numberLook";
import { looksOf, type ColumnLooks } from "@/lib/dashboards/columnLook";
import type { ValueColors } from "@/lib/dashboards/valueColors";

export interface PlacementLook {
  /** This placement's title; null is the card's own. */
  title: string | null;
  showTitle: boolean;
  description: string | null;
  number: NumberLook | null;
  /** v17 — the number columns of its table drawn as a bar or a colour scale. */
  columns: ColumnLooks | null;
}

export const NO_LOOK: PlacementLook = { title: null, showTitle: true, description: null, number: null, columns: null };

const Look = createContext<PlacementLook>(NO_LOOK);
export const PlacementLookProvider = Look.Provider;

export function usePlacementLook(): PlacementLook {
  return useContext(Look);
}

/** A Card element's look, from its props. */
export function placementLookOf(props: Record<string, unknown> | null | undefined): PlacementLook {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    title: text(props?.title),
    showTitle: props?.show_title !== false,
    description: text(props?.description),
    number: lookOf(props),
    columns: looksOf(props),
  };
}

/** v17 — the dashboard's kept colours for values, for every card on it (`lib/dashboards/valueColors.ts`). */
const Colors = createContext<ValueColors | null>(null);
export const ValueColorsProvider = Colors.Provider;

export function useValueColors(): ValueColors | null {
  return useContext(Colors);
}
