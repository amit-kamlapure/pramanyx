"use client";

/**
 * The Ask panel (Stage 1 of the plan, the user, 2026-11-19): one icon in the top bar shows or hides it on every page, and it
 * stays as a person moves between pages, holding their conversations as tabs. A new conversation is a new tab; an earlier one
 * opens from the history; the full page is the Ask page, which lists the same conversations. It sits beside the page and
 * pushes it over, never covering it, except on a screen too narrow for both.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { DropdownMenu } from "@radix-ui/themes";

import { BrandSpark } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Loading } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
import type { ChatSessionSummary } from "@/components/ThreadsRail";
import {
  closeAskTab, followPageConnection, hideAskPanel, inTheCoworker, newAskTab, noteAskSession, openAskConversation, PANEL_MAX_W, PANEL_MIN_W, selectAskTab,
  setAskPanelWidth, toggleAskPanel, useAskPanel, useAskPanelWidth, type AskTab, type PageCanvas,
} from "@/lib/askPanel";
import { getApiBase } from "@/lib/config";
import { requestTab } from "@/lib/navigate";
import { useNarrowScreen } from "@/lib/useNarrowScreen";

const ChatPanel = dynamic(() => import("@/components/ChatPanel").then(m => ({ default: m.ChatPanel })), {
  ssr: false, loading: () => <Loading what="the conversation" style={{ padding: 16 }} />,
});

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

/** The page beside the panel. While the panel is open the page keeps the width it had without it and moves left, under the
 *  rail, scrolling sideways back to what it hid, rather than squeezing every page into what is
 *  left (the user, 2026-11-19). On a screen too narrow for both the panel covers the page instead, so nothing moves. */
export function AskPushedPage({ hidden = false, children }: { hidden?: boolean; children: React.ReactNode }) {
  const { open, tabs } = useAskPanel();
  const narrow = useNarrowScreen();
  const width = useAskPanelWidth();
  const pushed = open && tabs.length > 0 && !hidden && !narrow;
  const scroller = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  // how far the page is moved, as `--ask-pushed`: what must stay in reach — a dashboard's filters — stands that far in
  // from the page's left edge, so it is never hidden under the rail (the user, 2026-11-19: "the Global filters are not
  // visible" with the panel open)
  const said = useCallback(() => {
    const el = scroller.current;
    page.current?.style.setProperty("--ask-pushed", `${pushed && el ? el.scrollLeft : 0}px`);
  }, [pushed]);
  // opening the panel moves the page left by the panel's width: what was at its right edge stays beside the panel
  useEffect(() => {
    const el = scroller.current;
    if (pushed && el) el.scrollLeft = el.scrollWidth;
    said();
  }, [pushed, said]);
  return (
    <div ref={scroller} data-testid="ask-pushed-page" className="aug-page-surface" data-pushed={pushed || undefined} onScroll={said}
      style={{ flex: 1, minWidth: 0, display: "flex", overflowX: pushed ? "auto" : "hidden", overflowY: "hidden" }}>
      <div ref={page} style={{ display: "flex", minWidth: 0, ...(pushed ? { flex: "none", width: `calc(100% + ${width}px)` } : { flex: 1 }) }}>
        {children}
      </div>
    </div>
  );
}

/** A tab's name: the conversation's first question, or before one is asked "New conversation" — on a Data Canvas, its name,
 *  so the reader sees which tables the conversation is held to. */
const tabName = (t: AskTab) => t.title || (t.canvasName ? `On ${t.canvasName}` : "New conversation");

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
            {/* one record for both places (2026-11-20): a conversation held in the coworker app says so */}
            {inTheCoworker(r.session_id) && <span data-testid="ask-panel-history-coworker" className="aug-fs-xs" style={{ flex: "none", color: "var(--t3)" }}>coworker</span>}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

/** The panel, drawn once by the shell beside the content. `hidden` while the Ask page shows the conversations at full size:
 *  it stays mounted, so an answer still being written is not cut off. A conversation is drawn the first time it is shown. */
export function AskPanelHost({ connectionId, canvas = null, hidden = false }: {
  connectionId: string;
  /** The Data Canvas the page shows, if any: a conversation begun over it reads only its tables. */
  canvas?: PageCanvas | null;
  hidden?: boolean;
}) {
  const { open, tabs, active } = useAskPanel();
  const narrow = useNarrowScreen();
  const width = useAskPanelWidth();
  // The conversations drawn so far: a tab is drawn the first time it is in front of an open panel, and kept after, so an
  // answer being written is never cut off by hiding the panel or turning to another tab. Never at load: drawn behind a
  // closed panel, each remembered tab read its whole conversation, its people, suggestions, agents and connections and
  // drew its charts on every page the person opened (2026-11-23: three tabs were half of a cold load's 120 reads).
  const [drawn, setDrawn] = useState<readonly string[]>([]);
  // a conversation nothing has been asked in yet is about the page's connection, and its canvas
  const canvasId = canvas?.id ?? null, canvasName = canvas?.name ?? "";
  useEffect(() => {
    if (open) followPageConnection(connectionId, canvasId ? { id: canvasId, name: canvasName } : null);
  }, [open, connectionId, canvasId, canvasName, active]);

  const keep = setAskPanelWidth;
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
  if (shown && !drawn.includes(front.key)) setDrawn([...drawn, front.key]);
  const fullPage = () => {
    hideAskPanel();
    requestTab("chat", { conn: front.connectionId, ...(front.session ? { chat: front.session } : {}) });
  };

  return (
    <aside aria-label="Ask" data-testid="ask-panel" hidden={!shown}
      style={{ display: shown ? "flex" : "none", flexDirection: "column", minHeight: 0, position: narrow ? "fixed" : "relative",
        ...(narrow ? { inset: 0, zIndex: 40 } : { width, flexShrink: 0 }),
        // the page | Ask split: the one rule kept, in --divide; its tab strip parts by space (2026-11-20, borders are the exception)
        background: "var(--bg-3)", borderLeft: "1px solid var(--divide)" }}>
      {!narrow && (
        <div className="aug-inspector-grip" role="separator" aria-orientation="vertical" aria-label="Resize Ask"
          aria-valuemin={PANEL_MIN_W} aria-valuemax={PANEL_MAX_W} aria-valuenow={width} tabIndex={0} onPointerDown={startDrag}
          onKeyDown={e => {
            if (e.key === "ArrowLeft") { e.preventDefault(); keep(width + 16); }
            if (e.key === "ArrowRight") { e.preventDefault(); keep(width - 16); }
          }} />
      )}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, padding: "6px 8px 4px", minWidth: 0 }}>
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
          {(drawn.includes(t.key) || (shown && t.key === front.key)) && (
            <ChatPanel connectionId={t.connectionId} canvasId={t.canvasId} beside harness restoreSessionId={t.session}
              takesQueued={shown && t.key === front.key}
              onSession={(session, title) => noteAskSession(t.key, session, title)} onNew={() => newAskTab(t.connectionId)} />
          )}
        </div>
      ))}
    </aside>
  );
}
