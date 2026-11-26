"use client";

/**
 * Evals of the context layer — the Evals page's first view since 2026-11-26 (the Atlas plan's §7.9, decision 3; the
 * user: "Yes to all three"). Does what the organisation defined reach the answers? The cases are drawn from the layer
 * itself, no model writing them: each published Definition, approved metric, trusted query and corrected answer. A run
 * answers them through the real answer path — model calls, so only on a person's click here, or nightly where the
 * organisation allows model work nobody asked for — and each is graded from the answer's receipt: given the Definition,
 * its SQL using the metric's formula, matching the correction. A pass stands a Definition on "measured"; a failure waits
 * in the Inbox's knowledge review. Drawn as Discover draws (the user, 2026-11-26).
 */
import { useCallback, useEffect, useState } from "react";

import { Card, Chip, Empty, MUTED, Page } from "@/components/clarity/kit";
import { Said } from "@/components/discover/parts";
import { MetricBarCard } from "@/components/evals/MetricBarCard";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Loading, ReadFailed } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import {
  CONTEXT_SOURCE_WORDS, drawContextCases, readContextEvals, runContextEvals,
  type ContextCase, type ContextEvals, type ContextSource,
} from "@/lib/contextEvals";
import { formatCount, relTime } from "@/lib/format";

const SOURCE_ICON: Record<ContextSource, IconName> = { definition: "words", metric: "metric", trusted_query: "sql", corrected: "undo" };
/** How many cases one click answers: each is a real answer, with its cost. */
const RUN_LIMIT = 40;

export function ContextEvalsPanel({ connId }: { connId?: string }) {
  const [got, setGot] = useState<{ conn: string; evals: ContextEvals } | { conn: string; failed: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<"" | "draw" | "run">("");
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!connId) return undefined;
    let live = true;
    readContextEvals(connId)
      .then((evals) => { if (live) setGot({ conn: connId, evals }); })
      .catch((e) => { if (live) setGot({ conn: connId, failed: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [connId, tick]);
  const here = got && got.conn === connId ? got : null;
  const running = here && "evals" in here && here.evals.run?.status === "running";
  // a run answers in the background: read again until it ends
  useEffect(() => {
    if (!running) return undefined;
    const t = setTimeout(reload, 5000);
    return () => clearTimeout(t);
  }, [running, tick, reload]);

  if (!connId) return <Page testId="context-evals"><Empty>Choose a connection in the bar above: its layer is what is evaluated.</Empty></Page>;
  if (here === null) return <Page testId="context-evals"><Loading what="the context evals" /></Page>;
  if ("failed" in here) return <Page testId="context-evals"><ReadFailed what="the context evals" error={here.failed} onRetry={reload} /></Page>;
  const { evals } = here;
  const draw = async () => {
    setBusy("draw");
    try {
      const out = await drawContextCases(connId);
      toast.success(`${formatCount(out.cases)} cases drawn`, out.unread.length ? { description: `Not read: ${out.unread.join(", ")}` } : undefined);
      reload();
    } catch (e) { toast.error("The cases were not drawn", { description: e instanceof Error ? e.message : String(e) }); }
    setBusy("");
  };
  const run = async () => {
    setBusy("run");
    try { await runContextEvals(connId, RUN_LIMIT); reload(); }
    catch (e) { toast.error("The run did not start", { description: e instanceof Error ? e.message : String(e) }); }
    setBusy("");
  };
  const last = evals.run;
  const answered = evals.cases.filter((c) => c.result !== null);
  const reached = answered.filter((c) => c.result?.passed).length;
  const toRun = Math.min(evals.cases.length, RUN_LIMIT);
  return (
    <Page testId="context-evals">
      <Card label="The context layer" testId="context-evals-head" right={
        <span className="aug-fs-xs">drawn from what the organisation defined — no model writes a case</span>}>
        <p className="aug-fs-ui" style={{ margin: 0, color: "var(--t2)" }}>
          Does what was defined reach the answers? Each published Definition, approved metric, trusted query and corrected answer
          becomes a question; an answer passes when its receipt shows it was given the Definition, used the metric&apos;s formula,
          or matched the correction.
        </p>
        <div className="aug-fs-sm" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }} data-testid="context-evals-sources">
          {(Object.keys(CONTEXT_SOURCE_WORDS) as ContextSource[]).map((s) => (
            <Chip key={s}>{`${formatCount(evals.by_source[s] ?? 0)} · ${CONTEXT_SOURCE_WORDS[s]}`}</Chip>
          ))}
        </div>
        {last && (
          <p className="aug-fs-sm" style={{ margin: "0 0 10px", color: last.status === "failed" ? "var(--red4)" : "var(--t2)" }} data-testid="context-evals-last">
            {last.status === "running" ? `Answering — ${formatCount(answered.length)} of ${formatCount(last.summary?.cases ?? toRun)} so far`
              : last.status === "failed" ? `The last run failed: ${last.summary?.error ?? "no reason kept"}`
              : `Last run ${relTime(last.finished_at ?? last.started_at)} ago: ${formatCount(reached)} of ${formatCount(answered.length)} reached the answer`}
          </p>
        )}
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Button size="xs" variant="outline" disabled={!!busy || !!running} onClick={() => void draw()}>
            <Icon name="refresh" size={12} />{evals.suite ? "Draw the cases again" : "Draw the cases"}
          </Button>
          <Button size="xs" disabled={!!busy || !!running || evals.cases.length === 0} onClick={() => void run()}
            title="Each case is a real answer through the answer path — model calls, with their cost">
            <Icon name="run" size={12} />{`Answer ${formatCount(toRun)}`}
          </Button>
          <span className="aug-fs-xs" style={MUTED}>
            {evals.cases.length ? `Each is a real answer — ${formatCount(toRun)} model-backed answers.` : "Nothing is drawn yet."}
          </span>
        </span>
      </Card>
      <Card label="Cases" testId="context-evals-cases" right={<span className="aug-fs-xs">{formatCount(evals.cases.length)}</span>}>
        {evals.cases.length === 0
          ? <Empty>No case yet — draw them from the layer. A connection with nothing published, approved or trusted has none to draw.</Empty>
          : evals.cases.map((c) => <CaseRow key={c.id} c={c} />)}
      </Card>
      {answered.length > reached && (
        <Said lines={[`${formatCount(answered.length - reached)} not reached — each waits in the Inbox's knowledge review.`]} />
      )}
      {/* the metric-views plan's M5 — the bar the metric engine meets before answers are offered it */}
      <MetricBarCard connId={connId} />
    </Page>
  );
}

/** A case as Discover draws a row: its source's glyph, its question, what it tests, and whether it reached the answer. */
function CaseRow({ c }: { c: ContextCase }) {
  return (
    <div className="aug-discover-row" data-testid="context-evals-case">
      <span style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, padding: "6px 8px" }}>
        <span className="k"><Icon name={SOURCE_ICON[c.source]} size={15} /></span>
        <span className="main">
          <span className="n aug-fs-chrome">{c.question}</span>
          <span className="d aug-fs-sm">{[CONTEXT_SOURCE_WORDS[c.source], c.name !== c.question ? c.name : "", c.result?.why ?? ""].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="meta aug-fs-xs">
          {c.result === null ? <Chip>Not run</Chip>
            : c.result.passed ? <Chip tone="up">Reached</Chip> : <Chip tone="amber">Not reached</Chip>}
        </span>
      </span>
    </div>
  );
}
