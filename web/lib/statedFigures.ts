/**
 * Whether an answer's words already state a figure of its result, rounded any way a writer rounds it.
 *
 * "Such a simple question and it got answered — then why do we have two different figures shown as the evidence
 * below? Let's not do things just for the sake of it" (2026-10-02): nothing below an answer repeats a figure it
 * states. The platform's one-record figures read it (`FindingFigures`), and so does the coworker's answer card
 * (the user, 2026-11-20, of a row count drawn again in a box under "…contains 8,807 rows": "Do you think its
 * neccessary to have a block for a single figure? We must some logic here.."). One rule, read by both.
 *
 * Plain TypeScript with no imports: the coworker bundles it from here.
 */

/** A number as an answer writes it — "359,224.30", "$359.2K", "18.5%", "2.4 million" — but not one inside
 *  a word or a code ("Q3", "H1"). */
const WRITTEN = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)(?:\s*(%|thousand|million|billion|mn|bn|[kmb])(?![a-z]))?/gi;
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/** Each number the text writes: its value, the step of its last written digit, where it is written. */
function writtenNumbers(text: string): { value: number; step: number; percent: boolean; at: number }[] {
  return Array.from(text.matchAll(WRITTEN), (m) => {
    const digits = m[1].replace(/,/g, "");
    const unit = (m[2] ?? "").toLowerCase();
    const scale = SCALE[unit] ?? 1;
    const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
    return { value: Number(digits) * scale, step: 10 ** -decimals * scale, percent: unit === "%", at: m.index ?? 0 };
  });
}

/** Where the text states this value, rounded any way a writer rounds it ("$359.2K" states 359,224.30;
 *  "9.4%" states a share of 0.0937); -1 when it does not. A sign is the sentence's to word ("fell
 *  5,421.84"), and text is stated by being written. */
export function statedAt(text: string, v: unknown): number {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return -1;
  const n = Math.abs(Number(v));
  if (Number.isNaN(n)) return text.toLowerCase().indexOf(String(v).toLowerCase());
  const hit = writtenNumbers(text).find((w) => {
    if (w.value === 0 && n !== 0) return false;        // a "0" states nothing but zero
    const near = (x: number) => Math.abs(x - w.value) <= w.step / 2 + 1e-9 * Math.max(1, x);
    return near(n) || (w.percent && near(n * 100));
  });
  return hit ? hit.at : -1;
}

export function isStated(text: string, v: unknown): boolean {
  return statedAt(text, v) >= 0;
}

/** A key names the record (an id, a rank, a period) — "order_month" is a key, "monthly_revenue" is not. */
const KEY_COL = /(^|_)(id|rank|year|quarter|month|week|day|date|period)$/i;

/** The values of one record the answer does not state. None when it states every measure: a key worded
 *  differently ("July 2026" for 2026-07-01) is not a figure worth repeating on its own. */
export function unstatedFigures(columns: string[], row: unknown[], answer: string): number[] {
  const all = columns.map((_, i) => i);
  const unstated = all.filter((i) => !isStated(answer, row[i]));
  const isMeasure = (i: number) => {
    const v = row[i];
    return v !== null && v !== undefined && v !== "" && typeof v !== "boolean" && !Number.isNaN(Number(v))
      && !KEY_COL.test(columns[i]);
  };
  if (!all.some(isMeasure)) return unstated;
  return unstated.some(isMeasure) ? unstated : [];
}
