// One record for both places (2026-11-20): the conversations of the platform's this coworker lists.
import { test } from "node:test";
import assert from "node:assert/strict";

import { inTheApp, withOthers } from "../src/threads.js";

const ROWS = [
  { session_id: "siao31vmhenb1eca3amgc", title: "Give the line a neon glow", turns: 2 },
  { session_id: "coworker:session-77aa11bb", title: "How many orders were delivered?", turns: 1 },
  { session_id: "grp1", title: "Weekly sales review", shared: true, owner: "bo", members: ["ana"] },
];

test("the person's own conversations in the app are listed, and not this coworker's own nor those with others", () => {
  assert.deepEqual(inTheApp(ROWS).map((t) => t.session_id), ["siao31vmhenb1eca3amgc"]);
  assert.deepEqual(withOthers(ROWS).map((t) => t.session_id), ["grp1"]);
  assert.deepEqual(inTheApp(null), []);
});
