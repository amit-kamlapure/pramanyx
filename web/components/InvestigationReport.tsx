"use client";
import { Pending } from "@/components/ui/motion";

/**
 * Deep Analysis report, rendered as a clean Brief.
 *
 * Same vocabulary as the Insight answer (headline → prose → framed figures) —
 * Deep Analysis is just the LONG version. The old accordion-in-accordion, the
 * confidence/total/controllable pills, and the border-on-every-section are gone:
 * phases are flat narrative sections. Clean-output policy:
 * the investigation machinery (confidence factors, attribution, data gaps,
 * question intake, the SQL Sources list) is NOT rendered here at all — a reader
 * gets conclusions, the per-exhibit Source-data icon + the Evidence tab carry the
 * data/SQL, and only the decision (Recommended actions) stays visible in the flow.
 */

import React, { useState } from "react";
import { Chart } from "@/components/Chart";
import { ResultChartCard } from "@/components/charts/ResultChartCard";
import { chartCaption, repeatedCharts } from "@/components/charts/caption";
import { FigureSources, FindingFigures, isOneRecord } from "@/components/FindingFigures";
import { SqlResultTable } from "@/components/AugTable";
import { type ExhibitFinding as InvestigationFinding, type PhaseKeyNumber, sourceLabel, splitStatNote } from "@/components/answer/AnswerExhibit";
import { AnswerView, type AnswerViewProps } from "@/components/answer/AnswerView";
import { EMPTY_ENVELOPE, type AnswerEnvelope } from "@/lib/answerEnvelope";
import { AnswerProse } from "@/components/chat/AnswerProse";
import { AnswerLead } from "@/components/chat/AnswerLead";
/** Open the right-side Source-data drawer (data + SQL + Query Builder) for a finding. Typed inline
 *  (structurally = ChatMessage's SourcePanelData) to avoid a circular import with ChatMessage. */
type ShowSource = (data: { columns: string[]; rows: unknown[][]; sql: string | null; title: string }) => void;
import {
  Brief,
  BriefProse,
  BriefSection,
  BriefMeta,
  BriefFigure,
  renderEmphasis,
} from "@/components/brief/Brief";
import { SignificanceBadge } from "@/components/brief/StatBadge";
import { RuleOutsSection } from "@/components/brief/RuleOuts";
import { TrendStrip } from "@/components/brief/Sparkline";
import { Icon } from "@/components/ui/icon";
import { QuestionFrame } from "@/components/QuestionFrame";
import { Chip, Label, ROW } from "@/components/clarity/kit";
import type { OntologyFrame, RuleOuts } from "@/lib/types";
import { withUniqueKeys } from "@/lib/listKeys";
import { namesPeriod } from "@/lib/format";
import { Button } from "@/components/ui/button";

// ── Types ──────────────────────────────────────────────────────────────────────

interface InvestigationPhase {
  phase_id: string;
  phase_name: string;
  phase_icon: string;
  status: "complete" | "partial" | "running" | "skipped" | "error";
  summary: string;
  findings: InvestigationFinding[];
  skipped_reason?: string;
  // Machine caveats qualifying this phase (fan-out etc.) — structured, no longer fused
  // into `summary`; absent on older cached phases.
  caveats?: string[];
  // P5: the code-written significance verdict, structured — drawn as the badge, never read out
  // of the summary's prose. `significant` null = tested but not assessable (too short a baseline).
  verdict?: { sigma?: number | null; significant?: boolean | null; text?: string } | null;
  _hidden?: boolean;   // pruned by the relevance pass (nothing that moves the reader) — don't render
}

/** The phase's code-written verdict as the badge the findings already wear, or a muted line when
 *  code could not assess it. Older stored phases carry the verdict inside `summary` as
 *  "[stats.py: σ=…]"; `stripMarker` keeps that bracket out of the reader's prose too. */
const MARKER = /\s*\[stats\.py:[^\]]*\]/g;
const stripMarker = (s: string) => (s || "").replace(MARKER, "").trim();
function PhaseVerdict({ verdict }: { verdict?: InvestigationPhase["verdict"] }) {
  if (!verdict?.text) return null;
  if (typeof verdict.significant !== "boolean") {
    return <div className="aug-fs-xs text-zinc-500" data-testid="phase-verdict">{verdict.text}</div>;
  }
  return (
    <div className="self-end" data-testid="phase-verdict">
      <SignificanceBadge significant={verdict.significant} note={verdict.text} />
    </div>
  );
}

interface WaterfallEntry {
  cause: string;
  amount_label: string;
  pct_of_total: number;
  controllable: boolean;
  structural: boolean;
}

interface AnswerRecommendation {
  action: string;
  expected_impact: string;
  owner: string;
  timeline: string;
}

export interface AnswerReport {
  headline: string;
  executive_summary: string;
  metric: string;
  observation_period: string;
  comparison_basis: string;
  /** How the Agent turn worked the question — describe · check · diagnose (2026-10-15). */
  question_shape?: string | null;
  total_change_label: string;
  phases: InvestigationPhase[];
  attribution_waterfall: WaterfallEntry[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidence_justification: string;
  recommendations: AnswerRecommendation[];
  data_gaps: string[];
  // True when narrative synthesis failed and the report was assembled deterministically
  // from phase summaries — rendered as a banner at the TOP, because the admission used
  // to live only in confidence_justification at the bottom of a confident-looking page.
  degraded?: boolean;
  // Phase-2 structural trust artifacts (Orchestrator) — optional; older reports omit them.
  contradiction_report?: {
    severity: string; count: number;
    items: { kind: string; detail: string; phases: string[]; severity: string }[];
  } | null;
  orchestration_plan?: {
    question_kind: string; planned_ids: string[];
    steps: { phase_id: string; phase_name: string; icon: string; disposition: string; reason: string }[];
  } | null;
  plan_reconciliation?: { planned: string[]; actual: string[]; skipped: string[]; unplanned: string[] } | null;
  // T4-1 — plain-language receipt of how the metric was computed (formula + interpretation).
  metric_definition?: string | null;
  /** ON-10 — the frame the question was read through; absent when it reached nothing declared. */
  frame?: OntologyFrame | null;
  // A short closing "bottom line" that lands the answer at the end of the report (before
  // recommendations). Authored by synthesis; older reports omit it.
  closing_summary?: string | null;
  /** IP-1 — the Verifier's rule-outs for the move this report states; absent when it states none. */
  rule_outs?: RuleOuts | null;
  /** P1 (the analyst's `conclude`) — the answer's own structure: the results it cites, in order, each with its
   *  claim; the figures it rests on; what the data could not answer. A report that carries `exhibits` is
   *  drawn by the one answer view (`concludedAnswer`); every other report renders exactly as before. */
  exhibits?: { finding_id: string; claim: string }[] | null;
  figures?: { label: string; value: string; note?: string }[] | null;
  gaps?: string | null;
}

// ── Collapsible data table — quiet, only when a finding has no chart ───────────

function FindingTable({ columns, rows, label }: { columns: string[]; rows: (string | number | null)[][]; label: string }) {
  const [open, setOpen] = useState(false);
  if (!columns.length || !rows.length) return null;
  return (
    <div>
      <Button
        variant="ghost" size="xs"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <Icon name="chevd" size={16} /> : <Icon name="chevr" size={16} />}
        {label} · {rows.length} rows
      </Button>
      {open && (
        <div className="mt-1.5">
          <SqlResultTable columns={columns} rows={rows as unknown[][]} maxHeight={280} />
        </div>
      )}
    </div>
  );
}

// ── Single finding — evidence block (flows inside a phase section) ─────────────

/* R16 P1 — numbers live in the sentence, not in tiles (a
   claim reads "**long-haul load factor: 74.5%** (-2.7pt)", it doesn't stack
   stat cards under every chart). One quiet inline line per finding; the R15
   "Opportunity:" key number keeps its hedged context sentence — it IS the
   decision, so it earns the extra clause. Values arrive pre-formatted from the
   backend (no client-side number formatting). */
function KeyNumbersInline({ metrics }: { metrics: PhaseKeyNumber[] }) {
  const clean = (s?: string | null) => (s || "").replace(/\*/g, "");
  const opportunity = metrics.filter(m => clean(m.label).startsWith("Opportunity:"));
  const ordinary = metrics.filter(m => !clean(m.label).startsWith("Opportunity:"));
  if (!metrics.length) return null;
  return (
    <div className="flex flex-col gap-1">
      {ordinary.length > 0 && (
        <p className="aug-fs-ui leading-relaxed text-zinc-300">
          {ordinary.map((m, i) => (
            <span key={i}>
              {i > 0 && <span className="text-zinc-600"> · </span>}
              <strong className="font-semibold">{clean(m.label)}: {clean(m.value)}</strong>
              {m.delta && <span className="text-zinc-500"> ({clean(m.delta)})</span>}
            </span>
          ))}
        </p>
      )}
      {opportunity.map((m, i) => (
        <p key={`opp-${i}`} className="aug-fs-ui leading-relaxed text-zinc-300">
          <strong className="font-semibold">{clean(m.label)}: {clean(m.value)}</strong>
          {m.delta && <span className="text-zinc-500"> ({clean(m.delta)})</span>}
          {m.context && <span className="text-zinc-500">. {clean(m.context)}</span>}
        </p>
      ))}
    </div>
  );
}

/** A brief, human name for a finding's underlying data — labels the source-data icon
 *  (a descriptive "…for viz" footer) instead of an opaque "Source N". The finding
 *  title already says what the exhibit shows; trim it so the chip stays one short line. */
function EvidenceBlock({ finding, onShowSource, answer = "", repeat = false }: { finding: InvestigationFinding; onShowSource?: ShowSource; answer?: string;
  /** Another result's chart draws this one's series: only its source is shown (`repeatedCharts`). */
  repeat?: boolean }) {
  const { verdict, warning } = splitStatNote(finding.stat_note);
  const hasData = finding.columns.length > 0 && finding.rows.length > 0;
  const hasChart = !repeat && hasData && finding.chart_type !== "none" && finding.rows.length >= 2;
  // One record is its figures in a line, never a one-row table — and only those the answer does
  // not already state (`FindingFigures`).
  const oneRecord = hasData && !hasChart && isOneRecord(finding.columns, finding.rows as unknown[][]);
  // CA-4 "title = claim": the claim leads the figure; the query's descriptive
  // name stays on the source-data affordance below. Without a claim the figure is
  // captioned by what it draws, which can be fewer measures than the result holds.
  const headline = finding.claim?.trim()
    || chartCaption(finding.title, finding.columns, finding.rows as unknown[][], finding.chart_type);

  return (
    <div className="flex flex-col gap-2.5">
      {/* Chart — the framed figure */}
      {hasChart && (
        <BriefFigure caption={headline} subcaption={finding.subtitle?.trim() || undefined}>
          {/* Deep Analysis chart — renders clean; the hover pencil opens the side-panel
              viz editor (chart type / fields / transform / labels). */}
          <ResultChartCard columns={finding.columns} rows={finding.rows as unknown[][]} title={headline} chartType={finding.chart_type} chartConfig={finding.chart_config} columnUnits={finding.column_units} exhibit={finding.exhibit} defaultShowLabels />
        </BriefFigure>
      )}

      {/* Source data — opens the right-side data + SQL + Query Builder drawer (same as the quick answer).
          The significance verdict rides THIS row, not the body: it is verification machinery, and this
          row is the verification affordance the clean-output policy below means by "Details". The badge
          existed for this and was imported by nothing until now (found by the producer→surface ratchet,
          2026-09-18) — both ends of a feature existed while the feature did not, the same way
          `trust_caveat` did before it. */}
      {verdict && (
        <div className="self-end">
          <SignificanceBadge significant={finding.is_significant} note={verdict} />
        </div>
      )}
      {hasData && onShowSource && (
        <Button
          variant="ghost" size="xs"
          onClick={() => onShowSource({ columns: finding.columns, rows: finding.rows as unknown[][], sql: finding.sql || null, title: finding.title })}
          className="self-end"
          title={`Data + SQL behind “${finding.title}”`}
        >
          <Icon name="table" size={16} label="Table" />
          {/* Name the source by WHAT it shows (a "…for viz" footer), not an opaque "Source N". */}
          <span className="truncate">{sourceLabel(finding.title)}</span>
        </Button>
      )}

      {/* Trend strip — sparkline + period-over-period % (time-series findings only) */}
      {!repeat && <TrendStrip columns={finding.columns} rows={finding.rows} />}

      {/* Key numbers — one inline prose line, not a tile row (R16 P1) */}
      {finding.key_numbers.length > 0 && <KeyNumbersInline metrics={finding.key_numbers} />}

      {/* A completeness warning is NOT machinery — it changes what the number means, so it
          sits with the number, styled like the trust advisory it resembles. */}
      {warning && (
        <div className="aug-fs-xs text-zinc-400 leading-relaxed">⚠ {warning}</div>
      )}

      {/* Interpretation narrative */}
      {finding.interpretation && <BriefProse text={finding.interpretation} muted />}

      {/* Significance verdict — "Significant" / "Within noise" + raw stat note */}
      {/* Clean-output policy: the significance verdict + stat note are VERIFICATION
          machinery — they live in the Trust Receipt / Details, never in the body.
          A reader gets conclusions; "Within noise · Only 2 rows returned" is the
          machine talking to itself. */}

      {/* The Trust advisory box is gone from the body — it restated the finding's own
          interpretation (a suppressed finding is now dropped entirely; a repaired one says
          "recomputed against 2.8%" in its interpretation already). It added space, not
          value. The trust caveat still rides the finding for the Details / trust receipt. */}

      {/* Error */}
      {finding.error && (
        <p className="aug-text-xs text-red-400 font-mono">{finding.error}</p>
      )}

      {/* One record — its figures; otherwise the data table (collapsed) when there is no chart */}
      {oneRecord && <FindingFigures columns={finding.columns} row={finding.rows[0] as unknown[]} answer={answer} />}
      {hasData && !hasChart && !oneRecord && !repeat && (
        <FindingTable columns={finding.columns} rows={finding.rows} label="Data" />
      )}
      {/* The per-finding SQL + "Open in Query Builder" used to live here; for a swifter
          conversation it now sits in the one Details disclosure (the Queries block). */}
    </div>
  );
}

// ── Phase — a flat narrative section (no accordion, no chevron, no indent) ─────

// The deterministic synthesis fallback STITCHES the phase summaries into the executive
// summary — re-printing a phase's summary below it reads the same paragraph twice
// (three times counting the headline). A summary the head already carries is skipped.
const _norm = (s: string) => s.replace(/\*+/g, "").replace(/\s+/g, " ").trim();
const restated = (summary: string, execSummary?: string) =>
  !!summary && !!execSummary && _norm(execSummary).includes(_norm(summary));
/** The same sentence, whatever ends it: a headline drops its full stop, and a stored one-sentence answer
 *  (Q1, 2026-10-03) was headline and summary both, a full stop apart — printed twice. */
const sameSentence = (a?: string, b?: string) =>
  !!a && !!b && _norm(a).replace(/[.!?]+$/, "") === _norm(b).replace(/[.!?]+$/, "");

/** A finding the body draws at all. */
const drawn = (f: { interpretation: string; columns: string[]; error?: string }) =>
  !!(f.interpretation || f.columns.length > 0 || f.error);

function PhaseSection({ phase, onShowSource, execSummary, answer, repeats }: { phase: InvestigationPhase; onShowSource?: ShowSource; execSummary?: string; answer?: string; repeats?: Set<string> }) {
  if (phase.status === "skipped") return null;
  const findings = phase.findings.filter(drawn);
  const summary = stripMarker(phase.summary);
  if (!summary && !phase.verdict?.text && findings.length === 0) return null;
  const summaryRedundant = restated(summary, execSummary);

  return (
    // Clean-output policy: no phase-machinery header ("CROSS-SECTIONAL
    // SCAN", "TEMPORAL TREND — WHEN") — the reader gets a continuous, confident
    // narrative; which internal phase produced a finding is process, not insight.
    <BriefSection>
      {summary && !summaryRedundant && <BriefProse text={summary} />}
      <PhaseVerdict verdict={phase.verdict} />
      {withUniqueKeys(findings, f => f.finding_id).map(([key, f]) =>
        <EvidenceBlock key={key} finding={f} onShowSource={onShowSource} answer={answer}
                       repeat={repeats?.has(f.finding_id)} />)}
    </BriefSection>
  );
}

/** The results behind a simple answer, or null. Simple: every result the body would draw is one record —
 *  no chart, no table — and nothing rides it but its figures (no reading, no warning, no verdict, no
 *  error, no phase summary of its own). Q1 (2026-10-02): two figures, both in the sentence, then both
 *  again as "evidence". Anything more keeps the full layout. */
function simpleResults(phases: AnswerReport["phases"], execSummary?: string) {
  const results = [];
  for (const phase of phases) {
    if (phase.summary?.trim() && !restated(phase.summary, execSummary)) return null;
    for (const f of phase.findings.filter(drawn)) {
      const { verdict, warning } = splitStatNote(f.stat_note);
      const hasData = f.columns.length > 0 && f.rows.length > 0;
      const hasChart = hasData && f.chart_type !== "none" && f.rows.length >= 2;
      if (!hasData || hasChart || !isOneRecord(f.columns, f.rows as unknown[][])
          || f.interpretation || f.error || f.key_numbers?.length || verdict || warning) return null;
      results.push({ ...f, rows: f.rows as unknown[][] });
    }
  }
  return results.length ? results : null;
}

// ── Recommended actions — numbered, bold-lead, muted trailing meta ─────────────

function RecommendationsList({ recs }: { recs: AnswerRecommendation[] }) {
  if (!recs.length) return null;
  return (
    <ol className="flex flex-col gap-2.5">
      {recs.map((rec, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="shrink-0 aug-fs-ui text-zinc-500 mt-0.5">{i + 1}.</span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="aug-text-ui text-zinc-200 leading-relaxed">{renderEmphasis(rec.action)}</span>
            {(rec.expected_impact || rec.owner || rec.timeline) && (
              <span className="aug-fs-ui text-zinc-500 flex flex-wrap gap-x-3 gap-y-0.5">
                {rec.expected_impact && <span>Impact: {rec.expected_impact}</span>}
                {rec.owner && <span>Owner: {rec.owner}</span>}
                {rec.timeline && <span>Timeline: {rec.timeline}</span>}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Streaming phase card (live, while the investigation runs) ──────────────────

function StreamingPhaseCard({ phase }: { phase: InvestigationPhase }) {
  const isRunning = phase.status === "running";
  const isSkipped = phase.status === "skipped";
  // Include any finding that carries narrative too — so the interpretation streams WITH its chart
  // as the phase lands, instead of being withheld until the final report swap (which made the
  // text, numbers and synthesis all appear at once "to fill the gap").
  const findings = phase.findings.filter(f => f.columns.length > 0 || f.is_significant || f.interpretation);

  return (
    <div className="space-y-2 pl-3">
      <div className="flex items-center gap-2">
        <span className="text-base leading-none">{phase.phase_icon}</span>
        {isRunning && (
          <Pending label="Loading" className="aug-fs-xs text-zinc-400" />
        )}
        <span className="aug-label" style={isSkipped ? { color: "var(--t3)" } : undefined}>
          {phase.phase_name}
        </span>
        {isSkipped && <span className="aug-fs-xs text-zinc-500 italic">{phase.skipped_reason}</span>}
      </div>
      {stripMarker(phase.summary) && !isSkipped && (
        <div className="aug-fs-xs text-zinc-500 leading-relaxed">{renderEmphasis(stripMarker(phase.summary))}</div>
      )}
      {!isSkipped && <PhaseVerdict verdict={phase.verdict} />}
      {/* Phase caveats — the structured home of what used to be a ⚠-prefix fused into the
          summary prose (and once promoted into a report headline). Rendered as an advisory,
          visually distinct from findings. */}
      {(phase.caveats ?? []).map((c, i) => (
        <div key={`cav-${i}`} className="aug-fs-xs text-zinc-400 leading-relaxed pl-2">⚠ {c}</div>
      ))}
      {/* A running phase with nothing rendered yet — name the wait so the gap reads as progress,
          not a frozen chart (the per-phase interpret is a slow LLM round-trip). */}
      {isRunning && findings.length === 0 && (
        <div className="aug-fs-xs pl-2 flex items-center gap-1.5" style={{ color: "var(--t3)" }}><Pending />Reading the results…</div>
      )}
      {findings.map(f => {
        const hasChart = f.columns.length > 0 && f.rows.length >= 2 && f.chart_type !== "none";
        return (
          <div key={f.finding_id} className="space-y-1.5 pl-2">
            {hasChart && (
              <div className="rounded-md overflow-hidden p-2" style={{ background: "var(--bg-2)" }}>
                <Chart columns={f.columns} rows={f.rows as unknown[][]} title={f.title} chrome={false} columnUnits={f.column_units} exhibit={f.exhibit} showLabels />
              </div>
            )}
            {f.key_numbers?.length > 0 && <KeyNumbersInline metrics={f.key_numbers} />}
            {/* The trust advisory was declared in this interface since the trust battery
                shipped but rendered NOWHERE in web — only the CLI showed it. Both ends of
                a feature existed while the feature did not. */}
            {f.trust_caveat && (
              <div className="aug-fs-xs text-zinc-400 leading-relaxed">⚠ {f.trust_caveat}</div>
            )}
            {f.interpretation && <BriefProse text={f.interpretation} muted />}
          </div>
        );
      })}
    </div>
  );
}

// ── The concluded body (P1, the analyst's `conclude`) ────────────────────────────────
//
// The analyst named its own headline, answer and the results it cites. So the body is: the
// headline · the figures it rests on · the period and the guards' caveats as chips · the answer ·
// each cited result ONCE, numbered, captioned by its claim · the actions · the results it did not
// cite, named under Sources. Measured before this (2026-10-14, 88 stored answers): 58% of the
// results drawn carried no words and 46 bodies tabulated rows a result below drew again.

/** A concluded report (one that names its exhibits) as the one answer view's props: the report is the record, so the
 *  view reads its structure from it — the whole result behind each exhibit, the period, the next steps, the results it
 *  did not draw — as the envelope folds the same report for a door that is not this one (`answer/envelope.py`). */
export function concludedAnswer(report: AnswerReport, opts: { frame?: OntologyFrame | null; onShowSource?: ShowSource } = {}):
    Pick<AnswerViewProps, "answer" | "findings" | "resultsTotal" | "meta" | "evidence" | "how"> {
  const { frame, onShowSource } = opts;
  const phases = report.phases.filter(p => p.phase_id !== "intake" && p.status !== "skipped" && !p._hidden);
  const findings = phases.flatMap(p => p.findings);
  const byId = new Map(findings.map(f => [f.finding_id, f] as const));
  const cited = (report.exhibits ?? [])
    .map(e => ({ claim: e.claim, finding: byId.get(e.finding_id) }))
    .filter((x): x is { claim: string; finding: InvestigationFinding } => !!x.finding);
  const citedIds = new Set(cited.map(x => x.finding.finding_id));
  const results = findings.filter(f => (f.columns.length > 0 && f.rows.length > 0) || f.error);
  const uncited = results.filter(f => !citedIds.has(f.finding_id));
  // the caveats of the phases whose results it cites — a note on a result it did not draw is not the answer's
  const caveats = Array.from(new Set([
    ...phases.filter(p => p.findings.some(f => citedIds.has(f.finding_id))).flatMap(p => p.caveats ?? []),
  ].map(c => c.trim()).filter(Boolean)));
  const answerText = [report.headline, report.executive_summary].filter(Boolean).join("\n");
  const says = (s?: string | null) => !!s && answerText.toLowerCase().includes(s.toLowerCase());
  // A check (question_shape "check", 2026-10-15) verifies a property of the data: it has no period
  // and no next step — a verdict, its counts, what was not checked. The chrome of an investigation
  // (the period chip, Next) stays off it even on a report that carries those fields.
  const isCheck = report.question_shape === "check";
  const periodStr = isCheck || ((says(report.observation_period) || namesPeriod(answerText, report.observation_period ?? ""))
    && (!report.comparison_basis || says(report.comparison_basis)))
    ? ""
    : [report.observation_period, report.comparison_basis ? `vs ${report.comparison_basis}` : ""].filter(Boolean).join(" ");
  const gaps = (report.gaps ?? "").trim();
  const answer: AnswerEnvelope = {
    ...EMPTY_ENVELOPE,
    headline: report.headline?.trim() ?? "",
    body: report.executive_summary && !sameSentence(report.executive_summary, report.headline) ? report.executive_summary : "",
    figures: (report.figures ?? []).filter(f => f.value?.trim()).map(f => ({ label: f.label, value: f.value, ...(f.note ? { note: f.note } : {}) })),
    // each cited result once, numbered, captioned by its claim; its grid is the finding's own rows
    exhibits: cited.map(x => ({ claim: x.claim, grid: { columns: x.finding.columns, rows: x.finding.rows as unknown[][] },
      chart: { chart_type: x.finding.chart_type, chart_config: x.finding.chart_config ?? {} }, caveats: [] })),
    caveats,
    gaps: gaps && !restated(gaps, report.executive_summary) ? gaps : "",
    provenance: { ...EMPTY_ENVELOPE.provenance, confidence: report.confidence ?? "",
      path: report.question_shape ? { kind: report.question_shape } : {} },
  };
  const hasNext = !isCheck && !!report.recommendations?.length;
  return {
    answer,
    findings: cited.map(x => x.finding),
    resultsTotal: results.length,
    meta: periodStr ? <div style={ROW}><Chip>{periodStr}</Chip></div> : undefined,
    evidence: (report.rule_outs || hasNext || uncited.length > 0) ? (
      <>
        <RuleOutsSection ruleOuts={report.rule_outs} />
        {hasNext && (
          <BriefSection className="pt-4">
            <Label>Next</Label>
            <RecommendationsList recs={report.recommendations} />
          </BriefSection>
        )}
        {uncited.length > 0 && (
          <BriefSection className="pt-4">
            <Label right={`${results.length} results`}>Sources</Label>
            <div className="aug-fs-xs text-zinc-500" style={{ ...ROW, gap: 4 }} data-testid="uncited-results">
              <span>{uncited.length} not drawn:</span>
              {withUniqueKeys(uncited, f => f.finding_id).map(([key, f]) => onShowSource ? (
                <Button key={key} variant="ghost" size="xs" title={`Data + SQL behind “${f.title}”`}
                        onClick={() => onShowSource({ columns: f.columns, rows: f.rows as unknown[][], sql: f.sql || null, title: f.title })}>
                  {sourceLabel(f.title)} · {f.row_count || f.rows.length} rows
                </Button>
              ) : <span key={key}>{sourceLabel(f.title)} · {f.row_count || f.rows.length} rows</span>)}
            </div>
          </BriefSection>
        )}
      </>
    ) : undefined,
    how: (report.frame ?? frame) ? <QuestionFrame frame={report.frame ?? frame} /> : undefined,
  };
}

/** Whether a report names its own exhibits — the analyst's concluded answer (P1), drawn by the one answer view. */
export const isConcluded = (report: AnswerReport | null | undefined): report is AnswerReport =>
  !!report && Array.isArray(report.exhibits) && report.exhibits.length > 0;

// ── Main component ─────────────────────────────────────────────────────────────

export function InvestigationReportView({
  report,
  streamingPhases,
  streamingReport,
  onShowSource,
  frame,
}: {
  report?: AnswerReport;
  streamingPhases?: InvestigationPhase[];
  streamingReport?: string;
  onShowSource?: ShowSource;
  /** ON-10 — the frame the run announced before its report existed; the report's own frame wins once it lands. */
  frame?: OntologyFrame | null;
}) {
  // While streaming: progressive phase cards + the report prose as the narrator writes
  // it (R6), so the synthesis phase isn't silent. The terminal report replaces both.
  if (!report) {
    // Intake is setup, not thinking — users don't value the "QUESTION INTAKE" dump of the
    // run's raw framing (it streamed a wall of join-path reasoning). The final report already
    // pulls intake out of the analysis phases; mirror that while streaming.
    const phases = (streamingPhases ?? []).filter(p => p.phase_id !== "intake" && !p._hidden);
    if (!phases.length && !streamingReport && !frame?.defines) return null;
    return (
      <div className="flex flex-col gap-4 pt-1">
        <QuestionFrame frame={frame} />
        {streamingReport && <BriefProse text={streamingReport} />}
        {/* `phase_id` names the phase's KIND — a run can hold two of one kind. */}
        {withUniqueKeys(phases, p => p.phase_id).map(([key, phase]) => <StreamingPhaseCard key={key} phase={phase} />)}
      </div>
    );
  }

  // P1 — an answer that named its own exhibits is drawn as it said; every other report as before.
  if (report.exhibits && report.exhibits.length > 0) {
    return <AnswerView layout="full" {...concludedAnswer(report, { frame, onShowSource })} onShowSource={onShowSource} />;
  }

  const analysisPhases = report.phases.filter(p => p.phase_id !== "intake" && p.status !== "skipped" && !p._hidden);

  // Did any SQL actually execute? The degraded banner below asserted "The queries ran"
  // unconditionally. That holds for the case it was written for — synthesis dying AFTER the
  // phases produced results — and is false for the one a user hits first: every phase failing
  // at PLANNING, so no SQL was ever written. Told the queries ran when nothing ran, a reader
  // goes looking for a fault in the warehouse connector. Counted over every phase, not just
  // `analysisPhases`, because a query that ran inside a phase later hidden or marked skipped
  // still ran.
  const executedQueries = report.phases.reduce(
    (n, p) => n + (p.findings ?? []).filter(f => (f.sql ?? "").trim() && !f.error).length, 0);

  // What the answer says in words — a figure or a period it states is not printed again below it.
  const answer = [report.headline, report.executive_summary, report.closing_summary].filter(Boolean).join("\n");
  const says = (s?: string) => !!s && answer.toLowerCase().includes(s.toLowerCase());
  const simple = simpleResults(analysisPhases, report.executive_summary);
  // A chart another result's chart already draws is not drawn again; a result that carries its own claim keeps its figure.
  const repeats = repeatedCharts(analysisPhases.flatMap((p) => p.findings.filter((f) => drawn(f) && !f.claim?.trim())
    .map((f) => ({ id: f.finding_id, columns: f.columns, rows: f.rows as unknown[][], chartType: f.chart_type }))));

  const periodStr = report.question_shape === "check"
    || ((says(report.observation_period) || namesPeriod(answer, report.observation_period ?? ""))
    && (!report.comparison_basis || says(report.comparison_basis)))
    ? ""
    : [
      report.observation_period,
      report.comparison_basis ? `vs ${report.comparison_basis}` : "",
    ].filter(Boolean).join(" ");

  return (
    <Brief>
      {/* Degraded-report banner FIRST: when synthesis failed, the reader learns it where
          they start reading — not from confidence_justification on the last page. */}
      {report.degraded && (
        <div className="rounded-md px-3 py-2 aug-fs-xs text-zinc-300"
             style={{ background: "color-mix(in srgb, var(--amb3) 5%, var(--bg-0))" }}>
          ⚠ Narrative synthesis was unavailable — this report is assembled directly from the
          phase findings below.{" "}
          {executedQueries > 0 ? (
            <>The queries ran ({executedQueries} executed); the framing is provisional.</>
          ) : (
            <><strong>No query ran</strong> — every phase failed or was skipped before any SQL
            was executed, so there are no results behind this summary.</>
          )}
        </div>
      )}
      {report.headline?.trim() && <AnswerLead text={report.headline} />}
      {/* Skip a summary that only restates the headline (the fallback path can emit both
          from the same sentence) — one text, rendered once. Rendered as markdown: a question
          that asks to see the data is answered in the analyst's own words (item 3), whose
          table and list must read as a table and a list, not as pipes and asterisks. */}
      {report.executive_summary && !sameSentence(report.executive_summary, report.headline)
        && <AnswerProse text={report.executive_summary} />}

      <BriefMeta
        items={[
          report.total_change_label
            ? <span key="tc" className="tabular-nums font-medium">{report.total_change_label}</span>
            : null,
          periodStr || null,
          // Clean-output policy: the confidence verdict + justification are gone from the
          // report body entirely (the Details disclosure they lived in is removed) — the
          // body states findings, not a hedge banner across the top of every answer.
        ]}
      />

      <QuestionFrame frame={report.frame ?? frame} />

      {/* A simple answer's results are its figures, already in the sentence: one line of where
          each came from. Otherwise each phase, its exhibits and their sources. `phase_id` names
          the phase's KIND — a report can hold two `decomposition` phases. */}
      {simple ? (
        <BriefSection>
          <FigureSources results={simple} answer={answer} onShowSource={onShowSource} />
        </BriefSection>
      ) : withUniqueKeys(analysisPhases, p => p.phase_id).map(([key, phase]) => (
        <PhaseSection key={key} phase={phase} onShowSource={onShowSource} execSummary={report.executive_summary} answer={answer}
                      repeats={repeats} />
      ))}

      {/* Bottom line — a short closing summary that lands the answer at the END of the
          report, before the actions (the exec summary opens it; this closes it). Backend-
          authored (`closing_summary`); older reports without the field simply omit it. */}
      {report.closing_summary && report.closing_summary.trim() && (
        <BriefSection label="Bottom line" className="pt-4">
          <BriefProse text={report.closing_summary} />
        </BriefSection>
      )}

      {/* Rule out first (IP-1) — before the actions, the known ways this move can be the data
          rather than the business. Backend-derived, never model-written; absent when the report
          states no move or its metric names no known check. */}
      <RuleOutsSection ruleOuts={report.rule_outs} />

      {/* Clean-output policy: the Methodology & details disclosure (confidence factors,
          attribution, data gaps, question intake, the SQL Sources list) is gone — a
          reader gets conclusions, and the per-exhibit Source-data icon + the Evidence tab
          carry the data/SQL one click away. Only the decision — Recommended actions —
          stays in the flow, visible (uncollapsed), not behind a disclosure. */}
      {report.recommendations && report.recommendations.length > 0 && (
        <BriefSection label="Recommended actions" className="pt-4">
          <RecommendationsList recs={report.recommendations} />
        </BriefSection>
      )}
    </Brief>
  );
}
