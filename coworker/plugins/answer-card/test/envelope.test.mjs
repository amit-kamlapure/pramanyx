/**
 * The coworker card draws every answer from its answer envelope (the plan of record, 2026-11-27: one answer object,
 * drawn the same way everywhere; the coworker card draws it instead of re-implementing the layout).
 *
 *   node --test coworker/plugins/answer-card/test/*.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { envelopeIn, envelopeOf, gridAnswer, pathWords, sectionsOf } from "../src/envelope.js";
import { isDeepRecord, reportFacts, reportOf } from "../src/report.js";

const ENV = {
  version: 2, question: "Why did returns rise?", headline: "Returns rose to **9.2%**", body: "Mostly in footwear.",
  grid: { columns: ["category", "rate"], rows: [["footwear", 0.12]], caption: "Footwear leads" },
  chart: { chart_type: "bar", chart_config: { names: { rate: "Return rate" } } },
  caveats: ["October is partial.", "This may not be right: it counts exchanges"],
  follow_ups: ["Which brands?", " "],
  figures: [{ label: "Return rate", value: "9.2%", note: "Oct" }, { label: "Empty", value: "", note: "" }],
  exhibits: [
    { claim: "Footwear leads the rise", grid: { columns: ["category", "rate"], rows: [["footwear", 0.12], ["bags", 0.05]], caption: "" },
      chart: { chart_type: "bar", chart_config: {} }, caveats: ["Bags is a new line.", "October is partial."] },
    { claim: "A result with no rows is not drawn", grid: { columns: ["x"], rows: [] }, chart: {}, caveats: [] },
  ],
  gaps: "Whether exchanges count as returns.",
  provenance: { investigation_id: "inv7", receipt_id: "rc7", connection_id: "c1", sql: ["SELECT 1", ""],
                tables_used: ["orders"], path: { kind: "diagnose", depth: "deep", engine: "analyst", why: "a why" } },
  error: "",
};

test("the envelope is read off the tool's result, or off the report a run read back was filed with", () => {
  assert.equal(envelopeOf({ answer: "x", envelope: ENV }), ENV);
  assert.equal(envelopeOf({ id: "inv7", report: { headline: "h", envelope: ENV } }), ENV);
  assert.equal(envelopeOf({ answer: "x", envelope: null }), null, "an older platform: none, so the card draws as it did");
  assert.equal(envelopeOf({ envelope: { headline: "", body: "", error: "", exhibits: [] } }), null, "one that says nothing is none");
  assert.equal(envelopeOf(null), null);
});

test("a result cut short in its report still carries its envelope, which the tool put ahead of it", () => {
  const whole = JSON.stringify({ question: "Why?", connection: "c1", investigation_id: "inv7", status: "complete",
                                 envelope: { ...ENV, body: "A brace } in a string, and a \"quote\"." },
                                 report: { headline: "h", phases: [{ findings: [{ sql: "SELECT 1" }] }] } }, null, 2);
  const cut = whole.slice(0, whole.indexOf('"phases"'));
  assert.equal(envelopeIn(cut).body, "A brace } in a string, and a \"quote\".");
  const got = reportOf(cut);
  assert.equal(got.cut, true);
  assert.equal(envelopeOf(got).headline, ENV.headline);
  // cut inside the envelope itself: nothing is guessed
  assert.equal(envelopeIn(whole.slice(0, whole.indexOf('"follow_ups"'))), null);
  assert.equal(envelopeIn('{"envelope": null, "report": {}}'), null);
});

test("how it was answered reads in the receipt's words", () => {
  assert.equal(pathWords({ kind: "survey", engine: "analyst", depth: "deep" }), "An open question · the analyst · deep");
  assert.equal(pathWords({ kind: "describe", engine: "quick core", depth: "quick" }), "A figure · the quick answer · quick");
  assert.equal(pathWords({ kind: "diagnose", engine: "converse" }), "A why · the conversation");
  assert.equal(pathWords({ kind: "check" }), "A check");
  assert.equal(pathWords({ kind: "new", engine: "later engine" }), "new · later engine", "a word not known is said as spelled");
  assert.equal(pathWords({}), "");
  assert.equal(pathWords(undefined), "");
});

test("the sections are the envelope's, each once, in the card's order", () => {
  const s = sectionsOf(ENV, { said: ["This may not be right: it counts exchanges"], extra: { investigation_id: "inv7" } });
  assert.equal(s.headline, "Returns rose to **9.2%**");
  assert.equal(s.body, "Mostly in footwear.");
  assert.deepEqual(s.figures, [{ label: "Return rate", value: "9.2%", note: "Oct" }], "a figure with no value is not drawn");
  assert.equal(s.exhibits.length, 1, "a cited result with no rows is left out");
  assert.equal(s.exhibits[0].claim, "Footwear leads the rise");
  assert.deepEqual(s.exhibits[0].answer.rows, [["footwear", 0.12], ["bags", 0.05]]);
  assert.equal(s.exhibits[0].answer.investigation_id, "inv7");
  assert.equal(s.grid, null, "with exhibits, the grid (the first exhibit, for a door that takes one) is not drawn twice");
  assert.deepEqual(s.caveats, ["October is partial.", "Bags is a new line."],
                   "each caveat once, an exhibit's too, and none the card already said under the headline");
  assert.equal(s.gaps, "Whether exchanges count as returns.");
  assert.equal(s.path, "A why · the analyst · deep");
  assert.equal(s.why, "a why");
  assert.deepEqual(s.followUps, ["Which brands?"]);
  assert.deepEqual(s.sql, ["SELECT 1"]);
  assert.equal(s.investigationId, "inv7");
  assert.equal(s.receiptId, "rc7");
});

test("a quick answer's own grid is drawn when it cites no exhibit, saying how many rows it had", () => {
  const s = sectionsOf({ ...ENV, exhibits: [], grid: { columns: ["n"], rows: [[1], [2]], caption: "", row_count: 500 } });
  assert.deepEqual(s.grid.rows, [[1], [2]]);
  assert.equal(s.grid.row_count, 500, "the envelope was capped on its way; the count says the rest exist");
  assert.equal(s.grid.chart_type, "bar");
  assert.deepEqual(s.grid.chart_config, { names: { rate: "Return rate" } });
  assert.equal(gridAnswer({ columns: ["n"], rows: [] }, null), null);
  assert.equal(gridAnswer({ columns: ["n"], rows: [[3]] }, null).row_count, 1);
});

test("an exploration and a finding's dossier read back are deep analyses, drawn as their report (2026-11-27)", () => {
  const explore = { id: "inv3", kind: "investigation", status: "complete", connection_id: "c1",
                    report: { _report_type: "explore", headline: "Three things stand out", conclusion: "Footwear leads.",
                              recommended_actions: ["Look at footwear"], subq_answers: [{ sql: "SELECT 1" }, { sql: "" }] } };
  assert.equal(isDeepRecord(explore), true);
  const f = reportFacts(explore);
  assert.equal(f.head, "Three things stand out");
  assert.equal(f.summary, "Footwear leads.");
  assert.deepEqual(f.recs, ["Look at footwear"]);
  assert.equal(f.sources, 1);
  const dossier = { investigation_id: "f1", report_kind: "dossier",
                    report: { dossier_version: 1, finding: "Footwear returns doubled", rationale: "Since the new supplier.", sql: "SELECT 2" } };
  assert.equal(isDeepRecord(dossier), true);
  assert.equal(reportFacts(dossier).head, "Footwear returns doubled");
  assert.equal(reportFacts(dossier).summary, "Since the new supplier.");
  assert.equal(reportFacts(dossier).sources, 1);
  assert.equal(isDeepRecord({ id: "inv9", kind: "investigation", report: { headline: "h", envelope: ENV } }), true);
  // a quick answer is not: by its kind, or with no kind and no phases
  assert.equal(isDeepRecord({ id: "q1", kind: "chat", report: { headline: "42", phases: [] } }), false);
  assert.equal(isDeepRecord({ id: "q1", report: { headline: "42 rows", rows: [[42]] } }), false);
});
