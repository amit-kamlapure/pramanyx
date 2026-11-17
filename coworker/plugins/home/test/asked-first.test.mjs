// A schedule and a drafted definition wait for the person's own Allow in the conversation (2026-11-17).
import { test } from "node:test";
import assert from "node:assert/strict";

import { askFor } from "../lib/index.js";

test("a schedule and a drafted definition are asked about, in the person's own words", () => {
  const s = askFor("mcp__pramanyx__schedule", { request: "every Monday, top categories last week, to #sales" });
  assert.equal(s.kind, "ask");
  assert.equal(s.displayReason.en, "Set this up on a schedule: “every Monday, top categories last week, to #sales”?");
  const d = askFor("mcp__pramanyx__draft_definition", { term: "Active customer", text: "Paid in the last 30 days.", area: "finance" });
  assert.equal(d.displayReason.en, "Draft what “Active customer” means in finance: “Paid in the last 30 days.”? It is not used until its owner publishes it.");
  assert.ok(askFor("mcp__pramanyx__schedule", { request: "x".repeat(500) }).displayReason.en.length < 300);
});

test("reading, asking and bringing in a file are not asked about", () => {
  for (const name of ["mcp__pramanyx__ask", "mcp__pramanyx__get_definitions", "mcp__pramanyx__bring_in_file", "mcp__pramanyx__draft_email"]) {
    assert.equal(askFor(name, {}), undefined, name);
  }
});
