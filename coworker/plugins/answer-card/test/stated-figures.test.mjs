/**
 * A one-row answer draws no box, and only the figures its words leave out (the user, 2026-11-20: "Do you think its
 * neccessary to have a block for a single figure?"). The rule is the platform's own, read from web/.
 *
 *   node --test coworker/plugins/answer-card/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { unstatedFigures } from "../../../../web/lib/statedFigures.ts";

test("a count the headline states is not drawn again", () => {
  assert.deepEqual(unstatedFigures(["row_count"], [8807], "Netflix titles sheet contains 8,807 rows"), []);
  assert.deepEqual(unstatedFigures(["row_count"], [99441], "olist_orders contains 99,441 rows"), []);
});

test("a figure the headline leaves out is still shown, and only that one", () => {
  assert.deepEqual(unstatedFigures(["row_count"], [8807], "The Netflix titles sheet has been counted"), [0]);
  assert.deepEqual(unstatedFigures(["orders", "revenue"], [125303, 10827640.12], "There were 125,303 orders"), [1]);
});

test("a figure rounded the way a writer rounds it counts as stated", () => {
  assert.deepEqual(unstatedFigures(["revenue"], [10827640.12], "Revenue was $10.8M"), []);
});
