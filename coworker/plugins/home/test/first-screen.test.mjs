/**
 * Every load opens on the first screen, and an empty conversation draws no row (2026-11-18).
 *
 *   node --test coworker/plugins/home/test/
 *
 * Held: the head's script forgets the conversation the shell kept as last open, and nothing else; it survives a
 * browser that refuses storage; the style hides only a row without its "…" menu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { NO_EMPTY_ROW, OPENED_KEY, OPEN_ON_FIRST_SCREEN, firstScreenRows } from "../lib/index.js";

function storage(entries) {
  const kept = new Map(Object.entries(entries));
  return { kept, removeItem: (key) => { kept.delete(key); } };
}

test("the conversation last open is forgotten, and nothing else the browser keeps", () => {
  const localStorage = storage({ [OPENED_KEY]: JSON.stringify({ sessionId: "s1" }), "pramanyx.coworker.back": "http://localhost:3000/" });
  new Function("localStorage", OPEN_ON_FIRST_SCREEN)(localStorage);
  assert.equal(localStorage.kept.has(OPENED_KEY), false);
  assert.equal(localStorage.kept.get("pramanyx.coworker.back"), "http://localhost:3000/");
});

test("a browser that refuses storage still opens the page", () => {
  const refusing = { removeItem: () => { throw new Error("SecurityError"); } };
  assert.doesNotThrow(() => new Function("localStorage", OPEN_ON_FIRST_SCREEN)(refusing));
});

test("the head takes a script before the shell's and a style; neither closes its element early", () => {
  const rows = firstScreenRows();
  assert.deepEqual(rows.map((r) => [r.kind, r.placement]), [["script", "head"], ["style", undefined]]);
  assert.ok(!OPEN_ON_FIRST_SCREEN.includes("</script") && !NO_EMPTY_ROW.includes("</style"));
});

test("only a conversation row without its menu is hidden", () => {
  assert.match(NO_EMPTY_ROW, /\[data-row-key\^="session:"\]/);
  assert.match(NO_EMPTY_ROW, /:not\(:has\(\[data-context-menu-trigger\]\)\)/);
  assert.match(NO_EMPTY_ROW, /display: none/);
});
