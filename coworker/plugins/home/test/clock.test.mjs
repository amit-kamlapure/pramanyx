/**
 * The person's clock (2026-11-17: one definition of "yesterday" for the coworker and the platform).
 *
 *   node --test coworker/plugins/home/test/
 *
 * Held: the coworker's page says which zone its browser is in, and the host keeps it — only a zone, only from this
 * page — where the MCP server and the relays read it on every call.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { keepTheClock, readableZone } from "../lib/index.js";

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((done) => server.close(done)) };
}

test("a zone is one the runtime can read, and nothing else", () => {
  assert.equal(readableZone("Asia/Calcutta"), "Asia/Calcutta");
  assert.equal(readableZone(" Europe/London "), "Europe/London");
  assert.equal(readableZone("Mars/Olympus"), "");
  assert.equal(readableZone(""), "");
  assert.equal(readableZone("x".repeat(80)), "");
});

test("the page's zone is kept in one file this account reads; another site cannot say it; nonsense is refused", async () => {
  const home = await mkdtemp(join(tmpdir(), "pramanyx-clock-"));
  const file = join(home, "clock");
  process.env.PRAMANYX_CLOCK_FILE = file;
  const coworker = await serve((req, res) => keepTheClock(req, res));
  try {
    const say = (body, headers = {}) => fetch(coworker.url, { method: "POST", headers: { "content-type": "application/json", ...headers },
                                                            body: JSON.stringify(body) });
    assert.equal((await say({ zone: "Asia/Calcutta" })).status, 200);
    assert.equal(await readFile(file, "utf8"), "Asia/Calcutta");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await say({ zone: "Mars/Olympus" })).status, 422);
    assert.equal((await say({ zone: "Europe/London" }, { "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal(await readFile(file, "utf8"), "Asia/Calcutta");        // neither changed it
    assert.equal((await fetch(coworker.url)).status, 405);
  } finally {
    await coworker.close();
    delete process.env.PRAMANYX_CLOCK_FILE;
  }
});
