// The screen the coworker's page shows before any plugin has loaded (2026-11-18): Pramanyx's mark and quieter words.
import { test } from "node:test";
import assert from "node:assert/strict";

import { STYLE, SCRIPT, WORDS, apply, bootRows } from "../lib/index.js";

test("the page's head takes a style and a script, each safe to set inside its own element", () => {
  const rows = bootRows();
  assert.deepEqual(rows.map((r) => r.kind), ["style", "script"]);
  assert.ok(!STYLE.includes("</style"), "a style that closes its element early");
  assert.ok(!SCRIPT.includes("</script"), "a script that closes its element early");
  assert.ok(STYLE.includes("data:image/png;base64,") && STYLE.includes("[data-dsh-boot]"));
});

test("it says what is happening in the app's words, never the shell's", () => {
  for (const said of [WORDS.opening, WORDS.slow, WORDS.stuck, WORDS.failed, WORDS.reload, WORDS.details]) assert.ok(SCRIPT.includes(said));
  assert.ok(!/HARNESS|Loading plugins|Failed to load plugins/.test(SCRIPT + STYLE));
  assert.doesNotThrow(() => new Function(SCRIPT));                              // it parses as a classic script
});

test("the host half adds its rows when the page is rendered", () => {
  let handler = null;
  apply({ on: (name, fn) => { if (name === "webserver/index-inject") handler = fn; } });
  const table = [];
  handler(table);
  assert.equal(table.length, 2);
});
