/**
 * A Definition's body: Markdown, written as it reads (`components/definitions/RichBody.tsx`, the user's choice of editor,
 * 2026-11-23) and drawn when read (`DefinitionBody`). What a body is, its bound, and what it may link to.
 */

/** A new Definition opens on the two sections a Page has. */
export const BODY_TEMPLATE = "## Definition\n\n\n\n## Business use\n\n";

/** The most a body holds — the server's own bound, because the planner reads it into answers. */
export const BODY_MAX = 4000;

/** Whether a body says nothing yet: empty, or only the two sections a new one opens on (however its editor spaces them). */
export function isBlankBody(text: string): boolean {
  const bare = (t: string) => t.replace(/\s+/g, " ").trim();
  return !bare(text) || bare(text) === bare(BODY_TEMPLATE);
}

/** Formatted words as one plain line, for where a page shows one line of them: their words, without the marks
 *  (headings, bold, code, links, lists, tables) — the server's `discover.items.plain_words`, here. */
export function plainWords(markdown: string): string {
  return (markdown || "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")                 // a link: its words
    .replace(/^\s{0,3}#{1,6}\s+[^\n]*\n?/gm, "")               // a heading names a section; it is not the words
    .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, "")                    // a list's marks
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")                      // a table's rule
    .replace(/[*_`>|]+/g, "")
    .split(/\s+/).filter(Boolean).join(" ");
}

/** An image a body may show (2026-11-24, the Page editor's images): one uploaded to its connection's image store, kept
 *  as the API's path for it — never an address elsewhere, which would tell another host who reads the page. */
export const IMAGE_PATH = /^\/dashboards\/images\/[A-Za-z0-9_.-]+\?connection_id=[A-Za-z0-9_.-]+$/;

/** The path a body keeps for an image uploaded to its connection's store. */
export function bodyImagePath(connectionId: string, objectId: string): string {
  return `/dashboards/images/${encodeURIComponent(objectId)}?connection_id=${encodeURIComponent(connectionId)}`;
}

/** The path an image's address names, if it is one a body may keep: the path itself, or the same path on the API's
 *  address (a picture copied from the page). Null for anything else. */
export function keptImagePath(src: string | null | undefined, apiBase = ""): string | null {
  let s = String(src ?? "").trim();
  if (apiBase && s.startsWith(apiBase)) s = s.slice(apiBase.length);
  return IMAGE_PATH.test(s) ? s : null;
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
