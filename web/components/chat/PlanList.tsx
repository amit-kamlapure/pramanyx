"use client";
/**
 * The plan of a request with several parts (Stage 4 of "one coworker, two places", 2026-11-20): what the conversation
 * set out to do, in the person's words, each step ticked as it is done. Shown above the work, and kept when the work's
 * own steps fold away at the end, so the person reads what was asked for and what became of each part.
 */
import { Icon } from "@/components/ui/icon";
import type { PlanStep } from "@/lib/chatTurn";
import { withUniqueKeys } from "@/lib/listKeys";

export function PlanList({ steps }: { steps: PlanStep[] }) {
  if (!steps.length) return null;
  const done = steps.filter(s => s.done).length;
  return (
    <div data-testid="turn-plan" className="aug-fs-sm" style={{ margin: "4px 0 8px", padding: "8px 10px", borderRadius: "var(--r3)" }}>
      <div className="aug-fs-xs" style={{ color: "var(--t3)", marginBottom: 4 }}>The plan · {done} of {steps.length} done</div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        {withUniqueKeys(steps, s => s.text).map(([key, s]) => (
          <li key={key} data-testid="turn-plan-step" data-done={s.done || undefined}
            style={{ display: "flex", alignItems: "baseline", gap: 8, color: s.done ? "var(--t2)" : "var(--t1)" }}>
            <span style={{ flex: "none", width: 14, display: "inline-flex", justifyContent: "center", color: s.done ? "var(--blue4)" : "var(--t3)" }}>
              {s.done ? <Icon name="check" size={13} label="Done" /> : <span aria-hidden="true">○</span>}
            </span>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
