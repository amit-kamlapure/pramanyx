/**
 * A figure drafted from a file, written as its statement says it is: money, a percent, or a plain number
 * (`pramanyx/dashboards/queries.py`, `Shown.format` and `Beside.format`).
 */
import { formatCount, formatWholeMoney, pct } from "@/lib/format";
import { effectiveCurrencySymbol } from "@/lib/orgSettings";
import { isPlainLook, writeNumber, type NumberLook } from "@/lib/dashboards/numberLook";

export function draftedFigure(value: number | null | undefined, format?: string, look: NumberLook | null = null): string {
  // a placed card's own look (dashboards v16, study R9): whole numbers stay whole unless it asks for compact
  if (look && !isPlainLook(look) && value !== null && value !== undefined && Number.isFinite(value)) {
    if (format === "money") return writeNumber(value, look, { prefix: effectiveCurrencySymbol() || "$", compact: false });
    if (format === "percent") return writeNumber(value * 100, look, { percent: true, compact: false });
    return writeNumber(value, look, { compact: false });
  }
  if (format === "money") return formatWholeMoney(value, effectiveCurrencySymbol() || "$");
  if (format === "percent") return pct(value, 1);
  return formatCount(value);
}
