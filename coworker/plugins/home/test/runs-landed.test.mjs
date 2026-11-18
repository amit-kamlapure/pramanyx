// Punch list 85 (2026-11-18): a scheduled run that lands while the person is away reaches them — its conversation is
// marked until it is opened.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { latestRun, runsDoor, runsReachThePerson, scheduleMadeBy } from "../lib/index.js";

function aShell(keep, reads) {
  const on = new Map();
  const ctx = { on: (name, fn) => on.set(name, fn) };
  const runs = runsReachThePerson(ctx, "http://api", { keep, readSchedule: async (id) => reads(id) });
  const event = (id, type, data = {}, header = {}) => on.get("session/event")({ id, header }, { type, data });
  const schedule = (session, callId, result, isError = false, header = {}) => {
    event(session, "tool/call", { callId, name: "mcp__pramanyx__schedule" }, header);
    event(session, "tool/result", { message: { toolCallId: callId, isError, content: [{ type: "text", text: JSON.stringify(result) }] } }, header);
  };
  return { runs, event, schedule };
}

test("the schedule a call made is read from its result; one that asked instead made none", () => {
  assert.equal(scheduleMadeBy(JSON.stringify({ id: "auto_1", name: "Daily orders" })), "auto_1");
  assert.equal(scheduleMadeBy(JSON.stringify({ scheduled: false, needs: "when" })), "");
  assert.equal(scheduleMadeBy("not json"), "");
  assert.equal(latestRun({ runs: [{ at: "2026-11-18T07:00:00Z" }, { at: "2026-11-18T09:00:00Z" }] }), "2026-11-18T09:00:00Z");
  assert.equal(latestRun({ runs: [] }), "");
});

test("a run that lands marks its conversation until it is opened, and a removed schedule is forgotten", async () => {
  const keep = join(mkdtempSync(join(tmpdir(), "runs-")), "runs.json");
  let read = { name: "Daily orders", runs: [] };
  const { runs, schedule } = aShell(keep, () => read);
  schedule("s1", "c1", { id: "auto_1", name: "Daily orders" });
  schedule("s2", "c2", { scheduled: false, needs: "when" });
  schedule("s3", "c3", { id: "auto_3" }, true);                          // a failed call made nothing
  assert.deepEqual(runs.state.schedules, { auto_1: "s1" });
  await runs.tick();
  assert.deepEqual(runs.state.unread, {}, "no run yet");
  read = { name: "Daily orders", runs: [{ at: "2026-11-18T09:00:00Z" }] };
  await runs.tick();
  assert.deepEqual(runs.state.unread, { s1: { at: "2026-11-18T09:00:00Z", name: "Daily orders", automation: "auto_1" } });
  assert.equal(runs.seen("s1"), true);
  await runs.tick();
  assert.deepEqual(runs.state.unread, {}, "the same run is not news twice");
  read = { name: "Daily orders", runs: [{ at: "2026-11-18T09:00:00Z" }, { at: "2026-11-19T09:00:00Z" }] };
  await runs.tick();
  assert.equal(runs.state.unread.s1.at, "2026-11-19T09:00:00Z");
  // Kept across a restart.
  const again = aShell(keep, () => read);
  assert.equal(again.runs.state.unread.s1.at, "2026-11-19T09:00:00Z");
  read = null;                                                           // the platform no longer has it
  await again.runs.tick();
  assert.deepEqual(again.runs.state.schedules, {});
  assert.deepEqual(JSON.parse(readFileSync(keep, "utf8")).schedules, {});
});

test("a helper's schedule marks the conversation it was asked in, and an unread platform is asked again", async () => {
  const keep = join(mkdtempSync(join(tmpdir(), "runs-")), "runs.json");
  let fails = true;
  const { runs, schedule } = aShell(keep, () => { if (fails) throw new Error("502"); return { runs: [{ at: "2026-11-18T09:00:00Z" }] }; });
  schedule("helper-1", "c1", { id: "auto_9" }, false, { parentSession: "s1" });
  assert.deepEqual(runs.state.schedules, { auto_9: "s1" });
  await runs.tick();
  assert.deepEqual(runs.state.unread, {});
  fails = false;
  await runs.tick();
  assert.ok(runs.state.unread.s1);
});

function reqOf(method, body, headers = {}) {
  const r = Readable.from(body ? [Buffer.from(body)] : []);
  r.method = method; r.headers = headers;
  return r;
}
function resOf() {
  const out = { status: 0, body: "" };
  return { out, writeHead: (s) => { out.status = s; }, end: (b) => { out.body = b ?? ""; } };
}

test("the page reads the marks and says when a conversation was opened; another site may not", async () => {
  const runs = { state: { unread: { s1: { at: "x" } } }, seen: (id) => id === "s1" };
  let res = resOf();
  await runsDoor(reqOf("GET"), res, runs);
  assert.deepEqual(JSON.parse(res.out.body), { unread: { s1: { at: "x" } } });
  res = resOf();
  await runsDoor(reqOf("POST", JSON.stringify({ session: "s1" }), { "sec-fetch-site": "same-origin" }), res, runs);
  assert.deepEqual(JSON.parse(res.out.body), { cleared: true });
  res = resOf();
  await runsDoor(reqOf("POST", JSON.stringify({ session: "s1" }), { "sec-fetch-site": "cross-site" }), res, runs);
  assert.equal(res.out.status, 403);
  res = resOf();
  await runsDoor(reqOf("POST", "{}"), res, runs);
  assert.equal(res.out.status, 422);
});

test("a schedule's card runs it now or switches it off, as the person, from this page only", async () => {
  const { scheduleDoor } = await import("../lib/index.js");
  const sent = [];
  const send = async (url, init) => {
    sent.push({ url, init });
    if (url.endsWith("/run")) return new Response(JSON.stringify({ outcome: "fired", reason: "run now" }));
    return new Response(JSON.stringify({ enabled: url.endsWith("enabled=true") }));
  };
  const ask = async (body, headers = { "sec-fetch-site": "same-origin" }, method = "POST") => {
    const res = resOf();
    await scheduleDoor(reqOf(method, JSON.stringify(body), headers), res, "http://api", { send, person: async () => ({ "x-pramanyx-delegation": "d" }), clock: async () => ({}) });
    return { status: res.out.status || 200, body: res.out.body ? JSON.parse(res.out.body) : {} };
  };
  assert.deepEqual((await ask({ automation: "auto_1", action: "run" })).body, { ran: true, outcome: "fired", reason: "run now" });
  assert.equal(sent[0].url, "http://api/automations/auto_1/run");
  assert.equal(sent[0].init.headers["x-pramanyx-delegation"], "d", "as the person the coworker acts for");
  assert.deepEqual((await ask({ automation: "auto_1", action: "off" })).body, { enabled: false });
  assert.equal(sent[1].url, "http://api/automations/auto_1/enabled?enabled=false");
  assert.deepEqual((await ask({ automation: "auto_1", action: "on" })).body, { enabled: true });
  assert.equal((await ask({ automation: "auto_1", action: "run" }, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await ask({ automation: "../x", action: "run" })).status, 422);
  assert.equal((await ask({ automation: "auto_1", action: "delete" })).status, 422);
  assert.equal(sent.length, 3, "a refused call reaches nothing");
});

test("a connection's instructions carry what the platform says about its agents, or nothing", async () => {
  const { agentsWords } = await import("../lib/index.js");
  const said = await agentsWords("http://api", "c 1", { send: async (url) => {
    assert.equal(url, "http://api/agents/custom/routing?connection_id=c%201");
    return new Response(JSON.stringify({ words: "## Its agent\n\nAsk through `ask_margin_analyst`." }));
  } });
  assert.match(said, /ask_margin_analyst/);
  assert.equal(await agentsWords("http://api", "c1", { send: async () => new Response("{}", { status: 404 }) }), "");
  assert.equal(await agentsWords("http://api", "c1", { send: async () => { throw new Error("down"); } }), "");
});

test("a running deep analysis answers now at the person's word, from this page only", async () => {
  const { answerNowDoor } = await import("../lib/index.js");
  const sent = [];
  const send = async (url, init) => { sent.push({ url, init }); return new Response(JSON.stringify({ answering_now: true })); };
  const ask = async (body, headers = { "sec-fetch-site": "same-origin" }) => {
    const res = resOf();
    await answerNowDoor(reqOf("POST", JSON.stringify(body), headers), res, "http://api", { send, person: async () => ({ "x-pramanyx-delegation": "d" }) });
    return { status: res.out.status || 200, body: res.out.body ? JSON.parse(res.out.body) : {} };
  };
  assert.deepEqual((await ask({ investigation: "inv_9" })).body, { answering_now: true });
  assert.equal(sent[0].url, "http://api/investigations/inv_9/answer-now");
  assert.equal(sent[0].init.headers["x-pramanyx-delegation"], "d");
  assert.equal((await ask({ investigation: "inv_9" }, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await ask({ investigation: "../x" })).status, 422);
  assert.equal(sent.length, 1);
});
