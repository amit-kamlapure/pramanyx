// A file the person attaches becomes their own sheet; a conversation held to another connection may then ask the
// Sheets connection, and nothing else of anyone's (2026-11-17).
import { test } from "node:test";
import assert from "node:assert/strict";

import { openedBy, refusalFor } from "../lib/index.js";

const ASK = "mcp__pramanyx__ask";
const BRING = "mcp__pramanyx__bring_in_file";

test("a brought-in sheet opens the Sheets connection to its conversation", () => {
  assert.deepEqual(openedBy(BRING, JSON.stringify({ brought_in: true, kind: "sheet", connection: "sheets", sheets: [] })), ["sheets"]);
  assert.deepEqual(openedBy(BRING, JSON.stringify({ brought_in: true, kind: "document" })), []);
  assert.deepEqual(openedBy(BRING, JSON.stringify({ brought_in: false, why: "no" })), []);
  assert.deepEqual(openedBy(BRING, "not json"), []);
  assert.deepEqual(openedBy(ASK, JSON.stringify({ brought_in: true, kind: "sheet", connection: "sheets" })), []);
});

test("a held conversation asks its own sheet, and still no other connection", () => {
  assert.match(refusalFor(ASK, { connection: "sheets", question: "x" }, "8233e4fd"), /held to the connection/);
  assert.equal(refusalFor(ASK, { connection: "sheets", question: "x" }, "8233e4fd", ["sheets"]), undefined);
  assert.match(refusalFor(ASK, { connection: "dcc63d83", question: "x" }, "8233e4fd", ["sheets"]), /cannot read `dcc63d83`/);
  assert.equal(refusalFor(BRING, { path: "/x" }, "8233e4fd"), undefined);
});
