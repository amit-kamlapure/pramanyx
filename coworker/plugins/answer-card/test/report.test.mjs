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
