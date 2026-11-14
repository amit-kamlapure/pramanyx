/**
 * The host half. Three things the page cannot do for itself: read Pramanyx, tell the agent which connection a
 * conversation is about, and say to Pramanyx where the coworker is.
 *
 * A READ-ONLY RELAY from the coworker's page to the Pramanyx API.
 *
 * The page is served by the shell and Pramanyx by its own API, on another port — another origin to a browser. The
 * API's list of allowed origins is an operator's setting and is left alone; the page asks its own server, and the
 * server asks Pramanyx. Only what the first screen reads is relayed: a path that is not on the list below is
 * answered 404 here and never reaches the API. The shell hands a `resource` route GET and HEAD only, so nothing
 * relayed can write.
 */
const READS = [
  /^\/connections$/,          // which databases there are, to say whose questions these are
  /^\/suggestions$/,          // starter questions for one connection (cached; a first read may cost a model call)
  /^\/agents\/custom$/,       // a person's own agents
  /^\/investigations$/,       // recent questions
  /^\/sheets$/,               // the sheets by name, so an answer that read one can open it
];

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * ONE WORKSPACE PER CONNECTION. The shell files a conversation under a workspace — a folder — and gives its agent
 * the `AGENTS.md` it finds there before the first question. So each Pramanyx connection gets a folder whose
 * `AGENTS.md` names that connection, and a workspace over it titled with the connection's name. Choosing where a
 * conversation happens, in the shell's own picker above the question box, is then choosing the connection, and the
 * agent is told it in its instructions and not in the person's question.
 *
 * Run at start. A connection added later appears on the next start; one that was removed keeps its workspace, and
 * the conversations in it, and Pramanyx answers that it no longer exists.
 */
async function workspacePerConnection(ctx, api) {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  const answer = await fetch(`${api}/connections`, { headers: { accept: "application/json" } });
  if (!answer.ok) throw new Error(`connections: ${answer.status}`);
  for (const connection of await answer.json()) {
    const id = String(connection.id || "");
    if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;          // an id becomes a folder name: nothing else is let through
    const name = String(connection.name || id);
    const folder = join(home, "connections", id);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "AGENTS.md"), [
      `# ${name}`,
      "",
      `This conversation is about the connection "${name}". Its connection id is \`${id}\`.`,
      `Use \`${id}\` as the connection for every question, read and analysis in this conversation, unless the person names`,
      "another connection themselves.",
      "",
    ].join("\n"));
    const known = await ctx.workspaceRegistry.resolveByPath(folder);
    if (!known) await ctx.workspaceRegistry.create(folder, name);
    else if (known.title !== name) await known.setTitle(name);
  }
}

/**
 * SAYING WHERE THIS IS. The app leads here from the nine dots in its top bar, and for that Pramanyx has to know a
 * coworker is running and the address to open. The address is the one the shell prints for a person at start,
 * with the shell's own access in it. It is said to the API at start and every half minute after; the API forgets
 * it two minutes after the last time, so a coworker that has stopped is not offered.
 *
 * The API hands that address to the app's page. On this machine that is the same reach the address printed in the
 * terminal has; an install that serves the app to other machines must decide who may be given it first.
 */
function sayWhereThisIs(ctx, api) {
  ctx.inject(["webApp", "connection"], (at) => {
    const say = async () => {
      try {
        const url = String(at.connection.authenticatedUrl(at.webApp.getAdvertisedUrl()));
        await fetch(`${api}/coworker/address`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
        });
      } catch {
        // Pramanyx is not answering, or is older than this route: the app draws no way in, and this tries again.
      }
    };
    say();
    const again = setInterval(say, 30_000);
    again.unref?.();
    at.effect(() => () => clearInterval(again), "pramanyx-home: saying where the coworker is");
  });
}

/**
 * THE WAY IN FROM THE APP. The shell signs a person in with a cookie a browser will not send on an arrival from
 * another site — and the app, on its own address, is another site. Opened straight from the app, the shell's
 * address answered "authentication required". So the app opens this page instead: it is on the coworker's own
 * address, and what it does next — going to the shell's address with the shell's access — is then a move within
 * one site, which the cookie survives. The access and what the app carries arrive in the fragment, which is never
 * sent to a server; this page reads them and goes. It writes nothing and shows nothing.
 */
const ENTER = `<!doctype html><meta charset="utf-8"><title>Pramanyx</title><script>
(function () {
  var said = new URLSearchParams(location.hash.slice(1));
  var access = said.get("t") || "";
  said.delete("t");
  var carried = said.toString();
  location.replace("./" + (access ? "?token=" + encodeURIComponent(access) : "") + (carried ? "#pramanyx:" + carried : ""));
})();
</script>`;

/**
 * A CONVERSATION IS HELD TO ITS CONNECTION. Telling the agent which connection a conversation is about is an
 * instruction, and an instruction is not a boundary: it could still list the connections and ask another one, and
 * it did. This is the boundary. Every call to one of Pramanyx's tools passes the shell's guard before it runs; a
 * call made from a connection's workspace that names another connection is refused there, with a sentence the
 * agent reads and can repeat to the person. A guard can only refuse — nothing later in the shell can turn the
 * refusal back into permission.
 *
 * What is held: the `connection` (or `connection_id`) a call names. A call that names none is let through for the
 * tool to answer as it does — except a custom agent's, which would otherwise answer on the agent's own connection.
 * A conversation that is not in a connection's workspace (the folder the shell was started in) is not held.
 */
const OURS = "mcp__pramanyx__";
const LISTS = /^mcp__pramanyx__list_(platform_)?connections$/;
const HELD_FOLDER = /[\\/]connections[\\/]([A-Za-z0-9_-]+)[\\/]?$/;

/** The refusal for one call from a conversation held to `held`, or undefined when the call may run. Pure. */
export function refusalFor(name, args, held) {
  if (!held || typeof name !== "string" || !name.startsWith(OURS) || LISTS.test(name)) return undefined;
  const given = args && typeof args === "object" ? (args.connection ?? args.connection_id) : undefined;
  const named = typeof given === "string" ? given.trim() : "";
  const here = `This conversation is held to the connection \`${held}\``;
  if (named && named !== held) {
    return `${here}. It cannot read \`${named}\`. Tell the person so: to ask about another connection they start a conversation on it.`;
  }
  if (!named && /^mcp__pramanyx__ask_[a-z0-9_]+$/.test(name)) {
    return `${here}. An agent answers on its own connection unless told otherwise: pass connection \`${held}\`, or tell the person this agent cannot be asked here.`;
  }
  return undefined;
}

function holdToConnection(ctx) {
  ctx.inject(["tools", "workingDirectory"], (at) => {
    at.effect(() => at.tools.guard((call) => {
      let folder = "";
      try { folder = call.agent ? String(at.workingDirectory.get(call.agent.session) || "") : ""; } catch { folder = ""; }
      return refusalFor(call.name, call.arguments, HELD_FOLDER.exec(folder)?.[1] ?? "");
    }), "pramanyx-home: a conversation is held to its connection");
  });
}

/**
 * A TURN IS A RUN, AND IS RECORDED WHERE RUNS ARE. The shell keeps its own trajectory of a turn; the platform's
 * operators read one store (Agent Ops, over the session log), and a coworker turn was not in it. Each event of a
 * turn that matters to an operator is sent to the platform as it happens — the question, each tool call and its
 * result, the end — under one trace named for the conversation and the turn.
 *
 * Two things are deliberately not sent. The model calls: the platform's model door already records every one, so
 * each call is only told which turn it belongs to (two request headers) and the door files it there; sending them
 * too would count the spend twice. And the words: the system prompt, what the agent was given and what it said
 * stay in the shell's own log, and each event says where there (`shell_session`, `seq`).
 *
 * The platform's own work for a question is in the same trace. Before a call to the governed answer path, the
 * platform is told which step of which turn is asking; it records what it does to answer under this turn's trace
 * and inside that step. One question, one trace. Were the claim not taken, the answer names the trace it was
 * recorded under instead, and the call's result carries that.
 */
const ASKS = /^mcp__pramanyx__ask(_[a-z0-9_]+)?$/;
const clip = (text, most) => (typeof text === "string" && text.length > most ? text.slice(0, most) : text);
const textOf = (content) => (Array.isArray(content) ? content.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("") : "");

/** The trace of one turn of one conversation: `cw-<the shell's session id, shortened>-<turn>`. */
export const traceOf = (sessionId, turn) =>
  `cw-${String(sessionId).replace(/^session-/, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 16)}-${Number(turn) || 0}`;

/** What an answer's result says of itself, for the record: which platform trace, which receipt, how many rows. */
function ofAnAnswer(text) {
  try {
    const got = JSON.parse(text);
    return {
      platform_trace: got.trace_id || undefined, investigation_id: got.investigation_id || undefined,
      receipt_id: got.receipt?.artifact?.id || got.receipt_id || undefined,
      headline: clip(got.answer || got.headline || undefined, 300),
      rows: typeof got.row_count === "number" ? got.row_count : undefined,
    };
  } catch {
    return { platform_trace: /"trace_id":\s*"([A-Za-z0-9-]{4,60})"/.exec(text)?.[1] };
  }
}

/**
 * The events one of the shell's own session events comes to, for the platform's record — none for most. `turns`
 * holds what is known of each conversation's running turn and is changed here. Pure but for that.
 */
export function turnEvents(turns, sessionId, held, event) {
  const data = event?.data ?? {};
  const at = Number(event?.time) || Date.now();
  const where = { shell_session: sessionId, seq: event?.seq };
  const now = turns.get(sessionId);
  if (event?.type === "turn/start") {
    turns.set(sessionId, { turn: data.turn, trace: traceOf(sessionId, data.turn), started: at, asked: false, calls: new Map(), headline: "", tools: 0 });
    return [];
  }
  if (!now) return [];
  const conn_id = held || null;
  if (event.type === "user/message" && !now.asked && data.source?.kind === "user") {
    now.asked = true;
    return [{ kind: "user_request", name: "coworker", conn_id, payload: { question: clip(textOf(data.content), 2000), turn: now.turn, ...where } }];
  }
  if (event.type === "tool/call" && data.callId) {
    now.calls.set(data.callId, { name: data.name, at });
    now.tools += 1;
    return [{ kind: "tool_call", name: String(data.name || "tool"), span_id: data.callId, conn_id,
              payload: { tool: data.name, arguments: clip(typeof data.arguments === "string" ? data.arguments : JSON.stringify(data.arguments ?? {}), 1500), step: data.step, ...where } }];
  }
  if (event.type === "tool/result") {
    const message = data.message ?? {};
    const call = now.calls.get(message.toolCallId);
    if (!call) return [];
    now.calls.delete(message.toolCallId);
    const said = ASKS.test(call.name) ? ofAnAnswer(textOf(message.content)) : {};
    if (said.headline) now.headline = said.headline;
    // The platform recorded its work inside this turn's trace when the claim made before the call was taken; then
    // there is no other trace to name. It is named only when the answer was recorded apart.
    if (said.platform_trace === now.trace) delete said.platform_trace;
    const { rows, ...rest } = said;
    return [{ kind: "tool_call_result", name: String(call.name || "tool"), span_id: message.toolCallId, ok: !message.isError,
              duration_ms: Math.max(0, at - call.at), conn_id, ...(typeof rows === "number" ? { row_count: rows } : {}),
              payload: { tool: call.name, ...rest, ...where } }];
  }
  if (event.type === "turn/end") {
    turns.delete(sessionId);
    const reason = String(data.reason?.kind || "");
    return [{ kind: "final_response", name: "coworker", ok: reason === "completed", duration_ms: Math.max(0, at - now.started), conn_id,
              payload: { ...(now.headline ? { headline: now.headline } : {}), reason, calls: now.tools, turn: now.turn, ...where } }];
  }
  return [];
}

function recordTurns(ctx, api) {
  const turns = new Map();
  const traces = new Map();          // session → the running turn's trace, read when a model call's headers are made
  let sending = Promise.resolve();
  let warned = false;
  const send = (trace, session, events) => {
    // One after another, so the record reads in the order things happened.
    sending = sending.then(() => fetch(`${api}/coworker/trace`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trace_id: trace, session, events }),
    })).then((answer) => { if (!answer.ok) throw new Error(String(answer.status)); }).catch((error) => {
      if (!warned) console.warn(`pramanyx-home: a turn was not recorded in the platform's trace store (${error?.message ?? error})`);
      warned = true;
    });
  };
  ctx.on("session/event", (session, event) => {
    try {
      const id = String(session?.id ?? "");
      if (!id) return;
      const before = turns.get(id);
      const held = HELD_FOLDER.exec(String(session?.header?.cwd ?? ""))?.[1] ?? "";
      const events = turnEvents(turns, id, held, event);
      const after = turns.get(id);
      if (after) traces.set(id, after.trace); else traces.delete(id);
      const trace = (after ?? before)?.trace;
      if (events.length && trace) send(trace, id, events);
    } catch { /* the record is best-effort; the turn it observes goes on */ }
  });
  // Before a question goes to the governed answer path, the platform is told which step of which turn asks it, so
  // the work of answering is recorded inside this turn's trace and not as a second run beside it. Waited for, but
  // not for long: an unanswered claim costs the join, never the answer.
  ctx.on("tools/pre-execute", async (call, next) => {
    try {
      const session = call?.agent?.session;
      const id = String((session && typeof session === "object" ? session.id : session) ?? "");
      const trace = traces.get(id);
      const args = call?.arguments && typeof call.arguments === "object" ? call.arguments : {};
      if (trace && call?.callId && ASKS.test(String(call.name)) && typeof args.question === "string" && args.question) {
        await fetch(`${api}/coworker/claim`, {
          method: "PUT", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(1500),
          body: JSON.stringify({ trace_id: trace, session: id, span_id: call.callId, question: args.question,
                                 connection: String(args.connection ?? args.connection_id ?? "") }),
        });
      }
    } catch { /* the answer is asked for all the same */ }
    return next();
  });
  // Each model call says which turn it was made for, and the platform's model door files it under that turn.
  ctx.on("llm-pi-ai/request-headers", (request, headers, next) => {
    const trace = request?.sessionId ? traces.get(String(request.sessionId)) : undefined;
    if (trace) { headers.set("x-pramanyx-trace", trace); headers.set("x-pramanyx-session", String(request.sessionId)); }
    return next();
  });
}

export const inject = ["webServer", "workspaceRegistry"];

export function apply(ctx) {
  const api = (process.env.PRAMANYX_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  workspacePerConnection(ctx, api).catch((error) => {
    // Pramanyx not answering at start is not a reason for the page not to open; it says so where it reads.
    console.warn(`pramanyx-home: no workspace per connection this start (${error?.message ?? error})`);
  });
  sayWhereThisIs(ctx, api);
  holdToConnection(ctx);
  recordTurns(ctx, api);
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/pramanyx-enter",
    handler: (req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
      return res.end(req.method === "HEAD" ? undefined : ENTER);
    },
  }), "pramanyx-home: the way in from the app");
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/pramanyx",          // no trailing slash: the server matches the prefix itself, or the prefix and a "/"
    resource: async (request) => {
      const url = new URL(request.url);
      const path = url.pathname.slice("/pramanyx".length);
      if (!READS.some((allowed) => allowed.test(path))) return new Response("Not relayed", { status: 404 });
      try {
        const answer = await fetch(api + path + url.search, { headers: { accept: "application/json" } });
        return new Response(await answer.text(), {
          status: answer.status,
          headers: { "content-type": answer.headers.get("content-type") || "application/json", "cache-control": "no-store" },
        });
      } catch {
        return new Response(JSON.stringify({ detail: "The platform is not answering" }), {
          status: 502, headers: { "content-type": "application/json" },
        });
      }
    },
  }), "pramanyx-home: read-only relay");
}
