"use client";

/**
 * A change to a dashboard, drafted in the Ask panel's conversation and waiting for the person's own Allow (Stage 1 of the
 * plan, 2026-11-19). What it would do is read from what the platform staged, line by line; nothing changes until Allow, and
 * an allowed change reaches the dashboard on screen without a refresh. The coworker asks the same way, inside the
 * conversation, never in a pop-up.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { acceptProposal, getProposalById, rejectProposal, type StagedProposal } from "@/lib/api";
import { changeCardOf } from "@/lib/dashboards/changeCard";

const ACTOR = "briefing";
/** Told on the page when a change is allowed, so the dashboard on screen reads itself again. */
export const DASHBOARD_CHANGED = "pramanyx:dashboard-changed";
/** Told when a change is drafted: a later draft replaces an earlier one, whose card must read itself again. */
export const DASHBOARD_DRAFTED = "pramanyx:dashboard-drafted";

type Decision = "waiting" | "allowing" | "allowed" | "rejected" | "replaced" | "failed" | "held" | "uncertain" | "gone";

const decisionOf = (p: StagedProposal): Decision =>
  p.status === "pending" ? "waiting"
    : p.status === "accepted" || p.status === "executed" ? "allowed"
    : p.status === "superseded" ? "replaced"
    : p.status === "failed" ? "failed"
    : p.status === "approval_required" ? "held"
    : p.status === "uncertain" ? "uncertain"
    : "rejected";

/** What a change that is no longer waiting says, by how it ended. */
const ENDED: Record<string, string> = {
  rejected: "Rejected. Nothing changed.",
  replaced: "Replaced by a later change. Nothing changed by this one.",
  failed: "This change could not be applied. Nothing changed.",
  held: "This change waits for someone who may approve it.",
  uncertain: "Whether this change was applied is not known. The dashboard shows what stands.",
};

export function DashboardChangeCard({ proposalId }: { proposalId: string }) {
  const [proposal, setProposal] = useState<StagedProposal | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [problem, setProblem] = useState("");
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let alive = true;
    getProposalById(proposalId)
      .then(p => {
        if (!alive) return;
        setProposal(p);
        setDecision(p ? decisionOf(p) : "gone");
        // a change just drafted says so once, so a card for one it replaced reads itself again
        if (reads === 0 && p?.status === "pending") {
          window.dispatchEvent(new CustomEvent(DASHBOARD_DRAFTED, { detail: { proposalId } }));
        }
      })
      .catch(() => { if (alive) setDecision("gone"); });
    return () => { alive = false; };
  }, [proposalId, reads]);
  useEffect(() => {
    // another change drafted or allowed may have replaced this one
    const again = (e: Event) => {
      if ((e as CustomEvent<{ proposalId?: string }>).detail?.proposalId !== proposalId) setReads(n => n + 1);
    };
    window.addEventListener(DASHBOARD_DRAFTED, again);
    window.addEventListener(DASHBOARD_CHANGED, again);
    return () => { window.removeEventListener(DASHBOARD_DRAFTED, again); window.removeEventListener(DASHBOARD_CHANGED, again); };
  }, [proposalId]);

  if (decision === null) return <p className="aug-fs-sm" style={{ color: "var(--t3)", margin: "6px 0" }}>Reading the change…</p>;
  if (decision === "gone" || !proposal) {
    return <p className="aug-fs-sm" data-testid="dashboard-change-gone" style={{ color: "var(--t3)", margin: "6px 0" }}>This change could not be read. Nothing was changed by it.</p>;
  }
  const card = changeCardOf(proposal.detail, proposal.kind);
  const allow = async () => {
    setDecision("allowing");
    setProblem("");
    try {
      await acceptProposal(proposalId, ACTOR);
      setDecision("allowed");
      window.dispatchEvent(new CustomEvent(DASHBOARD_CHANGED, { detail: { connectionId: proposal.connection_id, proposalId } }));
    } catch (e) {
      setDecision("waiting");
      setProblem((e as Error).message.slice(0, 240));
    }
  };
  const reject = async () => {
    setDecision("rejected");
    try { await rejectProposal(proposalId, ACTOR); } catch { /* it lapses by itself, and nothing was changed */ }
  };

  if (decision !== "waiting" && decision !== "allowing") {
    return (
      <div data-testid="dashboard-change-decided" data-decision={decision} className="aug-fs-sm"
        style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0", padding: "9px 12px", border: "1px solid var(--card-edge)", borderRadius: "var(--r3)",
          color: decision === "allowed" ? "var(--t1)" : "var(--t3)" }}>
        <span style={{ flex: 1, minWidth: 0 }}>{decision === "allowed" ? card.did : ENDED[decision]}</span>
        {decision === "allowed" && <span style={{ display: "inline-flex", color: "var(--blue4)" }}><Icon name="check" size={15} label="Done" /></span>}
      </div>
    );
  }
  return (
    <div data-testid="dashboard-change-card" style={{ margin: "6px 0", border: "1px solid var(--blue3)", borderRadius: "var(--r3)", overflow: "hidden" }}>
      <div className="aug-fs-ui" style={{ padding: "10px 12px 6px", color: "var(--t1)", fontWeight: 600 }}>{card.asks}</div>
      {card.lines.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: "2px 12px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
          {card.lines.map((line, i) => (
            <li key={`${line.verb}-${line.title}-${i}`} data-testid="dashboard-change-line" className="aug-fs-sm" style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
              <span className="aug-fs-xs" style={{ flex: "none", width: 52, color: "var(--t3)" }}>{line.verb}</span>
              <span style={{ flex: 1, minWidth: 0, color: "var(--t1)", overflowWrap: "anywhere" }}>{line.title}</span>
            </li>
          ))}
        </ul>
      )}
      {problem && <p role="alert" className="aug-fs-sm" style={{ margin: 0, padding: "0 12px 8px", color: "var(--t1)" }}>{problem}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: "1px solid var(--card-edge)" }}>
        <span className="aug-fs-xs" style={{ flex: 1, minWidth: 0, color: "var(--t3)" }}>Nothing changes until you allow it.</span>
        <Button size="xs" variant="secondary" data-testid="dashboard-change-reject" disabled={decision === "allowing"} onClick={() => void reject()}>Reject</Button>
        <Button size="xs" data-testid="dashboard-change-allow" disabled={decision === "allowing"} onClick={() => void allow()}>{decision === "allowing" ? "Applying…" : "Allow"}</Button>
      </div>
    </div>
  );
}
