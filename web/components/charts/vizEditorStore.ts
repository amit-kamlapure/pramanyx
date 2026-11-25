"use client";

/**
 * vizEditorStore — a tiny module-level store so the viz editor
 * (VizEditorPanel) is a SINGLE-INSTANCE right-docked drawer across the whole app.
 *
 * Every clean chart surface (ResultChartCard) owns its own control state and portals
 * its own <VizEditorPanel> to <body> only while it is the open one. This store holds
 * just the id of the card whose editor is open, so opening one pencil closes any other
 * — no provider to mount, no context to thread. Subscribed via useSyncExternalStore, so
 * a card re-renders exactly when it opens or closes.
 */

import { useSyncExternalStore } from "react";

let openId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function openVizEditor(id: string) {
  if (openId === id) return;
  openId = id;
  emit();
}

export function closeVizEditor(id?: string) {
  // A stale close (a card closing after another already opened) must not clobber the
  // newly-open one — only clear when we still own the slot (or an unconditional close).
  if (id != null && openId !== id) return;
  if (openId === null) return;
  openId = null;
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** The board study — a place in the page that holds one card's editor in itself (the dashboard builder's Chart tab),
 *  instead of the drawer: the card it serves, and the element it draws into. One at a time, like the drawer. */
let dock: { key: string; el: HTMLElement } | null = null;

export function setVizDock(next: { key: string; el: HTMLElement } | null) {
  if (dock?.key === next?.key && dock?.el === next?.el) return;
  dock = next;
  emit();
}

/** Let go of the dock — only when it still serves `key` (another may have taken it since). */
export function clearVizDock(key: string) {
  if (dock?.key !== key) return;
  dock = null;
  emit();
}

/** The element this card's editor draws into, when a dock serves it; null draws the drawer. */
export function useVizDock(id: string): HTMLElement | null {
  const get = () => (dock && dock.key === id ? dock.el : null);
  return useSyncExternalStore(subscribe, get, () => null);
}

/** True when THIS card's viz editor is the one currently open. */
export function useVizEditorOpen(id: string): boolean {
  const get = () => openId === id;
  // Server snapshot is always closed (the drawer is client-only).
  return useSyncExternalStore(subscribe, get, () => false);
}
