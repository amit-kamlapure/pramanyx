/**
 * The coworker sidebar stands at 264 (the user, 2026-11-25: "Make it 264px"), through the shell's own width action —
 * set at start and again each time the sidebar is opened, since the shell puts back 280 then.
 *
 *   node --test coworker/plugins/brand/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SIDEBAR_PX, narrowTheSidebar } from "../src/sidebar.js";

function shell() {
  const widths = [];
  return { widths, layout: { panels: { setSidebar: (px) => widths.push(px) } } };
}

function watching(innerWidth) {
  const seen = {};
  globalThis.window = { innerWidth };
  globalThis.MutationObserver = class {
    constructor(callback) { seen.callback = callback; }
    observe(root, options) { seen.root = root; seen.options = options; }
    disconnect() { seen.disconnected = true; }
  };
  return seen;
}

const opened = { target: { hasAttribute: () => false } };
const closed = { target: { hasAttribute: () => true } };

test("the sidebar is set to 264 at start, by the shell's own action", () => {
  const { widths, layout } = shell();
  narrowTheSidebar(layout, null);
  assert.deepEqual(widths, [SIDEBAR_PX]);
  assert.equal(SIDEBAR_PX, 264);
});

test("opened again, it is set to 264 again; closing it sets nothing", () => {
  const seen = watching(1440);
  const { widths, layout } = shell();
  const undo = narrowTheSidebar(layout, {});
  assert.deepEqual(seen.options.attributeFilter, ["data-sidebar-collapsed"]);
  seen.callback([closed]);
  assert.deepEqual(widths, [264], "closing it is left to the shell");
  seen.callback([opened]);
  assert.deepEqual(widths, [264, 264], "reopened: the shell's 280 is put back to 264");
  undo();
  assert.equal(seen.disconnected, true);
});

test("on a narrow page, where the shell folds the sidebar itself, opening it sets nothing", () => {
  const seen = watching(900);
  const { widths, layout } = shell();
  narrowTheSidebar(layout, {});
  seen.callback([opened]);
  assert.deepEqual(widths, [264]);
});

test("a shell with no width action is left as it is", () => {
  assert.doesNotThrow(() => narrowTheSidebar({}, {})());
  assert.doesNotThrow(() => narrowTheSidebar(undefined, {})());
});
