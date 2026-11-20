"use client";

import { useState } from "react";
import type { ExplorationReport as ExplorationReportType, SubQuestion, SubQuestionAnswer } from "@/lib/types";
import { ResultChartCard } from "@/components/charts/ResultChartCard";
import { BriefDetails, BriefDetailBlock, renderEmphasis } from "@/components/brief/Brief";
import { sentenceCase, stripPlannerNotes } from "@/lib/format";
import { recordVerdict } from "@/lib/api";
import { soleSqlOfSteps } from "@/lib/verdictSql";
import { FixItForm } from "@/components/FixItForm";
import { QuestionFrame } from "@/components/QuestionFrame";
import type { OntologyFrame } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface Props {
  report: ExplorationReportType;
  subQuestions: SubQuestion[];
  subqAnswers: SubQuestionAnswer[];
  queryCount: number;
  connectionId?: string;
  investigationId?: string;
  /** ON-10 — the frame the question was read through, when it reached a declared definition. */
  frame?: OntologyFrame | null;
}

// ── Purpose chip (the one allowed accent) ─────────────────────────────────────
// Its hue's tint and text, no border (2026-11-20, borders are the exception).

const PURPOSE_STYLE: Record<string, { label: string; chip: string; icon: string }> = {
  landscape:    { label: "Landscape",    icon: "◎", chip: "bg-blue-500/10 text-blue-400"     },
  relationship: { label: "Relationship", icon: "⟺", chip: "bg-violet-500/10 text-violet-400" },
  threshold:    { label: "Threshold",    icon: "↯", chip: "bg-amber-500/10 text-amber-400"    },
  drill_down:   { label: "Drill-down",   icon: "⇣", chip: "bg-rose-500/10 text-rose-400"      },
  confounder:   { label: "Confounder",   icon: "⊕", chip: "bg-emerald-500/10 text-emerald-400"},
  synthesis:    { label: "Synthesis",    icon: "✦", chip: "bg-[var(--gray-a3)] text-zinc-400"   },
};

// One section label (12px semibold sentence case), used everywhere for a consistent rhythm.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="aug-label">{children}</p>;
}

// ── Sub-question step — chart + table shown upfront, only SQL collapsed ────────

function SubQuestionCard({
  answer,
  index,
  last,
}: {
  answer: SubQuestionAnswer;
  index: number;
  last: boolean;
}) {
  const [sqlOpen, setSqlOpen] = useState(false);
  const ps = PURPOSE_STYLE[answer.purpose] ?? PURPOSE_STYLE.landscape;
  const hasData = !answer.error && answer.columns.length > 0 && answer.rows.length > 0;

  return (
    <div className="relative">
      {/* Connector rail */}
      {!last && <div className="absolute left-[15px] top-9 bottom-0 w-px bg-zinc-800/80 pointer-events-none" />}

      <div className="flex gap-3 pb-6">
        {/* Step number */}
        <div className="shrink-0 z-10">
          <div className="h-8 w-8 rounded-[var(--r-pill)] bg-[var(--bg-3)] flex items-center justify-center aug-fs-sm font-mono text-zinc-400">
            {index + 1}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-2.5">
          {/* Question + purpose chip */}
          <div className="flex items-start gap-2 flex-wrap">
            <span className={`aug-fs-xs font-mono px-1.5 py-0.5 rounded shrink-0 ${ps.chip}`}>
              {ps.icon} {ps.label}
            </span>
            <p className="aug-fs-ui text-zinc-300 leading-snug flex-1 min-w-0">{answer.question}</p>
          </div>

          {/* Answer takeaway — planner directives ("→ Q5 should…") are the wave's
              internal to-do list, never reader prose. */}
          {answer.answer && stripPlannerNotes(answer.answer) && (
            <p className="aug-fs-ui text-zinc-100 leading-relaxed">{renderEmphasis(stripPlannerNotes(answer.answer))}</p>
          )}

          {/* Evidence — chart with grain-aware controls + chart⇄table toggle */}
          {hasData && (
            <ResultChartCard columns={answer.columns} rows={answer.rows} />
          )}

          {answer.error && (
            <pre className="aug-fs-sm text-red-400/90 rounded bg-red-500/5 p-2.5 overflow-x-auto whitespace-pre-wrap font-code">
              {answer.error}
            </pre>
          )}

          {/* Insight */}
          {answer.insight && answer.insight !== answer.answer && stripPlannerNotes(answer.insight) && (
            <p className="aug-fs-sm text-zinc-400 leading-relaxed pt-2">
              <span className="text-zinc-500 aug-fs-xs mr-1.5">Takeaway</span>
              {renderEmphasis(stripPlannerNotes(answer.insight))}
            </p>
          )}

          {/* Clean-output policy: the refinement is the planner's note to the NEXT
              question — process, not analysis. The chain's ordering already shows
              what each step led to; the machine's to-do list stays out of the body. */}

          {/* SQL — the only collapsed detail */}
          {(hasData || answer.error) && answer.sql && (
            <div>
              <Button variant="ghost" size="xs"
                onClick={() => setSqlOpen(o => !o)}
                className="aug-fs-xs transition flex items-center gap-1"
              >
                <span className="inline-block w-2">{sqlOpen ? "▼" : "▶"}</span> SQL
              </Button>
              {sqlOpen && (
                <pre className="mt-1.5 aug-fs-sm text-zinc-400 rounded p-2.5 overflow-x-auto whitespace-pre-wrap font-code leading-relaxed" style={{ background: "var(--bg-2)" }}>
                  {answer.sql}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const BAND_STYLE: Record<string, string> = {
  high:   "bg-emerald-500/10 text-emerald-300",
  medium: "bg-amber-500/10 text-amber-300",
  low:    "bg-rose-500/10 text-rose-300",
};

function ConfidenceChip({ band, earned }: { band: string; earned: number }) {
  return (
    <span className={`shrink-0 aug-fs-xs font-mono px-2 py-0.5 rounded ${BAND_STYLE[band] ?? BAND_STYLE.low}`}
      title="Computed from guard coverage × chain completeness × data trust — not asserted by the model.">
      {sentenceCase(band)} confidence · {Math.round(earned * 100)}%
    </span>
  );
}

const CHECK_MARK: Record<string, { sym: string; cls: string }> = {
  ran:     { sym: "✓", cls: "text-emerald-400" },
  not_run: { sym: "⊘", cls: "text-rose-400" },
  "n/a":   { sym: "–", cls: "text-zinc-600" },
};

function VerificationPanel({ v }: { v: NonNullable<ExplorationReportType["verification"]> }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-5 gap-y-1 aug-fs-xs text-zinc-400 font-mono">
        <span>earned confidence <span className="text-zinc-200">{Math.round(v.earned_confidence * 100)}%</span></span>
        <span>data trust <span className="text-zinc-200">{Math.round(v.data_trust * 100)}%</span></span>
        <span>guard coverage <span className="text-zinc-200">{Math.round(v.coverage * 100)}%</span></span>
      </div>
      <ul className="space-y-1">
        {v.checks.map((c) => {
          const m = CHECK_MARK[c.status] ?? CHECK_MARK["n/a"];
          return (
            <li key={c.name} className="flex items-start gap-2 leading-relaxed">
              <span className={`shrink-0 mt-0.5 w-3 text-center ${m.cls}`}>{m.sym}</span>
              <span>
                <span className={c.status === "not_run" ? "text-rose-300" : "text-zinc-300"}>{c.label}</span>
                {c.status === "not_run" && <span className="text-rose-400/80"> — did not run</span>}
                {c.detail && <span className="text-zinc-500"> · {c.detail}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {v.signals.length > 0 && (
        <ul className="space-y-1 pt-1">
          {v.signals.map((s, i) => (
            <li key={i} className="aug-fs-xs text-zinc-500 flex items-start gap-2">
              <span className="shrink-0 mt-0.5">·</span><span>{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingVerdict({ headline, connectionId, investigationId, sqlSource }: {
  headline: string; connectionId?: string; investigationId?: string;
  /** The statement that produced the judged answer, when ONE unambiguously did.
   *  Empty for a multi-step chain — see the call site for why that is deliberate. */
  sqlSource?: string;
}) {
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // S3 fix-it: a negative verdict asks WHAT was wrong — an accept stays one
  // click, but "Partly"/"Wrong" without the reason teaches the loop nothing.
  const [fixIt, setFixIt] = useState<"correct" | "reject" | null>(null);
  const send = async (verdict: "accept" | "correct" | "reject", note = "",
                      correctedSql = "") => {
    if (busy) return;
    setBusy(true);
    try {
      // MI-3: carry the STRUCTURAL payload, not just the label. Without these two fields
      // a verdict recorded here could never become a training pair — measured 2026-09-03,
      // every one of the store's `correct` rows had an empty `corrected_sql` because the
      // only surface that sent one was chat. A verdict without its SQL teaches the loop
      // that something was wrong but not what right would have looked like.
      await recordVerdict({ verdict, connectionId, investigationId, headline, note,
                            sqlSource, correctedSql });
      setDone(verdict);
      setFixIt(null);
    } catch {
      setDone(null);
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    return (
      <div className="pt-4 aug-fs-xs text-zinc-500">
        Thanks — recorded as <span className="text-zinc-300">{done}</span>. This calibrates future confidence.
      </div>
    );
  }
  // a soft fill at rest, the verdict's hue in the words and on hover — no outline (2026-11-20, borders are the exception)
  const btn = "aug-fs-xs px-2.5 py-1 rounded transition-colors disabled:opacity-50";
  return (
    <div className="pt-4 flex items-center gap-2 flex-wrap">
      <span className="aug-fs-xs text-zinc-500 mr-1">Was this finding right?</span>
      <Button variant="ghost" size="xs" disabled={busy} onClick={() => send("accept")}
        className={`${btn} text-emerald-300 hover:bg-emerald-500/10`}>Accept</Button>
      <Button variant="ghost" size="xs" disabled={busy} onClick={() => setFixIt("correct")}
        className={`${btn} text-amber-300 hover:bg-amber-500/10`}>Partly</Button>
      <Button variant="ghost" size="xs" disabled={busy} onClick={() => setFixIt("reject")}
        className={`${btn} text-rose-300 hover:bg-rose-500/10`}>Reject</Button>
      {fixIt && (
        <div className="w-full">
          <FixItForm busy={busy}
                     withSql={!!sqlSource}
                     onSubmit={(note, correctedSql) => send(fixIt, note, correctedSql)}
                     onCancel={() => setFixIt(null)} />
        </div>
      )}
    </div>
  );
}

export function ExplorationReportView({ report, subqAnswers, queryCount, connectionId, investigationId, frame }: Props) {
  const dqNotes = report.data_quality_notes ?? [];
  // The SQL a verdict is ABOUT, and only when that is unambiguous — the rule lives in
  // `lib/verdictSql` because it must be identical on every surface that records a verdict.
  const soleSql = soleSqlOfSteps(subqAnswers);
  const showNarrative = report.narrative && report.narrative.trim() !== (report.conclusion ?? "").trim();

  return (
    <div className="space-y-6 aug-fs-ui text-zinc-300">
      {/* Answer */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>Answer</SectionLabel>
          {report.verification && (
            <ConfidenceChip band={report.verification.confidence_band} earned={report.verification.earned_confidence} />
          )}
        </div>
        <p className="aug-fs-h2 font-medium text-zinc-100 leading-snug">{report.headline}</p>
      </div>

      <QuestionFrame frame={frame} />

      {/* Summary — the CONCLUSION only (emphasis rendered, never raw asterisks). The
          narrative — the step-by-step retelling of what the wave did — is process, and
          the chain below already shows each step with its evidence; it moves into
          Details ("How the exploration ran") instead of doubling the page. */}
      {report.conclusion && (
        <div className="pt-4 space-y-2">
          <SectionLabel>Summary</SectionLabel>
          <p className="leading-relaxed">{renderEmphasis(report.conclusion)}</p>
        </div>
      )}

      {/* Investigative chain */}
      {subqAnswers.length > 0 && (
        <div className="pt-4 space-y-3">
          <SectionLabel>Investigative chain · {subqAnswers.length} step{subqAnswers.length !== 1 ? "s" : ""}</SectionLabel>
          <div>
            {subqAnswers.map((a, i) => (
              <SubQuestionCard key={a.subq_id} answer={a} index={i} last={i === subqAnswers.length - 1} />
            ))}
          </div>
        </div>
      )}

      {/* Machinery — recommended actions, data quality, and verification fold into one
          quiet Details toggle so the explore answer reads as a conversation, not a report
          (Option A, consistent with the quick + deep answers). */}
      {(report.recommended_actions.length > 0 || dqNotes.length > 0 || report.verification || showNarrative) && (
        <BriefDetails summary="Details">
          {showNarrative && (
            <BriefDetailBlock label="How the exploration ran">
              <p className="leading-relaxed text-zinc-400">{renderEmphasis(stripPlannerNotes(report.narrative!))}</p>
            </BriefDetailBlock>
          )}
          {report.recommended_actions.length > 0 && (
            <BriefDetailBlock label="Recommended actions">
              <ol className="space-y-2">
                {report.recommended_actions.map((action, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="shrink-0 mt-0.5 w-5 h-5 rounded-[var(--r-pill)] bg-[var(--gray-a3)] text-zinc-400 aug-fs-xs font-mono flex items-center justify-center">
                      {i + 1}
                    </span>
                    <p className="leading-relaxed">{action}</p>
                  </li>
                ))}
              </ol>
            </BriefDetailBlock>
          )}

          {dqNotes.length > 0 && (
            <BriefDetailBlock label="Data quality">
              <ul className="space-y-1.5">
                {dqNotes.map((note, i) => (
                  <li key={i} className="leading-relaxed flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 text-zinc-500">—</span>
                    <span>
                      <code className="aug-fs-sm text-zinc-400">{note.column ? `${note.table}.${note.column}` : note.table}</code>
                      <span className="text-zinc-400"> {note.issue}</span>
                      {note.recommended_fix && <span className="text-zinc-500"> · Fix: {note.recommended_fix}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </BriefDetailBlock>
          )}

          {report.verification && (
            <BriefDetailBlock label="Verification">
              <VerificationPanel v={report.verification} />
            </BriefDetailBlock>
          )}
        </BriefDetails>
      )}

      {/* Human ground-truth capture (Bet 0, 0-V) — the non-circular calibration anchor */}
      {investigationId && (
        <FindingVerdict headline={report.headline} connectionId={connectionId}
                        investigationId={investigationId} sqlSource={soleSql} />
      )}

      <p className="aug-fs-xs text-zinc-500 pt-1">
        {queryCount} quer{queryCount === 1 ? "y" : "ies"} · {subqAnswers.length} step{subqAnswers.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
