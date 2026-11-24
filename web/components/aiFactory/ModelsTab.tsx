"use client";

/** AI Factory ▸ Models — every model, and the chosen one's detail below the list (never a pop-up): where it came from
 *  (base → training set → run → model), how it measured by what it was asked, its own answers to the held-out
 *  questions beside the organisation's — the weakest first — and putting it in service or withdrawing it. Asking a
 *  model in service is on the Playground. */
import { useEffect, useMemo, useState } from "react";

import { Card, Chip, Empty, Facts, MUTED, NUM, ROW, RULE } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { getHeldOutAnswers, publishOwnModel, withdrawOwnModel, type HeldOutAnswer, type OwnModel, type OwnModelMeasure } from "@/lib/api";
import { formatCount, relTime } from "@/lib/format";

import type { FactoryData } from "./AIFactoryPanel";
import { STATE_TONE, STATE_WORD, engineWord, f2, kindWord, mb, minutes, pct } from "./shared";

const COLS = "80px 110px minmax(150px, 1fr) 110px minmax(130px, 1fr) minmax(120px, 1fr) 80px 80px";
/** Below this the columns crush their numbers: the list scrolls sideways in its own section, the page does not. */
const MIN = 900;

export function ModelsTab({ data, picked, onPick, onChanged }: {
  data: FactoryData; picked: number | null; onPick: (n: number) => void; onChanged: () => void;
}) {
  const models = data.view.models;
  const shown = picked ?? models[0]?.number ?? null;
  const model = models.find(m => m.number === shown) ?? null;
  return (
    <>
      <Card label="Models" right={<span style={NUM}>{formatCount(models.filter(m => m.state === "published").length)} in service · {formatCount(models.length)} kept</span>} testId="ai-factory-models">
        {!models.length ? <Empty>No model trained yet — start one on the Runs tab.</Empty> : (
          <div role="table" aria-label="Models" style={{ overflowX: "auto" }}>
            <div role="row" className="aug-fs-xs" style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, ...MUTED, paddingBottom: 4, minWidth: MIN }}>
              <span>Model</span><span>State</span><span>Trained</span><span>Engine</span><span>Recalled, before → after</span>
              <span>F1, before → after</span><span>Time</span><span>Size</span>
            </div>
            {models.map(m => (
              <div key={m.number} role="row" tabIndex={0} onClick={() => onPick(m.number)}
                onKeyDown={e => { if (e.key === "Enter") onPick(m.number); }} data-testid={`ai-factory-model-${m.number}`}
                className="aug-fs-chrome"
                style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "7px 0", cursor: "pointer", minWidth: MIN, ...RULE,
                  background: shown === m.number ? "var(--bg-sel)" : undefined }}>
                <span style={NUM}>Model {m.number}</span>
                <span><Chip tone={STATE_TONE[m.state]}>{STATE_WORD[m.state]}</Chip></span>
                <span>{relTime(m.trained_at)}{m.trained_by ? ` · ${m.trained_by}` : ""}</span>
                <span style={{ color: "var(--t2)" }}>{engineWord(m.engine)}</span>
                <span style={NUM}>{pct(m.measure.before.recalled)} → <b>{pct(m.measure.after.recalled)}</b></span>
                <span style={NUM}>{f2(m.measure.before.f1)} → {f2(m.measure.after.f1)}</span>
                <span style={NUM}>{minutes(m.seconds)}</span>
                <span style={NUM}>{mb(m.bytes)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      {model && <ModelDetail key={model.number} model={model} onChanged={onChanged} />}
    </>
  );
}

function ByKind({ before, after }: { before: OwnModelMeasure; after: OwnModelMeasure }) {
  const kinds = Object.keys(after.by_kind ?? {}).sort((a, b) => (after.by_kind![b].n - after.by_kind![a].n));
  if (!kinds.length) return null;
  return (
    <div>
      <div className="aug-label" style={{ marginBottom: 6 }}>By what it was asked · held out, never trained on</div>
      {kinds.map(k => {
        const r = after.by_kind![k].recalled ?? 0;
        return (
          <div key={k} className="aug-fs-chrome" style={{ display: "grid", gridTemplateColumns: "minmax(120px, 170px) minmax(0, 1fr) 110px", gap: 10, alignItems: "center", padding: "4px 0" }}>
            <span>{kindWord(k)}</span>
            <span role="img" aria-label={`${kindWord(k)}: ${pct(r)} recalled`} style={{ height: 10, borderRadius: 5, background: "var(--bg-3)", overflow: "hidden" }}>
              <span style={{ display: "block", width: `${Math.max(2, r * 100)}%`, height: "100%", borderRadius: 5, background: r >= 0.8 ? "var(--chart-2)" : "var(--amb3)" }} />
            </span>
            <span style={{ ...NUM, textAlign: "right", color: "var(--t2)" }}>{after.by_kind![k].n} · {pct(before.by_kind?.[k]?.recalled)} → <b>{pct(r)}</b></span>
          </div>
        );
      })}
    </div>
  );
}

function ModelDetail({ model, onChanged }: { model: OwnModel; onChanged: () => void }) {
  const [answers, setAnswers] = useState<{ before?: HeldOutAnswer[]; after?: HeldOutAnswer[] } | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
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
  const node = (text: string) => (
    <span style={{ background: "var(--bg-3)", borderRadius: "var(--r2)", padding: "3px 9px" }} className="aug-fs-sm">{text}</span>
  );

  return (
    <Card label={`Model ${model.number}`} testId="ai-factory-model-detail"
      right={<Chip tone={STATE_TONE[model.state]}>{STATE_WORD[model.state]}{model.served_as ? ` as ${model.served_as}` : ""}</Chip>}>
      <div style={{ ...ROW, marginBottom: 12 }} aria-label="Where it came from">
        {node(model.base.source ?? "base")}<span style={MUTED}>→</span>
        {node(`Company knowledge · v${model.training_set.train?.version ?? "—"}`)}<span style={MUTED}>→</span>
        {node(`${engineWord(model.engine)} · ${model.settings.method === "lora" ? "LoRA" : "every weight"}`)}<span style={MUTED}>→</span>
        {node(`Model ${model.number}`)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "8px 40px" }}>
        <div>
          <Facts rows={[
            ["Learned from", `${formatCount(model.training_set.train?.row_count ?? 0)} questions · ${model.connections.length} connection${model.connections.length === 1 ? "" : "s"} — it answers only people who may see each one`],
            ["How", `${model.settings.epochs} epochs · rate ${model.settings.learning_rate}`],
            ["Ran", `${model.device ?? "—"} · ${formatCount(model.steps ?? 0)} steps${model.tokens ? ` · ${formatCount(model.tokens)} tokens` : ""} · ${minutes(model.seconds)}`],
            ["Answer loss", `${f2(model.measure.before.answer_loss)} → ${model.measure.after.answer_loss?.toFixed(4) ?? "—"}`],
            ["Kept at", model.dir ? <span className="mono aug-fs-xs" style={{ wordBreak: "break-all" }}>{model.dir}</span> : "—"],
          ]} />
          <div style={{ ...ROW, marginTop: 10 }}>
            {model.state === "draft" && (
              <Button size="sm" disabled={busy} onClick={() => act(() => publishOwnModel(model.number), `Model ${model.number} is in service`)}>Put in service</Button>
            )}
            {model.state !== "archived" && (
              <Button size="sm" variant="secondary" disabled={busy}
                onClick={() => act(() => withdrawOwnModel(model.number), `Model ${model.number} is withdrawn; its record stays`)}>Withdraw</Button>
            )}
            {model.state === "draft" && <span className="aug-fs-sm" style={MUTED}>It answers nobody until it is in service. Read its answers below first.</span>}
          </div>
        </div>
        <ByKind before={model.measure.before} after={model.measure.after} />
      </div>

      <div style={{ marginTop: 16 }} data-testid="ai-factory-answers">
        <div className="aug-label" style={{ marginBottom: 4 }}>
          Its answers to the held-out questions{pairs.length ? ` · ${pairs.length}, the weakest first` : ""}
        </div>
        {!answers ? <Loading what="the held-out answers" /> : !pairs.length ? <Empty>No held-out answers were kept for this model.</Empty> : (
          <div style={{ overflowX: "auto" }}>
            {(all ? pairs : pairs.slice(0, 10)).map(({ after, before }, i) => (
              <div key={`${after.question}:${i}`} className="aug-fs-chrome"
                style={{ display: "grid", gridTemplateColumns: "minmax(200px, 1fr) minmax(260px, 1.5fr) minmax(260px, 1.5fr) 100px", gap: 16, padding: "8px 0", minWidth: 880, ...RULE }}>
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
                  {before && <div className="aug-fs-sm" style={{ ...MUTED, marginTop: 4 }}>Before training: {before.answer.slice(0, 140) || "(no answer)"}{before.answer.length > 140 ? "…" : ""}</div>}
                </div>
                <div style={NUM}>
                  <Chip tone={after.f1 >= 0.6 ? "up" : "amber"}>F1 {after.f1.toFixed(2)}</Chip>
                  {before && <div className="aug-fs-xs" style={{ ...MUTED, marginTop: 4 }}>was {before.f1.toFixed(2)}</div>}
                </div>
              </div>
            ))}
            {pairs.length > 10 && (
              <Button size="xs" variant="secondary" style={{ marginTop: 8 }} onClick={() => setAll(v => !v)}>
                {all ? "Show the weakest ten" : `Show all ${pairs.length}`}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
