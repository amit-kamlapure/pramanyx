/**
 * A link into one thing inside the app — a table in the Catalog, a metric in the Semantic Layer, a spreadsheet, a custom
 * agent, a schedule, a document, a trusted query, a dashboard, a canvas (Discover's items link to each,
 * `pramanyx/discover/items.py`) — and how the page that holds the thing finds it.
 *
 * A link's words ride the address when it is opened cold (a new tab, a reload) and are handed over when it is opened in
 * place (`openInApp`). The page reads them when it mounts AND when a link names them while it is already open (the
 * shell keeps pages mounted behind other tabs, so "read on mount" alone missed every link but the first — the user,
 * 2026-11-23: it must connect "in a very robust manner"). Read once and taken, so the next visit to the page opens it as
 * it opens, not on the same thing again.
 *
 * The first word is the link's key (`table`, `metric`, `sheet`…); the rest qualify it (`schema`). Nothing is taken
 * unless the key is there, so one page never takes another link's qualifier.
 */
import { useEffect, useRef } from "react";

import { requestTab } from "@/lib/navigate";

/** Said when a link in the app has handed over its words; `words` names them, so only a page they are for reads. */
export const ADDRESS_EVENT = "pramanyx:address";
interface AddressDetail { words: string[] }

/** The shell's own words — which screen, connection, layer, canvas, reader — the only ones a link opened in place puts on
 *  the address. */
const SHELL_WORDS = ["tab", "conn", "layer", "canvas", "id"];

/** A link opened in place hands its own words over here, never on the address: Next's router keeps the address a
 *  `pushState` gave it and writes it back on its next render, so a word put there and taken off came back (seen live,
 *  2026-11-23: `&table=` stayed on the address after the table opened). Held until the page they are for takes them —
 *  now, when it is open, or when it mounts. */
let handedOver: Record<string, string> = {};

function takeHandedOver(names: string[]): Record<string, string> {
  if (!handedOver[names[0]]) return {};
  const out: Record<string, string> = {};
  for (const name of names) {
    if (handedOver[name]) { out[name] = handedOver[name]; delete handedOver[name]; }
  }
  return out;
}

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
      const found = { ...takeFromAddress(...wanted), ...takeHandedOver(wanted) };
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

/** Open an in-app address (`/?tab=…&…`) without reloading the app: the shell's words go on the address as a step Back
 *  undoes and the shell goes to that screen (connection, layer, canvas); the link's own words are handed to the page
 *  they are for — read now if it is open, or as it mounts. The same address opened cold (a new tab, a reload) carries
 *  every word, and the page reads them off the address. An address of a page of its own is navigated to as any link is. */
export function openInApp(href: string): void {
  if (typeof window === "undefined") return;
  const u = new URL(href, window.location.origin);
  const tab = u.searchParams.get("tab");
  if (u.origin !== window.location.origin || u.pathname !== "/" || !tab) {
    window.location.assign(u.toString());
    return;
  }
  const shell = new URLSearchParams();
  const params: Record<string, string> = {};
  handedOver = {};
  for (const [k, v] of u.searchParams) {
    if (SHELL_WORDS.includes(k)) { shell.set(k, v); if (k !== "tab") params[k] = v; }
    else if (v) handedOver[k] = v;
  }
  window.history.pushState(null, "", `/?${shell.toString()}`);
  requestTab(tab, params);
  window.dispatchEvent(new CustomEvent<AddressDetail>(ADDRESS_EVENT, { detail: { words: Object.keys(handedOver) } }));
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
