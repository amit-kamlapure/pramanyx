/**
 * A coworker tab names what is open, and nothing else (the user, 2026-11-23: "'Whats Open' only").
 *
 *   node --test coworker/plugins/brand/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { whatIsOpen } from "../src/tab.js";

test("a conversation's tab is its title, without the product's name", () => {
  assert.equal(whatIsOpen("Count Orders by Status — DeepSeek Harness", ""), "Count Orders by Status");
  assert.equal(whatIsOpen("Count Orders by Status — Pramanyx", ""), "Count Orders by Status");
});

test("with no conversation open, the tab is the page the sidebar marks, or the coworker itself", () => {
  assert.equal(whatIsOpen("DeepSeek Harness", "Agents"), "Agents");
  assert.equal(whatIsOpen("DeepSeek Harness", ""), "Coworker");
  assert.equal(whatIsOpen("", ""), "Coworker");
});

test("a title the shell wrote some other way is kept as it was written", () => {
  assert.equal(whatIsOpen("Settings", ""), "Settings");
});
