/**
 * compact.ts — the app's own compact number as a Vega expression, for every chart engine: an answer's (`resolveSpec`)
 * and a dashboard's (`lib/dashboards/queryChart`). 2026-11-23: the two disagreed on one screen — "20.0K" on an answer's
 * line, "20k" on the same data drawn as a dashboard's, and "1.2G" for a billion — while every other number in the
 * product reads 6.6K and 1.2B.
 */

/** d3's `~s` renders 6.6k and 1.2G; every other number in this product reads 6.6K and 1.2B.
 *  The axis formats through an expression so the two surfaces agree. */
/**
 * The app's own compact number, as a Vega expression: 6642 → "6.6K", 26766377 → "26.8M".
 * d3's `~s` renders "6.642k" and "26.766377M", which is neither what lib/format produces nor
 * what any other number on the page looks like — a print chart reading 6.642K beside a card
 * reading 6.6K is the kind of difference a reader notices and cannot explain. Under a thousand it
 * keeps four significant digits — 787.4, as the app writes it; it printed the raw value, and a bar of
 * Q3's monthly change read "€787.420043826" (2026-10-02) — and a small tick stays itself (0.002).
 */
export const COMPACT = (v: string) =>
  `(abs(${v}) >= 1e9 ? format(${v}/1e9,'.1f')+'B'` +
  ` : abs(${v}) >= 1e6 ? format(${v}/1e6,'.1f')+'M'` +
  ` : abs(${v}) >= 1e3 ? format(${v}/1e3,'.1f')+'K'` +
  ` : format(${v},'.4~r'))`;
export const SI = (inner: string) => `replace(replace(${inner}, 'k', 'K'), 'G', 'B')`;
// A caller-supplied format wins; the default SI goes through the app's compact form.
export const SI_LABEL = (f: string, prefix: string) =>
  `'${prefix}' + ` + (f === "~s" ? COMPACT("datum.value") : SI(`format(datum.value, '${f}')`));
export const SI_TEXT = (field: string, f: string, prefix: string) =>
  `'${prefix}' + ` + (f === "~s" ? COMPACT(`datum['${field}']`) : SI(`format(datum['${field}'], '${f}')`));

