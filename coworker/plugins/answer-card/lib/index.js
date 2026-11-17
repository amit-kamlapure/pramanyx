/**
 * The host half: the one thing the answer card writes — what a person said about an answer.
 *
 * "Right" and "Wrong" on a card go to Pramanyx exactly as the app's own control sends them: `/chat/feedback` for
 * the judgement, and `/verify/verdict` for what was wrong and, when a person gives one, the corrected SQL. Pramanyx
 * is another origin to the page, so the page asks its own server and the server asks Pramanyx.
 *
 * These are the only writes the coworker's page can make, so the route is narrow on purpose:
 *
 * - POST only, JSON only, and only from this page. A request a browser marks as coming from another site is
 *   refused: without that, any page open in the same browser could record a verdict in a person's name.
 * - The body sent on is rebuilt from the fields below, each checked — nothing a caller adds rides along.
 * - Two fixed destinations. No path, header or query of the caller's reaches Pramanyx.
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MOST = 32 * 1024;

const text = (value, most) => (typeof value === "string" ? value.slice(0, most) : "");

/** What each kind of saying sends on, or null when what was given is not that. */
const SAYINGS = {
  "/pramanyx-feedback": {
    to: "/chat/feedback",
    body: (said) => (ID.test(said.connection) && ID.test(said.answer) && ["helpful", "unhelpful"].includes(said.verdict)
      ? { conn_id: said.connection, turn_id: said.answer, verdict: said.verdict, note: text(said.note, 2000) } : null),
  },
  // 2026-11-15 — an email a person wrote here, sent on their click (`pramanyx/routers/email.py`). One address; the
  // words as they left the page. Pramanyx refuses an agent at that door; this route is reached only from this page.
  "/pramanyx-email": {
    to: "/email/send",
    most: 256 * 1024,                  // an email carries a table's worth of text; a verdict never needs this much
    body: (said) => (typeof said.to === "string" && /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(said.to.trim())
                     && typeof said.body === "string" && said.body.trim()
      ? { to: said.to.trim().slice(0, 320), subject: text(said.subject, 300), body: text(said.body, 100000),
          // The analysis to attach, when the person chose one: an answer's id and one of the four export formats.
          ...(ID.test(said.attach_answer || "") && ["pdf", "xlsx", "docx", "pptx"].includes(said.attach_format)
            ? { attach_answer: said.attach_answer, attach_format: said.attach_format } : {}),
          // The draft's own name, so its send is journaled under it and the draft reads as sent after a reload.
          ...(typeof said.draft === "string" && /^[A-Za-z0-9:_.-]{1,80}$/.test(said.draft) ? { draft: said.draft } : {}) } : null),
  },
  "/pramanyx-verdict": {
    to: "/verify/verdict",
    body: (said) => (ID.test(said.connection) && ID.test(said.answer) && ["correct", "reject"].includes(said.verdict)
      ? { connection_id: said.connection, investigation_id: said.answer, verdict: said.verdict,
          note: text(said.note, 2000), headline: text(said.headline, 300),
          sql_source: text(said.sql, 20000), corrected_sql: text(said.corrected_sql, 20000) } : null),
  },
};

function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function read(req, most = MOST) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > most) return null;
    parts.push(part);
  }
  return Buffer.concat(parts).toString("utf8");
}

/** The person the app handed this coworker (`home`'s keepThePerson), presented with what they said, so Pramanyx
 *  records it under them. "" when none was handed over: then it is recorded as the install's operator, as before. */
async function personHeader() {
  const file = process.env.PRAMANYX_DELEGATION_FILE || "";
  if (!file) return {};
  try {
    const { readFile } = await import("node:fs/promises");
    const token = (await readFile(file, "utf8")).trim();
    return /^[A-Za-z0-9_-]{20,128}$/.test(token) ? { "x-pramanyx-delegation": token } : {};
  } catch {
    return {};
  }
}

/**
 * 2026-11-17 — the map in the card. A map answer is drawn by MapLibre in the page from the answer's own rows; the
 * page asks this server for MapLibre and its worker, for the shapes the install ships, and for the organisation's
 * base map. Only these files, read from `lib/map/` where `build.sh` puts them, and only by GET: nothing a caller
 * names is read from disk.
 */
const MAP = "/pramanyx-map";
const MAP_FILES = {
  "/maplibre-gl.mjs": ["maplibre-gl.mjs", "text/javascript; charset=utf-8"],
  "/maplibre-gl-worker.mjs": ["maplibre-gl-worker.mjs", "text/javascript; charset=utf-8"],
  "/maplibre-gl.css": ["maplibre-gl.css", "text/css; charset=utf-8"],
  "/shapes/countries.json": ["world.json", "application/json"],
  "/shapes/us_states.json": ["us-states.json", "application/json"],
};

/** The file a map path names, or null. Exported for the test. */
export function mapFileFor(pathname) {
  if (!pathname.startsWith(MAP + "/")) return null;
  return Object.prototype.hasOwnProperty.call(MAP_FILES, pathname.slice(MAP.length)) ? MAP_FILES[pathname.slice(MAP.length)] : null;
}

async function serveMap(req, res, api) {
  if (req.method !== "GET" && req.method !== "HEAD") return reply(res, 405, { detail: "GET only" });
  const pathname = new URL(req.url || "/", "http://x").pathname;
  if (pathname === `${MAP}/base`) {
    // The organisation's choice, as the person reads it. It names no secret: every viewer's browser fetches the style.
    try {
      const answer = await fetch(api + "/org-settings/base-map", { headers: { accept: "application/json", ...(await personHeader()) } });
      const kept = await answer.text();
      res.writeHead(answer.status, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(kept);
    } catch {
      return reply(res, 502, { detail: "The platform is not answering" });
    }
  }
  const file = mapFileFor(pathname);
  if (!file) return reply(res, 404, { detail: "Not a map file" });
  try {
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(new URL(`./map/${file[0]}`, import.meta.url));
    res.writeHead(200, { "content-type": file[1], "cache-control": "public, max-age=3600" });
    return res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    return reply(res, 404, { detail: "The map files are not built — run coworker/build.sh" });
  }
}

export const inject = ["webServer"];

export function apply(ctx) {
  const api = (process.env.PRAMANYX_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: MAP, handler: (req, res) => serveMap(req, res, api) }),
             `pramanyx-answer-card: ${MAP}`);
  for (const [path, saying] of Object.entries(SAYINGS)) {
    ctx.effect(() => ctx.webServer.register({
      kind: "exact",
      path,
      handler: async (req, res) => {
        if (req.method !== "POST") return reply(res, 405, { detail: "POST only" });
        const from = req.headers["sec-fetch-site"];
        if (from && from !== "same-origin") return reply(res, 403, { detail: "Only this page may say this" });
        if (!String(req.headers["content-type"] || "").startsWith("application/json")) return reply(res, 415, { detail: "JSON only" });
        const raw = await read(req, saying.most || MOST);
        if (raw === null) return reply(res, 413, { detail: "Too long" });
        let said;
        try { said = JSON.parse(raw); } catch { said = null; }
        const body = said && typeof said === "object" ? saying.body(said) : null;
        if (!body) return reply(res, 422, { detail: "Not something this route records" });
        try {
          const answer = await fetch(api + saying.to, {
            method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...(await personHeader()) },
            body: JSON.stringify(body),
          });
          const kept = await answer.text();
          res.writeHead(answer.status, { "content-type": answer.headers.get("content-type") || "application/json", "cache-control": "no-store" });
          return res.end(kept);
        } catch {
          return reply(res, 502, { detail: "The platform is not answering" });
        }
      },
    }), `pramanyx-answer-card: ${path}`);
  }
}
