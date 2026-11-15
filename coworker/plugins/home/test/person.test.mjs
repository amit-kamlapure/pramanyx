/**
 * The person the coworker acts for (People, 2026-11-15), against a stand-in for Pramanyx.
 *
 *   node --test coworker/plugins/home/test/ coworker/plugins/answer-card/test/
 *
 * Held: a delegation the app hands over is checked with Pramanyx before it is kept; it is kept in one file only this
 * account reads; a page on another site cannot hand one over; and what a person says on a card goes on with it.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const GOOD = "a".repeat(43);
let pramanyx, shell, heard, file;
const listen = (server) => new Promise((done) => server.listen(0, "127.0.0.1", () => done(server.address().port)));

before(async () => {
  heard = [];
  pramanyx = http.createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    heard.push({ path: req.url, person: req.headers["x-pramanyx-delegation"] || "" });
    if (req.url === "/auth/delegation") {
      const ok = req.headers["x-pramanyx-delegation"] === GOOD;
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
      return res.end(JSON.stringify(ok ? { user_id: "ana@example.com", org_id: "default" } : { detail: "no" }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  process.env.PRAMANYX_API_URL = `http://127.0.0.1:${await listen(pramanyx)}`;
  file = join(await mkdtemp(join(tmpdir(), "cw-person-")), "delegation");
  process.env.PRAMANYX_DELEGATION_FILE = file;
  const routes = new Map();
  const ctx = {
    effect: (make) => make(),
    webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path); } },
    workspaceRegistry: { list: () => [], create: async () => ({}) },
  };
  // The route as `apply` registers it; the rest of `apply` needs the real shell.
  const { keepThePerson } = await import("../lib/index.js");
  routes.set("/pramanyx-person", { path: "/pramanyx-person", handler: (req, res) => keepThePerson(req, res, process.env.PRAMANYX_API_URL) });
  (await import("../../answer-card/lib/index.js")).apply(ctx);
  shell = http.createServer((req, res) => {
    const route = routes.get(req.url);
    return route ? route.handler(req, res) : (res.writeHead(404), res.end());
  });
  shell.port = await listen(shell);
});

after(() => { pramanyx.close(); shell.close(); });

const post = (path, body, headers = {}) => fetch(`http://127.0.0.1:${shell.port}${path}`, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});

test("a delegation Pramanyx does not recognise is not kept", async () => {
  const answer = await post("/pramanyx-person", { d: "b".repeat(43) });
  assert.equal(answer.status, 401);
  await assert.rejects(stat(file));
});

test("a page on another site cannot hand the coworker a person", async () => {
  const answer = await post("/pramanyx-person", { d: GOOD }, { "sec-fetch-site": "cross-site" });
  assert.equal(answer.status, 403);
});

test("a recognised delegation is kept where only this account reads it, and rides with what the person says", async () => {
  const answer = await post("/pramanyx-person", { d: GOOD });
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), { user_id: "ana@example.com" });
  assert.equal(await readFile(file, "utf8"), GOOD);
  assert.equal((await stat(file)).mode & 0o077, 0);
  heard.length = 0;
  await post("/pramanyx-feedback", { connection: "conn-1", answer: "answer-1", verdict: "helpful" });
  assert.deepEqual(heard, [{ path: "/chat/feedback", person: GOOD }]);
});

test("the page may read what was sent from a draft, and nothing else of email", async () => {
  const { READS } = await import("../lib/index.js");
  const relayed = (path) => READS.some((allowed) => allowed.test(path));
  assert.ok(relayed("/email/sent"));
  assert.ok(!relayed("/email/send") && !relayed("/email/sent/other") && !relayed("/email"));
});
