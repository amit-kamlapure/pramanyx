/**
 * The questions worth asking drop out of the box while a person is in it and it is empty (2026-11-20).
 *
 *   node --test coworker/plugins/home/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { nextOpen } from "../src/opens.js";

test("going into an empty box opens the questions; into one already written in does not", () => {
  assert.equal(nextOpen(false, { kind: "enter", empty: true }), true);
  assert.equal(nextOpen(false, { kind: "enter", empty: false }), false);
});

test("typing closes them, and emptying the box again brings them back", () => {
  assert.equal(nextOpen(true, { kind: "input", empty: false }), false);
  assert.equal(nextOpen(false, { kind: "input", empty: true }), true);
});

test("leaving for the list keeps them; leaving for anywhere else closes them, and nothing reopens them by leaving", () => {
  assert.equal(nextOpen(true, { kind: "leave", staysNear: true }), true);
  assert.equal(nextOpen(true, { kind: "leave", staysNear: false }), false);
  assert.equal(nextOpen(false, { kind: "leave", staysNear: true }), false);
});

test("Escape and a pick close them", () => {
  assert.equal(nextOpen(true, { kind: "escape" }), false);
  assert.equal(nextOpen(true, { kind: "pick", empty: true }), false);
});
