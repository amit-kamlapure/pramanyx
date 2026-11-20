// No conversation stays stuck (the user, 2026-11-20). Seen that day: an empty conversation holding only a "/compact"
// line was listed by the shell as blank and drawn as begun, and every load reopened it instead of the first screen.
import { test } from "node:test";
import assert from "node:assert/strict";

import { isStuck, SETTLING, unstick, workspaceOf } from "../src/stuck.js";

test("a conversation the shell lists as blank but draws as begun is stuck; a first screen or a real chat is not", () => {
  assert.equal(isStuck({ blank: true }, "active"), true);
  assert.equal(isStuck({ blank: true }, "hero"), false);
  assert.equal(isStuck({ blank: false }, "active"), false);
  assert.equal(isStuck(undefined, "active"), false);
});

test("the workspace a conversation is filed in is found by its id", () => {
  const items = [{ workspaceId: "w1", sessionIds: ["a"] }, { workspaceId: "w2", sessionIds: ["b", "stuck"] }];
  assert.equal(workspaceOf(items, "stuck"), "w2");
  assert.equal(workspaceOf(items, "none"), undefined);
  assert.equal(workspaceOf(null, "a"), undefined);
});

test("a stuck conversation is retired once, after its page has settled", async () => {
  const decided = new Set();
  const phases = [SETTLING, SETTLING, "active"];
  const retired = [];
  const out = await unstick("s1", { decided, wait: async () => {}, retire: async (id) => { retired.push(id); },
                                    read: () => ({ summary: { blank: true }, phase: phases.shift() ?? "active" }) });
  assert.equal(out, "retired");
  assert.deepEqual(retired, ["s1"]);
  // opened again on the same page: never read twice, never retired twice
  assert.equal(await unstick("s1", { decided, wait: async () => {}, retire: async () => { retired.push("again"); },
                                     read: () => ({ summary: { blank: true }, phase: "active" }) }), "decided");
  assert.deepEqual(retired, ["s1"]);
});

test("a first screen, or a conversation with messages, is left as it is and not read again", async () => {
  const decided = new Set();
  const never = async () => { throw new Error("retired a good conversation"); };
  assert.equal(await unstick("hero", { decided, wait: async () => {}, retire: never, read: () => ({ summary: { blank: true }, phase: "hero" }) }), "fine");
  assert.equal(await unstick("chat", { decided, wait: async () => {}, retire: never, read: () => ({ summary: { blank: false }, phase: "active" }) }), "fine");
  // once read as fine, a person writing in it later never makes it read as stuck
  assert.equal(await unstick("hero", { decided, wait: async () => {}, retire: never, read: () => ({ summary: { blank: true }, phase: "active" }) }), "decided");
});

test("a page that never settles is left unread, and nothing is retired", async () => {
  const decided = new Set();
  const out = await unstick("slow", { decided, tries: 3, wait: async () => {}, retire: async () => { throw new Error("no"); },
                                      read: () => ({ summary: { blank: true }, phase: SETTLING }) });
  assert.equal(out, "unread");
  assert.equal(decided.has("slow"), false);
});
