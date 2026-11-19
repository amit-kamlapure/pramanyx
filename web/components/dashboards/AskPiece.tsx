"use client";

/**
 * A change to the one piece chosen in the builder, asked for in words (the study's R19). One short model run held to that piece;
 * what comes back is said here, in the panel, and nothing changes until the person keeps it. Kept, it is one step of the builder's
 * undo. A note's words and an image are never asked of a model, so neither offers this.
 */
import { useState } from "react";

import { BrandSpark } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { acceptProposal, askDashboard, rejectProposal, type DashboardDrafted } from "@/lib/api";

export const ASKS_OF_A_PIECE = (type: string | undefined) => !!type && !["Note", "Image", "Tabs", "Tab", "GlobalFilters", "GlobalFilter"].includes(type);

export function AskPiece({ connectionId, dashboardId, schema, pieceKey, actor, beforeAsk, onKept }: {
  connectionId: string; dashboardId: string; schema?: string; pieceKey: string; actor: string;
  /** What is waiting to be kept goes first: a model reads the dashboard as it stands. */
  beforeAsk: () => Promise<void>;
  onKept: () => void;
}) {
  const [words, setWords] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drafted, setDrafted] = useState<DashboardDrafted | null>(null);
  const staged = drafted?.staged ? drafted : null;

  const ask = async () => {
    if (!words.trim() || asking) return;
    setAsking(true); setDrafted(null);
    try {
      await beforeAsk();
      setDrafted(await askDashboard(connectionId, dashboardId, words, schema, pieceKey));
    } catch (e) {
      toast.error("The change could not be drafted", { description: (e as Error).message.slice(0, 160) });
    } finally { setAsking(false); }
  };
  const keep = async () => {
    if (!staged) return;
    setBusy(true);
    try {
      await acceptProposal(staged.proposal_id, actor);
      setDrafted(null); setWords("");
      onKept();
    } catch (e) {
      toast.error("It was not kept", { description: (e as Error).message.slice(0, 200) });
    } finally { setBusy(false); }
  };
  const discard = async () => {
    if (!staged) return;
    setBusy(true);
    try { await rejectProposal(staged.proposal_id, actor); setDrafted(null); } finally { setBusy(false); }
  };

  return (
    <div data-testid="ask-piece" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderBottom: "1px solid var(--b1)" }}>
      <label className="aug-fs-xs" htmlFor="ask-piece-words" style={{ color: "var(--t3)", display: "inline-flex", alignItems: "center", gap: 5 }}><BrandSpark size={12} /> Change this in words</label>
      <div style={{ display: "flex", gap: 6 }}>
        <Input id="ask-piece-words" value={words} onChange={e => setWords(e.target.value)} disabled={asking || !!staged} placeholder="Make it a bar chart"
          onKeyDown={e => { if (e.key === "Enter") void ask(); }} style={{ flex: 1, minWidth: 0 }} />
        <Button size="sm" variant="secondary" data-testid="ask-piece-propose" disabled={!words.trim() || asking || !!staged} onClick={() => void ask()}>
          {asking ? "Drafting…" : "Propose"}
        </Button>
      </div>
      {!staged && !drafted && (
        <span className="aug-fs-xs" style={{ color: "var(--t3)" }}>
          {asking ? "A model is reading this piece. This can take a minute." : "Asks a model once, about this piece alone. Nothing changes until you keep it."}
        </span>
      )}
      {drafted && !drafted.staged && (
        <ul className="aug-fs-sm" data-testid="ask-piece-refused" style={{ margin: 0, paddingLeft: 16, color: "var(--t2)" }}>
          {drafted.sentences.map((s, i) => <li key={`${i}-${s.slice(0, 24)}`}>{s}</li>)}
        </ul>
      )}
      {staged && (
        <>
          <span className="aug-fs-sm" data-testid="ask-piece-summary" style={{ color: "var(--t1)" }}>{staged.summary}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <Button size="sm" data-testid="ask-piece-keep" disabled={busy} onClick={() => void keep()}>Keep</Button>
            <Button size="sm" variant="ghost" data-testid="ask-piece-discard" disabled={busy} onClick={() => void discard()}>Discard</Button>
          </div>
        </>
      )}
    </div>
  );
}
