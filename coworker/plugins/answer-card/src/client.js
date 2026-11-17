/**
 * The Pramanyx answer card — how the coworker shows what Pramanyx answered.
 *
 * The shell's model is quick, and it retells: a reader of its prose cannot tell a faithful retelling from an
 * invented one. On the first end-to-end run (2026-11-13) its reply described the SQL as counting distinct orders
 * and dropping null countries; there was no way to check that from the page, and it was doubted. With this card
 * the SQL is one click away, and the description turned out to be right. So the answer is not left to a
 * retelling: this view takes the `ask` tool's own result and draws it — the chart, the table, the SQL and how it
 * was answered — and the model writes around it.
 *
 * It registers a view per Pramanyx tool in the shell's `tool.call.toolview` slot: the card for a tool that answers,
 * and for every tool a named row in the list of steps, so the work reads down as what was done and what it came
 * to. Nothing here calls Pramanyx, a model or the network: it reads the result the tool already returned.
 */
import { createElement as h, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readAgainIn } from "./runs.js";
import { drawChart, labelOf, numericColumns } from "./chart";
import {
  PANE, PANE_PATTERN, PaneBody, downloadCsv, groundingOf, pageFor, PaneTitle, ResultGrid, button, faint, hasPane, idOf, line,
  openBeside, quiet, remember, rememberThing, setOpener, shown, unitsOf, sheetsByTable, thingId, useChosen,
} from "./exhibit";

const TOOL = "mcp__pramanyx__ask";
/**
 * The tools whose result is an answer: `ask`, and one `ask_<agent>` per custom agent, which answers through the
 * same door in the same shape. The agents are a person's own and change, so their names cannot be listed here.
 */
const ANSWERS = /^mcp__pramanyx__ask(_[a-z0-9_]+)?$/;
const ROWS_SHOWN = 50;

/** The tool result's text, whichever of the shell's two shapes carries it. */
function resultText(block) {
  if (!block) return "";
  if (typeof block.text === "string" && block.text) return block.text;
  const parts = Array.isArray(block.content) ? block.content : [];
  return parts.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("");
}

/**
 * The answer as an object, or null. A long result reaches the page cut short, and the cut falls in the receipt,
 * which is the last and largest field — so a result that does not parse is tried again without it. A result cut
 * inside the rows is not guessed at: the card says it could not read it.
 */
export function readAnswer(text) {
  if (!text) return null;
  try {
    return { answer: inOneShape(JSON.parse(text)), whole: true };
  } catch {
    const at = text.indexOf('\n  "receipt":');
    if (at < 0) return null;
    try {
      return { answer: inOneShape(JSON.parse(text.slice(0, at).replace(/,\s*$/, "") + "\n}")), whole: false };
    } catch {
      return null;
    }
  }
}

/**
 * A custom agent's answer names two things differently from `ask`'s: its sentence is `headline`, and its receipt
 * is a `receipt_id`. Read as `ask`'s, the card was titled with the question and said no receipt was kept.
 */
function inOneShape(answer) {
  if (!answer || typeof answer !== "object") return answer;
  const out = { ...answer };
  if (out.answer == null && typeof out.headline === "string" && out.headline) out.answer = out.headline;
  if (out.has_receipt == null && out.receipt_id) out.has_receipt = true;
  return out;
}

/**
 * The chart, drawn to the width it has — and drawn again when that width changes. A chart is laid out for a width
 * in pixels when it is drawn; when the right-hand pane opened and the conversation narrowed, the chart kept its
 * old width and ran off the edge of its card.
 */
function Chart({ answer, viz }) {
  const box = useRef(null);
  const [none, setNone] = useState(false);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let waiting = 0;
    const watch = new ResizeObserver(() => {
      clearTimeout(waiting);
      waiting = setTimeout(() => setWidth(Math.floor(el.clientWidth)), 120);
    });
    watch.observe(el);
    return () => { clearTimeout(waiting); watch.disconnect(); };
  }, []);
  useEffect(() => {
    if (!box.current) return undefined;
    let remove = null;
    try {
      remove = drawChart(box.current, {
        columns: answer.columns ?? [], rows: answer.rows ?? [], chart_type: answer.chart_type,
        chart_config: answer.chart_config, column_units: unitsOf(answer), title: null, viz,
      });
    } catch {
      remove = null;
    }
    setNone(!remove);
    return () => { if (remove) remove(); };
  }, [answer, viz, width]);
  return h("div", { style: { minWidth: 0 } },
    h("div", { ref: box, style: { width: "100%", minHeight: none ? 0 : 220, overflow: "hidden" } }),
    none ? h("div", { style: { ...quiet, padding: "8px 0" } },
      "These rows have no chart worth drawing. The table has them.") : null);
}

function Sql({ answer }) {
  return h("pre", {
    style: { margin: 0, padding: 10, border: `1px solid ${line}`, borderRadius: 4, background: faint, fontSize: 12,
             overflowX: "auto", whiteSpace: "pre" },
  }, answer.sql || "No SQL came back with this answer.");
}

function How({ answer, whole }) {
  const steps = answer.analysis?.steps ?? [];
  const trusted = Array.isArray(answer.trusted_metrics) ? answer.trusted_metrics : [];
  const cost = answer.receipt?.artifact?.payload?.cost;
  const row = (label, value) => h("div", { style: { display: "flex", gap: 12, padding: "5px 0", borderTop: `1px solid ${line}` } },
    h("span", { style: { ...quiet, flex: "0 0 150px" } }, label), h("span", { style: { minWidth: 0 } }, value));
  return h("div", { style: { fontSize: 12.5 } },
    answer.analysis?.intent ? h("div", { style: { paddingBottom: 8 } }, answer.analysis.intent) : null,
    steps.length ? h("ol", { style: { margin: "0 0 8px", paddingLeft: 18 } }, steps.map((s, i) => h("li", { key: i }, s))) : null,
    row("Approved definitions", trusted.length
      ? trusted.map((t) => (typeof t === "string" ? t : t?.name || t?.label || JSON.stringify(t))).join(", ")
      : "None reported for this answer"),
    row("Tables read", (answer.tables_used ?? []).join(", ") || "Not reported"),
    row("Receipt", answer.has_receipt ? `Kept as ${answer.investigation_id || answer.receipt_id}` : "None kept"),
    cost ? row("Cost", `${cost.llm_calls} model calls, ${cost.total_tokens} tokens, ${cost.query_count} queries`) : null,
    whole ? null : row("Not shown", "The receipt was too long to show here whole."));
}

/**
 * A result in words, with nothing run: the question was declined ("X is not present in this data"), or it was
 * answered from the glossary. Such a result has no chart, table or SQL. It gets no card; in the work it is a row
 * that says "no query run" and opens to the words.
 */
const inWordsOnly = (answer) => !answer.sql && !(answer.rows ?? []).length;

function Words({ answer, asked }) {
  const question = asked || answer.question || "";
  return h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
    h("div", { style: { overflowWrap: "anywhere", whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" } }, answer.answer || "Nothing came back."),
    question ? h("div", { style: { ...quiet, fontSize: 12.5 } }, `Asked: ${question}`) : null,
    h("div", { style: { ...quiet, fontSize: 12.5 } }, "No query was run for this, so there is no chart, table or SQL."));
}

const TAIL = "data-pramanyx-answers";

/**
 * Where a turn's answers are shown: an empty place at the end of the turn, which each answer card moves itself
 * into. The shell folds a finished turn's tool calls away twice over ("Completed", then "Called tools"), and an
 * answer nobody unfolds is an answer in name only.
 */
function AnswerTail(props) {
  // A view is registered per exact tool name, and an agent's tool is named after the agent. The end of a turn is
  // told the turn's calls, so it is where a name not yet seen gets its view.
  useEffect(() => {
    for (const step of props.turn?.steps ?? []) {
      const blocks = step?.data?.entries?.get?.("assistant-step")?.value?.blocks ?? [];
      for (const block of blocks) if (block?.kind === "tool-call") nameStepsOf(block.name);
    }
  });
  const helpers = helpersOf(props.turn);
  // The turn holding a question's one answer is told which question it is (`foldHelperReports` marks its tail), and
  // shows under the answer what the check of its figures found.
  const here = useRef(null);
  const [checkCall, setCheckCall] = useState("");
  useEffect(() => {
    const tail = here.current?.closest?.('[data-chat-flow-kind="turn-tail"]');
    if (!tail) return undefined;
    const read = () => setCheckCall(tail.getAttribute("data-pramanyx-check-call") || "");
    read();
    const watch = new MutationObserver(read);
    watch.observe(tail, { attributes: true, attributeFilter: ["data-pramanyx-check-call"] });
    return () => watch.disconnect();
  }, []);
  // A question worked by helpers has ONE output: the close the main agent writes once every helper has reported
  // (the user, 2026-11-16: "one main agent that orchestrates sub-agents … synthesises … and then gives one final
  // output"). Its turns' answers — the helpers' and the main agent's own checks — are the work behind that output:
  // not cards with their own follow-ups, what stands out and Right/Wrong (`data-pramanyx-gathered`, below).
  return h("div", { ref: here, ...(helpers.length ? { "data-pramanyx-gathered": "", "data-pramanyx-first-call": helpers[0].call } : {}) },
    checkCall ? h(AnswerCheck, { call: checkCall }) : null,
    h("div", { [TAIL]: "" }),
    helpers.length ? h("div", { "data-pramanyx-helpers": "" },
      h("div", { style: { ...quiet, fontSize: 12.5, padding: "6px 0 2px" } }, `Worked by ${helpers.length} helper${helpers.length === 1 ? "" : "s"}`),
      helpers.map((helper) => h(Helper, { key: helper.call, ...helper }))) : null);
}

/**
 * The helpers a turn started, in the order they were started: each call to the shell's spawn tool. The end of a turn
 * is told its calls but not their results, so a helper is found by the call that started it; the host half knows
 * which helper each call started (`/pramanyx-helper?call=`).
 */
const SPAWNED = /^subagent(_fork)?$/;

function helpersOf(turn) {
  const out = [];
  for (const step of turn?.steps ?? []) {
    const blocks = step?.data?.entries?.get?.("assistant-step")?.value?.blocks ?? [];
    for (const block of blocks) {
      if (block?.kind !== "tool-call" || !SPAWNED.test(String(block.name))) continue;
      const call = String(block.callId || "");
      if (/^[A-Za-z0-9_-]{1,80}$/.test(call) && !out.some((known) => known.call === call)) {
        out.push({ call, asked: String(argsOf(block).description || "") });
      }
    }
  }
  return out;
}

/**
 * ONE HELPER, AS A ROW OF THE WORK (2026-11-15, reshaped 2026-11-16). A helper works in a conversation of its own;
 * here it is one row — what it was asked, and whether it is still working — that opens to what it was answered:
 * each answer as the work list shows one (its headline, opening to the SQL and the rows), a deep analysis by its
 * report. Not as cards: a helper's answer is a part of the question, not an outcome of its own. Read from what the
 * host half kept (`/pramanyx-helper`), again while the helper works. A helper from before answers were kept shows
 * nothing.
 */
function Helper({ call, asked }) {
  const [found, setFound] = useState(null);
  useEffect(() => {
    let live = true;
    let timer = null;
    let unknown = 0;                 // a start not known after a minute is a helper from before answers were kept
    const look = () => {
      fetch(`/pramanyx-helper?call=${encodeURIComponent(call)}`, { headers: { accept: "application/json" } })
        .then((answer) => (answer.ok ? answer.json() : null))
        .then((got) => {
          if (!live) return;
          setFound(got);
          // Read again while the helper works — and while its start is not yet known here, for a turn still running.
          if (got && (got.known ? !got.done : got.pending && (unknown += 1) < 15)) timer = setTimeout(look, 4000);
        })
        .catch(() => { if (live) timer = setTimeout(look, 8000); });
    };
    look();
    return () => { live = false; if (timer !== null) clearTimeout(timer); };
  }, [call]);
  if (!found || !found.known) return null;
  const answers = found.answers ?? [];
  const note = !found.done ? "working" : answers.length ? `${answers.length} answer${answers.length === 1 ? "" : "s"}` : "no answer";
  return h(Step, { kind: "rows", busy: !found.done, title: found.description || asked || "A helper", note },
    answers.length ? answers.map((answer, i) => (/deep_analysis$/.test(String(answer.tool))
      ? h(Analysis, { key: i, text: answer.text })
      : h(AnswerStep, { key: i, phase: "result", toolName: answer.tool,
                        block: { kind: "tool-call", name: answer.tool, args: answer.args ?? {}, text: answer.text } })))
      : null);
}

/**
 * WHAT THE CHECK OF THE ONE ANSWER FOUND (2026-11-16). The platform held each figure the answer states against the
 * rows of the answers the question gathered — the helpers' and the main agent's own (`pramanyx/govern/gathered.py`).
 * Said in one line under the answer: every figure found, or which were not, each with the clause it is in. A figure
 * worked out from others is not in any answer, and is listed: the reader is told, not left to assume.
 */
function AnswerCheck({ call }) {
  const [said, setSaid] = useState(null);
  useEffect(() => {
    let live = true;
    let timer = null;
    let tries = 0;
    const look = () => {
      fetch(`/pramanyx-answer-check?call=${encodeURIComponent(call)}`, { headers: { accept: "application/json" } })
        .then((answer) => (answer.ok ? answer.json() : null))
        .then((got) => {
          if (!live) return;
          setSaid(got);
          if (got?.state === "pending" && (tries += 1) < 45) timer = setTimeout(look, 4000);
        })
        .catch(() => { if (live) setSaid({ state: "unchecked", detail: "Its check could not be read." }); });
    };
    look();
    return () => { live = false; if (timer !== null) clearTimeout(timer); };
  }, [call]);
  const box = { fontSize: 12.5, padding: "8px 0 2px", display: "flex", flexDirection: "column", gap: 4 };
  if (!said) return null;
  if (said.state === "pending") return h("div", { "data-pramanyx-check": "pending", style: { ...box, ...quiet } }, "Checking its figures against the answers it was gathered from…");
  if (said.state !== "checked") return h("div", { "data-pramanyx-check": "unchecked", style: { ...box, ...quiet } }, `Its figures were not checked. ${said.detail || ""}`.trim());
  const missing = Array.isArray(said.not_found) ? said.not_found : [];
  const checked = Number(said.checked) || 0;
  if (!checked) return h("div", { "data-pramanyx-check": "none", style: { ...box, ...quiet } }, "It states no figures to check.");
  if (!Number(said.answers)) {
    return h("div", { "data-pramanyx-check": "unread", style: { ...box, ...quiet } },
      "Its figures could not be checked: none of the answers it was gathered from could be read.");
  }
  if (!missing.length) {
    return h("div", { "data-pramanyx-check": "found", style: { ...box, ...quiet } },
      `✓ Every figure in this answer (${checked}) is in the answers it was gathered from.`);
  }
  return h("div", { "data-pramanyx-check": "missing", role: "note", style: box },
    h("div", { style: { color: "#c2410c" } },
      `${missing.length === 1 ? "1 figure" : `${missing.length} figures`} in this answer ${missing.length === 1 ? "is" : "are"} not in the answers it was gathered from — worked out, or not measured:`),
    missing.slice(0, 8).map((figure, i) => h("div", { key: i, style: { display: "flex", gap: 8 } },
      h("span", { style: { fontWeight: 600, whiteSpace: "nowrap" } }, figure.text),
      figure.clause ? h("span", { style: quiet }, `“${figure.clause}”`) : null)),
    missing.length > 8 ? h("div", { style: quiet }, `and ${missing.length - 8} more`) : null);
}

/** A deep analysis a helper ran, by the platform's own report. */
function Analysis({ text }) {
  let got = null;
  try { got = JSON.parse(text); } catch { got = null; }
  const report = typeof got?.report === "string" ? got.report : (typeof got?.report?.summary === "string" ? got.report.summary : "");
  const frame = { margin: "8px 0", fontSize: 13 };
  return h("div", { style: frame },
    h("div", { style: { ...quiet, fontSize: 12.5, paddingBottom: 6 } }, "Deep analysis"),
    h("div", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.5, maxHeight: 420, overflow: "auto" } },
      report || (got?.status === "running" ? "Still running when the helper last looked." : "The report could not be read here.")));
}

/**
 * The turns a helpers question takes after its first: each starts with a helper's report (a helper under Agent mode
 * reports twice — a message, then that it finished). Of a run of them, the turn holding the close keeps its work
 * (folded, as any turn's) and its answers are work (`data-pramanyx-gathered`); every other report turn is
 * bookkeeping and is not shown. The close (`data-pramanyx-close`) is the run's fullest reply that says more than
 * "Waiting" or "Done": found live, 2026-11-16, the synthesis came one turn before the last, which said only that the
 * helpers were done and their figures were "in the reply above".
 */
function foldHelperReports() {
  // The shell draws a report's turn under its own label ("Subtask status updated", "Task message received"), not the
  // notice's words; both are matched, so a later shell that shows the words is still read.
  const REPORT = /(Subtask status updated|Task message received|Agent [A-Za-z0-9-]{8,64} sent a message|Background subagent [A-Za-z0-9-]{8,64} finished)/;
  const BOOKKEEPING = /^\s*(waiting|done)\W*$/i;
  let timer = null;
  const mark = (node, name, on) => { if (on !== node.hasAttribute(name)) { if (on) node.setAttribute(name, ""); else node.removeAttribute(name); } };
  const pass = () => {
    timer = null;
    const reports = new Set();
    for (const row of document.querySelectorAll('[data-chat-flow-kind="turn-trigger"][data-chat-turn]')) {
      if (REPORT.test(row.textContent || "")) {
        mark(row, "data-pramanyx-report", true);
        reports.add(Number(row.getAttribute("data-chat-turn")));
      }
    }
    // Runs of consecutive report turns, and in each the reply that closes it.
    const closeTurn = new Map();      // report turn → the turn holding its run's close (or none yet)
    const closes = new Set();
    for (const first of [...reports].sort((a, b) => a - b)) {
      if (reports.has(first - 1)) continue;
      const run = [];
      for (let t = first; reports.has(t); t += 1) run.push(t);
      const replies = run.flatMap((t) => [...document.querySelectorAll(
        `[data-chat-flow-kind="assistant-step"][data-chat-group-part="response"][data-chat-turn="${t}"]`)]);
      // The fullest reply that is not bookkeeping: the synthesis says more than any remark made after it, and the
      // agent is told to answer an interim report with "Waiting" and a late one with "Done". A later reply wins a tie.
      const said = (reply) => (reply.textContent || "").trim();
      const close = replies.filter((reply) => said(reply) && !BOOKKEEPING.test(said(reply)))
        .reduce((best, reply) => (!best || said(reply).length >= said(best).length ? reply : best), null);
      if (close) closes.add(close);
      const holder = close ? Number(close.getAttribute("data-chat-turn")) : run[run.length - 1];
      for (const t of run) closeTurn.set(t, holder);
      for (const reply of replies) mark(reply, "data-pramanyx-close", reply === close);
      // The question this run answers is the turn before it; its first helper's call is how its check is found.
      const call = document.querySelector(`[data-chat-flow-kind="turn-tail"][data-chat-turn="${first - 1}"] [data-pramanyx-first-call]`)
        ?.getAttribute("data-pramanyx-first-call") || "";
      for (const t of run) {
        const tail = document.querySelector(`[data-chat-flow-kind="turn-tail"][data-chat-turn="${t}"]`);
        if (!tail) continue;
        const wanted = close && t === holder ? call : "";
        if ((tail.getAttribute("data-pramanyx-check-call") || "") !== wanted) {
          if (wanted) tail.setAttribute("data-pramanyx-check-call", wanted); else tail.removeAttribute("data-pramanyx-check-call");
        }
      }
    }
    for (const item of document.querySelectorAll("[data-chat-flow-kind][data-chat-turn]")) {
      const turn = Number(item.getAttribute("data-chat-turn"));
      const kind = item.getAttribute("data-chat-flow-kind");
      if (!reports.has(turn)) continue;
      const holds = closeTurn.get(turn) === turn;
      const reply = kind === "assistant-step" && item.getAttribute("data-chat-group-part") === "response";
      mark(item, "data-pramanyx-waiting", kind !== "turn-trigger" && (!holds || (reply && !closes.has(item))));
      mark(item, "data-pramanyx-gathered", kind === "turn-tail");
    }
  };
  new MutationObserver(() => { if (timer === null) timer = setTimeout(pass, 250); })
    .observe(document.body, { childList: true, subtree: true });
  pass();
}

/**
 * The end-of-turn place for one tool row: the first one after it in the page. Found from the page itself, because
 * the tool row is told its call and the tail its turn, and nothing tells either which of the other it belongs to.
 */
function tailAfter(node) {
  for (const tail of document.querySelectorAll(`[${TAIL}]`)) {
    if (node.compareDocumentPosition(tail) & Node.DOCUMENT_POSITION_FOLLOWING) return tail;
  }
  return null;
}

/** A tool's row in the steps, and its card at the end of the turn: the place every answer and every draft is read. */
const inTail = (Step, Whole) => function TailCard(props) {
  const here = useRef(null);
  const [tail, setTail] = useState(null);
  useEffect(() => {
    // The end of a turn does not exist while the turn is still running, and a live answer arrives long before it:
    // a first version looked for three seconds and gave up, so every card of a live turn stayed folded away. The
    // page is watched instead, for as long as the row lives, and the place is found again if the shell redraws it.
    let timer = null;
    const look = () => {
      timer = null;
      const row = here.current;
      if (!row) return;
      setTail((now) => (now && now.isConnected ? now : tailAfter(row)));
    };
    const watch = new MutationObserver(() => { if (timer === null) timer = setTimeout(look, 200); });
    watch.observe(document.body, { childList: true, subtree: true });
    look();
    return () => { watch.disconnect(); if (timer !== null) clearTimeout(timer); };
  }, []);
  // In the list of steps: the answer as a named row that opens to its SQL and rows. At the end of the turn, once
  // that place exists: the whole card.
  return h("div", { ref: here },
    h(Step, props),
    tail ? createPortal(h(Whole, props), tail) : null);
};

const AnswerCard = inTail((props) => h(AnswerStep, props), (props) => h(Card, props));

/**
 * AN EMAIL, DRAFTED HERE AND SENT BY THE PERSON (2026-11-15). The agent's `draft_email` hands back words; this is
 * where a person reads them, changes them and presses Send. Only that click sends — through this page's own server
 * (`/pramanyx-email`, which presents the person the app handed over) to Pramanyx's `/email/send`, which refuses an
 * agent. What happened is said where it happened: sent to whom, or why not.
 */
/** What an analysis can be attached as: the platform's own exports, never a file the model wrote. */
const ATTACH = [["", "No attachment"], ["pdf", "The analysis as PDF"], ["xlsx", "The analysis as Excel, every row"],
  ["docx", "The analysis as Word"], ["pptx", "The analysis as PowerPoint"]];

/** A draft's own name, for the journal: the one Pramanyx minted when the agent drafted it, the answer's for an
 *  "Email this", and for a draft from before drafts were named, one made from its words — the same after a reload. */
export function draftName(draft) {
  if (draft?.name) return String(draft.name);
  if (draft?.id && /^[A-Za-z0-9_-]{6,40}$/.test(String(draft.id))) return `d-${draft.id}`;
  const text = `${draft?.subject || ""}\n${draft?.body || ""}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `h-${(hash >>> 0).toString(36)}`;
}

const whenSent = (at) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function Draft({ draft }) {
  const [to, setTo] = useState(String(draft?.to || ""));
  const [subject, setSubject] = useState(String(draft?.subject || ""));
  const [body, setBody] = useState(String(draft?.body || ""));
  // The answer whose analysis may ride along — named by the agent when the person asked for it, or the answer an
  // "Email this" was opened from. None known, no attachment is offered.
  const answerId = String(draft?.attach_answer || "");
  const [attach, setAttach] = useState(answerId ? String(draft?.attach_format || "") : "");
  const [state, setState] = useState({ busy: false, said: "" });
  // WHETHER IT WENT is a fact about the email, not about this page: it is read from Pramanyx's journal, under the
  // draft's own name, every time the draft is drawn. Kept in the page alone, a sent email showed as an open draft
  // again after a reload (2026-11-15). `null` until the journal has answered; a draft from before drafts were named
  // is found by its subject.
  const name = draftName(draft);
  const unnamed = !draft?.id && !draft?.name;
  const [sends, setSends] = useState(null);
  const [unread, setUnread] = useState(false);
  const [again, setAgain] = useState(false);
  useEffect(() => {
    let live = true;
    const asked = new URLSearchParams({ draft: name, ...(unnamed && draft?.subject ? { subject: String(draft.subject) } : {}) });
    fetch(`/pramanyx/email/sent?${asked}`, { headers: { accept: "application/json" } })
      .then((answer) => (answer.ok ? answer.json() : Promise.reject(new Error(String(answer.status)))))
      .then((got) => { if (live) setSends(Array.isArray(got?.sends) ? got.sends : []); })
      .catch(() => { if (live) { setSends([]); setUnread(true); } });
    return () => { live = false; };
  }, [name]);
  const field = { width: "100%", boxSizing: "border-box", font: "inherit", fontSize: 13.5, padding: "6px 8px",
                  border: `1px solid ${line}`, borderRadius: 6, background: "transparent", color: "inherit" };
  const frame = { margin: "12px 0", display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5 };
  const send = async () => {
    setState({ busy: true, said: "" });
    try {
      const answer = await fetch("/pramanyx-email", { method: "POST", headers: { "content-type": "application/json" },
                                                      body: JSON.stringify({ to, subject, body, draft: name,
                                                        ...(attach && answerId ? { attach_answer: answerId, attach_format: attach } : {}) }) });
      const said = await answer.json().catch(() => ({}));
      if (!answer.ok) return setState({ busy: false, said: String(said.detail || `The email was refused (${answer.status}).`) });
      if (!said.sent) return setState({ busy: false, said: String(said.said || "Not sent.") });
      const attached = /, with (.+) attached$/.exec(String(said.said || ""));
      setSends((was) => [{ to: to.trim(), subject, at: new Date().toISOString(), attached: attached ? attached[1] : "" }, ...(was || [])]);
      setAgain(false);
      setState({ busy: false, said: "" });
    } catch {
      setState({ busy: false, said: "The platform is not answering; nothing was sent." });
    }
  };
  if (sends === null) {
    return h("div", { "data-pramanyx-draft": "checking", style: frame },
      h("div", { role: "heading", "aria-level": 4, style: { fontWeight: 600 } }, "Email draft"),
      h("div", { style: quiet }, "Checking whether this was sent…"));
  }
  if (sends.length && !again) {
    // Sent: said as that, with to whom and when — and not as a form that reads as still waiting to be sent.
    return h("div", { "data-pramanyx-draft": "sent", style: frame },
      h("div", { role: "heading", "aria-level": 4, style: { fontWeight: 600 } }, "Email sent"),
      sends.slice(0, 5).map((sent, i) => h("div", { key: `${sent.at}-${i}`, role: i ? undefined : "status" },
        `✓ To ${sent.to}`, whenSent(sent.at) ? ` · ${whenSent(sent.at)}` : "", sent.attached ? ` · with ${sent.attached} attached` : "")),
      sends.length > 5 ? h("div", { style: quiet }, `and ${sends.length - 5} more`) : null,
      h("div", { style: quiet }, `Subject: ${sends[0].subject || subject}`),
      h("div", { style: quiet }, "The email as it went is in the sending account's Sent mail."),
      h("div", null, h("button", { type: "button", className: "pramanyx-link",
        onClick: () => { setTo(""); setState({ busy: false, said: "" }); setAgain(true); } }, "Send to someone else")));
  }
  const ready = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim()) && body.trim() && !state.busy;
  return h("div", { "data-pramanyx-draft": "", style: frame },
    h("div", { role: "heading", "aria-level": 4, style: { fontWeight: 600 } }, "Email draft"),
    sends.length ? h("div", { style: quiet }, `Already sent to ${sends.map((sent) => sent.to).slice(0, 3).join(", ")}${sends.length > 3 ? " and others" : ""}.`) : null,
    unread ? h("div", { style: quiet }, "Whether this draft was already sent could not be checked.") : null,
    h("label", { style: { display: "flex", flexDirection: "column", gap: 3 } },
      h("span", { style: quiet }, "To"),
      h("input", { type: "email", value: to, placeholder: "name@example.com", style: field,
                   onChange: (e) => setTo(e.target.value) })),
    h("label", { style: { display: "flex", flexDirection: "column", gap: 3 } },
      h("span", { style: quiet }, "Subject"),
      h("input", { type: "text", value: subject, style: field, onChange: (e) => setSubject(e.target.value) })),
    h("label", { style: { display: "flex", flexDirection: "column", gap: 3 } },
      h("span", { style: quiet }, "Message"),
      h("textarea", { rows: 8, value: body, style: { ...field, resize: "vertical", lineHeight: 1.5 },
                      onChange: (e) => setBody(e.target.value) })),
    answerId ? h("label", { style: { display: "flex", flexDirection: "column", gap: 3 } },
      h("span", { style: quiet }, "Attach"),
      h("select", { value: attach, style: field, onChange: (e) => setAttach(e.target.value) },
        ATTACH.map(([value, label]) => h("option", { key: value || "none", value }, label)))) : null,
    h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
      h("button", { type: "button", style: button(true), disabled: !ready, onClick: send }, state.busy ? "Sending…" : "Send"),
      state.said ? h("span", { role: "status", style: { color: "#c2410c" } }, `Not sent: ${state.said}`)
        : h("span", { style: quiet }, "Nothing is sent until you press Send.")));
}

/** The draft a `draft_email` call returned, or null. */
function draftOf(block) {
  try {
    const got = JSON.parse(resultText(block) || "{}");
    return got && typeof got.draft === "object" ? got.draft : null;
  } catch {
    return null;
  }
}

const DraftCard = inTail((props) => h(ToolStep, props),
  (props) => (props.phase === "result" && draftOf(props.block) ? h(Draft, { draft: draftOf(props.block) }) : null));

/**
 * A SCHEDULE, SET HERE AND KEPT BY THE PLATFORM (2026-11-15). There is one scheduler, the platform's, and a schedule
 * made in a conversation is one of its automations — so this card draws no copy of it. It names what was set and
 * asks the platform where it stands every time it is drawn (`GET /automations/<id>/schedule`, through the relay):
 * when it runs, in the platform's own words; when next; and whether it is on, waiting for its first run, switched
 * off, ended or gone. Its button opens the app's own page of schedules beside the conversation, on this one, where a
 * person changes it, mutes it, runs it now and reads what each run did.
 */
const whenNext = (at) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** Where a schedule stands, as one sentence. `now` is the platform's read: null when the schedule is gone. */
export function standing(now) {
  if (now === null) return "This schedule was removed.";
  const next = whenNext(now.next_run);
  if (now.state === "ended") return `Ended: ${now.ended || "it has no run left"}.`;
  if (now.state === "off") return "Switched off. It runs again when it is switched on, on the schedule's page.";
  if (now.state === "muted") return next ? `First run ${next}, your time.` : "Waiting for its first run.";
  return next ? `Next run ${next}, your time.` : "On.";
}

export function Scheduled({ made }) {
  const [now, setNow] = useState(undefined);        // undefined while it is read; null when the schedule is gone
  const [unread, setUnread] = useState(false);
  const [asked, setAsked] = useState(0);             // read again: a run was due, or the coworker said one landed
  useEffect(() => {
    let live = true;
    fetch(`/pramanyx/automations/${encodeURIComponent(made.id)}/schedule`, { headers: { accept: "application/json" } })
      .then((answer) => {
        if (answer.status === 404) return null;
        if (!answer.ok) throw new Error(String(answer.status));
        return answer.json();
      })
      .then((got) => { if (live) { setNow(got); setUnread(false); } })
      .catch(() => { if (live) setUnread(true); });
    return () => { live = false; };
  }, [made.id, asked]);
  useEffect(() => {
    const wait = readAgainIn(now);
    if (wait === null) return undefined;
    const timer = setTimeout(() => setAsked((n) => n + 1), wait);
    return () => clearTimeout(timer);
  }, [now]);
  useEffect(() => {
    // The coworker's own reading of the runs (`plugins/home`, `RunLanded`) says when one landed in a schedule.
    const landed = (event) => { if (!event?.detail?.automation || event.detail.automation === made.id) setAsked((n) => n + 1); };
    window.addEventListener("pramanyx:run-landed", landed);
    return () => window.removeEventListener("pramanyx:run-landed", landed);
  }, [made.id]);
  const frame = { margin: "12px 0", display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5 };
  const said = now && Array.isArray(now.said) && now.said.length ? now.said.join("; ") : String(made.when || "");
  const steps = now && Array.isArray(now.steps) ? now.steps : [];
  const sends = steps.filter((kind) => kind === "email" || kind === "slack_post" || kind === "notify");
  const runs = now && Array.isArray(now.runs) ? now.runs : [];
  return h("div", { "data-pramanyx-schedule": now === null ? "gone" : now?.state || "reading", style: frame },
    h("div", { role: "heading", "aria-level": 4, style: { fontWeight: 600 } }, "Schedule"),
    h("div", null, String(now?.name || made.name || "")),
    said ? h("div", { style: quiet }, said) : null,
    unread ? h("div", { style: quiet }, "Where this schedule stands could not be read just now.")
      : now === undefined ? h("div", { style: quiet }, "Reading where this schedule stands…")
        : h("div", { role: "status" }, standing(now)),
    now && now.expires_at && now.state !== "ended" ? h("div", { style: quiet }, `It stops on ${whenNext(now.expires_at)}.`) : null,
    steps.length ? h("div", { style: quiet }, `It ${steps.map((kind) => STEP_WORDS[kind] || kind.replace(/_/g, " ")).join(", then ")}.`) : null,
    now && sends.length ? h("div", { style: quiet },
      `Each run is also sent on: ${sends.map((kind) => ({ email: "email", slack_post: "Slack", notify: "a notification" })[kind]).join(", ")}.`) : null,
    // WHAT EACH RUN FOUND, HERE (2026-11-16: "deliver it here"). Read with the schedule each time the card is drawn.
    runs.length ? h("div", { "data-pramanyx-runs": "", style: { display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 } },
      runs.map((run, i) => h(RunFound, { key: `${run.at}-${i}`, run, provisional: String(now?.provisional || "") }))) : null,
    now !== null && hasPane() ? h("div", null, h("button", { type: "button", style: button(false),
      onClick: () => openBeside("page", pageFor.schedule(made.id, String(now?.conn_id || made.connection || ""))) }, "Open the schedule")) : null);
}

/** The tools that set up a schedule: `schedule` (a sentence, 2026-11-16) and the question-only one it replaced, whose
 *  cards in earlier conversations still draw. */
const SCHEDULES = /^mcp__pramanyx__schedule(_question)?$/;

/** What a schedule's steps do, in words. */
const STEP_WORDS = {
  investigate: "asks the question", synthesize: "writes it up", slack_post: "posts it to Slack", email: "emails it",
  notify: "sends a notification", metric_value: "reads the metric", trusted_query: "runs the trusted query",
  subchain: "runs another automation", kinetic_action: "takes the declared action", expectations: "checks the table's expectations",
};

/**
 * A run's answer, shown as an answer is (2026-11-16, the user: "why is the result not chart or table?"): the headline,
 * then its rows as the chart they chose — one row as figures — with the table a click away, and under it the
 * platform's one line on whether the figures may still change. How it was answered is the analysis's own page.
 */
function RunAnswer({ answer, provisional }) {
  const [table, setTable] = useState(false);
  const one = (answer.rows ?? []).length === 1;
  const count = typeof answer.row_count === "number" ? answer.row_count : (answer.rows ?? []).length;
  return h("div", { "data-pramanyx-run-answer": "", style: { display: "flex", flexDirection: "column", gap: 6 } },
    answer.headline ? h("div", { style: { fontSize: 15, fontWeight: 600, lineHeight: 1.4 } }, answer.headline) : null,
    h("div", { style: { border: `1px solid ${line}`, borderRadius: 6, padding: "6px 8px 4px 12px" } },
      one ? h(Figures, { answer }) : table ? h("div", { style: { padding: "4px 0 6px" } }, h(ResultGrid, { answer, compact: true }))
        : h(Chart, { answer }),
      one ? null : h("div", { style: { display: "flex", alignItems: "center", gap: 12, borderTop: `1px solid ${line}`, marginTop: 4 } },
        h("button", { type: "button", className: "pramanyx-link", "aria-expanded": table, onClick: () => setTable((was) => !was) },
          table ? "Show the chart" : "Show as a table"),
        h("span", { style: { flex: "1 1 auto" } }),
        h("span", { style: { ...quiet, fontSize: 12.5 } }, `${count} ${count === 1 ? "row" : "rows"}`))),
    provisional ? h("div", { style: { ...quiet, fontSize: 12.5 } }, provisional) : null);
}

/** One run of a schedule: when, and what its steps found — an answer as an answer, a write-up as its text, with the
 *  analysis a click away. */
function RunFound({ run, provisional = "" }) {
  const found = (run.steps ?? []).filter((step) => step.answer || step.said);
  const failed = (run.steps ?? []).filter((step) => !["executed", "skipped"].includes(String(step.status)));
  const analysis = (run.steps ?? []).map((step) => step.investigation_id).find(Boolean);
  // A step that handed its analysis to the platform's queue: the run is recorded before the answer exists.
  const answering = (run.steps ?? []).some((step) => step.answering);
  return h("div", { style: { borderTop: `1px solid ${line}`, paddingTop: 6, display: "flex", flexDirection: "column", gap: 6 } },
    h("div", { style: { ...quiet, fontSize: 12.5 } },
      `Ran ${whenNext(run.at)}`, run.outcome === "paused" ? " · waiting for a person" : run.outcome === "error" ? " · did not run" : ""),
    found.length ? found.map((step, i) => (step.answer ? h(RunAnswer, { key: i, answer: step.answer, provisional })
      : h("div", { key: i, style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.5 } }, step.said)))
      : h("div", { style: quiet }, run.outcome === "error" ? (run.reason || "It broke before it found anything.")
        : failed.length ? (failed[0].message || "A step did not finish.")
          : answering ? "Still being answered. The answer shows here when it is done." : "It found nothing to say."),
    analysis && hasPane() ? h("div", null, h("button", { type: "button", className: "pramanyx-link",
      onClick: () => openBeside("page", pageFor.receipt(analysis)) }, "How it was answered")) : null);
}

/** The schedule a call made, or null — a call that asked instead (`needs`) or could not (`reason`) made none. */
function scheduleOf(block) {
  try {
    const got = JSON.parse(resultText(block) || "{}");
    return got && got.scheduled !== false && typeof got.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(got.id) ? got : null;
  } catch {
    return null;
  }
}

const ScheduleCard = inTail((props) => h(ToolStep, props),
  (props) => (props.phase === "result" && !props.block?.isError && scheduleOf(props.block) ? h(Scheduled, { made: scheduleOf(props.block) }) : null));

/** What a call was given, whichever of the shell's shapes carries it. Nothing readable is an empty object. */
function argsOf(block) {
  const parsed = (raw) => {
    try {
      // The shell hands a call's arguments as the pieces they streamed in as (`chunks`, with `object` once they are
      // whole), as a reader to be called, as a plain object, or as the text they arrived in.
      let given = typeof raw === "function" ? raw() : raw;
      if (given && typeof given === "object" && Array.isArray(given.chunks)) {
        if (given.object && typeof given.object === "object") return given.object;
        given = given.chunks.join("");
      }
      if (given && typeof given === "object") return given;
      const value = JSON.parse(given);
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  };
  for (const raw of [block?.args, block?.argsRaw, block?.call?.args, block?.call?.argsRaw]) {
    const found = parsed(raw);
    if (Object.keys(found).length) return found;
  }
  return {};
}

const ICONS = {
  // A grid: something was read off the data.
  rows: [["rect", { x: 2, y: 2.5, width: 12, height: 11, rx: 1.5 }], ["path", { d: "M2 6.5h12M6.5 6.5v7" }]],
  // A page: something was read that a person or the platform wrote.
  read: [["path", { d: "M4 2h6l3 3v9H4z" }], ["path", { d: "M6.5 8h4M6.5 10.5h4" }]],
};

function Icon({ kind, busy }) {
  if (busy) return h("span", { className: "pramanyx-step-busy", "aria-hidden": "true" });
  return h("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.2,
                    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", style: { flex: "none", opacity: 0.7 } },
    (ICONS[kind] ?? ICONS.read).map(([tag, attrs], i) => h(tag, { key: i, ...attrs })));
}

/**
 * One step of the work, as a row a person can read down: what was done, in words, and what it came to. It opens
 * when there is something behind it. A row looks pressable before the pointer reaches it.
 */
function Step({ kind, title, note, busy, failed, children }) {
  const [open, setOpen] = useState(false);
  const opens = Boolean(children);
  return h("div", { className: "pramanyx-step", style: { borderRadius: 4, margin: "1px 0", fontSize: 13 } },
    h("button", {
      type: "button", disabled: !opens, "aria-expanded": opens ? open : undefined, onClick: () => setOpen((was) => !was),
      style: { display: "flex", gap: 8, alignItems: "center", width: "100%", textAlign: "left", font: "inherit", color: "inherit",
               background: open ? faint : "transparent", border: 0, padding: "7px 10px", cursor: opens ? "pointer" : "default" },
    },
      h(Icon, { kind, busy }),
      h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...(busy ? quiet : {}) } }, title),
      failed ? h("span", { style: { flex: "none", fontSize: 12 } }, "did not work") : note ? h("span", { style: { ...quiet, flex: "none", fontSize: 12 } }, note) : null),
    open && opens ? h("div", { style: { padding: 10, borderTop: `1px solid ${line}`, display: "flex", flexDirection: "column", gap: 10 } }, children) : null);
}

/** An answer in the list of steps: named by what Pramanyx found, opening to the SQL and the rows. */
function AnswerStep(props) {
  const asked = String(argsOf(props.block).question || "");
  if (props.phase !== "result") return h(Step, { kind: "rows", busy: true, title: asked ? `Asking: ${asked}` : "Asking" });
  const read = readAnswer(resultText(props.block));
  if (!read || props.block?.isError) {
    return h(Step, { kind: "rows", failed: true, title: asked || "A question" },
      h("pre", { style: { margin: 0, fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, resultText(props.block).slice(0, 2000) || "Nothing came back."));
  }
  const { answer } = read;
  if (inWordsOnly(answer)) {
    return h(Step, { kind: "rows", title: asked || answer.answer || "A question", note: "no query run" }, h(Words, { answer }));
  }
  const count = typeof answer.row_count === "number" ? answer.row_count : (answer.rows ?? []).length;
  return h(Step, { kind: "rows", title: answer.answer || asked || "An answer", note: `${count} ${count === 1 ? "row" : "rows"}` },
    h(Sql, { answer }), h(ResultGrid, { answer, compact: true }));
}

/**
 * Pramanyx's other tools, in the words of what each does. A tool's wire name is `mcp__pramanyx__get_metric`; a
 * person reading the steps is told a metric's definition was read, and which. The second entry names the argument
 * that says which. A tool not listed is named from its own name, with the underscores taken out.
 */
const DOES = {
  deep_analysis: ["Ran a deep analysis", ["question"]],
  draft_email: ["Drafted an email", ["subject", "to"]],
  schedule: ["Set up a schedule", ["request"]],
  schedule_question: ["Set a question on a schedule", ["question", "cron"]],
  search_the_web: ["Searched the web", ["query"]],
  explore: ["Explored", ["question", "topic", "focus"]],
  explain: ["Asked how an answer was reached", ["investigation_id"]],
  get_metric: ["Read the definition of the metric", ["name", "metric", "metric_name"]],
  describe_entity: ["Read the object", ["entity", "name", "entity_id"]],
  get_object: ["Read the object", ["name", "object", "object_id", "id"]],
  list_objects: ["Listed the objects", ["kind", "type"]],
  search_graph: ["Searched what is already known about", ["query", "q", "question"]],
  list_findings: ["Read earlier findings", ["query", "table"]],
  list_trusted_queries: ["Read the trusted queries", []],
  get_table_health: ["Checked the health of the table", ["table", "table_name"]],
  table_popularity: ["Read which tables are used most", []],
  list_connections: ["Listed the connections", []],
  list_platform_connections: ["Listed the connections", []],
  get_briefing: ["Read the Briefing", []],
  get_investigation: ["Read an earlier analysis", ["investigation_id", "id"]],
  list_runs: ["Listed recent runs", []],
  inspect_run: ["Looked into a run", ["trace_id"]],
  read_run_span: ["Read one step of a run", ["span_id"]],
  get_job: ["Checked on a job", ["job_id", "id"]],
  list_jobs: ["Listed the jobs", []],
  read_claims: ["Read the Record", ["subject", "kind"]],
  read_contract: ["Read the agent contract", []],
  read_restatements: ["Read what was restated", []],
  post_claim: ["Wrote a claim to the Record", ["subject", "kind"]],
  answer_accuracy: ["Read how accurate answers have been", []],
  ground_agent: ["Read what an agent rests on", ["agent", "agent_id"]],
  investigation_cadence: ["Read how often analyses run", []],
  review_missed_move: ["Reviewed a missed move", ["id"]],
  platform_audit: ["Read the audit log", []],
  platform_guide: ["Read the platform guide", ["topic"]],
  platform_limits: ["Read the platform's limits", []],
  platform_premortem: ["Read the platform's pre-mortem", []],
  platform_runs: ["Read the platform's runs", []],
  platform_traces: ["Read the platform's traces", []],
  platform_usage: ["Read usage and spend", []],
  get_definitions: ["Read what the words mean", ["term"]],
  read_learned: ["Read what is already learned", ["about"]],
  bring_in_file: ["Brought in a file", ["name"]],
  draft_definition: ["Drafted what a word means", ["term"]],
};
const PREFIX = "mcp__pramanyx__";

function saidOf(toolName, args) {
  const short = toolName.startsWith(PREFIX) ? toolName.slice(PREFIX.length) : toolName;
  const [does, whichKeys] = DOES[short] ?? [short.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), []];
  const which = whichKeys.map((key) => args[key]).find((value) => typeof value === "string" && value.trim());
  return which ? `${does}: ${which}` : does;
}

/**
 * Any other Pramanyx tool in the list of steps: named by what it does, opening to what came back. What came back
 * — a metric's definition, an object of the ontology, the Briefing, earlier findings — can be opened beside the
 * conversation, laid out to be read, as a tab that stays while the conversation goes on.
 */
function ToolStep(props) {
  const args = argsOf(props.block);
  const title = saidOf(props.toolName || "", args);
  const done = props.phase === "result";
  const text = done ? resultText(props.block) : "";
  const failed = Boolean(props.block?.isError);
  const id = thingId(props.toolName || "", args);
  let value = null;
  if (done && !failed && text) { try { value = JSON.parse(text); } catch { value = null; } }
  const opens = value !== null && typeof value === "object" && hasPane();
  useEffect(() => { if (opens) rememberThing(id, title, value); }, [opens, id, title, text]);
  if (!done) return h(Step, { kind: "read", busy: true, title });
  return h(Step, { kind: "read", title, failed },
    opens ? h("div", null, h("button", { type: "button", style: button(false), onClick: () => openBeside("thing", id) }, "Open beside the conversation")) : null,
    text ? h("pre", { style: { margin: 0, fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 320, overflow: "auto" } },
      text.length > 6000 ? `${text.slice(0, 6000)}\n… and ${text.length - 6000} more characters, not shown` : text) : null);
}

/**
 * The steps as one line to read down. The shell lays a turn's work out as a column: the model's own sentence
 * (`assistant-step`), then a group holding the calls it made for it (`data-step-process`), then the next sentence.
 * A rule is drawn down the left of each sentence that is followed by a group, and of each group, with a dot at the
 * sentence — so the sentences read as the plan and the rows under each as what was done for it. The reply itself
 * is a sentence followed by no group, and is left as it is. Matched by the shell's own data attributes; if those
 * change, the column is drawn as the shell draws it.
 */
const STEPS_LOOK = `
[data-chat-flow-kind="assistant-step"]:has(+ [data-step-process]),
[data-step-process] {
  position: relative; margin-left: 7px; padding-left: 16px;
  border-left: 1px solid color-mix(in srgb, currentColor 22%, transparent);
}
/* The rule carries on across the gap the shell leaves between one row of the column and the next. */
[data-chat-flow-kind="assistant-step"]:has(+ [data-step-process])::after,
[data-step-process]:has(+ [data-chat-flow-kind="assistant-step"] + [data-step-process])::after {
  content: ""; position: absolute; left: -1px; top: 100%; height: var(--dsh-chat-flow-gap, 12px);
  border-left: 1px solid color-mix(in srgb, currentColor 22%, transparent);
}
[data-chat-flow-kind="assistant-step"]:has(+ [data-step-process])::before {
  content: ""; position: absolute; left: -4px; top: 0.72em; width: 7px; height: 7px; border-radius: 50%;
  background: color-mix(in srgb, currentColor 55%, var(--dsw-alias-bg-base, #111113));
}
/*
 * A group of calls is shown open, without its own "Called tools" fold. The turn already has one fold ("Completed
 * in …"); a second inside it, per group, meant a click for every row before any of the work could be read.
 */
[data-step-process]:has(> div > button[data-process-activity="tools"]) > [data-step-process-body] {
  content-visibility: visible !important; display: block !important; height: auto !important; overflow: visible !important;
}
[data-step-process] > div > button[data-process-activity="tools"] { display: none; }
/*
 * Folding the turn folds all of the work. The shell hides only the calls and leaves what was said between them
 * standing, so a "folded" turn was still a screen of working notes above the answer. A note that leads into
 * hidden calls is part of the work and goes with it; the last thing said — the answer — is followed by no calls
 * and stays.
 */
[data-chat-flow-kind="assistant-step"]:has(+ [data-step-process][hidden]) { display: none; }
/*
 * While a turn runs, its work is folded to one row: the latest call, or what is being said now. The shell keeps a
 * running turn wide open, so a long one pushed the question off the screen before there was an answer to read.
 * A running turn is the one whose fold has no button yet. "Show the work" on the running line opens it all.
 */
:root:not([data-pramanyx-live-work="open"]) [data-chat-flow-kind="turn-process"]:not(:has(button[data-turn-process])) ~ [data-chat-flow-kind="assistant-step"]:has(+ [data-step-process]),
:root:not([data-pramanyx-live-work="open"]) [data-chat-flow-kind="turn-process"]:not(:has(button[data-turn-process])) ~ [data-step-process]:has(~ [data-step-process]),
:root:not([data-pramanyx-live-work="open"]) [data-chat-flow-kind="turn-process"]:not(:has(button[data-turn-process])) ~ [data-step-process] [data-step-process-content] > :not(:last-child):not(:has(.pramanyx-step-busy)),
/* Calls made together finish in any order: the row shown is the last one still running, and the last row only when none is. */
:root:not([data-pramanyx-live-work="open"]) [data-chat-flow-kind="turn-process"]:not(:has(button[data-turn-process])) ~ [data-step-process] [data-step-process-content] > :has(.pramanyx-step-busy):has(~ * .pramanyx-step-busy),
:root:not([data-pramanyx-live-work="open"]) [data-chat-flow-kind="turn-process"]:not(:has(button[data-turn-process])) ~ [data-step-process] [data-step-process-content]:has(.pramanyx-step-busy) > :last-child:not(:has(.pramanyx-step-busy)) {
  display: none;
}
.pramanyx-live-work {
  position: absolute; right: 0; top: 2px; font: inherit; font-size: 12px; padding: 2px 10px; border-radius: 4px;
  cursor: pointer; color: inherit; background: transparent;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
}
/*
 * When a turn has an answer to show, the answer is the output: the headline and the words are the platform's, and
 * the agent's closing remark is not shown beside them. A turn with no answer drawn (a question declined, a reply in
 * words) keeps its reply, which is then all there is. The remark stays in the conversation's record.
 */
[data-chat-flow-kind="assistant-step"]:not([data-pramanyx-close]):has(+ [data-chat-flow-kind="turn-tail"] [data-pramanyx-answers] > *),
[data-chat-flow-kind="assistant-step"]:not([data-pramanyx-close]):has(+ [data-chat-flow-kind="turn-tail"] [data-pramanyx-helpers] > *) { display: none; }
/*
 * A QUESTION WORKED BY HELPERS HAS ONE OUTPUT (2026-11-16). Its helpers are rows of the work under the question; the
 * answers drawn in its turns — the main agent's own checks among them — are not shown as cards, since each card is an
 * outcome of its own (its follow-ups, what stands out, Right and Wrong); the reports' turns are bookkeeping and are
 * not shown; and the main agent's close, once every helper has reported, is the output.
 */
[data-pramanyx-gathered] [data-pramanyx-answers] { display: none; }
[data-pramanyx-report], [data-pramanyx-waiting] { display: none; }
/* The close is the output wherever in its turn it was said — before more steps, too — so the work's fold and its
 * column line do not take it in. */
[data-chat-flow-kind="assistant-step"][data-pramanyx-close] {
  display: block !important; margin-left: 0 !important; padding-left: 0 !important; border-left: 0 !important;
}
[data-chat-flow-kind="assistant-step"][data-pramanyx-close]::before,
[data-chat-flow-kind="assistant-step"][data-pramanyx-close]::after { content: none !important; }
/*
 * An answer's own controls. An icon is plain until pointed at; a mark after a sentence is a small edged chip that
 * opens what the sentence stood on; a quiet link opens something behind the answer.
 */
.pramanyx-icon {
  width: 30px; height: 30px; border-radius: 4px; cursor: pointer; padding: 0; border: 0; background: transparent;
  display: inline-flex; align-items: center; justify-content: center; color: inherit; opacity: 0.62;
}
.pramanyx-icon:hover, .pramanyx-icon:focus-visible, .pramanyx-icon[aria-pressed="true"], .pramanyx-icon[aria-expanded="true"] {
  opacity: 1; background: color-mix(in srgb, currentColor 8%, transparent);
}
.pramanyx-icon:disabled { cursor: default; opacity: 0.3; }
.pramanyx-mark {
  font: inherit; font-size: 12px; line-height: 18px; height: 20px; padding: 0 6px; margin: 0 0 0 4px; border-radius: 4px;
  cursor: pointer; color: inherit; vertical-align: 1px; white-space: nowrap;
  background: color-mix(in srgb, currentColor 6%, transparent); border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
}
.pramanyx-mark:hover, .pramanyx-mark:focus-visible { border-color: color-mix(in srgb, currentColor 55%, transparent); }
.pramanyx-ask {
  font: inherit; font-size: 14px; color: inherit; text-align: left; background: transparent; border: 0; cursor: pointer;
  border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent); padding: 8px 0; opacity: 0.86;
}
.pramanyx-ask:hover, .pramanyx-ask:focus-visible { opacity: 1; background: color-mix(in srgb, currentColor 5%, transparent); }
.pramanyx-link {
  font: inherit; font-size: 12.5px; color: inherit; opacity: 0.68; background: transparent; border: 0; padding: 4px 0; cursor: pointer;
  text-decoration: underline dotted color-mix(in srgb, currentColor 45%, transparent); text-underline-offset: 3px;
}
.pramanyx-link:hover, .pramanyx-link:focus-visible, .pramanyx-link[aria-expanded="true"] { opacity: 1; }
.pramanyx-step-busy {
  flex: none; width: 12px; height: 12px; border-radius: 50%; box-sizing: border-box;
  border: 1.5px solid currentColor; border-right-color: transparent; opacity: 0.7;
  animation: pramanyx-step-turn 0.9s linear infinite;
}
@keyframes pramanyx-step-turn { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { /*
 * While a turn runs, its work is folded to one row: the latest call, or what is being said now. The shell keeps a
 * running turn wide open, so a long one pushed the question off the screen before there was an answer to read.
 * A running turn is the one whose fold has no button yet. "Show the work" on the running line opens it all.
 */
:root:not([data-pramanyx-live-work="open"]) [data-chat-flow-kind="turn-process"]:not(:has(button[data-turn-process])) ~ [data-chat-flow-kind="assistant-step"]:has(+ [data-step-process]),
:root:not([data-pramanyx-live-work="open"]) [data-chat-flow-kind="turn-process"]:not(:has(button[data-turn-process])) ~ [data-step-process]:has(~ [data-step-process]),
:root:not([data-pramanyx-live-work="open"]) [data-chat-flow-kind="turn-process"]:not(:has(button[data-turn-process])) ~ [data-step-process] [data-step-process-content] > :not(:last-child):not(:has(.pramanyx-step-busy)),
/* Calls made together finish in any order: the row shown is the last one still running, and the last row only when none is. */
:root:not([data-pramanyx-live-work="open"]) [data-chat-flow-kind="turn-process"]:not(:has(button[data-turn-process])) ~ [data-step-process] [data-step-process-content] > :has(.pramanyx-step-busy):has(~ * .pramanyx-step-busy),
:root:not([data-pramanyx-live-work="open"]) [data-chat-flow-kind="turn-process"]:not(:has(button[data-turn-process])) ~ [data-step-process] [data-step-process-content]:has(.pramanyx-step-busy) > :last-child:not(:has(.pramanyx-step-busy)) {
  display: none;
}
.pramanyx-live-work {
  position: absolute; right: 0; top: 2px; font: inherit; font-size: 12px; padding: 2px 10px; border-radius: 4px;
  cursor: pointer; color: inherit; background: transparent;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
}
.pramanyx-step-busy { animation: none; } }
`;

function wearStepsLook() {
  let style = document.getElementById("pramanyx-steps-look");
  if (!style) {
    style = document.createElement("style");
    style.id = "pramanyx-steps-look";
    document.head.appendChild(style);
  }
  style.textContent = STEPS_LOOK;
}

/**
 * The control that opens a running turn's work, on the shell's own running line. The line is the shell's and has
 * no place for a plugin, so the button is put there by hand and put back if the shell redraws the line. Whether
 * the work is open is kept on the page's root and forgotten when the run ends: the next run starts folded.
 */
function foldRunningWork() {
  const root = document.documentElement;
  const KEY = "data-pramanyx-live-work";
  const words = () => (root.getAttribute(KEY) === "open" ? "Hide the work" : "Show the work");
  const tend = () => {
    const running = document.querySelector("[data-chat-running]:not([data-holding])");
    if (!running) { if (root.hasAttribute(KEY)) root.removeAttribute(KEY); return; }
    let control = running.querySelector(":scope > .pramanyx-live-work");
    if (!control) {
      control = document.createElement("button");
      control.type = "button";
      control.className = "pramanyx-live-work";
      control.addEventListener("click", () => {
        if (root.getAttribute(KEY) === "open") root.removeAttribute(KEY); else root.setAttribute(KEY, "open");
        control.textContent = words();
      });
      running.appendChild(control);
    }
    if (control.textContent !== words()) control.textContent = words();
  };
  new MutationObserver(tend).observe(document.body, { childList: true, subtree: true });
  tend();
}

const SAID = "pramanyx.coworker.said.";

async function say(path, body) {
  const answer = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!answer.ok) throw new Error(String(answer.status));
  return answer.json().catch(() => ({}));
}

/**
 * Was this right? The one thing a card writes. It goes to Pramanyx as the app's own control sends it: the
 * judgement to the answer's record, and — when a person says what was wrong, or gives the SQL that would have
 * been right — a verdict that later answers on the connection are given. What was said is remembered in this
 * browser by the answer's id, so a card reopened later says what was said and does not ask again. It is drawn as
 * two icons at the foot of the answer; `extras` are the answer's other controls, which share that one row.
 */
function Feedback({ answer, extras = null }) {
  const id = String(answer.investigation_id || "");
  const connection = String(answer.connection || "");
  const kept = () => { try { return localStorage.getItem(SAID + id) || ""; } catch { return ""; } };
  const [said, setSaid] = useState(kept);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [fix, setFix] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const settle = (what) => { try { localStorage.setItem(SAID + id, what); } catch { /* said for this visit */ } setSaid(what); };
  const judge = async (verdict) => {
    setBusy(true); setFailed(false);
    try {
      const got = await say("/pramanyx-feedback", { connection, answer: id, verdict });
      if (verdict === "helpful") settle(got.accepted ? "right-kept" : "right");
      else { settle("wrong"); setAsking(true); }
    } catch { setFailed(true); } finally { setBusy(false); }
  };
  const explain = async () => {
    setBusy(true); setFailed(false);
    try {
      await say("/pramanyx-verdict", {
        connection, answer: id, verdict: fix.trim() ? "correct" : "reject", note: note.trim(),
        headline: answer.answer || "", sql: answer.sql || "", corrected_sql: fix.trim(),
      });
      settle(fix.trim() ? "corrected" : "explained"); setAsking(false);
    } catch { setFailed(true); } finally { setBusy(false); }
  };

  const SAYS = {
    "right": "You said this was right. Recorded.",
    "right-kept": "You said this was right. It is kept as an accepted answer.",
    "wrong": "You said this was wrong. Recorded.",
    "explained": "You said this was wrong, and why. Later answers on this connection are given it.",
    "corrected": "You gave the SQL that would have been right. Later answers on this connection are given it.",
  };
  const field = { font: "inherit", fontSize: 12.5, color: "inherit", background: "transparent", border: `1px solid ${line}`,
                  borderRadius: 4, padding: "6px 8px", width: "100%", boxSizing: "border-box", resize: "vertical" };
  const canJudge = Boolean(id && connection);
  return h("div", { style: { fontSize: 12.5, display: "flex", flexDirection: "column", gap: 8 } },
    h("div", { style: { display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center" } },
      canJudge && !said ? h("button", { type: "button", className: "pramanyx-icon", disabled: busy, "aria-label": "This was right", title: "This was right", onClick: () => judge("helpful") }, h(Glyph, { d: GLYPH.right })) : null,
      canJudge && !said ? h("button", { type: "button", className: "pramanyx-icon", disabled: busy, "aria-label": "This was wrong", title: "This was wrong", onClick: () => judge("unhelpful") }, h(Glyph, { d: GLYPH.wrong })) : null,
      extras),
    canJudge && said && !asking ? h("div", { style: quiet }, SAYS[said] ?? SAYS.right) : null,
    asking ? h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
      h("div", { style: quiet }, SAYS.wrong),
      h("label", { htmlFor: `why-${id}` }, "What was wrong?"),
      h("textarea", { id: `why-${id}`, rows: 2, value: note, onChange: (e) => setNote(e.target.value), style: field }),
      h("label", { htmlFor: `fix-${id}` }, "The SQL that would have been right, if you have it"),
      h("textarea", { id: `fix-${id}`, rows: 3, value: fix, onChange: (e) => setFix(e.target.value), style: { ...field, fontFamily: "ui-monospace, monospace" } }),
      h("div", { style: { display: "flex", gap: 8 } },
        h("button", { type: "button", disabled: busy || !(note.trim() || fix.trim()), style: button(false), onClick: explain }, "Record it"),
        h("button", { type: "button", disabled: busy, style: button(false), onClick: () => setAsking(false) }, "Leave it at wrong"))) : null,
    failed ? h("div", null, "That was not recorded. Try again.") : null);
}

const OBJECTS_SHOWN = 3;

const GLYPH = {
  edit: ["M11.2 2.6l2.2 2.2-7.6 7.6-3 .8.8-3z", "M9.8 4l2.2 2.2"],
  table: ["M2.5 3.5h11v9h-11z", "M2.5 6.5h11M2.5 9.5h11M6.5 3.5v9"],
  download: ["M8 2.5v7.5M5 7.5l3 3 3-3", "M3 13.5h10"],
  copy: ["M5.5 5.5h8v8h-8z", "M10.5 5.5V3a.5.5 0 00-.5-.5H3a.5.5 0 00-.5.5v7a.5.5 0 00.5.5h2.5"],
  right: ["M5 7.2v6.3H2.8V7.2z", "M5 7.2l2.6-4.7c1 0 1.7.7 1.7 1.7v2.2h3a1 1 0 011 1.2l-.9 4.4a1.3 1.3 0 01-1.3 1.1H5"],
  wrong: ["M11 8.8V2.5h2.2v6.3z", "M11 8.8l-2.6 4.7c-1 0-1.7-.7-1.7-1.7V9.6h-3a1 1 0 01-1-1.2l.9-4.4A1.3 1.3 0 014.9 2.9H11"],
};
const Glyph = ({ d }) => h("svg", { width: 15, height: 15, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
  d.map((path, i) => h("path", { key: i, d: path })));

/**
 * Write a question into the question box, for the person to send or change. The shell hands the box's own setter
 * only to what it mounts above the box on the first screen, so here the box is found in the page and typed into as
 * a person would. False when there is no box to find; the caller then leaves the question on the clipboard.
 */
function draft(question) {
  const seat = document.querySelector("[data-composer-seat]") ?? document;
  const box = seat.querySelector("textarea");
  if (box) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, question);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
    return true;
  }
  const field = seat.querySelector('[contenteditable="true"], [contenteditable=""], [role="textbox"]');
  if (!field) return false;
  field.focus();
  document.execCommand("selectAll");
  return document.execCommand("insertText", false, question);
}

/** Words the platform wrote, with what it marked `**decisive**` set bold. Nothing else in them is read as markup. */
function rich(text) {
  return String(text || "").split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((piece, i) =>
    (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4
      ? h("strong", { key: i, style: { fontWeight: 600 } }, piece.slice(2, -2)) : piece));
}

/** "Total gmv eur by platform": what an exhibit of one measure over one dimension is of, from its own columns. */
function titleOf(answer) {
  const columns = answer.columns ?? [];
  if (columns.length !== 2) return "";
  const numeric = numericColumns(columns, answer.rows ?? []);
  if (!numeric[0] && !numeric[1]) return "";
  // Two numbers: the first is what the rows are broken down by (review score), the second what was counted for each.
  // The chart draws them that way round (`resolveSpec`: the measure is never the band).
  const [measureAt, byAt] = numeric[0] && numeric[1] ? [1, 0] : numeric[0] ? [0, 1] : [1, 0];
  return `${labelOf(columns[measureAt])} by ${labelOf(columns[byAt]).toLowerCase()}`;
}

/**
 * One row of numbers is a figure, not a chart and not a one-line table: each number set large under its name, and
 * what is not a number said beside it. The Data Canvas shows a single-row answer this way.
 */
function Figures({ answer }) {
  const columns = answer.columns ?? [], row = (answer.rows ?? [])[0] ?? [];
  const numeric = numericColumns(columns, answer.rows ?? []);
  const units = unitsOf(answer);
  return h("div", { style: { display: "flex", flexWrap: "wrap", gap: "14px 36px", padding: "6px 0 10px" } },
    columns.map((c, i) => h("div", { key: c, style: { minWidth: 0 } },
      h("div", { style: { ...quiet, fontSize: 12.5 } }, labelOf(c)),
      // The short form to read, the whole figure on hover: €56.93m, and 56,931,850.61 behind it.
      h("div", { title: numeric[i] ? shown(row[i], true, units[c]) : undefined,
                 style: { fontSize: numeric[i] ? 26 : 15, fontWeight: 600, lineHeight: 1.3, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" } },
        shown(row[i], numeric[i], units[c], true)))));
}

/**
 * An answer, laid out to be read: what was found, said in a headline and a few sentences the platform wrote from
 * the rows; then the exhibit — a title, the chart, and three icons in its corner (take the rows away, see them as
 * a table, change how they are drawn); then what stands out. What a sentence stood on is a small mark at its end,
 * and opens the app's own page for it beside the conversation. Everything else an answer can show is one quiet
 * row at its foot. Nothing here is a second telling: every word is the platform's, and every number is from the rows.
 */
export function headlineOf(text) {
  const said = String(text || "").trim();
  if (said.length <= 220) return { head: said, rest: "" };
  const cut = said.slice(0, 220).search(/[.!?](\s|$)(?![\s\S]*[.!?](\s|$))/);
  const at = cut > 40 ? cut + 1 : said.slice(0, 220).lastIndexOf(" ");
  return { head: said.slice(0, at > 0 ? at : 220).trim(), rest: said.slice(at > 0 ? at : 220).trim() };
}

function Exhibit({ answer, whole, asked }) {
  const id = idOf(answer, asked);
  const viz = useChosen(id);
  const [open, setOpen] = useState("");
  const [allObjects, setAllObjects] = useState(false);
  const [sheets, setSheets] = useState(null);
  const [copied, setCopied] = useState(false);
  // An answer over the Sheets connection read spreadsheets: each opens as itself, beside the conversation.
  const overSheets = String(answer.connection || answer.receipt?.artifact?.conn_id || "") === "sheets";
  useEffect(() => { if (overSheets) sheetsByTable().then(setSheets); }, [overSheets]);
  useEffect(() => { remember(id, answer, asked); }, [id, answer, asked]);
  const rows = answer.rows ?? [];
  const count = typeof answer.row_count === "number" ? answer.row_count : rows.length;
  const toggle = (what) => setOpen((was) => (was === what ? "" : what));
  const ground = groundingOf(answer);
  const metrics = ground ? ground.metrics : [];
  // The ontology's objects the receipt names, then any table read that is not one of them under another spelling
  // (`orders` is the object `Order`).
  const same = (a, b) => a.toLowerCase().replace(/s$/, "") === b.toLowerCase().replace(/s$/, "");
  const objects = ground ? ground.objects : [];
  const tables = [...objects, ...(answer.tables_used ?? []).filter((t) => !objects.some((o) => same(o, t)))];
  const receipt = answer.receipt?.artifact?.id || "";
  // What this answer can become (2026-11-17): each the app's own flow, opened beside the conversation from the
  // answer's question and connection, and finished there by the person — nothing is made by the click alone. Saving
  // the method as a skill is a deep analysis's, and is not offered for a quick answer.
  const askedAs = String(answer.question || asked || "").trim();
  const onConnection = String(answer.connection || "");
  const becomes = askedAs && onConnection && hasPane() ? [
    ["Schedule it", pageFor.toSchedule(askedAs, onConnection), "Set this question on a schedule — you choose when, and where the answer goes"],
    ["Keep on a dashboard", pageFor.toKeep(askedAs, onConnection, answer.investigation_id ? String(answer.investigation_id) : ""),
     "Keep it on the connection's dashboard, asked again on a rhythm you choose"],
    ["Make an agent from it", pageFor.toAgent(askedAs, onConnection), "Draft an agent that answers questions like this one — you read it before it is made"],
  ] : [];
  const connection = String(answer.connection || answer.receipt?.artifact?.conn_id || "");
  const told = answer.narrative && typeof answer.narrative === "object" ? answer.narrative : null;
  const words = told && typeof told.narrative === "string" ? told.narrative.trim() : "";
  // A headline is a line. An answer written as a paragraph (an agent's prose) keeps its first sentence as the
  // headline and the rest as text: drawn whole at headline size, a long answer filled the screen in bold.
  const lead = headlineOf(answer.answer || answer.question || "Answer");
  const standsOut = told && Array.isArray(told.anomalies) ? told.anomalies.filter((x) => typeof x === "string" && x.trim()) : [];
  const wrong = Array.isArray(answer.warning?.issues) ? answer.warning.issues.filter((x) => typeof x === "string" && x.trim()) : [];
  const checked = answer.warning?.kind === "not_what_was_asked";
  const asks = Array.isArray(answer.followups) ? answer.followups.filter((x) => typeof x === "string" && x.trim()).slice(0, 3) : [];
  const figure = rows.length === 1;
  const title = titleOf(answer);
  const marks = hasPane() && connection;
  const sheetsRead = (overSheets && sheets ? (answer.tables_used ?? []) : []).map((t) => sheets.get(String(t).split(".").pop().toLowerCase())).filter(Boolean);
  const copy = () => {
    const text = [answer.answer, words.replace(/\*\*/g, ""), "", [answer.columns ?? [], ...rows].map((r) => r.join("\t")).join("\n")].filter((x) => x !== null && x !== undefined).join("\n");
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  // What the answer was held to and what it read: a mark each, at the end of what was said.
  const stoodOn = marks ? [
    ...metrics.map((m) => h("button", {
      key: `m-${m.name}`, type: "button", className: "pramanyx-mark",
      title: m.departed ? "The answer did not use this metric as approved. Opens its definition." : "The approved metric this answer was held to. Opens its definition.",
      onClick: () => openBeside("page", pageFor.metric(m.name, connection)),
    }, m.departed ? `${m.name} · not used as approved` : m.name)),
    ...(ground ? ground.definitions : []).map((term) => h("button", {
      key: `d-${term}`, type: "button", className: "pramanyx-mark", title: "A definition a person wrote, which this answer was given. Opens it.",
      onClick: () => openBeside("page", pageFor.definition(term, connection)),
    }, term)),
    ...sheetsRead.map((sheet) => h("button", { key: `s-${sheet.id}`, type: "button", className: "pramanyx-mark", title: "A spreadsheet this answer read. Opens it.",
      onClick: () => openBeside("page", pageFor.sheet(sheet.id, sheet.name)) }, sheet.name)),
    // The first few objects, and the rest behind one mark: an answer grounded in eight would otherwise trail a
    // line of them.
    ...(allObjects ? tables : tables.slice(0, OBJECTS_SHOWN)).map((t) => h("button", {
      key: `t-${t}`, type: "button", className: "pramanyx-mark", title: "An object of the ontology this answer read. Opens it.",
      onClick: () => openBeside("page", pageFor.type(t, connection)),
    }, t)),
    tables.length > OBJECTS_SHOWN ? h("button", { key: "more", type: "button", className: "pramanyx-mark", "aria-expanded": allObjects, onClick: () => setAllObjects((was) => !was) },
      allObjects ? "fewer" : `+${tables.length - OBJECTS_SHOWN}`) : null,
  ] : [];
  return h("div", { style: { display: "flex", flexDirection: "column", gap: 14, margin: "10px 0 6px", fontSize: 14.5, lineHeight: 1.6 } },
    h("div", { role: "heading", "aria-level": 3, style: { fontSize: 20, fontWeight: 600, lineHeight: 1.3 } }, lead.head),
    lead.rest ? h("div", null, rich(lead.rest)) : null,
    // What the platform itself says is wrong with this answer, said under the headline where a finding would be.
    wrong.length ? h("div", { role: "alert", style: { display: "flex", gap: 8, alignItems: "baseline", padding: "8px 10px", borderRadius: 6,
                                                      border: "1px solid color-mix(in srgb, #e5a50a 55%, transparent)", background: "color-mix(in srgb, #e5a50a 9%, transparent)" } },
      h("span", { "aria-hidden": "true", style: { fontWeight: 600 } }, "!"),
      h("span", null, checked ? wrong.join(" ") : `This may not be right: ${wrong.join("; ")}`)) : null,
    words || stoodOn.length ? h("div", null, rich(words), stoodOn) : null,
    h("div", { style: { border: `1px solid ${line}`, borderRadius: 6, padding: "8px 8px 4px 14px" } },
      h("div", { style: { display: "flex", alignItems: "center", gap: 2, minHeight: 30 } },
        h("div", { style: { flex: "1 1 auto", minWidth: 0, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, title),
        h("button", { type: "button", className: "pramanyx-icon", "aria-label": "Download", title: "Download: the rows, or the answer as a file", "aria-expanded": open === "files", onClick: () => toggle("files") }, h(Glyph, { d: GLYPH.download })),
        figure ? null : h("button", { type: "button", className: "pramanyx-icon", "aria-label": "Show as a table", title: "Show as a table", "aria-expanded": open === "table", onClick: () => toggle("table") }, h(Glyph, { d: GLYPH.table })),
        !figure && hasPane() ? h("button", { type: "button", className: "pramanyx-icon", "aria-label": "Edit visualization", title: "Edit visualization", onClick: () => openBeside("viz", id) }, h(Glyph, { d: GLYPH.edit })) : null),
      open === "files" ? h(Files, { answer, id: answer.investigation_id ? String(answer.investigation_id) : "" }) : null,
      h("div", { style: { paddingRight: 6 } },
        figure ? h(Figures, { answer }) : open === "table" ? h("div", { style: { padding: "6px 0 8px" } }, h(ResultGrid, { answer })) : h(Chart, { answer, viz })),
      h("div", { style: { display: "flex", alignItems: "center", gap: 12, borderTop: `1px solid ${line}`, marginTop: 6, paddingRight: 6 } },
        h("button", { type: "button", className: "pramanyx-link", "aria-expanded": open === "sql", onClick: () => { if (!openBeside("sql", id)) toggle("sql"); } }, "Show the SQL"),
        h("span", { style: { flex: "1 1 auto" } }),
        h("span", { style: { ...quiet, fontSize: 12.5 } }, `${count} ${count === 1 ? "row" : "rows"}`)),
      open === "sql" ? h("div", { style: { padding: "4px 6px 8px 0" } }, h(Sql, { answer })) : null),
    standsOut.length ? h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
      h("div", { role: "heading", "aria-level": 4, style: { fontSize: 16, fontWeight: 600 } }, "What stands out"),
      standsOut.map((point, i) => h("div", { key: i }, rich(point)))) : null,
    asks.length ? h("div", { style: { display: "flex", flexDirection: "column" } },
      h("div", { style: { ...quiet, fontSize: 12.5, paddingBottom: 2 } }, "Follow-ups"),
      asks.map((question, i) => h("button", {
        key: i, type: "button", className: "pramanyx-ask", title: "Writes this question into the box. Nothing is asked until you send it.",
        onClick: () => { if (!draft(question)) navigator.clipboard?.writeText(question); },
      }, question))) : null,
    h(Feedback, { answer, extras: [
      h("button", { key: "copy", type: "button", className: "pramanyx-icon", "aria-label": copied ? "Copied" : "Copy the answer", title: copied ? "Copied" : "Copy the answer", onClick: copy }, h(Glyph, { d: GLYPH.copy })),
      h("span", { key: "gap", style: { width: 8 } }),
      receipt && hasPane() ? h("button", { key: "why", type: "button", className: "pramanyx-link", title: "The app's own page for how this number was produced",
        onClick: () => openBeside("page", pageFor.receipt(receipt)) }, "Why this number") : null,
      h("span", { key: "gap2", style: { width: 12 } }),
      h("button", { key: "how", type: "button", className: "pramanyx-link", "aria-expanded": open === "how", onClick: () => toggle("how") }, "How it was answered"),
      becomes.length ? h("span", { key: "gap3", style: { width: 12 } }) : null,
      becomes.length ? h("button", { key: "more", type: "button", className: "pramanyx-link", "aria-expanded": open === "more",
        title: "What this answer can become: on a schedule, on a dashboard, an agent", onClick: () => toggle("more") }, "More") : null,
    ] }),
    open === "more" ? h("div", { role: "group", "aria-label": "What this answer can become",
      style: { display: "flex", flexWrap: "wrap", gap: 14, padding: "2px 6px 6px 0", fontSize: 13 } },
      becomes.map(([label, path, hint]) => h("button", { key: label, type: "button", className: "pramanyx-link", title: hint,
        onClick: () => openBeside("page", path) }, label))) : null,
    open === "how" ? h("div", { style: { padding: "4px 0" } }, h(How, { answer, whole })) : null);
}

/**
 * Download: the rows as CSV, kept on this page; and the answer as a file Pramanyx builds from its stored report —
 * Excel with every stored row, PowerPoint, Word, PDF (`pramanyx/export`). Never a file the model's own code made: a
 * figure does not pass through code a model wrote. An answer with no record of its own (nothing was stored) offers
 * the rows only, and says so.
 */
const FILES = [["xlsx", "Excel, every row"], ["pptx", "PowerPoint"], ["docx", "Word"], ["pdf", "PDF"]];

function emailOf(answer) {
  const told = answer.narrative && typeof answer.narrative === "object" ? String(answer.narrative.narrative || "").replace(/\*\*/g, "") : "";
  const rows = (answer.rows ?? []).slice(0, 20).map((r) => r.join(" · "));
  return { to: "", subject: String(answer.answer || answer.question || "From Pramanyx").slice(0, 150),
           body: [answer.answer, told, rows.length ? [(answer.columns ?? []).join(" · "), ...rows].join("\n") : ""].filter(Boolean).join("\n\n"),
           // "Email this" knows its answer, so the analysis can be attached — and the draft is named for the answer,
           // so an answer that was emailed says so whenever it is opened.
           attach_answer: answer.investigation_id ? String(answer.investigation_id) : "", attach_format: "",
           ...(answer.investigation_id ? { name: `a-${answer.investigation_id}` } : {}) };
}

function Files({ answer, id }) {
  const link = { fontSize: 13, color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 };
  const [emailing, setEmailing] = useState(false);
  return h("div", null, h("div", { role: "group", "aria-label": "Download", style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, padding: "2px 6px 8px 0", fontSize: 13 } },
    h("button", { type: "button", className: "pramanyx-link", "aria-expanded": emailing, onClick: () => setEmailing((was) => !was) }, "Email this"),
    h("button", { type: "button", className: "pramanyx-link", onClick: () => downloadCsv(answer) }, "Rows as CSV"),
    id ? FILES.map(([fmt, label]) => h("a", { key: fmt, style: link, download: "",
      href: `/pramanyx/investigations/${encodeURIComponent(id)}/export?format=${fmt}` }, label))
      : h("span", { style: quiet }, "This answer was not stored, so only its rows can be taken.")),
    emailing ? h(Draft, { draft: emailOf(answer) }) : null);
}

/**
 * A file the person attached, brought into Pramanyx as theirs (2026-11-17): what it became, by name, and its own page
 * beside the conversation — a sheet opens as the sheet. Never a summary of the file drawn here.
 */
function BroughtInCard(props) {
  const args = argsOf(props.block);
  const named = String(args.name || "a file");
  if (props.phase !== "result") return h(Step, { kind: "read", busy: true, title: `Bringing in ${named}` });
  let got = null;
  try { got = JSON.parse(resultText(props.block)); } catch { got = null; }
  if (!got || props.block?.isError || got.brought_in !== true) {
    return h(Step, { kind: "read", failed: true, title: `${named} was not brought in` },
      h("div", { style: quiet }, String(got?.why || "The platform did not take it.")));
  }
  if (got.kind === "sheet") {
    const sheets = Array.isArray(got.sheets) ? got.sheets : [];
    return h(Step, { kind: "read", title: `Brought in ${got.file || named} as your sheet${sheets.length > 1 ? "s" : ""} ${sheets.map((x) => x.name).join(", ")}` },
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
        h("span", { style: quiet }, "Only you can see it until you share it."),
        ...sheets.map((x) => h("button", { key: x.id, type: "button", style: button(false),
          onClick: () => openBeside("page", pageFor.sheet(x.id, x.name)) }, sheets.length > 1 ? `Open ${x.name}` : "Open the sheet"))));
  }
  const doc = got.document || {};
  return h(Step, { kind: "read", title: `Brought in ${got.file || named} as your document ${doc.title || ""}`.trim() },
    h("div", { style: quiet }, `Only you can see it until you share it. ${doc.chunks ? `Read in ${doc.chunks} passages, which now reach answers.` : ""}`));
}

/** What the coworker drafted for the person, and the Definition's own page to read and publish it (2026-11-17). */
function DraftedDefinitionCard(props) {
  const args = argsOf(props.block);
  const term = String(args.term || "a word");
  if (props.phase !== "result") return h(Step, { kind: "read", busy: true, title: `Drafting what “${term}” means` });
  let got = null;
  try { got = JSON.parse(resultText(props.block)); } catch { got = null; }
  if (!got || props.block?.isError || !got.made) {
    return h(Step, { kind: "read", failed: true, title: `“${term}” was not drafted` },
      h("div", { style: quiet }, String(got?.detail || got?.why || "The platform did not take it.")));
  }
  const page = pageFor.definition(String(got.term || term), String(args.connection || "")) + (got.area ? `&area=${encodeURIComponent(got.area)}` : "");
  const title = got.made === "draft" ? `Drafted what “${got.term || term}” means — yours to publish`
    : `Suggested an edit to “${got.term || term}” for its owner`;
  return h(Step, { kind: "read", title },
    h("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
      h("span", { style: quiet }, got.made === "draft" ? "No answer uses it until it is published." : "The published wording stands until its owner accepts."),
      h("button", { type: "button", style: button(false), onClick: () => openBeside("page", page) },
        got.made === "draft" ? "Open to publish" : "Open the definition")));
}

function Card(props) {
  const frame = { margin: "8px 0", fontSize: 13 };
  const asked = String(argsOf(props.block).question || "");

  if (props.phase !== "result") {
    return h("div", { style: frame }, h("div", { style: quiet }, asked ? `Asking: ${asked}` : "Asking"));
  }

  const read = readAnswer(resultText(props.block));
  if (!read || props.block?.isError) {
    return h("div", { style: frame },
      h("div", null, props.block?.isError ? "This could not be answered." : "An answer came back, but this page could not read it."),
      props.inspect ? h("div", { style: { paddingTop: 8 } },
        h("button", { type: "button", style: button(false), onClick: props.inspect }, "Open the raw result")) : null);
  }

  // Nothing was run, so there is nothing to draw. It is a row in the work ("no query run"), not a card among the
  // answers: a card of words under the reply read as a finding, and a long one buried the real answers.
  if (inWordsOnly(read.answer)) return null;
  return h(Exhibit, { answer: read.answer, whole: read.whole, asked });
}

/**
 * ALLOW ONCE, IN THE CONVERSATION (2026-11-18; the user: "this 'Allow Once' card should appear inside the conversation
 * panel right? Why does it pop-out like Windows 98 info tab?"). Something the coworker asks before doing — a schedule,
 * a draft of what a word means — was put to the person by the shell's own card, which takes the question box's place
 * at the foot of the page, under a strip of its own. It is asked here instead: under the step that waits on it, in the
 * conversation, in the conversation's own type, with Reject and Allow once. The box at the foot says where the
 * question is. The answer goes to the same request the shell's card would answer (`answer("allowed-once")`), so what
 * is recorded is unchanged: the person's own click.
 */
function waitingApprovalOf(props) {
  const pick = (all) => {
    for (const status of all?.values?.() ?? []) {
      const waiting = status?.pendingInteraction;
      if (waiting && waiting.kind === "approval" && waiting.callId === props.callId && waiting.answerable !== false) return waiting;
    }
    return null;
  };
  return typeof props.useSessionStatus === "function" ? props.useSessionStatus(pick) : null;
}

function reasonOf(approval) {
  if (typeof approval?.reason === "string" && approval.reason) return approval.reason;
  const said = approval?.displayReason;
  return (said && typeof said.en === "string" && said.en) || "Go ahead with this?";
}

export function Decision({ approval }) {
  const [busy, setBusy] = useState(false);
  const answer = (outcome) => {
    setBusy(true);
    Promise.resolve(approval.answer(outcome)).catch(() => setBusy(false));
  };
  return h("div", { "data-pramanyx-decision": String(approval.callId || ""),
                    style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", padding: "6px 0 10px", fontSize: 13.5 } },
    h("span", { style: { flex: "1 1 260px", minWidth: 0, lineHeight: 1.45 } }, reasonOf(approval)),
    h("span", { style: { display: "flex", gap: 8, flex: "none" } },
      h("button", { type: "button", disabled: busy, style: button(false), onClick: () => answer("rejected") }, "Reject"),
      h("button", { type: "button", disabled: busy, style: { ...button(true), fontWeight: 600 }, onClick: () => answer("allowed-once") }, "Allow once")));
}

/** A Pramanyx step, with the question it waits on under it while it waits. */
const decided = (View) => function DecidedStep(props) {
  const approval = waitingApprovalOf(props);
  return h("div", null, h(View, props), approval ? h(Decision, { approval }) : null);
};

/** The foot of the page while a Pramanyx step waits: where the question is. Should the step not be drawn — a
 *  conversation scrolled away from it — the question is asked here, the same way. */
function WaitingAbove(props) {
  const approval = props.matched;
  const [inPlace, setInPlace] = useState(true);
  useEffect(() => {
    const look = () => setInPlace(Boolean(document.querySelector(`[data-pramanyx-decision="${CSS.escape(String(approval?.callId || ""))}"]`)));
    look();
    const timer = setInterval(look, 1000);
    return () => clearInterval(timer);
  }, [approval?.callId]);
  if (!approval) return null;
  return h("div", { "data-pramanyx-waiting-above": "", style: { padding: "10px 16px" } },
    inPlace
      ? h("div", { style: { display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 } },
          h("span", { style: quiet }, "Waiting for your answer in the conversation: Allow once or Reject."),
          h("button", { type: "button", className: "pramanyx-link",
            onClick: () => document.querySelector(`[data-pramanyx-decision="${CSS.escape(String(approval.callId || ""))}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }) }, "Show it"))
      : h(Decision, { approval }));
}

export const inject = ["slots"];

/**
 * Give one Pramanyx tool its row in the list of steps, once: the answer card for a tool that answers, a named
 * step for any other. Set by `apply`. A tool that is not Pramanyx's keeps the shell's own row.
 */
let nameStepsOf = () => {};

export function apply(ctx) {
  const named = new Set();
  nameStepsOf = (name) => {
    if (typeof name !== "string" || named.has(name) || !name.startsWith(PREFIX)) return;
    named.add(name);
    ctx.slots.inject("tool.call.toolview", () =>
      ctx.slots.register({ name: "tool.call.toolview", key: name },
        decided(ANSWERS.test(name) ? AnswerCard : name === PREFIX + "draft_email" ? DraftCard
          : name === PREFIX + "bring_in_file" ? BroughtInCard
          : name === PREFIX + "draft_definition" ? DraftedDefinitionCard
          : SCHEDULES.test(name) ? ScheduleCard : ToolStep)));
  };
  // What a Pramanyx step waits on is asked in the conversation, under the step; the foot of the page says where. The
  // composer's occupants are tried lowest priority first, and the shell's approval card is 1 (its question card 0, a
  // read-only helper's view -10): this one, -1, answers only Pramanyx's approvals and passes everything else on.
  ctx.slots.inject("conversation.composer", () => ctx.slots.register({
    name: "conversation.composer",
    priority: -1,
    select: ({ pendingInteraction: waiting }) =>
      (waiting && waiting.kind === "approval" && String(waiting.toolName || "").startsWith(PREFIX) ? waiting : null),
  }, WaitingAbove));
  // The tools known when this was written are named from the first call. A view is keyed by exact tool name, so
  // one added to Pramanyx since — and each custom agent's — gets its view at the end of the first turn that calls it.
  nameStepsOf(TOOL);
  for (const short of Object.keys(DOES)) nameStepsOf(PREFIX + short);
  wearStepsLook();
  foldRunningWork();
  foldHelperReports();
  // The shell's right-hand pane, when it has one: one kind of tab, for an answer's SQL and rows and for its chart's
  // editor. Without it the SQL opens in the card and there is no editor.
  ctx.inject(["sidebarRightTabs", "sidebarRight"], (at) => {
    at.effect(() => at.sidebarRightTabs.register({
      id: PANE, kind: PANE, patterns: [PANE_PATTERN], canOpen: () => true, title: () => "Answer",
    }), "pramanyx-answer-card: pane type");
    at.effect(() => at.slots.inject("sidebar.right.pane.tab", () =>
      at.slots.register({ name: "sidebar.right.pane.tab", key: PANE }, PaneBody)), "pramanyx-answer-card: pane body");
    at.effect(() => at.slots.inject("sidebar.right.pane.tab.title", () =>
      at.slots.register({ name: "sidebar.right.pane.tab.title", key: PANE }, PaneTitle)), "pramanyx-answer-card: pane title");
    setOpener((address) => at.sidebarRight.openResource(address));
    at.effect(() => () => setOpener(null), "pramanyx-answer-card: pane opener");
  });
  ctx.slots.inject("conversation.chat.turnTail", () =>
    ctx.slots.register({ name: "conversation.chat.turnTail", id: "pramanyx-coworker-answer-card" }, AnswerTail));
}
