// A coworker turn, as the platform's trace store is told it. `node --test plugins/home/test/trace.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { closeOf, helperLines, newRecord, readAnswerCheck, readHelper, readHelperOfCall, traceOf, turnEvents } from "../lib/index.js";

const S = "session-88f4fdd1-9a45-4d47-a907-c446dd4d3d83";
const ev = (type, seq, time, data) => ({ type, seq, time, data });
const answer = JSON.stringify({ answer: "NET-A-PORTER leads", row_count: 5, investigation_id: "b97328dd", receipt: { artifact: { id: "54a8bed26939" } } });

function aTurn() {
  const record = newRecord();
  const turns = record.turns;
  const out = [];
  for (const e of [
    ev("turn/start", 5, 1000, { turn: 1 }),
    ev("user/message", 9, 1010, { content: [{ type: "text", text: "What is total GMV by platform?" }], source: { kind: "user" } }),
    ev("user/message", 10, 1011, { content: [{ type: "text", text: "the folder's instructions" }], source: { kind: "agent-instructions" } }),
    ev("assistant/message", 18, 2000, { turn: 1, step: 1, message: { content: [{ type: "text", text: "I'll check." }] }, usage: { totalTokens: 9 } }),
    ev("tool/call", 19, 2001, { turn: 1, step: 1, callId: "call_1", name: "mcp__pramanyx__ask", arguments: '{"question":"What is total GMV by platform?","connection":"dcc63d83"}' }),
    ev("tool/result", 20, 9001, { turn: 1, step: 1, message: { toolCallId: "call_1", content: [{ type: "text", text: answer }], isError: false } }),
    ev("turn/end", 25, 9500, { turn: 1, reason: { kind: "completed" } }),
  ]) out.push(...turnEvents(record, S, "dcc63d83", e));
  return { out, turns };
}

test("a trace is named for the conversation and the turn, in the form the platform accepts", () => {
  assert.equal(traceOf(S, 1), "cw-88f4fdd19a454d47-1");
  assert.match(traceOf(S, 12), /^cw-[A-Za-z0-9]{6,40}-[0-9]{1,6}$/);
});

test("a turn comes to its question, each tool call and result, and its end — in order", () => {
  const { out, turns } = aTurn();
  assert.deepEqual(out.map((e) => e.kind), ["user_request", "tool_call", "tool_call_result", "final_response"]);
  assert.equal(out[0].payload.question, "What is total GMV by platform?");
  assert.equal(out[0].conn_id, "dcc63d83");
  assert.equal(turns.size, 0, "a finished turn is forgotten");
});

test("what the agent was given and what it said are not sent — only where they are", () => {
  const sent = JSON.stringify(aTurn().out);
  assert.ok(!sent.includes("the folder's instructions"));
  assert.ok(!sent.includes("I'll check."));
  assert.ok(!sent.includes("llm_call"), "a model call is the door's to record");
  assert.equal(aTurn().out[1].payload.shell_session, S);
  assert.equal(aTurn().out[1].payload.seq, 19);
});

test("an answer's result carries its receipt and its rows", () => {
  const result = aTurn().out[2];
  assert.equal(result.span_id, "call_1");
  assert.equal(result.ok, true);
  assert.equal(result.duration_ms, 7000);
  assert.equal(result.row_count, 5);
  assert.equal(result.payload.receipt_id, "54a8bed26939");
  assert.ok(!("rows" in result.payload));
});

test("the turn's end says how it ended, how long it took, and the last answer's headline", () => {
  const end = aTurn().out[3];
  assert.equal(end.ok, true);
  assert.equal(end.duration_ms, 8500);
  assert.equal(end.payload.headline, "NET-A-PORTER leads");
  assert.equal(end.payload.calls, 1);
});

test("a turn that was stopped is not recorded as one that worked", () => {
  const record = newRecord();
  turnEvents(record, S, "", ev("turn/start", 1, 0, { turn: 2 }));
  const [end] = turnEvents(record, S, "", ev("turn/end", 2, 50, { turn: 2, reason: { kind: "aborted" } }));
  assert.equal(end.ok, false);
  assert.equal(end.conn_id, null);
});

test("an event outside any turn is not recorded", () => {
  assert.deepEqual(turnEvents(newRecord(), S, "", ev("tool/call", 3, 0, { callId: "x", name: "y" })), []);
});

// ── helpers (sub-agents): one question, one trace ─────────────────────────────────────────────────────────────────

const H = "f6602a4c-e2ec-4ff3-98fb-dfe4d7516b02";
const H2 = "d43eec38-5d54-49d4-869b-11e12776dc77";
const asHelper = { parentSession: S, origin: "subagent", delegationDepth: 1 };
const text = (t) => [{ type: "text", text: t }];

/** A question that starts two helpers, as the probe of 2026-11-15 recorded it, in the order the shell said it. */
function aWideQuestion() {
  const record = newRecord();
  const out = [];
  const on = (session, header, e) => {
    const events = turnEvents(record, session, "dcc63d83", e, header);
    out.push(...events.map((x) => ({ ...x, session, trace: (record.turns.get(session) ?? {}).trace })));
    return events;
  };
  on(S, {}, ev("turn/start", 1, 1000, { turn: 1 }));
  on(S, {}, ev("user/message", 2, 1001, { content: text("GMV by platform and orders by status, FY2027"), source: { kind: "user" } }));
  on(S, {}, ev("tool/call", 3, 1100, { callId: "spawn_1", name: "subagent", arguments: '{"description":"GMV by platform FY2027","prompt":"…"}' }));
  on(S, {}, ev("tool/call", 4, 1101, { callId: "spawn_2", name: "subagent", arguments: '{"description":"Orders by status FY2027","prompt":"…"}' }));
  on(S, {}, ev("tool/result", 5, 1110, { message: { toolCallId: "spawn_1", content: text(`started subagent ${H}`) } }));
  // The second helper begins before its start is reported: its work must still land inside its call.
  on(H2, asHelper, ev("turn/start", 1, 1115, { turn: 1 }));
  on(S, {}, ev("tool/result", 6, 1120, { message: { toolCallId: "spawn_2", content: text(`started subagent ${H2}`) } }));
  on(S, {}, ev("turn/end", 7, 1200, { turn: 1, reason: { kind: "completed" } }));
  on(H, asHelper, ev("turn/start", 1, 1300, { turn: 1 }));
  on(H, asHelper, ev("user/message", 2, 1301, { content: text("Your job: find total GMV by platform"), source: { kind: "user" } }));
  on(H, asHelper, ev("tool/call", 3, 1400, { callId: "ask_h1", name: "mcp__pramanyx__ask", arguments: '{"question":"GMV by platform","connection":"dcc63d83"}' }));
  on(H, asHelper, ev("tool/result", 4, 5400, { message: { toolCallId: "ask_h1", content: text(answer) } }));
  on(H, asHelper, ev("turn/end", 5, 5500, { turn: 1, reason: { kind: "completed" } }));
  on(S, {}, ev("turn/start", 8, 5600, { turn: 2 }));
  on(S, {}, ev("user/message", 9, 5601, { content: text(`Agent ${H} sent a message: RESULT …`), source: { kind: "agent-message", senderSessionId: H } }));
  on(S, {}, ev("turn/end", 10, 5700, { turn: 2, reason: { kind: "completed" } }));
  on(H2, asHelper, ev("tool/call", 2, 5800, { callId: "ask_h2", name: "mcp__pramanyx__ask", arguments: '{"question":"orders by status","connection":"dcc63d83"}' }));
  on(H2, asHelper, ev("tool/result", 3, 7800, { message: { toolCallId: "ask_h2", content: text(answer) } }));
  on(H2, asHelper, ev("turn/end", 4, 7900, { turn: 1, reason: { kind: "completed" } }));
  on(S, {}, ev("turn/start", 11, 8000, { turn: 3 }));
  on(S, {}, ev("user/message", 12, 8001, { content: text(`Background subagent ${H2} finished`), source: { kind: "subagent-settled", senderSessionId: H2 } }));
  on(S, {}, ev("turn/end", 13, 9000, { turn: 3, reason: { kind: "completed" } }));
  return { out, record };
}

test("every agent's work on one question is in that question's trace", () => {
  const { out } = aWideQuestion();
  const traces = new Set(out.map((e) => e.trace ?? traceOf(S, 1)));
  assert.deepEqual([...traces], [traceOf(S, 1)], "the helpers' work and the reports' turns join the question's trace");
});

test("a helper's brief is not a person's question", () => {
  const { out } = aWideQuestion();
  const asked = out.filter((e) => e.kind === "user_request");
  assert.equal(asked.length, 1);
  assert.equal(asked[0].payload.question, "GMV by platform and orders by status, FY2027");
});

test("a helper's work is inside the call that started it, even when it began before that call was answered", () => {
  const { out } = aWideQuestion();
  // The helper's own calls; the close of the call that started it is that call, not something inside it.
  const own = (session) => out.filter((e) => e.session === session && e.kind.startsWith("tool_call") && !e.span_id.startsWith("spawn_"));
  const h1 = own(H);
  const h2 = own(H2);
  assert.ok(h1.length === 2 && h1.every((e) => e.parent_span_id === "spawn_1"));
  assert.ok(h2.length >= 2 && h2.every((e) => e.parent_span_id === "spawn_2"));
});

test("a helper's call lasts as long as the helper worked", () => {
  const { out } = aWideQuestion();
  const closed = out.filter((e) => e.kind === "tool_call_result" && e.span_id.startsWith("spawn_"));
  assert.deepEqual(closed.map((e) => e.span_id), ["spawn_1", "spawn_2"]);
  assert.equal(closed[0].duration_ms, 5500 - 1100);
  assert.equal(closed[0].payload.description, "GMV by platform FY2027");
  assert.equal(closed[0].payload.headline, "NET-A-PORTER leads");
});

test("the question ends once, when no helper is still working", () => {
  const { out, record } = aWideQuestion();
  const ends = out.filter((e) => e.kind === "final_response");
  assert.equal(ends.length, 1, "not at the turn that started the helpers, nor at the first report");
  assert.equal(ends[0].payload.turn, 3);
  assert.equal(ends[0].duration_ms, 9000 - 1000, "measured from the start of the question's turn");
  assert.equal(record.questions.get(S).running.size, 0);
});

test("what a helper found is kept for the page: its description, its answers, that it finished", () => {
  const record = newRecord();
  const lines = [];
  const on = (session, header, e) => { turnEvents(record, session, "dcc63d83", e, header); lines.push(...helperLines(record, session, header, e)); };
  on(S, {}, ev("turn/start", 1, 0, { turn: 1 }));
  on(S, {}, ev("user/message", 2, 1, { content: text("q"), source: { kind: "user" } }));
  on(S, {}, ev("tool/call", 3, 2, { callId: "spawn_1", name: "subagent", arguments: '{"description":"GMV by platform FY2027"}' }));
  on(S, {}, ev("tool/result", 4, 3, { message: { toolCallId: "spawn_1", content: text(`started subagent ${H}`) } }));
  on(H, asHelper, ev("turn/start", 1, 4, { turn: 1 }));
  on(H, asHelper, ev("tool/call", 2, 5, { callId: "ask_h1", name: "mcp__pramanyx__ask", arguments: '{"question":"GMV by platform","connection":"dcc63d83"}' }));
  on(H, asHelper, ev("tool/result", 3, 6, { message: { toolCallId: "ask_h1", content: text(answer) } }));
  on(H, asHelper, ev("tool/call", 4, 7, { callId: "md", name: "mcp__pramanyx__get_metric", arguments: "{}" }));
  on(H, asHelper, ev("tool/result", 5, 8, { message: { toolCallId: "md", content: text("{}") } }));
  on(H, asHelper, ev("turn/end", 6, 9, { turn: 1, reason: { kind: "completed" } }));
  assert.deepEqual(lines.map(([id]) => id), [H, "call:spawn_1", H, H]);
  assert.deepEqual(lines[0][1], { started: { description: "GMV by platform FY2027", parent: S, call: "spawn_1" } });
  assert.deepEqual(lines[1][1], { child: H }, "the page finds a helper by the call that started it");
  assert.equal(lines[2][1].answer.tool, "mcp__pramanyx__ask");
  assert.deepEqual(lines[2][1].answer.args, { question: "GMV by platform", connection: "dcc63d83" });
  assert.equal(lines[2][1].answer.text, answer, "an answer is kept as it came back; a definition read is not an answer");
  assert.deepEqual(lines[3][1], { ended: "completed" });
});

test("the page reads what was kept of a helper, and nothing for an id that is not one", async () => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = await mkdtemp(join(tmpdir(), "helpers-"));
  const was = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    await mkdir(join(home, "helpers"), { recursive: true });
    await writeFile(join(home, "helpers", `${H}.jsonl`), [
      JSON.stringify({ started: { description: "GMV by platform FY2027", parent: S } }),
      JSON.stringify({ answer: { tool: "mcp__pramanyx__ask", args: { question: "q" }, text: answer } }),
      "not json",
    ].join("\n") + "\n");
    const working = await readHelper(H);
    assert.deepEqual([working.known, working.description, working.answers.length, working.done], [true, "GMV by platform FY2027", 1, false]);
    await writeFile(join(home, "helpers", `${H}.jsonl`), `${JSON.stringify({ ended: "completed" })}\n`, { flag: "a" });
    assert.equal((await readHelper(H)).done, true);
    assert.equal((await readHelper(H2)).known, false, "a helper from before answers were kept");
    assert.equal(await readHelper("../../etc/passwd"), null, "an id is an id, never a path");
    assert.deepEqual(await readHelperOfCall("spawn_9"), { known: false, pending: true }, "a start not known yet");
    await mkdir(join(home, "helpers", "calls"), { recursive: true });
    await writeFile(join(home, "helpers", "calls", "spawn_1.json"), JSON.stringify({ child: H }));
    assert.equal((await readHelperOfCall("spawn_1")).description, "GMV by platform FY2027");
    assert.equal(await readHelperOfCall("../x"), null);
  } finally {
    if (was === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = was;
  }
});

// ── the one answer, checked ───────────────────────────────────────────────────────────────────────────────────────

const said = (t) => ({ content: [{ type: "reasoning", text: "thinking about it" }, { type: "text", text: t }] });
const answerOf = (id) => JSON.stringify({ answer: "a headline", investigation_id: id, row_count: 3 });

test("a question's one answer is its fullest reply that is not bookkeeping", () => {
  assert.equal(closeOf(["Waiting", "Lux 3.98%, Olist 0.63% — not like for like.", "Done."]), "Lux 3.98%, Olist 0.63% — not like for like.");
  assert.equal(closeOf(["Waiting.", " done "]), "");
  assert.equal(closeOf([]), "");
});

/** Two helpers, a check of the main agent's own, a late report after the answer: as the live run of 2026-11-16 went. */
function aGatheredQuestion() {
  const record = newRecord();
  const out = [];
  const on = (session, header, e) => out.push(...turnEvents(record, session, "", e, header));
  on(S, {}, ev("turn/start", 1, 0, { turn: 1 }));
  on(S, {}, ev("user/message", 2, 1, { content: text("Lux vs Olist cancellation"), source: { kind: "user" } }));
  on(S, {}, ev("tool/call", 3, 2, { callId: "spawn_1", name: "subagent", arguments: "{}" }));
  on(S, {}, ev("tool/call", 4, 3, { callId: "spawn_2", name: "subagent", arguments: "{}" }));
  on(S, {}, ev("tool/result", 5, 4, { message: { toolCallId: "spawn_1", content: text(`started subagent ${H}`) } }));
  on(S, {}, ev("tool/result", 6, 5, { message: { toolCallId: "spawn_2", content: text(`started subagent ${H2}`) } }));
  on(S, {}, ev("turn/end", 7, 6, { turn: 1, reason: { kind: "completed" } }));
  for (const [helper, id] of [[H, "inv-lux"], [H2, "inv-olist"]]) {
    on(helper, asHelper, ev("turn/start", 1, 10, { turn: 1 }));
    on(helper, asHelper, ev("tool/call", 2, 11, { callId: `ask_${id}`, name: "mcp__pramanyx__ask", arguments: "{}" }));
    on(helper, asHelper, ev("tool/result", 3, 12, { message: { toolCallId: `ask_${id}`, content: text(answerOf(id)) } }));
    on(helper, asHelper, ev("turn/end", 4, 13, { turn: 1, reason: { kind: "completed" } }));
  }
  on(S, {}, ev("turn/start", 8, 20, { turn: 2 }));
  on(S, {}, ev("user/message", 9, 21, { content: text("finished"), source: { kind: "subagent-settled" } }));
  on(S, {}, ev("tool/call", 10, 22, { callId: "own_check", name: "mcp__pramanyx__ask", arguments: "{}" }));
  on(S, {}, ev("tool/result", 11, 23, { message: { toolCallId: "own_check", content: text(answerOf("inv-check")) } }));
  on(S, {}, ev("assistant/message", 12, 24, { message: said("Lux is 3.98%; Olist is 0.63%, all-time, so not like for like.") }));
  on(S, {}, ev("turn/end", 13, 25, { turn: 2, reason: { kind: "completed" } }));
  const first = record.checks.splice(0);
  on(S, {}, ev("turn/start", 14, 30, { turn: 3 }));
  on(S, {}, ev("user/message", 15, 31, { content: text("finished"), source: { kind: "subagent-settled" } }));
  on(S, {}, ev("assistant/message", 16, 32, { message: said("Done.") }));
  on(S, {}, ev("turn/end", 17, 33, { turn: 3, reason: { kind: "completed" } }));
  return { out, record, first, later: record.checks.splice(0) };
}

test("the one answer is checked against every answer the question gathered: the helpers' and its own", () => {
  const { first } = aGatheredQuestion();
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].ids.sort(), ["inv-check", "inv-lux", "inv-olist"]);
  assert.equal(first[0].text, "Lux is 3.98%; Olist is 0.63%, all-time, so not like for like.", "the words said, not the thinking");
  assert.equal(first[0].call, "spawn_1", "found by the call that started the question's first helper");
  assert.equal(first[0].trace, traceOf(S, 1));
});

test("a late report neither ends the question again nor checks an answer that did not change", () => {
  const { out, later } = aGatheredQuestion();
  assert.equal(out.filter((e) => e.kind === "final_response").length, 1);
  assert.equal(later.length, 0, "\"Done\" is not an answer");
});

test("a question with no helpers is not checked: its answer is the platform's own", () => {
  const record = newRecord();
  for (const e of [ev("turn/start", 1, 0, { turn: 1 }), ev("user/message", 2, 1, { content: text("q"), source: { kind: "user" } }),
                   ev("turn/end", 3, 2, { turn: 1, reason: { kind: "completed" } })]) turnEvents(record, S, "", e);
  assert.deepEqual(record.checks, []);
});

test("the page reads what was said of an answer, pending until it was said", async () => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = await mkdtemp(join(tmpdir(), "checks-"));
  const was = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    assert.deepEqual(await readAnswerCheck("spawn_1"), { state: "pending" });
    await mkdir(join(home, "helpers", "checks"), { recursive: true });
    await writeFile(join(home, "helpers", "checks", "spawn_1.json"), JSON.stringify({ state: "checked", checked: 5, found: 4 }));
    assert.equal((await readAnswerCheck("spawn_1")).found, 4);
    assert.equal(await readAnswerCheck("../etc"), null);
  } finally {
    if (was === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = was;
  }
});
