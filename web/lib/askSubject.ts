"use client";

/**
 * Arc FA-2 — what a question is about, carried from a dashboard to the Data Canvas in memory, never in the address.
 *
 * A reader ticks objects in a table, or asks about the set a piece reads; the piece keeps the subject here and asks the
 * shell for the Data Canvas (`requestTab`, which carries the connection and nothing else). The canvas shows the subject
 * above its input, with a way to take it off, and sends it as the turn's `focus`; the server reads it again through the
 * object door under the reader's row policy and says what it read on the turn's receipt. No key rides a query string.
 */
import { useContext, useEffect, useRef, useSyncExternalStore } from "react";

import { plural, typeWord } from "@/lib/dashboards/objectView";
import { formatCount } from "@/lib/format";
import { openAskPanelOn } from "@/lib/askPanel";
import { LayerVisibleContext } from "@/lib/useVisiblePoll";

/** The most objects one subject names — the server's own bound, and a press's (`MAX_TICKED_RUNS`). */
export const MAX_SUBJECT = 50;

interface Common {
  /** The connection the subject was chosen on: a canvas on another one does not send it. */
  connectionId: string;
  /** How its objects are called, one and many: ["order", "orders"]. */
  noun: [string, string];
}
export type AskSubject =
  | Common & { kind: "objects"; refs: string[]; label?: string }
  | Common & { kind: "set"; dashboard: string; owner?: string; set: string; label: string; total?: number | null;
      values: Record<string, unknown>; chosen: Record<string, string>; filters: Record<string, unknown>[]; narrowed: boolean }
  // a segment the ontology names, read by a piece directly — sent with the conditions the piece reads it under
  | Common & { kind: "segment"; entity: string; segment: string; label: string; total?: number | null;
      filters: Record<string, unknown>[]; narrowed: boolean }
  // a dashboard, or one card of it, held to the period on screen (the dashboards study's R20)
  | Common & { kind: "dashboard"; dashboard: string; owner?: string; title: string; card?: { id: string; title: string };
      period: { start: string; last_day: string; covers: string } | null }
  // the Ask panel's page (Stage 1, 2026-11-19): the spreadsheet open, the table open in the Catalog, the statement in the editor
  | Common & { kind: "sheet"; id: string; title: string }
  | Common & { kind: "table"; table: string }
  | Common & { kind: "query"; sql: string; title: string };

let current: AskSubject | null = null;
const listeners = new Set<() => void>();

export function askSubject(): AskSubject | null {
  return current;
}

export function setAskSubject(next: AskSubject | null): void {
  current = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useAskSubject(): AskSubject | null {
  return useSyncExternalStore(subscribe, askSubject, () => null);
}

// ── The page's own subject (the Ask panel, Stage 1) ──
// What the page on screen is showing: the dashboard, the spreadsheet, the Catalog's table, the editor's statement. The Ask
// panel asks about it unless a person chose something else (`askAbout`) or took it off. A page sets it while it is open and
// takes it back as it closes.
let onPage: AskSubject | null = null;
const pageListeners = new Set<() => void>();

/** The page's subject is now `next`; `null` takes it back. Only the page that set a subject takes it back: a page closing
 *  after the next one opened leaves the next one's. */
export function setPageSubject(next: AskSubject | null, taking?: AskSubject | null): void {
  if (next === null && taking !== undefined && onPage !== taking) return;
  onPage = next;
  for (const l of pageListeners) l();
}

export function usePageSubject(): AskSubject | null {
  return useSyncExternalStore(l => { pageListeners.add(l); return () => { pageListeners.delete(l); }; }, () => onPage, () => null);
}

/** Whether a change can be asked about this subject: a dashboard the person keeps, the one the server hands the change tool
 *  (`_own_dashboard`). Another person's, or anything else, is read only. */
export const changeable = (s: AskSubject | null | undefined): boolean => s?.kind === "dashboard" && !s.owner;

/** One subject's identity, to know it again: what the ask door would be sent. */
export const subjectKey = (s: AskSubject | null): string => (s ? JSON.stringify(focusOf(s)) : "");

/** A page says what it shows while it is open: `subject`, or nothing. Set again only when what it shows changes. A page
 *  kept mounted behind another (the Data pages are) says nothing while it is hidden. */
export function useOnPage(subject: AskSubject | null): void {
  const shown = useContext(LayerVisibleContext);
  const latest = useRef(subject);
  latest.current = subject;
  const key = shown ? subjectKey(subject) : "";
  useEffect(() => {
    const held = latest.current;
    if (!held || !key) return;
    setPageSubject(held);
    return () => setPageSubject(null, held);
  }, [key]);
}

/** Keep the subject and open where it can be asked: beside the page that holds a panel, or the Data Canvas on its connection. */
export function askAbout(subject: AskSubject): void {
  setAskSubject(subject);
  openAskPanelOn(subject.connectionId);
}

/** How a type's objects are called, from the type the object door names: ["order", "orders"]. */
export function nounOf(typeId: string | null | undefined): [string, string] {
  const one = typeWord(typeId).toLowerCase() || "object";
  return [one, plural(one)];
}

/** The subject in a line, as the canvas shows it: "Asking about 12 orders · from Late dispatch". */
export function subjectWords(s: AskSubject): string {
  if (s.kind === "dashboard") {
    return `Asking about ${s.card ? `“${s.card.title}” on ` : ""}${s.title} · ${s.period?.covers ?? "as written"}`;
  }
  if (s.kind === "sheet") return `Asking about ${s.title}`;
  if (s.kind === "table") return `Asking about the table ${s.table}`;
  if (s.kind === "query") return `Asking about the query ${s.title ? `“${s.title}”` : "in the SQL Editor"}`;
  if (s.kind === "objects") {
    const n = s.refs.length;
    return `Asking about ${formatCount(n)} ${n === 1 ? s.noun[0] : s.noun[1]}${s.label ? ` · from ${s.label}` : ""}`;
  }
  const held = s.total == null ? "" : ` · ${formatCount(s.total)} ${s.total === 1 ? s.noun[0] : s.noun[1]}`;
  return `Asking about ${s.label}${held}${s.narrowed ? " · narrowed by your filters" : ""}`;
}

/** The subject as the ask door takes it (`AskFocus`): references, or a dashboard's set by name with the values and the
 *  objects chosen on the page and the reader's own filters — never what the set reads. */
export function focusOf(s: AskSubject): Record<string, unknown> {
  if (s.kind === "dashboard") return { kind: "dashboard", dashboard: s.dashboard, ...(s.owner ? { owner: s.owner } : {}),
    ...(s.card ? { id: s.card.id } : {}), label: s.title.slice(0, 80), period: s.period ? `${s.period.start}..${s.period.last_day}` : "" };
  if (s.kind === "objects") return { kind: "objects", objects: s.refs.slice(0, MAX_SUBJECT), ...(s.label ? { label: s.label.slice(0, 80) } : {}) };
  if (s.kind === "sheet") return { kind: "sheet", id: s.id };
  if (s.kind === "table") return { kind: "table", id: s.table.slice(0, 200) };
  if (s.kind === "query") return { kind: "query", sql: s.sql.slice(0, 20000), ...(s.title ? { label: s.title.slice(0, 80) } : {}) };
  if (s.kind === "segment") return { kind: "set", entity: s.entity, segment: s.segment, label: s.label.slice(0, 80),
    filters: s.filters.slice(0, 20), narrowed: s.narrowed };
  return { kind: "set", dashboard: s.dashboard, ...(s.owner ? { owner: s.owner } : {}), set: s.set, values: s.values,
    chosen: s.chosen, filters: s.filters.slice(0, 20) };
}

/** What a dashboard or one of its cards is asked about with, from the page's key and the period it reads; null where the key
 *  names no dashboard a server could read. */
export function dashboardSubject(connectionId: string, key: string | undefined, title: string,
  range: { start?: string | null; last_day?: string | null; covers?: string | null } | null | undefined, card?: { id: string; title: string }): AskSubject | null {
  const where = dashboardOf(key, connectionId);
  if (!where) return null;
  const period = range?.start && range.last_day ? { start: range.start, last_day: range.last_day, covers: range.covers || `${range.start} to ${range.last_day}` } : null;
  return { kind: "dashboard", connectionId, noun: ["card", "cards"], ...where, title, period, ...(card ? { card } : {}) };
}

/** The dashboard a page's key names — `<connection>:<id>`, its builder preview `…:preview`, or another person's
 *  published one `shared:<owner>:<id>` — or null when it names none a server could read a set from. */
export function dashboardOf(key: string | undefined, connectionId: string): { dashboard: string; owner?: string } | null {
  if (!key) return null;
  let rest = key.startsWith(`${connectionId}:`) ? key.slice(connectionId.length + 1) : key;
  if (rest.endsWith(":preview")) rest = rest.slice(0, -":preview".length);
  let owner: string | undefined;
  if (rest.startsWith("shared:")) {
    const inner = rest.slice("shared:".length);
    const at = inner.lastIndexOf(":");
    if (at <= 0) return null;
    owner = inner.slice(0, at);
    rest = inner.slice(at + 1);
  } else if (!key.startsWith(`${connectionId}:`)) {
    return null;
  }
  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(rest) ? { dashboard: rest, ...(owner ? { owner } : {}) } : null;
}
