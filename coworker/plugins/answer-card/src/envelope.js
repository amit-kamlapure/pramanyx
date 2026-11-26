/**
 * The answer envelope, read for the card that draws it (the plan of record, 2026-11-27: one answer object, drawn the same
 * way everywhere). `ask`, `deep_analysis` and each `ask_<agent>` hand back the platform's own fold of the answer under
 * `envelope` (`pramanyx/answer/envelope.py`); a run read back (`get_investigation`) carries the one its job filed, on its
 * report. The card draws a quick answer and a deep one from it alike, in one order (`sectionsOf`), and draws as it did
 * before only a result that has none — one from a platform older than the envelope.
 *
 * Pure, so it is tested without a page: `node --test coworker/plugins/answer-card/test/*.test.mjs`.
 */

/** Whether an object is an envelope with something to say: a sentence, a body, an error, or results it rests on. */
function says(env) {
  return Boolean(env && typeof env === "object" && !Array.isArray(env)
    && (str(env.headline) || str(env.body) || str(env.error)
        || (Array.isArray(env.exhibits) && env.exhibits.length) || (Array.isArray(env.figures) && env.figures.length)));
}

const str = (x) => (typeof x === "string" ? x.trim() : "");

/** The envelope a tool's result or a record read back carries — on the result itself, or on the report its job filed —
 *  or null when it carries none that says anything (an older platform; a run that has not answered yet). */
export function envelopeOf(got) {
  if (!got || typeof got !== "object") return null;
  if (says(got.envelope)) return got.envelope;
  const report = got.report && typeof got.report === "object" ? got.report : null;
  return report && says(report.envelope) ? report.envelope : null;
}

/**
 * The `envelope` field of a result cut short on its way to the page, or null. The tools put it ahead of the report —
 * the largest field — so a cut that falls in the report leaves it whole; it is read by its braces, strings and all.
 */
export function envelopeIn(text) {
  const s = String(text || "");
  const at = s.search(/"envelope":\s*\{/);
  if (at < 0) return null;
  const start = s.indexOf("{", at);
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth += 1;
    else if (c === "}" && (depth -= 1) === 0) {
      try {
        const env = JSON.parse(s.slice(start, i + 1));
        return says(env) ? env : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** How a question's kind, the engine that answered it and its depth read to a person — the receipt's words
 *  (`web/components/WhyThisNumber.tsx`), and Teams' (`pramanyx/answer/doors.py`, `path_words`). */
const KIND_WORDS = { survey: "An open question", describe: "A figure", diagnose: "A why", check: "A check" };
const ENGINE_WORDS = { analyst: "the analyst", converse: "the conversation", "quick core": "the quick answer",
                       "deep graph": "the older deep engine" };

/** The path an answer took (`provenance.path`), in words — "A why · the analyst · deep" — or "" when no route was
 *  streamed. A kind or an engine the tables do not know is said as the wire spells it, never dropped. */
export function pathWords(path) {
  const p = path && typeof path === "object" ? path : {};
  const kind = str(p.kind), engine = str(p.engine), depth = str(p.depth);
  return [KIND_WORDS[kind] ?? kind, ENGINE_WORDS[engine] ?? engine, depth].filter(Boolean).join(" · ");
}

/** A grid of the envelope as the shape the card's chart and table read (`columns`, `rows`, `chart_type`,
 *  `chart_config`, `row_count`), or null when it has no rows. */
export function gridAnswer(grid, chart, extra = {}) {
  if (!grid || typeof grid !== "object") return null;
  const columns = Array.isArray(grid.columns) ? grid.columns.map(String) : [];
  const rows = Array.isArray(grid.rows) ? grid.rows.filter(Array.isArray) : [];
  if (!columns.length || !rows.length) return null;
  const config = chart && typeof chart.chart_config === "object" && chart.chart_config ? chart.chart_config : {};
  return { ...extra, columns, rows, chart_type: str(chart?.chart_type) || "auto", chart_config: config,
           row_count: typeof grid.row_count === "number" ? grid.row_count : rows.length };
}

const norm = (x) => String(x || "").toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, " ").trim();

/**
 * What the card draws from an envelope, section by section, in the order it draws them: the headline; the body; the
 * figures; the exhibits, each a claim with its grid and chart; the answer's own grid and chart when it cites no
 * exhibit; the caveats (none twice, and none the card already said under the headline — `said`) and what the evidence
 * did not settle; how it was answered; the questions to ask next. `extra` is what the tool's result adds for a chart
 * (its units, its stored id).
 */
export function sectionsOf(env, { said = [], extra = {} } = {}) {
  const e = env && typeof env === "object" ? env : {};
  const prov = e.provenance && typeof e.provenance === "object" ? e.provenance : {};
  const figures = (Array.isArray(e.figures) ? e.figures : [])
    .filter((f) => f && str(String(f.value ?? "")))
    .map((f) => ({ label: str(f.label), value: String(f.value).trim(), note: str(f.note) }));
  const exhibits = (Array.isArray(e.exhibits) ? e.exhibits : [])
    .map((x) => ({ claim: str(x?.claim), answer: gridAnswer(x?.grid, x?.chart, extra),
                   caveats: (Array.isArray(x?.caveats) ? x.caveats : []).map(str).filter(Boolean) }))
    .filter((x) => x.answer);
  const already = new Set(said.map(norm).filter(Boolean));
  const caveats = [];
  for (const c of [...(Array.isArray(e.caveats) ? e.caveats : []), ...exhibits.flatMap((x) => x.caveats)]) {
    const text = str(c);
    if (text && !already.has(norm(text)) && !caveats.some((k) => norm(k) === norm(text))) caveats.push(text);
  }
  return {
    headline: str(e.headline),
    body: str(e.body),
    error: str(e.error),
    figures,
    exhibits,
    // the grid the answer itself drew, when it cites no exhibit (a door that takes "the grid once" is handed the first
    // exhibit as the grid, so with exhibits it would be drawn twice)
    grid: exhibits.length ? null : gridAnswer(e.grid, e.chart, extra),
    caveats,
    gaps: str(e.gaps),
    path: pathWords(prov.path),
    why: str(prov.path?.why),
    followUps: (Array.isArray(e.follow_ups) ? e.follow_ups : []).map(str).filter(Boolean),
    sql: (Array.isArray(prov.sql) ? prov.sql : []).map(str).filter(Boolean),
    investigationId: str(prov.investigation_id),
    receiptId: str(prov.receipt_id),
    connection: str(prov.connection_id),
    tablesUsed: (Array.isArray(prov.tables_used) ? prov.tables_used : []).map(str).filter(Boolean),
  };
}
