// When a schedule runs is the person's words (2026-11-18): live, "Schedule this to run once, 4 minutes from now, and
// never again: ask how many titles are in the netflix_titles sheet" reached the schedule tool as "ask how many titles are
// in the netflix_titles sheet", and the person was asked to allow a schedule with no time in it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { askBeforeActing, timingLost, timingRefusal } from "../lib/index.js";

const SAID = "Schedule this to run once, 4 minutes from now, and never again: ask how many titles are in the netflix_titles sheet.";

test("the phrases saying when are found, and each one a request left out is named", () => {
  assert.deepEqual(timingLost(SAID, "ask how many titles are in the netflix_titles sheet"), ["once", "4 minutes from now", "never again"]);
  assert.deepEqual(timingLost(SAID, SAID), []);
  assert.deepEqual(timingLost("Every Monday at 9, GMV by platform to #general", "every monday at 9, GMV by platform to #general"), []);
  assert.deepEqual(timingLost("in five minutes, a summary of yesterday's orders", "a summary of yesterday's orders"), ["in five minutes"]);
  assert.deepEqual(timingLost("every weekday at 8, post revenue", "every 2 weeks, post revenue"), ["every weekday", "at 8"]);
  assert.deepEqual(timingLost("how many orders by status?", "how many orders by status"), [], "nothing said about when: nothing to keep");
  const refused = timingRefusal(SAID, "ask how many titles are in the netflix_titles sheet");
  assert.match(refused, /leaves out when it runs \(“once”, “4 minutes from now”, “never again”\)/);
  assert.ok(refused.includes(SAID), "the sentence to copy is given back");
});

function aShell() {
  const on = new Map();
  const hooks = [];
  const ctx = { on: (name, fn) => (name === "tools/pre-execute" ? hooks.push(fn) : on.set(name, fn)) };
  askBeforeActing(ctx);
  const event = (id, type, data = {}) => on.get("session/event")({ id }, { type, data });
  const call = (session, name, args) => hooks[0]({ name, arguments: args, agent: { session } }, async () => ({ kind: "allow" }));
  return { event, call };
}

test("a schedule call that dropped the person's timing goes back to the agent before the person is asked", async () => {
  const { event, call } = aShell();
  event("s1", "user/message", { source: { kind: "user" }, content: [{ type: "text", text: SAID }] });
  const short = await call({ id: "s1" }, "mcp__pramanyx__schedule", { request: "ask how many titles are in the netflix_titles sheet", connection: "sheets" });
  assert.equal(short.kind, "deny");
  assert.match(short.reason, /Call schedule again with that sentence/);
  const copied = await call({ id: "s1" }, "mcp__pramanyx__schedule", JSON.stringify({ request: SAID, connection: "sheets" }));
  assert.notEqual(copied.kind, "deny", "copied exactly: on to the person's Allow");
  // A helper's call is held to what was said in the conversation that started it.
  const helper = await call({ id: "h1", header: { parentSession: "s1" } }, "mcp__pramanyx__schedule", { request: "ask how many titles", connection: "sheets" });
  assert.equal(helper.kind, "deny");
  // Other tools are not read for timing.
  const asked = await call({ id: "s1" }, "mcp__pramanyx__ask", { question: "how many titles" });
  assert.equal(asked.kind, "allow");
});
