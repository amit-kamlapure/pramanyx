"use client";

/**
 * Ask, beside the dashboard (the user, 2026-11-19). A question opens in the governed chat next to the page it is about, so the
 * dashboard stays in view; on a dashboard the person owns, the same panel also changes it. It pushes the page over and never
 * covers it, except on a screen too narrow for both.
 */
import dynamic from "next/dynamic";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { ChangeThread, type ChangeDoor } from "@/components/dashboards/ChangeThread";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Segmented } from "@/components/ui/segmented";
import { Loading } from "@/components/ui/states";
import { endAskBeside, freshAskBeside, hideAskBeside, holdAskBeside, showAskBeside, useAskBeside, type BesideView } from "@/lib/askSubject";

const ChatPanel = dynamic(() => import("@/components/ChatPanel").then(m => ({ default: m.ChatPanel })), {
  ssr: false, loading: () => <Loading what="the conversation" style={{ padding: 16 }} />,
});

const NARROW = "(max-width: 900px)";
function subscribeNarrow(listener: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
const isNarrow = () => (typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(NARROW).matches);

const VIEWS: { value: BesideView; label: string }[] = [{ value: "ask", label: "Ask" }, { value: "change", label: "Change" }];

export function AskBeside({ connectionId, dashboardKey, title, change, children }: {
  connectionId: string;
  /** The dashboard open on the page. A different one starts a different conversation. */
  dashboardKey: string;
  title: string;
  /** Offered only on a dashboard this person may change. */
  change: ChangeDoor | null;
  children: ReactNode;
}) {
  const { open, started, round, view } = useAskBeside();
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  useEffect(() => holdAskBeside(), []);
  useEffect(() => { endAskBeside(); }, [dashboardKey]);
  const showing: BesideView = view === "change" && change ? "change" : "ask";

  return (
    <div data-testid="ask-beside-host" style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", position: "relative", overflow: "hidden" }}>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>{children}</div>
      {started && (
        <aside aria-label="Ask about this dashboard" data-testid="ask-beside" hidden={!open}
          style={{ display: open ? "flex" : "none", flexDirection: "column", minHeight: 0, background: "var(--bg-1)", borderLeft: "1px solid var(--b1)",
            ...(narrow ? { position: "absolute", inset: 0, zIndex: 20 } : { flex: "0 0 clamp(380px, 34%, 560px)" }) }}>
          <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--b1)" }}>
            {change ? <Segmented label="What to do" value={showing} onChange={showAskBeside} options={VIEWS} />
              : <span className="aug-fs-ui" style={{ color: "var(--t1)", fontWeight: 600, padding: "0 4px" }}>Ask</span>}
            <span style={{ flex: 1 }} />
            <Button size="icon-sm" variant="ghost" aria-label="New conversation" title="New conversation" data-testid="ask-beside-new" onClick={freshAskBeside}><Icon name="plus" size={15} /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Close" title="Close" data-testid="ask-beside-close" onClick={hideAskBeside}><Icon name="close" size={15} /></Button>
          </div>
          <div key={`ask-${round}`} style={{ flex: 1, minHeight: 0, display: showing === "ask" ? "flex" : "none", flexDirection: "column" }}>
            <ChatPanel connectionId={connectionId} beside
              capabilities={<p className="aug-fs-sm" style={{ margin: 0, textAlign: "center", color: "var(--t2)" }}>Ask about what this dashboard shows.</p>} />
          </div>
          {change && (
            <div key={`change-${round}`} style={{ flex: 1, minHeight: 0, display: showing === "change" ? "flex" : "none", flexDirection: "column" }}>
              <ChangeThread connectionId={connectionId} title={title} door={change} />
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
