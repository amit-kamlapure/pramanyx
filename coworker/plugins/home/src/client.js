/**
 * The coworker's first screen, its Agents page and its Schedules page. Out of the question box, while a person is in it
 * and it is empty: questions worth asking of one connection. Under it: the questions asked lately, and a person's own agents. Everything on it is read from Pramanyx through this plugin's relay
 * (`lib/index.js`), and every item does one thing: it writes a question into the box. The connection is the one
 * the conversation is filed under — the shell's own picker above the box — and the agent already knows it. Nothing here asks anything
 * by itself — a person reads the question and sends it.
 *
 * The shell has no place under the question box on a new conversation: its one slot on that screen sits in the
 * row above it. This fills that slot with nothing visible and draws the block into an element it adds at the end
 * of the box's own column. That is a workaround, found by the column's class name; if the shell renames it the
 * block is drawn in the row above the box, where the slot is.
 */
import { createElement as h, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NAME_BAR_STOPS } from "../../../../web/components/ui/brandArt";
import { Logo } from "../../brand/src/logo.js";
import { nextOpen } from "./opens.js";
import { unstick, workspaceOf } from "./stuck.js";
import { inTheApp, withOthers } from "./threads.js";

const CHOSEN = "pramanyx.coworker.connection";
const QUESTIONS_SHOWN = 4;

/* Borders are the exception (the platform's rule, 2026-11-20): a card is a surface, an action a soft fill. */
const soft = "color-mix(in srgb, currentColor 9%, transparent)";
const faint = "color-mix(in srgb, currentColor 5%, transparent)";
const quiet = { opacity: 0.66 };
const surface = `var(--dsw-alias-bg-layer-1, ${faint})`;

async function read(path) {
  const answer = await fetch(`/pramanyx${path}`, { headers: { accept: "application/json" } });
  if (!answer.ok) throw new Error(`${path}: ${answer.status}`);
  return answer.json();
}

function remembered() {
  try { return localStorage.getItem(CHOSEN) || ""; } catch { return ""; }
}

function remember(id) {
  try { localStorage.setItem(CHOSEN, id); } catch { /* a private window: the choice lasts this visit */ }
}

/** How long ago, in the fewest words. */
function ago(stamp) {
  const then = Date.parse(stamp);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  const said = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (minutes < 60) return said(minutes || 1, "minute");
  if (minutes < 60 * 24) return said(Math.round(minutes / 60), "hour");
  return said(Math.round(minutes / 1440), "day");
}

/**
 * The first screen's look: the mark on a tile over a large headline, a roomier question box, the questions that
 * drop out of it, and under it two cards with space in them. The headline, the tile and the box are the shell's, found by the names
 * its stylesheet gives them; if it renames them they keep the shell's own look and nothing breaks.
 */
const HOME_LOOK = `
[class*="composerHero"] { gap: 14px; }
/*
 * The shell centres the first screen in its scroller. Centred content taller than the window is cut off at the
 * top, where no scrolling reaches: the mark and half the headline were gone in a short window. The screen is
 * centred with free space instead, which is nothing when there is none, so it starts at the top and scrolls.
 */
[data-conversation-scroll]:has(> [data-composer-seat] [class*="composerHero"]) { justify-content: flex-start; }
[data-conversation-scroll] > [data-composer-seat]:has([class*="composerHero"]) { margin-block: auto; flex: none; padding-block: 28px 36px; }
[class*="composerHero"] [class*="_headline"] { flex-direction: column; gap: 22px; padding-bottom: 14px; }
[class*="composerHero"] [class*="_fishHitbox"] {
  width: 72px; height: 72px; border-radius: 14px; display: grid; place-items: center;
  color: var(--dsw-alias-brand-primary, #46a0c4);
  background: var(--dsw-alias-bg-layer-2, color-mix(in srgb, currentColor 9%, var(--dsw-alias-bg-base, #111113)));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
}
[class*="composerHero"] [class*="_titleGroup"] { font-size: 34px; line-height: 1.15; font-weight: 400; letter-spacing: -0.01em; align-items: center; }
[class*="composerHero"] [data-composer-card] { border-radius: 10px; }
.pramanyx-home-row {
  display: flex; gap: 12px; align-items: center; width: 100%; text-align: left; font: inherit; color: inherit;
  cursor: pointer; background: transparent; border: 0; border-radius: 6px; padding: 9px 10px;
}
.pramanyx-home-row:hover, .pramanyx-home-row:focus-visible { background: color-mix(in srgb, currentColor 7%, transparent); }
.pramanyx-home-row:focus-visible { outline: 1px solid color-mix(in srgb, currentColor 40%, transparent); }
.pramanyx-home-row svg { flex: none; opacity: 0.62; }
.pramanyx-home-soft:hover, .pramanyx-home-soft:focus-visible { background: color-mix(in srgb, currentColor 15%, transparent) !important; }
/*
 * The bar across the top (\`TopBar\`), at the platform's measures. While it is drawn, the shell's frame starts 48 lower
 * (as the shell's own frame does under a desktop title bar), its masks and drawer start under it, the page is a surface
 * set into the frame with a rounded corner where the bar and the sidebar meet it (the platform's \`.aug-page-surface\`),
 * and the sidebar's own head — its logo and its toggle — gives way to the bar's.
 */
html:has([data-pramanyx-bar]) { --dsh-frame-chrome-top: 48px; }
[class$="_frame"]:has([data-pramanyx-bar]) { padding-top: 48px; background: var(--dsw-specific-sidebar-fill); }
[class$="_frame"]:has([data-pramanyx-bar]) [class*="_centerCol"] { background: var(--dsw-alias-bg-base); border-top-left-radius: 10px; }
[class$="_frame"]:has([data-pramanyx-bar]) [class*="_rightbarCol"] { background: var(--dsw-alias-bg-base); }
[class$="_frame"]:has([data-pramanyx-bar]) [class*="_sidebarCol"] [class*="_logoRow"] { display: none !important; }
[class$="_frame"][data-sidebar-drawer]:has([data-pramanyx-bar]) [class*="_sidebarCol"] { top: 48px !important; }
[class$="_frame"]:has([data-pramanyx-bar]) [data-shell-leading] { display: none !important; }
[data-pramanyx-bar] {
  position: absolute; top: 0; left: 0; right: 0; height: 48px; box-sizing: border-box;
  display: flex; align-items: center; gap: 12px; padding: 0 14px;
  background: var(--dsw-specific-sidebar-fill); color: var(--dsw-alias-label-primary); font-size: 14px;
}
.pramanyx-bar-icon {
  display: inline-flex; align-items: center; justify-content: center; flex: none; padding: 0; border: 0; border-radius: 4px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.pramanyx-bar-icon:hover, .pramanyx-bar-icon[data-open] { background: color-mix(in srgb, currentColor 10%, transparent); color: var(--dsw-alias-label-primary); }
.pramanyx-bar-icon:focus-visible { outline: 1px solid color-mix(in srgb, currentColor 40%, transparent); }
.pramanyx-bar-person { display: inline-flex; flex: none; padding: 2px; border-radius: 4px; background: color-mix(in srgb, currentColor 4%, transparent); }
.pramanyx-bar-person > span {
  width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  background: var(--dsw-alias-bg-layer-3, color-mix(in srgb, currentColor 14%, transparent));
  font-size: 11px; font-weight: 600; line-height: 1; color: var(--dsw-alias-label-primary);
}
`;

function wearHomeLook() {
  let style = document.getElementById("pramanyx-home-look");
  if (!style) {
    style = document.createElement("style");
    style.id = "pramanyx-home-look";
    document.head.appendChild(style);
  }
  style.textContent = HOME_LOOK;
}

const drawn = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
/** A four-pointed star: a question worth asking. */
const Spark = () => h("svg", { width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": "true", style: { opacity: 1 } },
  h("defs", null, h("linearGradient", { id: "pramanyx-spark", x1: 0, y1: 0, x2: 1, y2: 1 },
    NAME_BAR_STOPS.map(([offset, stopColor]) => h("stop", { key: offset, offset, stopColor })))),
  h("path", { fill: "url(#pramanyx-spark)", d: "M9 2.5c.5 3.6 2.4 5.5 6 6-3.6.5-5.500 2.400-6 6-.5-3.600-2.400-5.500-6-6 3.600-.5 5.500-2.400 6-6Z" }));
/** A speech bubble: a question that was asked. */
const Asked = () => h("svg", drawn, h("path", { d: "M3 4.5h12v8H8.5L5.5 15v-2.5H3z" }));

/** A suggested question: one plain line that writes itself into the box. */
function Row({ text, onPick }) {
  return h("button", { type: "button", className: "pramanyx-home-row", onMouseDown: (e) => e.preventDefault(), onClick: onPick, title: text, style: { fontSize: 13 } },
    h(Spark),
    h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, text));
}

/** A thing in a card: what it is, and under it where it is from and when. */
function Item({ icon, text, note, onPick }) {
  const one = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  return h("button", { type: "button", className: "pramanyx-home-row", onClick: onPick, title: text, style: { alignItems: "flex-start" } },
    h("span", { style: { paddingTop: 1, display: "inline-flex" } }, icon),
    h("span", { style: { flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } },
      h("span", { style: { ...one, fontSize: 13, fontWeight: 600 } }, text),
      note ? h("span", { style: { ...one, ...quiet, fontSize: 12 } }, note) : null));
}

function Card({ title, empty, children }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  return h("section", { style: { flex: "1 1 300px", minWidth: 0, background: surface, borderRadius: 10, padding: "16px 12px 10px", minHeight: 150, display: "flex", flexDirection: "column" } },
    h("div", { style: { ...quiet, fontSize: 13, padding: "0 10px 8px" } }, title),
    rows && rows.length ? h("div", { style: { display: "flex", flexDirection: "column", gap: 2 } }, rows)
      : h("div", { style: { ...quiet, flex: "1 1 auto", display: "grid", placeItems: "center", fontSize: 13, padding: "18px 10px" } }, empty));
}

function Block({ inputActions, here }) {
  const [connections, setConnections] = useState(null);
  const [chosen, setChosen] = useState(remembered);
  const [questions, setQuestions] = useState(null);
  const [recent, setRecent] = useState(null);
  const [agents, setAgents] = useState(null);
  const [down, setDown] = useState(false);
  // The questions drop out of the box while a person is in it and it is empty (2026-11-20, `opens.js`).
  const [open, setOpen] = useState(false);
  const list = useRef(null);
  const openNow = useRef(false);
  openNow.current = open;

  useEffect(() => {
    const box = () => document.querySelector("[data-composer-card] [role='textbox']");
    const inBox = (node) => Boolean(node && box()?.contains(node));
    const inList = (node) => Boolean(node && list.current?.contains(node));
    const empty = () => !(box()?.textContent || "").trim();
    const turn = (event) => setOpen((was) => nextOpen(was, event));
    // The shell's editor writes the box itself, so typing, pasting or dictating need not fire `input`: what the box
    // holds is watched instead, and what counts is it going from empty to written in, or back.
    let wasEmpty = true;
    const written = () => {
      if (empty() === wasEmpty) return;
      wasEmpty = !wasEmpty;
      turn({ kind: "input", empty: wasEmpty });
    };
    const watcher = new MutationObserver(written);
    const enter = (e) => {
      if (!inBox(e.target)) return;
      watcher.disconnect();
      watcher.observe(box(), { childList: true, characterData: true, subtree: true });
      wasEmpty = empty();
      turn({ kind: "enter", empty: wasEmpty });
    };
    const leave = (e) => {
      if (inBox(e.target) || inList(e.target)) turn({ kind: "leave", staysNear: inBox(e.relatedTarget) || inList(e.relatedTarget) });
    };
    const key = (e) => {
      if (!openNow.current) return;
      if (e.key === "Escape" && (inBox(e.target) || inList(e.target))) {
        if (inList(e.target)) box()?.focus();
        turn({ kind: "escape" });
      } else if (e.key === "ArrowDown" && inBox(e.target) && empty()) {
        const first = list.current?.querySelector("button.pramanyx-home-row");
        if (first) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("focusin", enter);
    document.addEventListener("pointerdown", enter);
    document.addEventListener("focusout", leave);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("focusin", enter);
      document.removeEventListener("pointerdown", enter);
      document.removeEventListener("focusout", leave);
      watcher.disconnect();
      document.removeEventListener("keydown", key, true);
    };
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([read("/connections"), read("/investigations?limit=6&mine=1"), read("/agents/custom")])
      .then(([all, asked, mine]) => {
        if (!live) return;
        setConnections(all); setRecent(asked); setAgents(mine.filter((a) => a.enabled !== false));
        // With no choice made here yet: the connection last asked about, since that is where the person was working.
        setChosen((now) => (now && all.some((c) => c.id === now)) ? now : (asked[0]?.connection_id || all[0]?.id || ""));
      })
      .catch(() => { if (live) setDown(true); });
    return () => { live = false; };
  }, []);

  const asked = (connections ?? []).some((c) => c.id === here) ? here : chosen;
  useEffect(() => {
    if (!asked) return undefined;
    let live = true;
    setQuestions(null);
    read(`/suggestions?connection_id=${encodeURIComponent(asked)}`)
      .then((got) => { if (live) setQuestions(got.suggestions ?? []); })
      .catch(() => { if (live) setQuestions([]); });
    return () => { live = false; };
  }, [asked]);

  if (down) {
    return h("div", { style: { ...quiet, fontSize: 12, paddingTop: 14 } },
      "Suggestions could not be read just now. You can still ask.");
  }
  if (!connections) return null;

  const named = (id) => connections.find((c) => c.id === id)?.name || id;
  // The connection this conversation is filed under, when it is one of the workspaces the host half makes for
  // each connection. The agent has been told it in its instructions, so a question about it is written plainly.
  // A question about ANOTHER connection still says which, in words, because nothing else would.
  const settled = connections.some((c) => c.id === here) ? here : "";
  const shown = settled || chosen;
  const ask = (question, id) =>
    inputActions?.setDraft?.(id === settled ? question : `${question} (on ${named(id)}, connection ${id})`);
  const pick = (question, id) => { setOpen(false); ask(question, id); };
  // Up and down move along the list; up from its first question goes back into the box.
  const move = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...(list.current?.querySelectorAll("button.pramanyx-home-row") ?? [])];
    const at = rows.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    if (e.key === "ArrowUp" && at === 0) document.querySelector("[data-composer-card] [role='textbox']")?.focus();
    else rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  // Inset as the box above it is, so the block's edges meet the box's.
  const inset = "var(--dsh-composer-side-clearance, 14px)";
  return h("div", { style: { position: "relative", display: "flex", flexDirection: "column", gap: 14, padding: `10px ${inset} 0`, fontSize: 13 } },
    open ? h("div", {
      ref: list, "data-pramanyx-questions": "", role: "group", "aria-label": `Questions for ${named(shown)}`, onKeyDown: move,
      style: { position: "absolute", zIndex: 30, top: 6, left: inset, right: inset, padding: "8px 6px 6px", display: "flex",
               flexDirection: "column", gap: 4, borderRadius: 10, background: `var(--dsw-alias-bg-layer-2, ${surface})`,
               boxShadow: "0 16px 40px rgba(0, 0, 0, 0.35)" },
    },
    settled ? h("div", { style: { ...quiet, fontSize: 12, padding: "0 10px 2px" } }, `Questions for ${named(settled)}. Choose another connection above the box.`)
    : h("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "0 10px 2px" } },
      h("label", { htmlFor: "pramanyx-connection", style: quiet }, "Questions for"),
      h("select", {
        id: "pramanyx-connection", value: chosen,
        onChange: (e) => { remember(e.target.value); setChosen(e.target.value); },
        style: { font: "inherit", color: "inherit", background: soft, border: 0, borderRadius: 4, padding: "3px 8px" },
      }, connections.map((c) => h("option", { key: c.id, value: c.id }, c.name)))),
    h("div", { style: { display: "flex", flexDirection: "column", gap: 2 } },
      questions === null ? h("div", { style: { ...quiet, padding: "9px 10px" } }, "Reading the questions worth asking…")
        : questions.length ? questions.slice(0, QUESTIONS_SHOWN).map((q) => h(Row, { key: q.text, text: q.text, onPick: () => pick(q.text, shown) }))
          : h("div", { style: { ...quiet, padding: "9px 10px" } }, "No suggested questions for this connection yet."))) : null,
    h("div", { style: { display: "flex", flexWrap: "wrap", gap: 16, paddingTop: 14 } },
      h(Card, { title: "Asked lately", empty: "Nothing has been asked yet." },
        (recent ?? []).slice(0, 4).map((r) => h(Item, {
          key: r.id, icon: h(Asked), text: r.question, note: [named(r.connection_id), ago(r.started_at)].filter(Boolean).join(" · "),
          onPick: () => ask(r.question, r.connection_id),
        }))),
      h(Card, { title: "Your agents", empty: "No agents yet." },
        (agents ?? []).slice(0, 4).map((a) => h(Item, {
          key: a.id, icon: h(AgentsIcon, { size: 18 }), text: a.name, note: a.connection_id ? named(a.connection_id) : "",
          onPick: () => inputActions?.setDraft?.(`Ask the ${a.name} agent: `),
        })))));
}

/** The slot's occupant: nothing to see in the row above the box, and the block drawn below it. */
function Home(props) {
  const here = useRef(null);
  const [below, setBelow] = useState(null);
  const [inRow, setInRow] = useState(false);
  useEffect(() => {
    let column = here.current;
    while (column && !String(column.className).includes("composerStack")) column = column.parentElement;
    if (!column) { setInRow(true); return undefined; }
    const place = document.createElement("div");
    place.setAttribute("data-pramanyx-home", "");
    column.appendChild(place);
    setBelow(place);
    return () => { place.remove(); setBelow(null); };
  }, []);
  // The folder this conversation is filed under. The host half keeps one per connection, named by its id.
  const folder = props.useSessions?.((sessions) => sessions.byId?.[props.sessionId]?.cwd) || "";
  const filedUnder = /[\\/]connections[\\/]([A-Za-z0-9_-]+)[\\/]?$/.exec(folder)?.[1] ?? "";
  const block = h(Block, { inputActions: props.inputActions, here: filedUnder });
  return h("span", { ref: here }, below ? createPortal(block, below) : inRow ? block : null);
}

const AGENTS = "pramanyx-agents";

/** The sidebar's drawing for Agents: a plain head-and-two-eyes, in the colour of the text beside it. */
function AgentsIcon({ size = 16 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
    h("rect", { x: 2.5, y: 4.5, width: 11, height: 8.5, rx: 2 }),
    h("path", { d: "M8 4.5V2.5" }),
    h("path", { d: "M6 8.5v1M10 8.5v1" }));
}

/** The first sentence or so of what an agent was told it is for. */
function purpose(agent) {
  const text = String(agent.instructions || "").replace(/\s+/g, " ").trim();
  if (text.length <= 220) return text;
  const cut = text.slice(0, 220);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 120))}…`;
}

/**
 * The Agents page: a person's own agents, as Pramanyx keeps them. An agent is made and changed in Pramanyx; here
 * it is asked. The page uses the full width it is given.
 */
function AgentsPage({ ask }) {
  const [agents, setAgents] = useState(null);
  const [connections, setConnections] = useState([]);
  const [down, setDown] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([read("/agents/custom"), read("/connections")])
      .then(([mine, all]) => { if (live) { setAgents(mine.filter((a) => a.enabled !== false)); setConnections(all); } })
      .catch(() => { if (live) setDown(true); });
    return () => { live = false; };
  }, []);
  const named = (id) => connections.find((c) => c.id === id)?.name || id || "";
  const page = { height: "100%", overflow: "auto", boxSizing: "border-box", padding: "28px 32px", fontSize: 13,
                 color: "var(--dsw-alias-label-primary)", background: "var(--dsw-alias-bg-base)" };
  return h("div", { style: page },
    h("h1", { style: { margin: 0, fontSize: 18, fontWeight: 600 } }, "Agents"),
    h("p", { style: { ...quiet, margin: "4px 0 20px" } }, "Each agent answers the way it was set up."),
    down ? h("p", { style: quiet }, "The agents could not be read just now.")
      : agents === null ? h("p", { style: quiet }, "Reading your agents…")
        : !agents.length ? h("p", { style: quiet }, "There are no agents yet.")
          : h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 } },
              agents.map((agent) => h("section", {
                key: agent.id,
                style: { display: "flex", flexDirection: "column", gap: 8, borderRadius: 10, padding: 14, background: surface },
              },
                h("div", { style: { fontSize: 15, fontWeight: 600 } }, agent.name),
                agent.connection_id ? h("div", { style: { ...quiet, fontSize: 12 } }, `Answers on ${named(agent.connection_id)}`) : null,
                h("div", { style: { flex: "1 1 auto", lineHeight: 1.5 } }, purpose(agent) || "No description."),
                h("div", null, h("button", {
                  type: "button", onClick: () => ask(agent), className: "pramanyx-home-soft",
                  style: { font: "inherit", fontSize: 12, color: "inherit", cursor: "pointer", padding: "5px 12px", background: soft, border: 0, borderRadius: 4 },
                }, "Ask this agent"))))));
}

const SCHEDULES = "pramanyx-schedules";

/** The sidebar's drawing for Schedules: a clock face, in the colour of the text beside it. */
function SchedulesIcon({ size = 16 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
    h("circle", { cx: 8, cy: 8, r: 5.5 }),
    h("path", { d: "M8 5v3.2l2 1.3" }));
}

/**
 * The Schedules page. THERE IS ONE SCHEDULER, and it is the platform's (the user, 2026-11-15: "the scheduler needs
 * to be one across the platform"). The shell's own — a timed reminder into a conversation, kept in the shell and seen
 * by nobody else — is off (`profile.patch.yml`), and this page keeps no list of its own: it is the app's own page of
 * schedules and automations, in a frame, so everything on it works (make one, change when it runs, mute it, run it
 * now, read what each run did) and it is the same list every other surface shows. It opens on the connection last
 * chosen on the first screen; the page itself changes connection.
 */
function SchedulesPage() {
  const connection = remembered();
  const asked = /^[A-Za-z0-9_-]{1,64}$/.test(connection) ? `?conn=${encodeURIComponent(connection)}` : "";
  return h("iframe", {
    src: `${appOrigin()}/automations${asked}`, title: "Schedules", referrerPolicy: "no-referrer",
    style: { width: "100%", height: "100%", border: 0, display: "block", background: "var(--dsw-alias-bg-base)" },
  });
}

const WITH_OTHERS = "pramanyx-with-others";
const IN_THE_APP = "pramanyx-in-the-app";

/** The sidebar's drawing for conversations with others: two heads. */
function WithOthersIcon({ size = 16 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
    h("circle", { cx: 6, cy: 5.5, r: 2.2 }), h("path", { d: "M2 13c.4-2.3 2-3.6 4-3.6s3.6 1.3 4 3.6" }),
    h("circle", { cx: 11.2, cy: 6.3, r: 1.8 }), h("path", { d: "M11.4 9.6c1.5.2 2.4 1.3 2.6 3" }));
}

/**
 * THE PLATFORM'S CONVERSATIONS, LISTED HERE AND OPENED AS THE APP'S OWN THREADS. Two lists use it:
 *
 *  - CONVERSATIONS WITH OTHERS (2026-11-17; the user: "there cannot be shared conversations unless users add other users
 *    in it"). This coworker is its person's alone; a conversation more than one person is in lives on the platform,
 *    where each person is known: everyone added sees it as it grows and asks in it as themselves, with "Add people".
 *  - YOUR CONVERSATIONS IN THE APP (2026-11-20, "One record for all"): what the person asked in the Ask panel or on a
 *    Data Canvas, the same record this coworker's turns are filed in (`./threads.js`).
 *
 * Each opens as the app's own page, in a frame — the same thread, the same answers.
 */
function AppThreadsPage({ pick, heading, note, empty, back, rowOf }) {
  const [threads, setThreads] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    let live = true;
    read("/chat-sessions?limit=50").then((all) => { if (live) setThreads(pick(all)); }).catch(() => { if (live) setThreads([]); });
    return () => { live = false; };
  }, []);
  if (open) {
    const conn = /^[A-Za-z0-9_-]{1,64}$/.test(open.connection || "") ? `&conn=${encodeURIComponent(open.connection)}` : "";
    return h("div", { style: { display: "flex", flexDirection: "column", height: "100%" } },
      h("div", { style: { padding: "8px 14px", fontSize: 12, display: "flex", gap: 10, alignItems: "center" } },
        h("button", { type: "button", onClick: () => setOpen(null), className: "pramanyx-home-soft",
                      style: { font: "inherit", color: "inherit", background: soft, border: 0, borderRadius: 4, padding: "2px 10px", cursor: "pointer" } },
          back),
        h("span", { style: quiet }, open.title)),
      h("iframe", {
        src: `${appOrigin()}/?tab=chat&chat=${encodeURIComponent(open.session_id)}${conn}`, title: open.title,
        referrerPolicy: "no-referrer", style: { flex: "1 1 auto", width: "100%", border: 0, display: "block", background: "var(--dsw-alias-bg-base)" },
      }));
  }
  return h("div", { style: { padding: "22px 26px", fontSize: 13, maxWidth: 760 } },
    h("div", { style: { fontSize: 15, fontWeight: 600, paddingBottom: 4 } }, heading),
    h("div", { style: { ...quiet, paddingBottom: 14 } }, note),
    threads === null ? h("div", { style: quiet }, "Reading your conversations…")
      : !threads.length ? h("div", { style: quiet }, empty)
        : threads.map((t) => h(Row, { key: t.session_id, text: rowOf(t), onPick: () => setOpen(t) })));
}

function WithOthersPage() {
  return h(AppThreadsPage, {
    pick: withOthers, heading: "Conversations with others", back: "All conversations with others",
    note: "This coworker is yours alone. A conversation with others is the platform's: everyone added sees it as it grows and asks in it as themselves. Start one in the app, then Add people.",
    empty: "You are in no conversation with others yet.",
    rowOf: (t) => `${t.title} — ${t.owner ? `${t.owner}'s, ` : ""}with ${(t.members || []).length + 1} people`,
  });
}

function InTheAppPage() {
  return h(AppThreadsPage, {
    pick: inTheApp, heading: "Your conversations in the app", back: "All your conversations in the app",
    note: "What you asked in the app, beside your work in the Ask panel or on a Data Canvas. It is one record with this coworker's: each of your conversations here is listed in the app too.",
    empty: "You have no conversations in the app yet.",
    rowOf: (t) => `${t.title}${t.turns ? ` — ${t.turns} ${t.turns === 1 ? "turn" : "turns"}` : ""}`,
  });
}

/** The sidebar's drawing for conversations in the app: a window with a line of talk. */
function InTheAppIcon({ size = 16 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
    h("rect", { x: 2, y: 2.5, width: 12, height: 11, rx: 1.5 }), h("path", { d: "M2 5.5h12M5 8.5h6M5 11h4" }));
}

const BACK = "pramanyx.coworker.back";
const CARRIED = "#pramanyx:";

/** An http(s) address on this machine: the only kind this page will keep as the way back, or send a person to. */
function onThisMachine(address) {
  try {
    const to = new URL(address);
    return (to.protocol === "http:" || to.protocol === "https:") && ["localhost", "127.0.0.1", "[::1]"].includes(to.hostname);
  } catch { return false; }
}

function wayBack() {
  try { const kept = localStorage.getItem(BACK) || ""; return onThisMachine(kept) ? kept : ""; } catch { return ""; }
}

/** Where the app is: the address this page was reached from, else where the app is served on a machine of its own. */
function appOrigin() {
  try { const back = wayBack(); if (back) return new URL(back).origin; } catch { /* the default */ }
  return "http://localhost:3000";
}

/**
 * ARRIVING FROM THE APP. The app's nine dots open this page with three things in the address's fragment: the
 * connection the person was on, light or dark, and the app's own address. A new conversation is opened on that
 * connection's workspace, the theme is set to the app's, and the address is kept as the way back. The fragment is
 * then taken off, so a reload is not a second arrival. Each is checked: a connection is an id, a theme is one of
 * two words, and the way back is an address on this machine — it came in an address anyone could write.
 */
function arrive(ctx) {
  if (!location.hash.startsWith(CARRIED)) return;
  const said = new URLSearchParams(location.hash.slice(CARRIED.length));
  history.replaceState(null, "", location.pathname + location.search);
  const back = said.get("back") || "";
  if (onThisMachine(back)) { try { localStorage.setItem(BACK, back); } catch { /* the dots are not drawn this visit */ } }
  const theme = said.get("theme");
  if (theme === "dark" || theme === "light") {
    ctx.inject(["theme"], (at) => { try { at.theme.setTheme(theme); } catch { /* the shell's own theme stands */ } });
  }
  const connection = said.get("conn") || "";
  if (/^[A-Za-z0-9_-]{1,64}$/.test(connection)) openOn(ctx, connection);
}

/** A new conversation on a connection's workspace, once the shell has read its workspaces. Gives up quietly. */
function openOn(ctx, connection, tries = 0) {
  const folder = new RegExp(`[\\\\/]connections[\\\\/]${connection}(?:[\\\\/"]|$)`);
  let found = null;
  try {
    const items = ctx.uiWorkspace?.workspaces?.list?.getSnapshot?.()?.items ?? [];
    found = items.find((item) => folder.test(JSON.stringify(item))) ?? null;
  } catch { found = null; }
  if (found?.workspaceId !== undefined) { ctx.uiWorkspace.startSession(found.workspaceId); return; }
  if (tries < 40) setTimeout(() => openOn(ctx, connection, tries + 1), 250);
}

/** A glyph as the platform draws it (`web/components/ui/icon.tsx`): Tabler's outline on its 24-unit grid, at the stroke
 *  that renders near 1.1 device pixels at its size beside regular text (`opticalStroke`). */
function Glyph({ size, paths }) {
  const stroke = Math.min(2.4, Math.max(1.0, Math.round((26 / size) * 100) / 100));
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: stroke,
                    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
    paths.map((d) => h("path", { key: d, d })));
}

/** The nine dots — Tabler's grid-dots, the platform's own (`apps`). */
const DOTS = [5, 12, 19].flatMap((y) => [4, 11, 18].map((x) => `M${x} ${y}a1 1 0 1 0 2 0a1 1 0 1 0 -2 0`));
function NineDots() { return h(Glyph, { size: 16, paths: DOTS }); }

/** The sidebar's toggle — Tabler's layout-sidebar, the platform's own (`panel`). */
const PANEL = ["M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12", "M9 4l0 16"];

/**
 * The nine dots, here: the way back to the app. The same control, in the same corner, as the one that led here.
 * Drawn only when this page was reached from the app, which is when there is a place to go back to.
 */
function Switcher() {
  const [open, setOpen] = useState(false);
  const host = useRef(null);
  const back = wayBack();
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (host.current && !host.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  if (!back) return null;
  const row = { display: "flex", gap: 10, alignItems: "center", padding: "8px 9px", borderRadius: 6, color: "inherit", textDecoration: "none" };
  const tile = { width: 32, height: 32, flex: "none", borderRadius: 6, background: soft, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 };
  const words = (name, note) => h("span", { style: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 } },
    h("span", { style: { fontSize: 13, fontWeight: 600 } }, name), h("span", { style: { ...quiet, fontSize: 12 } }, note));
  return h("div", { ref: host, style: { position: "relative", display: "inline-flex" } },
    h("button", {
      type: "button", "aria-label": "Switch to", title: "Switch to the app", "aria-expanded": open, className: "pramanyx-bar-icon",
      "data-open": open || undefined, onClick: () => setOpen((was) => !was), style: { width: 26, height: 26 },
    }, h(NineDots)),
    open ? h("div", {
      role: "menu", "aria-label": "Switch to",
      style: { position: "absolute", right: 0, top: 32, zIndex: 60, width: 300, boxSizing: "border-box", padding: 8, display: "flex",
               flexDirection: "column", gap: 2, fontSize: 13, color: "var(--dsw-alias-label-primary)",
               background: "var(--dsw-alias-bg-layer-2, color-mix(in srgb, currentColor 8%, var(--dsw-alias-bg-base, #111113)))", borderRadius: 8,
               boxShadow: "0 16px 40px rgba(0, 0, 0, 0.35)" },
    },
      h("span", { style: { ...quiet, fontSize: 12, padding: "2px 9px 6px" } }, "Switch to"),
      h("a", { role: "menuitem", href: back, className: "pramanyx-home-row", style: row }, h("span", { style: tile, "aria-hidden": "true" }, "P"), words("Pramanyx", "The platform.")),
      h("div", { role: "menuitem", "aria-current": "page", style: { ...row, background: faint } }, h("span", { style: tile, "aria-hidden": "true" }, "C"), words("Coworker", "You are here."))) : null);
}

/**
 * The bar across the top, as the platform's (the user, 2026-11-23, of a reference product's two apps side by side:
 * "you see how the top bar in both ... looks so aligned? Its literally the same. Can we have similar UX in both our
 * platform and coworker UI? Its the same font size, logo size, bar height, etc."). At the platform's measures
 * (`web/app/page.tsx` TopBar, `.aug-topbar`): 48 tall, 14 in from each side, the frame's own fill and no line under
 * it; on the left the sidebar's toggle (23, a 15 glyph) and the logo 18 tall; on the right the nine dots (26, a 16
 * glyph) and the person's mark (20). The shell has no row for a bar, so it stands in the overlay the shell always draws,
 * and the frame under it is set 48 lower (`HOME_LOOK`) — only while the bar is drawn, so a bar that fails leaves no gap.
 * The sidebar's own head (its logo and toggle) gives way to it; its toggle is pressed from here.
 */
function sidebarToggle() {
  // the shell's own seat for the toggle while the sidebar is a drawer, else the toggle in the sidebar's head
  return document.querySelector("[data-shell-leading] button") || document.querySelector("[data-sidebar-toggle]");
}

function TopBar() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const read = () => setCollapsed(Boolean(document.querySelector('[class$="_frame"][data-sidebar-collapsed]')));
    const watch = new MutationObserver(read);
    watch.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-sidebar-collapsed"] });
    read();
    return () => watch.disconnect();
  }, []);
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return h("div", { "data-pramanyx-bar": "", role: "banner" },
    h("button", { type: "button", className: "pramanyx-bar-icon", "aria-label": label, title: label, "aria-expanded": !collapsed,
                  onClick: () => sidebarToggle()?.click(), style: { width: 23, height: 23, marginLeft: -4 } },
      h(Glyph, { size: 15, paths: PANEL })),
    h("span", { style: { display: "inline-flex", alignItems: "center", marginLeft: -7 } }, h(Logo, { height: 18 })),
    h("div", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 } },
      h(Switcher), h(PersonMark)));
}

/** The person's mark, as the platform draws it while no identity is configured (`AuthControl`, `StaticAvatar`). */
function PersonMark() {
  return h("div", { className: "pramanyx-bar-person", title: "No identity configured" }, h("span", null, "AU"));
}

/**
 * A SCHEDULED RUN REACHES ITS PERSON (punch list 85, 2026-11-18). The coworker's server reads the runs of the schedules
 * each conversation made and keeps which conversations a run landed in since they were last opened (`/pramanyx-runs`,
 * `runsReachThePerson`). The sidebar's row carries a mark for each, until the conversation is opened. One read serves
 * every row, again every half minute.
 */
const landed = { unread: {}, listeners: new Set(), started: false };

function publishLanded(unread) {
  const was = landed.unread;
  landed.unread = unread && typeof unread === "object" ? unread : {};
  for (const listen of landed.listeners) listen(landed.unread);
  // A run newly landed: the schedule's card in its conversation reads its runs again (`answer-card`, `Scheduled`).
  for (const [conversation, run] of Object.entries(landed.unread)) {
    if (run && was[conversation]?.at !== run.at) {
      window.dispatchEvent(new CustomEvent("pramanyx:run-landed", { detail: { automation: String(run.automation || ""), conversation } }));
    }
  }
}

function readLanded() {
  fetch("/pramanyx-runs", { headers: { accept: "application/json" } })
    .then((answer) => (answer.ok ? answer.json() : null))
    .then((got) => { if (got) publishLanded(got.unread); })
    .catch(() => {});
}

function useLanded() {
  const [unread, setUnread] = useState(landed.unread);
  useEffect(() => {
    landed.listeners.add(setUnread);
    if (!landed.started) {
      landed.started = true;
      readLanded();
      setInterval(readLanded, 30_000);
    }
    return () => { landed.listeners.delete(setUnread); };
  }, []);
  return unread;
}

/** The time a run landed, in the person's own clock. */
function landedAt(stamp) {
  const d = new Date(stamp);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

/** The mark on a conversation's row: a scheduled run landed in it since it was last opened. */
export function RunLanded({ sessionId }) {
  const unread = useLanded();
  const run = unread[String(sessionId)];
  if (!run) return null;
  const said = `A scheduled run finished${run.name ? `: ${run.name}` : ""}${run.at ? `, ${landedAt(run.at)}` : ""}. Open the conversation to read it.`;
  return h("span", { "data-pramanyx-run-landed": "", role: "img", "aria-label": said, title: said,
                     style: { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "currentColor", opacity: 0.8 } });
}

/** Mounted while a conversation is open: a run that landed in it is read now, so its mark goes. */
export function SeenWhenOpen({ sessionId }) {
  const unread = useLanded();
  const id = String(sessionId || "");
  const waiting = !!(id && unread[id]);
  useEffect(() => {
    if (!waiting) return;
    fetch("/pramanyx-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: id }) })
      .then(() => { const next = { ...landed.unread }; delete next[id]; publishLanded(next); })
      .catch(() => {});
  }, [id, waiting]);
  return null;
}

/**
 * NO CONVERSATION STAYS STUCK (2026-11-20; see `./stuck.js`). Mounted with each conversation as it opens: read once,
 * when its page has settled, a conversation the shell lists as blank but draws as begun is archived through the shell's
 * own Archive and a fresh one is opened in its place, on the same connection. Set by `apply`.
 */
let uiWorkspaceOf = () => null;
const decidedThisPage = new Set();

export function Unstick({ sessionId }) {
  const here = useRef(null);
  useEffect(() => {
    const id = String(sessionId || "");
    const ui = uiWorkspaceOf();
    if (!id || !ui) return undefined;
    let live = true;
    unstick(id, {
      decided: decidedThisPage,
      read: () => ({
        summary: ui.sessions?.list?.getSnapshot?.()?.byId?.[id],
        phase: here.current?.closest?.("[data-phase]")?.getAttribute("data-phase") || "",
      }),
      retire: async (stuck) => {
        if (!live) return;
        const workspace = workspaceOf(ui.workspaces?.list?.getSnapshot?.()?.items, stuck);
        try { await ui.archiveSession(stuck); } catch { return; }      // not archived: it is read again on the next load
        if (workspace !== undefined) ui.startSession(workspace);
      },
    }).catch(() => { /* the conversation stays as the shell drew it */ });
    return () => { live = false; };
  }, [sessionId]);
  return h("span", { ref: here, "data-pramanyx-unstick": "", hidden: true });
}

export const inject = ["slots", "uiWorkspace"];

/** The zone this page's browser is in, told to the coworker's server once per load (`keepTheClock`, 2026-11-17): the
 *  platform counts "yesterday" from it whenever the person set no clock of their own. */
function tellTheClock() {
  let zone = "";
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { zone = ""; }
  if (!zone) return;
  fetch("/pramanyx-clock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ zone }) })
    .catch(() => {});
}

export function apply(ctx) {
  wearHomeLook();
  arrive(ctx);
  tellTheClock();
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register({ name: "shell.overlay", id: "pramanyx-bar" }, TopBar));
  ctx.slots.inject("conversation.hero.options", () =>
    ctx.slots.register({ name: "conversation.hero.options", id: "pramanyx-coworker-home" }, Home));

  // A sidebar entry and the page it opens share one id: the shell's sidebar owns the button and its label.
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register({ name: "sidebar.panellist", id: AGENTS, order: 5, label: () => "Agents" }, AgentsIcon));
  ctx.slots.inject("main", () =>
    ctx.slots.register({
      name: "main", key: AGENTS,
      inject: () => ({
        // A new conversation with the question begun. Nothing is asked until a person finishes and sends it.
        ask: (agent) => ctx.uiWorkspace.startSession(void 0, { prompt: `Ask the ${agent.name} agent: `, whenDraftExists: "append" }),
      }),
    }, AgentsPage));

  // Schedules: the same pairing. The shell's own entry of that name is off with its scheduler.
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register({ name: "sidebar.panellist", id: SCHEDULES, order: 6, label: () => "Schedules" }, SchedulesIcon));
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: SCHEDULES }, SchedulesPage));

  // Conversations with others (2026-11-17): the group conversations this person is in, as the app's own threads.
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register({ name: "sidebar.panellist", id: WITH_OTHERS, order: 7, label: () => "With others" }, WithOthersIcon));
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: WITH_OTHERS }, WithOthersPage));

  // Your conversations in the app (2026-11-20): one record for both places, opened as the app's own threads.
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register({ name: "sidebar.panellist", id: IN_THE_APP, order: 8, label: () => "In the app" }, InTheAppIcon));
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: IN_THE_APP }, InTheAppPage));

  // A scheduled run that landed while the person was away (punch list 85): marked on its conversation's row until it
  // is opened.
  ctx.slots.inject("sidebar.session.row.trailing", () =>
    ctx.slots.register({ name: "sidebar.session.row.trailing", id: "pramanyx-run-landed", order: 50 }, RunLanded));
  ctx.slots.inject("conversation.session.header.utilities", () =>
    ctx.slots.register({ name: "conversation.session.header.utilities", id: "pramanyx-run-seen", order: 99 }, SeenWhenOpen));
  // A conversation the shell lists as blank but draws as begun is retired as it opens (2026-11-20, `./stuck.js`).
  uiWorkspaceOf = () => ctx.uiWorkspace ?? null;
  ctx.slots.inject("conversation.session.header.utilities", () =>
    ctx.slots.register({ name: "conversation.session.header.utilities", id: "pramanyx-unstick", order: 100 }, Unstick));
}
