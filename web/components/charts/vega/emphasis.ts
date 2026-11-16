/**
 * Emphasis — the chosen values stay, everything else recedes (exhibit `emphasis`; the dashboard's focus, the board
 * study §6.2). One test for every chart kind, so a value chosen on a dashboard lights the same way on a bar, a line's
 * point, a slice, a tile or a cell.
 *
 * A value is compared as text, so a year held as a number still matches the "2025" a click reported; a date is
 * compared as its ISO day, because Vega-Lite hands a temporal field over as a Date. No colour is written: the
 * de-emphasis is a wash, as the selection's is.
 */

/** How strongly what is not chosen recedes — the selection's wash, beside `SELECT_OPACITY`'s 0.28. */
export const RECEDE = 0.32;

/** The chosen values, as the test compares them: text, a date its ISO day; nothing empty. */
export function subjectsOf(subjects: readonly unknown[] | null | undefined, isDate = false): string[] {
  return (subjects ?? [])
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map((v) => (isDate ? String(v).slice(0, 10) : String(v)));
}

/** A Vega expression reading `field` off a datum; a dotted path (a map's `properties.name`) is read as a path. */
function read(field: string, isDate: boolean): string {
  const at = field.includes(".") ? `datum.${field}` : `datum[${JSON.stringify(field)}]`;
  return isDate ? `utcFormat(toDate(${at}), '%Y-%m-%d')` : `'' + ${at}`;
}

/** The test that a datum is one of the chosen, over one or more fields (a heatmap's row or column); null when nothing
 *  is chosen. */
export function emphasisTest(subjects: readonly unknown[] | null | undefined,
  fields: readonly (string | null | undefined | { field: string; isDate?: boolean })[], isDate = false): string | null {
  const parts = fields.flatMap((f) => {
    if (!f) return [];
    const field = typeof f === "string" ? f : f.field;
    const date = typeof f === "string" ? isDate : !!f.isDate;
    const s = subjectsOf(subjects, date);
    return s.length ? [`indexof(${JSON.stringify(s)}, ${read(field, date)}) >= 0`] : [];
  });
  return parts.length ? parts.join(" || ") : null;
}

/** A Vega-Lite opacity encoding lighting the chosen values of `field`, or null when nothing is chosen. */
export function emphasisOpacity(subjects: readonly unknown[] | null | undefined, field: string | null | undefined,
  isDate = false): Record<string, unknown> | null {
  const test = emphasisTest(subjects, [field], isDate);
  return test ? { condition: { test, value: 1 }, value: RECEDE } : null;
}
