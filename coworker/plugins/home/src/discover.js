/**
 * Discover in the coworker (D6, 2026-11-24, `docs/DISCOVER_PLAN_2026-11-23.md` §4.6): the platform's own Discover page in
 * the main area, and "Ask about it" from one of its rows beginning a question here. These are the checks, kept apart so
 * they are tested: the page's address, and whether a message from the frame is a question to begin.
 */

const CONNECTION = /^[A-Za-z0-9_-]{1,64}$/;

/** The page's address: in this page's light or dark, told which shell may be asked to begin a question (this one). */
export function discoverAddress(appOrigin, theme, shell) {
  const q = new URLSearchParams({ theme: theme === "dark" ? "dark" : "light", shell });
  return `${appOrigin}/discover?${q}`;
}

/** A question the Discover page asks this shell to begin — its words and the connection it is about — or null for a
 *  message that is not one: from anywhere but the app, of another type, empty, or past a question's length. */
export function askedAbout(event, appOrigin) {
  if (!event || event.origin !== appOrigin) return null;
  const data = event.data;
  if (!data || typeof data !== "object" || data.type !== "pramanyx:ask-about") return null;
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text || text.length > 400) return null;
  const connection = typeof data.connection === "string" && CONNECTION.test(data.connection) ? data.connection : "";
  return { text: `${text} `, connection };
}
