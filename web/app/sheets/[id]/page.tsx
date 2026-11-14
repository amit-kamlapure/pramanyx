"use client";

/**
 * `/sheets/<id>`: a spreadsheet as a REFERENCED ASSET — what an answer read, shown beside it in the coworker's
 * right-hand pane. Its name, where it came from, its size, and its rows; nothing of the Spreadsheets page's own
 * tools (no dashboard, sharing, ontology, combine, views, editing). Asked for by the user on 2026-11-14: "we are
 * not showcasing a limited view of the UI, we are showing referenced assets in the right panel". Same app, same
 * tokens, same auth and the same sharing: a sheet not shared with the reader says so here as it does there.
 */
import { use, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { installAuthFetch } from "@/lib/auth";
import { getApiBase } from "@/lib/config";
import { formatCount } from "@/lib/format";
import { cellText, readRows, readSheet, type Sheet } from "@/lib/sheets";

if (typeof window !== "undefined") installAuthFetch(getApiBase());

/** Rows read at a time: enough to see what the asset holds, without reading a hundred thousand of them. */
const PAGE = 100;

/** A segment may still arrive percent-encoded; a malformed one is used as written. */
function segment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const MUTED = { color: "var(--t2)" };
const CELL = { padding: "6px 10px", whiteSpace: "nowrap" as const, borderBottom: "1px solid var(--b2)" };

export default function SheetReference({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = use(params);
  const id = segment(raw);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState("");
  const [reading, setReading] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([readSheet(id), readRows(id, { limit: PAGE })])
      .then(([s, page]) => { if (live) { setSheet(s); setRows(page.rows); setTotal(page.total); } })
      .catch((e: unknown) => { if (live) setFailed(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [id]);

  const more = () => {
    setReading(true);
    readRows(id, { offset: rows.length, limit: PAGE })
      .then(page => setRows(was => [...was, ...page.rows]))
      .catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)))
      .finally(() => setReading(false));
  };

  if (failed) {
    return <main className="aug-fs-sm" style={{ padding: 20 }}>This spreadsheet could not be read: {failed}</main>;
  }
  if (!sheet) return <main className="aug-fs-sm" style={{ padding: 20, ...MUTED }}>Reading the spreadsheet…</main>;

  // The row number the server leads each row with is the grid's, not the asset's: what is shown is the values.
  const shown = sheet.columns.map((c, at) => ({ c, at })).filter(({ c }) => !c.hidden);
  const numeric = (kind: string) => kind === "number" || kind === "money";
  return (
    <main style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 0 }}>
      <header style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--b2)" }}>
        <h1 className="aug-fs-h2" style={{ margin: 0, fontWeight: 600 }}>{sheet.name}</h1>
        <p className="aug-fs-xs" style={{ margin: "4px 0 0", ...MUTED }}>
          {[sheet.came_from, `${formatCount(total)} rows`, `${shown.length} columns`].filter(Boolean).join(" · ")}
        </p>
      </header>
      <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
        <table className="aug-fs-sm" style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}>
          <thead>
            <tr className="aug-fs-xs" style={{ ...MUTED, textAlign: "left", position: "sticky", top: 0, background: "var(--bg-2)" }}>
              {shown.map(({ c }) => (
                <th key={c.id} scope="col" style={{ ...CELL, fontWeight: 500, textAlign: numeric(c.kind) ? "right" : "left" }}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, n) => (
              <tr key={n}>
                {shown.map(({ c, at }) => (
                  <td key={c.id} style={{ ...CELL, textAlign: numeric(c.kind) ? "right" : "left", fontVariantNumeric: "tabular-nums" }}>
                    {cellText(r[at + 1], c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="aug-fs-xs" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px",
                                               borderTop: "1px solid var(--b2)", ...MUTED }}>
        <span>{formatCount(rows.length)} of {formatCount(total)} rows, in the sheet&apos;s order</span>
        {rows.length < total && (
          <Button variant="outline" size="xs" disabled={reading} onClick={more}>
            {reading ? "Reading…" : `Next ${formatCount(Math.min(PAGE, total - rows.length))}`}
          </Button>
        )}
      </footer>
    </main>
  );
}
