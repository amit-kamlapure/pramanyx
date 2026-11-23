"use client";

/**
 * Define ▸ Own model — the organisation's own model, trained on this install from what the organisation settled
 * (`pramanyx/training/`, 2026-11-23). One page, read top to bottom in the order the work goes: the base it starts from,
 * the training set (what it holds, what it withholds and why, every row readable with the source it cites), the run
 * (its loss as it falls, stoppable), and the models — each measured on questions worded as it never saw them, before
 * and after, with its own answers beside the company's. A model answers nobody until an admin puts it in service.
 *
 * Laid out from the clarity kit, the page's full width; a selected model's detail opens below the list, never in a
 * pop-up (no pop-up on a click).
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { Sparkline } from "@/components/brief/Sparkline";
import { Card, Chip, Empty, Facts, Figure, Figures, MUTED, NUM, Page, ROW, RULE } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Loading, ReadFailed } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import {
  askOwnModel, buildTrainingSet, cancelTraining, fetchOwnModelBase, getHeldOutAnswers, getOwnModel, getTrainingPlan,
  getTrainingRows, publishOwnModel, setOrgAllow, startTraining, withdrawOwnModel,
  type HeldOutAnswer, type OwnModel, type OwnModelAnswer, type OwnModelEvent, type OwnModelMeasure, type OwnModelOverview, type TrainingPlan,
  type TrainingRow,
} from "@/lib/api";
import { formatCount, relTime } from "@/lib/format";
import { withUniqueKeys } from "@/lib/listKeys";
import { useVisiblePoll } from "@/lib/useVisiblePoll";

/** What each source kind is called on the page. */
const KIND_WORD: Record<string, string> = {
  metric: "Approved metrics", glossary_table: "Glossary tables", glossary_column: "Glossary columns",
  definition: "Published Definitions", finding: "Confirmed findings", trusted_query: "Trusted queries",
  unsettled_metric: "Drafts and retired metrics", unsettled_term: "Words not defined", unqualified: "Asked with no connection",
  scope: "Outside what it knows",
};
const kindWord = (k: string) => KIND_WORD[k] ?? k;

const STATE_TONE = { draft: "plain", published: "up", archived: "amber" } as const;
const STATE_WORD = { draft: "Draft", published: "In service", archived: "Withdrawn" } as const;

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const f2 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));
const mb = (b?: number) => (b == null ? "—" : `${Math.round(b / 1e6)} MB`);
const params = (p?: number) => (p == null ? "—" : `${Math.round(p / 1e6)}M parameters`);

const ACTIVE = new Set(["PENDING", "RUNNING"]);
/** A run's state as the page says it (the kernel's `JobState`). */
const RUN_WORD: Record<string, string> = {
  PENDING: "waiting to start", RUNNING: "running", SUCCEEDED: "finished", FAILED: "failed", CANCELLED: "stopped",
  INTERRUPTED: "interrupted by a restart", PAUSED: "paused",
};

export function OwnModelPanel() {
  const [view, setView] = useState<OwnModelOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  const load = useCallback(async () => {
    try { setView(await getOwnModel()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  const loadPlan = useCallback(async () => {
    try { setPlan(await getTrainingPlan()); } catch { setPlan(null); }
  }, []);
  useEffect(() => {
    let live = true;
    getOwnModel().then(v => { if (live) setView(v); }).catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    getTrainingPlan().then(p => { if (live) setPlan(p); }).catch(() => { if (live) setPlan(null); });
    return () => { live = false; };
  }, []);
  const running = !!view?.run && ACTIVE.has(view.run.state);
  useVisiblePoll(() => { if (running) void load(); }, 2500);

  if (error && !view) return <Page><ReadFailed what="the organisation's own model" error={error} onRetry={load} /></Page>;
  if (!view) return <Page><Loading what="the organisation's own model" /></Page>;
  const latest = view.models[0];
  // Until a person picks one, the newest model is open — so a run that just ended shows what it made.
  const shown = picked ?? latest?.number ?? null;
  const model = view.models.find(m => m.number === shown) ?? null;

  return (
    <Page testId="own-model-page">
      <div className="aug-fs-md" style={{ color: "var(--t2)", maxWidth: "none", marginBottom: 8 }}>
        A model of the organisation&apos;s own, trained on this install from what the organisation settled — approved
        metrics, the glossary, published Definitions and confirmed findings. It answers from that and says when
        something is not settled. Nothing leaves the install.
      </div>

      {!view.allowed && <OffNotice where={view.where} onAllowed={load} />}
      {view.allowed && !view.setup.ready && (
        <Callout tone="amber" data-testid="own-model-setup">
          This install cannot train yet: {view.setup.missing.join(", ")} missing. {view.setup.how}.
        </Callout>
      )}

      <Figures testId="own-model-figures">
        <Figure label="Training set" value={view.training_set.train ? formatCount(view.training_set.train.row_count) : "—"}
          sub={view.training_set.train
            ? `questions · ${formatCount(view.training_set.held_out?.row_count ?? 0)} held out · version ${view.training_set.train.version}`
            : "not built yet"} />
        <Figure label="Held-out recall" value={latest ? pct(latest.measure.after.recalled) : "—"}
          sub={latest ? `model ${latest.number}, from ${pct(latest.measure.before.recalled)} before training` : "no model trained yet"} />
        <Figure label="In service" value={view.models.find(m => m.state === "published") ? `Model ${view.models.find(m => m.state === "published")!.number}` : "None"}
          sub={view.serving.reachable ? `through Ollama ${view.serving.detail}` : view.serving.detail} />
        <Figure label="Base" value={view.base?.present ? view.base.source.split("/").pop() ?? view.base.source : "—"}
          sub={view.base?.present ? `${view.base.architecture} · ${mb(view.base.bytes)}` : "not fetched"} />
      </Figures>

      <BaseSection view={view} onChanged={load} />
      <TrainingSetSection view={view} plan={plan} onBuilt={() => { void load(); void loadPlan(); }} />
      <RunSection view={view} running={running} onChanged={load} />
      <ModelsSection view={view} picked={shown} onPick={setPicked} />
      {model && <ModelDetail key={model.number} model={model} onChanged={load} />}
    </Page>
  );
}

function OffNotice({ where, onAllowed }: { where: string; onAllowed: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Callout tone="amber" data-testid="own-model-off">
      <div style={{ ...ROW, justifyContent: "space-between", width: "100%" }}>
        <span>Training the organisation&apos;s own model is off. An admin allows it in {where}.</span>
        <Button size="sm" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await setOrgAllow("train_own_model", true); toast.info("Training the organisation's own model is allowed"); onAllowed(); }
          catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
          finally { setBusy(false); }
        }}>Allow it</Button>
      </div>
    </Callout>
  );
}

// ── 1 · the base ──────────────────────────────────────────────────────────────────────────────────────────────────

function BaseSection({ view, onChanged }: { view: OwnModelOverview; onChanged: () => void }) {
  const [source, setSource] = useState(view.base?.source ?? "");
  const [busy, setBusy] = useState(false);
  const b = view.base;
  return (
    <Card label="1 · The base it starts from" testId="own-model-base"
      right={b?.present ? <Chip tone="up">Fetched</Chip> : b ? <Chip tone="amber">Its folder is gone</Chip> : <Chip>None yet</Chip>}>
      <div className="aug-fs-sm" style={{ ...MUTED, marginBottom: 8 }}>
        A small pretrained model that already reads and writes; training teaches it what the organisation settled.
        Name a Hugging Face repository (owner/name) or a folder on this machine. Only safetensors weights are fetched.
      </div>
      {b && (
        <Facts rows={[
          ["Source", b.source],
          ["Architecture", `${b.architecture}${b.layers ? ` · ${b.layers} layers × ${b.hidden_size}` : ""}${b.vocab_size ? ` · ${formatCount(b.vocab_size)}-token vocabulary` : ""}`],
          ["Size", mb(b.bytes)],
          ["Fetched", `${relTime(b.fetched_at)}${b.by ? ` by ${b.by}` : ""}`],
        ]} />
      )}
      <div style={{ ...ROW, marginTop: 10 }}>
        <Input value={source} onChange={e => setSource(e.target.value)} placeholder="owner/name, or /path/to/a/model"
          style={{ flex: "1 1 320px", maxWidth: 520 }} aria-label="The base to fetch" />
        <Button size="sm" variant={b?.present ? "secondary" : "default"} disabled={busy || !source.trim() || !view.allowed}
          onClick={async () => {
            setBusy(true);
            try { await fetchOwnModelBase(source.trim()); toast.info("The base is fetched"); onChanged(); }
            catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
            finally { setBusy(false); }
          }}>{busy ? "Fetching…" : b?.present ? "Fetch another" : "Fetch"}</Button>
      </div>
    </Card>
  );
}

// ── 2 · the training set ──────────────────────────────────────────────────────────────────────────────────────────

function TrainingSetSection({ view, plan, onBuilt }: { view: OwnModelOverview; plan: TrainingPlan | null; onBuilt: () => void }) {
  const [busy, setBusy] = useState(false);
  const [half, setHalf] = useState<"train" | "held_out">("train");
  const [kind, setKind] = useState("");
  const [rows, setRows] = useState<{ total: number; kinds?: Record<string, number>; rows: TrainingRow[] } | null>(null);
  const node = view.training_set.train;
  useEffect(() => {
    if (!node) return;
    let live = true;
    getTrainingRows(half, kind, 100).then(r => { if (live) setRows(r); }).catch(() => { if (live) setRows(null); });
    return () => { live = false; };
  }, [half, kind, node]);
  const changed = plan && node && (plan.rows.train !== node.row_count || plan.rows.held_out !== (view.training_set.held_out?.row_count ?? 0));
  const kinds = Object.entries(rows?.kinds ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <Card label="2 · What it learns" testId="own-model-set"
      right={node ? <span style={NUM}>version {node.version} · built {relTime(node.created_at)}</span> : undefined}>
      <div className="aug-fs-sm" style={{ ...MUTED, marginBottom: 8 }}>
        Each source becomes a few phrasings of one question, answered from the source&apos;s own words — no model writes a
        row. One phrasing of each is held out and never trained on: the model is measured on it.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "8px 40px" }}>
        <div>
          <div className="aug-label" style={{ marginBottom: 4 }}>Holds{plan ? ` · ${formatCount(plan.rows.train)} questions, ${formatCount(plan.rows.held_out)} held out` : ""}</div>
          {plan ? Object.entries(plan.sources).sort((a, b) => b[1] - a[1]).map(([k, n], i) => (
            <div key={k} className="aug-fs-chrome" style={{ ...ROW, justifyContent: "space-between", padding: "5px 0", ...(i ? RULE : {}) }}>
              <span>{kindWord(k)}</span><span style={{ ...NUM, color: "var(--t2)" }}>{formatCount(n)}</span>
            </div>
          )) : <Empty>Reading the sources…</Empty>}
        </div>
        <div>
          <div className="aug-label" style={{ marginBottom: 4 }}>Leaves out</div>
          {plan?.withheld.length ? plan.withheld.map((w, i) => (
            <div key={w.reason} className="aug-fs-chrome" style={{ ...ROW, justifyContent: "space-between", padding: "5px 0", ...(i ? RULE : {}) }}>
              <span>{w.reason}</span><span style={{ ...NUM, color: "var(--t2)" }}>{formatCount(w.count)}</span>
            </div>
          )) : <Empty>{plan ? "Nothing — every source is in." : "Reading the sources…"}</Empty>}
          {plan?.withheld.some(w => w.reason.includes("confirmed")) && (
            <div className="aug-fs-sm" style={{ ...MUTED, marginTop: 6 }}>
              A finding a person confirms in the Record joins the next build.
            </div>
          )}
        </div>
      </div>
      <div style={{ ...ROW, marginTop: 12 }}>
        <Button size="sm" disabled={busy || !view.allowed} variant={node && !changed ? "secondary" : "default"}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await buildTrainingSet();
              toast.info(r.train.version === node?.version ? "Nothing changed since the last build" : `Training set version ${r.train.version} built`);
              onBuilt();
            } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
            finally { setBusy(false); }
          }}>{busy ? "Building…" : node ? "Build again" : "Build the training set"}</Button>
        {changed && <Chip tone="amber">The sources changed since version {node!.version}</Chip>}
      </div>

      {node && (
        <div style={{ marginTop: 16 }} data-testid="own-model-rows">
          <div style={{ ...ROW, marginBottom: 6 }}>
            <Segmented label="Which half" value={half} onChange={v => { setHalf(v); setKind(""); }}
              options={[{ value: "train", label: "Trained on" }, { value: "held_out", label: "Held out" }]} />
            {/* Eight sources do not fit a segmented row at a laptop's width (measured: 1,317px): a menu does. */}
            <Select value={kind} onValueChange={setKind}
              items={{ "": "Every source", ...Object.fromEntries(kinds.map(([k, n]) => [k, `${kindWord(k)} · ${n}`])) }}>
              <SelectTrigger aria-label="Which source" />
              <SelectContent>
                <SelectItem value="">Every source</SelectItem>
                {kinds.map(([k, n]) => <SelectItem key={k} value={k}>{`${kindWord(k)} · ${n}`}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="aug-fs-xs" style={{ ...MUTED, marginLeft: "auto" }}>{rows ? `${formatCount(Math.min(100, rows.total))} of ${formatCount(rows.total)}` : ""}</span>
          </div>
          <div style={{ maxHeight: 360, overflowY: "auto", overflowX: "auto" }}>
            {rows?.rows.map((r, i) => (
              <div key={`${r.source.id}:${r.phrasing}:${i}`} className="aug-fs-chrome"
                style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(320px, 2.2fr) 170px", gap: 16, padding: "7px 0", minWidth: 760, ...(i ? RULE : {}) }}>
                <span>{r.prompt}</span>
                <span style={{ color: "var(--t2)" }}>{r.completion}</span>
                <span className="aug-fs-xs" style={MUTED} title={`${r.source.kind} ${r.source.id}`}>{kindWord(r.source.kind)}</span>
              </div>
            )) ?? <Empty>Reading the rows…</Empty>}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── 3 · the run ───────────────────────────────────────────────────────────────────────────────────────────────────

function LossLine({ events }: { events: OwnModelEvent[] }) {
  const losses = events.filter(e => e.event === "step" && e.loss != null).map(e => e.loss!);
  if (losses.length < 2) return null;
  return (
    <div role="img" aria-label={`Training loss from ${losses[0]} to ${losses[losses.length - 1]}`} style={{ marginTop: 8 }}>
      <Sparkline values={losses} width={560} height={72} color="var(--chart-1)" showDot={false} />
    </div>
  );
}

function RunSection({ view, running, onChanged }: { view: OwnModelOverview; running: boolean; onChanged: () => void }) {
  const [method, setMethod] = useState<"full" | "lora">("full");
  const [epochs, setEpochs] = useState(String(view.defaults.epochs));
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const run = view.run;
  const events = run?.events ?? [];
  const last = [...events].reverse().find(e => e.event === "step");
  const start = events.find(e => e.event === "start");
  const measures = events.filter(e => e.event === "measure");
  const ended = events.find(e => ["done", "error", "cancelled"].includes(e.event));
  const can = view.allowed && view.setup.ready && !!view.base?.present && !!view.training_set.train;
  const why = !view.allowed ? "the organisation does not allow it yet" : !view.setup.ready ? "this install cannot train yet"
    : !view.base?.present ? "fetch a base first" : !view.training_set.train ? "build the training set first" : "";

  return (
    <Card label="3 · Train" testId="own-model-run"
      right={run ? <span>the last run {RUN_WORD[run.state] ?? run.state} · started {relTime(run.created_at)}{run.by ? ` by ${run.by}` : ""}</span> : undefined}>
      <div className="aug-fs-sm" style={{ ...MUTED, marginBottom: 8 }}>
        Runs on this machine, in its own process. It measures the base on the held-out questions first, trains, then
        measures again — the same questions, the same way.
      </div>
      <div style={{ ...ROW, gap: 12 }}>
        <Segmented label="Method" value={method} onChange={setMethod} disabled={running}
          options={[{ value: "full", label: "Every weight", title: "Full fine-tuning" },
                    { value: "lora", label: "LoRA", title: "A low-rank branch beside each weight, merged back" }]} />
        <label className="aug-fs-sm" style={{ ...ROW, gap: 6 }}>Epochs
          <Input value={epochs} onChange={e => setEpochs(e.target.value)} style={{ width: 64 }} inputMode="numeric" disabled={running} />
        </label>
        <label className="aug-fs-sm" style={{ ...ROW, gap: 6 }}>Learning rate
          <Input value={rate} onChange={e => setRate(e.target.value)} style={{ width: 96 }}
            placeholder={method === "lora" ? "4e-4" : String(view.defaults.learning_rate)} disabled={running} />
        </label>
        {running ? (
          <Button size="sm" variant="destructive" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await cancelTraining(run!.job_id); toast.info("Stopping at the next step"); onChanged(); }
            catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
            finally { setBusy(false); }
          }}>Stop</Button>
        ) : (
          <Button size="sm" disabled={busy || !can} title={why || undefined} onClick={async () => {
            setBusy(true);
            try {
              await startTraining({ method, epochs: Number(epochs) || undefined, learning_rate: rate.trim() ? Number(rate) : undefined });
              toast.info("Training started"); onChanged();
            } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
            finally { setBusy(false); }
          }}>Train</Button>
        )}
        {!can && !running && <span className="aug-fs-sm" style={MUTED}>Not yet: {why}.</span>}
      </div>

      {run && (
        <div style={{ marginTop: 12 }} data-testid="own-model-progress">
          <div className="aug-fs-chrome" style={{ ...ROW, gap: 16 }}>
            {start && <span style={MUTED}>{params(start.params)} on {start.device} · {formatCount(start.train_rows ?? 0)} questions</span>}
            {last && <span style={NUM}>step {last.step} of {last.total} · epoch {last.epoch} · loss {f2(last.loss)} · {formatCount(last.tokens_per_s ?? 0)} tokens/s</span>}
            {withUniqueKeys(measures, m => `measure:${m.label ?? ""}`).map(([key, m]) => (
              <span key={key} style={NUM}>{m.label === "before" ? "Before" : "After"}: recalled {pct(m.recalled)}, F1 {f2(m.f1)}</span>
            ))}
            {running && !last && (
              <span style={MUTED}>{measures.length ? "Training — the first steps are on their way…" : "Measuring the base on the held-out questions first…"}</span>
            )}
          </div>
          <LossLine events={events} />
          {ended?.event === "error" && <div className="aug-fs-sm" style={{ color: "var(--red4)", marginTop: 6 }}>It failed: {ended.error}</div>}
          {ended?.event === "cancelled" && <div className="aug-fs-sm" style={{ ...MUTED, marginTop: 6 }}>Stopped by a person; nothing was recorded.</div>}
          {run.state === "FAILED" && !ended && run.error && <div className="aug-fs-sm" style={{ color: "var(--red4)", marginTop: 6 }}>It failed: {run.error}</div>}
        </div>
      )}
    </Card>
  );
}

// ── the models ────────────────────────────────────────────────────────────────────────────────────────────────────

const MODEL_COLS = "70px 110px minmax(150px, 1fr) minmax(130px, 1fr) minmax(130px, 1fr) 90px 80px";
/** Below this the columns would crush their numbers: the list scrolls sideways in its own section, the page does not. */
const MODEL_MIN = 840;

function ModelsSection({ view, picked, onPick }: { view: OwnModelOverview; picked: number | null; onPick: (n: number) => void }) {
  return (
    <Card label="Models" testId="own-model-models" right={<span style={NUM}>{formatCount(view.models.length)}</span>}>
      {!view.models.length ? <Empty>No model trained yet.</Empty> : (
        <div role="table" aria-label="Models" style={{ overflowX: "auto" }}>
          <div role="row" className="aug-fs-xs" style={{ display: "grid", gridTemplateColumns: MODEL_COLS, gap: 12, ...MUTED, paddingBottom: 4, minWidth: MODEL_MIN }}>
            <span>Model</span><span>State</span><span>Trained</span><span>Recalled, before → after</span>
            <span>F1, before → after</span><span>Time</span><span>Size</span>
          </div>
          {view.models.map(m => (
            <div key={m.number} role="row" tabIndex={0} onClick={() => onPick(m.number)}
              onKeyDown={e => { if (e.key === "Enter") onPick(m.number); }} data-testid={`own-model-row-${m.number}`}
              className="aug-fs-chrome"
              style={{ display: "grid", gridTemplateColumns: MODEL_COLS, gap: 12, padding: "7px 0", cursor: "pointer", minWidth: MODEL_MIN, ...RULE,
                background: picked === m.number ? "var(--bg-sel)" : undefined }}>
              <span style={NUM}>Model {m.number}</span>
              <span><Chip tone={STATE_TONE[m.state]}>{STATE_WORD[m.state]}</Chip></span>
              <span>{relTime(m.trained_at)}{m.trained_by ? ` · ${m.trained_by}` : ""}</span>
              <span style={NUM}>{pct(m.measure.before.recalled)} → <b>{pct(m.measure.after.recalled)}</b></span>
              <span style={NUM}>{f2(m.measure.before.f1)} → {f2(m.measure.after.f1)}</span>
              <span style={NUM}>{m.seconds != null ? `${Math.round(m.seconds / 60 * 10) / 10} min` : "—"}</span>
              <span style={NUM}>{mb(m.bytes)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ByKind({ before, after }: { before: OwnModelMeasure; after: OwnModelMeasure }) {
  const kinds = Object.keys(after.by_kind ?? {}).sort((a, b) => (after.by_kind![b].n - after.by_kind![a].n));
  if (!kinds.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="aug-label" style={{ marginBottom: 4 }}>By what it was asked</div>
      {kinds.map((k, i) => (
        <div key={k} className="aug-fs-chrome" style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1fr) 72px 128px", gap: 12, padding: "5px 0", ...(i ? RULE : {}) }}>
          <span>{kindWord(k)}</span>
          <span style={{ ...NUM, ...MUTED }}>{after.by_kind![k].n} asked</span>
          <span style={NUM}>{pct(before.by_kind?.[k]?.recalled)} → <b>{pct(after.by_kind![k].recalled)}</b></span>
        </div>
      ))}
    </div>
  );
}

function ModelDetail({ model, onChanged }: { model: OwnModel; onChanged: () => void }) {
  const [answers, setAnswers] = useState<{ before?: HeldOutAnswer[]; after?: HeldOutAnswer[] } | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<{ q: string; r: OwnModelAnswer }[]>([]);
  useEffect(() => { getHeldOutAnswers(model.number).then(setAnswers).catch(() => setAnswers({})); }, [model.number]);
  const pairs = useMemo(() => {
    const before = new Map((answers?.before ?? []).map(a => [a.question, a]));
    return (answers?.after ?? []).map(a => ({ after: a, before: before.get(a.question) }))
      .sort((x, y) => x.after.f1 - y.after.f1);       // the weakest first: what to read before putting it in service
  }, [answers]);
  const act = async (fn: () => Promise<unknown>, said: string) => {
    setBusy(true);
    try { await fn(); toast.info(said); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Card label={`Model ${model.number}`} testId="own-model-detail"
      right={<Chip tone={STATE_TONE[model.state]}>{STATE_WORD[model.state]}{model.served_as ? ` as ${model.served_as}` : ""}</Chip>}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: "8px 40px" }}>
        <div>
          <Facts rows={[
            ["Trained from", `${model.base.source ?? "—"} · training set version ${model.training_set.train?.version ?? "—"} (${formatCount(model.training_set.train?.row_count ?? 0)} questions)`],
            ["How", `${model.settings.method === "lora" ? "LoRA" : "every weight"} · ${model.settings.epochs} epochs · rate ${model.settings.learning_rate}`],
            ["Ran", `${model.device ?? "—"} · ${formatCount(model.steps ?? 0)} steps · ${formatCount(model.tokens ?? 0)} tokens · ${model.seconds != null ? `${Math.round(model.seconds)} s` : "—"}`],
            ["Learned from", model.connections.length ? `${model.connections.length} connection${model.connections.length > 1 ? "s" : ""} — it answers only people who may see each one` : "—"],
            ["Answer loss", `${f2(model.measure.before.answer_loss)} → ${model.measure.after.answer_loss?.toFixed(4) ?? "—"}`],
          ]} />
          <div style={{ ...ROW, marginTop: 10 }}>
            {model.state === "draft" && (
              <Button size="sm" disabled={busy} onClick={() => act(() => publishOwnModel(model.number), `Model ${model.number} is in service`)}>
                Put in service
              </Button>
            )}
            {model.state !== "archived" && (
              <Button size="sm" variant="secondary" disabled={busy}
                onClick={() => act(() => withdrawOwnModel(model.number), `Model ${model.number} is withdrawn; its record stays`)}>
                Withdraw
              </Button>
            )}
            {model.state === "draft" && <span className="aug-fs-sm" style={MUTED}>It answers nobody until it is in service. Read its answers below first.</span>}
          </div>
        </div>
        <ByKind before={model.measure.before} after={model.measure.after} />
      </div>

      {model.state === "published" && (
        <div style={{ marginTop: 16 }} data-testid="own-model-ask">
          <div className="aug-label" style={{ marginBottom: 4 }}>Ask it</div>
          <form style={ROW} onSubmit={e => {
            e.preventDefault();
            const q = question.trim();
            if (!q) return;
            setBusy(true);
            askOwnModel(model.number, q)
              .then(r => { setAsked(prev => [{ q, r }, ...prev]); setQuestion(""); })
              .catch(err => toast.error(err instanceof Error ? err.message : String(err)))
              .finally(() => setBusy(false));
          }}>
            <Input value={question} onChange={e => setQuestion(e.target.value)} placeholder="What is Revenue at theLook?"
              style={{ flex: "1 1 420px" }} aria-label="A question for the model" />
            <Button size="sm" type="submit" disabled={busy || !question.trim()}>Ask</Button>
          </form>
          {asked.map((x, i) => (
            <div key={i} className="aug-fs-chrome" style={{ padding: "8px 0", ...RULE }} data-testid="own-model-asked">
              <div>{x.q}</div>
              {x.r.verdict === "withheld" ? (
                <div style={{ color: "var(--amb4)", marginTop: 2 }}>
                  Withheld — {x.r.why}.{x.r.closest?.id ? ` The nearest settled source is ${kindWord(x.r.closest.kind ?? "").toLowerCase()} ${x.r.closest.id}.` : ""}
                </div>
              ) : (
                <div style={{ color: "var(--t2)", marginTop: 2 }}>{x.r.answer}</div>
              )}
              <div className="aug-fs-xs" style={{ ...MUTED, marginTop: 2 }}>
                {x.r.verdict === "settled" && x.r.source ? `From ${kindWord(x.r.source.kind ?? "").toLowerCase()} · ${x.r.source.id}` : ""}
                {x.r.verdict === "not_settled" ? "Nothing is settled about it — the model says so rather than inventing" : ""}
                {x.r.ms != null ? ` · ${x.r.ms} ms` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16 }} data-testid="own-model-answers">
        <div className="aug-label" style={{ marginBottom: 4 }}>
          Its answers to the held-out questions{pairs.length ? ` · ${pairs.length}, the weakest first` : ""}
        </div>
        {!answers ? <Loading what="the held-out answers" /> : !pairs.length ? <Empty>No held-out answers were kept for this model.</Empty> : (
          <div style={{ overflowX: "auto" }}>
            {(all ? pairs : pairs.slice(0, 12)).map(({ after, before }, i) => (
              <div key={`${after.question}:${i}`} className="aug-fs-chrome"
                style={{ display: "grid", gridTemplateColumns: "minmax(200px, 1fr) minmax(260px, 1.5fr) minmax(260px, 1.5fr) 110px", gap: 16, padding: "8px 0", minWidth: 880, ...RULE }}>
                <div>
                  <div>{after.question}</div>
                  <div className="aug-fs-xs" style={{ ...MUTED, marginTop: 2 }}>{kindWord(after.source?.kind ?? "")}</div>
                </div>
                <div>
                  <div className="aug-fs-xs" style={MUTED}>The organisation&apos;s answer</div>
                  <div style={{ color: "var(--t2)" }}>{after.expected}</div>
                </div>
                <div>
                  <div className="aug-fs-xs" style={MUTED}>Model {model.number}</div>
                  <div>{after.answer || <span style={MUTED}>(no answer)</span>}</div>
                  {before && <div className="aug-fs-sm" style={{ ...MUTED, marginTop: 4 }}>Before training: {before.answer.slice(0, 160) || "(no answer)"}{before.answer.length > 160 ? "…" : ""}</div>}
                </div>
                <div style={NUM}>
                  <Chip tone={after.f1 >= 0.6 ? "up" : "amber"}>F1 {after.f1.toFixed(2)}</Chip>
                  {before && <div className="aug-fs-xs" style={{ ...MUTED, marginTop: 4 }}>was {before.f1.toFixed(2)}</div>}
                </div>
              </div>
            ))}
            {pairs.length > 12 && (
              <Button size="xs" variant="secondary" style={{ marginTop: 8 }} onClick={() => setAll(v => !v)}>
                {all ? "Show the weakest twelve" : `Show all ${pairs.length}`}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
