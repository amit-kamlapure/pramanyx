"use client";

/**
 * Changing a dashboard from the panel beside it (the user, 2026-11-19): the work
 * shows as it happens and folds away when done, what would change waits on an Allow or a Skip, and an allowed change lands on
 * the dashboard in view. Every line of the work is something the platform did; no word of it is the model's thinking.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { BrandSpark, brandEdge } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DashboardRefused, acceptProposal, changeDashboardLive, getProposalById, rejectProposal, type DashboardDrafted, type StagedProposal } from "@/lib/api";
import { changeCardOf } from "@/lib/dashboards/changeCard";
import { endedWatch, finishedWatch, heardFrame, isWorking, startWatch, type DraftStep, type DraftWatch } from "@/lib/dashboards/draftProgress";

const ACTOR = "briefing";
const STARTERS = ["Move the most important card to the top", "Make the first chart larger", "Take off the card nobody needs"];

type Decision = "waiting" | "allowing" | "allowed" | "skipped" | "replaced";
interface Turn {
  id: number;
  words: string;
  watch: DraftWatch;
  result: DashboardDrafted | null;
  proposal: StagedProposal | null;
  decision: Decision | null;
  problem: string;
}

export interface ChangeDoor {
  dashboardId: string;
  schema?: string;
  unpublished: boolean;
  onChanged: () => void;
  onPublish: () => void;
}

function StepRow({ step }: { step: DraftStep }) {
  const doing = step.state === "doing";
  return (
    <li data-testid="change-step" data-state={step.state} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span aria-hidden="true" style={{ flex: "none", width: 16, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--t3)" }}>
        {doing ? <BrandSpark size={13} /> : <Icon name={step.state === "done" ? "check" : "close"} size={13} />}
      </span>
      <span className={`aug-fs-sm${doing ? " aug-shimmer-text" : ""}`} style={{ flex: 1, minWidth: 0, ...(doing ? {} : { color: "var(--t2)" }) }}>{step.words}</span>
      {step.note && <span className="aug-fs-xs" style={{ flex: "none", color: "var(--t3)", fontVariantNumeric: "tabular-nums" }}>{step.note}</span>}
    </li>
  );
}

/** The work: every step while it runs, one line to open once it is done. */
function Work({ watch }: { watch: DraftWatch }) {
  const [open, setOpen] = useState(false);
  const working = isWorking(watch);
  return (
    <div>
      {!working && (
        <Button size="xs" variant="ghost" aria-expanded={open} data-testid="change-steps-toggle" onClick={() => setOpen(o => !o)} style={{ marginLeft: -6, color: "var(--t3)" }}>
          {watch.steps.length} steps <Icon name={open ? "chevu" : "chevd"} size={12} />
        </Button>
      )}
      {(working || open) && (
        <ol role="status" aria-live="polite" style={{ listStyle: "none", margin: "4px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {watch.steps.map(step => <StepRow key={step.id} step={step} />)}
        </ol>
      )}
    </div>
  );
}

function Decide({ turn, onAllow, onSkip }: { turn: Turn; onAllow: () => void; onSkip: () => void }) {
  const card = changeCardOf(turn.proposal?.detail);
  const pending = turn.decision === "waiting" || turn.decision === "allowing";
  if (!pending) {
    const words = turn.decision === "allowed" ? card.did : turn.decision === "skipped" ? "Skipped. Nothing changed." : "Replaced by your next request. Nothing changed.";
    return (
      <div data-testid="change-decided" data-decision={turn.decision ?? ""} className="aug-fs-sm"
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", border: "1px solid var(--card-edge)", borderRadius: "var(--r3)", color: turn.decision === "allowed" ? "var(--t1)" : "var(--t3)" }}>
        <span style={{ flex: 1, minWidth: 0 }}>{words}</span>
        {turn.decision === "allowed" && <span style={{ display: "inline-flex", color: "var(--blue4)" }}><Icon name="check" size={15} label="Done" /></span>}
      </div>
    );
  }
  return (
    <div data-testid="change-card" style={{ border: "1px solid var(--blue3)", borderRadius: "var(--r3)", overflow: "hidden" }}>
      <div className="aug-fs-ui" style={{ padding: "10px 12px 6px", color: "var(--t1)", fontWeight: 600 }}>{card.asks}</div>
      {card.lines.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: "2px 12px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
          {card.lines.map((line, i) => (
            <li key={`${line.verb}-${line.title}-${i}`} data-testid="change-line" className="aug-fs-sm" style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
              <span className="aug-fs-xs" style={{ flex: "none", width: 52, color: "var(--t3)" }}>{line.verb}</span>
              <span style={{ flex: 1, minWidth: 0, color: "var(--t1)", overflowWrap: "anywhere" }}>{line.title}</span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: "1px solid var(--card-edge)" }}>
        <span className="aug-fs-xs" style={{ flex: 1, minWidth: 0, color: "var(--t3)" }}>Nothing changes until you allow it.</span>
        <Button size="xs" variant="secondary" data-testid="change-skip" disabled={turn.decision === "allowing"} onClick={onSkip}>Skip</Button>
        <Button size="xs" data-testid="change-allow" disabled={turn.decision === "allowing"} onClick={onAllow}>{turn.decision === "allowing" ? "Applying…" : "Allow"}</Button>
      </div>
    </div>
  );
}

export function ChangeThread({ connectionId, title, door }: { connectionId: string; title: string; door: ChangeDoor }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState("");
  const running = useRef<AbortController | null>(null);
  const waiting = useRef("");
  const nextId = useRef(1);
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [turns]);

  const patch = (id: number, change: (t: Turn) => Turn) => setTurns(all => all.map(t => (t.id === id ? change(t) : t)));

  const run = async (asked: string) => {
    const id = nextId.current++;
    const control = new AbortController();
    running.current = control;
    setBusy(true);
    setTurns(all => [...all.map(t => (t.decision === "waiting" ? { ...t, decision: "replaced" as const } : t)),
      { id, words: asked, watch: startWatch("change"), result: null, proposal: null, decision: null, problem: "" }]);
    try {
      const result = await changeDashboardLive(connectionId, door.dashboardId, asked, door.schema, {
        signal: control.signal, hear: frame => patch(id, t => ({ ...t, watch: heardFrame(t.watch, frame) })),
      });
      const proposal = result.staged ? await getProposalById(result.proposal_id) : null;
      patch(id, t => ({ ...t, result, proposal, decision: proposal ? "waiting" : null, watch: finishedWatch(t.watch, result) }));
    } catch (e) {
      const stopped = control.signal.aborted;
      patch(id, t => ({ ...t, problem: stopped ? "" : (e as Error).message.slice(0, 240), watch: endedWatch(t.watch, stopped ? "Stopped. Nothing changed." : "The change could not be drafted") }));
    } finally {
      setBusy(false);
      const next = waiting.current;
      waiting.current = "";
      setQueued("");
      if (next && !control.signal.aborted) void run(next);
    }
  };

  const send = (asked: string) => {
    const said = asked.trim();
    if (!said) return;
    setWords("");
    if (busy) { waiting.current = said; setQueued(said); return; }
    void run(said);
  };

  const allow = async (turn: Turn) => {
    if (!turn.proposal) return;
    patch(turn.id, t => ({ ...t, decision: "allowing", problem: "" }));
    try {
      await acceptProposal(turn.proposal.id, ACTOR);
      patch(turn.id, t => ({ ...t, decision: "allowed" }));
      door.onChanged();
    } catch (e) {
      const why = e instanceof DashboardRefused ? e.outcome.sentences.join(" ") : (e as Error).message;
      patch(turn.id, t => ({ ...t, decision: "waiting", problem: why.slice(0, 240) }));
    }
  };
  const skip = async (turn: Turn) => {
    if (!turn.proposal) return;
    patch(turn.id, t => ({ ...t, decision: "skipped" }));
    try { await rejectProposal(turn.proposal.id, ACTOR); } catch { /* it lapses by itself, and nothing was changed */ }
  };

  const last = turns[turns.length - 1];
  const publishNext = !busy && !words && door.unpublished && last?.decision === "allowed";
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && publishNext) { e.preventDefault(); door.onPublish(); }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(words); }
  };

  return (
    <div data-testid="change-thread" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 14px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="aug-fs-xs" data-testid="change-dashboard" style={{ alignSelf: "center", maxWidth: "100%", display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", border: "1px solid var(--card-edge)", borderRadius: "var(--r2)", color: "var(--t2)" }}>
          <Icon name="table" size={12} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        </div>
        {!turns.length && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            <p className="aug-fs-sm" style={{ margin: "0 0 6px", color: "var(--t2)" }}>Say what to change. You see each change before it is made.</p>
            {STARTERS.map(s => <Button key={s} size="xs" variant="ghost" style={{ justifyContent: "flex-start", height: "auto", whiteSpace: "normal", textAlign: "left", color: "var(--t2)" }} onClick={() => setWords(s)}>{s}</Button>)}
          </div>
        )}
        {turns.map(turn => (
          <div key={turn.id} data-testid="change-turn" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div className="aug-fs-ui" style={{ alignSelf: "flex-end", maxWidth: "88%", padding: "7px 11px", borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--card-edge)", color: "var(--t1)", overflowWrap: "anywhere" }}>{turn.words}</div>
            <Work watch={turn.watch} />
            {turn.proposal && <Decide turn={turn} onAllow={() => void allow(turn)} onSkip={() => void skip(turn)} />}
            {turn.proposal?.reasoning && turn.decision !== "skipped" && turn.decision !== "replaced" && <p className="aug-fs-sm" style={{ margin: 0, color: "var(--t2)" }}>{turn.proposal.reasoning}</p>}
            {turn.result && !turn.result.staged && (
              <ul data-testid="change-refused" className="aug-fs-sm" style={{ margin: 0, paddingLeft: 18, color: "var(--t2)" }}>{turn.result.sentences.map((s, i) => <li key={`${i}-${s.slice(0, 20)}`}>{s}</li>)}</ul>
            )}
            {turn.problem && <p className="aug-fs-sm" role="alert" style={{ margin: 0, color: "var(--t1)" }}>{turn.problem}</p>}
          </div>
        ))}
        {publishNext && <Button size="xs" variant="secondary" data-testid="change-publish-next" style={{ alignSelf: "flex-start" }} onClick={door.onPublish}><Icon name="send" size={12} /> Publish this dashboard</Button>}
      </div>
      <div style={{ padding: "6px 12px 12px" }}>
        {queued && <p className="aug-fs-xs" data-testid="change-queued" style={{ margin: "0 2px 5px", color: "var(--t3)" }}>Next: {queued}</p>}
        <div style={{ ...brandEdge("var(--bg-2)"), position: "relative", borderRadius: 12, padding: "9px 44px 9px 11px" }}>
          <textarea rows={2} aria-label="Describe the change" className="aug-fs-ui aug-focus-frame" value={words} onChange={e => setWords(e.target.value)} onKeyDown={onKey}
            placeholder={busy ? "Queue a follow-up" : publishNext ? "Publish this dashboard (Tab)" : "Describe the change you want"}
            style={{ display: "block", width: "100%", background: "transparent", border: "none", outline: "none", resize: "none", color: "var(--t1)", fontFamily: "inherit" }} />
          {busy && !words.trim()
            ? <Button size="icon-sm" variant="secondary" aria-label="Stop" title="Stop" data-testid="change-stop" onClick={() => running.current?.abort()} style={{ position: "absolute", right: 8, bottom: 8 }}><Icon name="stop" size={14} /></Button>
            : <Button size="icon-sm" aria-label={busy ? "Queue this" : "Send"} title={busy ? "Queue this" : "Send"} disabled={!words.trim()} onClick={() => send(words)} style={{ position: "absolute", right: 8, bottom: 8 }}><Icon name="send" size={14} /></Button>}
        </div>
      </div>
    </div>
  );
}
