/**
 * Pramanyx's name, mark, wording and look, on the coworker's page.
 *
 * The shell gives a deployment with its own identity four places to stand, and this fills them: the mark and name
 * in the sidebar and the mark over a new conversation (slots), the words on that first screen (the `conversation`
 * dictionary), the tab's icon, and the look (the `--dsw-*` variables every part of the shell is drawn from).
 *
 * Two things the shell does not offer, and this file works around rather than through. Its product name in the
 * browser tab is a literal in its layout, so the tab title is corrected as it is written. And a dictionary cannot
 * be added to: a second registration of a namespace and language is refused, and the refusal takes the shell's
 * own conversation plugin down with it (seen: the page would not load). So our phrases are written into the
 * shell's dictionaries after it has registered them. Both fail quietly back to the shell's wording.
 */
import { createElement as h } from "react";
import mark from "../assets/mark.png";
import { MARK_BOX, MARK_LINE, MARK_RING, MARK_RING_COLORS, NAME_BAR, NAME_BAR_STOPS, NAME_BOX, NAME_LETTERS } from "../../../../web/components/ui/brandArt";

const NAME = "Pramanyx";
const SHELL_NAME = "DeepSeek Harness";

/** The ring, one colour a step round its circle, each step just over its neighbour so no seam shows. */
const RING = MARK_RING_COLORS.map((fill, i) => {
  const { cx, cy, outer: [ox, oy], inner: [ix, iy] } = MARK_RING;
  const at = (step) => (step / MARK_RING_COLORS.length) * 2 * Math.PI;
  const [a, b] = [at(i - 0.15), at(i + 1.15)];
  const p = (angle, rx, ry) => `${(cx + rx * Math.cos(angle)).toFixed(1)} ${(cy + ry * Math.sin(angle)).toFixed(1)}`;
  return { fill, d: `M${p(a, ox, oy)}A${ox} ${oy} 0 0 1 ${p(b, ox, oy)}L${p(b, ix, iy)}A${ix} ${iy} 0 0 0 ${p(a, ix, iy)}Z` };
});

/** The mark, fitted inside the square the shell asks for: its outer line in the text's colour, around the ring. */
function Mark({ size, className }) {
  return h("span", { className, style: { display: "inline-flex", width: size, height: size, alignItems: "center", justifyContent: "center" } },
    h("svg", { width: size, height: Math.round(size * MARK_BOX.h / MARK_BOX.w), viewBox: `0 0 ${MARK_BOX.w} ${MARK_BOX.h}`, role: "img", "aria-label": NAME },
      h("path", { d: MARK_LINE, fill: "currentColor", fillRule: "evenodd" }),
      RING.map((w, i) => h("path", { key: i, d: w.d, fill: w.fill }))));
}

function Name() {
  const height = 15;
  return h("svg", { width: Math.round(height * NAME_BOX.w / NAME_BOX.h), height, viewBox: `0 0 ${NAME_BOX.w} ${NAME_BOX.h}`, role: "img", "aria-label": NAME },
    h("defs", null, h("linearGradient", { id: "pramanyx-name-bar" }, NAME_BAR_STOPS.map(([offset, stopColor]) => h("stop", { key: offset, offset, stopColor })))),
    h("path", { d: NAME_LETTERS, fill: "currentColor", fillRule: "evenodd" }),
    h("rect", { x: NAME_BAR.x, y: NAME_BAR.y, width: NAME_BAR.w, height: NAME_BAR.h, fill: "url(#pramanyx-name-bar)" }));
}

/**
 * The look: the platform's, so the coworker and the app read as one product (the user, 2026-11-20: "Copy the style to
 * the harness as well.. as well as the Colours.. let it match the theory as the platform"). Since that day the dark
 * theme is the reference palette the platform took the same day — the workspace #11171D, the sidebar and the surfaces
 * around the page #1F272D, the selected row #27343E, primary text #E8ECF0, secondary #92A4B3, primary blue #4399E0
 * under a dark label — and the platform's rule: surfaces define structure, borders are the exception (the sidebar is
 * told from the page by its fill, not a line; a control by a soft fill, not an outline). Corners stay small, as the
 * platform's. The light theme keeps the shell's own greys and takes only the accent, the corners and the type — the
 * app's light values were not measured, and a guess would be a second palette. The attribute is written twice so these
 * outrank the shell's own rule for it, whichever loads last.
 */
const STOPS = NAME_BAR_STOPS.map(([at, colour]) => `${colour} ${at * 100}%`).join(", ");

const LOOK = `
/*
 * The logo's colours, where the platform uses them: a thin edge around the box a person writes to the model in, the
 * platform's accent on its send button, and the bar that marks what is open. Never a fill.
 */
[data-composer-card][data-composer-card] {
  --pramanyx-ground: #ffffff;
  border: 1.5px solid transparent !important;
  border-radius: 12px !important;
  background: linear-gradient(var(--pramanyx-ground), var(--pramanyx-ground)) padding-box, linear-gradient(115deg, ${STOPS}) border-box !important;
  box-shadow: none !important;
}
body[data-ds-dark-theme] [data-composer-card][data-composer-card] { --pramanyx-ground: #171e24; }
[data-composer-card] [class*="_primary"] { background: #46a0c4 !important; color: #ffffff !important; }
body[data-ds-dark-theme] [data-composer-card] [class*="_primary"] { background: #4399e0 !important; color: #11171d !important; }
[data-composer-card] [class*="_primary"]:disabled { background: #2e3135 !important; color: #8b9099 !important; opacity: 1 !important; }
body[data-ds-dark-theme] [data-composer-card] [class*="_primary"]:disabled { background: #27343e !important; color: #718392 !important; }
body:not([data-ds-dark-theme]) [data-composer-card] [class*="_primary"]:disabled { background: #e8e9eb !important; color: #8b9099 !important; }
/* The shell's strip of turns, tokens and cache under the box: its own accounting, of no use to a person asking about a business. */
[class*="_dock"]:has(> [data-slot="conversation.composer.dock"]) { display: none !important; }
[class*="_sessionRow"][class*="_selected"] { position: relative; }
[class*="_sessionRow"][class*="_selected"]::before {
  content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; z-index: 1;
  background: linear-gradient(180deg, ${STOPS});
}
body[data-ds-dark-theme] [class*="_sessionRow"][class*="_selected"] { background: #27343e; }
/* The sidebar is the frame's surface: told from the page by its fill, no line at its edge and no macOS tint over it. */
body[data-ds-dark-theme] [class*="_sidebarCol"][class*="_sidebarCol"] { background: #1f272d !important; border-right: none !important; }
body:not([data-ds-dark-theme]) [class*="_sidebarCol"][class*="_sidebarCol"] { border-right: none !important; }
/* New conversation: a soft fill, not an outline — the platform's button at rest. */
[class*="_newSession"][class*="_newSession"] { border-color: transparent !important; box-shadow: none !important; }
body[data-ds-dark-theme] [class*="_newSession"][class*="_newSession"] { background: #27343e !important; }
body[data-ds-dark-theme] [class*="_newSession"][class*="_newSession"]:hover { background: #2e3d49 !important; }
/* A badge is its tint and its words, no edge. */
[class*="_previewBadge"] { border-color: transparent !important; }
/* The conversation list is a list: its rows at 13 and their times at 11, as every list on the platform (2026-11-20; it
   drew 14 and 10). Matched by the parts of the class names the shell writes by hand. */
[class*="_sidebarCol"] [class*="_title"] { font-size: 13px !important; }
[class*="_sidebarCol"] [class*="_time"] { font-size: 11px !important; }
body {
  --dsw-radius-xs: 2px; --dsw-radius-sm: 3px; --dsw-radius-md: 4px; --dsw-radius-lg: 6px; --dsw-radius-xl: 6px;
  --dsw-radius-panel: 6px;
  --dsw-font-family: "Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --dsw-font-family-brand: var(--dsw-font-family);
  --dsw-alias-link: #2b7fa3;
  --dsw-alias-state-business-primary: #2b7fa3;
}
body[data-ds-dark-theme][data-ds-dark-theme] {
  /* the platform's dark scale: 1 the workspace · 2 · 3 the sidebar and surfaces · 4 hover · 5 selected · 6-7 rules */
  --dsw-alias-bg-base: #11171d;
  --dsw-alias-bg-layer-1: #171e24;
  --dsw-alias-bg-layer-2: #1f272d;
  --dsw-alias-bg-layer-3: #27343e;
  --dsw-specific-sidebar-fill: #1f272d;
  --dsw-alias-settings-card-fill: #1f272d;
  --dsw-alias-settings-card-stroke: transparent;
  --dsw-alias-markdown-code-block: #171e24;
  --dsw-alias-markdown-inline-code: #1f272d;
  --dsw-alias-interactive-bg-hover-solid: #232e36;
  --dsw-alias-button-floating-fill: #1f272d;
  --dsw-alias-button-floating-hover: #27343e;
  --dsw-alias-tooltip-bg: #27343e;
  --dsw-alias-toast-bg: #27343e;
  --dsw-alias-label-primary: #e8ecf0;
  --dsw-alias-label-primary-dimmed: #e8ecf0;
  --dsw-alias-label-secondary: #92a4b3;
  --dsw-alias-label-tertiary: #92a4b3;
  --dsw-alias-label-caption: #718392;
  --dsw-alias-brand-primary: #e8ecf0;
  --dsw-alias-brand-text: #e8ecf0;
  --dsw-alias-link: #70b8ff;
  --dsw-alias-state-business-primary: #4399e0;
  --dsw-alias-state-business-tertiary: #27343e;
  /* rules: the few that stay, quiet (the platform's --divide); the shell's l3 edge is what drew the sidebar's line */
  --dsw-alias-border-l1: #232e36;
  --dsw-alias-border-l2: #27343e;
  --dsw-alias-border-l3: #2e3d49;
}
/*
 * The mark beside "…for 19s" while an answer is being worked on. The shell draws its own animal there and offers
 * no place to draw another, so its two drawings are hidden and an open ring turns in their box, in the logo's
 * colours. The ring is an SVG used as a mask. Matched by the part of the class name the shell writes
 * by hand; if that changes, the shell's drawing simply shows again.
 */
[data-chat-running] [class*="_runningIcon"] > * { display: none !important; }
[data-chat-running] [class*="_runningIcon"]::before {
  content: "";
  position: absolute;
  inset: 0;
  background: conic-gradient(${STOPS}, ${NAME_BAR_STOPS[0][1]});
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 2.25a5.75 5.75 0 1 0 5.75 5.75' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 2.25a5.75 5.75 0 1 0 5.75 5.75' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") center / contain no-repeat;
  animation: pramanyx-working 0.9s linear infinite;
}
@keyframes pramanyx-working { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  [data-chat-running] [class*="_runningIcon"]::before { animation: none; }
}
`;

function wearLook() {
  let style = document.getElementById("pramanyx-look");
  if (!style) {
    style = document.createElement("style");
    style.id = "pramanyx-look";
    document.head.appendChild(style);
  }
  style.textContent = LOOK;
  return () => style.remove();
}

/** The tab title, corrected as the shell writes it. The shell's name for itself is a literal in its layout. */
function nameTheTab() {
  const fix = () => {
    if (document.title.includes(SHELL_NAME)) document.title = document.title.split(SHELL_NAME).join(NAME);
  };
  fix();
  const title = document.querySelector("title");
  if (!title) return () => {};
  const watch = new MutationObserver(fix);
  watch.observe(title, { childList: true, characterData: true, subtree: true });
  return () => watch.disconnect();
}

/**
 * The tab's icon: the mark, centred on a square, in a colour the browser's own tab strip can show. The artwork is
 * one colour on nothing, so it is painted light for a dark browser and dark for a light one, and painted again
 * when that changes. Every icon link the shell wrote is pointed at it.
 */
function markTheTab() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const art = new Image();
  const paint = () => {
    const edge = 64;
    const canvas = document.createElement("canvas");
    canvas.width = edge; canvas.height = edge;
    const pen = canvas.getContext("2d");
    if (!pen) return;
    const width = 60, height = Math.round(width * MARK_BOX.h / MARK_BOX.w);
    pen.drawImage(art, (edge - width) / 2, (edge - height) / 2, width, height);
    pen.globalCompositeOperation = "source-in";
    pen.fillStyle = dark.matches ? "#edeef0" : "#111113";
    pen.fillRect(0, 0, edge, edge);
    const url = canvas.toDataURL("image/png");
    let links = [...document.querySelectorAll('link[rel~="icon"]')];
    if (!links.length) {
      const link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
      links = [link];
    }
    for (const link of links) { link.type = "image/png"; link.removeAttribute("sizes"); link.href = url; }
  };
  art.onload = paint;
  art.src = mark;
  dark.addEventListener("change", paint);
  return () => dark.removeEventListener("change", paint);
}

/**
 * Our words, by the shell's dictionary. The shell writes for someone about to build software, in sessions; a
 * person here asks about a business, in conversations.
 */
const WORDS = {
  conversation: {
    "hero.headline": "Ask your data anything",
    "hero.preview": "Coworker",
    "placeholder.hero": "Ask anything about your data, / for commands, @ for conversations",
  },
  sidebar: {
    "session.new": "New conversation",
    "session.new.label": "New conversation",
  },
  workspace: {
    "section.sessions": "Conversations",
    "search.placeholder": "Search conversations",
  },
  // No "How to answer" picker (2026-11-23): the shell's agent-preset seat is off (`profile.patch.yml`, `ui-agent-preset`),
  // so its words are not ours to say.
};

/**
 * Put our phrases in the shell's English dictionaries. It reaches into the locale service's own table, which is
 * not a promise the shell makes — so every step is allowed to find nothing, and then nothing changes. A phrase is
 * only ever written to what it should say, so running this again changes nothing more.
 */
function sayOurWords(locale) {
  try {
    let changed = false;
    const english = (namespace) => locale?.dicts?.get?.(namespace)?.get?.("en");
    for (const [namespace, words] of Object.entries(WORDS)) {
      const entries = english(namespace);
      if (!entries) continue;
      for (const [key, phrase] of Object.entries(words)) {
        if (entries[key] !== phrase) { entries[key] = phrase; changed = true; }
      }
    }
    if (changed) locale.publish?.(locale.snapshot?.active, false);
  } catch {
    // The shell's wording stands.
  }
}

/**
 * Other plugins register their dictionaries when they start, in an order this one is not told. The words are
 * said now and a few times more as the page settles; each pass after the first finds nothing left to change.
 */
function keepSayingOurWords(locale) {
  sayOurWords(locale);
  const timers = [300, 1200, 4000].map((wait) => setTimeout(() => sayOurWords(locale), wait));
  return () => timers.forEach(clearTimeout);
}

const VIEW = "dsh.workspace.view.v5";
const VIEW_SET = "pramanyx.coworker.view-set";

/**
 * Conversations in one list, newest first, the first time this page is opened in a browser. The shell's own
 * default files them under the folder each was started in, which means something to someone working in folders
 * and nothing to someone asking about a business. It is the shell's own view option, set once: a person who
 * picks another view afterwards keeps it.
 *
 * The shell reads its view before any plugin starts and keeps it in memory, so writing the stored copy changes
 * nothing on the page that is open (a first version did only that, and the first visit still showed folders).
 * The stored copy is written and the page is loaded once more, which a first visit shows as a brief flicker.
 *
 * THE STORED VIEW IS WHOLE (found 2026-11-15). The shell loads a stored view as it finds it, without its own
 * defaults under it, and two of its fields are read as objects. A first visit has no stored view, and this once
 * wrote only the two fields it changes: the shell's conversation list then failed to start and the sidebar showed
 * no conversations at all. The shell's own fields go under ours, and a view stored that way is mended once.
 */
const SHELL_VIEW = { groupBy: "workspace", orderBy: "updated", groupExpansion: {}, sessionOrderByAccount: {}, archivedFilter: "default" };

function isWhole(view) {
  return ["groupExpansion", "sessionOrderByAccount"].every((key) => view[key] && typeof view[key] === "object" && !Array.isArray(view[key]));
}

function listConversationsNewestFirst() {
  try {
    const stored = localStorage.getItem(VIEW);
    const view = JSON.parse(stored || "{}");
    if (localStorage.getItem(VIEW_SET)) {
      // Set before: mend a view this plugin once stored without the shell's own fields, and leave any other alone.
      if (!stored || isWhole(view)) return;
      localStorage.setItem(VIEW, JSON.stringify({ ...SHELL_VIEW, ...view, groupExpansion: {}, sessionOrderByAccount: {} }));
      window.location.reload();
      return;
    }
    localStorage.setItem(VIEW_SET, "1");
    if (view.groupBy === "flat" && (!stored || isWhole(view))) return;
    localStorage.setItem(VIEW, JSON.stringify({ ...SHELL_VIEW, ...view,
      ...(isWhole(view) ? {} : { groupExpansion: {}, sessionOrderByAccount: {} }), groupBy: "flat", orderBy: "updated" }));
    window.location.reload();
  } catch {
    // A browser that keeps nothing: the shell's default view stands.
  }
}

// `uiConversation` is asked for so this runs after the shell's conversation plugin has registered its dictionary.
export const inject = ["slots", "locale", "uiConversation"];

export function apply(ctx) {
  ctx.slots.inject("sidebar.brand.mark", () => ctx.slots.inject("sidebar.brand.name", function* () {
    yield ctx.slots.register({ name: "sidebar.brand.mark" }, Mark);
    yield ctx.slots.register({ name: "sidebar.brand.name" }, Name);
  }));
  ctx.slots.inject("conversation.hero.brand.mark", () =>
    ctx.slots.register({ name: "conversation.hero.brand.mark" }, Mark));
  listConversationsNewestFirst();
  const undo = [wearLook(), nameTheTab(), markTheTab(), keepSayingOurWords(ctx.locale)];
  ctx.on?.("dispose", () => undo.forEach((off) => off()));
}
