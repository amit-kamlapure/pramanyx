"use client";

/**
 * The sheet on screen's own doors, for the Ask panel beside it (Stage 1, the user, 2026-11-19: one conversation across
 * pages; the sheet's own chat folds into the panel). An answer about the sheet offers its rows to see in the grid or to
 * keep as a view, and a change applied there reads the sheet again: the panel cannot do either itself, so the sheet page
 * says here what it does, while it is open, and takes it back as it closes.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

import type { SheetRowsRef } from "@/lib/chatTurn";
import type { Sheet } from "@/lib/sheets";

export interface SheetActions {
  /** The rows an answer is about, on the grid as the person's own until they keep them. */
  showRows: (r: SheetRowsRef) => void;
  /** The same rows kept as a view of the answer's name — true when it was kept. */
  keepRows: (r: SheetRowsRef) => Promise<boolean>;
  /** A change was applied: the sheet is read again. */
  applied: () => void;
  /** A view a change made, opened by its name. */
  openView: (name: string) => void;
  /** Another sheet opened — the one a file was made into. */
  openSheet: (id: string) => void;
}

export interface SheetDoors extends SheetActions {
  sheetId: string;
  /** The sheet as the page holds it: its name, columns and rules, to say an answer's rows in the grid's words. */
  sheet: Sheet;
  viewId: string;
  /** The rows the view on screen holds, so what the chat reads is said again when they change. */
  viewRows: number | null;
}

let current: SheetDoors | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

/** The sheet page says what it does while it is open: its sheet, the view on screen, and its actions. */
export function useSheetDoorsHere(sheet: Sheet | null, viewId: string, viewRows: number | null, actions: SheetActions): void {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    if (!sheet) return;
    // the actions read the page as it is when they are used, not as it was when it opened
    const held: SheetDoors = {
      sheetId: sheet.id, sheet, viewId, viewRows,
      showRows: r => latest.current.showRows(r),
      keepRows: r => latest.current.keepRows(r),
      applied: () => latest.current.applied(),
      openView: name => latest.current.openView(name),
      openSheet: id => latest.current.openSheet(id),
    };
    current = held;
    emit();
    return () => { if (current === held) { current = null; emit(); } };
  }, [sheet, viewId, viewRows]);
}

/** The doors of `sheetId` while it is on screen; null when another sheet, or none, is. */
export function useSheetDoors(sheetId: string | null | undefined): SheetDoors | null {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => (sheetId && current?.sheetId === sheetId ? current : null),
    () => null,
  );
}

// ── the Spreadsheets home (2026-11-20: its "In the chat" opens the Ask panel, not a small panel of its own) ──

/** What the Spreadsheets home lends the Ask panel while it is open: a sheet made from a file there opens here. */
export interface SheetsHomeDoors { openSheet: (id: string) => void }
let home: SheetsHomeDoors | null = null;
const homeListeners = new Set<() => void>();

/** The Spreadsheets home says it is open: in the Ask panel a file dropped or attached becomes a proposal for a new sheet. */
export function useSheetsHomeHere(openSheet: (id: string) => void): void {
  const latest = useRef(openSheet);
  latest.current = openSheet;
  useEffect(() => {
    const held: SheetsHomeDoors = { openSheet: id => latest.current(id) };
    home = held;
    homeListeners.forEach(l => l());
    return () => { if (home === held) { home = null; homeListeners.forEach(l => l()); } };
  }, []);
}

export function useSheetsHome(): SheetsHomeDoors | null {
  return useSyncExternalStore(
    l => { homeListeners.add(l); return () => { homeListeners.delete(l); }; },
    () => home,
    () => null,
  );
}
