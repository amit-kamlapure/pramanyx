"use client";

/**
 * What an answer leads with, by the one rule its three places share (`lib/answerTitle.ts`; the user, 2026-11-23): the
 * answer in one sentence as its title, what the platform cautioned about it in the amber line under it — never run on
 * into the title — and the rest of what was written, read as prose. The coworker's card draws the same from the same rule.
 */

import React from "react";

import { BriefHeadline } from "@/components/brief/Brief";
import { renderEmphasis } from "@/components/brief/BriefProse";
import { AnswerProse } from "@/components/chat/AnswerProse";
import { Icon } from "@/components/ui/icon";
import { titleOf } from "@/lib/answerTitle";

/** A title's words, with text in backticks set as code rather than shown with its marks. */
function titleWords(title: string): React.ReactNode {
  if (!title.includes("`")) return title;
  return title.split(/(`[^`]+`)/g).filter(Boolean).map((part, i) =>
    part.length > 2 && part.startsWith("`") && part.endsWith("`")
      ? <code key={i} className="font-mono rounded px-1" style={{ background: "var(--gray-a3)" }}>{part.slice(1, -1)}</code>
      : <React.Fragment key={i}>{renderEmphasis(part)}</React.Fragment>);
}

/** The amber line under an answer's title: what is wrong with it, or may be. */
export function CautionLine({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="aug-text-sm text-amber-400/90 leading-relaxed flex items-start gap-1.5">
      <span className="shrink-0 mt-0.5"><Icon name="warning" size={16} label="Warning" /></span>
      <span>{children}</span>
    </p>
  );
}

export function AnswerLead({ text, animate = false }: {
  text: string;
  /** Type the title in as it lands (live turns only). */
  animate?: boolean;
}) {
  const { title, cautions, rest } = titleOf(text);
  return (
    <>
      {title && <BriefHeadline animate={animate && !title.includes("`")}>{titleWords(title)}</BriefHeadline>}
      {cautions.length > 0 && <CautionLine>{cautions.join(" ")}</CautionLine>}
      {rest && <AnswerProse text={rest} />}
    </>
  );
}
