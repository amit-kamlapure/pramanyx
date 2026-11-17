// The person's own Drive, searched from the conversation (punch list 91, 2026-11-18): what the step shows.
import { test } from "node:test";
import assert from "node:assert/strict";

import { driveFilesOf, kindOf } from "../src/drive.js";

test("files by name, as a person says their type, each linked only to Google's own pages", () => {
  const got = driveFilesOf(JSON.stringify({ searched: true, words: "budget", files: [
    { name: "Q3 budget", type: "application/vnd.google-apps.spreadsheet", modified: "2026-11-01T10:00:00Z", link: "https://docs.google.com/spreadsheets/d/x" },
    { name: "budget.pdf", type: "application/pdf", modified: "2026-10-02T09:00:00Z", link: "https://elsewhere.example/budget.pdf" }] }));
  assert.deepEqual(got.files, [
    { name: "Q3 budget", type: "Sheet", modified: "2026-11-01", link: "https://docs.google.com/spreadsheets/d/x" },
    { name: "budget.pdf", type: "PDF", modified: "2026-10-02", link: "" }]);
});

test("nothing searched says why, in the platform's words", () => {
  assert.deepEqual(driveFilesOf(JSON.stringify({ searched: false, files: [], why: "Google is not connected for you." })),
    { failed: "Google is not connected for you." });
  assert.equal(driveFilesOf("nope").failed, "Drive was not searched.");
  assert.equal(kindOf("application/vnd.openxmlformats-officedocument.presentationml.presentation"), "Presentation");
  assert.equal(kindOf("text/plain"), "");
});
