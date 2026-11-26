// A skill is read before its tools (2026-11-26): the coworker's how-tos are skills, and a call to a tool a skill governs
// goes back to the agent, naming the skill, until that skill has been loaded in the conversation (or in the one that
// started it). From deepagents' `include_tools`. And a memory that replaces another says which, in its words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { abilitiesOf, askBeforeActing, readsFirstOf, skillFirstRefusal, skillGatesOf, skillsDir } from "../lib/index.js";

const ROWS = abilitiesOf(JSON.parse(readFileSync(new URL("./abilities.fixture.json", import.meta.url), "utf8")));

test("a skill names the tools it governs in its frontmatter, and nothing else is read as that", () => {
  const head = (body) => `---\nname: x\ndescription: y\n${body}---\n\n# X\nreads-first: not-this\n`;
  assert.deepEqual(readsFirstOf(head("metadata:\n  reads-first: mcp__pramanyx__schedule\n")), ["mcp__pramanyx__schedule"]);
  assert.deepEqual(readsFirstOf(head("metadata:\n  other: 1\n  reads-first: \"subagent subagent_fork\"\n")), ["subagent", "subagent_fork"]);
  assert.deepEqual(readsFirstOf(head("reads-first: top-level-is-not-metadata\n")), []);
  assert.deepEqual(readsFirstOf(head("metadata:\n  other: 1\nwhenToUse: z\n  reads-first: after-metadata-ended\n")), []);
  assert.deepEqual(readsFirstOf("no frontmatter\nmetadata:\n  reads-first: x\n"), []);
  assert.deepEqual(readsFirstOf(head("metadata:\r\n  reads-first: crlf\r\n").replace(/\n/g, "\r\n")), ["crlf"]);
});

test("the checkout's own skills gate the tools whose how-to moved into them", () => {
  const gates = skillGatesOf(skillsDir());
  assert.deepEqual(Object.fromEntries([...gates].sort()), {
    mcp__pramanyx__draft_email: "emailing",
    mcp__pramanyx__remember_for_me: "remembering",
    mcp__pramanyx__schedule: "scheduling",
    subagent: "helpers",
    subagent_fork: "helpers",
  });
  assert.equal(skillGatesOf(join(tmpdir(), "no-such-skills-folder")).size, 0);
  const dir = mkdtempSync(join(tmpdir(), "skills-"));
  mkdirSync(join(dir, "plain"));
  writeFileSync(join(dir, "plain", "SKILL.md"), "---\nname: plain\ndescription: d\n---\nbody\n");
  mkdirSync(join(dir, "empty"));                                       // a folder without a SKILL.md is skipped
  assert.equal(skillGatesOf(dir).size, 0);
});

test("the refusal names the skill to read, and asks nothing of the person", () => {
  const gates = new Map([["mcp__pramanyx__schedule", "scheduling"]]);
  const said = skillFirstRefusal("mcp__pramanyx__schedule", new Set(), gates);
  assert.match(said, /first read the scheduling skill \(call skill with name "scheduling"\)/);
  assert.match(said, /Nothing was asked of the person/);
  assert.equal(skillFirstRefusal("mcp__pramanyx__schedule", new Set(["scheduling"]), gates), undefined);
  assert.equal(skillFirstRefusal("mcp__pramanyx__ask", new Set(), gates), undefined);
});

function aShell(gates = skillGatesOf(skillsDir())) {
  const on = new Map();
  const hooks = [];
  const ctx = { on: (name, fn) => (name === "tools/pre-execute" ? hooks.push(fn) : on.set(name, [...(on.get(name) ?? []), fn])) };
  askBeforeActing(ctx, async () => new Set(), async () => ROWS, gates);
  const event = (id, type, data = {}) => { for (const fn of on.get("session/event") ?? []) fn({ id }, { type, data }); };
  const call = (session, name, args) => hooks[0]({ name, arguments: args, agent: { session } }, async () => ({ kind: "allow" }));
  const load = (id, callId, name, isError = false) => {
    event(id, "tool/call", { callId, name: "skill", arguments: JSON.stringify({ name }) });
    event(id, "tool/result", { message: { toolCallId: callId, isError, content: [{ type: "text", text: "<skill_content>…" }] } });
  };
  return { event, call, load };
}

test("a governed call goes back until its skill is loaded in the conversation; then on to the person's Allow", async () => {
  const { event, call, load } = aShell();
  const said = "every Monday at 9, top categories last week";
  event("s1", "user/message", { source: { kind: "user" }, content: [{ type: "text", text: said }] });
  const early = await call({ id: "s1" }, "mcp__pramanyx__schedule", { request: said, connection: "thelook" });
  assert.equal(early.kind, "deny");
  assert.match(early.reason, /read the scheduling skill/);
  load("s1", "k1", "emailing");                                       // another skill is not this one
  assert.equal((await call({ id: "s1" }, "mcp__pramanyx__schedule", { request: said })).kind, "deny");
  load("s1", "k2", "scheduling", true);                                // a load that failed is not a read
  assert.equal((await call({ id: "s1" }, "mcp__pramanyx__schedule", { request: said })).kind, "deny");
  load("s1", "k3", "scheduling");
  const asked = await call({ id: "s1" }, "mcp__pramanyx__schedule", { request: said, connection: "thelook" });
  assert.equal(asked.kind, "ask", "read: on to the person's own Allow, as before");
  // The timing guard still stands behind the skill guard.
  assert.equal((await call({ id: "s1" }, "mcp__pramanyx__schedule", { request: "top categories last week" })).kind, "deny");
  // Read in one conversation is not read in another.
  assert.equal((await call({ id: "s2" }, "mcp__pramanyx__schedule", { request: said })).kind, "deny");
  // Ungoverned tools are untouched.
  assert.equal((await call({ id: "s2" }, "mcp__pramanyx__ask", { question: "x" })).kind, "allow");
});

test("a helper's call counts what the conversation that started it has read", async () => {
  const { call, load } = aShell();
  const helper = { id: "h1", header: { parentSession: "s1" } };
  assert.equal((await call(helper, "mcp__pramanyx__draft_email", { subject: "x" })).kind, "deny");
  load("s1", "k1", "emailing");
  assert.equal((await call(helper, "mcp__pramanyx__draft_email", { subject: "x" })).kind, "allow");
});

test("the shell's own subagent tools are gated by the helpers skill", async () => {
  const { call, load } = aShell();
  for (const name of ["subagent", "subagent_fork"]) assert.equal((await call({ id: "s1" }, name, { prompt: "x" })).kind, "deny", name);
  load("s1", "k1", "helpers");
  for (const name of ["subagent", "subagent_fork"]) assert.equal((await call({ id: "s1" }, name, { prompt: "x" })).kind, "allow", name);
});

test("with no skills folder, nothing is gated — the coworker works as it did", async () => {
  const { call } = aShell(new Map());
  assert.equal((await call({ id: "s1" }, "subagent", { prompt: "x" })).kind, "allow");
});

test("a memory that replaces another is asked about with the older one's words", async () => {
  const { event, call, load } = aShell();
  load("s1", "k1", "remembering");
  const ask = (args) => call({ id: "s1" }, "mcp__pramanyx__remember_for_me", args);
  assert.equal((await ask({ text: "I prefer figures in USD" })).displayReason.en,
               "Remember this for you, in your own questions only: “I prefer figures in USD”?");
  assert.equal((await ask({ text: "I prefer figures in USD", replaces: "m1" })).displayReason.en,
               "Remember this for you, in your own questions only: “I prefer figures in USD”? It replaces one of your " +
               "memories, which is kept as history and no longer used.");
  event("s1", "tool/call", { callId: "c1", name: "mcp__pramanyx__my_memories", arguments: {} });
  event("s1", "tool/result", { message: { toolCallId: "c1", content: [{ text: JSON.stringify({ memories: [{ id: "m1", text: "I prefer figures in EUR", read_in: true }] }) }] } });
  assert.equal((await ask({ text: "I prefer figures in USD", replaces: "m1" })).displayReason.en,
               "Remember this for you, in your own questions only: “I prefer figures in USD”? It replaces “I prefer " +
               "figures in EUR”, which is kept as history and no longer used.");
});
