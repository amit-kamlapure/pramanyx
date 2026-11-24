/**
 * Where Discover is shown, and what its rows do there (D6, 2026-11-24). Inside the app — the default, no host — a row
 * opens its thing's page in place and "Ask about it" opens the Ask panel on it. On a page of its own in the coworker's
 * main area, a row opens the thing in the app, in a browser tab of its own, and "Ask about it" begins a question in the
 * coworker's conversation, never sending it: the coworker is the host, and these are its doors.
 */
import { createContext, useContext } from "react";

import type { DiscoverItem } from "@/lib/discover";

export interface DiscoverHostDoors {
  /** Open a thing's page, given its address inside the app (`/?tab=…`). */
  open: (href: string) => void;
  /** Begin a question about a thing; absent where nothing can take one. */
  ask?: (item: DiscoverItem) => void;
}

export const DiscoverHost = createContext<DiscoverHostDoors | null>(null);

export function useDiscoverHost(): DiscoverHostDoors | null {
  return useContext(DiscoverHost);
}

/** The words a question about a thing begins with, for the person to finish. */
export function askWords(item: DiscoverItem, kindWord: string): string {
  return `About the ${kindWord.toLowerCase()} “${item.name}”${item.connection_name ? ` on ${item.connection_name}` : ""}: `;
}

/** A shell that may be told to begin a question: one on this machine, as the coworker is served. */
export function shellOrigin(said: string | null | undefined): string | null {
  const s = String(said ?? "");
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(s) ? s : null;
}
