"use client";

/** AI Factory ▸ Runs — a new run, read before it starts (what, from which base, about how long), and every run with its
 *  loss and its measure. The engine is a choice among those ready here, nothing more: the page does not say how a
 *  model is trained (the user, 2026-11-24) — an engine not ready is simply not offered. The base is changed here. */
import { useState } from "react";

import { Sparkline } from "@/components/brief/Sparkline";
import { useMeasured } from "@/components/dashboards/cellBox";
import { Card, Chip, Empty, Facts, MUTED, NUM, ROW, RULE } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { cancelTraining, fetchOwnModelBase, startTraining, type FactoryRun } from "@/lib/api";
import { formatCount, relTime } from "@/lib/format";

import type { FactoryData } from "./AIFactoryPanel";
import { RUN_WORD, engineWord, f2, mb, minutes, pct, type FactoryTab } from "./shared";

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
  const readyEngines = (engines?.engines ?? []).filter(e => e.ready);
  const [engine, setEngine] = useState<string>(readyEngines.some(e => e.id === "llamafactory") ? "llamafactory" : "builtin");
  const [method, setMethod] = useState<"full" | "lora">(engine === "llamafactory" ? "lora" : "full");
  const [epochs, setEpochs] = useState(String(view.defaults.epochs));
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const node = view.training_set.train;
  const can = view.allowed && view.setup.ready && !!view.base?.present && !!node && readyEngines.some(e => e.id === engine);
  const why = !view.allowed ? "the organisation does not allow it yet" : !view.setup.ready ? "this install cannot train yet"
    : !view.base?.present ? "fetch a base above" : !node ? "build the training set on the Environments tab"
    : !readyEngines.some(e => e.id === engine) ? "no engine is ready here" : "";
  // About how long: a timed model's seconds per question-epoch, scaled — one made the same way when there is one; else
  // the nearest, and the line says whose time it borrows. No factor is guessed between engines or methods: on this Mac
  // LoRA through LlamaFactory ran slower per token than every weight through the built-in loop.
  const timed = view.models.filter(m => m.seconds && m.settings.epochs && m.training_set.train?.row_count);
  const same = timed.find(m => (m.engine ?? "builtin") === engine && m.settings.method === method);
  const from = same ?? timed[0];
  const perUnit = from ? (from.seconds ?? 0) / ((from.settings.epochs ?? 1) * (from.training_set.train?.row_count ?? 1)) : null;
  const estimate = perUnit && node ? perUnit * node.row_count * (Number(epochs) || 1) : null;
  const borrowed = from && !same ? `going by Model ${from.number} (${engineWord(from.engine)}, ${from.settings.method === "lora" ? "LoRA" : "every weight"})` : "";

  return (
    <Card label="New run" right="read what it will do before it starts" testId="ai-factory-new-run">
      <Facts rows={[
        ["Recipe", "Company dictionary"],
        ["Learns from", node ? `Company knowledge · version ${node.version} · ${formatCount(node.row_count)} questions, ${formatCount(view.training_set.held_out?.row_count ?? 0)} held out` : "no training set yet"],
        ["Base", <BaseRow key="base" data={data} running={running} onChanged={onChanged} />],
        ["Taught by", "example — preference needs corrections a person typed (none yet); reward needs an environment passed 10–80% of the time (none yet)"],
      ]} />
      <div style={{ ...ROW, gap: 16, marginTop: 12 }}>
        {readyEngines.length ? (
          <label className="aug-fs-sm" style={{ ...ROW, gap: 6 }}>Engine
            <SelectField aria-label="Engine" value={engine} disabled={running || readyEngines.length < 2} style={{ minWidth: 150 }}
              onChange={ev => { setEngine(ev.target.value); setMethod(ev.target.value === "llamafactory" ? "lora" : "full"); }}>
              {readyEngines.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </SelectField>
          </label>
        ) : <span className="aug-fs-sm" style={MUTED}>No engine is ready here.</span>}
        <Segmented label="Method" value={method} onChange={setMethod} disabled={running}
          options={[{ value: "full", label: "Every weight" }, { value: "lora", label: "LoRA", title: "A low-rank branch beside each weight, merged back" }]} />
        <label className="aug-fs-sm" style={{ ...ROW, gap: 6 }}>Epochs
          <Input value={epochs} onChange={e => setEpochs(e.target.value)} style={{ width: 64 }} inputMode="numeric" disabled={running} />
        </label>
        <label className="aug-fs-sm" style={{ ...ROW, gap: 6 }}>Learning rate
          <Input value={rate} onChange={e => setRate(e.target.value)} style={{ width: 96 }}
            placeholder={method === "lora" ? "4e-4" : String(view.defaults.learning_rate)} disabled={running} />
        </label>
        {estimate != null && <span className="aug-fs-sm" style={MUTED}>{borrowed ? "roughly" : "about"} {minutes(estimate)}{borrowed ? `, ${borrowed}` : ""} · nothing leaves the install</span>}
      </div>
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

/** The base a run starts from, and changing it: a Hugging Face repository (owner/name) or a folder on this machine. */
function BaseRow({ data, running, onChanged }: { data: FactoryData; running: boolean; onChanged: () => void }) {
  const b = data.view.base;
  const [open, setOpen] = useState(!b?.present);
  const [source, setSource] = useState(b?.source ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div data-testid="ai-factory-base" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={ROW}>
        {b ? <span>{b.source} · {b.architecture} · {mb(b.bytes)}{b.present ? "" : " — its folder is gone"}</span> : <span style={MUTED}>none fetched</span>}
        {b?.present && !open && <Button size="xs" variant="secondary" disabled={running || !data.view.allowed} onClick={() => setOpen(true)}>Change</Button>}
      </span>
      {open && (
        <span style={ROW}>
          <Input value={source} onChange={ev => setSource(ev.target.value)} placeholder="owner/name on Hugging Face, or a folder on this machine"
            style={{ flex: "1 1 260px", maxWidth: 460 }} aria-label="The base to fetch" />
          <Button size="xs" disabled={busy || running || !source.trim() || !data.view.allowed}
            onClick={async () => {
              setBusy(true);
              try { await fetchOwnModelBase(source.trim()); toast.info("The base is fetched"); setOpen(false); onChanged(); }
              catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
              finally { setBusy(false); }
            }}>{busy ? "Fetching…" : "Fetch"}</Button>
          {b?.present && <Button size="xs" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Keep {b.source}</Button>}
        </span>
      )}
    </div>
  );
}

function RunDetail({ run, running, onChanged, go }: { run: FactoryRun; running: boolean; onChanged: () => void; go: (t: FactoryTab, model?: number) => void }) {
  const last = run.last_step;
  const [lossBox, box] = useMeasured<HTMLDivElement>();   // the curve takes its column's width, never pushes the page wider
  return (
    <Card label="The run" right={<span>{engineWord(run.settings.engine)} · {RUN_WORD[run.state] ?? run.state}</span>} testId="ai-factory-run-detail">
      <div className="aug-fs-chrome" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {last && <span style={NUM}>step {last.step} of {last.total}{last.loss != null ? ` · loss ${f2(last.loss)}` : ""}{last.tokens_per_s ? ` · ${formatCount(Math.round(last.tokens_per_s))} tokens/s` : ""}</span>}
        {run.losses.length > 1 ? (
          <div ref={lossBox} role="img" aria-label={`Loss from ${run.losses[0]} to ${run.losses[run.losses.length - 1]}`} style={{ minWidth: 0, height: 72 }}>
            {box.width > 0 && <Sparkline values={run.losses} width={box.width} height={72} color="var(--chart-1)" showDot={false} />}
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
