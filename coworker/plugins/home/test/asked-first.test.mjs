// A schedule and a drafted definition wait for the person's own Allow in the conversation (2026-11-17).
import { test } from "node:test";
import assert from "node:assert/strict";

import { askFor, mayGoAhead, memoriesRead } from "../lib/index.js";

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

test("whatever changes something, stops work or runs unattended waits for the person", () => {
  const none = new Set();
  for (const [name, says] of [["forget_for_me", "Forget this"], ["cancel_job", "Stop the work"], ["explore", "full exploration"], ["post_claim", "ledger"],
    ["edit_automation", "Change an automation"], ["pause_or_resume_automation", "Pause or resume"], ["set_agent_limit", "limit"], ["propose_agent_grant", "more access"]]) {
    const asked = askFor(`mcp__pramanyx__${name}`, { connection: "thelook", text: "x" }, none);
    assert.equal(asked?.kind, "ask", name);
    assert.ok(asked.displayReason.en.includes(says), asked.displayReason.en);
  }
});

test("a tool nobody has classified is asked about, never let through", () => {
  const asked = askFor("mcp__pramanyx__wipe_the_ledger", { table: "claims" }, new Set());
  assert.equal(asked.displayReason.en, "Allow this: wipe the ledger (table: claims)?");
});

test("an automation is run only on the person's word, even one named like an agent or a read", () => {
  const offered = new Set(["ask_finance_for_approval", "explain"]);
  assert.match(askFor("mcp__pramanyx__ask_finance_for_approval", {}, offered).displayReason.en, /Run the automation “ask finance for approval” now\?.*anything it sends/);
  assert.equal(askFor("mcp__pramanyx__explain", {}, offered).kind, "ask");
});

test("a custom agent is asked without a prompt once the automations are known, and with one until they are", () => {
  assert.equal(mayGoAhead("mcp__pramanyx__ask_margin_analyst", new Set()), true);
  assert.equal(mayGoAhead("mcp__pramanyx__ask_margin_analyst", null), false);
});

test("the shell's own tools are not asked about here", () => {
  assert.equal(askFor("subagent", { prompt: "x" }, new Set()), undefined);
});

// 2026-11-17 — the first live run: the person rejected a draft, and the coworker asked again on another connection.
import { askBeforeActing, NO_STANDS } from "../lib/index.js";

function aShell() {
  const on = new Map();
  askBeforeActing({ on: (name, fn) => on.set(name, fn) }, async () => new Set());
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

test("forgetting a memory is asked about in the memory's own words, once the conversation has read them", async () => {
  assert.deepEqual(memoriesRead(JSON.stringify({ memories: [{ id: "m1", text: "Bars largest first.", at: "x" }, { id: "m2" }] })), [["m1", "Bars largest first."]]);
  assert.deepEqual(memoriesRead("not json"), []);

  const heard = {};
  askBeforeActing({ on: (name, fn) => { heard[name] = fn; } }, async () => new Set());
  const session = { id: "s1" };
  const forget = { name: "mcp__pramanyx__forget_for_me", arguments: { memory_id: "m1" }, agent: { session } };
  const allow = async () => ({ kind: "allow" });

  assert.equal((await heard["tools/pre-execute"](forget, allow)).displayReason.en, "Forget this from what I remember for you (memory id: m1)?");

  heard["session/event"](session, { type: "tool/call", data: { callId: "c1", name: "mcp__pramanyx__my_memories", arguments: {} } });
  heard["session/event"](session, { type: "tool/result", data: { message: { toolCallId: "c1", content: [{ text: JSON.stringify({ memories: [{ id: "m1", text: "Bars largest first." }] }) }] } } });

  assert.equal((await heard["tools/pre-execute"](forget, allow)).displayReason.en, "Forget this from what I remember for you: “Bars largest first.”?");
});
