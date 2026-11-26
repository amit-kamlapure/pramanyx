/**
 * The answer envelope, as the web reads it — the one answer object every surface draws (the plan of record, 2026-11-27:
 * "one answer object, drawn by one view family at every web surface; chat and report are layouts of the same view").
 *
 * The backend folds it at the end of every `/ask` stream (`pramanyx/answer/envelope.py`, the single implementation) and
 * sends it as the stream's last frame, `envelope`. Until now the web dropped that frame (it sat in `UNRENDERED_FRAMES`) and
 * drew each answer from the frames themselves, one way per surface. Now the frame rides the turn (`ChatTurn.envelope`),
 * and `answerOfTurn` hands the view it. A reopened thread replays the envelope its turn filed, as the stream's last part
 * (`_turn_to_ui_messages`); only while a turn still streams, or for a turn filed before envelopes were, are the same
 * fields read off the turn, so the view is one either way.
 *
 * Pure: no I/O, no browser module. `chatTurn.ts` reads it on the server too (the chat route), so nothing here may import
 * a runtime value from `lib/api.ts`.
 */

import type { ChatTurn } from "./chatTurn";

export interface EnvelopeGrid {
  columns: string[];
  rows: unknown[][];
  caption?: string;
}

export interface EnvelopeChart {
  chart_type: string;
  chart_config: Record<string, unknown>;
}

export interface EnvelopeFigure {
  label: string;
  value: string;
  note?: string;
}

export interface EnvelopeExhibit {
  claim: string;
  grid: EnvelopeGrid;
  chart: EnvelopeChart;
  caveats: string[];
}

/** The path the answer took: the question's kind, the depth, the engine that answered and why. */
export interface AnswerPath {
  kind?: string;
  depth?: string;
  engine?: string;
  why?: string;
}

export interface EnvelopeProvenance {
  receipt_id: string;
  mode: string;
  confidence: string;
  sql: string[];
  tables_used: string[];
  handed_to: string;
  path: AnswerPath;
}

export interface AnswerEnvelope {
  question: string;
  headline: string;
  body: string;
  grid: EnvelopeGrid | null;
  chart: EnvelopeChart | null;
  caveats: string[];
  follow_ups: string[];
  figures: EnvelopeFigure[];
  exhibits: EnvelopeExhibit[];
  gaps: string;
  provenance: EnvelopeProvenance;
  error: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).map(s => s.trim()).filter(Boolean) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

function readGrid(v: unknown): EnvelopeGrid | null {
  const g = obj(v);
  const columns = strs(g.columns);
  const rows = Array.isArray(g.rows) ? (g.rows as unknown[]).filter(Array.isArray) as unknown[][] : [];
  if (!columns.length) return null;
  return { columns, rows, ...(str(g.caption) ? { caption: str(g.caption) } : {}) };
}

function readChart(v: unknown): EnvelopeChart | null {
  if (!v || typeof v !== "object") return null;
  const c = obj(v);
  return { chart_type: str(c.chart_type) || "auto", chart_config: obj(c.chart_config) };
}

function readPath(v: unknown): AnswerPath {
  const p = obj(v);
  const out: AnswerPath = {};
  for (const k of ["kind", "depth", "engine", "why"] as const) if (str(p[k])) out[k] = str(p[k]);
  return out;
}

/** An empty envelope: every field present, nothing in it. */
export const EMPTY_ENVELOPE: AnswerEnvelope = {
  question: "", headline: "", body: "", grid: null, chart: null, caveats: [], follow_ups: [], figures: [], exhibits: [],
  gaps: "", error: "",
  provenance: { receipt_id: "", mode: "", confidence: "", sql: [], tables_used: [], handed_to: "", path: {} },
};

/** The envelope a frame carried, read defensively — it crosses the wire. Null when it carries no answer. */
export function readEnvelope(raw: unknown): AnswerEnvelope | null {
  const e = obj(raw);
  if (!Object.keys(e).length) return null;
  const prov = obj(e.provenance);
  const exhibits: EnvelopeExhibit[] = (Array.isArray(e.exhibits) ? e.exhibits : []).flatMap((x) => {
    const ex = obj(x);
    const grid = readGrid(ex.grid);
    if (!grid) return [];
    return [{ claim: str(ex.claim), grid, chart: readChart(ex.chart) ?? { chart_type: "auto", chart_config: {} }, caveats: strs(ex.caveats) }];
  });
  const env: AnswerEnvelope = {
    question: str(e.question),
    headline: str(e.headline),
    body: str(e.body),
    grid: readGrid(e.grid),
    chart: readChart(e.chart),
    caveats: strs(e.caveats),
    follow_ups: strs(e.follow_ups),
    figures: (Array.isArray(e.figures) ? e.figures : []).map(obj)
      .map(f => ({ label: str(f.label), value: str(f.value), ...(str(f.note) ? { note: str(f.note) } : {}) }))
      .filter(f => f.value.trim()),
    exhibits,
    gaps: str(e.gaps).trim(),
    error: str(e.error),
    provenance: {
      receipt_id: str(prov.receipt_id), mode: str(prov.mode),
      confidence: str(prov.confidence), sql: strs(prov.sql), tables_used: strs(prov.tables_used),
      handed_to: str(prov.handed_to), path: readPath(prov.path),
    },
  };
  return env.headline || env.body || env.error ? env : null;
}

/** The path a turn's `route` frame names — the same reading the backend's fold makes of it, for a turn whose envelope
 *  has not come (still streaming, or read back from a thread). */
export function pathOfRoute(route: ChatTurn["route"]): AnswerPath {
  if (!route) return {};
  const depth = route.depth || "";
  const engine = route.engine || (depth === "deep" ? "deep graph" : depth ? "quick core" : "");
  const out: AnswerPath = {};
  if (route.shape) out.kind = route.shape;
  if (depth) out.depth = depth;
  if (engine) out.engine = engine;
  if (route.why) out.why = route.why;
  return out;
}

const KIND_WORDS: Record<string, string> = {
  survey: "An open question", describe: "A figure", diagnose: "A why", check: "A check",
};
const ENGINE_WORDS: Record<string, string> = {
  analyst: "the analyst", converse: "the conversation", "quick core": "the quick answer", "deep graph": "the deep analysis",
};

/** How an answer was reached, in words: "A why · answered by the analyst · deep". "" when the path names nothing. */
export function pathWords(path: AnswerPath | null | undefined): string {
  if (!path) return "";
  const kind = path.kind ? KIND_WORDS[path.kind] ?? path.kind : "";
  const engine = path.engine ? ENGINE_WORDS[path.engine] ?? path.engine : "";
  return [kind, engine ? `answered by ${engine}` : "", path.depth || ""].filter(Boolean).join(" · ");
}

/**
 * The answer a turn says, as the envelope's fields: the envelope itself once it has come, otherwise the same fields read
 * off the turn. The turn's headline is kept whole (its title, cautions and the rest are split where it is drawn,
 * `lib/answerTitle.ts`), which is what the envelope's headline and body together say.
 */
export function answerOfTurn(turn: ChatTurn): AnswerEnvelope {
  const path = pathOfRoute(turn.route);
  if (turn.envelope && turn.status !== "loading") {
    const env = turn.envelope;
    return {
      ...env,
      // a fold that read no route frame (a turn carried by a job) still has the turn's
      provenance: { ...env.provenance, path: Object.keys(env.provenance.path).length ? env.provenance.path : path },
      follow_ups: env.follow_ups.length ? env.follow_ups : turn.followups,
    };
  }
  const grid = turn.columns.length ? { columns: turn.columns, rows: turn.rows } : null;
  return {
    ...EMPTY_ENVELOPE,
    question: turn.question,
    headline: turn.headline ?? "",
    body: turn.narrative?.narrative?.trim() ?? "",
    grid,
    chart: grid ? { chart_type: turn.chartType || "auto", chart_config: turn.chartConfig ?? {} } : null,
    follow_ups: turn.followups,
    error: turn.error ?? "",
    provenance: {
      ...EMPTY_ENVELOPE.provenance,
      receipt_id: turn.publicReceiptId ?? "",
      sql: turn.sql?.trim() ? [turn.sql] : [],
      tables_used: turn.tablesUsed,
      path,
    },
  };
}

const norm = (s: string) => s.replace(/\*+/g, "").replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!?]+$/, "");

/** The caveats a reader has not already been told: one the headline or body says (the quick pipeline writes its
 *  cautions onto the headline, and the fold collects the same words off the guard receipt) is said once, there. */
export function unsaidCaveats(env: Pick<AnswerEnvelope, "caveats" | "headline" | "body">): string[] {
  const said = norm(`${env.headline}\n${env.body}`);
  const out: string[] = [];
  for (const c of env.caveats) {
    const n = norm(c);
    if (n && !said.includes(n) && !out.some(o => norm(o) === n)) out.push(c);
  }
  return out;
}
