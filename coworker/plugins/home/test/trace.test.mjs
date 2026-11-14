// A coworker turn, as the platform's trace store is told it. `node --test plugins/home/test/trace.test.mjs`
import test from "node:test";
import assert from "node:assert/strict";
import { traceOf, turnEvents } from "../lib/index.js";

const S = "session-88f4fdd1-9a45-4d47-a907-c446dd4d3d83";
const ev = (type, seq, time, data) => ({ type, seq, time, data });
const answer = JSON.stringify({ answer: "NET-A-PORTER leads", row_count: 5, investigation_id: "b97328dd", trace_id: "1d5a621b", receipt: { artifact: { id: "54a8bed26939" } } });

function aTurn() {
  const turns = new Map();
  const out = [];
  for (const e of [
    ev("turn/start", 5, 1000, { turn: 1 }),
    ev("user/message", 9, 1010, { content: [{ type: "text", text: "What is total GMV by platform?" }], source: { kind: "user" } }),
    ev("user/message", 10, 1011, { content: [{ type: "text", text: "the folder's instructions" }], source: { kind: "agent-instructions" } }),
    ev("assistant/message", 18, 2000, { turn: 1, step: 1, message: { content: [{ type: "text", text: "I'll check." }] }, usage: { totalTokens: 9 } }),
    ev("tool/call", 19, 2001, { turn: 1, step: 1, callId: "call_1", name: "mcp__pramanyx__ask", arguments: '{"question":"What is total GMV by platform?","connection":"dcc63d83"}' }),
    ev("tool/result", 20, 9001, { turn: 1, step: 1, message: { toolCallId: "call_1", content: [{ type: "text", text: answer }], isError: false } }),
    ev("turn/end", 25, 9500, { turn: 1, reason: { kind: "completed" } }),
  ]) out.push(...turnEvents(turns, S, "dcc63d83", e));
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

test("an answer's result carries the platform's own trace for it, its receipt and its rows", () => {
  const result = aTurn().out[2];
  assert.equal(result.span_id, "call_1");
  assert.equal(result.ok, true);
  assert.equal(result.duration_ms, 7000);
  assert.equal(result.row_count, 5);
  assert.equal(result.payload.platform_trace, "1d5a621b");
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
  const turns = new Map();
  turnEvents(turns, S, "", ev("turn/start", 1, 0, { turn: 2 }));
  const [end] = turnEvents(turns, S, "", ev("turn/end", 2, 50, { turn: 2, reason: { kind: "aborted" } }));
  assert.equal(end.ok, false);
  assert.equal(end.conn_id, null);
});

test("an event outside any turn is not recorded", () => {
  assert.deepEqual(turnEvents(new Map(), S, "", ev("tool/call", 3, 0, { callId: "x", name: "y" })), []);
});

test("an answer recorded inside this turn's own trace names no other trace", () => {
  const turns = new Map();
  turnEvents(turns, S, "", ev("turn/start", 1, 0, { turn: 1 }));
  turnEvents(turns, S, "", ev("tool/call", 2, 1, { callId: "c", name: "mcp__pramanyx__ask", arguments: "{}" }));
  const [result] = turnEvents(turns, S, "", ev("tool/result", 3, 2, { message: { toolCallId: "c", content: [{ type: "text", text: JSON.stringify({ answer: "x", trace_id: traceOf(S, 1) }) }] } }));
  assert.ok(!("platform_trace" in result.payload));
});
