"use client";

/**
 * An open Data Canvas — its chrome redone to `pramanyx-v2/CLARITY.md` (2026-10-12). The conversation, the reports and
 * the configuration panel are what the person made and are drawn as before; around them: one header line (the way
 * back, the name, what it is in a line, its facts as chips, the three views, a new conversation and one Tools menu),
 * a landing that opens on the canvas itself (its mark, its name, what it reads), the history with a question asked eleven times said
 * once, and the saved artifacts — each saying when it could not be read, never showing that as empty.
 */
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { DropdownMenu } from "@radix-ui/themes";

import { Card, Chip, Empty, MUTED, NUM, ONE_LINE, Page, ROW, RULE } from "@/components/clarity/kit";
import { ChatPanel } from "@/components/ChatPanel";
import { ConfigurePanel } from "@/components/ConfigurePanel";
import { HistoryDetailPanel } from "@/components/HistoryDetailPanel";
import { CertificationMark } from "@/components/govern/CertificationMark";
import { ShareChooser } from "@/components/sheets/SheetSharing";
import { useCloseOutside } from "@/components/sheets/useCloseOutside";
import { Button } from "@/components/ui/button";
import { PramanyxMark } from "@/components/ui/brand";
import { ChromeActions, ChromeFacts, useChromeBack, useInShell } from "@/components/shell/PageChrome";
import { Icon } from "@/components/ui/icon";
import { Loading, ReadFailed } from "@/components/ui/states";
import { DEEP_ANALYSIS_MODE, type Canvas, type CanvasHistoryItem as HistoryItem, type Connection } from "@/lib/api";
import { cloneCanvas, deleteInvestigation, getCanvasDocuments, getCanvasHistory } from "@/lib/api";
import { readCanvasSharing, saveCanvasSharing } from "@/lib/canvasSharing";
import type { SheetSharing } from "@/lib/sheets";
import {
  agoWords, connectionGone, connectionKind, foldHistory, RUN_KIND_WORD, runStateWord, scopeWords, tableNames,
  tablesTitle, type AskedQuestion, type RunKind,
} from "@/lib/canvasList";
import { countNoun, formatCount, formatTimestamp } from "@/lib/format";

type WsTab = "chat" | "briefing" | "history";

// The Briefing's module graph loads only when the tab is first opened.
const BriefingEdition = dynamic(() => import("@/components/brief/BriefingEdition").then(m => ({ default: m.BriefingEdition })),
  { ssr: false, loading: () => <Loading what="the Briefing" /> });

/** How many runs the history reads; when it reads this many, it says they are the latest. */
const HISTORY_LIMIT = 30;

const HIDDEN_UNTIL_HOVER = "opacity-0 group-hover/run:opacity-100 focus-visible:opacity-100 transition-opacity";

// ── The header line ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The line an open canvas starts on — the Catalog's `PanelHead` (`catalog/CatalogTools.tsx`), drawn the same, with a way
 * back to the list before the name. Its doors stand on its right, as another product's data space has them (the user, 2026-11-20): a new
 * conversation (the pencil), its history, Configure, Share, and ⋮ for the rest — the Briefing, Clone, Certify. There is
 * no row of views under it any more: Chat is where it opens, History is a door, the Briefing is in ⋮, and Settings and
 * Artifacts are Configure's tabs. When the line is short the description gives way first, then the connection's chip,
 * then the name; the doors never do.
 */
function CanvasHead({ name, what, chips, actions, onBack, overlay }: {
  name: string; what?: string; chips: ReactNode;
  actions: ReactNode; onBack: () => void;
  /** What opens from the doors — the Share pop-over — placed against them. */
  overlay?: ReactNode;
}) {
  // Inside the app the line FOLDS into the shell's rows (2026-11-10, ROADMAP §6 item 64): the canvas's name is already
  // the title and "Data Canvas" in the breadcrumb the way back; its description and chips stand beside the title, its
  // doors with the page's actions.
  const inShell = useInShell();
  useChromeBack(inShell ? onBack : null);
  if (inShell) {
    return (
      <>
        <ChromeFacts>
          {what && <span data-testid="canvas-what" className="aug-fs-sm" title={what} style={{ ...MUTED, ...ONE_LINE, maxWidth: 420 }}>{what}</span>}
          {chips}
        </ChromeFacts>
        <ChromeActions><span data-testid="canvas-head" style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>{actions}{overlay}</span></ChromeActions>
      </>
    );
  }
  return (
    <div data-testid="canvas-head" style={{ ...ROW, flexWrap: "nowrap", gap: 10, padding: "10px 22px",
      borderBottom: "1px solid var(--b0)", background: "var(--bg-0)", flexShrink: 0, minWidth: 0, position: "relative" }}>
      <Button variant="ghost" size="xs" onClick={onBack} title="Back to all canvases" data-testid="canvas-back"
        style={{ flexShrink: 0, color: "var(--t3)" }}>
        <Icon name="back" size={12} /> Data Canvas
      </Button>
      <span data-testid="canvas-name" className="aug-fs-ui" title={name}
        style={{ ...ONE_LINE, minWidth: 64, flexShrink: 1, color: "var(--t1)", fontWeight: 600 }}>
        {name}
      </span>
      {what && (
        <span data-testid="canvas-what" className="aug-fs-sm" title={what}
          // A basis of 0: it takes only the room left. Shrink weights scale by each item's own width, so a long
          // description at flexShrink 6 still cut the name to "E-Commerce Operations Overv…" (2026-10-12, live).
          style={{ ...MUTED, ...ONE_LINE, flex: "1 1 0%" }}>{what}</span>
      )}
      {chips}
      <span style={{ marginLeft: "auto", ...ROW, flexWrap: "nowrap", flexShrink: 0, position: "relative" }}>{actions}{overlay}</span>
    </div>
  );
}

/** Who a canvas is shared with, and — for its owner — the choosing: a sheet's chooser, on the canvas's own doors. */
function CanvasSharePop({ canvas, onDone, onChanged }: {
  canvas: Canvas; onDone: () => void; onChanged: (s: SheetSharing) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCloseOutside(ref, onDone);
  // the chooser says "you" for its maker: the person asking is the maker when they own a canvas someone made
  const me = canvas.access === "own" && canvas.created_by ? canvas.created_by : undefined;
  return (
    <div ref={ref} role="dialog" aria-label={`Share · ${canvas.name}`} data-testid="canvas-share-pop" className="aug-fs-sm"
      style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 60, width: 380, background: "var(--bg-2)",
        border: "1px solid var(--b1)", borderRadius: "var(--r3)", padding: "10px 12px", display: "flex",
        flexDirection: "column", gap: 6, boxShadow: "var(--shadow-md)", textAlign: "left" }}>
      <span className="aug-fs-xs" style={MUTED}>Share · {canvas.name}</span>
      <ShareChooser id={canvas.id} me={me} read={readCanvasSharing} save={saveCanvasSharing} noun="canvas" onChanged={onChanged} />
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <Button variant="outline" size="xs" onClick={() => {
          const url = new URL(window.location.href);
          url.searchParams.set("tab", "canvas-workspace");
          url.searchParams.set("canvas", canvas.id);
          void navigator.clipboard?.writeText(url.toString());
        }}>Copy link</Button>
        <Button variant="ghost" size="xs" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

/** What the pinned documents are, read once: how many of them were deleted since — or that it could not be told. */
type PinnedState = { missing: number } | "unread" | null;

function usePinnedState(canvas: Canvas): PinnedState {
  const [state, setState] = useState<PinnedState>(null);
  const ids = (canvas.doc_ids ?? []).join("\u0000");
  useEffect(() => {
    if (!ids) { setState(null); return; }
    let alive = true;
    const want = ids.split("\u0000").length;
    getCanvasDocuments(canvas.id)
      // The read answers one entry per pinned id, deleted or not; fewer means it was not read.
      .then(d => { if (alive) setState(d.length < want ? "unread" : { missing: d.filter(x => x.missing).length }); })
      .catch(() => { if (alive) setState("unread"); });
    return () => { alive = false; };
  }, [canvas.id, ids]);
  return state;
}

function HeadChips({ canvas, connection, gone, pinned }: {
  canvas: Canvas; connection: Connection | undefined; gone: boolean; pinned: PinnedState;
}) {
  const docs = canvas.doc_ids?.length ?? 0;
  const giveWay: CSSProperties = { display: "inline-flex", flexShrink: 3, minWidth: 56, overflow: "hidden" };
  return (
    <>
      {gone ? (
        <Chip tone="amber" testId="canvas-connection-gone" title="This workspace no longer has the connection this canvas reads">
          connection gone
        </Chip>
      ) : connection && (
        <span data-testid="canvas-connection" title={`${connection.name} · ${connectionKind(connection)}`} style={giveWay}>
          <Chip>{connection.name}</Chip>
        </span>
      )}
      <span title={tablesTitle(canvas)} style={{ display: "inline-flex", flexShrink: 0 }}><Chip>{scopeWords(canvas)}</Chip></span>
      {docs > 0 && (pinned !== null && pinned !== "unread" && pinned.missing > 0 ? (
        <Chip tone="amber" testId="canvas-docs-missing" title="A pinned document was deleted — unpin it in Settings">
          {`${countNoun(docs, "document")} pinned · ${formatCount(pinned.missing)} deleted`}
        </Chip>
      ) : (
        <Chip testId="canvas-docs" title={pinned === "unread"
          ? "Could not check that they still exist"
          : "Always in reach for work done here; the rest of the documents stay searchable"}>
          {`${countNoun(docs, "document")} pinned${pinned === "unread" ? " · not checked" : ""}`}
        </Chip>
      ))}
      {canvas.is_legacy && <Chip title="Made automatically from a connection, not by a person">auto-generated</Chip>}
    </>
  );
}

// ── The landing — what the empty conversation opens on ────────────────────────────────────────────────────────────

/** How many of its tables the landing names before "Show all". */
const TABLES_NAMED = 10;

/** The tile the mark stands on: the coworker's first screen draws its mark the same way. */
const MARK_TILE: CSSProperties = {
  width: 72, height: 72, display: "grid", placeItems: "center", borderRadius: 14, color: "var(--t1)",
  background: "var(--bg-2)", border: "1px solid var(--b1)", boxShadow: "var(--shadow-md)",
};

/**
 * The canvas as the space a person has walked into (the user, 2026-11-20, beside another product's data space: "Are we in
 * 1990?" … "DBX does so grand!"): its mark on a tile, its name large, what it is for, and the tables it reads, named on
 * the page rather than counted with the names in a hover. It was a line counting tables ("What do you want to know about
 * these 24 tables?") over two chips naming a Quick/Agent choice this conversation no longer has; how to go deeper is
 * the conversation's own line, under this.
 */
function CanvasLanding({ canvas, connection, gone }: { canvas: Canvas; connection: Connection | undefined; gone: boolean }) {
  const names = tableNames(canvas);
  const [all, setAll] = useState(false);
  const shown = all ? names : names.slice(0, TABLES_NAMED);
  return (
    <div data-testid="canvas-landing" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center", paddingBottom: 4 }}>
      <span aria-hidden="true" style={{ ...MARK_TILE, marginBottom: 10 }}><PramanyxMark size={34} /></span>
      {/* h2: the page's own heading is the shell's title, which names it too */}
      <h2 data-testid="canvas-landing-name" className="aug-fs-hero" style={{ margin: 0, color: "var(--t1)", fontWeight: 600, overflowWrap: "anywhere" }}>
        {canvas.name}
      </h2>
      {canvas.description && (
        <p data-testid="canvas-landing-what" className="aug-fs-h2" style={{ margin: 0, color: "var(--t2)", lineHeight: 1.5 }}>{canvas.description}</p>
      )}
      <p data-testid="canvas-landing-reads" className="aug-fs-sm" style={{ margin: 0, color: "var(--t3)", lineHeight: 1.7 }}>
        {gone ? "The connection this canvas reads is gone from this workspace."
          : names.length === 0 ? `Reads every table of ${connection?.name ?? "its connection"}.`
          : <>
              <span style={{ color: "var(--t2)" }}>Reads {countNoun(names.length, "table")}</span>
              {" · "}{shown.join(" · ")}
              {names.length > TABLES_NAMED && (
                <Button variant="outline" size="xs" onClick={() => setAll(v => !v)} data-testid="canvas-landing-all"
                  style={{ marginLeft: 6, verticalAlign: "baseline" }}>
                  {all ? "Show fewer" : `Show all ${formatCount(names.length)}`}
                </Button>
              )}
            </>}
      </p>
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────────────────────────────────────────

function CanvasHistory({ canvasId, onOpen }: {
  canvasId: string;
  onOpen: (id: string, kind: RunKind) => void;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed read used to read as "No deep analyses yet in this Data Canvas".
  const [failed, setFailed] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [now] = useState(() => Date.now());

  useEffect(() => {
    setLoading(true);
    getCanvasHistory(canvasId, HISTORY_LIMIT)
      .then(list => { setItems(list); setFailed(null); })
      .catch(e => { setItems([]); setFailed(e instanceof Error ? e.message : String(e)); })
      .finally(() => setLoading(false));
  }, [canvasId, reload]);

  async function handleRemove(id: string) {
    setRemoving(id);
    setRemoveFailed(false);
    const prev = items;
    setItems(list => list.filter(it => it.id !== id));  // optimistic
    try {
      await deleteInvestigation(id);
    } catch {
      setItems(prev);  // restore on failure, and say so
      setRemoveFailed(true);
    } finally {
      setRemoving(null);
    }
  }

  const asked = useMemo(() => foldHistory(items), [items]);
  const meta = items.length > 0 && (
    <span className="aug-fs-xs" style={{ ...MUTED, ...NUM }} data-testid="canvas-history-meta">
      {items.length >= HISTORY_LIMIT ? `the latest ${formatCount(items.length)} runs` : countNoun(items.length, "run")}
      {asked.length < items.length ? ` · ${countNoun(asked.length, "question")}` : ""}
    </span>
  );
  const scope = (
    <Chip testId="canvas-history-scope"
      title="Runs on other canvases, and deep analyses that did not finish, are listed under Agent runs">
      this canvas · finished runs
    </Chip>
  );

  return (
    <Page testId="canvas-history">
      <Card label="History" right={<>{meta}{scope}</>} testId="canvas-history-card">
        {removeFailed && (
          <div role="alert" className="aug-fs-sm" style={{ color: "var(--t2)", marginBottom: 6 }}>
            Could not remove that run — it is still here.
          </div>
        )}
        {loading ? <Loading what="the history" />
          : failed !== null ? <ReadFailed what="this canvas's history" error={failed} onRetry={() => setReload(n => n + 1)} />
          : asked.length === 0 ? <Empty>Nothing asked on this canvas yet.</Empty>
          : asked.map((q, i) => (
            <AskedRow key={q.key} q={q} first={i === 0} now={now} removing={removing} open={open.has(q.group)}
              onToggle={() => setOpen(s => { const n = new Set(s); if (n.has(q.group)) n.delete(q.group); else n.add(q.group); return n; })}
              onOpen={run => onOpen(run.id, q.kind)}
              onRemove={handleRemove} />
          ))}
      </Card>
    </Page>
  );
}

/** One question: its words, its kind, how many times it was asked and when last — the newest run opens; each run,
 *  with its own Open and Remove, behind Details. */
function AskedRow({ q, first, now, removing, open, onToggle, onOpen, onRemove }: {
  q: AskedQuestion; first: boolean; now: number; removing: string | null; open: boolean;
  onToggle: () => void; onOpen: (run: HistoryItem) => void; onRemove: (id: string) => void;
}) {
  const state = runStateWord(q.latest.status);
  const many = q.runs.length > 1;
  return (
    <div data-testid="canvas-history-row" style={{ ...(first ? {} : RULE), padding: "7px 2px",
      opacity: removing === q.latest.id && !many ? 0.4 : 1 }}>
      <div className="group/run" onClick={() => onOpen(q.latest)}
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 12, alignItems: "center", cursor: "pointer" }}>
        <div style={{ ...ROW, flexWrap: "nowrap", minWidth: 0 }}>
          <span className="aug-fs-chrome" title={q.question} style={{ ...ONE_LINE, color: "var(--t1)" }}>{q.question}</span>
          <Chip>{RUN_KIND_WORD[q.kind]}</Chip>
          {many && <Chip testId="canvas-history-count" title={`Asked ${q.runs.length} times — the newest opens`}>{`×${q.runs.length}`}</Chip>}
          {state && <Chip tone={state.tone}>{state.word}</Chip>}
        </div>
        <span className="aug-fs-sm" title={formatTimestamp(q.latest.started_at, "short")}
          style={{ ...MUTED, ...NUM, whiteSpace: "nowrap" }}>{agoWords(q.latest.started_at, now)}</span>
        {many ? (
          <Button variant="ghost" size="xs" aria-expanded={open} onClick={e => { e.stopPropagation(); onToggle(); }}>
            Details <Icon name={open ? "chevu" : "chevd"} size={12} />
          </Button>
        ) : (
          <Button variant="ghost" size="icon-xs" title="Remove from history" aria-label="Remove from history"
            disabled={removing === q.latest.id} className={HIDDEN_UNTIL_HOVER}
            onClick={e => { e.stopPropagation(); onRemove(q.latest.id); }}>
            <Icon name="trash" size={13} />
          </Button>
        )}
      </div>
      {many && open && (
        <div data-testid="canvas-history-runs" style={{ padding: "4px 0 2px 14px" }}>
          {q.runs.map(run => {
            const s = runStateWord(run.status);
            return (
              <div key={run.id} className="group/run aug-fs-sm"
                style={{ ...ROW, flexWrap: "nowrap", padding: "3px 0", opacity: removing === run.id ? 0.4 : 1 }}>
                <span style={{ ...MUTED, ...NUM, whiteSpace: "nowrap" }}>{formatTimestamp(run.started_at, "short")}</span>
                {s && <Chip tone={s.tone}>{s.word}</Chip>}
                <span style={{ marginLeft: "auto", ...ROW, flexWrap: "nowrap" }}>
                  <Button variant="ghost" size="xs" onClick={() => onOpen(run)}>Open</Button>
                  <Button variant="ghost" size="icon-xs" title="Remove from history" aria-label="Remove from history"
                    disabled={removing === run.id} onClick={() => onRemove(run.id)}>
                    <Icon name="trash" size={13} />
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ── CanvasWorkspace ───────────────────────────────────────────────────────────────────────────────────────────────

interface Props {
  canvas: Canvas;
  connections: Connection[];
  /** Every connection the install has — for the connection's chip and "connection gone"; Configure keeps this
   *  workspace's own. */
  allConnections?: Connection[];
  onClose: () => void;
  onCanvasUpdate: (canvas: Canvas) => void;
  initialOpenInvId?: string | null;
  initialRestoreSessionId?: string | null;
  /** Open the global document corpus (Intelligence → Documents). */
  onOpenDocuments?: () => void;
  /** The workspace the Briefing tab reads its range in — the same range as the Briefing page. */
  workspaceId?: string;
  /** Open another canvas in its place — a clone, once it is made. */
  onOpenCanvas?: (canvas: Canvas) => void;
}

export function CanvasWorkspace({ canvas, connections, allConnections, onClose, onCanvasUpdate, initialOpenInvId, initialRestoreSessionId, onOpenDocuments, workspaceId, onOpenCanvas }: Props) {
  // A canvas reading another workspace's connection still has it: the chip and "connection gone" read every connection
  // the install has (2026-10-12, judged against this workspace's alone two live canvases read "gone").
  const known = allConnections?.length ? allConnections : connections;
  const [wsTab, setWsTab] = useState<WsTab>("chat");
  const [chatKey, setChatKey] = useState(0);
  // Which conversation has begun (its key): until it has, the landing says what the canvas is for, so the header does not.
  const [begunKey, setBegunKey] = useState<number | null>(null);
  const [openInvId, setOpenInvId] = useState<string | null>(null);
  const [restoreSessionId, setRestoreSessionId] = useState<string | null>(null);
  // Seed question for ChatPanel, set by the canvas-scoped Intelligence actions that start a deep analysis.
  // ChatPanel only auto-submits on a fresh mount, so every path that bumps chatKey for
  // another reason must clear the seed or the stale question would re-submit.
  const [chatInitialQuestion, setChatInitialQuestion] = useState<string | undefined>(undefined);
  const [chatInitialMode, setChatInitialMode] = useState<"ask" | "investigate" | undefined>(undefined);
  const [showConfigure, setShowConfigure] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  // ⋮ ▸ Certify opens the mark's form beside the name, once per asking (a dashboard's title row does the same)
  const [certifying, setCertifying] = useState(0);
  // what a door could not do — a clone that failed — said beside the name until the next door is used
  const [doorSaid, setDoorSaid] = useState<string | null>(null);
  // The Briefing tab mounts on its first opening — opening a canvas reads no edition — and then stays mounted.
  const [briefingOpened, setBriefingOpened] = useState(false);

  const connectionId = canvas.scopes[0]?.connection_id ?? "";
  const connection = known.find(c => c.id === connectionId);
  const gone = connectionGone(canvas, known);
  const pinned = usePinnedState(canvas);

  // When canvas changes, reset to chat tab, but honour initial props. The canvas on screen is remembered so a canvas just
  // opened keeps the chat it mounted with: remounting that chat dropped the conversation a reloaded address names.
  const shownCanvas = useRef<string | null>(null);
  useEffect(() => {
    const changed = shownCanvas.current !== null && shownCanvas.current !== canvas.id;
    shownCanvas.current = canvas.id;
    setChatInitialQuestion(undefined);
    setChatInitialMode(undefined);
    setBriefingOpened(false);
    if (initialOpenInvId) {
      setWsTab("history");
      setOpenInvId(initialOpenInvId);
      setRestoreSessionId(null);
      setChatKey(k => k + 1);
    } else if (initialRestoreSessionId) {
      setWsTab("chat");
      setRestoreSessionId(initialRestoreSessionId);
      setOpenInvId(null);
      setChatKey(k => k + 1);
    } else {
      setWsTab("chat");
      if (changed) setChatKey(k => k + 1);
      setOpenInvId(null);
      setRestoreSessionId(null);
    }
  }, [canvas.id, initialOpenInvId, initialRestoreSessionId]);

  // History line-item → navigate.  Deep analyses open the detail report in the
  // History tab; chat sessions restore the conversation in the Chat tab (passing
  // a chat id to the deep-analysis detail panel would just render blank — the bug
  // behind "choosing a line item does not take me there").
  const handleHistoryOpen = (id: string, kind: RunKind) => {
    if (kind === "chat") {
      setOpenInvId(null);
      setRestoreSessionId(id);
      setChatInitialQuestion(undefined);
      setChatInitialMode(undefined);
      setWsTab("chat");
      setChatKey(k => k + 1);
    } else {
      setRestoreSessionId(null);
      setOpenInvId(id);
      setWsTab("history");
    }
  };

  const showView = (id: WsTab) => {
    setWsTab(id);
    if (id === "briefing") setBriefingOpened(true);
    setOpenInvId(null);
  };

  // A decision or a question on the Briefing taken into deep analysis: a fresh conversation in this canvas asks it.
  const deepAnalysis = (question: string) => {
    setOpenInvId(null);
    setRestoreSessionId(null);
    setChatInitialQuestion(question);
    setChatInitialMode(DEEP_ANALYSIS_MODE);
    setWsTab("chat");
    setChatKey(k => k + 1);
  };

  const newConversation = () => {
    setWsTab("chat"); setChatKey(k => k + 1); setOpenInvId(null); setRestoreSessionId(null);
    setChatInitialQuestion(undefined); setChatInitialMode(undefined);
  };

  // The landing shows: a fresh conversation in the Chat view, not yet begun.
  const onLanding = wsTab === "chat" && !openInvId && !restoreSessionId && !chatInitialQuestion && begunKey !== chatKey;

  const clone = async () => {
    setDoorSaid(null);
    try {
      const copy = await cloneCanvas(canvas.id);
      (onOpenCanvas ?? onCanvasUpdate)(copy);
    } catch (e) {
      setDoorSaid(`Not cloned — ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const doors = (
    <span data-testid="canvas-doors" style={{ ...ROW, flexWrap: "nowrap", gap: 4, flexShrink: 0 }}>
      {wsTab !== "chat" && (
        <Button variant="outline" size="xs" onClick={() => showView("chat")} data-testid="canvas-to-chat"
          title="Back to the conversation you were in">
          <Icon name="chat" size={13} /> Conversation
        </Button>
      )}
      <Button variant="ghost" size="icon-xs" onClick={newConversation} title="New conversation" aria-label="New conversation"
        data-testid="canvas-new-chat">
        <Icon name="edit" size={15} />
      </Button>
      <Button variant="ghost" size="icon-xs" aria-pressed={wsTab === "history"} aria-label="History" data-testid="canvas-history-door"
        title={wsTab === "history" ? "Back to the conversation" : "History — what was asked on this canvas"}
        onClick={() => showView(wsTab === "history" ? "chat" : "history")}>
        <Icon name="history" size={15} />
      </Button>
      <Button variant="outline" size="xs" aria-pressed={showConfigure} data-testid="canvas-configure"
        title="Its tables, instructions, documents, versions and saved artifacts"
        onClick={() => { setShowConfigure(v => !v); setSharingOpen(false); }}>
        <Icon name="settings" size={13} /> Configure
      </Button>
      <Button variant="secondary" size="xs" aria-pressed={sharingOpen} data-testid="canvas-share"
        title={canvas.sharing === "chosen" ? "Shared with the people and groups chosen" : "Shared with everyone in the workspace"}
        onClick={() => { setSharingOpen(v => !v); setShowConfigure(false); }}>
        <Icon name={canvas.sharing === "chosen" ? "lock" : "users"} size={13} /> Share
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Button variant="ghost" size="icon-xs" aria-label="More" title="Its Briefing, Clone, Certify" data-testid="canvas-more">
            <Icon name="morev" size={15} />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content size="1" align="end">
          <DropdownMenu.Item onSelect={() => showView("briefing")} data-testid="canvas-more-briefing">Briefing</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => void clone()} data-testid="canvas-more-clone">Clone</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => setCertifying(n => n + 1)} data-testid="canvas-more-certify">Certify or deprecate…</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </span>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-canvas)" }}>

      {/* What it is for is said once: on the landing while it shows, beside the name once a conversation has begun. */}
      <CanvasHead name={canvas.name} what={onLanding ? undefined : canvas.description || undefined} onBack={onClose}
        chips={<>
          <HeadChips canvas={canvas} connection={connection} gone={gone} pinned={pinned} />
          <CertificationMark compact menu openRequest={certifying} target={{ kind: "canvas", ref: canvas.id, connectionId }} />
          {doorSaid && <span role="alert" className="aug-fs-sm" style={{ color: "var(--red4)" }}>{doorSaid}</span>}
        </>}
        actions={doors}
        overlay={sharingOpen && (
          <CanvasSharePop canvas={canvas} onDone={() => setSharingOpen(false)}
            onChanged={s => onCanvasUpdate({ ...canvas, sharing: s.sharing,
              shared_with: s.shared_with.map(({ kind, id, level }) => ({ kind, id, level })) })} />
        )} />

      {/* ── Content ── */}
      {/*
        IMPORTANT: all three panels are always mounted — never conditionally rendered.
        Switching tabs uses CSS display:none so React keeps each panel's state alive.
        Unmounting ChatPanel mid-analysis kills its SSE stream and message list;
        the user comes back to a blank window even though the backend finished fine.
      */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>

        {/* Chat — always mounted, hidden when not active */}
        <div style={{
          display: wsTab === "chat" ? "flex" : "none",
          flex: 1, flexDirection: "column", overflow: "hidden",
        }}>
          <ChatPanel
            key={chatKey}
            harness
            oneConversation
            address={`canvas:${canvas.id}`}
            connectionId={connectionId}
            canvasId={canvas.id}
            restoreSessionId={restoreSessionId}
            initialQuestion={chatInitialQuestion}
            initialMode={chatInitialMode}
            capabilities={<CanvasLanding canvas={canvas} connection={connection} gone={gone} />}
            onSession={() => setBegunKey(chatKey)}
          />
        </div>

        {/* Briefing — mounted on first opening, then hidden when not active. A canvas on every table reads the
            dataset's own edition; one that names tables, its own. */}
        {briefingOpened && (
          <div data-testid="canvas-briefing" style={{
            display: wsTab === "briefing" ? "flex" : "none",
            flex: 1, flexDirection: "column", overflow: "hidden",
          }}>
            <BriefingEdition connectionId={connectionId} schema={canvas.scopes[0]?.schema_name ?? connection?.schema_name ?? undefined}
              workspaceId={workspaceId} canvasId={canvas.id} onDeepAnalysis={deepAnalysis} />
          </div>
        )}

        {/* History — always mounted, hidden when not active */}
        <div style={{
          display: wsTab === "history" ? "flex" : "none",
          flex: 1, flexDirection: "column", overflow: "hidden",
        }}>
          {openInvId
            ? (
              // Back folds into HistoryDetailPanel's Report/Evidence tab bar (onBack), so viewing a run is 2 chrome
              // rows, not 4. Flex column (not a bare overflow block) so HistoryDetailPanel's flex:1 +
              // position:absolute report area gets a resolved height (without it the report collapses to 0px).
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                <HistoryDetailPanel
                  invId={openInvId}
                  onBack={() => setOpenInvId(null)}
                  // The follow-up asked under a past run opens a fresh conversation that asks it: the seed ChatPanel
                  // submits on mount, as the chat screen's history does.
                  onContinue={(question, mode) => {
                    setOpenInvId(null);
                    setRestoreSessionId(null);
                    setChatInitialQuestion(question);
                    setChatInitialMode(mode);
                    setWsTab("chat");
                    setChatKey(k => k + 1);
                  }}
                />
              </div>
            )
            : <CanvasHistory canvasId={canvas.id} onOpen={handleHistoryOpen} />
          }
        </div>

        {/* Artifacts are Configure's tab now (the user, 2026-11-20). */}
      </div>

      {/* Configure slide-over */}
      {showConfigure && (
        <ConfigurePanel
          onOpenDocuments={onOpenDocuments}
          canvas={canvas}
          connections={connections}
          onClose={() => setShowConfigure(false)}
          onCanvasUpdate={onCanvasUpdate}
        />
      )}
    </div>
  );
}
