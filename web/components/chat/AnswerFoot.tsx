"use client";
/**
 * An answer's foot in the coworker's layout (the Ask page, the Ask panel, a Data Canvas): beside the thumbs, copy, the
 * answer as a PDF, and its source. The user, 2026-11-20, of the row under an answer: "except thumbs up/down and copy, I
 * dont [want] anything here. Keep the download option as PDF.. Let Source show both data + SQL.. Do these changes to
 * Platform as well.. same AI conversations experience everywhere". The coworker's answer card ends the same way.
 *
 * What left the row moved, nothing vanished: why the number and how it was answered are under the source's SQL
 * (`SourceFoot`); what the answer can become is in its folded follow-ups (`ChatMessage`'s HarnessOnward). Downloads other
 * than the PDF (PowerPoint, Excel, Word) went at the user's word; the rows still download as CSV from the source.
 */
import { useState } from "react";

import { AnswerEvidence } from "@/components/ChatMessage";
import { WhyThisNumber } from "@/components/WhyThisNumber";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { downloadAnswerPdf, storedReportOf } from "@/lib/api";
import type { ChatTurn } from "@/lib/chatTurn";

/** An answer's sources: the query it ran, when it read rows. */
export function sourcesOf(turn: ChatTurn): number {
  return turn.columns.length > 0 ? 1 : 0;
}

export function AnswerFoot({ turn, onSource }: { turn: ChatTurn; onSource?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [noPdf, setNoPdf] = useState(false);
  const text = [turn.headline, turn.narrative?.narrative?.trim()].filter(Boolean).join("\n\n");
  const stored = storedReportOf(turn);
  const sources = sourcesOf(turn);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };
  return (
    <div data-testid="answer-foot" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {text && (
          <Button variant="ghost" size="icon-xs" aria-label={copied ? "Copied" : "Copy the answer"} title={copied ? "Copied" : "Copy the answer"}
            onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={13} />
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" aria-label="Download as PDF" title="Download as PDF" data-testid="answer-pdf"
          aria-expanded={stored ? undefined : noPdf}
          onClick={() => (stored ? downloadAnswerPdf(stored) : setNoPdf(v => !v))}>
          <Icon name="download" size={13} />
        </Button>
        {sources > 0 && onSource && (
          <Button variant="ghost" size="xs" data-testid="answer-source" onClick={onSource}>
            {sources} {sources === 1 ? "source" : "sources"}
          </Button>
        )}
      </div>
      {noPdf && (
        <p className="aug-fs-sm" style={{ margin: 0, color: "var(--t3)" }}>
          This answer was not stored, so there is no PDF of it. Its rows download as CSV from its source.
        </p>
      )}
    </div>
  );
}

/** Under the source's SQL: why the number (the signed receipt) and how it was answered (the answer's evidence). */
export function SourceFoot({ turn, connectionId }: { turn: ChatTurn; connectionId?: string }) {
  const [how, setHow] = useState(false);
  return (
    <div data-testid="source-foot" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {turn.publicReceiptId && <WhyThisNumber receiptId={turn.publicReceiptId} />}
        <Button variant="ghost" size="xs" aria-expanded={how} onClick={() => setHow(v => !v)} data-testid="source-how"
          style={{ marginTop: turn.publicReceiptId ? 6 : 0 }}>
          How it was answered
        </Button>
      </div>
      {how && <div data-testid="answer-evidence"><AnswerEvidence turn={turn} connectionId={connectionId} bare /></div>}
    </div>
  );
}
