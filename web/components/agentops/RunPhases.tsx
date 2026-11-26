"use client";

/**
 * CR5 → B1 → the Overview — one deep run's phases, as its report recorded them (`GET /investigations/{id}/graph`). The
 * fixed topology, the checkpoint and the resumable gate it drew belonged to the graph engine, retired 2026-11-27: one
 * deep engine answers now, keeps no checkpoint and never pauses at a gate, so a run is described by what it recorded.
 *
 * The list of deep runs this used to carry beside the detail is the Overview's "Deep runs" card now
 * (`DeepRuns.tsx`), titled by each run's question; a row there opens this, with the run's trace beside it.
 * It was Agent Ops ▸ Activity ▸ Phases until that tab folded into the Overview (2026-10-13), and before that the
 * phase half of the retired Runs layer — the half with no second home.
 */
import { useCallback, useEffect, useState } from "react";

import { StatusChip } from "@/components/brief/StatusChip";
import { Loading, ReadFailed } from "@/components/ui/states";
import { getInvestigationGraph, type InvestigationGraph } from "@/lib/api";
import { withUniqueKeys } from "@/lib/listKeys";

const PHASE_HUE: Record<string, "positive" | "negative" | "caution" | "muted"> = {
  complete: "positive", partial: "caution", skipped: "muted", error: "negative",
};

/** One deep run's phases, as its report recorded them. */
export function RunPhases({ runId }: { runId: string }) {
  const [graph, setGraph] = useState<InvestigationGraph | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A failed read says so with a Retry; it used to fall back to "Select a deep run", which read as nothing to show.
  const load = useCallback(() => {
    setError(null);
    getInvestigationGraph(runId)
      .then(g => { setGraph(g); setMissing(g === null); })
      .catch(e => { setGraph(null); setError(String(e?.message || e)); });
  }, [runId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ReadFailed what="this run's phases" error={error} onRetry={load} />;
  if (missing) return <div className="aug-fs-sm" style={{ color: "var(--t3)" }}>No phase record for this run.</div>;
  if (!graph) return <Loading what="its phases" />;

  return (
    <div>
      <div className="aug-fs-xs" style={{ color: "var(--t2)", marginBottom: 12 }}>
        status {graph.status} · {graph.phases.length} {graph.phases.length === 1 ? "phase" : "phases"} recorded
      </div>

      {graph.phases.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* `phase_id` names the phase's KIND — a run can hold two of one kind. */}
          {withUniqueKeys(graph.phases, p => p.phase_id).map(([key, p]) => (
            <div key={key} className="aug-fs-chrome" style={{ display: "flex", alignItems: "center",
              gap: 8 }}>
              <StatusChip hue={PHASE_HUE[p.status] ?? "muted"} strength="soft">
                {p.status}
              </StatusChip>
              <span style={{ fontWeight: 500 }}>{p.phase_name}</span>
              <span className="aug-fs-sm" style={{ color: "var(--t3)", flex: 1, minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.summary || p.skipped_reason || ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="aug-fs-sm" style={{ color: "var(--t3)" }}>No phases recorded for this run.</div>
      )}
    </div>
  );
}
