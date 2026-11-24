/**
 * A deep analysis in the coworker reads as its report (the user, 2026-11-23: "the output format, the methodology and user
 * experience has to be the same across the harness (coworker), Data canvas and the Ask on the right panel"). Before, its
 * result was a step whose detail was raw JSON.
 *
 *   node --test coworker/plugins/answer-card/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isDeepRecord, reportFacts, reportOf } from "../src/report.js";

const RESULT = {
  question: "Why did revenue fall in August?", connection: "sheets", investigation_id: "inv7", status: "complete",
  report_kind: "ada",
  report: {
    headline: "Revenue fell 12% in August, most of it in São Paulo",
    executive_summary: "Revenue fell 12% in August, most of it in São Paulo",
    total_change_label: "−12%", observation_period: "Aug 2018", comparison_basis: "Jul 2018",
    closing_summary: "Freight costs, not demand, explain the fall.",
    recommendations: [{ action: "Review São Paulo freight contracts" }, "Watch September"],
    phases: [
      { phase_id: "intake", status: "complete", findings: [{ sql: "SELECT 1" }] },
      { phase_id: "decomposition", status: "complete", findings: [{ sql: "SELECT a" }, { sql: "SELECT b", error: "x" }, { sql: "" }] },
      { phase_id: "segments", status: "skipped", findings: [{ sql: "SELECT c" }] },
      { phase_id: "drivers", status: "complete", findings: [{ sql: "SELECT d" }] },
    ],
  },
};

test("it says what the platform's report opens and closes with, each once", () => {
  const f = reportFacts(reportOf(JSON.stringify(RESULT)));
  assert.equal(f.head, "Revenue fell 12% in August, most of it in São Paulo");
  assert.equal(f.summary, "", "a summary that only repeats the headline is said once");
  assert.deepEqual(f.period, ["−12%", "Aug 2018 vs Jul 2018"]);
  assert.equal(f.closing, "Freight costs, not demand, explain the fall.");
  assert.deepEqual(f.recs, ["Review São Paulo freight contracts", "Watch September"]);
  assert.equal(f.sources, 2, "each query a phase ran, not the intake's, a skipped phase's, a failed or an empty one");
  assert.equal(f.id, "inv7");
});

test("a change or a period the words already say is not said again under them", () => {
  const f = reportFacts({ report: { headline: "Revenue fell −12% in Aug 2018 vs Jul 2018", total_change_label: "−12%",
    observation_period: "Aug 2018", comparison_basis: "Jul 2018" } });
  assert.deepEqual(f.period, []);
});

test("a result cut short on its way still names its analysis, so the card can open it whole", () => {
  const whole = JSON.stringify(RESULT, null, 2);
  const cut = whole.slice(0, whole.indexOf('"phases"'));
  const got = reportOf(cut);
  assert.equal(got.cut, true);
  assert.equal(got.investigation_id, "inv7");
  assert.equal(got.question, "Why did revenue fall in August?");
  assert.equal(reportFacts(got).head, "");
  assert.equal(reportOf("not json at all"), null);
});

test("a run still going is said to be running", () => {
  const f = reportFacts({ investigation_id: "inv8", status: "running", message: "Still running after 300s." });
  assert.equal(f.running, true);
  assert.equal(f.message, "Still running after 300s.");
});

test("a run read back later (get_investigation) is drawn as its report when it is a deep analysis's (2026-11-23)", () => {
  const record = { id: "inv9", question: "Why?", connection_id: "workspace", status: "complete",
                   report: { headline: "It fell", phases: [{ phase_id: "drivers", status: "complete", findings: [{ sql: "SELECT 1" }] }] } };
  assert.equal(isDeepRecord(record), true);
  const f = reportFacts(record);
  assert.equal(f.id, "inv9");
  assert.equal(f.connection, "workspace");
  assert.equal(f.sources, 1);
  assert.equal(isDeepRecord({ id: "q1", report: { headline: "42 rows", rows: [[42]] } }), false, "a quick answer has no phases");
  assert.equal(reportFacts({ id: "inv9", status: "pending" }).running, true);
});

test("a deep analysis that stopped is drawn, and says why in the platform's own sentence (2026-11-24)", () => {
  // e4796f93 as read back: failed, no phases, the reason in `error` — the card drew nothing, and said nothing of why
  const record = { id: "e4796f93", kind: "investigation", status: "failed", connection_id: "8233e4fd",
                   question: "Why did revenue on theLook rise or fall between July and August 2026?",
                   error: "Stopped at the Analyst's 1800s time budget before answering (14 model calls, 9 queries). "
                        + "Bind a faster model in Settings → Models, or raise time_budget_s with PATCH /agents/analyst.",
                   report: { envelope: { headline: "" } } };
  assert.equal(isDeepRecord(record), true, "drawn, though it has no phases");
  const f = reportFacts(record);
  assert.equal(f.stopped, true);
  assert.equal(f.running, false);
  assert.equal(f.why, record.error);
  assert.equal(f.head, "");
  for (const status of ["timed_out", "interrupted"]) assert.equal(reportFacts({ status }).stopped, true, status);
  assert.equal(reportFacts({ status: "complete" }).stopped, false);
  assert.equal(reportFacts({ status: "paused" }).stopped, false, "a run waiting on a person has not stopped");
  assert.equal(isDeepRecord({ id: "q1", kind: "chat", status: "failed", error: "x" }), false, "a quick answer's failure is not a deep report");
  assert.equal(isDeepRecord({ id: "inv8", kind: "investigation", status: "running" }), false, "a running record read back is not drawn, as before");
});

test("a running analysis read again becomes what it found — or why it stopped — once it lands (2026-11-24)", async () => {
  const { landed } = await import("../src/report.js");
  assert.equal(landed({ id: "d8b19615", status: "running", progress: { steps: 4 } }), null, "still going: keep reading");
  assert.equal(landed({ id: "d8b19615", status: "pending" }), null);
  const done = { id: "d8b19615", status: "complete", report: { headline: "Jeans, Sweaters and Active rose most", phases: [] } };
  assert.equal(landed(done), done);
  assert.equal(reportFacts(landed(done)).head, "Jeans, Sweaters and Active rose most");
  const stopped = { id: "e4796f93", kind: "investigation", status: "failed", error: "Stopped at the Analyst's 1800s time budget" };
  assert.equal(reportFacts(landed(stopped)).why, "Stopped at the Analyst's 1800s time budget");
  assert.equal(landed(null), null);
});

test("a running analysis is read again until it lands, once; a 4xx stops the reading; stopping aborts the read", async () => {
  const { follow } = await import("../src/report.js");
  const timers = [];
  const clock = { t: 0 };
  const opts = (answers, seen) => ({
    read: (_id, signal) => { seen.signals.push(signal); return Promise.resolve(answers.shift()); },
    onLanded: (record) => seen.landed.push(record),
    every: 10, forMs: 1000, now: () => clock.t,
    later: (fn) => { timers.push(fn); return timers.length; }, cancel: () => {},
    controller: () => ({ signal: { aborted: false }, abort() { this.signal.aborted = true; } }),
  });
  const json = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const step = async () => { const fn = timers.shift(); fn(); await new Promise((r) => setTimeout(r, 0)); };

  const seen = { landed: [], signals: [] };
  follow("d8b19615", opts([json({ status: "running" }), json({ status: "paused" }),
                           json({ status: "complete", report: { headline: "It rose" } })], seen));
  await step(); await step(); await step();
  assert.equal(seen.landed.length, 1, "landed once, after still-running and paused reads");
  assert.equal(seen.landed[0].report.headline, "It rose");
  assert.equal(timers.length, 0, "nothing is read after it lands");

  const gone = { landed: [], signals: [] };
  follow("x", opts([{ ok: false, status: 404 }], gone));
  await step();
  assert.equal(timers.length, 0, "a 404 — the run gone — stops the reading for good");

  const signedOut = { landed: [], signals: [] };
  follow("z", opts([{ ok: false, status: 401 }, json({ status: "complete", report: { headline: "back" } })], signedOut));
  await step();
  assert.equal(timers.length, 1, "a 401 is read again: the session may be signed into once more");
  await step();
  assert.equal(signedOut.landed.length, 1);

  const left = { landed: [], signals: [] };
  const stop = follow("y", opts([new Promise(() => {})], left));
  await step();
  stop();
  assert.equal(left.signals[0].aborted, true, "the card going aborts the read in flight");
});

test("a run handed the analysis already under way reads on as that run; one not yet named lands, saying so", async () => {
  // 2026-11-24: the card followed a run that was then handed back — the status it never knew — and said "still
  // running" for the hour, never the answer of the run it was handed.
  const { follow, landed, handedTo, isDeepRecord } = await import("../src/report.js");
  const timers = [];
  const reads = [];
  const answers = {
    b: [{ status: "running" }, { status: "handed_back", handed_to: "r2", error: "already being analysed (run r2)" }],
    r2: [{ status: "running" }, { status: "complete", report: { headline: "It rose" } }],
  };
  const json = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const seen = [];
  follow("b", {
    read: (id) => { reads.push(id); return Promise.resolve(json(answers[id].shift())); },
    onLanded: (record) => seen.push(record), every: 10, forMs: 1000, now: () => 0,
    later: (fn) => { timers.push(fn); return timers.length; }, cancel: () => {},
    controller: () => ({ signal: { aborted: false }, abort() {} }),
  });
  for (let i = 0; i < 4; i += 1) { timers.shift()(); await new Promise((r) => setTimeout(r, 0)); }
  assert.deepEqual(reads, ["b", "b", "r2", "r2"], "read on as the run it was handed");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].report.headline, "It rose");

  const unnamed = { id: "b", kind: "investigation", status: "handed_back", handed_to: "",
                    error: "This question is already being analysed, and that run is still starting" };
  assert.equal(handedTo(unnamed), "");
  assert.equal(landed(unnamed), unnamed, "nothing to read on: it lands, and says why");
  assert.equal(isDeepRecord(unnamed), true);
  const facts = reportFacts(unnamed);
  assert.equal(facts.handed, true);
  assert.equal(facts.stopped, false, "never drawn as stopped");
  assert.match(facts.why, /still starting/);
});
