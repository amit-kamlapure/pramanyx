"use client";

/**
 * What an answer stood on, under it: each metric, Definition, spreadsheet or object a small mark that opens the app's own page
 * for it beside the conversation, so a person can check the answer without leaving it.
 */
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useNarrowScreen } from "@/lib/useNarrowScreen";
import { OBJECTS_SHOWN, answerSources, type AnswerSource } from "@/lib/answerSources";
import { getReceiptSources, type ReceiptSources } from "@/lib/api";
import { listSheets } from "@/lib/sheets";

export function AnswerSources({ receiptId, connectionId, onOpen }: {
  receiptId: string;
  connectionId: string;
  onOpen: (source: AnswerSource) => void;
}) {
  const [read, setRead] = useState<ReceiptSources | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheets, setSheets] = useState<ReadonlyMap<string, { id: string; name: string }>>(new Map());
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    getReceiptSources(receiptId).then(r => { if (alive) setRead(r); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [receiptId]);
  useEffect(() => {
    if (connectionId !== "sheets") return;
    let alive = true;
    listSheets().then(got => {
      if (!alive) return;
      const kept = got.sheets.flatMap(s => ("table" in s && s.table ? [[s.table.toLowerCase(), { id: s.id, name: s.name }] as const] : []));
      setSheets(new Map(kept));
    }).catch(() => { /* each table then opens as what it is on the ontology */ });
    return () => { alive = false; };
  }, [connectionId]);
  const sources = useMemo(() => (read ? answerSources(read, connectionId, sheets) : []), [read, connectionId, sheets]);
  if (failed) return <p className="aug-fs-xs" data-testid="answer-sources-unread" style={{ margin: "6px 0 0", color: "var(--t3)" }}>What this answer stood on could not be read.</p>;
  if (!sources.length) return null;
  const objects = sources.filter(s => s.kind === "object" || s.kind === "sheet");
  const held = sources.filter(s => s.kind === "metric" || s.kind === "definition");
  const shown = [...held, ...(all ? objects : objects.slice(0, OBJECTS_SHOWN))];
  return (
    <div role="group" aria-label="What this answer stood on" data-testid="answer-sources" className="aug-fs-xs"
      style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 8, color: "var(--t3)" }}>
      <span>Sources</span>
      {shown.map(s => (
        <Button key={s.key} size="xs" variant="outline" data-testid="answer-source" data-kind={s.kind} title={s.title} onClick={() => onOpen(s)}
          style={{ maxWidth: 220 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
        </Button>
      ))}
      {objects.length > OBJECTS_SHOWN && (
        <Button size="xs" variant="ghost" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? "Fewer" : `${objects.length - OBJECTS_SHOWN} more`}</Button>
      )}
    </div>
  );
}

/** The source's own page, beside the conversation. It pushes the conversation over, and covers it only on a narrow screen. */
export function SourceBeside({ source, onClose }: { source: AnswerSource; onClose: () => void }) {
  const narrow = useNarrowScreen();
  return (
    <aside aria-label={`${source.label}, beside the conversation`} data-testid="source-beside"
      style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg-1)", borderLeft: "1px solid var(--b1)",
        ...(narrow ? { position: "fixed", inset: 0, zIndex: 40 } : { flex: "0 0 clamp(380px, 46%, 820px)" }) }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--b1)" }}>
        <span className="aug-fs-ui" title={source.label} style={{ flex: 1, minWidth: 0, color: "var(--t1)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.label}</span>
        <Button size="icon-sm" variant="ghost" aria-label="Close" title="Close" data-testid="source-beside-close" onClick={onClose}><Icon name="close" size={15} /></Button>
      </div>
      <iframe key={source.page} src={source.page} title={source.label} style={{ flex: 1, minHeight: 0, width: "100%", border: 0, background: "var(--bg-1)" }} />
    </aside>
  );
}
