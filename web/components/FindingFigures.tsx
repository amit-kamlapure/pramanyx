"use client";
/**
 * A result of ONE row is its figures, read in a line — not a table.
 *
 * "If it's a single number being displayed, does one really need a table? How un-intelligent is
 * that?" (2026-10-02). Q1's units sold and revenue each came back as one cell, and each was drawn
 * as a collapsed "Data · 1 rows" table with a totals toggle and copy buttons around a single value.
 * A row of one record is a statement of fact: each value beside its label, in the form its table
 * cell would take — money to the cent — with the source data a click away as before.
 *
 * And not at all where the answer already says it: "such a simple question and it got answered — then
 * why do we have two different figures shown as the evidence below? Let's not do things just for the
 * sake of it" (2026-10-02). Q1's sentence stated both figures and the evidence printed both again. A
 * figure is evidence only when it says something the answer does not; what a stated figure still owes
 * the reader is where it came from — its data and SQL, one click away (`FigureSources`).
 */
import React from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cleanLabel, formatMoney, formatPercent, formatTableNumber } from "@/lib/format";
import { columnCurrencySymbol, isMoneyColumn } from "@/lib/orgSettings";
import { ORDINAL_COL, SHARE_COL } from "@/components/charts/columnRoles";
import { statedAt, unstatedFigures } from "@/lib/statedFigures";

// Whether an answer states a figure is its own module, so the coworker reads it by the same rule (2026-11-20).
export { isStated, unstatedFigures } from "@/lib/statedFigures";

/** The widest record still read as a line; past it, a table reads better. */
export const MAX_FIGURES = 6;

export function isOneRecord(columns: string[], rows: unknown[][]): boolean {
  return rows.length === 1 && columns.length >= 1 && columns.length <= MAX_FIGURES;
}

/** One value as a figure: a share as a percentage, money to the cent with its symbol, a count with
 *  separators; a key (a year, an id) and any text as written. Money and shares are read first, as the
 *  table's cells read them: `monthly_revenue` names a month and is money. */
export function figureValue(col: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (typeof v === "boolean" || Number.isNaN(n)) return String(v);
  if (SHARE_COL.test(col)) return formatPercent(n, 1);
  if (isMoneyColumn(col)) return formatMoney(n, columnCurrencySymbol(col));
  if (ORDINAL_COL.test(col)) return String(v);
  return formatTableNumber(n);
}

/** One record's figures — those the answer (when given) does not already state; nothing when it states them all. */
export function FindingFigures({ columns, row, answer = "" }: { columns: string[]; row: unknown[]; answer?: string }) {
  const shown = unstatedFigures(columns, row, answer);
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
      {shown.map((i) => (
        <div key={`${columns[i]}-${i}`} className="flex items-baseline gap-1.5">
          <span className="aug-fs-xs text-zinc-500">{cleanLabel(columns[i])}</span>
          <span className="aug-text-ui font-semibold text-zinc-200 tabular-nums">{figureValue(columns[i], row[i])}</span>
        </div>
      ))}
    </div>
  );
}

type Source = { finding_id: string; title: string; sql?: string | null; columns: string[]; rows: unknown[][] };
type ShowSource = (data: { columns: string[]; rows: unknown[][]; sql: string | null; title: string }) => void;

/** A simple answer's evidence — every result behind it one record: no figure the sentence states, and
 *  one line naming each, in the order the sentence states them, that opens its data and SQL. Two results
 *  of the same measures are told apart by their titles. */
export function FigureSources({ results, answer, onShowSource }: { results: Source[]; answer: string; onShowSource?: ShowSource }) {
  const names = results.map((r) => r.columns.map(cleanLabel).join(" · "));
  const mention = (r: Source) => {
    const at = (r.rows[0] ?? []).map((v) => statedAt(answer, v)).filter((i) => i >= 0);
    return at.length ? Math.min(...at) : Infinity;
  };
  const ordered = results.map((r, i) => ({ r, i, at: mention(r) })).sort((a, b) => a.at - b.at || a.i - b.i);
  return (
    <div className="flex flex-col gap-2">
      {ordered.map(({ r }) => (
        <FindingFigures key={`figures-${r.finding_id}`} columns={r.columns} row={r.rows[0] ?? []} answer={answer} />
      ))}
      {onShowSource && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {ordered.map(({ r, i }) => (
            <Button
              key={r.finding_id}
              variant="plain"
              size="xs"
              onClick={() => onShowSource({ columns: r.columns, rows: r.rows, sql: r.sql || null, title: r.title })}
              className="max-w-full px-0 text-[var(--t3)] hover:text-[var(--t1)]"
              title={`Data + SQL behind “${r.title}”`}
            >
              <Icon name="table" size={16} label="Table" />
              <span className="truncate">{names.indexOf(names[i]) !== names.lastIndexOf(names[i]) ? r.title : names[i]}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
