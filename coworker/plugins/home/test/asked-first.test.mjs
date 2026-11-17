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

// 2026-11-17 — the first live run: the person rejected a draft, and the coworker asked again on another connection.
import { askBeforeActing, NO_STANDS } from "../lib/index.js";

function aShell() {
  const on = new Map();
  askBeforeActing({ on: (name, fn) => on.set(name, fn) });
  const event = (type, data) => on.get("session/event")({ id: "s1" }, { type, data });
  const decide = (name, args) => on.get("tools/pre-execute")({ name, arguments: args, agent: { session: { id: "s1" } } },
                                                             async () => ({ kind: "allow" }));
  return { event, decide };
}

test("what the person declined is not asked again, on any connection, until they next write", async () => {
  const { event, decide } = aShell();
  const draft = { connection: "sheets", term: "big city", text: "A city with more than 500 orders." };
  assert.equal((await decide("mcp__pramanyx__draft_definition", draft)).kind, "ask");
  event("tool/call", { callId: "c1", name: "mcp__pramanyx__draft_definition", arguments: JSON.stringify(draft) });
  event("tool/result", { message: { toolCallId: "c1", isError: true,
                                    content: [{ type: "text", text: 'the user rejected tool "mcp__pramanyx__draft_definition"' }] } });
  const again = await decide("mcp__pramanyx__draft_definition", { ...draft, connection: "conn-held", term: "Big City " });
  assert.deepEqual(again, { kind: "deny", reason: NO_STANDS });
  // Another word is its own question; so is a schedule.
  assert.equal((await decide("mcp__pramanyx__draft_definition", { ...draft, term: "small city" })).kind, "ask");
  assert.equal((await decide("mcp__pramanyx__schedule", { request: "every Monday" })).kind, "ask");
  // A helper's report is not the person writing; their own next message is.
  event("user/message", { source: { kind: "subagent-report" } });
  assert.equal((await decide("mcp__pramanyx__draft_definition", draft)).kind, "deny");
  event("user/message", { source: { kind: "user" } });
  assert.equal((await decide("mcp__pramanyx__draft_definition", draft)).kind, "ask");
});

test("an allowed draft, or one that failed for another reason, is asked about again as usual", async () => {
  const { event, decide } = aShell();
  const draft = { term: "big city", text: "x" };
  event("tool/call", { callId: "c1", name: "mcp__pramanyx__draft_definition", arguments: draft });
  event("tool/result", { message: { toolCallId: "c1", isError: true, content: [{ type: "text", text: "the platform is not answering" }] } });
  assert.equal((await decide("mcp__pramanyx__draft_definition", draft)).kind, "ask");
});
