/** A box being placed, or set down and waiting for what it is (`lib/dashboards/placing.ts`), as the builder shows it to the
 *  sections it draws — kept apart from the dashboard's own drawing, so the builder reads it without the dashboard. */
import { createContext } from "react";

import type { PlaceKind } from "@/lib/dashboards/placing";

export interface PlacementView {
  ghost: { section: string; x: number; y: number; w: number; h: number; kind: PlaceKind } | null;
  box: { section: string; x: number; y: number; w: number; h: number; kind: PlaceKind } | null;
  /** A click on the box set down: its setup, in the panel. */
  onBox?: () => void;
}

export const PlacementShown = createContext<PlacementView | null>(null);
