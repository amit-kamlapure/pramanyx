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
export const READS = [
  /^\/connections$/,          // which databases there are, to say whose questions these are
  /^\/suggestions$/,          // starter questions for one connection (cached; a first read may cost a model call)
  /^\/agents\/custom$/,       // a person's own agents
  /^\/investigations$/,       // recent questions — a person's own (`?mine=1`): each coworker is its person's
  /^\/chat-sessions$/,        // the group conversations a person is in (2026-11-17), opened as the app's own thread
  /^\/sheets$/,               // the sheets by name, so an answer that read one can open it
  // An answer as a file — Excel, PowerPoint, Word or PDF — built by Pramanyx from the answer's stored rows, never by
  // code the model wrote (`pramanyx/export`). A GET like the rest; the bytes are passed through as they come.
  /^\/investigations\/[A-Za-z0-9_-]{1,64}\/export$/,
  // What went out from one email draft (`pramanyx/routers/email.py`): a draft that was sent says so whenever the
  // conversation is opened, because "sent" is read from Pramanyx's journal and not remembered by the page.
  /^\/email\/sent$/,
  // One schedule, as the platform has it now (`GET /automations/<id>/schedule`): when it runs in words, when next,
  // and whether it is on, muted, ended or gone. The card under the turn that made a schedule reads this every time
  // it is drawn, because where a schedule stands is a fact about the schedule and not about the page that made it.
  /^\/automations\/[A-Za-z0-9_-]{1,64}\/schedule$/,
];

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
  const sources = [];
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
    sources.push({ id, name, folder });
  }
  await allSources(ctx, home, sources);
}

/**
 * ALL SOURCES (2026-11-15). An investigation that needs a database and a spreadsheet, or several systems, cannot be
 * worked in a conversation held to one connection. This workspace is held to none: its `AGENTS.md` lists every
 * connection and its folder, and says to give each source its own helper, started in that source's folder — where
 * the helper is held to that source alone (`holdOf`). The person chooses it in the shell's picker, as they choose a
 * connection.
 */
const ALL_SOURCES = "All sources";

async function allSources(ctx, home, sources) {
  const folder = join(home, "all-sources");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "AGENTS.md"), [
    `# ${ALL_SOURCES}`,
    "",
    "This conversation is held to no one connection: it is for an investigation that needs more than one source.",
    "The sources, each with its connection id and its folder:",
    "",
    ...sources.map((source) => `- ${source.name}: connection \`${source.id}\`, folder \`${source.folder}\``),
    "",
    "When the investigation needs more than one of them, start one helper per source with `cwd` set to that",
    "source's folder: the helper is then held to that source and asks it alone. Name the connection in each brief.",
    "",
  ].join("\n"));
  const known = await ctx.workspaceRegistry.resolveByPath(folder);
  if (!known) await ctx.workspaceRegistry.create(folder, ALL_SOURCES);
  else if (known.title !== ALL_SOURCES) await known.setTitle(ALL_SOURCES);
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
        // Whose coworker this is (2026-11-17: each person has their own): the platform gives this address only to them.
        await fetch(`${api}/coworker/address`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, person: ownerOfThisCoworker() }),
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
  var person = said.get("d") || "";
  said.delete("t");
  said.delete("d");
  var carried = said.toString();
  var go = function () {
    location.replace("./" + (access ? "?token=" + encodeURIComponent(access) : "") + (carried ? "#pramanyx:" + carried : ""));
  };
  if (!person) return go();
  // The person the app handed over goes to this page's own server, which checks it with Pramanyx and keeps it;
  // it never reaches the conversation or the model. A failure still opens the coworker, as nobody in particular.
  fetch("pramanyx-person", { method: "POST", headers: { "content-type": "application/json" },
                             body: JSON.stringify({ d: person }) }).then(go, go);
})();
</script>`;

/**
 * THE PERSON THE COWORKER ACTS FOR (People, 2026-11-15). The app mints a short-lived delegation for whoever is
 * signed in there (`pramanyx/security/delegation.py`) and the entry page above posts it here. It is checked with
 * Pramanyx, then kept in one file only this account can read (PRAMANYX_DELEGATION_FILE, set by start.sh) — where the
 * answer card's relays and the MCP server read it on every call. One shell is one person's: a newer arrival replaces
 * the older. Never kept in a conversation or shown to the model, so the agent cannot choose who it acts for.
 */
/** The person kept above, presented with what this coworker reads for them — so a read is theirs, never wider. */
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
 * THE PERSON'S CLOCK (2026-11-17: "Yesterday means day before current date.. based on the users time setting" — for the
 * coworker and the platform alike). The coworker's page says which zone its browser is in when it loads; it is kept in
 * one file (PRAMANYX_CLOCK_FILE, set by start.sh) that the MCP server and the relays below send on every call, so the
 * platform counts "yesterday" from this person's today (`pramanyx/kernel/clock.py`).
 */
export function readableZone(zone) {
  const name = String(zone || "").trim();
  if (!name || name.length > 64) return "";
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return name;
  } catch {
    return "";
  }
}

async function clockHeader() {
  const file = process.env.PRAMANYX_CLOCK_FILE || "";
  if (!file) return {};
  try {
    const { readFile } = await import("node:fs/promises");
    const zone = readableZone((await readFile(file, "utf8")).trim());
    return zone ? { "x-pramanyx-clock": zone } : {};
  } catch {
    return {};
  }
}

export async function keepTheClock(req, res) {
  const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  if (req.method !== "POST") return reply(405, { detail: "POST only" });
  const from = req.headers["sec-fetch-site"];
  if (from && from !== "same-origin") return reply(403, { detail: "Only this page may say this" });
  const file = process.env.PRAMANYX_CLOCK_FILE || "";
  if (!file) return reply(501, { detail: "No place to keep the clock (PRAMANYX_CLOCK_FILE is unset)" });
  let raw = "";
  for await (const part of req) { raw += part; if (raw.length > 256) return reply(413, { detail: "Too long" }); }
  let zone = "";
  try { zone = readableZone(JSON.parse(raw).zone); } catch { zone = ""; }
  if (!zone) return reply(422, { detail: "Not a time zone" });
  try {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, zone, { mode: 0o600 });
    return reply(200, { zone });
  } catch {
    return reply(500, { detail: "The clock could not be kept" });
  }
}

/**
 * A CONVERSATION IS ITS PERSON'S (Phase 3, 2026-11-17). One shell holds one person at a time — whoever the app last
 * handed it — so on a shared install a conversation one person started, opened later while the coworker acts for
 * another, would have asked Pramanyx in the second person's name. Each conversation is bound to the person it began
 * with (kept in DSH_HOME, so a restart keeps it), and while the coworker acts for someone else its Pramanyx tools are
 * refused there, saying whose it is. A conversation begun with nobody delegated is bound to nobody, as before. The
 * sidebar still lists every conversation on the install: one shell per person is what would hide them.
 */
let personNow = "";

export function readPersonNow() {
  const file = process.env.PRAMANYX_DELEGATION_FILE || "";
  if (!file) return "";
  try { return readFileSync(`${file}.who`, "utf8").trim().slice(0, 200); } catch { return ""; }
}

export function personRefusal(owner, now) {
  if (!owner || !now || owner === now) return undefined;
  return `This conversation is ${owner}'s, and the coworker now acts for ${now}: it does not ask Pramanyx in one ` +
    "person's name inside another's conversation. Tell them so: they start a new conversation of their own.";
}

export function heldToItsPerson(ctx, { keep = join(process.env.DSH_HOME || join(homedir(), ".dsh"), "conversation-people.json"),
                                      now = () => personNow } = {}) {
  const owners = new Map();
  try { for (const [id, who] of Object.entries(JSON.parse(readFileSync(keep, "utf8")))) owners.set(id, String(who)); } catch { /* none kept yet */ }
  const save = () => {
    try { mkdirSync(dirname(keep), { recursive: true }); writeFileSync(keep, JSON.stringify(Object.fromEntries(owners)), { mode: 0o600 }); }
    catch { /* unkept: held for as long as this process runs */ }
  };
  ctx.on("session/event", (session, event) => {
    try {
      const id = String(session?.id ?? "");
      if (!id || owners.has(id)) return;
      const parent = typeof session?.header?.parentSession === "string" ? session.header.parentSession : "";
      if (event?.type === "turn/start" && parent && owners.has(parent)) { owners.set(id, owners.get(parent)); save(); return; }
      if (event?.type === "user/message" && event?.data?.source?.kind === "user" && now()) { owners.set(id, now()); save(); }
    } catch { /* unbound: the conversation is held to nobody, as before */ }
  });
  ctx.inject(["tools"], (at) => {
    at.effect(() => at.tools.guard((call) => {
      if (RECALL.test(String(call?.name))) return recallRefusal(owners, now());
      if (!/^mcp__pramanyx__/.test(String(call?.name))) return undefined;
      const session = call.agent?.session;
      const id = String((session && typeof session === "object" ? session.id : session) ?? "");
      return personRefusal(owners.get(id), now());
    }), "pramanyx-home: a conversation is its person's");
  });
  return owners;
}

/** The shell's tools for searching and reading past conversations (`@deepseek-ai/dsh-tool-session-query`). */
export const RECALL = /^session_(search|event_search|trace|event_trace|event_read)$/;

/** Why the agent may not search past conversations here, or undefined when it may (punch list 84). They search every
 *  conversation this coworker holds, whoever began it: a person's own coworker holds only theirs; the install's first
 *  holds one person's only while one person has used it. Once a second person has, it searches nobody's — it would
 *  bring one person's words into another's answer. Nobody is named. */
export function recallRefusal(owners, now, owner = ownerOfThisCoworker()) {
  if (owner) return undefined;
  const people = new Set([...owners.values()].filter(Boolean));
  if (now) people.add(now);
  return people.size > 1
    ? "This coworker holds other people's conversations too, so it does not search past conversations for anyone. " +
      "Tell the person so: their own coworker, opened from the app, searches only theirs."
    : undefined;
}

/** Whose coworker this is: the person the platform started it for, or "" for the install's first (start_all.sh's). */
export function ownerOfThisCoworker() {
  return String(process.env.PRAMANYX_COWORKER_PERSON || "").trim();
}

/** Why a delegation for ``user`` is refused here, or "" when it is taken: a coworker started for one person acts for
 *  no one else (each person has their own; the install's first takes whoever the app hands it, as before). */
export function notThisCoworkersPerson(user) {
  const owner = ownerOfThisCoworker();
  return owner && String(user || "") !== owner ? "This coworker is another person's; open your own from the app." : "";
}

export async function keepThePerson(req, res, api) {
  const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  if (req.method !== "POST") return reply(405, { detail: "POST only" });
  const from = req.headers["sec-fetch-site"];
  if (from && from !== "same-origin") return reply(403, { detail: "Only this page may say this" });
  const file = process.env.PRAMANYX_DELEGATION_FILE || "";
  if (!file) return reply(501, { detail: "No place to keep the person (PRAMANYX_DELEGATION_FILE is unset)" });
  let raw = "";
  for await (const part of req) { raw += part; if (raw.length > 1024) return reply(413, { detail: "Too long" }); }
  let token = "";
  try { token = String(JSON.parse(raw).d || ""); } catch { token = ""; }
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return reply(422, { detail: "Not a delegation" });
  try {
    const answer = await fetch(api + "/auth/delegation", { headers: { accept: "application/json", "x-pramanyx-delegation": token } });
    if (!answer.ok) return reply(401, { detail: "Pramanyx did not recognise the person" });
    const who = await answer.json();
    const refused = notThisCoworkersPerson(who.user_id);
    if (refused) return reply(403, { detail: refused });
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, token, { mode: 0o600 });
    // Who it is, beside it (not a secret): a conversation is held to the person who started it (`heldToItsPerson`).
    await writeFile(`${file}.who`, String(who.user_id || ""), { mode: 0o600 });
    personNow = String(who.user_id || "");
    return reply(200, { user_id: who.user_id });
  } catch {
    return reply(502, { detail: "The platform is not answering" });
  }
}

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
/** The shell's tools that start a helper: a sub-agent, as a fresh session or as a fork of this one. */
const SPAWNS = /^subagent(_fork)?$/;

/**
 * Which connection a conversation is held to, decided once: the first time it is seen. A HELPER (a sub-agent, whose
 * header names the conversation that started it) is held to its parent's connection, whatever folder it was started
 * in. Otherwise the folder it started in decides. Cached, so moving a conversation's folder later is no way round.
 */
export function holdOf(holds, id, header, now = "") {
  if (!holds.has(id)) {
    const parent = typeof header?.parentSession === "string" ? header.parentSession : "";
    holds.set(id, parent && holds.get(parent) ? holds.get(parent) : (HELD_FOLDER.exec(String(header?.cwd ?? ""))?.[1] ?? ""));
  }
  // ONE WAY ONLY: a conversation held to nothing becomes held when it moves into a connection's folder, and a held
  // one never changes. Found live, 2026-11-15: the shell makes a helper in its parent's folder and moves it to the
  // folder it was started in a moment later, so a helper of All sources, started in its source's folder, was first
  // seen in All sources and was held to nothing. Moving can only tighten a hold, never loosen or swap it.
  const moved = HELD_FOLDER.exec(String(now ?? ""))?.[1] ?? "";
  if (!holds.get(id) && moved) holds.set(id, moved);
  return holds.get(id);
}

/** The refusal for one call from a conversation held to `held`, or undefined when the call may run. Pure. */
/**
 * WHAT A CONVERSATION BROUGHT IN (2026-11-17). A file the person attaches becomes their own sheet on the Sheets
 * connection (`bring_in_file`); a conversation held to another connection may then ask the Sheets connection — the
 * person's own private sheets, nothing else of anyone's. Kept per conversation, from the tool's own result.
 */
export const BRING_IN = /^mcp__pramanyx__bring_in_file$/;

/** The connections a brought-in file opened to a conversation, from that call's result; [] when it opened none. */
export function openedBy(name, resultText) {
  if (!BRING_IN.test(String(name))) return [];
  try {
    const got = JSON.parse(resultText);
    return got && got.brought_in === true && got.kind === "sheet" && got.connection === "sheets" ? ["sheets"] : [];
  } catch { return []; }
}

export function refusalFor(name, args, held, also = []) {
  if (typeof name === "string" && SPAWNS.test(name)) {
    // EVERY HELPER IS HELD TO ONE SOURCE. A helper of a held conversation is held to its connection; started in
    // another connection's folder it would read that one. A helper of a conversation held to none (All sources) is
    // held to the source whose folder it starts in — and one started in no source's folder would be held to
    // nothing: found live, 2026-11-15, the agent was told to give each source's helper its folder and did not.
    const folder = args && typeof args === "object" && typeof args.cwd === "string" ? args.cwd.trim() : "";
    const source = HELD_FOLDER.exec(folder)?.[1] ?? "";
    if (held && folder && source !== held) {
      return `This conversation is held to the connection \`${held}\`, and so is every helper it starts. Start the helper without a folder. To work across sources, the person starts the conversation in ${ALL_SOURCES}.`;
    }
    if (!held && !source) {
      return `A helper works on one source. Start it with cwd set to that source's folder — the folders are listed in your instructions — so it is held to that source.`;
    }
    return undefined;
  }
  if (!held || typeof name !== "string" || !name.startsWith(OURS) || LISTS.test(name)) return undefined;
  const given = args && typeof args === "object" ? (args.connection ?? args.connection_id) : undefined;
  const named = typeof given === "string" ? given.trim() : "";
  const here = `This conversation is held to the connection \`${held}\``;
  if (named && named !== held && also.includes(named)) return undefined;     // the person's own sheet, brought in here
  if (named && named !== held) {
    return `${here}. It cannot read \`${named}\`. Tell the person so: to ask about another connection they start a conversation on it.`;
  }
  if (!named && /^mcp__pramanyx__ask_[a-z0-9_]+$/.test(name)) {
    return `${here}. An agent answers on its own connection unless told otherwise: pass connection \`${held}\`, or tell the person this agent cannot be asked here.`;
  }
  return undefined;
}

/**
 * ASKED FIRST (2026-11-17). A call that changes what the platform does unattended, or what the organisation's
 * knowledge holds, waits for the person's own Allow in the conversation — the shell's approval prompt — whatever the
 * organisation's agent policy allows: setting something on a schedule, and drafting what a word means. The prompt
 * says what will happen in the person's own words. Reading, asking a question and bringing in a file they attached
 * are not asked about.
 */
const ASKED_FIRST = {
  "mcp__pramanyx__schedule": (args) => `Set this up on a schedule: “${clipped(args.request)}”?`,
  "mcp__pramanyx__draft_definition": (args) =>
    `Draft what “${clipped(args.term, 80)}” means${args.area ? ` in ${args.area}` : ""}: “${clipped(args.text)}”? It is not used until its owner publishes it.`,
};
const clipped = (value, most = 240) => {
  const text = String(value ?? "").trim();
  return text.length > most ? `${text.slice(0, most)}…` : text;
};

/** The approval to ask for before a call, or undefined when it is not asked about. */
export function askFor(name, args) {
  const say = ASKED_FIRST[String(name)];
  if (!say) return undefined;
  const words = say(args && typeof args === "object" ? args : {});
  return { kind: "ask", reason: words, displayReason: { en: words } };
}

/**
 * A PERSON'S NO STANDS (2026-11-17). On the first live run a person rejected a draft and the coworker, reasoning the
 * refusal "might be because of the connection choice", asked again at once on another connection. What a person
 * declines is not asked again until they next write — on any connection — and the agent is told why. The key is the
 * tool, and for a draft the word: a draft of another word is still asked about.
 */
export function declinedKey(name, args) {
  if (!ASKED_FIRST[String(name)]) return "";
  if (String(name) === "mcp__pramanyx__draft_definition") {
    return `${name}:${String(argsOf(args).term ?? "").trim().toLowerCase()}`;
  }
  return String(name);
}

export const NO_STANDS =
  "The person declined this a moment ago. It was not done, and it is not asked again — on this connection or another — " +
  "until they ask for it. Tell them it was not done.";

const argsOf = (args) => {
  if (args && typeof args === "object") return args;
  try { const parsed = JSON.parse(String(args ?? "")); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; }
};

/** Whether a tool's result says the person (or the shell's review, on their behalf) refused it. */
export const refusedResult = (message) => Boolean(message?.isError) && /\brejected\b/i.test(textOf(message?.content));

/**
 * WHEN IT RUNS IS THE PERSON'S WORDS (2026-11-18). The schedule tool asks for the person's sentence copied exactly —
 * "in 2 minutes" is once, "every 2 minutes" a rhythm — and a model still shortened "run once, 4 minutes from now, and
 * never again: ask how many titles…" to "ask how many titles…", and asked the person to allow a schedule with no time
 * in it. The phrases of the person's own last message that say when are read here; a schedule call missing any of them
 * goes back to the agent, with the sentence to copy, before the person is asked to allow anything.
 */
const TIMING = new RegExp(String.raw`\b(?:once|twice|never\s+again|every\s+(?:other\s+)?(?:\d+\s+)?[a-z]+|` +
  String.raw`in\s+(?:\d+|an?|one|two|three|four|five|six|ten|fifteen|twenty|thirty)\s+(?:minute|hour|day|week|month)s?|` +
  String.raw`(?:\d+|an?|one|two|three|four|five|six|ten|fifteen|twenty|thirty)\s+(?:minute|hour|day|week)s?\s+from\s+now|` +
  String.raw`at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|daily|weekly|monthly|hourly|nightly|tomorrow|tonight|` +
  String.raw`(?:mon|tues|wednes|thurs|fri|satur|sun)days?|weekdays?|weekends?)\b`, "gi");
const plain = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** The phrases saying when in what the person said that a schedule request left out. */
export function timingLost(personSaid, request) {
  const asked = plain(request);
  return [...new Set([...plain(personSaid).matchAll(TIMING)].map((m) => m[0]))].filter((phrase) => !asked.includes(phrase));
}

export function timingRefusal(personSaid, request) {
  const lost = timingLost(personSaid, request);
  if (!lost.length) return undefined;
  const said = String(personSaid).trim().slice(0, 600);
  return `Not set up: the request leaves out when it runs (${lost.map((w) => `“${w}”`).join(", ")}). The person said: ` +
    `“${said}”. Call schedule again with that sentence as \`request\`, copied exactly — not reworded or shortened.`;
}

export function askBeforeActing(ctx) {
  const declined = new Map();        // conversation → what the person declined since they last wrote
  const asked = new Map();           // call → what it would be declined as
  const lastSaid = new Map();        // conversation → the person's own last message
  ctx.on("session/event", (session, event) => {
    try {
      const id = String(session?.id ?? "");
      const data = event?.data ?? {};
      if (event?.type === "user/message" && data.source?.kind === "user") {
        declined.delete(id);
        lastSaid.set(id, textOf(data.content));
        return;
      }
      if (event?.type === "tool/call" && data.callId) {
        const key = declinedKey(data.name, data.arguments);
        if (key) asked.set(data.callId, key);
      }
      if (event?.type === "tool/result") {
        const message = data.message ?? {};
        const key = asked.get(message.toolCallId);
        if (!key) return;
        asked.delete(message.toolCallId);
        if (id && refusedResult(message)) declined.set(id, new Set([...(declined.get(id) ?? []), key]));
      }
    } catch { /* nothing remembered: the next call is asked about, as before */ }
  });
  ctx.on("tools/pre-execute", async (call, next) => {
    const decided = await next();
    if (!decided || decided.kind !== "allow") return decided;      // a denial or a cancel stands
    const session = call?.agent?.session;
    const id = String((session && typeof session === "object" ? session.id : session) ?? "");
    const key = declinedKey(call?.name, call?.arguments);
    if (key && declined.get(id)?.has(key)) return { kind: "deny", reason: NO_STANDS };
    if (SCHEDULES_CALL.test(String(call?.name))) {
      // A helper's call answers what was said in the conversation that started it.
      const parent = session && typeof session === "object" && typeof session.header?.parentSession === "string" ? session.header.parentSession : "";
      const refused = timingRefusal(lastSaid.get(id) ?? lastSaid.get(parent) ?? "", argsOf(call?.arguments).request);
      if (refused) return { kind: "deny", reason: refused };
    }
    return askFor(call?.name, call?.arguments) ?? decided;
  });
}

function holdToConnection(ctx, holds) {
  // The connections a conversation's own brought-in files opened to it, by conversation.
  const opened = new Map();
  const names = new Map();
  ctx.on("session/event", (session, event) => {
    try {
      const id = String(session?.id ?? "");
      const data = event?.data ?? {};
      if (event?.type === "tool/call" && data.callId && BRING_IN.test(String(data.name))) names.set(data.callId, data.name);
      if (event?.type === "tool/result") {
        const message = data.message ?? {};
        const name = names.get(message.toolCallId);
        if (!name) return;
        names.delete(message.toolCallId);
        if (message.isError) return;
        const more = openedBy(name, textOf(message.content));
        if (id && more.length) opened.set(id, [...new Set([...(opened.get(id) ?? []), ...more])]);
      }
    } catch { /* nothing opened: the hold stands as it was */ }
  });
  ctx.inject(["tools", "workingDirectory"], (at) => {
    at.effect(() => at.tools.guard((call) => {
      const session = call.agent?.session;
      const id = String((session && typeof session === "object" ? session.id : session) ?? "");
      let folder = "";
      try { folder = call.agent ? String(at.workingDirectory.get(call.agent.session) || "") : ""; } catch { folder = ""; }
      const also = opened.get(id) ?? [];
      if (id && holds.has(id)) return refusalFor(call.name, call.arguments, holdOf(holds, id, {}, folder), also);
      return refusalFor(call.name, call.arguments, HELD_FOLDER.exec(folder)?.[1] ?? "", also);
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
 * and inside that step. One question, one trace. Were the claim not taken, the answer's work is a run of its own
 * in the same store, as it was before, and the call's result still names its receipt.
 */
const ASKS = /^mcp__pramanyx__ask(_[a-z0-9_]+)?$/;
const clip = (text, most) => (typeof text === "string" && text.length > most ? text.slice(0, most) : text);
const textOf = (content) => (Array.isArray(content) ? content.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("") : "");

/** The trace of one turn of one conversation: `cw-<the shell's session id, shortened>-<turn>`. */
export const traceOf = (sessionId, turn) =>
  `cw-${String(sessionId).replace(/^session-/, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 16)}-${Number(turn) || 0}`;

/** What an answer's result says of itself, for the record: which receipt, which headline, how many rows. */
function ofAnAnswer(text) {
  try {
    const got = JSON.parse(text);
    return {
      investigation_id: got.investigation_id || undefined,
      receipt_id: got.receipt?.artifact?.id || got.receipt_id || undefined,
      headline: clip(got.answer || got.headline || undefined, 300),
      rows: typeof got.row_count === "number" ? got.row_count : undefined,
    };
  } catch {
    return {};
  }
}

/** The record's memory: each conversation's running turn, each helper's place, each conversation's open question. */
export function newRecord() {
  return { turns: new Map(), helpers: new Map(), questions: new Map(), checks: [] };
}

/** The answers a question gathers, by the tool that gave them: the governed path's, an agent's, a deep analysis's. */
const ANSWERED = /^mcp__pramanyx__(ask(_[a-z0-9_]+)?|deep_analysis)$/;
const BOOKKEEPING = /^\s*(waiting|done)\W*$/i;

/**
 * A question's one answer, from what its main agent said after its helpers reported: the fullest reply that is not
 * bookkeeping ("Waiting", "Done") — the page's own rule for which reply it shows (`answer-card`), so the answer
 * checked is the answer shown. "" when there is none yet.
 */
export function closeOf(replies) {
  return (replies ?? []).map((reply) => String(reply ?? "").trim())
    .filter((reply) => reply && !BOOKKEEPING.test(reply))
    .reduce((best, reply) => (reply.length >= best.length ? reply : best), "");
}

/** The investigation an answer's result names, or "". */
function investigationOf(text) {
  try {
    const got = JSON.parse(text);
    const id = String(got?.investigation_id ?? "");
    return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

/** The helper a spawn's result says it started. */
const STARTED = /started subagent ([A-Za-z0-9-]{8,64})/;
/** A turn the shell starts because a helper reported: its first message is the report, not a person's question. */
const REPORTS = new Set(["agent-message", "subagent-settled"]);

/**
 * The events one of the shell's own session events comes to, for the platform's record — none for most. `record`
 * (`newRecord`) holds what is known and is changed here. Pure but for that.
 *
 * ONE QUESTION IS ONE TRACE, HOWEVER MANY AGENTS WORK ON IT (2026-11-15). A turn may start helpers (sub-agents);
 * each is a conversation of its own to the shell, and was recorded as a trace of its own, its brief filed as if a
 * person had asked it. Now a helper's work is written into the question's trace, inside the call that started it,
 * and that call's span lasts until the helper has finished. A helper reporting back starts a new turn of the
 * conversation that started it: that turn is the same question, so it joins the same trace. The question ends — its
 * `final_response` — at the end of the first turn after which no helper is still working.
 */
export function turnEvents(record, sessionId, held, event, header = {}) {
  const { turns, helpers, questions } = record;
  const data = event?.data ?? {};
  const at = Number(event?.time) || Date.now();
  const where = { shell_session: sessionId, seq: event?.seq };
  const parent = typeof header?.parentSession === "string" ? header.parentSession : "";
  const now = turns.get(sessionId);
  if (event?.type === "turn/start") {
    if (parent) {
      const helper = helpers.get(sessionId) ?? { parent, span: null, at };
      helpers.set(sessionId, helper);
      const question = questions.get(helper.parent);
      question?.running.add(sessionId);
      turns.set(sessionId, { turn: data.turn, trace: question?.trace ?? traceOf(sessionId, data.turn), started: at, asked: true,
                             helper: true, inside: helper.span, calls: new Map(), headline: "", tools: 0 });
      return [];
    }
    turns.set(sessionId, { turn: data.turn, trace: traceOf(sessionId, data.turn), started: at, asked: false, calls: new Map(), headline: "", tools: 0 });
    return [];
  }
  if (!now) return [];
  const conn_id = held || null;
  const inside = now.inside ? { parent_span_id: now.inside } : {};
  if (event.type === "user/message" && !now.asked) {
    const kind = data.source?.kind;
    if (kind === "user") {
      now.asked = true;
      questions.set(sessionId, { trace: now.trace, started: now.started, running: questions.get(sessionId)?.running ?? new Set(),
                                 answers: new Set(), spawns: [], replies: [], ended: false, checked: "" });
      return [{ kind: "user_request", name: "coworker", conn_id, payload: { question: clip(textOf(data.content), 2000), turn: now.turn, ...where } }];
    }
    if (REPORTS.has(kind)) {
      now.asked = true;
      now.report = true;
      const question = questions.get(sessionId);
      if (question) now.trace = question.trace;
      return [];
    }
  }
  if (event.type === "assistant/message" && now.report && !now.helper) {
    // What the main agent says after its helpers report: where the question's one answer is.
    const said = (data.message?.content ?? []).filter((part) => part?.type === "text").map((part) => String(part.text ?? "")).join("");
    if (said.trim()) questions.get(sessionId)?.replies.push(said);
    return [];
  }
  if (event.type === "tool/call" && data.callId) {
    now.calls.set(data.callId, { name: data.name, at, args: data.arguments });
    now.tools += 1;
    return [{ kind: "tool_call", name: String(data.name || "tool"), span_id: data.callId, conn_id, ...inside,
              payload: { tool: data.name, arguments: clip(typeof data.arguments === "string" ? data.arguments : JSON.stringify(data.arguments ?? {}), 1500), step: data.step, ...where } }];
  }
  if (event.type === "tool/result") {
    const message = data.message ?? {};
    const call = now.calls.get(message.toolCallId);
    if (!call) return [];
    now.calls.delete(message.toolCallId);
    const child = SPAWNS.test(String(call.name)) && !message.isError ? STARTED.exec(textOf(message.content))?.[1] : undefined;
    if (child) {
      // The helper's span stays open while it works; it is closed when the helper finishes, below.
      const was = helpers.get(child);
      helpers.set(child, { ...was, parent: sessionId, span: message.toolCallId, at: call.at, name: call.name, description: descriptionOf(call.args) });
      const running = turns.get(child);
      if (running) running.inside = message.toolCallId;          // a helper that began before its start was reported
      questions.get(sessionId)?.running.add(child);
      questions.get(sessionId)?.spawns.push(message.toolCallId);
      return [];
    }
    if (ANSWERED.test(String(call.name)) && !message.isError) {
      // Every answer the question gathers — a helper's, and the main agent's own — is what its one answer rests on.
      const id = investigationOf(textOf(message.content));
      const owner = now.helper ? helpers.get(sessionId)?.parent : sessionId;
      const question = owner ? questions.get(owner) : undefined;
      if (id && question && question.trace === now.trace) question.answers.add(id);
    }
    const said = ASKS.test(call.name) ? ofAnAnswer(textOf(message.content)) : {};
    if (said.headline) now.headline = said.headline;
    const { rows, ...rest } = said;
    return [{ kind: "tool_call_result", name: String(call.name || "tool"), span_id: message.toolCallId, ok: !message.isError,
              duration_ms: Math.max(0, at - call.at), conn_id, ...inside, ...(typeof rows === "number" ? { row_count: rows } : {}),
              payload: { tool: call.name, ...rest, ...where } }];
  }
  if (event.type === "turn/end") {
    turns.delete(sessionId);
    const reason = String(data.reason?.kind || "");
    if (now.helper) {
      const helper = helpers.get(sessionId);
      if (helper) questions.get(helper.parent)?.running.delete(sessionId);
      if (!helper?.span || helper.closed) return [];
      helper.closed = true;
      return [{ kind: "tool_call_result", name: String(helper.name || "subagent"), span_id: helper.span, ok: reason === "completed",
                duration_ms: Math.max(0, at - helper.at), conn_id,
                payload: { tool: helper.name || "subagent", helper: sessionId, ...(helper.description ? { description: helper.description } : {}),
                           ...(now.headline ? { headline: now.headline } : {}), reason, calls: now.tools, ...where } }];
    }
    const question = questions.get(sessionId);
    // Helpers still at work on this question: it has not ended, whatever this turn did.
    if (question?.running.size) return [];
    const ours = question && question.trace === now.trace;
    if (ours && question.spawns.length) {
      // A question worked by helpers: its one answer is checked against the answers it gathered — once it has ended,
      // and again if a later report's turn changed which reply that answer is.
      const text = closeOf(question.replies);
      if (text && text !== question.checked) {
        question.checked = text;
        record.checks.push({ session: sessionId, trace: question.trace, call: question.spawns[0], text, ids: [...question.answers] });
      }
    }
    // A question ends once: a helper's late report starts a turn of the same question, not a second end.
    if (ours && question.ended) return [];
    if (ours) question.ended = true;
    const started = ours ? question.started : now.started;
    return [{ kind: "final_response", name: "coworker", ok: reason === "completed", duration_ms: Math.max(0, at - started), conn_id,
              payload: { ...(now.headline ? { headline: now.headline } : {}), reason, calls: now.tools, turn: now.turn, ...where } }];
  }
  return [];
}

/** A spawn's one-line description, as the agent wrote it. */
function descriptionOf(args) {
  try {
    const given = typeof args === "string" ? JSON.parse(args) : args;
    return clip(String(given?.description ?? ""), 160);
  } catch {
    return "";
  }
}

/**
 * WHAT A HELPER FOUND, KEPT FOR THE PAGE. A helper's answers are in its own conversation, which the person does not
 * read; the conversation that started it shows them, as the platform's own cards, under the turn that started it.
 * So each answer a helper is given — the governed path's (`ask`, an agent's `ask_…`) and a deep analysis's — is kept
 * here as it came back, one file per helper, with when it finished. The page reads it (`/pramanyx-helper`).
 */
const HELPER_ANSWERS = /^mcp__pramanyx__(ask(_[a-z0-9_]+)?|deep_analysis)$/;
const HELPER_ID = /^[A-Za-z0-9-]{8,64}$/;
const helperFile = (id) => join(process.env.DSH_HOME || join(homedir(), ".dsh"), "helpers", `${id}.jsonl`);

export function helperLines(record, sessionId, header, event) {
  const parent = typeof header?.parentSession === "string" ? header.parentSession : "";
  const data = event?.data ?? {};
  if (!parent) {
    // The start of a helper, seen from the conversation that started it: its description.
    if (event?.type !== "tool/result") return [];
    const message = data.message ?? {};
    const child = STARTED.exec(textOf(message.content))?.[1];
    const helper = child ? record.helpers.get(child) : undefined;
    if (!helper || helper.parent !== sessionId) return [];
    // And which call started it: the page finds a helper by its spawn call, the one thing the end of a turn is told.
    return [[child, { started: { description: helper.description || "", parent: sessionId, call: helper.span } }],
            [`call:${helper.span}`, { child }]];
  }
  if (event?.type === "tool/call" && data.callId && HELPER_ANSWERS.test(String(data.name))) {
    const asked = record.turns.get(sessionId);
    if (asked) (asked.answerCalls ??= new Map()).set(data.callId, { name: data.name, args: data.arguments });
    return [];
  }
  if (event?.type === "tool/result") {
    const message = data.message ?? {};
    const call = record.turns.get(sessionId)?.answerCalls?.get(message.toolCallId);
    if (!call || message.isError) return [];
    let args = {};
    try { args = typeof call.args === "string" ? JSON.parse(call.args) : (call.args ?? {}); } catch { args = {}; }
    return [[sessionId, { answer: { tool: call.name, args: { question: args.question, connection: args.connection ?? args.connection_id },
                                    text: clip(textOf(message.content), 400_000) } }]];
  }
  if (event?.type === "turn/end") return [[sessionId, { ended: String(data.reason?.kind || "") }]];
  return [];
}

async function keepHelperLines(lines) {
  if (!lines.length) return;
  const { appendFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  for (const [id, line] of lines) {
    if (id.startsWith("call:")) {
      const call = id.slice(5);
      if (!CALL_ID.test(call) || !HELPER_ID.test(String(line.child))) continue;
      await mkdir(dirname(callFile(call)), { recursive: true });
      await writeFile(callFile(call), JSON.stringify(line), { mode: 0o600 });
      continue;
    }
    if (!HELPER_ID.test(id)) continue;
    await mkdir(dirname(helperFile(id)), { recursive: true });
    await appendFile(helperFile(id), `${JSON.stringify(line)}\n`, { mode: 0o600 });
  }
}

const CALL_ID = /^[A-Za-z0-9_-]{1,80}$/;
const callFile = (call) => join(process.env.DSH_HOME || join(homedir(), ".dsh"), "helpers", "calls", `${call}.json`);

/** The helper a spawn call started, as `readHelper` says it — or, while that call's start is not yet known, `pending`. */
export async function readHelperOfCall(call) {
  if (!CALL_ID.test(String(call))) return null;
  const { readFile } = await import("node:fs/promises");
  let child = "";
  try { child = String(JSON.parse(await readFile(callFile(call), "utf8")).child || ""); } catch { return { known: false, pending: true }; }
  return readHelper(child);
}

/** What one helper found so far: its description, its answers in order, and whether it has finished. */
export async function readHelper(id) {
  if (!HELPER_ID.test(id)) return null;
  const { readFile } = await import("node:fs/promises");
  let text = "";
  // No record: a helper from before answers were kept, or not a helper at all. The page draws nothing for it.
  try { text = await readFile(helperFile(id), "utf8"); } catch { return { known: false, description: "", answers: [], done: false }; }
  const out = { known: true, description: "", answers: [], done: false };
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let line;
    try { line = JSON.parse(raw); } catch { continue; }
    if (line.started) out.description = String(line.started.description || "");
    if (line.answer) { out.answers.push(line.answer); out.done = false; }
    if (line.ended) out.done = true;
  }
  return out;
}

const checkFile = (call) => join(process.env.DSH_HOME || join(homedir(), ".dsh"), "helpers", "checks", `${call}.json`);

/**
 * THE ONE ANSWER, CHECKED (2026-11-16). The platform holds each figure of a question's one answer against the rows
 * of the answers the question gathered (`POST /coworker/answer-check`, `pramanyx/govern/gathered.py`) and records
 * the check in the question's trace; what it said is kept here, under the call that started the question's first
 * helper — the key the page finds the question by — for the page to show under the answer.
 */
async function checkTheAnswer(api, check) {
  if (!CALL_ID.test(String(check.call))) return;
  const { writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  let kept;
  try {
    const answer = await fetch(`${api}/coworker/answer-check`, {
      method: "POST", headers: { "content-type": "application/json", ...(await personHeader()) },
      body: JSON.stringify({ trace_id: check.trace, session: check.session, text: check.text.slice(0, 40000),
                             investigation_ids: check.ids.slice(0, 60) }),
    });
    kept = answer.ok ? { state: "checked", ...(await answer.json()) }
      : { state: "unchecked", detail: `The platform did not check it (${answer.status}).` };
  } catch {
    kept = { state: "unchecked", detail: "The platform was not answering when it ended." };
  }
  await mkdir(dirname(checkFile(check.call)), { recursive: true });
  await writeFile(checkFile(check.call), JSON.stringify({ ...kept, opening: check.text.slice(0, 120) }), { mode: 0o600 });
}

/** What was said of a question's one answer, by the call that started its first helper; `pending` until then. */
export async function readAnswerCheck(call) {
  if (!CALL_ID.test(String(call))) return null;
  const { readFile } = await import("node:fs/promises");
  try { return JSON.parse(await readFile(checkFile(call), "utf8")); } catch { return { state: "pending" }; }
}

function recordTurns(ctx, api, holds) {
  const record = newRecord();
  const traces = new Map();          // session → the running turn's trace, read when a model call's headers are made
  const insides = new Map();         // a helper's session → the call that started it, for its model calls' headers
  let sending = Promise.resolve();
  let keeping = Promise.resolve();
  let warned = false;
  const send = (trace, session, events) => {
    // One after another, so the record reads in the order things happened.
    // Whose turn it is goes with it (Phase 3, 2026-11-17): the platform files the turn under that person.
    sending = sending.then(async () => fetch(`${api}/coworker/trace`, {
      method: "POST", headers: { "content-type": "application/json", ...(await personHeader()) },
      body: JSON.stringify({ trace_id: trace, session, events }),
    })).then((answer) => { if (!answer.ok) throw new Error(String(answer.status)); }).catch((error) => {
      if (!warned) console.warn(`pramanyx-home: a turn was not recorded in the platform's trace store (${error?.message ?? error})`);
      warned = true;
    });
  };
  ctx.on("session/event", (session, event) => {
    try {
      const id = String(session?.id ?? "");
      if (!id) return;
      const header = session?.header ?? {};
      const before = record.turns.get(id);
      const held = holdOf(holds, id, header, event?.type === "working-directory/change" ? event?.data?.cwd : "");
      const events = turnEvents(record, id, held, event, header);
      const lines = helperLines(record, id, header, event);          // after: a spawn's description is kept there
      const after = record.turns.get(id);
      if (after) traces.set(id, after.trace); else traces.delete(id);
      if (after?.inside) insides.set(id, after.inside); else if (!after) insides.delete(id);
      const trace = (after ?? before)?.trace;
      if (events.length && trace) send(trace, id, events);
      if (lines.length) keeping = keeping.then(() => keepHelperLines(lines)).catch(() => { /* the page says it could not read it */ });
      for (const check of record.checks.splice(0)) {
        keeping = keeping.then(() => checkTheAnswer(api, check)).catch(() => { /* the page says it was not checked */ });
      }
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
    // A helper's model calls are filed inside the call that started it.
    const inside = request?.sessionId ? insides.get(String(request.sessionId)) : undefined;
    if (trace && inside) headers.set("x-pramanyx-span", inside);
    return next();
  });
}

/**
 * A SCHEDULED RUN REACHES ITS PERSON (punch list 85, 2026-11-18). A schedule made in a conversation is one of the
 * platform's automations, and its card reads its runs only when the conversation is drawn: a run that landed while the
 * person was away waited, unseen, for them to happen to open that conversation. Here the coworker remembers which
 * conversation made which schedule (from the `schedule` call's own result), reads each one's runs every couple of
 * minutes as the person (`GET /automations/<id>/schedule`), and marks the conversation unread when a new run has landed
 * — on the sidebar's row, until the conversation is opened (`/pramanyx-runs`, the page's `RunLanded`). Kept in this
 * coworker's home, so it survives a restart; a schedule the platform no longer has is forgotten.
 */
export const SCHEDULES_CALL = /^mcp__pramanyx__schedule$/;
const AUTOMATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The schedule a `schedule` call's result made, or "" — a call that asked instead or could not made none. */
export function scheduleMadeBy(text) {
  try {
    const got = JSON.parse(String(text || "{}"));
    return got && got.scheduled !== false && AUTOMATION_ID.test(String(got.id ?? "")) ? String(got.id) : "";
  } catch {
    return "";
  }
}

/** The latest run's time in a schedule's read, or "". */
export function latestRun(read) {
  const runs = Array.isArray(read?.runs) ? read.runs : [];
  return runs.map((run) => String(run?.at ?? "")).filter(Boolean).sort().at(-1) ?? "";
}

export function runsReachThePerson(ctx, api, {
  keep = join(process.env.DSH_HOME || join(homedir(), ".dsh"), "conversation-runs.json"),
  readSchedule = async (id) => {
    const answer = await fetch(`${api}/automations/${encodeURIComponent(id)}/schedule`,
                               { headers: { accept: "application/json", ...(await personHeader()) } });
    if (answer.status === 404) return null;
    if (!answer.ok) throw new Error(String(answer.status));
    return answer.json();
  },
} = {}) {
  const state = { schedules: {}, seen: {}, unread: {} };
  try { Object.assign(state, JSON.parse(readFileSync(keep, "utf8"))); } catch { /* none kept yet */ }
  const save = () => {
    try { mkdirSync(dirname(keep), { recursive: true }); writeFileSync(keep, JSON.stringify(state), { mode: 0o600 }); }
    catch { /* unkept: held for as long as this process runs */ }
  };
  const calls = new Map();
  ctx.on("session/event", (session, event) => {
    try {
      const id = String(session?.id ?? "");
      const data = event?.data ?? {};
      if (event?.type === "tool/call" && data.callId && SCHEDULES_CALL.test(String(data.name))) calls.set(data.callId, id);
      if (event?.type === "tool/result") {
        const message = data.message ?? {};
        const where = calls.get(message.toolCallId);
        if (where === undefined) return;
        calls.delete(message.toolCallId);
        const made = message.isError ? "" : scheduleMadeBy(textOf(message.content));
        // A helper's schedule is its conversation's: the person reads the conversation they asked in.
        const parent = typeof session?.header?.parentSession === "string" ? session.header.parentSession : "";
        if (made) { state.schedules[made] = parent || where; state.seen[made] ??= ""; save(); }
      }
    } catch { /* not remembered: its runs show when the conversation is opened, as before */ }
  });
  const tick = async () => {
    let changed = false;
    for (const [automation, conversation] of Object.entries(state.schedules)) {
      let read;
      try { read = await readSchedule(automation); } catch { continue; }      // unread this time: asked again next
      if (read === null) { delete state.schedules[automation]; delete state.seen[automation]; changed = true; continue; }
      const at = latestRun(read);
      if (at && at > String(state.seen[automation] || "")) {
        state.seen[automation] = at;
        state.unread[conversation] = { at, name: String(read?.name || ""), automation };
        changed = true;
      }
    }
    if (changed) save();
  };
  const seen = (conversation) => {
    if (!state.unread[conversation]) return false;
    delete state.unread[conversation];
    save();
    return true;
  };
  return { state, tick, seen };
}

/** `GET /pramanyx-runs` — the conversations a run landed in since they were last opened; `POST {session}` — opened. */
export async function runsDoor(req, res, runs) {
  const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  if (req.method === "GET") return reply(200, { unread: runs.state.unread });
  if (req.method !== "POST") return reply(405, { detail: "GET or POST" });
  const from = req.headers["sec-fetch-site"];
  if (from && from !== "same-origin") return reply(403, { detail: "Only this page may say this" });
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > 2000) return reply(413, { detail: "Too long" }); }
  let session = "";
  try { session = String(JSON.parse(body || "{}").session || ""); } catch { return reply(400, { detail: "Not JSON" }); }
  if (!session) return reply(422, { detail: "Which conversation was opened" });
  return reply(200, { cleared: runs.seen(session) });
}

export const inject = ["webServer", "workspaceRegistry"];

export function apply(ctx) {
  const api = (process.env.PRAMANYX_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  workspacePerConnection(ctx, api).catch((error) => {
    // Pramanyx not answering at start is not a reason for the page not to open; it says so where it reads.
    console.warn(`pramanyx-home: no workspace per connection this start (${error?.message ?? error})`);
  });
  sayWhereThisIs(ctx, api);
  // Which connection each conversation is held to, decided the first time it is seen (`holdOf`): the guard and the
  // record read the same answer.
  const holds = new Map();
  holdToConnection(ctx, holds);
  personNow = readPersonNow();
  heldToItsPerson(ctx);
  askBeforeActing(ctx);
  recordTurns(ctx, api, holds);
  const runs = runsReachThePerson(ctx, api);
  ctx.effect(() => {
    const timer = setInterval(() => { runs.tick().catch(() => {}); }, 120_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }, "pramanyx-home: a scheduled run reaches its person");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/pramanyx-runs",
    handler: (req, res) => runsDoor(req, res, runs),
  }), "pramanyx-home: the conversations a run landed in");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/pramanyx-helper",
    handler: async (req, res) => {
      const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
      if (req.method !== "GET") return reply(405, { detail: "GET only" });
      const asked = new URL(req.url, "http://here").searchParams;
      const found = asked.has("call") ? await readHelperOfCall(asked.get("call") || "") : await readHelper(asked.get("session") || "");
      return found ? reply(200, found) : reply(422, { detail: "Not a helper's id" });
    },
  }), "pramanyx-home: what a helper found");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/pramanyx-answer-check",
    handler: async (req, res) => {
      const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
      if (req.method !== "GET") return reply(405, { detail: "GET only" });
      const found = await readAnswerCheck(new URL(req.url, "http://here").searchParams.get("call") || "");
      return found ? reply(200, found) : reply(422, { detail: "Not a call's id" });
    },
  }), "pramanyx-home: what was said of a question's one answer");
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
    kind: "exact",
    path: "/pramanyx-person",
    handler: (req, res) => keepThePerson(req, res, api),
  }), "pramanyx-home: the person the coworker acts for");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/pramanyx-clock",
    handler: (req, res) => keepTheClock(req, res),
  }), "pramanyx-home: the person's clock");
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/pramanyx",          // no trailing slash: the server matches the prefix itself, or the prefix and a "/"
    resource: async (request) => {
      const url = new URL(request.url);
      const path = url.pathname.slice("/pramanyx".length);
      if (!READS.some((allowed) => allowed.test(path))) return new Response("Not relayed", { status: 404 });
      try {
        const answer = await fetch(api + path + url.search,
                                   { headers: { accept: "*/*", ...(await personHeader()), ...(await clockHeader()) } });
        const headers = { "content-type": answer.headers.get("content-type") || "application/json", "cache-control": "no-store" };
        const named = answer.headers.get("content-disposition");
        if (named) headers["content-disposition"] = named;
        // Bytes, not text: a file must arrive as it left (a workbook read as text is a broken workbook).
        return new Response(await answer.arrayBuffer(), { status: answer.status, headers });
      } catch {
        return new Response(JSON.stringify({ detail: "The platform is not answering" }), {
          status: 502, headers: { "content-type": "application/json" },
        });
      }
    },
  }), "pramanyx-home: read-only relay");
}
