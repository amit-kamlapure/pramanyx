// A step says a thing was done only once it was (2026-11-18): not while it waits on Allow once, not after a No.
import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { abilitiesOf, ASKED_FIRST, mayGoAhead, NO_STANDS } from "../../home/lib/index.js";
import { ABOUT_TO, DOES, PREFIX, STAGED, saidOf, turnedDown } from "../src/steps.js";

// the platform's rows (`GET /abilities`), as the home plugin's snapshot of them
const ROWS = abilitiesOf(JSON.parse(readFileSync(new URL("../../home/test/abilities.fixture.json", import.meta.url), "utf8")));

test("waiting on a person's answer, a step says what it is about to do; done, what it did", () => {
  const args = { text: "I like bars sorted largest first." };
  assert.equal(saidOf(`${PREFIX}remember_for_me`, args, false), "Remember for you: I like bars sorted largest first.");
  assert.equal(saidOf(`${PREFIX}remember_for_me`, args, true), "Remembered for you: I like bars sorted largest first.");
  assert.equal(saidOf(`${PREFIX}forget_for_me`, {}, false), "Forget one thing you asked me to remember");
  assert.equal(saidOf(`${PREFIX}schedule`, { request: "every Monday" }, false), "Set up a schedule: every Monday");
});

test("every named tool the coworker must ask about has words for before it is done", () => {
  const asked = Object.keys(DOES).filter((name) => !mayGoAhead(`${PREFIX}${name}`, new Set(), ROWS));
  assert.ok(asked.includes("remember_for_me"), "the population is the tools that ask");
  assert.deepEqual(asked.filter((name) => !ABOUT_TO[name]), []);
});

test("a change the platform stages is drawn as its card, and says what it is about to do while it is staged", () => {
  assert.ok(STAGED.has("draft_monitor") && !STAGED.has("remember_for_me"));
  for (const name of STAGED) {
    assert.equal(mayGoAhead(`${PREFIX}${name}`, new Set(), ROWS), true, `${name} goes ahead to its card`);
    assert.ok(ABOUT_TO[name] && DOES[name], name);
  }
});

test("every tool that asks first has its own row, so the question stands under it from the first call", () => {
  assert.deepEqual(Object.keys(ASKED_FIRST).filter((name) => !DOES[name] || !ABOUT_TO[name]), []);
});

test("a person's answer is told from a failure, in each of the harness's own sentences", () => {
  assert.equal(turnedDown('Error: the user rejected tool "mcp__pramanyx__remember_for_me"'), "you said no");
  assert.equal(turnedDown('approval for tool "mcp__pramanyx__schedule" was cancelled'), "not answered");
  assert.equal(turnedDown('tool "mcp__pramanyx__schedule" requires approval, but no approval channel is available'), "could not be asked");
  assert.equal(turnedDown(`Error: ${NO_STANDS}`), "you said no");
  assert.equal(turnedDown("The warehouse did not answer."), null);
  assert.equal(turnedDown(""), null);
});
