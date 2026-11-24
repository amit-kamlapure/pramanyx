"use client";

/** AI Factory ▸ Overview — figures, what needs a person, the line from settled sources to a model in service, and the
 *  models and the latest run. Every number is read; one not read says "—". */
import { Card, Chip, Empty, Figure, Figures, MUTED, NUM, NeedsRow, NeedsYou, ROW, RULE } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { formatCount, relTime } from "@/lib/format";

import type { FactoryData } from "./AIFactoryPanel";
import { RUN_WORD, STATE_TONE, STATE_WORD, engineWord, minutes, pct, type FactoryTab } from "./shared";

export function OverviewTab({ data, go }: { data: FactoryData; go: (t: FactoryTab, model?: number) => void }) {
  const { view, plan, environments, engines, runs } = data;
  const inService = view.models.filter(m => m.state === "published");
  const latest = view.models[0];
  const best = view.models.reduce<number | null>((b, m) => {
    const r = m.measure.after.recalled;
    return r != null && (b == null || r > b) ? r : b;
  }, null);
  const sourceCount = plan ? Object.values(plan.sources).reduce((a, b) => a + b, 0) : null;
  const leftOut = plan ? plan.withheld.reduce((a, w) => a + w.count, 0) : null;
  const unconfirmed = plan?.withheld.find(w => w.reason.includes("confirmed"))?.count ?? 0;
  const sql = environments?.environments.find(e => e.id === "sql");
  const ready = engines?.engines.filter(e => e.status === "ready" && e.runs_here) ?? [];
  const here = engines?.engines.filter(e => e.runs_here) ?? [];
  const lastRun = runs?.[0];

  const stage = (label: string, value: string, meta: string, share: number, done = false) => (
    <div key={label} style={{ background: "var(--bg-2)", border: "1px solid var(--card-edge)", borderRadius: "var(--r3)", padding: "12px 14px", minWidth: 0 }}>
      <div className="aug-fs-xs" style={MUTED}>{label}</div>
      <div className="aug-fs-display" style={{ fontWeight: 600, ...NUM }}>{value}</div>
      <div className="aug-fs-sm" style={MUTED}>{meta}</div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--bg-3)", marginTop: 8, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(2, Math.min(100, share * 100))}%`, height: "100%", borderRadius: 3,
          background: done ? "var(--chart-2)" : "var(--chart-1)" }} />
      </div>
    </div>
  );

  return (
    <>
      <Figures testId="ai-factory-figures">
        <Figure label="In service" value={inService.length ? `${inService.length} model${inService.length > 1 ? "s" : ""}` : "None"}
          sub={inService.length ? `Model ${inService.map(m => m.number).join(", ")} · through Ollama` : "a trained model answers nobody until put in service"} />
        <Figure label="Held-out recall" value={pct(best)}
          sub={latest ? `best model, from ${pct(latest.measure.before.recalled)} before training` : "no model trained yet"} />
        <Figure label="Ready to learn from" value={sourceCount == null ? "—" : formatCount(sourceCount)}
          sub={plan ? `settled sources · ${formatCount(plan.rows.train)} questions` : "not read"} />
        <Figure label="Engines on this machine" value={engines ? `${ready.length} of ${here.length}` : "—"}
          sub={engines ? engines.hardware.accelerator : "not read"} />
      </Figures>

      <NeedsYou testId="ai-factory-needs" empty={<span>Nothing waits on a person.</span>}>
        {unconfirmed > 0 && (
          <NeedsRow testId="needs-findings" title={`${formatCount(unconfirmed)} findings wait for a person`}
            detail="A confirmed finding joins the next training set; an unconfirmed one never does."
            actions={<Button size="xs" variant="secondary" onClick={() => go("environments")}>See the sources</Button>} />
        )}
        {sql && (sql.tasks ?? 0) < (sql.need ?? 1000) && (
          <NeedsRow testId="needs-sql" title="The SQL writer has nothing to learn from yet"
            detail={`${formatCount(sql.tasks ?? 0)} of ${formatCount(sql.need ?? 1000)} checked question → SQL pairs. Each 👍 on an answer whose query ran adds one.`}
            actions={<Button size="xs" variant="secondary" onClick={() => go("environments")}>How pairs are made</Button>} />
        )}
      </NeedsYou>

      <Card label="The line" right="from what the organisation settled to a model in service" testId="ai-factory-line">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          {stage("Settled sources", sourceCount == null ? "—" : formatCount(sourceCount),
            leftOut == null ? "not read" : `${formatCount(leftOut)} left out, each said why`,
            sourceCount && leftOut != null ? sourceCount / (sourceCount + leftOut) : 0)}
          {stage("Training set", view.training_set.train ? formatCount(view.training_set.train.row_count) : "—",
            view.training_set.train ? `questions · ${formatCount(view.training_set.held_out?.row_count ?? 0)} held out · v${view.training_set.train.version}` : "not built yet",
            view.training_set.train ? 1 : 0)}
          {stage("Runs", runs ? formatCount(runs.length) : "—",
            lastRun ? `the last ${RUN_WORD[lastRun.state] ?? lastRun.state}` : "none yet", runs?.length ? 1 : 0)}
          {stage("Measured", pct(best), "recall on questions never seen", best ?? 0, true)}
          {stage("In service", formatCount(inService.length), "every answer cites its source", inService.length ? 1 : 0, true)}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "0 32px" }}>
        <Card label="Models" right={<span style={NUM}>{formatCount(view.models.length)}</span>} testId="ai-factory-overview-models">
          {!view.models.length ? <Empty>No model trained yet.</Empty> : view.models.slice(0, 5).map((m, i) => (
            <div key={m.number} role="button" tabIndex={0} className="aug-fs-chrome" onClick={() => go("models", m.number)}
              onKeyDown={e => { if (e.key === "Enter") go("models", m.number); }} title={`Open model ${m.number}`}
              style={{ ...ROW, justifyContent: "space-between", padding: "7px 0", cursor: "pointer", ...(i ? RULE : {}) }}>
              <span style={{ ...ROW, gap: 10 }}>
                <span style={NUM}>Model {m.number}</span>
                <Chip tone={STATE_TONE[m.state]}>{STATE_WORD[m.state]}</Chip>
                <span style={MUTED}>{engineWord(m.engine)}</span>
              </span>
              <span style={NUM}>{pct(m.measure.before.recalled)} → <b>{pct(m.measure.after.recalled)}</b></span>
            </div>
          ))}
        </Card>
        <Card label="Latest run" right={lastRun ? relTime(lastRun.created_at) : undefined} testId="ai-factory-overview-run">
          {!lastRun ? <Empty>No run yet.</Empty> : (
            <div className="aug-fs-chrome" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span>{engineWord(lastRun.settings.engine)} · {lastRun.settings.method === "lora" ? "LoRA" : "every weight"} · {lastRun.settings.epochs} epochs · {formatCount(lastRun.rows ?? 0)} questions</span>
              <span style={{ ...ROW }}>
                <Chip tone={lastRun.state === "SUCCEEDED" ? "up" : lastRun.state === "FAILED" ? "amber" : "plain"}>{RUN_WORD[lastRun.state] ?? lastRun.state}</Chip>
                {lastRun.measures.after && <span style={NUM}>recall {pct(lastRun.measures.before?.recalled)} → {pct(lastRun.measures.after.recalled)}</span>}
                {lastRun.model != null && <Button size="xs" variant="secondary" onClick={() => go("models", lastRun.model ?? undefined)}>Open model {lastRun.model}</Button>}
              </span>
              {view.models.find(m => m.run_id === lastRun.run_id)?.seconds != null && (
                <span style={MUTED}>{minutes(view.models.find(m => m.run_id === lastRun.run_id)?.seconds)}</span>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
