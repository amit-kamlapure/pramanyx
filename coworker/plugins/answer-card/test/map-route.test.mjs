/**
 * The answer card's map files and the organisation's base map, against a stand-in for Pramanyx.
 *
 *   node --test coworker/plugins/answer-card/test/
 *
 * What is held: the page gets MapLibre, its worker, its stylesheet and the install's shapes from a fixed list, by GET
 * only, and nothing a caller names is read from disk; the base map is the organisation's answer, asked as the person.
 * The map files are the ones `build.sh` copies; a test run before a build is told so, and skips them.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import http from "node:http";
import { after, before, test } from "node:test";

let pramanyx, shell, heard;
const listen = (server) => new Promise((done) => server.listen(0, "127.0.0.1", () => done(server.address().port)));
const built = existsSync(new URL("../lib/map/maplibre-gl.mjs", import.meta.url));

before(async () => {
  heard = [];
  pramanyx = http.createServer((req, res) => {
    heard.push({ path: req.url, method: req.method });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ kind: "none", light: "", dark: "", says: "No base map." }));
  });
  process.env.PRAMANYX_API_URL = `http://127.0.0.1:${await listen(pramanyx)}`;
  const { apply } = await import("../lib/index.js");
  const routes = [];
  apply({ effect: (make) => make(), webServer: { register: (route) => { routes.push(route); return () => {}; } } });
  // The shell's own matching: exact first, then the longest prefix (`dsh-host-webserver`).
  shell = http.createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const route = routes.find((r) => r.kind === "exact" && r.path === path)
      ?? routes.filter((r) => r.kind === "prefix" && (path === r.path || path.startsWith(`${r.path}/`)))
               .sort((a, b) => b.path.length - a.path.length)[0];
    return route ? route.handler(req, res) : (res.writeHead(404), res.end());
  });
  shell.port = await listen(shell);
});

after(() => { pramanyx.close(); shell.close(); });

const get = (path, method = "GET") => fetch(`http://127.0.0.1:${shell.port}${path}`, { method });

test("the base map is the organisation's answer, read from Pramanyx", async () => {
  heard.length = 0;
  const answer = await get("/pramanyx-map/base");
  assert.equal(answer.status, 200);
  assert.equal((await answer.json()).kind, "none");
  assert.deepEqual(heard, [{ path: "/org-settings/base-map", method: "GET" }]);
});

test("MapLibre, its worker and the shapes are served from the fixed list", { skip: built ? false : "run coworker/build.sh first" }, async () => {
  for (const [path, type] of [
    ["/pramanyx-map/maplibre-gl.mjs", "text/javascript"],
    ["/pramanyx-map/maplibre-gl-worker.mjs?v=6.16.0", "text/javascript"],
    ["/pramanyx-map/maplibre-gl.css", "text/css"],
    ["/pramanyx-map/shapes/countries.json", "application/json"],
    ["/pramanyx-map/shapes/us_states.json", "application/json"],
  ]) {
    const answer = await get(path);
    assert.equal(answer.status, 200, path);
    assert.ok(answer.headers.get("content-type").startsWith(type), path);
    await answer.arrayBuffer();
  }
  const states = await (await get("/pramanyx-map/shapes/us_states.json")).json();
  assert.equal(states.features.length, 56);
});

test("nothing a caller names is read from disk", async () => {
  for (const path of ["/pramanyx-map/../index.js", "/pramanyx-map/%2e%2e/index.js", "/pramanyx-map/map/world.json",
                      "/pramanyx-map/shapes/../../index.js", "/pramanyx-map/shapes/india.json", "/pramanyx-map/"]) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test("only GET and HEAD reach a map file", async () => {
  assert.equal((await get("/pramanyx-map/maplibre-gl.css", "POST")).status, 405);
  assert.equal((await get("/pramanyx-map/base", "DELETE")).status, 405);
});
