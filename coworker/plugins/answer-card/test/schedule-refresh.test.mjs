// A schedule's card shows a run that lands while it is on the page, without the page being reloaded (2026-11-18).
import { test } from "node:test";
import assert from "node:assert/strict";

import { readAgainIn } from "../src/runs.js";

const AT = Date.parse("2026-11-17T19:37:00Z");

test("a run due soon is read a little after it is due; a run not yet recorded is asked again every 20 seconds", () => {
  assert.equal(readAgainIn({ state: "on", next_run: "2026-11-17T19:40:00Z", runs: [] }, AT), 195_000);
  assert.equal(readAgainIn({ state: "on", next_run: "2026-11-17T19:40:00Z", runs: [] }, Date.parse("2026-11-17T19:40:30Z")), 20_000);
  assert.equal(readAgainIn({ state: "muted", next_run: "2026-11-17T19:40:00Z", runs: [] }, AT), 195_000, "waiting for its first run");
});

test("an answer still being worked out is read again until it is there", () => {
  const working = { state: "ended", runs: [{ at: "2026-11-17T19:40:22Z", steps: [{ answering: true }] }] };
  assert.equal(readAgainIn(working, AT), 20_000, "a once-only schedule has ended while its one answer is worked out");
  assert.equal(readAgainIn({ ...working, state: "on" }, AT), 20_000);
});

test("nothing coming: ended, switched off, gone, or a run long past that never came", () => {
  assert.equal(readAgainIn({ state: "ended", runs: [{ at: "2026-11-17T19:40:22Z" }] }, AT), null);
  assert.equal(readAgainIn({ state: "off", next_run: "2026-11-17T19:40:00Z" }, AT), null);
  assert.equal(readAgainIn(null, AT), null);
  assert.equal(readAgainIn(undefined, AT), null);
  assert.equal(readAgainIn({ state: "on", next_run: "2026-11-17T19:00:00Z", runs: [] }, AT), null);
  assert.equal(readAgainIn({ state: "on", next_run: "", runs: [] }, AT), null);
});

test("a run days away waits for it, within what a timer can hold", () => {
  assert.equal(readAgainIn({ state: "on", next_run: "2026-12-30T00:00:00Z", runs: [] }, AT), 2 ** 31 - 1);
});
