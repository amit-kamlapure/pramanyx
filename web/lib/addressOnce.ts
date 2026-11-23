/**
 * A link's word for what to open on arrival — a table, a custom agent, a document, a trusted query (Discover's items
 * link to each, `pramanyx/discover/items.py`) — read once and taken off the address, so the next visit to the page
 * opens it as it opens, not on the same thing again (the pattern `?agent=` began in `AgenticOpsWorkspace`).
 */
export function takeFromAddress(...names: string[]): Record<string, string> {
  if (typeof window === "undefined") return {};
  const u = new URL(window.location.href);
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = u.searchParams.get(name);
    if (value) {
      out[name] = value;
      u.searchParams.delete(name);
    }
  }
  if (Object.keys(out).length) window.history.replaceState(window.history.state, "", u);
  return out;
}

/** Bring the element a link opened into view, once it is drawn. */
export function showWhenDrawn(selector: string, tries = 20): void {
  if (typeof window === "undefined") return;
  const look = (left: number) => {
    const el = document.querySelector(selector);
    if (el) { el.scrollIntoView({ block: "center" }); return; }
    if (left > 0) window.setTimeout(() => look(left - 1), 150);
  };
  look(tries);
}
