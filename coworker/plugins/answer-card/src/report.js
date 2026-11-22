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
    id: String(got?.investigation_id || ""),
    connection: String(got?.connection || got?.connection_id || ""),
    running: got?.status === "running",
    cut: Boolean(got?.cut),
    message: String(got?.message || ""),
    head, summary, period, recs, sources,
    closing: String(report?.closing_summary || "").trim(),
  };
}
