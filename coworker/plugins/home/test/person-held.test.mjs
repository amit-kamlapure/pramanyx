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

// Each person has their own coworker (2026-11-17): one started for a person acts for no one else; the install's first
// (started by start_all.sh, owned by nobody named) takes whoever the app hands it, as before.
import { notThisCoworkersPerson, ownerOfThisCoworker } from "../lib/index.js";

test("a coworker started for one person refuses anyone else's delegation", () => {
  const was = process.env.PRAMANYX_COWORKER_PERSON;
  try {
    process.env.PRAMANYX_COWORKER_PERSON = "ana";
    assert.equal(ownerOfThisCoworker(), "ana");
    assert.equal(notThisCoworkersPerson("ana"), "");
    assert.match(notThisCoworkersPerson("bo"), /another person's/);
    delete process.env.PRAMANYX_COWORKER_PERSON;
    assert.equal(notThisCoworkersPerson("bo"), "", "the install's first takes whoever the app hands it");
  } finally {
    if (was === undefined) delete process.env.PRAMANYX_COWORKER_PERSON; else process.env.PRAMANYX_COWORKER_PERSON = was;
  }
});

test("past conversations are searched for the coworker's own person, and for nobody once a second person has used it", async () => {
  const { recallRefusal, RECALL } = await import("../lib/index.js");
  assert.ok(RECALL.test("session_search") && RECALL.test("session_event_read") && !RECALL.test("mcp__pramanyx__ask"));
  // A person's own coworker holds only their conversations.
  assert.equal(recallRefusal(new Map([["s1", "user:ana"], ["s2", "user:bo"]]), "user:ana", "ana@example.com"), undefined);
  // The install's first: one person's while one person has used it.
  assert.equal(recallRefusal(new Map(), "", ""), undefined);
  assert.equal(recallRefusal(new Map([["s1", "user:ana"]]), "user:ana", ""), undefined);
  assert.equal(recallRefusal(new Map([["s1", "user:ana"]]), "", ""), undefined);
  // A second person: it searches for nobody, and names nobody.
  const refused = recallRefusal(new Map([["s1", "user:ana"]]), "user:bo", "");
  assert.match(refused, /holds other people's conversations too/);
  assert.doesNotMatch(refused, /ana|bo\b/);
  assert.match(recallRefusal(new Map([["s1", "user:ana"], ["s2", "user:bo"]]), "user:ana", ""), /other people's/);
});

test("the guard puts the recall tools behind the same person", () => {
  const was = process.env.PRAMANYX_COWORKER_PERSON;
  delete process.env.PRAMANYX_COWORKER_PERSON;          // the install's first coworker
  try {
    const keep = join(mkdtempSync(join(tmpdir(), "held-")), "people.json");
    const who = { now: "user:ana" };
    const { event, call } = aShell(keep, who);
    event("s1", "user/message", { source: { kind: "user" } });
    assert.equal(call("s9", "session_search"), undefined);
    who.now = "user:bo";
    assert.match(call("s9", "session_search"), /other people's/);
  } finally {
    if (was !== undefined) process.env.PRAMANYX_COWORKER_PERSON = was;
  }
});
