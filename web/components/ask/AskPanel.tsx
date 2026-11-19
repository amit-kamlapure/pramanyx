"use client";

/**
 * The Ask panel (Stage 1 of the plan, the user, 2026-11-19): one icon in the top bar shows or hides it on every page, and it
 * stays as a person moves between pages, holding their conversations as tabs. A new conversation is a new tab; an earlier one
 * opens from the history; the full page is the Ask page, which lists the same conversations. It sits beside the page and
 * pushes it over, never covering it, except on a screen too narrow for both.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { DropdownMenu } from "@radix-ui/themes";

import { BrandSpark } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Loading } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
import type { ChatSessionSummary } from "@/components/ThreadsRail";
import {
  closeAskTab, hideAskPanel, newAskTab, noteAskSession, openAskConversation, selectAskTab, toggleAskPanel, useAskPanel,
  type AskTab,
} from "@/lib/askPanel";
import { getApiBase } from "@/lib/config";
import { requestTab } from "@/lib/navigate";
import { useNarrowScreen } from "@/lib/useNarrowScreen";

const ChatPanel = dynamic(() => import("@/components/ChatPanel").then(m => ({ default: m.ChatPanel })), {
  ssr: false, loading: () => <Loading what="the conversation" style={{ padding: 16 }} />,
});

const WIDTH_KEY = "pramanyx_ask_panel_width";
const MIN_W = 360, MAX_W = 760, DEFAULT_W = 460;

function readWidth(): number {
  try {
    const raw = Number(window.localStorage.getItem(WIDTH_KEY));
    return raw >= MIN_W && raw <= MAX_W ? raw : DEFAULT_W;
  } catch {
    return DEFAULT_W;
  }
}

/** The icon in the top bar: the one way to show or hide the panel, on every page. */
export function AskPanelToggle({ connectionId }: { connectionId: string }) {
  const { open } = useAskPanel();
  return (
    <Tooltip content={open ? "Hide Ask" : "Ask, on this page"} side="bottom" sideOffset={6} delayDuration={400}>
      <Button variant="ghost" size="icon-sm" data-testid="ask-panel-toggle" aria-label={open ? "Hide Ask" : "Open Ask"} aria-pressed={open}
        onClick={() => toggleAskPanel(connectionId)}
        style={open ? { background: "var(--bg-sel)" } : undefined}>
        <BrandSpark size={16} />
      </Button>
    </Tooltip>
  );
}

/** A tab's name: the conversation's first question, or "New conversation" before one is asked. */
const tabName = (t: AskTab) => t.title || "New conversation";

function History({ connectionId }: { connectionId: string }) {
  const [rows, setRows] = useState<ChatSessionSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    fetch(`${getApiBase()}/chat-sessions?conn_id=${encodeURIComponent(connectionId)}&limit=30`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((got: ChatSessionSummary[]) => setRows(Array.isArray(got) ? got : []))
      .catch(() => { setRows([]); setFailed(true); });
  }, [connectionId]);
  return (
    <DropdownMenu.Root onOpenChange={o => { if (o) load(); }}>
      <DropdownMenu.Trigger>
        <Button variant="ghost" size="icon-xs" aria-label="Earlier conversations" title="Earlier conversations" data-testid="ask-panel-history">
          <Icon name="history" size={15} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content size="1" align="end" style={{ maxWidth: 360, maxHeight: 420 }}>
        <DropdownMenu.Label>Earlier conversations</DropdownMenu.Label>
        {rows === null && <DropdownMenu.Item disabled>Reading…</DropdownMenu.Item>}
        {failed && <DropdownMenu.Item disabled>They could not be read.</DropdownMenu.Item>}
        {rows !== null && !failed && !rows.length && <DropdownMenu.Item disabled>None on this connection yet.</DropdownMenu.Item>}
        {(rows ?? []).map(r => (
          <DropdownMenu.Item key={r.session_id} data-testid="ask-panel-history-row" onSelect={() => openAskConversation(r.session_id, r.title, connectionId)}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "Untitled"}</span>
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

/** The panel, drawn once by the shell beside the content. `hidden` while the Ask page shows the conversations at full size:
 *  it stays mounted, so an answer still being written is not cut off. */
export function AskPanelHost({ connectionId, hidden = false }: { connectionId: string; hidden?: boolean }) {
  const { open, tabs, active } = useAskPanel();
  const narrow = useNarrowScreen();
  const [width, setWidth] = useState(DEFAULT_W);
  useEffect(() => { setWidth(readWidth()); }, []);

  const keep = (w: number) => {
    const next = Math.min(MAX_W, Math.max(MIN_W, Math.round(w)));
    setWidth(next);
    try { window.localStorage.setItem(WIDTH_KEY, String(next)); } catch { /* a per-viewer convenience only */ }
  };
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = width;
    const move = (ev: PointerEvent) => keep(startW + (startX - ev.clientX));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!tabs.length) return null;
  const shown = open && !hidden;
  const front = tabs.find(t => t.key === active) ?? tabs[tabs.length - 1];
  const fullPage = () => {
    hideAskPanel();
    requestTab("chat", { conn: front.connectionId, ...(front.session ? { chat: front.session } : {}) });
  };

  return (
    <aside aria-label="Ask" data-testid="ask-panel" hidden={!shown}
      style={{ display: shown ? "flex" : "none", flexDirection: "column", minHeight: 0, position: narrow ? "fixed" : "relative",
        ...(narrow ? { inset: 0, zIndex: 40 } : { width, flexShrink: 0 }),
        background: "var(--bg-3)", borderLeft: "1px solid var(--b1)" }}>
      {!narrow && (
        <div className="aug-inspector-grip" role="separator" aria-orientation="vertical" aria-label="Resize Ask"
          aria-valuemin={MIN_W} aria-valuemax={MAX_W} aria-valuenow={width} tabIndex={0} onPointerDown={startDrag}
          onKeyDown={e => {
            if (e.key === "ArrowLeft") { e.preventDefault(); keep(width + 16); }
            if (e.key === "ArrowRight") { e.preventDefault(); keep(width - 16); }
          }} />
      )}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--b1)", minWidth: 0 }}>
        <Button variant="ghost" size="icon-xs" aria-label="Open at full size" title="Open at full size" data-testid="ask-panel-full" onClick={fullPage}>
          <Icon name="expand" size={14} />
        </Button>
        <div role="tablist" aria-label="Conversations" style={{ flex: 1, minWidth: 0, display: "flex", gap: 2, overflowX: "auto", scrollbarWidth: "none" }}>
          {tabs.map(t => {
            const on = t.key === front.key;
            return (
              <div key={t.key} data-testid="ask-panel-tab" data-active={on || undefined}
                style={{ flex: "0 1 auto", minWidth: 64, maxWidth: 200, display: "flex", alignItems: "center", borderRadius: "var(--r2)",
                  background: on ? "var(--bg-sel)" : "transparent" }}>
                <Button variant="ghost" size="xs" role="tab" aria-selected={on} title={tabName(t)} onClick={() => selectAskTab(t.key)}
                  style={{ flex: 1, minWidth: 0, justifyContent: "flex-start", color: on ? "var(--t1)" : "var(--t2)" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tabName(t)}</span>
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label={`Close ${tabName(t)}`} title="Close · it stays in the history"
                  data-testid="ask-panel-tab-close" onClick={() => closeAskTab(t.key)} style={{ color: "var(--t3)" }}>
                  <Icon name="close" size={12} />
                </Button>
              </div>
            );
          })}
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="New conversation" title="New conversation" data-testid="ask-panel-new"
          onClick={() => newAskTab(connectionId)}>
          <Icon name="plus" size={15} />
        </Button>
        <History connectionId={connectionId} />
        <Button variant="ghost" size="icon-xs" aria-label="Hide Ask" title="Hide · the conversations stay" data-testid="ask-panel-hide" onClick={hideAskPanel}>
          <Icon name="close" size={15} />
        </Button>
      </div>
      {tabs.map(t => (
        <div key={t.key} role="tabpanel" aria-label={tabName(t)} hidden={t.key !== front.key}
          style={{ flex: 1, minHeight: 0, display: t.key === front.key ? "flex" : "none", flexDirection: "column" }}>
          <ChatPanel connectionId={t.connectionId} beside harness restoreSessionId={t.session}
            onSession={(session, title) => noteAskSession(t.key, session, title)} />
        </div>
      ))}
    </aside>
  );
}
