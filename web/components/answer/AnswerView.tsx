"use client";
/**
 * The one answer view (the plan of record, 2026-11-27): every web surface draws an answer through this, from the one
 * answer object (`lib/answerEnvelope.ts`), in one fixed order —
 *
 *   the headline (18) → the body → the figures → the exhibits, or the one grid / chart → the caveats and what it could
 *   not see → how it was answered → the follow-ups → the answer's foot.
 *
 * A chat and a report are LAYOUTS of it, not two views: `compact` (a chat column, a dashboard piece) sets the figures as
 * one quiet line; `full` (a report, a run read back) sets them as a row of figures. Nothing else differs by layout.
 *
 * What the envelope does not carry, the caller hands in by its place in that order, and the view draws it there: a
 * caution under the headline (`alert`), a period beside the figures (`meta`), a report's own body where the envelope
 * maps none of it (`drawn` — an exploration, a dossier, an overview, the phase script), what a report adds after its
 * exhibits (`evidence` — rule-outs, next steps, the results it did not draw), what is known of how it was answered
 * (`how`), what the answer can become (`onward`, inside the folded follow-ups) and the foot. Every organ it draws is one
 * the answers already used: AnswerLead / AnswerProse, ResultFigure, FindingFigures, the exhibit, the clarity kit.
 */
import { type ReactNode, useState } from "react";

import { Exhibit, caveatChip, type ExhibitFinding, type ShowSource } from "@/components/answer/AnswerExhibit";
import { FigureSkeleton, HeadlineSkeleton, ResultFigure } from "@/components/answer/ResultFigure";
import { Brief, BriefBullets, BriefHeadline, BriefProse, BriefSection } from "@/components/brief/Brief";
import { AnswerLead } from "@/components/chat/AnswerLead";
import { AnswerProse, readsAsProse } from "@/components/chat/AnswerProse";
import { Chip, Figure, Figures, Label, ROW, Tally } from "@/components/clarity/kit";
import { FindingFigures, isOneRecord } from "@/components/FindingFigures";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { type AnswerEnvelope, pathWords, unsaidCaveats } from "@/lib/answerEnvelope";
import { formatCount } from "@/lib/format";
import { withUniqueKeys } from "@/lib/listKeys";
import { safePartial } from "@/lib/useReveal";

export type AnswerLayout = "compact" | "full";

export interface AnswerViewProps {
  /** The one answer object. */
  answer: AnswerEnvelope;
  layout?: AnswerLayout;
  /** What is streaming before the envelope comes: the headline and body as written so far, and whether the answer is
   *  still on its way (the scaffold shows its shape while it is). */
  live?: { headline?: string | null; body?: string | null; pending?: boolean };
  /** Type the headline in as it lands (a live turn only). */
  animate?: boolean;
  /** The whole result behind each exhibit, when the web holds it (the analyst's finding), in the exhibits' order. */
  findings?: (ExhibitFinding | undefined)[];
  /** How many results the answer had, of which its exhibits are the ones it drew. */
  resultsTotal?: number;
  /** What stands out in the rows, as the narrative said it. */
  standsOut?: string[];
  /** Whether the one grid is drawn (a chat beside one object draws none). */
  showGrid?: boolean;
  /** Words after "Computed from the executed query · N rows" on the grid. */
  gridNote?: string[];
  /** Under the headline: a caution, what wrote it. */
  alert?: ReactNode;
  /** Under the body: what wrote it, where that needs saying. */
  bodyNote?: ReactNode;
  /** Beside the figures: the period the answer read. */
  meta?: ReactNode;
  /** A report's own body, where the envelope maps none of it: drawn in the place of the body, figures and exhibits. */
  drawn?: ReactNode;
  /** After the exhibits: what a report adds — rule-outs, next steps, the results it did not draw, why. */
  evidence?: ReactNode;
  /** Under "How it was answered": the sources it stood on, the frame it read the question through, where it came from. */
  how?: ReactNode;
  /** What the answer can become, inside the folded follow-ups. */
  onward?: ReactNode;
  /** The answer's foot: thumbs, copy, its PDF, its source. */
  foot?: ReactNode;
  connectionId?: string;
  onShowSource?: ShowSource;
  onFollowUp?: (question: string) => void;
  testId?: string;
}

/** The headline, its cautions and the rest of it (`AnswerLead`), or what of it has streamed, or its scaffold. */
function Lead({ answer, live, animate }: Pick<AnswerViewProps, "answer" | "live" | "animate">) {
  if (answer.headline) return <AnswerLead text={answer.headline} animate={animate} />;
  const streaming = live?.headline;
  if (streaming != null && streaming !== "") {
    return readsAsProse(streaming)
      ? <AnswerProse className="aug-stream-in" text={safePartial(streaming)} caret />
      : <BriefHeadline animate={false} className="aug-stream-in">{safePartial(streaming)}</BriefHeadline>;
  }
  return live?.pending ? <HeadlineSkeleton /> : null;
}

/** The body: the words written for the answer, or what of them has streamed. */
function Body({ text, streaming }: { text: string; streaming: boolean }) {
  if (!text) return null;
  const shown = streaming ? safePartial(text) : text;
  return readsAsProse(shown)
    ? <AnswerProse className={streaming ? "aug-stream-in" : ""} text={shown} caret={streaming} />
    : <BriefProse className={streaming ? "aug-stream-in" : ""} text={shown} caret={streaming} />;
}

/** The one grid an answer rests on: one record is its figures in a line (only those its words leave out), anything more
 *  its chart or table, said as computed from the executed query. */
function Grid({ answer, pending, said, connectionId, onShowSource, note }: {
  answer: AnswerEnvelope; pending: boolean; said: string; connectionId?: string; onShowSource?: ShowSource; note: string[];
}) {
  const grid = answer.grid;
  if (!grid || !grid.columns.length) return pending ? <FigureSkeleton /> : null;
  if (!pending && isOneRecord(grid.columns, grid.rows)) {
    return <FindingFigures columns={grid.columns} row={grid.rows[0] ?? []} answer={said} />;
  }
  const n = grid.rows.length;
  const sql = answer.provenance.sql[answer.provenance.sql.length - 1] ?? null;
  return (
    <div data-testid="answer-exhibit" className="flex flex-col gap-1.5" style={{ minWidth: 0 }}>
      <ResultFigure question={answer.question} columns={grid.columns} rows={grid.rows} sql={sql}
        chartType={answer.chart?.chart_type ?? null} chartConfig={answer.chart?.chart_config} shape={answer.provenance.path.kind}
        streaming={pending} connectionId={connectionId} onShowSource={onShowSource} />
      {!pending && (
        <div className="aug-fs-xs" data-testid="answer-computed-label" style={{ ...ROW, gap: 6, color: "var(--t3)" }}>
          <span style={{ background: "var(--gray-a3)", borderRadius: "var(--r-chip)", padding: "0 6px", color: "var(--t2)", lineHeight: "16px" }}>
            Computed
          </span>
          <span>
            {["from the executed query", `${formatCount(n)} ${n === 1 ? "row" : "rows"}`,
              answer.provenance.tables_used.length ? `reads ${answer.provenance.tables_used.join(", ")}` : "", ...note]
              .filter(Boolean).join(" · ")}
          </span>
        </div>
      )}
    </div>
  );
}

/** An exhibit the envelope carried without the whole result behind it, as the result the exhibit organ draws. */
function findingOf(ex: AnswerEnvelope["exhibits"][number], i: number): ExhibitFinding {
  return {
    finding_id: `exhibit-${i + 1}`, title: ex.claim || ex.grid.caption || "Result", sql: "",
    columns: ex.grid.columns, rows: ex.grid.rows as (string | number | null)[][], row_count: ex.grid.rows.length,
    interpretation: "", key_numbers: [], chart_type: ex.chart.chart_type, chart_config: ex.chart.chart_config,
    is_significant: false,
  };
}

/** Follow-ups, folded until opened (the user, 2026-11-20: "Lets follow-ups be default collapsed"): the questions to ask
 *  next, and under them what this answer can become. */
export function AnswerOnward({ followups, onFollowUp, children }: {
  followups: string[]; onFollowUp?: (q: string) => void; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="answer-onward" className="flex flex-col gap-2">
      <Button variant="ghost" size="xs" aria-expanded={open} onClick={() => setOpen(o => !o)} className="self-start gap-1">
        {followups.length ? `Follow-ups · ${followups.length}` : "Follow-ups"}
        <span className={`text-zinc-500 transition-transform duration-150 inline-block ${open ? "rotate-180" : ""}`}>
          <Icon name="chevd" size={16} />
        </span>
      </Button>
      {open && (
        <>
          {followups.length > 0 && (
            <div className="flex flex-col gap-1">
              {followups.map((q, i) => (
                <Button key={i} variant="ghost" size="xs" onClick={() => onFollowUp?.(q)}
                  className="h-auto items-start justify-start gap-1.5 p-0 text-left whitespace-normal aug-text-sm font-normal text-zinc-500 hover:text-zinc-300 hover:bg-transparent dark:hover:bg-transparent">
                  <span className="shrink-0 text-zinc-500 mt-0.5"><Icon name="next" size={16} /></span>
                  <span>{q}</span>
                </Button>
              ))}
            </div>
          )}
          {children && <div role="group" aria-label="What this answer can become" className="flex flex-col gap-2">{children}</div>}
        </>
      )}
    </div>
  );
}

export function AnswerView({
  answer, layout = "compact", live, animate = false, findings, resultsTotal, standsOut = [], showGrid = true, gridNote = [],
  alert, bodyNote, meta, drawn, evidence, how, onward, foot, connectionId, onShowSource, onFollowUp, testId,
}: AnswerViewProps) {
  const pending = !!live?.pending;
  const bodyStreaming = !answer.body && live?.body != null && live.body !== "";
  const body = answer.body || (bodyStreaming ? live!.body! : "");
  const said = [answer.headline, answer.body].filter(Boolean).join(" ");
  const caveats = pending ? [] : unsaidCaveats(answer);
  const gaps = answer.gaps.trim();
  const path = pathWords(answer.provenance.path);
  const why = answer.provenance.path.why ?? "";
  const figures = answer.figures.filter(f => f.value.trim()).slice(0, 4);
  const FigureRow = layout === "compact" ? Tally : Figures;

  return (
    <Brief>
      <div data-testid={testId ?? "answer-view"} data-layout={layout} className="flex flex-col gap-4" style={{ minWidth: 0 }}>
        {/* 1 · the headline, and any caution under it */}
        <Lead answer={answer} live={live} animate={animate} />
        {alert}

        {drawn ?? (
          <>
            {/* 2 · the body */}
            <Body text={body} streaming={bodyStreaming} />
            {bodyNote}
            {!pending && standsOut.length > 0 && (
              <BriefSection label="What stands out"><BriefBullets items={standsOut} /></BriefSection>
            )}

            {/* 3 · the figures it rests on, and the period it read */}
            {figures.length > 0 && (
              <FigureRow testId="answer-figures">
                {figures.map((f, i) => <Figure key={i} label={f.label} value={f.value} sub={f.note || undefined} />)}
              </FigureRow>
            )}
            {meta}

            {/* 4 · the exhibits — each result it cites, with its claim — or the one grid */}
            {answer.exhibits.length > 0 ? (
              <BriefSection>
                <Label right={resultsTotal != null ? `${answer.exhibits.length} of ${resultsTotal} results drawn` : undefined}>Exhibits</Label>
                {withUniqueKeys(answer.exhibits.map((ex, i) => ({ ex, i, f: findings?.[i] ?? findingOf(ex, i) })), x => x.f.finding_id)
                  .map(([key, x]) => (
                    <Exhibit key={key} n={x.i + 1} finding={x.f} claim={x.ex.claim} answer={said} onShowSource={onShowSource} />
                  ))}
              </BriefSection>
            ) : showGrid && (
              <Grid answer={answer} pending={pending} said={said} connectionId={connectionId} onShowSource={onShowSource} note={gridNote} />
            )}
          </>
        )}
        {evidence}

        {/* 5 · what qualifies it, and what it could not see */}
        {caveats.length > 0 && (
          <div data-testid="answer-caveats" style={ROW}>
            {caveats.map(c => <Chip key={c} tone="amber" title={c}>⚠ {caveatChip(c)}</Chip>)}
          </div>
        )}
        {!pending && gaps && (
          <div data-testid="answer-gaps">
            <Label tone="amber">What it couldn&apos;t see</Label>
            <BriefProse text={gaps} muted />
          </div>
        )}

        {/* 6 · how it was answered: the path, and what else is known of it */}
        {!pending && (path || how) && (
          <div data-testid="answer-how" className="flex flex-col gap-1.5">
            {path && (
              <div className="aug-fs-xs" style={{ ...ROW, gap: 6, color: "var(--t3)" }}>
                <span style={{ color: "var(--t2)" }}>How it was answered</span>
                <span data-testid="answer-path">{path}</span>
                {why && <span title={why} style={{ minWidth: 0 }}>— {why}</span>}
              </div>
            )}
            {how}
          </div>
        )}

        {/* 7 · the follow-ups, folded, with what the answer can become */}
        {!pending && (answer.follow_ups.length > 0 || onward) && (
          <AnswerOnward followups={answer.follow_ups} onFollowUp={onFollowUp}>{onward}</AnswerOnward>
        )}

        {/* 8 · the foot */}
        {!pending && foot}
      </div>
    </Brief>
  );
}
