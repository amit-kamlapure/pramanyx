/**
 * One rule for what an answer leads with, and what in it is bold, wherever the answer is drawn: the coworker's card,
 * a Data Canvas and the Ask panel (the user, 2026-11-23: "Is there a logic of what text should be bold & highlight?",
 * of a coworker card whose bold headline ran on into "— caution: this total multiplies a measure by an id/key column").
 *
 * - The title is the answer in one sentence: an answer's first line, or its first sentence when that line is long.
 *   A caution is never part of it. The quick pipeline writes its cautions onto the headline on purpose — the words
 *   travel to every reader that way (the E1 contract) — so they are split off here, at
 *   display time, and said in the amber line under the title.
 * - A line that only leads into what follows ("The top categories are:") or a list, table or code block is no answer
 *   sentence: the text has no title and is read as written.
 * - Bold marks a figure or a name, never a sentence: a `**…**` span of more than {@link BOLD_WORDS_MAX} words is read
 *   as plain text.
 *
 * Plain TypeScript with no imports: the coworker bundles it from here, as it does `statedFigures`.
 */

export type Titled = {
  /** The answer in one sentence, without its bold marks or a heading's `#`; "" when the text has none. */
  title: string;
  /** What the platform cautioned about the answer, each a sentence, in the order it was written. */
  cautions: string[];
  /** The rest of the text, as written. */
  rest: string;
};

/** The most words a bold span holds: a figure and its unit, a name, a short phrase — not a sentence. */
export const BOLD_WORDS_MAX = 8;

/** A title is a line; past this it is cut at its first full stop. */
const TITLE_CHARS = 220;

/** " — caution: …" or " — note: …", as the quick pipeline's guards append them; a dash of any width, so a model's copy
 *  of one splits too. */
const CAUTION = /\s+[—–-]{1,2}\s+(?:caution|note):\s+/i;

/** A first line that is not a sentence: a list item, a table row, a quote, a code fence. */
const NOT_A_SENTENCE = /^(?:[-*•+]\s|\d+[.)]\s|\||>|```)/;

/** Whether a bold span reads as a figure or a name, and so stays bold. */
export function boldable(span: string): boolean {
  const words = String(span || "").trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= BOLD_WORDS_MAX;
}

/** A caution as a sentence: its first letter capitalised and a full stop at its end. */
function asSentence(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "";
  const up = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(up) ? up : `${up}.`;
}

/** A title's text without the marks a heading has no use for: `#`, and bold around the whole or part of it. */
function bare(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "").trim();
}

/** The cautions written onto the end of a text, split off it. */
export function splitCautions(text: string): { said: string; cautions: string[] } {
  const [said, ...cautions] = String(text || "").split(CAUTION);
  return { said: said.trim(), cautions: cautions.map(asSentence).filter(Boolean) };
}

/** What an answer leads with, what was cautioned about it, and the rest of it. */
export function titleOf(text: string): Titled {
  const all = String(text || "").trim();
  if (!all) return { title: "", cautions: [], rest: "" };
  const lineAt = all.indexOf("\n");
  const line = lineAt >= 0 ? all.slice(0, lineAt).trim() : all;
  const after = lineAt >= 0 ? all.slice(lineAt + 1).trim() : "";
  if (NOT_A_SENTENCE.test(line)) return { title: "", cautions: [], rest: all };
  // the cautions end the line they were written onto, however long it is
  const { said: first, cautions } = splitCautions(line);
  let head = first, rest = after;
  if (first.length > TITLE_CHARS) {
    // its first sentence (one ending past a short opening like "No."), or up to its last space when none ends in time
    const window = first.slice(0, TITLE_CHARS);
    const stop = Array.from(window.matchAll(/[.!?](?=\s|$)/g), (m) => m.index ?? -1).find((at) => at > 40);
    const at = stop !== undefined ? stop + 1 : window.lastIndexOf(" ");
    const cut = at > 0 ? at : TITLE_CHARS;
    head = first.slice(0, cut);
    rest = [first.slice(cut).trim(), after].filter(Boolean).join("\n");
  }
  const title = bare(head);
  // a line that leads into what follows ("The top categories are:") is not the answer
  if (!title || /:$/.test(title)) return { title: "", cautions, rest: [head, rest].filter(Boolean).join("\n") };
  return { title, cautions, rest };
}
