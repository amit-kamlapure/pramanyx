"use client";

/** AI Factory ▸ Runs — a new run, read before it starts (what, on which base, by which engine, how, where, about how
 *  long), and every run with its loss and its measure. A way of teaching not offered yet is said with why, never a
 *  choice that fails when chosen. */
import { useState } from "react";

import { Sparkline } from "@/components/brief/Sparkline";
import { Card, Chip, Empty, Facts, MUTED, NUM, ROW, RULE } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { cancelTraining, startTraining, type FactoryRun } from "@/lib/api";
import { formatCount, relTime } from "@/lib/format";

import type { FactoryData } from "./AIFactoryPanel";
import { RUN_WORD, engineWord, f2, minutes, pct, type FactoryTab } from "./shared";

export function RunsTab({ data, running, onChanged, go }: {
  data: FactoryData; running: boolean; onChanged: () => void; go: (t: FactoryTab, model?: number) => void;
}) {
  const runs = data.runs ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const run = runs.find(r => r.job_id === picked) ?? runs[0];
  return (
    <>
      <NewRun data={data} running={running} onChanged={onChanged} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
        <Card label="Runs" right={<span style={NUM}>{formatCount(runs.length)}</span>} testId="ai-factory-runs">
          {!runs.length ? <Empty>No run yet.</Empty> : (
            <div role="table" aria-label="Runs" style={{ overflowX: "auto" }}>
              <div role="row" className="aug-fs-xs" style={{ ...GRID, ...MUTED, paddingBottom: 4 }}>
                <span>Started</span><span>Engine · method</span><span>Questions</span><span>State</span><span>Result</span>
              </div>
              {runs.map(r => (
                <div key={r.job_id} role="row" tabIndex={0} className="aug-fs-chrome" data-testid={`run-${r.run_id}`}
                  onClick={() => setPicked(r.job_id)} onKeyDown={k => { if (k.key === "Enter") setPicked(r.job_id); }}
                  style={{ ...GRID, padding: "7px 0", cursor: "pointer", ...RULE, background: r.job_id === run?.job_id ? "var(--bg-sel)" : undefined }}>
                  <span>{relTime(r.created_at)}{r.by ? ` · ${r.by}` : ""}</span>
                  <span style={{ color: "var(--t2)" }}>{engineWord(r.settings.engine)} · {r.settings.method === "lora" ? "LoRA" : "every weight"} · {r.settings.epochs} ep</span>
                  <span style={NUM}>{formatCount(r.rows ?? 0)}</span>
                  <span><Chip tone={r.state === "SUCCEEDED" ? "up" : r.state === "FAILED" ? "amber" : "plain"}>{RUN_WORD[r.state] ?? r.state}</Chip></span>
                  <span style={NUM}>{r.model != null ? `Model ${r.model} · ${pct(r.measures.after?.recalled)}` : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        {run && <RunDetail run={run} running={running && run === runs[0]} onChanged={onChanged} go={go} />}
      </div>
    </>
  );
}

const GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(120px,1fr) minmax(170px,1.4fr) 80px 110px minmax(120px,1fr)", gap: 12, minWidth: 640 };

function NewRun({ data, running, onChanged }: { data: FactoryData; running: boolean; onChanged: () => void }) {
  const { view, engines } = data;
  const readyEngines = (engines?.engines ?? []).filter(e => (e.id === "builtin" || e.id === "llamafactory") && e.status === "ready");
  const [engine, setEngine] = useState<string>(readyEngines.some(e => e.id === "llamafactory") ? "llamafactory" : "builtin");
  const [method, setMethod] = useState<"full" | "lora">(engine === "llamafactory" ? "lora" : "full");
  const [epochs, setEpochs] = useState(String(view.defaults.epochs));
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const node = view.training_set.train;
  const can = view.allowed && view.setup.ready && !!view.base?.present && !!node && readyEngines.some(e => e.id === engine);
  const why = !view.allowed ? "the organisation does not allow it yet" : !view.setup.ready ? "this install cannot train yet"
    : !view.base?.present ? "fetch a base on the Engines tab" : !node ? "build the training set on the Environments tab"
    : !readyEngines.some(e => e.id === engine) ? "the engine is not ready here" : "";
  // About how long: the last model's seconds per question-epoch, scaled — said as an estimate, or not at all.
  const last = view.models.find(m => m.seconds && m.settings.epochs && m.training_set.train?.row_count);
  const perUnit = last ? (last.seconds ?? 0) / ((last.settings.epochs ?? 1) * (last.training_set.train?.row_count ?? 1)) : null;
  const estimate = perUnit && node ? perUnit * node.row_count * (Number(epochs) || 1) * (method === "lora" ? 0.6 : 1) : null;
  const notYet = (engines?.engines ?? []).filter(e => !readyEngines.includes(e) && (e.id === "builtin" || e.id === "llamafactory"));

  return (
    <Card label="New run" right="read what it will do before it starts" testId="ai-factory-new-run">
      <Facts rows={[
        ["Recipe", "Company dictionary"],
        ["Learns from", node ? `Company knowledge · version ${node.version} · ${formatCount(node.row_count)} questions, ${formatCount(view.training_set.held_out?.row_count ?? 0)} held out` : "no training set yet"],
        ["Base", view.base?.present ? `${view.base.source} · ${view.base.architecture}` : "none fetched"],
        ["Taught by", "example — preference needs corrections a person typed (none yet); reward needs an environment passed 10–80% of the time (none yet)"],
        ["Runs on", `this machine${engines ? ` · ${engines.hardware.accelerator}` : ""} — a rented GPU or a hosted service would send the tasks out of the install, so neither is offered`],
      ]} />
      <div style={{ ...ROW, gap: 16, marginTop: 12 }}>
        {readyEngines.length > 1 ? (
          <Segmented label="Engine" value={engine} disabled={running}
            onChange={v => { setEngine(v); setMethod(v === "llamafactory" ? "lora" : "full"); }}
            options={readyEngines.map(e => ({ value: e.id, label: e.name }))} />
        ) : <Chip>{readyEngines[0]?.name ?? "no engine ready"}</Chip>}
        <Segmented label="Method" value={method} onChange={setMethod} disabled={running}
          options={[{ value: "full", label: "Every weight" }, { value: "lora", label: "LoRA", title: "A low-rank branch beside each weight, merged back" }]} />
        <label className="aug-fs-sm" style={{ ...ROW, gap: 6 }}>Epochs
          <Input value={epochs} onChange={e => setEpochs(e.target.value)} style={{ width: 64 }} inputMode="numeric" disabled={running} />
        </label>
        <label className="aug-fs-sm" style={{ ...ROW, gap: 6 }}>Learning rate
          <Input value={rate} onChange={e => setRate(e.target.value)} style={{ width: 96 }}
            placeholder={method === "lora" ? "4e-4" : String(view.defaults.learning_rate)} disabled={running} />
        </label>
        {estimate != null && <span className="aug-fs-sm" style={MUTED}>about {minutes(estimate)} · nothing leaves the install</span>}
      </div>
      {notYet.length > 0 && (
        <div className="aug-fs-sm" style={{ ...MUTED, marginTop: 8 }}>
          {notYet.map(e => `${e.name}: ${e.why}${e.how ? ` — ${e.how}` : ""}`).join(" · ")}
        </div>
      )}
      <div style={{ ...ROW, marginTop: 12 }}>
        {running ? (
          <Button size="sm" variant="destructive" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await cancelTraining(view.run!.job_id); toast.info("Stopping"); onChanged(); }
            catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
            finally { setBusy(false); }
          }}>Stop the run</Button>
        ) : (
          <Button size="sm" disabled={busy || !can} onClick={async () => {
            setBusy(true);
            try {
              await startTraining({ engine, method, epochs: Number(epochs) || undefined, learning_rate: rate.trim() ? Number(rate) : undefined });
              toast.info("Training started"); onChanged();
            } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
            finally { setBusy(false); }
          }}>Start</Button>
        )}
        {!can && !running && <span className="aug-fs-sm" style={MUTED}>Not yet: {why}.</span>}
      </div>
    </Card>
  );
}

function RunDetail({ run, running, onChanged, go }: { run: FactoryRun; running: boolean; onChanged: () => void; go: (t: FactoryTab, model?: number) => void }) {
  const last = run.last_step;
  return (
    <Card label="The run" right={<span>{engineWord(run.settings.engine)} · {RUN_WORD[run.state] ?? run.state}</span>} testId="ai-factory-run-detail">
      <div className="aug-fs-chrome" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {last && <span style={NUM}>step {last.step} of {last.total}{last.loss != null ? ` · loss ${f2(last.loss)}` : ""}{last.tokens_per_s ? ` · ${formatCount(Math.round(last.tokens_per_s))} tokens/s` : ""}</span>}
        {run.losses.length > 1 ? (
          <div role="img" aria-label={`Loss from ${run.losses[0]} to ${run.losses[run.losses.length - 1]}`}>
            <Sparkline values={run.losses} width={520} height={72} color="var(--chart-1)" showDot={false} />
          </div>
        ) : running ? <span style={MUTED}>The first steps are on their way…</span> : null}
        <span style={ROW}>
          {run.measures.before && <Chip>Before: recall {pct(run.measures.before.recalled)} · F1 {f2(run.measures.before.f1)}</Chip>}
          {run.measures.after && <Chip tone="up">After: recall {pct(run.measures.after.recalled)} · F1 {f2(run.measures.after.f1)}</Chip>}
        </span>
        {run.state === "FAILED" && <span style={{ color: "var(--red4)" }}>It failed: {run.error || "see the run's engine log"}</span>}
        {run.state === "INTERRUPTED" && <span style={MUTED}>A restart interrupted it; nothing was recorded. Train again.</span>}
        <span style={ROW}>
          {run.model != null && <Button size="xs" variant="secondary" onClick={() => go("models", run.model ?? undefined)}>Open model {run.model}</Button>}
          {running && <Button size="xs" variant="secondary" onClick={onChanged}>Read again</Button>}
        </span>
      </div>
      <div className="aug-fs-xs" style={{ ...MUTED, marginTop: 8, ...RULE, paddingTop: 6 }}>Run {run.run_id}</div>
    </Card>
  );
}
