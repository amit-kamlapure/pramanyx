"use client";
/**
 * An answer's one result, drawn: its figures inline when it is one row of numbers, a chart when its shape wants one, its
 * table otherwise. Moved out of `ChatMessage` so the answer view (`answer/AnswerView.tsx`) draws the grid an answer rests on
 * with the same organ the chat always used; `ChatMessage` re-exports what it exported before.
 */
import { SqlResultTable } from "@/components/AugTable";
import { BriefFigure, BriefMetrics, type BriefMetric } from "@/components/brief/Brief";
import { ResultChartCard } from "@/components/charts/ResultChartCard";
import { mapHintFor } from "@/components/charts/chartTypeInference";
import { DATE_COL, ORDINAL_COL, SHARE_COL, classifyColumns, firstNonNull, isIdLike, isNumeric } from "@/components/charts/columnRoles";
import { mapLayout } from "@/components/charts/geo/mapDrawing";
import { useObjectColumnLinks } from "@/components/objects/objectColumnLinks";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { deriveFigureSource } from "@/lib/figureSource";
import {
  type Gran, GRAN_WORD, cleanLabel, compactNumber, detectGranularity, fmtDate, formatPercent, granFromName,
} from "@/lib/format";

/** The rows and SQL a result's source panel opens on (structurally `ChatMessage`'s SourcePanelData). */
export type ResultSource = { columns: string[]; rows: unknown[][]; sql: string | null; title: string };

/** A result's title, from what its columns are. */
export function inferSourceTitle(columns: string[], rows: unknown[][]): string {
  if (!columns.length) return "Query result";

  // The date column is the shared classifier's: a column of plain numbers is a date only when it is named as a calendar
  // grain. By its name alone, a count called `orders_without_carrier_date` titled a breakdown by status "Daily Orders
  // Without Carrier Date by Order Status" (a sheet's chat, 2026-10-27), though nothing in it was a day.
  const dateColIdx = classifyColumns(columns, rows).dateIdxs[0] ?? -1;
  // isIdLike: camelCase ids (franchiseID) pass ORDINAL_COL and became the "measure"
  // in captions — "Franchiseid by Branch Name" over a chart actually plotting counts.
  const numColNames = columns.filter((c, i) =>  isNumeric(firstNonNull(rows, i)) && !ORDINAL_COL.test(c) && !isIdLike(c));
  const catColNames = columns.filter((c, i) => !isNumeric(firstNonNull(rows, i)) && i !== dateColIdx && !DATE_COL.test(c));

  const measure = numColNames[0] ? cleanLabel(numColNames[0]) : "";
  const dim     = catColNames[0] ? cleanLabel(catColNames[0]) : "";
  const hasDate = dateColIdx >= 0;
  // Use the actual time grain ("Weekly"/"Daily"/…) instead of assuming monthly.
  const grainWord = hasDate
    ? GRAN_WORD[detectGranularity(columns[dateColIdx], rows.map(r => (r as unknown[])[dateColIdx]))]
    : "";

  if (measure && dim && hasDate) return `${grainWord} ${measure} by ${dim}`;
  if (measure && dim)            return `${measure} by ${dim}`;
  if (measure && hasDate)        return `${grainWord} ${measure}`;
  if (measure)                   return measure;
  if (dim)                       return dim;
  return "Query result";
}

export function sortRowsForDisplay(columns: string[], rows: unknown[][]): unknown[][] {
  const dimIdxs = columns
    .map((_, i) => i)
    .filter(i => !isNumeric(firstNonNull(rows, i)));
  if (!dimIdxs.length) return rows;

  return [...rows].sort((a, b) => {
    for (const i of dimIdxs) {
      const va = String((a as unknown[])[i] ?? "");
      const vb = String((b as unknown[])[i] ?? "");
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

export function fmt(col: string, val: unknown, gran?: Gran): string {
  if (val === null || val === "NULL") return "—";
  const s = String(val);
  // Format a date at its true granularity (week→"Jan 5", month→"Jan 2026", …).
  // `gran` is passed when the caller has the whole column (spacing-detected);
  // otherwise fall back to the column name.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return fmtDate(s, gran ?? granFromName(col) ?? "day");
  if (ORDINAL_COL.test(col)) return s;
  const n = Number(val);
  if (!isNaN(n)) {
    // Route through the ONE formatter (REC-U8) — no more hand-rolled k/M/%: a
    // share column reads as a percent (ratio-or-percent aware), everything else
    // as the app's compact number, so "45.3K" is "45.3K" everywhere.
    if (SHARE_COL.test(col)) return formatPercent(n, 2);
    return compactNumber(n);
  }
  return s;
}

// ── Single-row numeric result → inline metrics (label/value pairs) ────────────
// Mirrors the old KPICards column selection; rendering goes through <BriefMetrics>.
export function columnsToMetrics(columns: string[], rows: unknown[][]): BriefMetric[] {
  const row = rows[0];
  if (!row) return [];
  const numericCols = columns.filter((c, i) => isNumeric(row[i]) && !ORDINAL_COL.test(c));
  const isSingle = numericCols.length === 1;
  return numericCols.map((col) => {
    const idx = columns.indexOf(col);
    return { label: isSingle ? "" : cleanLabel(col), value: fmt(col, row[idx]) };
  });
}

// ── Result figure — the framed block: inline metrics, a chart, or a table ─────
// The ONLY framed object in an Insight brief. Single-row numbers render inline
// (no frame); a chartable / tabular result renders inside one <BriefFigure>.
// Shimmer placeholders for the scaffold-then-fill answer card (piece 4). Both
// use the design-system `aug-shimmer` (its own gradient + animation, and it's
// already covered by the prefers-reduced-motion block).
export function HeadlineSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <div className="aug-shimmer rounded-[var(--r2)]" style={{ height: 17, width: "70%" }} />
      <div className="aug-shimmer rounded-[var(--r2)]" style={{ height: 17, width: "45%" }} />
    </div>
  );
}

export function FigureSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <div className="aug-shimmer rounded-[var(--r2)]" style={{ height: 11, width: "38%" }} />
      <div className="aug-shimmer rounded-[var(--r3)]" style={{ height: 176, width: "100%" }} />
    </div>
  );
}

export function ResultFigure({
  question, columns, rows, sql, chartType: askedChart, chartConfig, shape, onShowSource, streaming = false, connectionId,
}: {
  /** The question asked — a map hint reads it. */
  question: string;
  columns: string[];
  rows: unknown[][];
  sql: string | null;
  chartType: string | null;
  chartConfig?: Record<string, unknown> | null;
  /** The question's shape (describe · check · diagnose · survey): a check's results are tables. */
  shape?: string;
  onShowSource?: (data: ResultSource) => void;
  streaming?: boolean;
  /** ON-3 — the connection whose object catalog turns key columns into object links. */
  connectionId?: string;
}) {
  const chartType = mapHintFor(question, columns, rows, askedChart) ?? askedChart;
  // Before any early return: a hook cannot be skipped while the rows are still arriving.
  const objectLinks = useObjectColumnLinks(columns, connectionId, { rows });
  if (!columns.length) return streaming ? <FigureSkeleton /> : null;
  // Columns usually land a beat before rows — never flash an empty, headers-only
  // table mid-stream; hold a shimmer until at least one row arrives. (A genuine
  // zero-row result at done still renders its empty table, unchanged.)
  if (rows.length === 0 && streaming) return <FigureSkeleton />;

  const source = deriveFigureSource(sql, columns, rows);
  const isSingleRow = rows.length === 1;
  const hasDate = columns.some((c) => DATE_COL.test(c));
  const hasCat  = columns.some((c, i) => !isNumeric(rows[0]?.[i]));
  const hasNum  = columns.some((c, i) => isNumeric(rows[0]?.[i]) && !ORDINAL_COL.test(c));

  // Only chart once every row is shaped to the column count — a half-streamed
  // row would otherwise feed the chart malformed points.
  const chartDataReady = rows.length > 0 && rows.every(r => Array.isArray(r) && r.length >= columns.length);
  // A check (route shape "check") verifies the data: its results are tables — the counts a verdict
  // rests on are read, not plotted — unless one has a real dimension; a count by platform is a bar.
  const isCheck = shape === "check";
  const explicitChart = chartType && chartType !== "auto";
  const showChart = (isCheck
    ? rows.length >= 2 && hasNum && hasCat
    : explicitChart
      ? hasNum
      : rows.length >= 3 && hasNum && (hasDate || hasCat)) && chartDataReady;

  // A map is titled by what it sizes and what it places, never by a coordinate.
  const mapped = chartType === "point_map" ? mapLayout({ columns, rows, kind: "points" }) : chartType === "choropleth" ? mapLayout({ columns, rows, kind: "shapes" }) : null;
  const sourceTitle = mapped && mapped.measure >= 0 && mapped.label >= 0
    ? `${cleanLabel(columns[mapped.measure])} by ${cleanLabel(columns[mapped.label])}`
    : inferSourceTitle(columns, rows);

  function handleSourceClick() {
    onShowSource?.({
      columns,
      rows: sortRowsForDisplay(columns, rows),
      sql,
      title: sourceTitle,
    });
  }

  if (isSingleRow && hasNum && !isCheck) {
    return <BriefMetrics metrics={columnsToMetrics(columns, rows)} />;
  }

  if (showChart) {
    return (
      <div className="flex flex-col gap-1.5">
        <BriefFigure caption={sourceTitle} source={source} className="aug-hover-frame">
          <ResultChartCard liveMap columns={columns} rows={rows} chartType={isCheck ? "bar" : chartType} chartConfig={chartConfig} title={sourceTitle} />
        </BriefFigure>
        {onShowSource && (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleSourceClick}
            className="self-end gap-1.5 aug-text-xs font-normal text-zinc-500 hover:text-zinc-300 hover:bg-transparent dark:hover:bg-transparent"
          >
            <Icon name="table" size={16} label="Table" />
            Source data
          </Button>
        )}
      </div>
    );
  }

  return (
    <BriefFigure caption={sourceTitle} source={source}>
      <SqlResultTable columns={columns} rows={rows} maxHeight={320} columnOverrides={objectLinks} />
    </BriefFigure>
  );
}
