// A conversation is its person's (Phase 3, 2026-11-17): the coworker never asks Pramanyx in one person's name inside a
// conversation another person began.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { heldToItsPerson, personRefusal } from "../lib/index.js";

function aShell(keep, who) {
  const on = new Map();
  let guard;
  const ctx = {
    on: (name, fn) => on.set(name, fn),
    inject: (_needs, fn) => fn({ effect: (make) => make(), tools: { guard: (g) => { guard = g; } } }),
  };
  heldToItsPerson(ctx, { keep, now: () => who.now });
  const event = (id, type, data = {}, header = {}) => on.get("session/event")({ id, header }, { type, data });
  const call = (id, name = "mcp__pramanyx__ask") => guard({ name, agent: { session: { id } } });
  return { event, call };
}

test("a conversation is held to the person it began with, and refused to anyone else", () => {
  const keep = join(mkdtempSync(join(tmpdir(), "held-")), "people.json");
  const who = { now: "user:ana" };
  const { event, call } = aShell(keep, who);
  event("s1", "user/message", { source: { kind: "user" } });
  assert.equal(call("s1"), undefined);
  who.now = "user:bo";
  const refused = call("s1");
  assert.match(refused, /This conversation is user:ana's, and the coworker now acts for user:bo/);
  assert.equal(call("s1", "mcp__other__tool"), undefined, "only Pramanyx's tools act in a person's name");
  // Bo's own conversation is Bo's.
  event("s2", "user/message", { source: { kind: "user" } });
  assert.equal(call("s2"), undefined);
  // A helper the conversation started is the conversation's.
  event("h1", "turn/start", {}, { parentSession: "s1" });
  assert.match(call("h1"), /user:ana's/);
  // Kept across a restart.
  assert.deepEqual(JSON.parse(readFileSync(keep, "utf8")), { s1: "user:ana", s2: "user:bo", h1: "user:ana" });
  const again = aShell(keep, { now: "user:bo" });
  assert.match(again.call("s1"), /user:ana's/);
});

test("with nobody delegated, a conversation is held to nobody, as before", () => {
  const keep = join(mkdtempSync(join(tmpdir(), "held-")), "people.json");
  const who = { now: "" };
  const { event, call } = aShell(keep, who);
  event("s1", "user/message", { source: { kind: "user" } });
  who.now = "user:ana";
  assert.equal(call("s1"), undefined);
  assert.equal(personRefusal("", "user:ana"), undefined);
  assert.equal(personRefusal("user:ana", ""), undefined);
  assert.equal(personRefusal("user:ana", "user:ana"), undefined);
});
