"use client";

/** AI Factory ▸ Environments — a set of tasks, how the model is run on them, and how each answer is scored; the same
 *  environment teaches and measures, and the expected answers never leave the platform. The list on the left, the
 *  chosen environment's detail beside it (no pop-up). Company knowledge shows its rows, what it holds and what it
 *  leaves out; SQL shows how an answer will be scored and where its tasks come from. */
import { useEffect, useState } from "react";

import { Card, Chip, Empty, Figure, Figures, HBars, MUTED, NUM, ROW, RULE } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { buildTrainingSet, getTrainingRows, type FactoryEnvironment, type TrainingRow } from "@/lib/api";
import { formatCount, relTime } from "@/lib/format";

import type { FactoryData } from "./AIFactoryPanel";
import { kindWord, pct } from "./shared";

const FIT_TONE = (fit: string): "up" | "amber" | "plain" =>
  fit === "fit for reward training" ? "up" : fit.startsWith("waiting") ? "amber" : "plain";

export function EnvironmentsTab({ data, onChanged }: { data: FactoryData; onChanged: () => void }) {
  const envs = data.environments?.environments ?? [];
  const [picked, setPicked] = useState("knowledge");
  const env = envs.find(e => e.id === picked) ?? envs[0];
  const ready = envs.filter(e => e.status === "ready").length;
  const tasks = envs.reduce((a, e) => a + (e.status !== "waiting for data" ? (e.tasks ?? 0) + (e.held_out ?? 0) : 0), 0);
  const leftOut = data.plan ? data.plan.withheld.reduce((a, w) => a + w.count, 0) : null;
  if (!data.environments) return <Empty>The environments could not be read.</Empty>;
  const [lo, hi] = data.environments.reward_band;
  return (
    <>
      <div className="aug-fs-sm" style={MUTED}>
        An environment is a set of tasks, how the model is run on them, and how each answer is scored. The same environment
        teaches — by example or by reward — and measures; the expected answers never leave the platform.
      </div>
      <Figures testId="ai-factory-env-figures">
        <Figure label="Environments" value={formatCount(envs.length)} sub={`${ready} ready · ${envs.length - ready} not yet`} />
        <Figure label="Tasks ready" value={formatCount(tasks)} sub="questions with an answer to score against" />
        <Figure label="Scored without a model" value={`${envs.length} of ${envs.length}`} sub="execution, source match, answer key" />
        <Figure label="Left out" value={leftOut == null ? "—" : formatCount(leftOut)} sub="each with its reason" />
      </Figures>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
        <Card label="Environments" right="pass rate: base → best model" testId="ai-factory-envs">
          <div role="table" aria-label="Environments" style={{ overflowX: "auto" }}>
            <div role="row" className="aug-fs-xs" style={{ ...GRID, ...MUTED, paddingBottom: 4 }}>
              <span>Environment</span><span>Tasks</span><span>Scored by</span><span>Pass rate</span><span>Fit for reward training</span>
            </div>
            {envs.map(e => (
              <div key={e.id} role="row" tabIndex={0} data-testid={`env-${e.id}`} className="aug-fs-chrome"
                onClick={() => setPicked(e.id)} onKeyDown={k => { if (k.key === "Enter") setPicked(e.id); }}
                style={{ ...GRID, padding: "8px 0", cursor: "pointer", ...RULE,
                  background: e.id === env?.id ? "var(--bg-sel)" : undefined }}>
                <span>{e.name}</span>
                <span style={NUM}>{tasksWord(e)}</span>
                <span style={{ color: "var(--t2)" }}>{e.scored_by}</span>
                <span style={NUM}>{e.pass_best == null ? "not measured" : `${pct(e.pass_base)} → ${pct(e.pass_best)}`}</span>
                <span><Chip tone={FIT_TONE(e.fit)}>{e.fit}</Chip></span>
              </div>
            ))}
          </div>
          <div className="aug-fs-sm" style={{ ...MUTED, marginTop: 8 }}>
            Teaching by reward is offered only where the model passes {pct(lo)}–{pct(hi)} of an environment&apos;s tasks: below,
            it has nothing to build on; above, nothing to learn.
          </div>
        </Card>
        {env && <EnvironmentDetail env={env} data={data} onChanged={onChanged} />}
      </div>
      {env?.id === "knowledge" && data.view.training_set.train && <RowsBrowser key={data.view.training_set.train.version} />}
    </>
  );
}

const GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(140px,1.2fr) minmax(110px,1fr) minmax(150px,1.3fr) 110px minmax(160px,1.3fr)", gap: 12, minWidth: 720 };

function tasksWord(e: FactoryEnvironment): string {
  if (e.need) return `${formatCount(e.tasks ?? 0)} of ${formatCount(e.need)}`;
  if (e.tasks == null) return "—";
  return `${formatCount(e.tasks)}${e.held_out ? ` · ${formatCount(e.held_out)} held out` : ""}`;
}

function EnvironmentDetail({ env, data, onChanged }: { env: FactoryEnvironment; data: FactoryData; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  if (env.id === "sql") {
    const s = env.sources ?? {};
    return (
      <Card label="SQL against the warehouse · how an answer will be scored" testId="ai-factory-env-sql">
        {(env.rubric ?? []).map((r, i) => (
          <div key={r.check} className="aug-fs-chrome" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) 56px minmax(0,1.2fr)", gap: 12, padding: "6px 0", ...(i ? RULE : {}) }}>
            <span>{r.check}</span><span style={{ ...NUM, textAlign: "right" }}>{r.weight}</span><span style={{ color: "var(--t2)" }}>{r.means}</span>
          </div>
        ))}
        <div style={{ ...ROW, marginTop: 10 }}>
          <Chip>expected results stay on the platform</Chip><Chip>read-only</Chip><Chip>no model judges by default</Chip>
        </div>
        <div className="aug-label" style={{ margin: "16px 0 8px" }}>Where its tasks come from</div>
        <HBars testId="ai-factory-sql-sources" bars={[
          { key: "accepts", name: "👍 on an answer whose query ran", value: s.accepts ?? 0, shown: formatCount(s.accepts ?? 0), tip: "accepted answers" },
          { key: "trusted", name: "Trusted queries", value: s.trusted ?? 0, shown: formatCount(s.trusted ?? 0), tip: "queries a person verified" },
          { key: "golden", name: "Golden set (measures only)", value: env.held_out ?? 0, shown: formatCount(env.held_out ?? 0), tip: "held out, never trained on" },
        ]} />
        <div className="aug-fs-sm" style={{ ...MUTED, marginTop: 8 }}>
          It runs once there are checked pairs: every reference query is run again first, and an empty or slow result is set aside.
        </div>
      </Card>
    );
  }
  if (env.id === "knowledge") {
    const plan = data.plan;
    const node = data.view.training_set.train;
    const changed = plan && node && (plan.rows.train !== node.row_count || plan.rows.held_out !== (data.view.training_set.held_out?.row_count ?? 0));
    return (
      <Card label="Company knowledge" right={node ? <span style={NUM}>version {node.version} · built {relTime(node.created_at)}</span> : undefined} testId="ai-factory-env-knowledge">
        <div className="aug-fs-sm" style={{ ...MUTED, marginBottom: 8 }}>
          Each settled source becomes a few phrasings of one question, answered from its own words — no model writes a row.
          One phrasing of each is held out and never trained on.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "4px 28px" }}>
          <div>
            <div className="aug-label" style={{ marginBottom: 4 }}>Holds{plan ? ` · ${formatCount(plan.rows.train)} questions` : ""}</div>
            {plan ? Object.entries(plan.sources).sort((a, b) => b[1] - a[1]).map(([k, n], i) => (
              <div key={k} className="aug-fs-chrome" style={{ ...ROW, justifyContent: "space-between", padding: "4px 0", ...(i ? RULE : {}) }}>
                <span>{kindWord(k)}</span><span style={{ ...NUM, color: "var(--t2)" }}>{formatCount(n)}</span>
              </div>
            )) : <Empty>Reading the sources…</Empty>}
          </div>
          <div>
            <div className="aug-label" style={{ marginBottom: 4 }}>Leaves out</div>
            {plan?.withheld.length ? plan.withheld.map((w, i) => (
              <div key={w.reason} className="aug-fs-chrome" style={{ ...ROW, justifyContent: "space-between", padding: "4px 0", ...(i ? RULE : {}) }}>
                <span>{w.reason}</span><span style={{ ...NUM, color: "var(--t2)" }}>{formatCount(w.count)}</span>
              </div>
            )) : <Empty>{plan ? "Nothing — every source is in." : "Reading the sources…"}</Empty>}
          </div>
        </div>
        <div style={{ ...ROW, marginTop: 12 }}>
          <Button size="sm" disabled={busy || !data.view.allowed} variant={node && !changed ? "secondary" : "default"}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await buildTrainingSet();
                toast.info(r.train.version === node?.version ? "Nothing changed since the last build" : `Version ${r.train.version} built`);
                onChanged();
              } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
              finally { setBusy(false); }
            }}>{busy ? "Building…" : node ? "Build again" : "Build the training set"}</Button>
          {changed && <Chip tone="amber">The sources changed since version {node!.version}</Chip>}
        </div>
      </Card>
    );
  }
  return (
    <Card label={env.name} testId={`ai-factory-env-${env.id}`}>
      <div className="aug-fs-chrome" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span>{tasksWord(env)} tasks · scored by {env.scored_by}</span>
        {env.why && <span style={{ color: "var(--amb4)" }}>{env.why}</span>}
        {env.status === "waiting for data" && <span style={MUTED}>It runs once there is data to score against.</span>}
      </div>
    </Card>
  );
}

function RowsBrowser() {
  const [half, setHalf] = useState<"train" | "held_out">("train");
  const [kind, setKind] = useState("");
  const [rows, setRows] = useState<{ total: number; kinds?: Record<string, number>; rows: TrainingRow[] } | null>(null);
  useEffect(() => {
    let live = true;
    getTrainingRows(half, kind, 100).then(r => { if (live) setRows(r); }).catch(() => { if (live) setRows({ total: 0, rows: [] }); });
    return () => { live = false; };
  }, [half, kind]);
  const kinds = Object.entries(rows?.kinds ?? {}).sort((a, b) => b[1] - a[1]);
  const all = kinds.reduce((a, [, n]) => a + n, 0);
  return (
    <Card label="Company knowledge · its tasks" right={rows ? `${formatCount(Math.min(100, rows.total))} of ${formatCount(rows.total)}` : undefined} testId="ai-factory-rows">
      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: 20 }}>
        <div>
          <Segmented label="Which half" value={half} onChange={v => { setHalf(v); setKind(""); }}
            options={[{ value: "train", label: "Trained on" }, { value: "held_out", label: "Held out" }]} />
          <div style={{ marginTop: 10 }} role="listbox" aria-label="Which source">
            {[["", all] as [string, number], ...kinds].map(([k, n]) => (
              <div key={k || "all"} role="option" aria-selected={kind === k} tabIndex={0} className="aug-fs-chrome"
                onClick={() => setKind(k)} onKeyDown={e => { if (e.key === "Enter") setKind(k); }}
                style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 40px", width: "100%", cursor: "pointer",
                  borderRadius: "var(--r2)", background: kind === k ? "var(--bg-sel)" : undefined, padding: "4px 8px" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{k ? kindWord(k) : "Every source"}</span>
                <span style={{ ...NUM, textAlign: "right", color: "var(--t2)" }}>{formatCount(n)}</span>
                <span style={{ gridColumn: "1 / -1", height: 5, borderRadius: 3, background: "var(--bg-3)", overflow: "hidden", marginTop: 3 }}>
                  <span style={{ display: "block", width: `${all ? Math.max(2, (n / all) * 100) : 0}%`, height: "100%", background: "var(--chart-1)" }} />
                </span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ maxHeight: 420, overflowY: "auto", overflowX: "auto" }}>
          {rows?.rows.map((r, i) => (
            <div key={`${r.source.id}:${r.phrasing}:${i}`} className="aug-fs-chrome"
              style={{ display: "grid", gridTemplateColumns: "minmax(200px, 1fr) minmax(300px, 2.2fr) 150px", gap: 16, padding: "7px 0", minWidth: 700, ...(i ? RULE : {}) }}>
              <span>{r.prompt}</span>
              <span style={{ color: "var(--t2)" }}>{r.completion}</span>
              <span className="aug-fs-xs" style={MUTED} title={`${r.source.kind} ${r.source.id}`}>{kindWord(r.source.kind)}</span>
            </div>
          )) ?? <Empty>Reading the rows…</Empty>}
        </div>
      </div>
    </Card>
  );
}
