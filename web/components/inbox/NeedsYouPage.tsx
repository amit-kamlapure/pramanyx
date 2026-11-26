"use client";

/**
 * The Inbox — one view over everything that waits on a person (the Atlas plan's §7.8, decision 2; the user, 2026-11-25:
 * "Yes to all three"; 2026-11-26: "go ahead with the Inbox"). Before it, what waited was spread over seven surfaces:
 * staged proposals on Agent Ops, the deep analyses' recommendations here, monitor and agent alerts in two stores, the
 * knowledge review on each connection's Semantic Layer and the Atlas.
 *
 * Laid out as the reference lays out a list and what was clicked: on the left the lanes, each with what the person has
 * not opened, and — for the knowledge review — its Areas; in the middle the lane's rows, each Discover's row (the user,
 * 2026-11-26: Discover's design followed everywhere touched), unread ones in bold; a row clicked opens in a tab of the
 * side panel with what settles it there — Accept, Edit and accept, Reject, Not now for a review row; the approval card
 * for a staged change; Acknowledge for an alert. Opening a row marks it read for this person; a lane can be marked read
 * at once. The deep analyses' recommendations keep their own page in the Recommendations lane, whole.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Card, Chip, Empty, MUTED, Page, ROW } from "@/components/clarity/kit";
import { DefinitionView } from "@/components/definitions/DefinitionView";
import { inPlace, Said } from "@/components/discover/parts";
import { ProposalCardById } from "@/components/ProposalCard";
import { RecommendationInbox } from "@/components/RecommendationInbox";
import { useInspector, type InspectorSubject } from "@/components/shell/Inspector";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { IconSquare } from "@/components/ui/icon-square";
import { ResizeGrip, useKeptWidth } from "@/components/ui/resize-grip";
import { Loading, ReadFailed } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { openInApp } from "@/lib/addressOnce";
import { acknowledgeAgentAlert, acknowledgeAlert } from "@/lib/api";
import { areaIcon } from "@/lib/areaIcons";
import { areaTone, reviewWord } from "@/lib/areaMap";
import { approverName } from "@/lib/auth";
import { readAtlasReview } from "@/lib/discover";
import { formatCount, relTime } from "@/lib/format";
import {
  answerAccess, markRead, readNeedsYou, reviewKey, settle, SOURCE_WORDS, STAGED_CHANGE, waitedWords,
  type ForYouRow, type NeedsYou, type ReviewAction, type ReviewArea, type ReviewRowWithDoors, type WaitingRow,
} from "@/lib/needsYou";
import { Input } from "@/components/ui/input";
import { WAITING_CHANGED_EVENT, setItemAside } from "@/lib/record";

type LaneId = "for_you" | "decide" | "alerts" | "recommendations" | "review";
const LANE_ICON: Record<LaneId, IconName> = { for_you: "user", decide: "check", alerts: "bell", recommendations: "idea", review: "words" };
const SOURCE_ICON: Record<string, IconName> = {
  access_request: "key", access_answer: "lock", mention: "message",
  [STAGED_CHANGE]: "bolt", automation_approval: "recurring", paused_run: "run", automation_broken: "warning",
  agent_alert: "agents", monitor_alert: "monitor",
};
const RAIL_MIN = 220, RAIL_MAX = 520, RAIL_DEFAULT = 280;
/** How long "Not now" sets a review row aside. */
const NOT_NOW_DAYS = 30;

const told = () => window.dispatchEvent(new Event(WAITING_CHANGED_EVENT));
const errorWords = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function NeedsYouPage({ workspaceId, onOpenRun }: {
  workspaceId?: string;
  onOpenRun?: (runId: string) => void;
}) {
  const [view, setView] = useState<NeedsYou | null>(null);
  const [failed, setFailed] = useState("");
  const [tick, setTick] = useState(0);
  // null: the first lane with something in it — what is addressed to you alone, else what waits to be decided
  const [chosenLane, setLane] = useState<LaneId | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [railWidth, keepRailWidth] = useKeptWidth("pramanyx_inbox_rail_width", RAIL_DEFAULT, RAIL_MIN, RAIL_MAX);
  const inspector = useInspector();
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    readNeedsYou(workspaceId)
      .then((v) => { if (live) { setView(v); setFailed(""); } })
      .catch((e) => { if (live) setFailed(errorWords(e)); });
    return () => { live = false; };
  }, [workspaceId, tick]);

  /** Mark rows read here at once, and for the person on the server; the rail's count follows. */
  const read = useCallback((keys: string[], isRead = true) => {
    setView((v) => (v ? {
      ...v,
      lanes: v.lanes.map((l) => ("rows" in l ? { ...l, rows: l.rows.map((r) => (keys.includes(r.key) ? { ...r, read: isRead } : r)),
        unread: l.rows.filter((r) => !(keys.includes(r.key) ? isRead : r.read)).length } : l)) as NeedsYou["lanes"],
    } : v));
    markRead(keys, isRead, workspaceId).then(told).catch(() => {});
  }, [workspaceId]);

  const done = useCallback((key: string, words: string) => {
    toast.success(words);
    inspector.close(key);
    told();
    reload();
  }, [inspector, reload]);

  if (failed && !view) return <Page testId="needs-you"><ReadFailed what="what waits on you" error={failed} onRetry={reload} /></Page>;
  if (!view) return <Page testId="needs-you"><Loading what="what waits on you" /></Page>;
  const [forYou, decide, alerts, review] = view.lanes;
  const lane: LaneId = chosenLane ?? (forYou.count ? "for_you" : "decide");
  const lanes: { id: LaneId; title: string; unread: number | null; count: number | null }[] = [
    { id: "for_you", title: forYou.title, unread: forYou.unread, count: forYou.count },
    { id: "decide", title: decide.title, unread: decide.unread, count: decide.count },
    { id: "alerts", title: alerts.title, unread: alerts.unread, count: alerts.count },
    { id: "recommendations", title: "Recommendations", unread: null, count: null },
    { id: "review", title: review.title, unread: review.mine_unread, count: review.count },
  ];
  const openWaiting = (r: WaitingRow) => {
    inspector.inspect(waitingSubject(r, { onOpenRun, done }));
    if (!r.read) read([r.key]);
  };
  const openForYou = (r: ForYouRow) => {
    const o = r.open;
    if (r.source === "mention" && o && o.kind === "definition") {
      inspector.inspect(definitionSubject({ connection: o.connection_id, term: o.term, area: o.area }, false));
    } else {
      inspector.inspect(forYouSubject(r, { done }));
    }
    if (!r.read) read([r.key]);
  };

  return (
    <div data-testid="needs-you" style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
      <div style={{ position: "relative", flex: "0 0 auto", width: railWidth, maxHeight: "100%", display: "flex" }}>
        <aside aria-label="What waits on you, by lane" style={{ flex: 1, minWidth: 0, background: "var(--bg-2)", padding: "14px 12px 20px",
          display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", boxSizing: "border-box" }}>
          <span className="aug-fs-xs" style={MUTED}>Needs you</span>
          <div role="tablist" aria-label="Lanes" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {lanes.map((l) => (
              <Button key={l.id} role="tab" aria-selected={lane === l.id} variant="ghost" size="sm" data-testid={`needs-lane-${l.id}`}
                onClick={() => { setLane(l.id); setArea(null); }}
                style={{ justifyContent: "flex-start", gap: 10, height: 32, padding: "0 8px",
                  ...(lane === l.id ? { background: "var(--bg-3)", color: "var(--t1)" } : { color: "var(--t2)" }) }}>
                <Icon name={LANE_ICON[l.id]} size={15} />
                <span className="aug-fs-sm" style={{ flex: 1, textAlign: "left", fontWeight: l.unread ? 600 : 400 }}>{l.title}</span>
                {l.unread ? <Chip tone="accent" title="not opened yet">{formatCount(l.unread)}</Chip>
                  : l.count != null && <span className="aug-fs-xs" style={MUTED}>{formatCount(l.count)}</span>}
              </Button>
            ))}
          </div>
          {lane === "review" && (
            <ReviewAreas areas={review.areas} chosen={area} onChoose={setArea} mine={review.mine} />
          )}
        </aside>
        <ResizeGrip edge="right" width={railWidth} min={RAIL_MIN} max={RAIL_MAX} onWidth={keepRailWidth} label="Resize the lanes" />
      </div>
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
        <Page testId={`needs-you-${lane}`}>
          <Said lines={view.said} />
          {lane === "for_you" && (
            <WaitingCard lane={forYou} empty="Nothing is addressed to you alone: no ask for access to something you made, no answer to an ask of yours, no comment that mentions you."
              onOpen={(r) => openForYou(r as ForYouRow)} onAllRead={() => read(forYou.rows.filter((r) => !r.read).map((r) => r.key))} />
          )}
          {lane === "decide" && (
            <WaitingCard lane={decide} empty="Nothing waits for your decision: no staged change, no paused analysis, no automation stuck."
              onOpen={openWaiting} onAllRead={() => read(decide.rows.filter((r) => !r.read).map((r) => r.key))} />
          )}
          {lane === "alerts" && (
            <WaitingCard lane={alerts} empty="No alert waits on you: every monitor's is acknowledged or closed by its recovery."
              onOpen={openWaiting} onAllRead={() => read(alerts.rows.filter((r) => !r.read).map((r) => r.key))} />
          )}
          {lane === "recommendations" && <RecommendationInbox onOpenInvestigation={onOpenRun} workspaceId={workspaceId} />}
          {lane === "review" && (area
            ? <ReviewRows area={area} areaName={review.areas.find((a) => a.id === area)?.name ?? area} workspaceId={workspaceId}
                onOpen={(r) => {
                  inspector.inspect(reviewSubject(r, { done, inspect: inspector.inspect }));
                  read([reviewKey(r)]);
                }} />
            : (
              <Card label="Knowledge review" testId="needs-review-summary" right={
                <span className="aug-fs-xs">{review.read_at ? `read ${relTime(review.read_at)} ago` : ""}</span>}>
                <p className="aug-fs-sm" style={{ margin: 0, color: "var(--t2)" }}>
                  {`${formatCount(review.count)} wait for review across the Areas in view, ${formatCount(review.unplaced)} in no Area. `}
                  {review.mine ? `${formatCount(review.mine)} are in the Areas you answer for — ${formatCount(review.mine_unread)} not opened.`
                    : "You answer for no Area yet: the rail counts none of them as yours."}
                </p>
                <p className="aug-fs-sm" style={{ ...MUTED, margin: "8px 0 0" }}>Choose an Area on the left to review what waits in it.</p>
              </Card>
            ))}
        </Page>
      </div>
    </div>
  );
}

// ── the lanes' parts ──────────────────────────────────────────────────────────────────────────────────────────────

function WaitingCard({ lane, empty, onOpen, onAllRead }: {
  lane: NeedsYou["lanes"][1]; empty: string; onOpen: (r: WaitingRow) => void; onAllRead: () => void;
}) {
  return (
    <Card label={lane.title} testId={`needs-card-${lane.id}`} right={
      <span className="aug-fs-xs" style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
        <span>{`${formatCount(lane.count)} waiting · ${formatCount(lane.unread)} not opened`}</span>
        {lane.unread > 0 && <Button size="xs" variant="link" onClick={onAllRead}>Mark all read</Button>}
      </span>}>
      {lane.not_read.length > 0 && <Said lines={[`Not read: ${lane.not_read.join(", ").replace(/_/g, " ")}.`]} />}
      {lane.rows.length === 0 ? <Empty>{empty}</Empty> : lane.rows.map((r) => <WaitingRowView key={r.key} r={r} onOpen={onOpen} />)}
    </Card>
  );
}

/** A waiting thing as Discover draws a row: its glyph, what it is on one line, its kind, connection and how long it has
 *  waited on the next; unread in bold with a dot. */
function WaitingRowView({ r, onOpen }: { r: WaitingRow; onOpen: (r: WaitingRow) => void }) {
  const line = [r.line, SOURCE_WORDS[r.source] ?? r.source, r.connection_name,
    r.waiting_ms != null ? `waiting ${waitedWords(r.waiting_ms)}` : r.since && r.lane === "for_you" ? relTime(r.since) : ""]
    .filter(Boolean).join(" · ");
  return (
    <div className="aug-discover-row" data-testid="needs-row" data-read={r.read || undefined}>
      <a href="#" title={r.title} onClick={(e) => inPlace(e, () => onOpen(r))}>
        <span className="k"><Icon name={SOURCE_ICON[r.source] ?? "dot"} size={15} /></span>
        <span className="main">
          <span className="n aug-fs-chrome" style={r.read ? undefined : { fontWeight: 650 }}>{r.title}</span>
          <span className="d aug-fs-sm">{line}</span>
        </span>
        <span className="meta aug-fs-xs">
          {r.severity && r.severity !== "info" && <Chip tone={r.severity === "critical" ? "down" : "amber"}>{r.severity}</Chip>}
          {!r.read && <span aria-label="not opened" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} />}
        </span>
      </a>
    </div>
  );
}

function ReviewAreas({ areas, chosen, onChoose, mine }: {
  areas: ReviewArea[]; chosen: string | null; onChoose: (id: string) => void; mine: number;
}) {
  const ordered = useMemo(() => [...areas].sort((a, b) => Number(b.mine) - Number(a.mine)), [areas]);
  return (
    <section aria-label="By Area" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="aug-fs-xs" style={{ ...MUTED, padding: "0 8px 4px" }}>{mine ? "Yours first, then every Area" : "By Area"}</span>
      {ordered.map((a) => (
        <Button key={a.id} variant="ghost" size="sm" data-testid={`needs-area-${a.id}`} aria-pressed={chosen === a.id}
          onClick={() => onChoose(a.id)}
          style={{ justifyContent: "flex-start", gap: 8, height: "auto", padding: "5px 8px",
            ...(chosen === a.id ? { background: "var(--bg-3)" } : {}) }}>
          <IconSquare name={areaIcon(a.icon)} size={20} tone={a.id === "none" ? undefined : areaTone(a.id)} />
          <span className="aug-fs-sm" style={{ flex: 1, textAlign: "left", color: "var(--t1)", fontWeight: a.unread && a.mine ? 600 : 400 }}>{a.name}</span>
          <span className="aug-fs-xs" style={MUTED}>{formatCount(a.count)}</span>
        </Button>
      ))}
    </section>
  );
}

/** What waits for review in one Area, its sub-Areas' rolled up, the busiest first — Discover's rows. */
function ReviewRows({ area, areaName, workspaceId, onOpen }: {
  area: string; areaName: string; workspaceId?: string; onOpen: (r: ReviewRowWithDoors) => void;
}) {
  const [got, setGot] = useState<{ area: string; rows: ReviewRowWithDoors[]; total: number; aside: number } | { area: string; failed: string } | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    readAtlasReview(area, workspaceId, tries > 0)
      .then((r) => { if (live) setGot({ area, rows: r.items as ReviewRowWithDoors[], total: r.total, aside: (r as { set_aside?: number }).set_aside ?? 0 }); })
      .catch((e) => { if (live) setGot({ area, failed: errorWords(e) }); });
    return () => { live = false; };
  }, [area, workspaceId, tries]);
  const here = got?.area === area ? got : null;
  return (
    <Card label={areaName} testId="needs-review-rows" right={here && "rows" in here ? (
      <span className="aug-fs-xs">{`${formatCount(here.total)} waiting${here.aside ? ` · ${formatCount(here.aside)} set aside` : ""}`}</span>) : undefined}>
      {here === null ? <Loading what="what waits for review" />
        : "failed" in here ? <ReadFailed what="what waits for review" error={here.failed} onRetry={() => setTries((n) => n + 1)} />
        : here.rows.length === 0 ? <Empty>Nothing waits for review in this Area.</Empty>
        : here.rows.slice(0, 100).map((r) => (
          <div key={`${r.connection_id}:${r.id}`} className="aug-discover-row" data-testid="needs-review-row">
            <a href={r.resolve.href ?? "#"} title={r.title} onClick={(e) => inPlace(e, () => onOpen(r))}>
              <span className="k"><Icon name="words" size={15} /></span>
              <span className="main">
                <span className="n aug-fs-chrome">{r.title}</span>
                <span className="d aug-fs-sm">{[r.connection_name, r.count ? `asked ${formatCount(r.count)} times` : "",
                  r.complaints ? `${formatCount(r.complaints)} complaints` : "", r.at ? relTime(r.at) : ""].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="meta aug-fs-xs"><Chip>{reviewWord(r.source, r.kind)}</Chip></span>
            </a>
          </div>
        ))}
    </Card>
  );
}

// ── what opens on the right ───────────────────────────────────────────────────────────────────────────────────────

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "8px 12px", alignItems: "baseline" }}>
      {shown.map(([k, v]) => (
        <span key={k} style={{ display: "contents" }}>
          <span className="aug-fs-sm" style={MUTED}>{k}</span>
          <span className="aug-fs-sm" style={{ color: "var(--t1)", wordBreak: "break-word" }}>{v}</span>
        </span>
      ))}
    </div>
  );
}

function WaitingPage({ r, onOpenRun, done }: {
  r: WaitingRow; onOpenRun?: (runId: string) => void; done: (key: string, words: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const ack = async () => {
    setBusy(true);
    try {
      if (r.source === "agent_alert") await acknowledgeAgentAlert(r.id); else await acknowledgeAlert(r.id);
      done(`${r.source}:${r.id}`, "Acknowledged");
    } catch (e) { toast.error("Not acknowledged", { description: errorWords(e) }); setBusy(false); }
  };
  const proposal = r.source === STAGED_CHANGE ? r.id : r.source === "automation_approval" ? r.resolve.proposal_id : "";
  return (
    <div data-testid="needs-open" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span className="aug-fs-sm" style={MUTED}>{[SOURCE_WORDS[r.source] ?? r.source, r.connection_name].filter(Boolean).join(" · ")}</span>
      <span className="aug-fs-h1" style={{ color: "var(--t1)", fontWeight: 600, lineHeight: 1.3, wordBreak: "break-word" }}>{r.title}</span>
      <Facts rows={[
        ["Waiting", waitedWords(r.waiting_ms)],
        ["Since", r.since ? relTime(r.since) : ""],
        ["Severity", r.severity ?? ""],
        ["Metric", r.metric ?? ""],
      ]} />
      {proposal && (
        <ProposalCardById proposalId={proposal} actor={approverName("inbox")}
          onResolved={(status, message) => (status === "ok" ? done(`${r.source}:${r.id}`, message || "Done") : toast.error(message))} />
      )}
      <span style={{ ...ROW, gap: 8 }}>
        {(r.source === "monitor_alert" || r.source === "agent_alert") && (
          <Button size="xs" disabled={busy} onClick={() => void ack()}>{busy ? "Acknowledging…" : "Acknowledge"}</Button>
        )}
        {r.source === "monitor_alert" && (
          <Button size="xs" variant="outline" onClick={() => openInApp("/?tab=monitors")}>Open its monitor <Icon name="external" size={12} /></Button>
        )}
        {r.source === "paused_run" && onOpenRun && (
          <Button size="xs" variant="outline" onClick={() => onOpenRun(r.id)}>Open the analysis <Icon name="external" size={12} /></Button>
        )}
        {(r.source === "automation_broken" || r.source === "automation_approval") && r.resolve.automation_id && (
          <Button size="xs" variant="outline"
            onClick={() => openInApp(`/?tab=agentic-ops&layer=automations&automation=${encodeURIComponent(r.resolve.automation_id)}`)}>
            Open its automation <Icon name="external" size={12} />
          </Button>
        )}
      </span>
    </div>
  );
}

/** An ask for access opened on the right: who asks, for what and why — Share it, or Decline saying why; the answer to
 *  your own ask, with the thing to open when it was shared. */
function ForYouPage({ r, done }: { r: ForYouRow; done: (key: string, words: string) => void }) {
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const a = r.ask;
  const go = async (accept: boolean) => {
    if (!a) return;
    setBusy(true);
    try {
      await answerAccess(a.id, accept, why);
      done(r.key, accept ? `Shared “${a.name}” with ${a.asker} to read` : `Declined — ${a.asker} is told why`);
    } catch (e) { toast.error(accept ? "Not shared" : "Not declined", { description: errorWords(e) }); setBusy(false); }
  };
  const o = r.open;
  return (
    <div data-testid="needs-for-you-open" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span className="aug-fs-sm" style={MUTED}>{SOURCE_WORDS[r.source] ?? r.source}</span>
      <span className="aug-fs-h1" style={{ color: "var(--t1)", fontWeight: 600, lineHeight: 1.3, wordBreak: "break-word" }}>{r.title}</span>
      {a && <Facts rows={[
        ["What", `${a.thing === "canvas" ? "Data Canvas" : "Sheet"} “${a.name}”`],
        ["Asked by", a.asker],
        ["Why", a.reason || "No reason given"],
        ["Asked", a.asked_at ? relTime(a.asked_at) : ""],
        ["Answer", a.status === "pending" ? "" : a.status === "rejected" ? `declined — ${a.why}` : "shared to read"],
      ]} />}
      {r.source === "access_request" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ ...ROW, gap: 8 }}>
            <Button size="xs" disabled={busy} onClick={() => void go(true)} data-testid="access-share">Share it to read</Button>
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void go(false)} data-testid="access-decline">Decline</Button>
          </span>
          <Input aria-label="Why not" placeholder="Why not (said to them when you decline)" value={why} maxLength={500}
            onChange={(e) => setWhy(e.target.value)} />
        </div>
      )}
      {r.source === "access_answer" && o && o.kind !== "definition" && (
        <span style={{ ...ROW, gap: 8 }}>
          <Button size="xs" variant="outline" data-testid="access-open"
            onClick={() => openInApp(o.kind === "canvas" ? `/?tab=canvas-workspace&canvas=${encodeURIComponent(o.id)}`
              : `/?tab=spreadsheets&id=${encodeURIComponent(o.id)}`)}>
            Open it <Icon name="external" size={12} />
          </Button>
        </span>
      )}
    </div>
  );
}

function forYouSubject(r: ForYouRow, ctx: { done: (key: string, words: string) => void }): InspectorSubject {
  return { key: r.key, kind: SOURCE_WORDS[r.source] ?? r.source, title: r.title, icon: SOURCE_ICON[r.source] ?? "dot",
    bare: true, tabs: { overview: <ForYouPage r={r} done={ctx.done} /> } };
}

function waitingSubject(r: WaitingRow, ctx: { onOpenRun?: (runId: string) => void; done: (key: string, words: string) => void }): InspectorSubject {
  return { key: `${r.source}:${r.id}`, kind: SOURCE_WORDS[r.source] ?? r.source, title: r.title, icon: SOURCE_ICON[r.source] ?? "dot",
    bare: true, tabs: { overview: <WaitingPage r={r} onOpenRun={ctx.onOpenRun} done={ctx.done} /> } };
}

/** A Definition, or a new one with its word filled in, as a tab of its own — the page it has everywhere. */
function definitionSubject(o: { connection: string; term: string; area: string }, isNew: boolean): InspectorSubject {
  return { key: `definition:${o.connection}:${o.term}:${o.area}:${isNew ? "new" : ""}`, kind: "Definition",
    title: o.term || "A new Definition", icon: "words", bare: true,
    tabs: { overview: <DefinitionView key={`${o.connection}:${o.term}:${o.area}`} term={isNew ? "" : o.term} newTerm={isNew ? o.term : ""}
      connection={o.connection} initialArea={o.area} inApp /> } };
}

/** A review row opened on the right, as the reference opens one: "For review" and what it is, Accept · Edit and accept ·
 *  Reject where it has them, Not now always; then what it says. */
function ReviewPage({ r, done, inspect }: {
  r: ReviewRowWithDoors; done: (key: string, words: string) => void; inspect: (s: InspectorSubject) => void;
}) {
  const [busy, setBusy] = useState("");
  const key = `review:${r.connection_id}:${r.id}`;
  const act = async (a: ReviewAction) => {
    if (a.open?.definition) { inspect(definitionSubject(a.open.definition, false)); return; }
    if (a.open?.new_definition) { inspect(definitionSubject(a.open.new_definition, true)); return; }
    if (a.open?.href) { openInApp(a.open.href); return; }
    setBusy(a.label);
    try { await settle(a); done(key, `${a.label} — done`); }
    catch (e) { toast.error(`Not done: ${a.label}`, { description: errorWords(e) }); setBusy(""); }
  };
  const notNow = async () => {
    setBusy("Not now");
    const until = new Date(Date.now() + NOT_NOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    try {
      await setItemAside({ kind: "review", ref: `${r.connection_id}:${r.id}`, until, why: "not now, from the Inbox", title: r.title });
      done(key, `Set aside until ${until}`);
    } catch (e) { toast.error("Not set aside", { description: errorWords(e) }); setBusy(""); }
  };
  const actions = r.actions ?? [];
  const tone = (a: ReviewAction) => (a.do === "accept" ? "default" : a.do === "reject" ? "ghost" : "outline") as "default" | "ghost" | "outline";
  return (
    <div data-testid="needs-review-open" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div role="region" aria-label="For review" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px",
        borderRadius: "var(--r2)", background: "var(--amb1)" }}>
        <span className="aug-fs-sm" style={{ color: "var(--t1)", fontWeight: 600 }}>{`For review: ${reviewWord(r.source, r.kind)}`}</span>
        {r.resolve.action && <span className="aug-fs-xs" style={{ color: "var(--t2)" }}>{r.resolve.action}</span>}
        <span style={{ ...ROW, gap: 6, flexWrap: "wrap" }}>
          {actions.map((a) => (
            <Button key={`${a.do}:${a.label}`} size="xs" variant={tone(a)} disabled={!!busy} onClick={() => void act(a)}>
              {busy === a.label ? `${a.label}…` : a.label}
            </Button>
          ))}
          <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => void notNow()} title={`Off the list for ${NOT_NOW_DAYS} days`}>
            {busy === "Not now" ? "Setting aside…" : "Not now"}
          </Button>
        </span>
      </div>
      <span className="aug-fs-h1" style={{ color: "var(--t1)", fontWeight: 600, lineHeight: 1.3, wordBreak: "break-word" }}>{r.title}</span>
      {r.detail && <span className="aug-fs-ui" style={{ color: "var(--t2)", lineHeight: 1.55 }}>{r.detail}</span>}
      <Facts rows={[
        ["Connection", r.connection_name],
        ["Asked", r.count ? `${formatCount(r.count)} times` : ""],
        ["Complaints", r.complaints ? formatCount(r.complaints) : ""],
        ["Last", r.at ? relTime(r.at) : ""],
      ]} />
    </div>
  );
}

function reviewSubject(r: ReviewRowWithDoors, ctx: { done: (key: string, words: string) => void; inspect: (s: InspectorSubject) => void }): InspectorSubject {
  return { key: `review:${r.connection_id}:${r.id}`, kind: reviewWord(r.source, r.kind), title: r.title, icon: "words", bare: true,
    tabs: { overview: <ReviewPage r={r} done={ctx.done} inspect={ctx.inspect} /> } };
}
