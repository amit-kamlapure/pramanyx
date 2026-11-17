"use client";

/**
 * Review — what waits on a person for this connection's knowledge, in one list (Phase 3, 2026-11-17; Genie's Ontology
 * Manager is the reference). A ledger leads with its list (CLARITY): one line of what waits, an area to narrow it to,
 * then each row — what kind it is, what it says, how often it was asked or complained about, its area and who it is
 * for, and the button that opens the page where it is decided. Nothing is decided here: each kind keeps its own door.
 *
 * A source the platform could not read is said above the list; an empty list says nothing waits.
 */
import { useCallback, useEffect, useState } from "react";

import { Chip, Empty, MUTED, ROW, RULE } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";
import { Loading, ReadFailed } from "@/components/ui/states";
import { countNoun } from "@/lib/format";
import { busyWords, forWhom, readReview, SOURCE_WORDS, type Review, type ReviewItem, type ReviewKind } from "@/lib/review";

const KIND: Record<ReviewKind, { word: string; tone: "amber" | "plain" | "down" }> = {
  gap: { word: "Gap", tone: "amber" },
  candidate: { word: "To decide", tone: "plain" },
  conflict: { word: "Conflict", tone: "down" },
};

function Row({ item, areaName }: { item: ReviewItem; areaName: (id: string) => string }) {
  const busy = busyWords(item);
  const areas = item.area.split(",").filter(Boolean).map(areaName).join(" · ");
  return (
    <div data-testid={`review-row-${item.source}`} style={{ ...RULE, display: "flex", gap: 12, padding: "10px 0", alignItems: "flex-start" }}>
      <div style={{ width: 82, flexShrink: 0, paddingTop: 1 }}><Chip tone={KIND[item.kind].tone}>{KIND[item.kind].word}</Chip></div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span className="aug-fs-sm" style={{ color: "var(--t1)", wordBreak: "break-word" }}>{item.title}</span>
        {item.detail && <span className="aug-fs-xs" style={{ ...MUTED, wordBreak: "break-word" }}>{item.detail}</span>}
        <span className="aug-fs-xs" style={MUTED}>
          {[busy, areas, forWhom(item)].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div style={{ flexShrink: 0 }}>
        {item.resolve.href ? (
          <Button size="sm" variant="secondary" onClick={() => window.location.assign(item.resolve.href as string)}>
            {item.resolve.action}
          </Button>
        ) : (
          <span className="aug-fs-xs" style={{ ...MUTED, display: "inline-block", maxWidth: 220, textAlign: "right" }}>
            {item.resolve.action} — no page for it yet
          </span>
        )}
      </div>
    </div>
  );
}

export function ReviewQueue({ connId }: { connId: string }) {
  const [area, setArea] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [failed, setFailed] = useState("");

  const load = useCallback(() => {
    setFailed("");
    readReview(connId, area).then(setReview).catch((e) => setFailed(e instanceof Error ? e.message : String(e)));
  }, [connId, area]);
  useEffect(() => { load(); }, [load]);

  if (failed) return <ReadFailed what="the review list" error={failed} onRetry={load} />;
  if (!review) return <Loading what="what waits for review" />;

  const names = new Map(review.areas.map((a) => [a.id, a.name]));
  const areaName = (id: string) => names.get(id) ?? id;
  const k = review.by_kind;
  return (
    <div data-testid="review-queue" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...ROW, justifyContent: "space-between" }}>
        <span className="aug-fs-sm" data-testid="review-summary" style={{ color: "var(--t2)" }}>
          {review.total === 0 ? "Nothing waits" : `${review.total} wait${review.total === 1 ? "s" : ""}`}
          {review.total > 0 && `: ${countNoun(k.gap, "gap", "gaps")}, ${k.candidate} to decide, ${countNoun(k.conflict, "conflict", "conflicts")}`}
          {review.unplaced > 0 && ` · ${review.unplaced} in no area`}
        </span>
        {review.areas.length > 0 && (
          <SelectField value={area} aria-label="Area" style={{ cursor: "pointer", minWidth: 220 }}
            onChange={(e) => setArea(e.target.value)}>
            <option value="">Every area</option>
            {review.areas.map((a) => (
              <option key={a.id} value={a.id}>{a.name} — {a.waiting} waiting{a.owners.length ? "" : ", no owner"}</option>
            ))}
          </SelectField>
        )}
      </div>
      {review.unread.length > 0 && (
        <div className="aug-fs-xs" data-testid="review-unread" style={{ color: "var(--amb4)" }}>
          Not read: {review.unread.map((s) => SOURCE_WORDS[s] ?? s).join(", ")}. What they hold is not in this list.
        </div>
      )}
      {review.items.length === 0 ? (
        <Empty>{area ? `Nothing waits in ${areaName(area)}.` : "Nothing waits on anyone for this connection's knowledge."}</Empty>
      ) : (
        <div>
          {review.items.map((i) => <Row key={i.id} item={i} areaName={areaName} />)}
          {review.total > review.items.length && (
            <div className="aug-fs-xs" style={{ ...MUTED, padding: "8px 0" }}>
              The {review.items.length} busiest of {review.total} are listed.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
