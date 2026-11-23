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
