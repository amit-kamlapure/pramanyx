"use client";

/**
 * A sheet's own abilities, in the Ask panel beside it (Stage 1, the user, 2026-11-19: one conversation across pages, so the
 * sheet's own chat folds into the panel — nothing it did is lost).
 *
 * - What the conversation reads is said under it: the sheet's table, and the view on screen with its count.
 * - A change asked for — "flag the ones that still need following up" — comes back as ONE proposal: each change checked
 *   and counted by the platform, ticked by default, applied all or in part by the person, undone whole.
 * - A file dropped or attached becomes one proposal for a new sheet; nothing is made until the person creates it.
 * - An answer's rows can be seen in the grid, or kept as a view of the answer's name.
 *
 * Which a sentence is, a question or a change, is read from its first words (`asksForAChange`); the other way is one
 * click under it, so a misreading costs a click and never a change.
 */
import { useCallback, useEffect, useState } from "react";

import { MUTED, NUM } from "@/components/clarity/kit";
import { ProposalCard, RowsCard } from "@/components/sheets/SheetChat";
import { Button } from "@/components/ui/button";
import type { ChatTurn } from "@/lib/chatTurn";
import { formatCount } from "@/lib/format";
import type { SheetDoors } from "@/lib/sheetBridge";
import { propose, proposeNewSheet, readGrounding, stageFile, type Grounding, type Proposal, type ProposeOutcome } from "@/lib/sheets";

/** The files a sheet is made from. */
export const SHEET_FILES = ".csv,.tsv,.parquet,.json,.xlsx";

/** A change asked for on a sheet, or a file to make a sheet of, in the conversation after `after` turns. */
export interface SheetEntry {
  id: string;
  after: number;
  words: string;
  file: boolean;
  outcome: ProposeOutcome | null;
  error?: string;
  applied?: number[];
  appliedSheet?: string;
}

let seq = 0;
const nextId = () => `sheet-entry-${++seq}`;

/** The proposals asked for beside a sheet in this conversation, and the two ways to ask for one. */
export function useSheetEntries(sheetId: string | null) {
  const [entries, setEntries] = useState<SheetEntry[]>([]);
  const settle = useCallback((id: string, patch: Partial<SheetEntry>) => {
    setEntries(e => e.map(x => (x.id === id ? { ...x, ...patch } : x)));
  }, []);
  const failed = (id: string) => (err: unknown) => settle(id, { error: err instanceof Error ? err.message : String(err) });
  const proposeChange = useCallback((words: string, after: number) => {
    if (!sheetId) return;
    const id = nextId();
    setEntries(e => [...e, { id, after, words, file: false, outcome: null }]);
    propose(sheetId, words).then(outcome => settle(id, { outcome })).catch(failed(id));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `failed` is made from `settle`
  }, [sheetId, settle]);
  const proposeFile = useCallback((file: File, words: string, after: number) => {
    const id = nextId();
    setEntries(e => [...e, { id, after, words: `${file.name} — ${words || "make this a sheet"}`, file: true, outcome: null }]);
    stageFile(file).then(st => proposeNewSheet(st.token, words)).then(outcome => settle(id, { outcome })).catch(failed(id));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `failed` is made from `settle`
  }, [settle]);
  return { entries, proposeChange, proposeFile, settle };
}

/** What the conversation reads beside the sheet: its table, and the view on screen with its count. */
export function SheetGrounding({ doors }: { doors: SheetDoors }) {
  const [grounding, setGrounding] = useState<Grounding | null>(null);
  const { sheetId, viewId, viewRows } = doors;
  useEffect(() => {
    let alive = true;
    readGrounding(sheetId, viewId).then(g => { if (alive) setGrounding(g); }).catch(() => { if (alive) setGrounding(null); });
    return () => { alive = false; };
  }, [sheetId, viewId, viewRows]);
  if (!grounding?.found) return null;
  return (
    <div data-testid="sheet-grounding" className="aug-fs-xs" title={grounding.view?.where ? `WHERE ${grounding.view.where}` : undefined}
      style={{ ...MUTED, ...NUM, padding: "0 4px" }}>
      The chat reads <span className="aug-mono">{grounding.table}</span>
      {grounding.view ? ` · the view ${grounding.view.name}: ${formatCount(grounding.view.rows)} rows` : ` · ${formatCount(grounding.rows ?? 0)} rows`}
    </div>
  );
}

/** A proposal in the conversation: what was asked, the proposal (or why there is none), and the other way to ask it. */
export function SheetEntryView({ entry: en, doors, onSettle, onAsk }: {
  /** The sheet's own doors — or, on the Spreadsheets home, the one that opens the sheet a file was made into. */
  entry: SheetEntry; doors: Pick<SheetDoors, "applied" | "openView" | "openSheet"> | null; onSettle: (id: string, patch: Partial<SheetEntry>) => void;
  onAsk: (words: string) => void;
}) {
  const applied = (picks: number[], p: Proposal, sheetId: string) => {
    onSettle(en.id, { applied: picks, appliedSheet: sheetId });
    if (p.new_sheet) { doors?.openSheet(sheetId); return; }
    doors?.applied();
    const view = picks.map(i => p.changes[i]).find(c => c.type === "view");
    if (view?.name) doors?.openView(String(view.name));
  };
  return (
    <div data-testid="sheet-entry" style={{ display: "flex", flexDirection: "column", gap: 6, margin: "14px 0" }}>
      <div className="aug-fs-sm" style={{ alignSelf: "flex-end", background: "var(--bg-3)", padding: "6px 10px",
        borderRadius: "var(--r3)", maxWidth: "90%" }}>{en.words}</div>
      {en.error ? <span role="alert" className="aug-fs-sm" style={{ color: "var(--red4)" }}>{en.error}</span>
        : !en.outcome ? <span className="aug-fs-xs" style={MUTED}>Proposing — every change is checked and counted first…</span>
          : en.outcome.staged ? (
            <ProposalCard proposal={en.outcome.proposal} applied={en.applied} appliedSheet={en.appliedSheet}
              onApplied={(picks, sheetId) => applied(picks, (en.outcome as { proposal: Proposal }).proposal, sheetId)}
              onUndone={() => { doors?.applied(); onSettle(en.id, { applied: undefined }); }} />
          ) : (
            <div className="aug-fs-sm" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="aug-fs-xs" style={MUTED}>Nothing was proposed:</span>
              {en.outcome.sentences.map(s => <span key={s}>{s}</span>)}
            </div>
          )}
      {!en.file && (
        <div className="aug-fs-xs" style={MUTED}>
          Proposed as a change ·{" "}
          <Button variant="link" size="xs" onClick={() => onAsk(en.words)}>ask it as a question instead</Button>
        </div>
      )}
    </div>
  );
}

/** Under an answer asked beside a sheet: the rows it is about, to see in the grid or keep as a view, and the other way to
 *  ask it. */
export function SheetTurnFoot({ turn, doors, asked, onPropose }: {
  turn: ChatTurn; doors: SheetDoors | null; asked: boolean; onPropose: (words: string) => void;
}) {
  const rows = doors ? turn.sheetRows.filter(r => r.sheet === doors.sheetId) : [];
  if (!rows.length && !asked) return null;
  return (
    <div data-testid="sheet-turn-foot">
      {doors && rows.map((r, i) => (
        <RowsCard key={`${r.about}-${i}`} rows={r} sheet={doors.sheet} onShow={() => doors.showRows(r)} onKeep={() => doors.keepRows(r)} />
      ))}
      {asked && turn.status === "done" && (
        <div className="aug-fs-xs" style={{ ...MUTED, marginTop: 4 }}>
          Answered as a question ·{" "}
          <Button variant="link" size="xs" onClick={() => onPropose(turn.question)}>propose a change instead</Button>
        </div>
      )}
    </div>
  );
}
