/**
 * The Ask panel (Stage 1 of the plan, the user, 2026-11-19): one panel that stays with a person across every page, opened
 * and hidden from one icon in the top bar, holding its conversations as tabs. What it holds is the person's own, kept in
 * their browser: whether it is open, which conversations are open as tabs, and which one is in front. The conversations
 * themselves are the platform's (`/chat-sessions`), so the Ask page lists the same ones at full size.
 */
import { useSyncExternalStore } from "react";

import { newSessionId } from "@/lib/chatTurn";

/** One open conversation. `session` is null until its first question is asked. */
export interface AskTab {
  key: string;
  session: string | null;
  title: string;
  /** The connection the conversation is on: it stays there whichever page is open. */
  connectionId: string;
}

export interface AskPanelState {
  open: boolean;
  tabs: AskTab[];
  active: string;
}

/** The most conversations open as tabs at once; opening another lets the oldest go back to the history. */
export const MAX_TABS = 6;
const KEY = "pramanyx:ask-panel";
const CLOSED: AskPanelState = { open: false, tabs: [], active: "" };

let state: AskPanelState | null = null;
const listeners = new Set<() => void>();

function read(): AskPanelState {
  if (state) return state;
  state = CLOSED;
  try {
    const kept = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<AskPanelState> | null;
    if (kept && Array.isArray(kept.tabs)) {
      const tabs = kept.tabs.filter((t): t is AskTab => !!t && typeof t.key === "string" && typeof t.connectionId === "string")
        .slice(-MAX_TABS).map(t => ({ ...t, session: typeof t.session === "string" ? t.session : null, title: String(t.title ?? "") }));
      const active = tabs.some(t => t.key === kept.active) ? String(kept.active) : tabs[tabs.length - 1]?.key ?? "";
      state = { open: kept.open === true && tabs.length > 0, tabs, active };
    }
  } catch { /* a per-browser convenience: it opens closed */ }
  return state;
}

function write(next: AskPanelState): void {
  state = next;
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* kept while the page is open */ }
  listeners.forEach(l => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useAskPanel(): AskPanelState {
  return useSyncExternalStore(subscribe, () => (typeof window === "undefined" ? CLOSED : read()), () => CLOSED);
}

/** For tests: forget what this browser kept. */
export function resetAskPanel(): void {
  state = null;
}

const freshTab = (connectionId: string): AskTab => ({ key: newSessionId(), session: null, title: "", connectionId });

/** The tabs with `tab` added in front, the oldest let go past the most a panel holds. */
function withTab(tabs: AskTab[], tab: AskTab): AskTab[] {
  return [...tabs, tab].slice(-MAX_TABS);
}

/** Show the panel; with no conversation open yet, a new one on `connectionId`. */
export function openAskPanel(connectionId: string): void {
  const s = read();
  if (s.tabs.length) { write({ ...s, open: true }); return; }
  const tab = freshTab(connectionId);
  write({ open: true, tabs: [tab], active: tab.key });
}

export function hideAskPanel(): void {
  write({ ...read(), open: false });
}

export function toggleAskPanel(connectionId: string): void {
  if (read().open) hideAskPanel(); else openAskPanel(connectionId);
}

/** A new conversation in a tab of its own, in front. An empty one already open is reused rather than doubled. */
export function newAskTab(connectionId: string): void {
  const s = read();
  const empty = s.tabs.find(t => !t.session && t.connectionId === connectionId);
  if (empty) { write({ ...s, open: true, active: empty.key }); return; }
  const tab = freshTab(connectionId);
  write({ open: true, tabs: withTab(s.tabs, tab), active: tab.key });
}

/** Close a tab. Its conversation stays in the history. Closing the last one hides the panel. */
export function closeAskTab(key: string): void {
  const s = read();
  const at = s.tabs.findIndex(t => t.key === key);
  if (at < 0) return;
  const tabs = s.tabs.filter(t => t.key !== key);
  if (!tabs.length) { write({ open: false, tabs: [], active: "" }); return; }
  const active = s.active === key ? (tabs[at] ?? tabs[at - 1]).key : s.active;
  write({ ...s, tabs, active });
}

export function selectAskTab(key: string): void {
  const s = read();
  if (s.tabs.some(t => t.key === key)) write({ ...s, active: key });
}

/** Open an earlier conversation: brought to the front where it is already a tab, else in a tab of its own. */
export function openAskConversation(session: string, title: string, connectionId: string): void {
  const s = read();
  const there = s.tabs.find(t => t.session === session);
  if (there) { write({ ...s, open: true, active: there.key }); return; }
  const tab: AskTab = { key: newSessionId(), session, title, connectionId };
  write({ open: true, tabs: withTab(s.tabs, tab), active: tab.key });
}

/** A tab's conversation came to exist, or was named by its first question. */
export function noteAskSession(key: string, session: string, title: string): void {
  const s = read();
  const tab = s.tabs.find(t => t.key === key);
  if (!tab || (tab.session === session && tab.title === title)) return;
  write({ ...s, tabs: s.tabs.map(t => (t.key === key ? { ...t, session, title: title || t.title } : t)) });
}
