"use client";

/**
 * A dashboard being drafted: its blank page on the left, filling in as each piece is written and run, and what is happening on the
 * right, line by line. The page turns into this the moment a person sends their request, so the wait is never a still screen.
 */
import { useEffect, useState, type ReactNode } from "react";

import { BRAND_GRADIENT, BrandSpark } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { miniatureCell } from "@/lib/dashboards/homeList";
import { isWorking, type DraftCardSeen, type DraftPiece, type DraftStep, type DraftWatch } from "@/lib/dashboards/draftProgress";

/** The page before the model has said where anything goes: only that a page is being made, so it holds no words. */
const BLANK_PAGE: DraftPiece[] = [
  { kind: "Blank", size: "small" }, { kind: "Blank", size: "small" }, { kind: "Blank", size: "small" }, { kind: "Blank", size: "small" },
  { kind: "Blank", w: 6, h: 8 }, { kind: "Blank", w: 6, h: 8 }, { kind: "Blank", size: "full" },
];

const SHOWS = { figure: "One figure", chart: "A chart" } as const;

function Tile({ piece, seen }: { piece: DraftPiece; seen?: DraftCardSeen }) {
  const { columns, rows } = miniatureCell(piece);
  const room = { gridColumn: `span ${columns}`, gridRow: `span ${rows}`, minWidth: 0, borderRadius: "var(--r2)" };
  if (!seen) return <div className="aug-skeleton" data-testid="dashboard-draft-tile" data-state="waiting" style={room} />;
  const ran = seen.state === "ok";
  return (
    <div className="aug-step-in" data-testid="dashboard-draft-tile" data-state={seen.state}
      style={{ ...room, display: "flex", flexDirection: "column", gap: 4, padding: 12, overflow: "hidden", background: "var(--bg-2)", border: "1px solid var(--card-edge)" }}>
      <span className="aug-fs-ui" style={{ color: "var(--t1)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{seen.title}</span>
      {ran
        ? <span className="aug-fs-xs" style={{ color: "var(--t3)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="check" size={12} /> {seen.shows ? SHOWS[seen.shows] : "Ran"}
          </span>
        : <span className="aug-fs-xs aug-shimmer-text">Running on the data</span>}
    </div>
  );
}

function StepLine({ step }: { step: DraftStep }) {
  return (
    <li className="aug-step-in" data-testid="dashboard-draft-step" data-state={step.state} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <span aria-hidden="true" style={{ flex: "none", width: 16, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--t3)" }}>
        {step.state === "doing" ? <BrandSpark size={14} /> : <Icon name={step.state === "done" ? "check" : "close"} size={14} />}
      </span>
      <span className={`aug-fs-ui${step.state === "doing" ? " aug-shimmer-text" : ""}`} style={{ flex: 1, minWidth: 0, ...(step.state === "doing" ? {} : { color: step.state === "failed" ? "var(--t1)" : "var(--t2)" }) }}>{step.words}</span>
      {step.note && <span className="aug-fs-sm" style={{ flex: "none", color: "var(--t3)", fontVariantNumeric: "tabular-nums" }}>{step.note}</span>}
    </li>
  );
}

const elapsedWords = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`);

/** `children` takes the page's place once the draft has come back: the draft to review, or why there is none. */
export function DraftBuilding({ asked, watch, onStop, children }: { asked: string; watch: DraftWatch; onStop: () => void; children?: ReactNode }) {
  const working = isWorking(watch);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!working) return;
    const began = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - began) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [working]);
  const ended = watch.steps[watch.steps.length - 1];
  const heading = working ? "Drafting your dashboard" : ended?.state === "failed" ? "No dashboard drafted" : "Your draft is ready";
  const pieces = watch.outline.length ? watch.outline : BLANK_PAGE;

  return (
    <div data-testid="dashboard-draft-building" style={{ flex: 1, minHeight: "100%", width: "100%", display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
      <section aria-label="The dashboard being drafted" style={{ flex: "999 1 520px", minWidth: 0, position: "relative", padding: 20,
        backgroundImage: "radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--b1) 75%, transparent) 1px, transparent 1.4px)", backgroundSize: "40px 40px" }}>
        {working && <div className="aug-shimmer" data-testid="dashboard-draft-working" aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, backgroundImage: BRAND_GRADIENT }} />}
        {children ?? (
          <div data-testid="dashboard-draft-page" style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gridAutoRows: 22, gap: 10 }}>
            {pieces.map((piece, i) => <Tile key={`${piece.card ?? piece.kind}-${i}`} piece={piece} seen={piece.card ? watch.cards[piece.card] : undefined} />)}
          </div>
        )}
      </section>

      <aside aria-label="What is happening" data-testid="dashboard-draft-panel" style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14, padding: 16, background: "var(--bg-1)", borderLeft: "1px solid var(--b1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="aug-fs-ui" style={{ flex: 1, minWidth: 0, color: "var(--t1)", fontWeight: 600 }}>{heading}</span>
          <span className="aug-fs-sm" data-testid="dashboard-draft-elapsed" style={{ color: "var(--t3)", fontVariantNumeric: "tabular-nums" }}>{elapsedWords(seconds)}</span>
        </div>
        <div className="aug-fs-ui" data-testid="dashboard-draft-asked" style={{ alignSelf: "flex-end", maxWidth: "92%", maxHeight: 160, overflow: "auto", padding: "8px 12px", borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--card-edge)", color: "var(--t1)", overflowWrap: "anywhere" }}>{asked}</div>
        <ol role="status" aria-live="polite" style={{ flex: 1, listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {watch.steps.map(step => <StepLine key={step.id} step={step} />)}
        </ol>
        {working && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="aug-fs-sm" style={{ flex: 1, minWidth: 0, color: "var(--t3)" }}>Nothing is kept until you keep it.</span>
            <Button size="sm" variant="secondary" data-testid="dashboard-draft-stop" onClick={onStop}><Icon name="stop" size={14} /> Stop</Button>
          </div>
        )}
      </aside>
    </div>
  );
}
