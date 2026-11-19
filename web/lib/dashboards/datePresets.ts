/**
 * Dates a filter keeps by name and reads afresh each day (format v20). "Last" counts complete periods ending before today, in the
 * person's own clock: the day before today is yesterday, however the data has settled.
 */
export const DATE_PRESETS = ["today", "yesterday", "last_7_days", "last_30_days", "last_90_days", "this_month", "last_month", "this_year", "last_12_months"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const PRESET_WORDS: Record<DatePreset, string> = {
  today: "Today", yesterday: "Yesterday", last_7_days: "Last 7 days", last_30_days: "Last 30 days", last_90_days: "Last 90 days",
  this_month: "This month", last_month: "Last month", this_year: "This year", last_12_months: "Last 12 months",
};

/** The presets that name one day, for a filter that holds one. */
export const DAY_PRESETS: readonly DatePreset[] = ["today", "yesterday"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The first and last day a preset covers now. */
export function rangeOfPreset(preset: DatePreset, now: Date = new Date()): { low: string; high: string } {
  const [y, m, d] = [now.getFullYear(), now.getMonth(), now.getDate()];
  const yesterday = new Date(y, m, d - 1);
  const days = (n: number) => ({ low: iso(new Date(y, m, d - n)), high: iso(yesterday) });
  switch (preset) {
    case "today": return { low: iso(now), high: iso(now) };
    case "yesterday": return { low: iso(yesterday), high: iso(yesterday) };
    case "last_7_days": return days(7);
    case "last_30_days": return days(30);
    case "last_90_days": return days(90);
    case "this_month": return { low: iso(new Date(y, m, 1)), high: iso(now) };
    case "last_month": return { low: iso(new Date(y, m - 1, 1)), high: iso(new Date(y, m, 0)) };
    case "this_year": return { low: iso(new Date(y, 0, 1)), high: iso(now) };
    case "last_12_months": return { low: iso(new Date(y, m - 12, 1)), high: iso(new Date(y, m, 0)) };
  }
}
