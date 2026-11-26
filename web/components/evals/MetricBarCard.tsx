"use client";
/**
 * The metric engine's bar (the metric-views plan's M5): answers are offered the governed metric read — the platform's
 * own figure, compiled from the metric's definition — only where, on this connection's golden metric questions, answers
 * with it matched or beat answers without it. Measured on a click (two model-backed answers a question), re-measured
 * nightly where allowed; a regression takes the read away.
 */
import { useCallback, useEffect, useState } from "react";

import { Card, Chip, Empty, MUTED } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Loading, ReadFailed } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { readMetricBar, runMetricBar, type MetricBar, type MetricBarArm } from "@/lib/contextEvals";
import { countNoun, formatDateTime } from "@/lib/format";

function Arm({ label, arm }: { label: string; arm: MetricBarArm }) {
  return (
    <span className="aug-fs-xs" style={{ color: arm.passed ? "var(--grn4)" : "var(--amb4)" }}>
      {`${label}: ${arm.passed ? "right" : "not right"}${arm.passed ? "" : ` — ${arm.why}`}${arm.used_the_tool ? " (used it)" : ""}`}
    </span>
  );
}

export function MetricBarCard({ connId }: { connId: string }) {
  const [got, setGot] = useState<{ conn: string; bar: MetricBar } | { conn: string; failed: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    readMetricBar(connId)
      .then((bar) => { if (live) setGot({ conn: connId, bar }); })
      .catch((e) => { if (live) setGot({ conn: connId, failed: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [connId, tick]);
  const here = got && got.conn === connId ? got : null;
  const running = !!here && "bar" in here && here.bar.running;
  useEffect(() => {                                   // a run answers in the background: read again until it ends
    if (!running) return undefined;
    const t = setTimeout(reload, 8000);
    return () => clearTimeout(t);
  }, [running, tick, reload]);
  if (here === null) return <Card label="The metric engine's bar" testId="metric-bar"><Loading what="the bar" /></Card>;
  if ("failed" in here) return <Card label="The metric engine's bar" testId="metric-bar"><ReadFailed what="the bar" error={here.failed} onRetry={reload} /></Card>;
  const { bar } = here;
  const v = bar.verdict;
  const n = bar.questions.length;
  const measure = async () => {
    setBusy(true);
    try { await runMetricBar(connId); toast.success("Measuring — each question is answered twice"); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Card label="The metric engine's bar" testId="metric-bar"
      right={<Chip tone={bar.offered ? "up" : "plain"}>{bar.offered ? "Answers are offered it" : "Not offered"}</Chip>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="aug-fs-sm" style={{ ...MUTED, margin: 0 }}>
          Answers read a governed metric grouped by a dimension — the platform&apos;s own figure — only where, on this
          connection&apos;s golden metric questions, answers with it matched or beat answers without it.
        </p>
        {n === 0 ? <Empty>This connection has no golden metric-by-dimension questions to measure it on.</Empty> : (
          <>
            <span className="aug-fs-sm" style={{ color: "var(--t1)" }} data-testid="metric-bar-verdict">
              {v ? `${v.with_tool} of ${v.cases} right with it · ${v.without_tool} of ${v.cases} without it — measured ${formatDateTime(v.at)}`
                : `Not measured yet: ${countNoun(n, "golden question")}.`}
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Button size="sm" variant="secondary" disabled={busy || running} onClick={() => void measure()} data-testid="metric-bar-run">
                {running ? "Measuring…" : v ? "Measure again" : "Measure it"}
              </Button>
              <span className="aug-fs-xs" style={MUTED}>{`${countNoun(2 * Math.min(n, 30), "model-backed answer")}: each question without it, then with it`}</span>
            </div>
            {v && (
              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {v.rows.map((r) => (
                  <li key={`bar:${r.id}`} data-testid="metric-bar-row" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span className="aug-fs-sm" style={{ color: "var(--t1)" }}>{r.question}</span>
                    <Arm label="Without it" arm={r.without} />
                    <Arm label="With it" arm={r.with} />
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
