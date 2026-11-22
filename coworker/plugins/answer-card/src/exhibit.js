/**
 * An answer as an exhibit, the way a Data Canvas shows one: the chart, under it the tables read and the row count
 * with Table and SQL on the right; the table opens in place; the SQL and "Edit visualization" open beside the
 * conversation, as tabs of the shell's right-hand pane.
 *
 * This file holds what the card and the pane share: which answers this page has seen, what a person chose in the
 * editor for each, and the two things drawn in both places (the result grid and the editor).
 */
import { createElement as h, useEffect, useState, useSyncExternalStore } from "react";
import { labelOf, numericColumns } from "./chart";

export const line = "color-mix(in srgb, currentColor 18%, transparent)";
export const faint = "color-mix(in srgb, currentColor 6%, transparent)";
/* Borders are the exception (the platform's rule, 2026-11-20): an action is a soft fill, a block of code or a chart sits
   on a surface, and a line is kept where it carries the reading — a table's rows, a rule between sections. */
export const soft = "color-mix(in srgb, currentColor 9%, transparent)";
export const surface = `var(--dsw-alias-bg-layer-1, ${faint})`;
/** The one action a card waits on (Send, Allow): the platform's accent, as the box's own send button is. */
export const primary = (off) => ({
  ...button(false), fontWeight: 600, background: "var(--dsw-alias-state-business-primary, #46a0c4)",
  color: "var(--dsw-alias-bg-base, #ffffff)", opacity: off ? 0.5 : 1, cursor: off ? "default" : "pointer",
});
export const code = `var(--dsw-alias-markdown-code-block, ${faint})`;
export const quiet = { opacity: 0.68 };
export const button = (on) => ({
  font: "inherit", fontSize: 12, padding: "3px 10px", borderRadius: 4, cursor: "pointer", color: "inherit",
  border: 0, background: on ? "color-mix(in srgb, currentColor 18%, transparent)" : soft,
});

// ── what this page has seen, and what was chosen for it ──────────────────────────────────────────────────────

const SEEN = new Map();        // answer id → { answer, asked }
const watching = new Set();
let turn = 0;
const tell = () => { turn += 1; watching.forEach((heard) => heard()); };
const watch = (heard) => { watching.add(heard); return () => watching.delete(heard); };

/** Re-draw whenever an answer is seen or a choice changes. */
export const useExhibits = () => useSyncExternalStore(watch, () => turn);

/** An id for an answer: its record's, when it has one; else one made from the question and the SQL. */
export function idOf(answer, asked) {
  if (answer?.investigation_id) return String(answer.investigation_id);
  const text = `${asked || answer?.question || ""}\n${answer?.sql || ""}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `q${(hash >>> 0).toString(36)}`;
}

export function remember(id, answer, asked) {
  if (SEEN.get(id)?.answer === answer) return;
  SEEN.set(id, { answer, asked });
  tell();
}

export const seen = (id) => SEEN.get(id) ?? null;

/** An id for something a step read: made from the tool and what it was asked for. */
export function thingId(tool, args) {
  const text = `${tool}\n${JSON.stringify(args ?? {})}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `t${(hash >>> 0).toString(36)}`;
}

/** Remember what a step read — a metric's definition, an object, the Briefing — so a tab can show it. */
export function rememberThing(id, title, value) {
  if (SEEN.get(id)?.value === value) return;
  SEEN.set(id, { title, value });
  tell();
}

/**
 * A person's chart choices for their answers are the platform's (2026-11-20, one chart editor: "why do we three
 * distinct type of viz editors???????? … Dashboard has the best one"). "Edit visualization" opens the platform's own
 * editor beside the conversation (`/chart/<answer id>`), which keeps them under scope "coworker" (`/viz-configs`); they are
 * read here and the chart is drawn from them as the platform draws it (`chart.ts`). The coworker's own editor, and the
 * choices it kept in this browser (`pramanyx.coworker.viz.<id>`), are gone: a chart edited there before is drawn as answered.
 */
const SCOPE = "coworker";
const SAVED_MESSAGE = "pramanyx:chart-saved";
let saved = null;        // answer id → the platform's chart choices; null until first read
let reading = null;
function readSaved() {
  if (reading) return reading;
  reading = fetch(`/pramanyx/viz-configs?scope_key=${SCOPE}`, { headers: { accept: "application/json" } })
    .then((answer) => (answer.ok ? answer.json() : {}))
    .catch(() => ({}))
    .then((got) => { saved = new Map(Object.entries(got && typeof got === "object" ? got : {})); reading = null; tell(); });
  return reading;
}
let listening = false;
function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // the editor beside the conversation says when it kept a choice; coming back to the window reads them again
  window.addEventListener("message", (e) => { if (e?.data?.type === SAVED_MESSAGE) void readSaved(); });
  window.addEventListener("focus", () => { void readSaved(); });
}

// ── the pane: one kind of tab, addressed by what it shows and for which answer ───────────────────────────────

export const PANE = "pramanyx-answer";
export const PANE_PATTERN = "dsh-resource://pramanyx-answer/[\\s\\S]+";
export const addressOf = (what, id) => `dsh-resource://pramanyx-answer/${what}/${encodeURIComponent(id)}`;

export function readAddress(address) {
  const m = /^dsh-resource:\/\/pramanyx-answer\/(sql|viz|thing|page)\/(.+)$/.exec(String(address || ""));
  if (!m) return null;
  let id = m[2];
  try { id = decodeURIComponent(m[2]); } catch { /* as it came */ }
  return { what: m[1], id };
}

/** Set at start, when the shell has a right-hand pane: opens a tab, and says whether it could. */
let opener = null;
export const setOpener = (open) => { opener = open; };
export const hasPane = () => opener !== null;
export function openBeside(what, id) {
  if (!opener) return false;
  try { opener(addressOf(what, id)); return true; } catch { return false; }
}

// ── the result grid ──────────────────────────────────────────────────────────────────────────────────────────

const ROWS_SHOWN = 50;
const said = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
/** A cell's number, or null: a decimal arrives from a warehouse as text. */
const numberOf = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
};
/** The symbol a currency code prints as ("EUR" → "€"), or the code itself where the browser knows none. */
const symbolOf = (code) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
      .formatToParts(0).find((part) => part.type === "currency")?.value || code;
  } catch { return code; }
};
/** What the platform said each column is a figure of: `{column: "currency:EUR"}`. None said is none. */
export const unitsOf = (answer) => answer?.column_units ?? answer?.chart_config?.column_units ?? {};
/**
 * A cell as a person reads it. A number is grouped; a money column carries its currency's symbol, by the unit the
 * platform said (never guessed here from the column's name). `short` is for a figure standing alone: €17.86m.
 */
export const shown = (v, asNumber, unit = "", short = false) => {
  if (v === null || v === undefined) return "";
  const n = asNumber ? numberOf(v) : null;
  if (n === null) return String(v);
  const money = String(unit).toLowerCase().startsWith("currency:") ? symbolOf(String(unit).slice(9).trim().toUpperCase()) : "";
  if (short && Math.abs(n) >= 1e4) {
    const [scale, mark] = Math.abs(n) >= 1e9 ? [1e9, "bn"] : Math.abs(n) >= 1e6 ? [1e6, "m"] : [1e3, "k"];
    return `${money}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n / scale)}${mark}`;
  }
  return money ? `${money}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}` : said.format(n);
};

function toCsv(columns, rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}

/** The rows as they were answered, as a CSV file the browser saves. */
export function downloadCsv(answer) {
  const url = URL.createObjectURL(new Blob([toCsv(answer.columns ?? [], answer.rows ?? [])], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = "pramanyx-answer.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The rows, as a grid a person can read and take away: a click on a heading sorts by it, Totals adds the sum of
 * each column of numbers, Copy and CSV carry the rows as they came (unsorted, unformatted — what was answered).
 */
export function ResultGrid({ answer, compact = false }) {
  const columns = answer.columns ?? [];
  const rows = answer.rows ?? [];
  const total = typeof answer.row_count === "number" ? answer.row_count : rows.length;
  const [by, setBy] = useState(null);                 // { at, down }
  const [totals, setTotals] = useState(false);
  const [copied, setCopied] = useState(false);
  const numeric = numericColumns(columns, rows);
  const units = unitsOf(answer);
  const ordered = by === null ? rows : [...rows].sort((a, b) => {
    const x = a[by.at], y = b[by.at];
    const p = numeric[by.at] ? numberOf(x) : null, q = numeric[by.at] ? numberOf(y) : null;
    const less = x === y ? 0 : x === null || x === undefined ? 1 : y === null || y === undefined ? -1
      : p !== null && q !== null ? p - q : String(x).localeCompare(String(y));
    return by.down ? -less : less;
  });
  const sortBy = (at) => setBy((was) => (was?.at !== at ? { at, down: numeric[at] } : was.down === numeric[at] ? { at, down: !was.down } : null));
  const copy = () => {
    const text = [columns, ...rows].map((r) => r.join("\t")).join("\n");
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  const csv = () => downloadCsv(answer);
  const cell = { padding: compact ? "6px 10px" : "8px 12px", whiteSpace: "nowrap", borderTop: `1px solid ${line}` };
  // A cell is 13, as every table's on the platform (2026-11-20).
  const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, fontVariantNumeric: "tabular-nums" };
  const mark = (at) => (by?.at === at ? (by.down ? "↓" : "↑") : "↕");
  return h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
    h("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
      numeric.some(Boolean) ? h("button", { type: "button", "aria-pressed": totals, style: button(totals), onClick: () => setTotals((was) => !was) },
        totals ? "Σ Totals on" : "Σ Totals off") : null,
      h("span", { style: { flex: "1 1 auto" } }),
      h("button", { type: "button", style: button(false), onClick: copy }, copied ? "Copied" : "Copy"),
      h("button", { type: "button", style: button(false), onClick: csv }, "CSV")),
    h("div", { style: { overflowX: "auto", border: `1px solid ${line}`, borderRadius: 4 } },
      h("table", { style: { borderCollapse: "collapse", width: "100%", fontSize: 13 } },
        h("thead", null, h("tr", { style: { background: faint } },
          columns.map((c, i) => h("th", {
            key: c, scope: "col", "aria-sort": by?.at === i ? (by.down ? "descending" : "ascending") : "none",
            style: { ...cell, borderTop: 0, padding: 0, fontWeight: 600, textAlign: numeric[i] ? "right" : "left" },
          }, h("button", {
            type: "button", onClick: () => sortBy(i), title: `Sort by ${c}`,
            style: { font: "inherit", fontWeight: 600, color: "inherit", background: "transparent", border: 0, cursor: "pointer", width: "100%",
                     padding: compact ? "6px 10px" : "8px 12px", textAlign: "inherit", whiteSpace: "nowrap" },
          }, labelOf(c), h("span", { "aria-hidden": "true", style: { ...quiet, paddingLeft: 6 } }, mark(i))))))),
        h("tbody", null, ordered.slice(0, ROWS_SHOWN).map((r, n) => h("tr", { key: n },
          r.map((v, i) => h("td", { key: i, style: { ...cell, ...mono, textAlign: numeric[i] ? "right" : "left" } }, shown(v, numeric[i], units[columns[i]])))))),
        totals ? h("tfoot", null, h("tr", { style: { background: faint } },
          columns.map((c, i) => h("td", { key: c, style: { ...cell, ...mono, fontWeight: 600, textAlign: numeric[i] ? "right" : "left" } },
            numeric[i] ? shown(rows.reduce((sum, r) => sum + (numberOf(r[i]) ?? 0), 0), true, units[c]) : i === 0 ? "Total" : "")))) : null)),
    total > rows.length || rows.length > ROWS_SHOWN ? h("div", { style: { ...quiet, fontSize: 12 } },
      `${Math.min(rows.length, ROWS_SHOWN)} of ${total} rows shown. Totals, Copy and CSV are over the ${rows.length} that came back.`) : null);
}

// ── the pane's two bodies ────────────────────────────────────────────────────────────────────────────────────

const page = { height: "100%", overflow: "auto", boxSizing: "border-box", padding: "14px 16px 24px", fontSize: 13,
               color: "var(--dsw-alias-label-primary)", display: "flex", flexDirection: "column", gap: 14 };
const heading = { fontSize: 13, fontWeight: 600 };

function SqlAndResult({ answer }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(answer.sql || "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return h("div", { style: page },
    h("div", { style: { fontSize: 15, fontWeight: 600 } }, answer.answer || answer.question || "Answer"),
    h(ResultGrid, { answer, compact: true }),
    h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
      h("span", { style: heading }, "SQL"), h("span", { style: { flex: "1 1 auto" } }),
      answer.sql ? h("button", { type: "button", style: button(false), onClick: copy }, copied ? "Copied" : "Copy SQL") : null),
    h("pre", {
      style: { margin: 0, padding: 12, borderRadius: 6, background: code, fontSize: 12,
               lineHeight: 1.55, overflowX: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
    }, answer.sql || "No SQL came back with this answer."));
}

// ── what an answer's receipt names ───────────────────────────────────────────────────────────────────────────

/**
 * The metrics, tables and objects an answer's receipt names, so each can open the app's own page for it. Read from
 * the receipt that comes with the answer; nothing is inferred. Metrics that were merely on offer are left out.
 */
export function groundingOf(answer) {
  const lines = answer?.receipt?.lineage;
  if (!Array.isArray(lines)) return null;
  const after = (ref) => String(ref || "").split(":").slice(1).join(":");
  const out = { tables: [], columns: [], objects: [], findings: [], metrics: [], definitions: [] };
  for (const item of lines) {
    const name = after(item?.ref);
    if (!name) continue;
    if (item.relation === "input" && !out.tables.includes(name)) out.tables.push(name);
    else if (item.relation === "column") {
      let roles = [];
      try { roles = JSON.parse(item.detail || "{}").roles ?? []; } catch { roles = []; }
      out.columns.push({ name, roles });
    } else if (item.relation === "grounded_in_graph") {
      // The graph holds two kinds of thing an answer leans on: an object of the ontology, and an earlier finding.
      // …and the links between objects, which name two things and open as neither.
      const ref = String(item.ref);
      if (ref.includes("-->")) continue;
      // A Definition a person wrote — what a business word means — that the answer was given as ground.
      if (ref.startsWith("glossary_term:definition:")) {
        const term = String(item.detail || "").trim() || ref.slice("glossary_term:definition:".length).replace(/-/g, " ");
        if (!out.definitions.includes(term)) out.definitions.push(term);
        continue;
      }
      const into = ref.startsWith("finding:") ? out.findings : ref.startsWith("table:") ? out.objects : null;
      if (into && !into.includes(name)) into.push(name);
    }
    else if (item.relation === "metric_drift") out.metrics.push({ name, departed: true, note: String(item.detail || "") });
    else if (item.relation === "metric_used" || item.relation === "trusted_metric") out.metrics.push({ name, departed: false, note: "" });
  }
  out.count = out.tables.length + out.columns.length + out.objects.length + out.findings.length + out.metrics.length
    + out.definitions.length;
  return out;
}

// ── the app's own pages, beside the conversation ─────────────────────────────────────────────────────────────

const BACK = "pramanyx.coworker.back";

/** Where the app is: the address this page was reached from, else where the app is served on a machine of its own. */
function appOrigin() {
  try {
    const kept = localStorage.getItem(BACK);
    if (kept) { const at = new URL(kept); if (["localhost", "127.0.0.1", "[::1]"].includes(at.hostname)) return at.origin; }
  } catch { /* the default */ }
  return "http://localhost:3000";
}

/** The app's page for a metric, an entity of the ontology, or an answer's receipt — a path on the app. */
export const pageFor = {
  metric: (name, connection) => `/metrics/${encodeURIComponent(name)}?conn=${encodeURIComponent(connection)}`,
  type: (name, connection) => `/ontology/${encodeURIComponent(name)}?conn=${encodeURIComponent(connection)}`,
  receipt: (id) => `/receipt/${encodeURIComponent(id)}`,
  definition: (term, connection) => `/definitions/${encodeURIComponent(term)}?conn=${encodeURIComponent(connection)}`,
  // The sheet's own name rides the address, so its tab can carry it: the app's page reads only the id.
  sheet: (id, name = "") => `/sheets/${encodeURIComponent(id)}${name ? `?name=${encodeURIComponent(name)}` : ""}`,
  // A schedule, on the app's own page of schedules and automations, opened on that one.
  schedule: (id, connection) => `/automations?conn=${encodeURIComponent(connection)}&focus=${encodeURIComponent(id)}&beside=1`,
  // What an answer can become (2026-11-17), each the app's own flow, started from the answer, finished by the person.
  toSchedule: (question, connection) => `/automations?conn=${encodeURIComponent(connection)}&sentence=${encodeURIComponent(question)}&beside=1`,
  toKeep: (question, connection, first = "") =>
    `/questions/keep?conn=${encodeURIComponent(connection)}&question=${encodeURIComponent(question)}${first ? `&first=${encodeURIComponent(first)}` : ""}`,
  toAgent: (question, connection) => `/agents/new?conn=${encodeURIComponent(connection)}&description=${encodeURIComponent(question)}`,
  // A deep analysis kept as a skill (punch list 88): its method, to run again on other values.
  toSkill: (investigation, connection) => `/skills/new?conn=${encodeURIComponent(connection)}&inv=${encodeURIComponent(investigation)}`,
  // A deep analysis's whole report, drawn by the platform's own report view (2026-11-23): one drawing of it everywhere.
  report: (investigation) => `/report/${encodeURIComponent(investigation)}`,
};
const NAMED = [[/^\/metrics\/([^/?]+)/, "Metric"], [/^\/ontology\/([^/?]+)/, "Ontology"], [/^\/receipt\//, "Why this number"],
               [/^\/sheets\/[^/?]+/, "Sheet"], [/^\/definitions\/([^/?]+)/, "Definition"], [/^\/automations\?/, "Schedule"],
               [/^\/questions\/keep\?/, "Keep on a dashboard"], [/^\/agents\/new\?/, "New agent"],
               [/^\/skills\/new\?/, "Save as a skill"], [/^\/chart\/[^/?]+/, "Edit visualization"], [/^\/report\/[^/?]+/, "Report"]];

/** A referenced spreadsheet's tab is called by its own name and nothing else — "Olist orders", not "Sheet". */
function sheetName(path) {
  const m = /^\/sheets\/[^/?]+\?(?:.*&)?name=([^&#]+)/.exec(path);
  if (!m) return "";
  try { return decodeURIComponent(m[1].replace(/\+/g, " ")); } catch { return m[1]; }
}

/** The sheets by the table each is read as, read once: an answer names a sheet's table, and its page wants its id. */
let sheetsRead = null;
export function sheetsByTable() {
  sheetsRead ??= fetch("/pramanyx/sheets", { headers: { accept: "application/json" } })
    .then((got) => (got.ok ? got.json() : { sheets: [] }))
    .then((got) => new Map((got.sheets ?? []).map((sheet) => [String(sheet.table || "").toLowerCase(), sheet])))
    .catch(() => new Map());
  return sheetsRead;
}

/** What a page tab is called: the kind of page, and the thing it is about. */
function pageName(path) {
  const named = sheetName(path);
  if (named) return named;
  for (const [shape, kind] of NAMED) {
    const m = shape.exec(path);
    if (!m) continue;
    let of = m[1] || "";
    try { of = decodeURIComponent(of); } catch { /* as it came */ }
    return of ? `${kind} · ${of}` : kind;
  }
  return "Pramanyx";
}

/**
 * One of the app's own pages, shown beside the conversation. Not a summary of it drawn here: the page itself —
 * a metric's definition as the Semantic Layer shows it, an entity as the Ontology shows it, an answer's
 * receipt as "Why this number" shows it, a spreadsheet as the asset it is (its name, origin and rows; none of the
 * Spreadsheets page's tools), a schedule on the page every schedule is kept on — because it is the app. Only the app's own paths for those are shown; anything else is refused, since the address arrives in a tab's name.
 */
/**
 * The platform's chart editor beside the conversation (`/chart/<answer id>`) reads the answer the platform stored; an
 * agent's answer is stored without its rows, so the page asks the window that opened it, and this hands it the rows
 * this page already has — only to the platform's own address, only for an answer it was asked about.
 */
let handingRows = false;
function handRows() {
  if (handingRows || typeof window === "undefined") return;
  handingRows = true;
  window.addEventListener("message", (e) => {
    if (e?.data?.type !== "pramanyx:chart-ready" || e.origin !== appOrigin() || !e.source) return;
    const id = String(e.data.id || "");
    const held = [...SEEN.values()].map((x) => x.answer).find((a) => a && String(a.investigation_id || "") === id);
    if (!held) return;
    e.source.postMessage({ type: "pramanyx:chart-data", id, headline: held.answer || held.question || "", columns: held.columns ?? [],
      rows: held.rows ?? [], chart_type: held.chart_type ?? null }, e.origin);
  });
}

function AppPage({ path }) {
  if (!NAMED.some(([shape]) => shape.test(path))) return h("div", { style: { ...page, ...quiet } }, "This tab names a page this pane does not show.");
  handRows();
  return h("iframe", {
    src: appOrigin() + path, title: pageName(path), referrerPolicy: "no-referrer",
    style: { width: "100%", height: "100%", border: 0, display: "block", background: "transparent" },
  });
}

// ── a thing a step read, laid out to be read ─────────────────────────────────────────────────────────────────

const isScalar = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);
const isCode = (key, v) => typeof v === "string" && (/sql|formula|expression|query/i.test(key) || /\bSELECT\b[\s\S]*\bFROM\b/i.test(v));
const pre = { margin: 0, padding: 10, borderRadius: 6, background: code, fontSize: 12, lineHeight: 1.55,
              whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };

/**
 * Whatever a tool handed back, as a page: its plain facts as a list of name and value, its SQL as SQL, a list of
 * like things as a grid that sorts, and what is inside it as its own section. Nothing is left out to make it
 * tidy and nothing is interpreted: this draws what came back, in the order it came.
 */
function Readable({ value, depth = 0 }) {
  if (isScalar(value)) return h("div", { style: { overflowWrap: "anywhere", whiteSpace: "pre-wrap" } }, value === null ? "—" : String(value));
  if (Array.isArray(value)) {
    if (!value.length) return h("div", { style: quiet }, "None");
    if (value.every(isScalar)) return h("div", { style: { overflowWrap: "anywhere" } }, value.map((v) => String(v)).join(", "));
    if (value.every((v) => v && typeof v === "object" && !Array.isArray(v))) {
      const columns = [...new Set(value.flatMap((row) => Object.keys(row)))].filter((c) => value.some((row) => isScalar(row[c]) && row[c] !== null && row[c] !== ""));
      if (columns.length) return h(ResultGrid, { compact: true, answer: { columns, rows: value.map((row) => columns.map((c) => (isScalar(row[c]) ? row[c] : JSON.stringify(row[c])))) } });
    }
    return h("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, value.map((v, i) => h(Readable, { key: i, value: v, depth: depth + 1 })));
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  const facts = entries.filter(([k, v]) => isScalar(v) && !isCode(k, v) && !(typeof v === "string" && v.length > 140));
  const rest = entries.filter((e) => !facts.includes(e));
  return h("div", { style: { display: "flex", flexDirection: "column", gap: 14 } },
    facts.length ? h("dl", { style: { margin: 0, display: "grid", gridTemplateColumns: "minmax(110px, 32%) 1fr", columnGap: 12, rowGap: 6 } },
      facts.flatMap(([k, v]) => [
        h("dt", { key: `${k}-n`, style: { ...quiet, margin: 0 } }, labelOf(k)),
        h("dd", { key: `${k}-v`, style: { margin: 0, overflowWrap: "anywhere" } }, v === null || v === "" ? "—" : String(v)),
      ])) : null,
    rest.map(([k, v]) => h("section", { key: k, style: { display: "flex", flexDirection: "column", gap: 6 } },
      h("div", { style: depth === 0 ? heading : { ...heading, ...quiet } }, labelOf(k)),
      isCode(k, v) ? h("pre", { style: pre }, v) : depth >= 3 && !isScalar(v) ? h("pre", { style: pre }, JSON.stringify(v, null, 2)) : h(Readable, { value: v, depth: depth + 1 }))));
}

function Thing({ title, value }) {
  return h("div", { style: page },
    h("div", { style: { fontSize: 15, fontWeight: 600 } }, title),
    typeof value === "string" ? h("pre", { style: pre }, value) : h(Readable, { value }));
}

function addressIn(props) {
  let info = null;
  try { info = props.useTabInfo?.((all) => all); } catch { info = null; }
  return readAddress(info?.tab?.navigation?.address ?? info?.tab?.contentId);
}

/** A tab's body: the SQL and the rows of an answer, or its chart's editor. */
export function PaneBody(props) {
  useExhibits();
  const at = addressIn(props);
  if (at?.what === "page") return h(AppPage, { path: at.id });
  const known = at ? seen(at.id) : null;
  if (!at || !known) {
    return h("div", { style: { ...page, ...quiet } },
      "This tab shows something from a conversation. Open that conversation and it is filled in; or close the tab.");
  }
  if (at.what === "thing") return h(Thing, { title: known.title, value: known.value });
  return h(SqlAndResult, { answer: known.answer });
}

/** A tab's name: what it shows, and of which answer. */
export function PaneTitle(props) {
  useExhibits();
  const at = addressIn(props);
  if (at?.what === "page") return h("span", { title: pageName(at.id) }, pageName(at.id));
  const known = at ? seen(at.id) : null;
  if (at?.what === "thing") return h("span", { title: known?.title || "" }, known?.title || "What was read");
  const of = known?.answer ?? null;
  const what = "SQL";
  const name = of ? (of.answer || of.question || "") : "";
  return h("span", { title: name ? `${what} — ${name}` : what }, name ? `${what} · ${name}` : what);
}

/** The platform's chart choices for one answer (by its stored id), re-read when the editor beside keeps one. */
export function useChosen(answerId) {
  useExhibits();
  listen();
  if (saved === null) void readSaved();
  return answerId && saved ? saved.get(String(answerId)) ?? null : null;
}
