// A conversation's answers as one deck (punch list 92, 2026-11-18): what the step shows of `deck_of_answers`.
import { test } from "node:test";
import assert from "node:assert/strict";

import { deckOf } from "../src/deck.js";

test("a deck made: its answers in order, the ones left out, and the download through this page's relay", () => {
  const got = deckOf(JSON.stringify({ deck: { title: "This week", format: "pptx",
    answers: [{ id: "b", question: "Returns by city" }, { id: "a", question: "Orders by city" }],
    download: "/exports/answers?ids=b%2Ca&title=This+week" }, missing: ["gone"] }));
  assert.deepEqual(got, { title: "This week", missing: ["gone"], href: "/pramanyx/exports/answers?ids=b%2Ca&title=This+week",
    answers: [{ id: "b", question: "Returns by city" }, { id: "a", question: "Orders by city" }] });
});

test("no deck: why, as the platform said it; and never a download to anywhere but the deck route", () => {
  assert.deepEqual(deckOf(JSON.stringify({ deck: null, missing: ["x"], why: "None of those answers could be read." })),
    { failed: "None of those answers could be read.", missing: ["x"] });
  assert.equal(deckOf("not json").failed, "The platform did not make it.");
  for (const download of ["https://elsewhere.example/deck", "/investigations/a/export", "/exports/answers", "//x/exports/answers?ids=a"]) {
    assert.ok(deckOf(JSON.stringify({ deck: { answers: [], download } })).failed, download);
  }
});
