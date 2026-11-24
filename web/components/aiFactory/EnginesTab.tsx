"use client";

/** AI Factory ▸ Engines — what trains a model here: each engine's door (ready, needs setup with the one command, needs
 *  NVIDIA, off, under licence review), what each can do, this machine, and the base the models start from. From the
 *  engines study (`docs/AI_FACTORY_ENGINES_STUDY_2026-11-24.md`); every status is read, not written into the page. */
import { useState } from "react";

import { Card, Chip, Empty, Facts, MUTED, ROW, RULE } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { fetchOwnModelBase, type FactoryEngine } from "@/lib/api";
import { formatCount, relTime } from "@/lib/format";

import type { FactoryData } from "./AIFactoryPanel";
import { gb, mb } from "./shared";

const STATUS: Record<FactoryEngine["status"], { word: string; tone: "up" | "amber" | "violet" | "plain" }> = {
  ready: { word: "Ready here", tone: "up" }, needs_setup: { word: "Needs setup", tone: "amber" },
  unavailable: { word: "Needs NVIDIA GPUs", tone: "violet" }, not_offered: { word: "Not offered yet", tone: "plain" },
  off: { word: "Off", tone: "plain" }, review: { word: "Licence review first", tone: "amber" },
};

const ROWS: [string, string][] = [
  ["example", "Teach by example"], ["preference", "Teach by preference"], ["reward", "Teach by reward"],
  ["pretrain", "Continued pre-training"], ["merge", "For serving"], ["bases", "Bases it knows"],
  ["licence", "Licence"], ["telemetry", "Sends anything out"],
];

export function EnginesTab({ data, onChanged }: { data: FactoryData; onChanged: () => void }) {
  const e = data.engines;
  if (!e) return <Empty>The engines could not be read.</Empty>;
  const hw = e.hardware;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }} data-testid="ai-factory-engines">
        {e.engines.map(d => (
          <div key={d.id} data-testid={`engine-${d.id}`} style={{ background: "var(--bg-2)", border: "1px solid var(--card-edge)",
            borderRadius: "var(--r3)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <div style={{ ...ROW, justifyContent: "space-between" }}>
              <span><b>{d.name}</b>{d.version ? <span style={MUTED}> {d.version}</span> : null}</span>
              <Chip tone={STATUS[d.status].tone}>{STATUS[d.status].word}</Chip>
            </div>
            <div className="aug-fs-chrome" style={{ color: "var(--t2)" }}>{d.summary}</div>
            {d.why && <div className="aug-fs-sm" style={{ color: d.status === "review" || d.status === "needs_setup" ? "var(--amb4)" : "var(--t3)" }}>{d.why}</div>}
            {d.how && <div className="aug-fs-xs mono" style={{ ...MUTED, wordBreak: "break-word" }}>{d.how}</div>}
          </div>
        ))}
      </div>

      <Card label="What each can do" testId="ai-factory-capabilities">
        <div style={{ overflowX: "auto" }}>
          <div role="table" aria-label="What each engine can do" style={{ minWidth: 900 }}>
            <div role="row" className="aug-fs-xs" style={{ ...grid(e.engines.length), ...MUTED, paddingBottom: 4 }}>
              <span>Capability</span>{e.engines.map(d => <span key={d.id}>{d.name}</span>)}
            </div>
            {ROWS.map(([key, word]) => (
              <div key={key} role="row" className="aug-fs-chrome" style={{ ...grid(e.engines.length), padding: "6px 0", ...RULE }}>
                <span>{word}</span>
                {e.engines.map(d => {
                  const v = e.capabilities[d.id]?.[key] ?? "—";
                  return <span key={d.id} style={{ color: v === "—" ? "var(--t3)" : "var(--t2)" }}>{v}</span>;
                })}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "0 32px" }}>
        <Card label="Where runs happen" testId="ai-factory-where">
          <Facts rows={[
            ["This machine", `${hw.accelerator} · ${gb(hw.memory_bytes)} memory`],
            ["Rented GPU", "not offered — the training set would leave the install"],
            ["Hosted service", "not offered — the tasks and the data would leave the install"],
          ]} />
        </Card>
        <BaseCard data={data} onChanged={onChanged} />
      </div>
    </>
  );
}

const grid = (n: number): React.CSSProperties => ({ display: "grid", gridTemplateColumns: `minmax(160px, 1fr) repeat(${n}, minmax(120px, 1fr))`, gap: 12 });

function BaseCard({ data, onChanged }: { data: FactoryData; onChanged: () => void }) {
  const view = data.view;
  const b = view.base;
  const [source, setSource] = useState(b?.source ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Card label="The base models start from" right={b?.present ? <Chip tone="up">Fetched</Chip> : b ? <Chip tone="amber">Its folder is gone</Chip> : <Chip>None yet</Chip>} testId="ai-factory-base">
      <div className="aug-fs-sm" style={{ ...MUTED, marginBottom: 8 }}>
        A small pretrained model that already reads and writes. Name a Hugging Face repository (owner/name) or a folder on this machine; only safetensors weights are fetched.
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
        <Input value={source} onChange={ev => setSource(ev.target.value)} placeholder="owner/name, or /path/to/a/model"
          style={{ flex: "1 1 260px", maxWidth: 460 }} aria-label="The base to fetch" />
        <Button size="sm" variant={b?.present ? "secondary" : "default"} disabled={busy || !source.trim() || !view.allowed}
          onClick={async () => {
            setBusy(true);
            try { await fetchOwnModelBase(source.trim()); toast.info("The base is fetched"); onChanged(); }
            catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
            finally { setBusy(false); }
          }}>{busy ? "Fetching…" : b?.present ? "Fetch another" : "Fetch"}</Button>
      </div>
    </Card>
  );
}
