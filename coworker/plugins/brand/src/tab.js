/**
 * What a coworker tab says: what is open, and nothing else (see `nameTheTab` in `client.js`). Pure, so it is tested
 * without a page: `node --test coworker/plugins/brand/test/`.
 */
const NAME = "Pramanyx";
const SHELL_NAME = "DeepSeek Harness";

/** The tab's words from what the shell wrote (`written`) and the page the sidebar marks as open (`page`). */
export function whatIsOpen(written, page) {
  const said = String(written || "").trim();
  for (const product of [SHELL_NAME, NAME]) {
    if (said.endsWith(` — ${product}`)) return said.slice(0, -(` — ${product}`).length).trim() || "Coworker";
  }
  if (!said || said === SHELL_NAME || said === NAME) return String(page || "").trim() || "Coworker";
  return said;
}
