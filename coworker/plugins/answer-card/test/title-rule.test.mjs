/**
 * The coworker's card leads with the platform's own title rule (`web/lib/answerTitle.ts`; the user, 2026-11-23: "Is
 * there a logic of what text should be bold & highlight?", of a card whose bold headline ran on into "— caution: …").
 *
 *   node --test coworker/plugins/answer-card/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { boldable, titleOf } from "../../../../web/lib/answerTitle.ts";

test("a caution written onto an answer is said apart from its headline", () => {
  const got = titleOf("Cancelled orders total 12,345 — caution: this total multiplies a measure by an id/key column, so the magnitude is not trustworthy.");
  assert.equal(got.title, "Cancelled orders total 12,345");
  assert.deepEqual(got.cautions, ["This total multiplies a measure by an id/key column, so the magnitude is not trustworthy."]);
});

test("an agent's markdown answer keeps its first line as the headline and the rest as written", () => {
  const got = titleOf("**Shipped** leads with **38,107** orders.\n\n- Complete: 31,021");
  assert.equal(got.title, "Shipped leads with 38,107 orders.");
  assert.equal(got.rest, "- Complete: 31,021");
});

test("a sentence set bold reads as text; a figure stays bold", () => {
  assert.equal(boldable("38,107"), true);
  assert.equal(boldable("Shipped orders are the largest group by a wide margin this year"), false);
});
