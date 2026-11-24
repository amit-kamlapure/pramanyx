/**
 * Discover in the coworker (D6, 2026-11-24): the page's address, and which messages from it begin a question.
 *
 *   node --test coworker/plugins/home/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { askedAbout, discoverAddress } from "../src/discover.js";

const APP = "http://localhost:3000";

test("the page opens in this page's light or dark, told which shell may be asked", () => {
  assert.equal(discoverAddress(APP, "dark", "http://localhost:3090"), `${APP}/discover?theme=dark&shell=http%3A%2F%2Flocalhost%3A3090`);
  assert.equal(discoverAddress(APP, "sepia", "http://localhost:3090"), `${APP}/discover?theme=light&shell=http%3A%2F%2Flocalhost%3A3090`);
});

test("a row's question from the app is begun, with the connection it is about", () => {
  const event = { origin: APP, data: { type: "pramanyx:ask-about", text: "About the table “orders” on theLook:", connection: "8233e4fd" } };
  assert.deepEqual(askedAbout(event, APP), { text: "About the table “orders” on theLook: ", connection: "8233e4fd" });
});

test("anything else is not a question: another origin, another type, nothing said, too long, a connection that is no id", () => {
  const data = { type: "pramanyx:ask-about", text: "About the table orders:", connection: "8233e4fd" };
  assert.equal(askedAbout({ origin: "http://evil.example", data }, APP), null);
  assert.equal(askedAbout({ origin: APP, data: { ...data, type: "pramanyx:theme" } }, APP), null);
  assert.equal(askedAbout({ origin: APP, data: { ...data, text: "  " } }, APP), null);
  assert.equal(askedAbout({ origin: APP, data: { ...data, text: "x".repeat(401) } }, APP), null);
  assert.equal(askedAbout({ origin: APP, data: { ...data, connection: "../etc" } }, APP).connection, "");
  assert.equal(askedAbout(null, APP), null);
});
