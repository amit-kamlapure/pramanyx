/**
 * A Definition's body: Markdown, written under a toolbar and drawn when read (the Page editor, 2026-11-23 — the reference
 * Page the user showed). What each tool does to the text and the selection, kept pure so its tests read like the toolbar.
 */

/** A new Definition opens on the two sections a Page has. */
export const BODY_TEMPLATE = "## Definition\n\n\n\n## Business use\n\n";

/** The most a body holds — the server's own bound, because the planner reads it into answers. */
export const BODY_MAX = 4000;

export type Tool = "heading" | "subheading" | "text" | "bold" | "italic" | "bullets" | "numbers" | "link" | "table";

export interface Edit { text: string; start: number; end: number }

/** The whole lines a selection touches. */
function lineSpan(text: string, start: number, end: number): [number, number] {
  const from = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nl = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
  return [start === 0 ? 0 : from, nl === -1 ? text.length : nl];
}

const HEADING = /^#{1,6}\s+/;
const BULLET = /^[-*]\s+/;
const NUMBER = /^\d+\.\s+/;

function eachLine(e: Edit, change: (line: string, i: number) => string): Edit {
  const [from, to] = lineSpan(e.text, e.start, e.end);
  const lines = e.text.slice(from, to).split("\n").map(change);
  const block = lines.join("\n");
  return { text: e.text.slice(0, from) + block + e.text.slice(to), start: from, end: from + block.length };
}

function wrap(e: Edit, mark: string, empty: string): Edit {
  const chosen = e.text.slice(e.start, e.end) || empty;
  const text = e.text.slice(0, e.start) + mark + chosen + mark + e.text.slice(e.end);
  return { text, start: e.start + mark.length, end: e.start + mark.length + chosen.length };
}

/** The text and the selection after a tool is applied to it. */
export function apply(tool: Tool, e: Edit): Edit {
  switch (tool) {
    case "heading": return eachLine(e, l => `## ${l.replace(HEADING, "")}`);
    case "subheading": return eachLine(e, l => `### ${l.replace(HEADING, "")}`);
    case "text": return eachLine(e, l => l.replace(HEADING, ""));
    case "bold": return wrap(e, "**", "bold");
    case "italic": return wrap(e, "*", "italic");
    case "bullets": return eachLine(e, l => (BULLET.test(l) ? l.replace(BULLET, "") : `- ${l.replace(NUMBER, "")}`));
    case "numbers": return eachLine(e, (l, i) => (NUMBER.test(l) ? l.replace(NUMBER, "") : `${i + 1}. ${l.replace(BULLET, "")}`));
    case "link": {
      const label = e.text.slice(e.start, e.end) || "its name";
      const inserted = `[${label}](https://)`;
      const at = e.start + label.length + 3;
      return { text: e.text.slice(0, e.start) + inserted + e.text.slice(e.end), start: at, end: at + "https://".length };
    }
    case "table": {
      const before = e.start > 0 && e.text[e.start - 1] !== "\n" ? "\n\n" : "";
      const table = `${before}| Column | Column |\n| --- | --- |\n|  |  |\n`;
      const text = e.text.slice(0, e.start) + table + e.text.slice(e.end);
      const cell = e.start + before.length + 2;
      return { text, start: cell, end: cell + "Column".length };
    }
  }
}

/** A link a body may carry: the web (opens in a new tab) or a page of the app (`/?tab=…`); nothing else runs from it. */
export function bodyHref(href: string | undefined): { href: string; inApp: boolean } | null {
  if (!href) return null;
  if (href.startsWith("/?tab=")) return { href, inApp: true };
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:" ? { href: u.toString(), inApp: false } : null;
  } catch {
    return null;
  }
}
