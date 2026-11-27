"use client";
/**
 * One exhibit of an answer: a result the answer cites, captioned by the claim the reader takes from it, drawn as its
 * chart, its figures (one record) or its table, with its rows, its tables and its SQL one click away. Moved out of
 * the deep analysis report (the analyst's concluded answer drew it first, P1) so the one answer view
 * (`answer/AnswerView.tsx`) draws every answer's exhibits with it.
 */
import { useState } from "react";

import { SqlResultTable } from "@/components/AugTable";
import { ResultChartCard } from "@/components/charts/ResultChartCard";
import { Chip, ROW, RULE } from "@/components/clarity/kit";
import { FindingFigures, isOneRecord } from "@/components/FindingFigures";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { deriveFigureSource } from "@/lib/figureSource";

/** Open the right-side Source-data drawer (data + SQL + Query Builder) for a result. */
export type ShowSource = (data: { columns: string[]; rows: unknown[][]; sql: string | null; title: string }) => void;

export interface PhaseKeyNumber {
  label: string;
  value: string;
  delta?: string;
  context?: string;
}

export interface ExhibitFinding {
  finding_id: string;
  title: string;
  sql: string;
  columns: string[];
  rows: (string | number | null)[][];
  row_count: number;
  error?: string;
  interpretation: string;
  key_numbers: PhaseKeyNumber[];
  chart_type: string;
  stat_note?: string;
  is_significant: boolean;
  trust_caveat?: string | null;   // advisory from the trust battery — surfaced, never blocking
  column_units?: Record<string, string> | null;  // per-column display unit ({metric_total:"percent"})
  exhibit?: import("@/components/charts/exhibit").ExhibitSpec | null;  // chart-grammar semantics
  claim?: string | null;     // CA-4: the one-sentence claim — the chart's title when present
  subtitle?: string | null;  // CA-4: scope · period · unit under the claim
  /** 2026-11-06 — `names`: what the model's cryptic columns read as (`answer/series_names.py`). */
  chart_config?: Record<string, unknown>;
}

/** The prefixes that mark the READER-FACING half of a `stat_note`.
 *
 *  Mirror of the backend's `READER_FACING_STAT_MARKERS` (grep that name), which
 *  interpolates these into the notes it writes. `test_stat_note_markers_parity` walks both
 *  — the same arrangement chart_vocab.JOB_TO_FORM has with chartTypeInference.ts. */
const STAT_WARNING_MARKERS = ["PARTIAL FINAL PERIOD", "EXPOSURE CHECK"] as const;

/** A stat note split into the machinery and the warning.
 *
 *  A note is two things concatenated: a verdict ("z = 8.2 — significant"), and sometimes a
 *  warning about whether the number can be read at all ("PARTIAL FINAL PERIOD: September
 *  2026 holds 21 of 30 days (70%) — its total is not comparable to a full month…").
 *
 *  They are split because the clean-output policy below is right about one and wrong about
 *  the other. A z-score is the machine talking to itself and belongs out of the body. A
 *  sentence telling the reader the final month is incomplete is not machinery — it changes
 *  what the number in front of them MEANS, and withholding it is how run 29c3c169 shipped
 *  "reaching $342,313 in September 2026 … an increase of 27.4%" about a month that was 70%
 *  over (2026-09-18). Sniffing for capitals instead of these declared markers would split
 *  on "THE OUTNET", a retailer's name quoted out of the data. */
export function splitStatNote(note?: string): { verdict: string; warning: string } {
  const t = (note || "").trim();
  if (!t) return { verdict: "", warning: "" };
  const at = STAT_WARNING_MARKERS
    .map((m) => t.indexOf(m))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  if (at === undefined) return { verdict: t, warning: "" };
  return { verdict: t.slice(0, at).trim(), warning: t.slice(at).trim() };
}

export function sourceLabel(title: string): string {
  const t = (title || "").replace(/\*/g, "").trim();
  if (!t) return "Source data";
  return t.length > 46 ? t.slice(0, 46).trimEnd() + "…" : t;
}

/** A caveat as a chip: its first clause on the page, the whole of it on hover. */
export function caveatChip(text: string) {
  const first = text.split(/[:;—]/)[0].trim();
  return first.length > 72 ? first.slice(0, 72).trimEnd() + "…" : first;
}

/** The one grid slot of an exhibit — today the result table; the one line the grid consolidation changes. */
function ExhibitGrid({ finding }: { finding: ExhibitFinding }) {
  return <SqlResultTable columns={finding.columns} rows={finding.rows as unknown[][]} maxHeight={280} />;
}

export function Exhibit({ n, finding, claim, answer, onShowSource }: {
  n: number; finding: ExhibitFinding; claim: string; answer: string; onShowSource?: ShowSource;
}) {
  const [open, setOpen] = useState(false);
  // What the card above is showing. A table needs no "Table" beneath it (the user, 2026-11-06), so the
  // disclosure is offered only beside a chart, or where no card is drawn at all.
  const [cardView, setCardView] = useState<"chart" | "table" | "pivot" | null>(null);
  const { warning } = splitStatNote(finding.stat_note);
  const hasData = finding.columns.length > 0 && finding.rows.length > 0;
  const hasChart = hasData && finding.chart_type !== "none" && finding.rows.length >= 2;
  const oneRecord = hasData && !hasChart && isOneRecord(finding.columns, finding.rows as unknown[][]);
  const source = deriveFigureSource(finding.sql, finding.columns, finding.rows as unknown[][], finding.row_count);
  const caption = claim.trim() || finding.title;
  return (
    <div className="aug-hover-frame flex flex-col gap-2 pt-3" style={RULE} data-testid={`exhibit-${finding.finding_id}`}>
      <div style={{ ...ROW, alignItems: "baseline" }}>
        <span className="aug-fs-xs font-semibold" style={{ color: "var(--blue4)" }}>{n}</span>
        <span className="aug-text-ui font-medium text-zinc-100">{caption}</span>
        {finding.trust_caveat?.trim() && (
          <span style={{ marginLeft: "auto" }}>
            <Chip tone="amber" title={finding.trust_caveat}>⚠ {caveatChip(finding.trust_caveat)}</Chip>
          </span>
        )}
      </div>
      {hasChart && (
        <ResultChartCard columns={finding.columns} rows={finding.rows as unknown[][]} title={caption}
                         chartType={finding.chart_type} chartConfig={finding.chart_config} columnUnits={finding.column_units}
                         exhibit={finding.exhibit} defaultShowLabels onViewChange={setCardView} />
      )}
      {oneRecord && <FindingFigures columns={finding.columns} row={finding.rows[0] as unknown[]} answer={answer} />}
      {warning && <div className="aug-fs-xs text-zinc-400 leading-relaxed">⚠ {warning}</div>}
      {finding.error && <p className="aug-text-xs text-red-400 font-mono">{finding.error}</p>}
      {hasData && (
        <div className="aug-fs-xs text-zinc-500" style={ROW}>
          {source?.tables?.length ? <span className="font-mono">{source.tables.join(" · ")}</span> : null}
          <span>{finding.row_count || finding.rows.length} rows</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
            {(!hasChart || cardView === "chart") && (
              <Button variant="ghost" size="xs" onClick={() => setOpen(v => !v)}>
                {open ? <Icon name="chevd" size={16} /> : <Icon name="chevr" size={16} />}Table
              </Button>
            )}
            {onShowSource && (
              <Button variant="ghost" size="xs" title={`Data + SQL behind “${finding.title}”`}
                      onClick={() => onShowSource({ columns: finding.columns, rows: finding.rows as unknown[][], sql: finding.sql || null, title: finding.title })}>
                <Icon name="table" size={16} label="SQL" />SQL
              </Button>
            )}
          </span>
        </div>
      )}
      {open && hasData && (!hasChart || cardView === "chart") && <ExhibitGrid finding={finding} />}
    </div>
  );
}

