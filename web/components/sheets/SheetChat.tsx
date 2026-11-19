"use client";

/**
 * What a sheet's conversation shows (SH-4; mockup screens 3 to 5), drawn in the Ask panel beside the sheet
 * (`components/ask/SheetAssist.tsx`) since the sheet's own chat folded into it (Stage 1, the user, 2026-11-19).
 *
 * - The rows an answer is about: how many of what whole, and the two things to do with them.
 * - A change asked for comes back as ONE proposal card: each change checked and counted by the platform, ticked by
 *   default, applied all or in part by the person, recorded as proposed by the assistant and applied by them.
 * - A file becomes one proposal for a new sheet (screen 5): its name, its kinds and a few views. Nothing is made until the
 *   person creates it, and undo removes it whole. The Spreadsheets home makes one the same way (`NewSheetChat`).
 */
import { useRef, useState } from "react";

import { Chip, Dot, MUTED, NUM } from "@/components/clarity/kit";
import { RULE_COLOR } from "@/components/sheets/SheetGrid";
import { PANEL, PanelHead } from "@/components/sheets/SheetRecord";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import type { SheetRowsRef } from "@/lib/chatTurn";
import { formatCount } from "@/lib/format";
import {
  KIND_LABEL, RULE_TONES, applyProposal, filterWords, proposeNewSheet, rowsWord, stageFile, undo,
  type Proposal, type ProposeOutcome, type RuleTone, type Sheet,
} from "@/lib/sheets";

/** The rows an answer beside the sheet is about (SH-4): how many of what whole, the filter in the grid's words, and the
 *  two things to do with them — see them in the grid, or keep them as a view. Nothing changes until one is clicked. */
export function RowsCard({ rows: r, sheet, onShow, onKeep }: {
  rows: SheetRowsRef; sheet: Sheet; onShow: () => void; onKeep: () => Promise<boolean>;
}) {
  const [did, setDid] = useState<"" | "shown" | "kept">("");
  const [busy, setBusy] = useState(false);
  const said = filterWords(r.conditions, sheet.columns, sheet.rules) || r.said;
  return (
    <div style={{ border: "1px solid var(--b1)", borderRadius: "var(--r3)", background: "var(--bg-2)", padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <Icon name="table" size={14} />
        <span className="aug-fs-sm" style={{ fontWeight: 600, ...NUM }}>
          {rowsWord(r.rows, sheet.name)} <span style={{ ...MUTED, fontWeight: 400 }}>of {formatCount(r.of)}
            {r.withinView ? " in this view" : ""}{r.share !== null && r.rows ? ` · ${r.share}%` : ""}</span>
        </span>
      </div>
      <span className="aug-fs-xs" style={MUTED}>{said}</span>
      {r.rows > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Button size="xs" variant={did === "shown" ? "secondary" : "default"} onClick={() => { onShow(); setDid("shown"); }}>
            {did === "shown" ? "Shown in the grid" : "Show in the grid"}
          </Button>
          <Button size="xs" variant="outline" disabled={busy || did === "kept"} onClick={() => {
            setBusy(true);
            void onKeep().then(ok => { if (ok) setDid("kept"); }).finally(() => setBusy(false));
          }}>{did === "kept" ? `Kept as the view ${r.about}` : `Keep as a view · ${r.about}`}</Button>
        </div>
      )}
    </div>
  );
}

export function ProposalCard({ proposal, applied, appliedSheet, onApplied, onUndone }: {
  proposal: Proposal; applied?: number[]; appliedSheet?: string;
  onApplied: (picks: number[], sheetId: string) => void; onUndone: () => void;
}) {
  const [picks, setPicks] = useState<Set<number>>(() => new Set(proposal.changes.map((_, i) => i)));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const done = applied !== undefined;
  const apply = async () => {
    setBusy(true);
    setRefused(null);
    try {
      const out = await applyProposal(proposal.id, [...picks].sort((a, b) => a - b));
      onApplied(out.applied, out.sheet);
    } catch (e) {
      setRefused(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const takeBack = async () => {
    if (!appliedSheet) return;
    setBusy(true);
    try { await undo(appliedSheet, !!proposal.new_sheet); onUndone(); } catch (e) { setRefused(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const n = picks.size;
  return (
    <div style={{ border: "1px solid var(--b1)", borderRadius: "var(--r3)", background: "var(--bg-2)", padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="aug-fs-sm" style={{ fontWeight: 600 }}>
          {proposal.new_sheet ? `A new sheet · ${proposal.name}` : `${proposal.changes.length} change${proposal.changes.length === 1 ? "" : "s"}`}
        </span>
        <span style={{ marginLeft: "auto" }}>
          {done ? <Chip tone="up">Applied by you</Chip> : <Chip>nothing {proposal.new_sheet ? "created" : "applied"} yet</Chip>}
        </span>
      </div>
      {proposal.new_sheet && (
        <div className="aug-fs-xs" style={{ ...MUTED, display: "flex", flexDirection: "column", gap: 2 }}>
          <span>{proposal.file} · {formatCount(proposal.rows ?? 0)} rows · {proposal.columns?.length ?? 0} columns, read as written:</span>
          <span>{(proposal.columns ?? []).map(c => `${c.name} ${KIND_LABEL[c.kind]}`).join(" · ")}</span>
        </div>
      )}
      {proposal.changes.map((c, i) => (
        <label key={`${c.type}-${c.said}`} className="aug-fs-sm" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <Checkbox checked={done ? applied!.includes(i) : picks.has(i)} disabled={done}
            onChange={() => { const p = new Set(picks); if (p.has(i)) p.delete(i); else p.add(i); setPicks(p); }}
            aria-label={c.said} />
          <span>
            {c.said}
            {c.type === "computed_column" && <span className="aug-fs-xs" style={{ ...MUTED, display: "block" }}>computed, no model</span>}
            {c.type === "rule" && (
              <span className="aug-fs-xs" style={{ ...MUTED, display: "flex", gap: 5, alignItems: "baseline" }}>
                <Dot color={RULE_COLOR[RULE_TONES.includes(c.tone as RuleTone) ? c.tone as RuleTone : "amber"]} />
                marks the rows where {String(c.where ?? "")}
              </span>
            )}
          </span>
        </label>
      ))}
      {refused && <span role="alert" className="aug-fs-xs" style={{ color: "var(--red4)" }}>{refused}</span>}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {done ? (
          <>
            <Button variant="outline" size="xs" onClick={() => void takeBack()} disabled={busy}>
              {proposal.new_sheet ? "Undo — remove the sheet" : "Undo all"}
            </Button>
            <span className="aug-fs-xs" style={MUTED}>Each change is in the sheet&apos;s history.</span>
          </>
        ) : (
          <>
            <Button size="xs" onClick={() => void apply()} disabled={busy || (n === 0 && !proposal.new_sheet)}>
              {proposal.new_sheet ? "Create sheet" : `Apply ${n} change${n === 1 ? "" : "s"}`}
            </Button>
            <span className="aug-fs-xs" style={MUTED}>{proposal.new_sheet ? "Undo removes it whole." : "Untick what you do not want."}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** The home's "In the chat": drop a file, say what it is for, and read the one proposal it becomes. */
export function NewSheetChat({ onClose, onMade }: { onClose: () => void; onMade: (sheetId: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ProposeOutcome | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const go = async () => {
    if (!file) return;
    setBusy(true);
    setRefused(null);
    try {
      const st = await stageFile(file);
      setOutcome(await proposeNewSheet(st.token, words));
    } catch (e) {
      setRefused(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside aria-label="Make a sheet in the chat" style={PANEL}
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}>
      <PanelHead title="Chat" chip="Workspace" onClose={onClose} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="aug-fs-xs" style={{ ...MUTED, lineHeight: 1.6 }}>
          Drop a file and say what it is for. It comes back as one proposal — the sheet&apos;s name, the kinds read from
          the file, and a few views — and nothing is made until you create it.
        </div>
        <input ref={fileRef} type="file" hidden accept=".csv,.tsv,.parquet,.json,.xlsx"
          onChange={e => setFile(e.target.files?.[0] ?? null)} />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} style={{ alignSelf: "flex-start" }}>
          <Icon name="attach" /> {file ? file.name : "Choose or drop a file"}
        </Button>
        <Input value={words} onChange={e => setWords(e.target.value)} aria-label="What the sheet is for"
          placeholder="What is it for? — e.g. a sheet I can follow up complaints from" />
        <Button size="sm" onClick={() => void go()} disabled={!file || busy} style={{ alignSelf: "flex-start" }}>
          {busy ? "Reading the file…" : "Propose a sheet"}
        </Button>
        {refused && <span role="alert" className="aug-fs-sm" style={{ color: "var(--red4)" }}>{refused}</span>}
        {outcome && (outcome.staged ? (
          <ProposalCard proposal={outcome.proposal} onApplied={(_, id) => onMade(id)} onUndone={() => undefined} />
        ) : outcome.sentences.map(s => <span key={s} className="aug-fs-sm">{s}</span>))}
      </div>
    </aside>
  );
}
