// A conversation is held to its connection: what the guard refuses, and what it lets through.
import assert from "node:assert/strict";
import { test } from "node:test";
import { holdOf, refusalFor } from "../lib/index.js";

const ask = "mcp__pramanyx__ask";

test("a call for the conversation's own connection runs", () => {
  assert.equal(refusalFor(ask, { question: "q", connection: "c1" }, "c1"), undefined);
  assert.equal(refusalFor("mcp__pramanyx__get_briefing", { connection_id: "c1" }, "c1"), undefined);
});

test("a call for another connection is refused, and the refusal names both", () => {
  const said = refusalFor(ask, { question: "q", connection: "other" }, "c1");
  assert.match(said, /held to the connection `c1`/);
  assert.match(said, /cannot read `other`/);
  assert.match(refusalFor("mcp__pramanyx__deep_analysis", { connection: "other" }, "c1"), /cannot read `other`/);
  assert.match(refusalFor("mcp__pramanyx__get_metric", { connection_id: "other" }, "c1"), /cannot read `other`/);
});

test("a custom agent asked without a connection is refused, since it would answer on its own", () => {
  assert.match(refusalFor("mcp__pramanyx__ask_margin_analyst", { question: "q" }, "c1"), /pass connection `c1`/);
  assert.equal(refusalFor("mcp__pramanyx__ask_margin_analyst", { question: "q", connection: "c1" }, "c1"), undefined);
  assert.match(refusalFor("mcp__pramanyx__ask_margin_analyst", { question: "q", connection: "c2" }, "c1"), /cannot read `c2`/);
});

test("a call that names no connection is left to the tool", () => {
  assert.equal(refusalFor("mcp__pramanyx__read_contract", {}, "c1"), undefined);
  assert.equal(refusalFor(ask, { question: "q" }, "c1"), undefined);
});

test("listing the connections is let through: their names are not their rows", () => {
  assert.equal(refusalFor("mcp__pramanyx__list_connections", {}, "c1"), undefined);
  assert.equal(refusalFor("mcp__pramanyx__list_platform_connections", { connection: "other" }, "c1"), undefined);
});

test("a conversation in no connection's workspace is not held", () => {
  assert.equal(refusalFor(ask, { question: "q", connection: "other" }, ""), undefined);
});

test("another plugin's tools are not this guard's business", () => {
  assert.equal(refusalFor("mcp__other__ask", { connection: "other" }, "c1"), undefined);
  assert.equal(refusalFor("todo_write", { connection: "other" }, "c1"), undefined);
});

test("a connection given as something other than text is not read as a match", () => {
  assert.equal(refusalFor(ask, { connection: { id: "other" } }, "c1"), undefined);
  assert.match(refusalFor(ask, { connection: " other " }, "c1"), /cannot read `other`/);
  assert.equal(refusalFor(ask, { connection: " c1 " }, "c1"), undefined);
});

// ── helpers (sub-agents) ──────────────────────────────────────────────────────────────────────────────────────────

const FOLDER = (id) => `/home/someone/.pramanyx/coworker/connections/${id}`;

test("a held conversation cannot start a helper in another connection's folder", () => {
  const said = refusalFor("subagent", { description: "d", prompt: "p", cwd: FOLDER("other") }, "c1");
  assert.match(said, /held to the connection `c1`, and so is every helper/);
  assert.match(refusalFor("subagent_fork", { cwd: "/tmp" }, "c1"), /Start the helper without a folder/);
  assert.equal(refusalFor("subagent", { description: "d", prompt: "p" }, "c1"), undefined);
  assert.equal(refusalFor("subagent", { cwd: FOLDER("c1") }, "c1"), undefined);
  assert.equal(refusalFor("subagent", { cwd: FOLDER("other") }, ""), undefined, "All sources may give each source its helper");
});

test("a conversation held to no connection starts a helper only in a source's folder, so every helper is held", () => {
  // Found live, 2026-11-15: told to start each source's helper in its folder, the agent started both in All sources.
  assert.match(refusalFor("subagent", { description: "d", prompt: "p" }, ""), /cwd set to that source's folder/);
  assert.match(refusalFor("subagent", { cwd: "/home/someone/.pramanyx/coworker/all-sources" }, ""), /held to that source/);
  assert.equal(refusalFor("subagent", { cwd: FOLDER("sheets") }, ""), undefined);
});

test("a helper is held to the connection of the conversation that started it, whatever its folder", () => {
  const holds = new Map();
  assert.equal(holdOf(holds, "parent", { cwd: FOLDER("c1") }), "c1");
  assert.equal(holdOf(holds, "child", { cwd: "/somewhere/else", parentSession: "parent" }), "c1");
});

test("under All sources, a helper started in a source's folder is held to that source", () => {
  const holds = new Map();
  const ALL = "/home/someone/.pramanyx/coworker/all-sources";
  assert.equal(holdOf(holds, "parent", { cwd: ALL }), "");
  assert.equal(holdOf(holds, "db", { cwd: FOLDER("dcc63d83"), parentSession: "parent" }), "dcc63d83");
  // As the shell does it (live, 2026-11-15): made in the parent's folder, then moved to the one it was started in.
  assert.equal(holdOf(holds, "sheet", { cwd: ALL, parentSession: "parent" }), "");
  assert.equal(holdOf(holds, "sheet", { cwd: ALL, parentSession: "parent" }, FOLDER("sheets")), "sheets");
  assert.equal(holdOf(holds, "sheet", {}, ""), "sheets", "and stays held");
});

test("moving can tighten a hold, never loosen or swap it", () => {
  const holds = new Map();
  assert.equal(holdOf(holds, "s", { cwd: FOLDER("c1") }, FOLDER("other")), "c1");
  assert.equal(holdOf(holds, "s", {}, "/home/someone/.pramanyx/coworker/all-sources"), "c1");
});

test("where a conversation is held is decided once: a later folder is no way round", () => {
  const holds = new Map();
  assert.equal(holdOf(holds, "s", { cwd: FOLDER("c1") }), "c1");
  assert.equal(holdOf(holds, "s", { cwd: FOLDER("other") }), "c1");
  assert.equal(holdOf(holds, "t", { cwd: "/home/someone/.pramanyx/coworker/all-sources" }), "");
  assert.equal(holdOf(holds, "t", { cwd: FOLDER("c1") }), "", "a header read again is not a move");
});

test("an agent that lives on the held connection is asked as it is; one elsewhere, or not yet known, names its connection (2026-11-20)", async () => {
  const { agentHomesOf, agentToolName } = await import("../lib/index.js");
  // The platform's rule for the tool name (pramanyx/custom_agents/reach.py): ask_ and the name in lowercase snake case.
  assert.equal(agentToolName("KPI Analyst"), "mcp__pramanyx__ask_kpi_analyst");
  assert.equal(agentToolName("The Look Analyst"), "mcp__pramanyx__ask_the_look_analyst");
  const homes = agentHomesOf([{ name: "KPI Analyst", connection_id: "dcc63d83" }, { name: "Anomaly Scout", connection_id: "8233e4fd" }]);
  const ask = (tool) => refusalFor(tool, { question: "What is GMV by platform?" }, "dcc63d83", [], homes);
  assert.equal(ask("mcp__pramanyx__ask_kpi_analyst"), undefined);
  assert.match(ask("mcp__pramanyx__ask_anomaly_scout"), /pass connection `dcc63d83`/);
  assert.match(refusalFor("mcp__pramanyx__ask_kpi_analyst", { question: "q" }, "dcc63d83"), /pass connection/);   // homes not read yet
});
