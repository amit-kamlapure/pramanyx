/**
 * How a placed card writes its numbers (study R9; dashboard format v16): decimals (auto, 0, 1 or 2), compact (1.2M) or
 * whole (1,234,567), and a negative with a minus or in parentheses. Display only: the unit stays the metric's — a
 * percent stays a percent and money keeps the organisation's symbol, and a ratio is never written as money. Left
 * unset, each figure is written as before.
 */

export interface NumberLook {
  /** Places after the point; unset is the figure's own default. */
  decimals?: 0 | 1 | 2 | null;
  /** 1.2M (true) or 1,234,567 (false); unset is the figure's own default. */
  compact?: boolean | null;
  /** -1,234 (unset or "minus") or (1,234). */
  negatives?: "minus" | "parens" | null;
}

export const LOOK_DECIMALS = [0, 1, 2] as const;

/** True when the look asks for nothing: every figure is written as it always was. */
export function isPlainLook(look?: NumberLook | null): boolean {
  return !look || (look.decimals == null && look.compact == null && look.negatives == null);
}

/** A placement's look, read from its props; null when it has none. */
export function lookOf(props: Record<string, unknown> | null | undefined): NumberLook | null {
  const n = props?.number as NumberLook | null | undefined;
  return n && typeof n === "object" && !isPlainLook(n) ? n : null;
}

/**
 * One number, written by a look. `v` is in the units it is read in: a percent already multiplied by 100. `compact`
 * is what the figure does when the look leaves it unset; under a thousand a number is never compacted.
 */
export function writeNumber(v: number, look: NumberLook,
  how: { percent?: boolean; prefix?: string; suffix?: string; compact: boolean }): string {
  const a = Math.abs(v);
  let body: string;
  if (how.percent) {
    body = `${a.toFixed(look.decimals ?? 1)}%`;
  } else if ((look.compact ?? how.compact) && a >= 1e3) {
    const [n, mag] = a >= 1e9 ? [a / 1e9, "B"] : a >= 1e6 ? [a / 1e6, "M"] : [a / 1e3, "K"];
    body = `${n.toFixed(look.decimals ?? 1)}${mag}`;
  } else {
    const d = look.decimals ?? (Number.isInteger(a) ? 0 : 2);
    body = a.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const text = `${how.prefix ?? ""}${body}${how.suffix ?? ""}`;
  // a negative that rounds to nothing is written as nothing, not as "-0"
  if (v >= 0 || Number(body.replace(/[^0-9.]/g, "")) === 0) return text;
  return look.negatives === "parens" ? `(${text})` : `-${text}`;
}
