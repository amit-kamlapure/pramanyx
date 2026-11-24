/**
 * A deep analysis's result, read for the card that draws it (the user, 2026-11-23: one output format in the coworker, a
 * Data Canvas and the Ask panel). Pure, so it is tested without a page: `node --test coworker/plugins/answer-card/test/`.
 */

/** The `deep_analysis` tool's result as an object, or null. A result cut short on its way to the page — the report is
 *  its largest field — still names its analysis, its connection and its question, so the card can open it whole. */
export function reportOf(text) {
  let got = null;
  try { got = JSON.parse(text); } catch { got = null; }
  if (got && typeof got === "object") return got;
  const field = (name) => {
    const m = new RegExp(`"${name}":\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(String(text || ""));
    return m ? m[1] : "";
  };
  const investigation = field("investigation_id");
  return investigation ? { investigation_id: investigation, connection: field("connection"), question: field("question"), cut: true } : null;
}

/** What the card says, in the order the platform's report says it (`web/components/InvestigationReport.tsx`): the
 *  headline, the summary unless it only repeats the headline, the change and period unless the words already say them,
 *  the bottom line, the recommended actions — and how many queries it ran, each a source the whole report shows. */
export function reportFacts(got) {
  const report = got?.report && typeof got.report === "object" ? got.report : null;
  const said = (x) => String(x || "").trim().toLowerCase();
  const head = String(report?.headline || "").trim();
  const told = String(report?.executive_summary || "").trim();
  const summary = told && said(told) !== said(head) ? told : "";
  const words = said(`${head}\n${summary}`);
  const period = [report?.total_change_label,
    [report?.observation_period, report?.comparison_basis ? `vs ${report.comparison_basis}` : ""].filter(Boolean).join(" ")]
    .map((x) => String(x || "").trim()).filter((x) => x && !words.includes(said(x)));
  const recs = (Array.isArray(report?.recommendations) ? report.recommendations : [])
    .map((r) => String(typeof r === "string" ? r : r?.action || "").trim()).filter(Boolean);
  const sources = (Array.isArray(report?.phases) ? report.phases : [])
    .filter((p) => p && p.phase_id !== "intake" && p.status !== "skipped")
    .reduce((n, p) => n + (Array.isArray(p.findings) ? p.findings.filter((f) => String(f?.sql || "").trim() && !f?.error).length : 0), 0);
  return {
    // a `deep_analysis` result names its run `investigation_id`; the platform's own record of it (`get_investigation`) `id`
    id: String(got?.investigation_id || got?.id || ""),
    connection: String(got?.connection || got?.connection_id || ""),
    running: ["running", "pending", "started"].includes(String(got?.status || "")),
    // a run that stopped before answering, and why, in the platform's own sentence (`kernel/jobs.describe_stop`)
    stopped: STOPPED.includes(String(got?.status || "")),
    why: String(got?.error || "").trim(),
    cut: Boolean(got?.cut),
    message: String(got?.message || ""),
    head, summary, period, recs, sources,
    closing: String(report?.closing_summary || "").trim(),
  };
}

/** The statuses of a run that ended without its answer (`db/history.InvStatus`). */
const STOPPED = ["failed", "timed_out", "interrupted"];

/** Whether a record read back (`get_investigation`) is a deep analysis's — one its report card draws — rather than a
 *  quick answer's, which has no phases. A deep analysis that stopped before answering has no phases either; it is drawn
 *  too, so its reason reaches the person (2026-11-24: a stopped run read back drew nothing, and said nothing of why). */
export function isDeepRecord(got) {
  if (!got || typeof got !== "object") return false;
  if (got.report && typeof got.report === "object" && Array.isArray(got.report.phases)) return true;
  return got.kind === "investigation" && STOPPED.includes(String(got.status || ""));
}

/** How often a deep analysis still running is read again, and for how long (`DeepReport`). Past the hour the platform
 *  has failed any run still 'running' (`kernel/jobs.py`, the supervisor's sweep), so the last read says how it ended. */
export const FOLLOW_EVERY_MS = 10_000;
export const FOLLOW_FOR_MS = 61 * 60_000;

/** A deep analysis read again while it ran: its record once it has ended — finished, or stopped with why — else null
 *  (still going, or paused for a person). 2026-11-24: the card said "still running" for good after the turn ended, a
 *  minute before the run did; nothing in the coworker needs a refresh. */
export function landed(record) {
  if (!record || typeof record !== "object") return null;
  return ["complete", ...STOPPED].includes(String(record.status || "")) ? record : null;
}

/** Read a running deep analysis again until it lands: `onLanded(record)` once, then nothing more. Returns the stop the
 *  card calls when it goes. A 404 or 410 — the run gone — stops the reading for good; anything else (a session to
 *  sign in again, the platform restarting) is read again. `read(id, signal)` answers like `fetch`; the clock and the timers are passed in, so this is tested
 *  without a page. */
export function follow(id, { read, onLanded, every = FOLLOW_EVERY_MS, forMs = FOLLOW_FOR_MS, now = () => Date.now(),
                             later = setTimeout, cancel = clearTimeout, controller = () => new AbortController() }) {
  let live = true;
  let timer = null;
  let abort = null;
  const until = now() + forMs;
  const again = () => { if (live && now() < until) timer = later(tick, every); };
  function tick() {
    if (!live) return;
    abort = controller();
    Promise.resolve(read(id, abort.signal))
      .then((answer) => {
        if (!live) return undefined;
        if (answer && (answer.status === 404 || answer.status === 410)) { live = false; return undefined; }
        if (!answer || !answer.ok) return again();
        return answer.json().then((record) => {
          if (!live) return;
          const done = landed(record);
          if (done) { live = false; onLanded(done); } else again();
        });
      })
      .catch(() => again());
  }
  timer = later(tick, every);
  return () => { live = false; cancel(timer); abort?.abort(); };
}
