/**
 * A link into one thing inside the app — a table in the Catalog, a metric in the Semantic Layer, a spreadsheet, a custom
 * agent, a schedule, a document, a trusted query, a dashboard, a canvas (Discover's items link to each,
 * `pramanyx/discover/items.py`) — and how the page that holds the thing finds it.
 *
 * A link's words ride the address. The page reads them when it mounts AND when a link names them while it is already
 * open (the shell keeps pages mounted behind other tabs, so "read on mount" alone missed every link but the first —
 * the user, 2026-11-23: it must connect "in a very robust manner"). Read once and taken off the address, so the next
 * visit to the page opens it as it opens, not on the same thing again.
 *
 * The first word is the link's key (`table`, `metric`, `sheet`…); the rest qualify it (`schema`). Nothing is taken
 * unless the key is there, so one page never takes another link's qualifier.
 */
import { useEffect, useRef } from "react";

import { requestTab } from "@/lib/navigate";

/** Said when a link in the app has put its words on the address; `words` names them, so only a page they are for reads. */
export const ADDRESS_EVENT = "pramanyx:address";
interface AddressDetail { words: string[] }

export function takeFromAddress(...names: string[]): Record<string, string> {
  if (typeof window === "undefined" || !names.length) return {};
  const u = new URL(window.location.href);
  if (!u.searchParams.get(names[0])) return {};
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = u.searchParams.get(name);
    if (value) {
      out[name] = value;
      u.searchParams.delete(name);
    }
  }
  window.history.replaceState(window.history.state, "", u);
  return out;
}

/** Read a link's words when the page mounts, and again whenever a link in the app names them while it is open.
 *  `names[0]` is the key; `onFound` gets every word the link carried. */
export function useFromAddress(names: readonly string[], onFound: (found: Record<string, string>) => void): void {
  const latest = useRef(onFound);
  latest.current = onFound;
  const key = names.join(",");
  useEffect(() => {
    const wanted = key.split(",");
    const read = () => {
      const found = takeFromAddress(...wanted);
      if (Object.keys(found).length) latest.current(found);
    };
    read();
    const onAddress = (e: Event) => {
      const words = (e as CustomEvent<AddressDetail>).detail?.words ?? [];
      if (words.includes(wanted[0])) read();
    };
    window.addEventListener(ADDRESS_EVENT, onAddress);
    return () => window.removeEventListener(ADDRESS_EVENT, onAddress);
  }, [key]);
}

/** Open an in-app address (`/?tab=…&…`) without reloading the app: the address takes the link's words as a step Back
 *  undoes, the shell its screen (and connection and layer), and a page already open reads the words for itself. An
 *  address of a page of its own (`/sheets/…`) is navigated to as any link is. */
export function openInApp(href: string): void {
  if (typeof window === "undefined") return;
  const u = new URL(href, window.location.origin);
  const tab = u.searchParams.get("tab");
  if (u.origin !== window.location.origin || u.pathname !== "/" || !tab) {
    window.location.assign(u.toString());
    return;
  }
  window.history.pushState(null, "", `/?${u.searchParams.toString()}`);
  const params: Record<string, string> = {};
  for (const k of ["conn", "layer", "canvas", "id"]) {
    const v = u.searchParams.get(k);
    if (v) params[k] = v;
  }
  requestTab(tab, params);
  window.dispatchEvent(new CustomEvent<AddressDetail>(ADDRESS_EVENT, { detail: { words: [...u.searchParams.keys()] } }));
}

/** Bring the element a link opened into view once it is drawn AND the page around it has settled: what loads above it
 *  (a section read after it) pushes it down, and a scroll made before that lands short (seen live, 2026-11-23: a metric
 *  opened at y=1057 of an 846-high page). Looked for every 150 ms; scrolled when its place has held for two looks, or
 *  at the last look wherever it is. */
export function showWhenDrawn(selector: string, tries = 20): void {
  if (typeof window === "undefined") return;
  let last: number | null = null;
  const look = (left: number) => {
    const el = document.querySelector(selector);
    const top = el ? el.getBoundingClientRect().top : null;
    if (el && ((last !== null && Math.abs(top! - last) < 1) || left <= 0)) { el.scrollIntoView({ block: "center" }); return; }
    last = top;
    if (left > 0) window.setTimeout(() => look(left - 1), 150);
  };
  look(tries);
}
