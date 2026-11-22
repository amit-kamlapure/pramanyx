/**
 * timeAxis.ts — the date axis every chart over real dates shares: its scale (UTC for a date grain), one tick per period,
 * labels in the grain's own format, and months short enough that each fits. The line and the bar in `resolveSpec.ts`
 * and the stacked bar in `forms.ts` read it here, so a month reads the same under all three.
 */

import { chartDateFormat, type DateFormat, type Gran } from "@/lib/format";

/** One tick per period of the series' grain — a stride of periods past eighteen. `%b %Y` labels on
 *  the default ticks repeated a month ("Aug 2025 Aug 2025 Sep 2025 …") once a chart was wide enough
 *  for two ticks a month (theLook Q3, 2026-10-02). A sub-day grain keeps the default ticks. */
export function periodTicks(gran: Gran, periods: number): Record<string, unknown> {
  const unit = gran === "quarter" ? "month" : gran;
  if (!["day", "week", "month", "year"].includes(unit)) return {};
  return { tickCount: { interval: unit, step: (gran === "quarter" ? 3 : 1) * Math.max(1, Math.ceil(periods / 18)) } };
}

/** A date-grain axis keeps time in UTC. A day read from the warehouse ("2025-08-01") is UTC
 *  midnight, which is 02:00 in Zurich: a local scale put its month tick at local midnight, before
 *  the first point, and the series' first month went unlabelled (theLook Q3, 2026-10-03). A grain
 *  with a time of day keeps the viewer's clock. */
export function utcScale(gran: Gran | null): Record<string, unknown> {
  return gran && ["day", "week", "month", "quarter", "year"].includes(gran) ? { scale: { type: "utc" } } : {};
}

/** Month labels short enough that every one fits: the month alone, with its year beneath it on the
 *  first month and on January ("Aug / 2025, Sep, …, Jan / 2026, …"). `%b %Y` on thirteen months ran
 *  labels together and dropped three (theLook Q3, 2026-10-03); a year beside its month was still wide
 *  enough for Vega to hide its neighbours. Six months or fewer keep `%b %Y`, and so does a series
 *  ticked past one month a tick, where January may not be a tick at all. Read in UTC, as `utcScale`
 *  keeps the axis. */
export function compactMonths(gran: Gran | null, values: unknown[]): Record<string, unknown> {
  const months = [...new Set(values.map((v) => String(v ?? "").slice(0, 7)))]
    .filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
  if (gran !== "month" || months.length <= 6 || months.length > 18) return {};
  const [y, m] = months[0].split("-").map(Number);
  // Each label centred on its own month: flush at the ends, the first was pushed into the second and
  // the last into the one before, and Vega hid both.
  return { labelFlush: false,
           labelExpr: `(utcmonth(datum.value) == 0 || (utcyear(datum.value) == ${y} && utcmonth(datum.value) == ${m - 1}))`
                      + " ? [utcFormat(datum.value, '%b'), utcFormat(datum.value, '%Y')] : utcFormat(datum.value, '%b')" };
}

/**
 * A date axis for a series of `gran`: the grain's label format — with the year kept when the series crosses one, since a
 * bare month is ambiguous across a boundary — one tick per period, and compact months.
 */
export function dateAxis(gran: Gran, values: unknown[]): Record<string, unknown> {
  const multiYear = new Set(values.map((v) => String(v ?? "").slice(0, 4))).size > 1;
  return { format: chartDateFormat(gran, multiYear),
           ...periodTicks(gran, new Set(values.map(String)).size),
           ...compactMonths(gran, values) };
}

/** Each way of writing a date the editor offers (`DATE_FORMATS`), as the axis's UTC format. */
const DATE_FORMAT_D3: Record<DateFormat, string> = {
  "YYYY-MM-DD": "%Y-%m-%d", "YYYY-MM": "%Y-%m", "MMM YYYY": "%b %Y", "DD MMM YYYY": "%d %b %Y",
  "MMM D, YYYY": "%b %-d, %Y", "YYYY-QQ": "%Y Q%q", YYYY: "%Y",
};

/**
 * The date axis, written as a person chose in the editor ("Dates as") when they chose — one tick per period still, every
 * label in that one format — else as the grain writes it (`dateAxis`). 2026-11-23: an answer's line and bar ignored the
 * choice (the editor said "YYYY-MM", the axis said "Sep 2017"), while a dashboard's card honoured it.
 */
export function dateAxisAs(gran: Gran, values: unknown[], written?: DateFormat | null): Record<string, unknown> {
  if (!written || !DATE_FORMAT_D3[written]) return dateAxis(gran, values);
  return { ...periodTicks(gran, new Set(values.map(String)).size), labelFlush: false,
           labelExpr: `utcFormat(datum.value, '${DATE_FORMAT_D3[written]}')` };
}
