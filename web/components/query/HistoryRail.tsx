"use client";

/**
 * SE-2 PR D — the history rail: what this connection has actually run.
 *
 * A filtered read of the AUDIT LOG, not a second store. Every workbench run already
 * writes an audit row tagged `query_workbench` (SE-0 added both the tag and the
 * `label` filter for exactly this), so history is a view over the record that has to
 * exist anyway. A dedicated history table would be a second source of truth that could
 * disagree with the audit — and the audit is the one with the compliance claim on it.
 *
 * That inheritance is why a row says the VERDICT when it is not a plain pass: the
 * log's purpose is to record what the guards decided, and a history that showed only
 * "ran, 5 rows" would drop the most interesting fact about a query that was blocked.
 * A pass is the ordinary case, so it is not said on every row (CLARITY: say a thing
 * once) — blocked, withheld, flagged and failed each wear a chip, and are counted at the
 * label.
 *
 * Its search (the user, 2026-11-20: "I dont want 'open existing'… let the search function be part of the history
 * button") finds a run by what it said and a saved query by its name or its SQL — what the "+ → Open existing" dialog
 * searched, here where the past already is.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { getQueryHistory, type AuditRecord, type SavedQuery } from "@/lib/api";
import { formatCount, relTime } from "@/lib/format";
import { runMark, runMeta, writtenSql } from "@/lib/query/workbench";
import { Chip, Empty, Label, NUM } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { ReadFailed } from "@/components/ui/states";

/** One line of SQL for the rail, collapsed from whatever the user wrote. */
function preview(sql: string): string {
  return (sql || "").replace(/\s+/g, " ").trim().slice(0, 90);
}

export function HistoryRail({
  connId,
  refreshKey,
  onRestore,
  saved,
  onOpenSaved,
}: {
  connId: string;
  /** Bump to re-read after a run — the rail is a read of a log this surface writes. */
  refreshKey: number;
  onRestore: (sql: string) => void;
  /** The connection's saved queries, found by the search too, and how one opens. */
  saved?: SavedQuery[];
  onOpenSaved?: (q: SavedQuery) => void;
}) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AuditRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  // A failed read used to empty the rail under "Queries you run here appear in this list".
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!connId) { setRows([]); setFailed(null); setLoaded(true); return; }
    getQueryHistory(connId)
      .then(r => { setRows(r); setFailed(null); })
      .catch(e => { setRows([]); setFailed(e instanceof Error ? e.message : String(e)); })
      .finally(() => setLoaded(true));
  }, [connId]);

  useEffect(() => { load(); }, [load, refreshKey]);
  // "40 · 1 blocked · 2 failed": what did not simply pass, counted once at the label rather than said per row.
  const tally = new Map<string, number>();
  for (const r of rows) {
    const m = runMark(r);
    if (m) tally.set(m.word, (tally.get(m.word) ?? 0) + 1);
  }
  const stopped = [...tally.entries()].map(([w, n]) => `${formatCount(n)} ${w}`).join(" · ");
  const q = search.trim().toLowerCase();
  const runHits = useMemo(() => (q ? rows.filter(r => writtenSql(r).toLowerCase().includes(q)) : rows), [rows, q]);
  const savedHits = useMemo(
    () => (q && saved ? saved.filter(s => `${s.name} ${s.sql}`.toLowerCase().includes(q)) : []), [saved, q]);

  return (
    <div
      style={{
        flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
        borderLeft: "1px solid var(--divide)", background: "var(--bg-1)", overflow: "hidden",
      }}
    >
      {/* The rail's section label, its count at the right — and how many the guards stopped, folded into that count
          rather than a "safe" said on every row. */}
      <div style={{ padding: "10px 10px 0", flexShrink: 0 }}>
        <Label right={<>
          {loaded && failed === null && rows.length > 0 && (
            <span style={NUM}>{formatCount(rows.length)}{stopped ? ` · ${stopped}` : ""}</span>
          )}
          <Button variant="plain" size="xs" onClick={load} title="Read the history again" aria-label="Refresh">
            <Icon name="refresh" size={12} />
          </Button>
        </>}>Recent runs</Label>
        <Input bespoke value={search} onChange={e => setSearch(e.target.value)} aria-label="Search runs and saved queries"
          placeholder="Search runs and saved queries…" data-testid="history-search" style={{ width: "100%", marginBottom: 8 }}
          onKeyDown={e => { if (e.key === "Escape" && search) { e.preventDefault(); setSearch(""); } }}
          leading={<Icon name="search" size={11} />} />
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 8px" }}>
        {loaded && failed !== null && (
          <ReadFailed what="the query history" error={failed} onRetry={load} style={{ padding: "6px 4px" }} />
        )}
        {loaded && failed === null && rows.length === 0 && !q && (
          <div style={{ padding: "2px 4px" }}><Empty>Queries you run here appear in this list.</Empty></div>
        )}
        {/* searching: the saved queries that match first, by name, then the runs that match */}
        {savedHits.length > 0 && (
          <div data-testid="history-saved-hits" style={{ marginBottom: 6 }}>
            <div className="aug-fs-xs" style={{ color: "var(--t3)", padding: "2px 4px 4px" }}>Saved</div>
            {savedHits.map(s => (
              <Button key={s.id} variant="plain" onClick={() => onOpenSaved?.(s)} title="Open this saved query"
                className="mb-0.5 block h-auto w-full whitespace-normal px-2 py-1.5 text-left font-normal">
                <span className="aug-fs-sm" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--t1)" }}>
                  <Icon name="bookmark" size={11} />{s.name}
                </span>
                <span className="aug-fs-xs" style={{ display: "block", fontFamily: "var(--font-code, monospace)", color: "var(--t3)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{preview(s.sql)}</span>
              </Button>
            ))}
            {runHits.length > 0 && <div className="aug-fs-xs" style={{ color: "var(--t3)", padding: "6px 4px 4px" }}>Runs</div>}
          </div>
        )}
        {q && loaded && savedHits.length === 0 && runHits.length === 0 && (
          <div style={{ padding: "2px 4px" }}><Empty>Nothing run or saved here says “{search.trim()}”.</Empty></div>
        )}
        {runHits.map(r => {
          const mark = runMark(r);
          const sql = writtenSql(r);
          return (
            <Button
              key={r.id}
              variant="plain"
              onClick={() => onRestore(sql)}
              title="Open this query in a new tab"
              className="mb-0.5 block h-auto w-full whitespace-normal px-2 py-1.5 text-left font-normal"
            >
              <span
                className="aug-fs-sm"
                style={{
                  display: "block", fontFamily: "var(--font-code, monospace)",
                  color: "var(--t2)", overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {preview(sql)}
              </span>
              <span className="aug-fs-xs" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--t3)",
                marginTop: 2, ...NUM }}>
                {mark && <Chip tone={mark.tone === "red" ? "down" : "amber"} title={r.error ?? undefined}>{mark.word}</Chip>}
                <span>{[runMeta(r), r.ts ? `${relTime(r.ts)} ago` : ""].filter(Boolean).join(" · ")}</span>
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
