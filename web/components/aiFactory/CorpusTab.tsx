"use client";

/**
 * The AI Factory's Corpus tab — the training corpus, moved here from the Memory page on 2026-11-26 (the Atlas plan's A3b:
 * the corpus "moves to the AI Factory, where it is used"; the Memory row now opens the one learned list). What reviewers'
 * verdicts and the trusted queries become: each gate as a bar to its line, what is not a gate, Export now, and which
 * verdicts fed each exported version — as the Memory page drew it, nothing dropped.
 */
import React, { useCallback, useEffect, useState } from "react";

import { Bar, CARD, Chip, Empty, MUTED, NUM, Page, ROW } from "@/components/clarity/kit";
import { Button } from "@/components/ui/button";
import { Loading, ReadFailed } from "@/components/ui/states";
import {
  getLearningDataset, getLearningDatasets, runLearningExport, type LearningDatasetDetail, type LearningDatasets,
} from "@/lib/api";
import { countNoun, formatCount } from "@/lib/format";
import { dayWords } from "@/lib/home";
import { keyToWords } from "@/lib/names";

/** What each gate counts — on hover; the kind keeps the name the corpus is registered under. */
const GATE_WHAT: Record<string, string> = {
  sft: "Accepted answers to train on",
  dpo: "A rejected answer paired with its correction",
  golden: "Accepted answers held out to measure against",
  guard_days: "Days of guard data on real traffic",
};

/** The dataset each kind is exported as — `pramanyx/learning/exporters.py`'s default names. The inspector asked for the
 *  kind itself ("sft") and the registry, which keys by name ("nl2sql-sft"), never found one: every corpus read as
 *  "no exported version yet" while the gates counted its rows. Keep in step with the exporters' defaults. */
const DATASET_OF: Record<string, string> = {
  sft: "nl2sql-sft", dpo: "nl2sql-dpo", golden: "nl2sql-golden", sft_bronze: "nl2sql-bronze", dpo_repair: "nl2sql-repairs",
};

export function CorpusTab() {
  const [datasets, setDatasets] = useState<LearningDatasets | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [exporting, setExporting] = useState(false);
  // A refused export used to end the spinner and change nothing, saying nothing.
  const [exportRefused, setExportRefused] = useState<string | null>(null);
  const fetchDatasets = useCallback(() => getLearningDatasets()
    .then(d => { setDatasets(d); setState(d ? "ready" : "failed"); })
    .catch(() => setState("failed")), []);
  useEffect(() => { void fetchDatasets(); }, [fetchDatasets]);
  const exportNow = async () => {
    setExporting(true);
    setExportRefused(null);
    try {
      const out = await runLearningExport();
      setDatasets(d => ({ stats: d?.stats ?? {}, gates: out.gates }));
      setState("ready");
      const fresh = await getLearningDatasets();
      if (fresh) setDatasets(fresh);
    } catch (e) {
      setExportRefused(e instanceof Error ? e.message : "The export was refused");
    } finally { setExporting(false); }
  };
  return (
    <Page testId="factory-corpus">
      <section data-testid="memory-corpus" aria-label="Training corpus" style={{ ...CARD, padding: "16px 20px" }}>
        <div style={{ ...ROW, justifyContent: "space-between", marginBottom: 10 }}>
          <span>
            <span className="aug-fs-h2" style={{ color: "var(--t1)", fontWeight: 600 }}>Training corpus</span>
            <span className="aug-fs-xs" style={{ ...MUTED, marginLeft: 10 }}>distillation waits until every gate passes</span>
          </span>
          <Button variant="outline" size="xs" disabled={exporting} onClick={() => void exportNow()}
            title="Runs every exporter once — an unchanged corpus exports nothing new, so it is safe to press.">
            {exporting ? "Exporting…" : "Export now"}
          </Button>
        </div>
        {exportRefused && <p role="alert" className="aug-fs-xs" style={{ color: "var(--red4)", margin: "0 0 8px" }}>{exportRefused}</p>}
        {state === "loading" ? <Loading what="the training corpus" />
          : state === "failed" || !datasets ? <ReadFailed what="the training corpus" onRetry={() => { setState("loading"); void fetchDatasets(); }} />
          : <Corpus datasets={datasets} />}
      </section>
    </Page>
  );
}

// ── the training corpus: each gate as a bar to its line, then what is not a gate ─────────────────────────────────────

function Corpus({ datasets }: { datasets: LearningDatasets }) {
  const entries = Object.entries(datasets.gates);
  const gates = entries.filter(([, g]) => g.need != null);
  const tiers = entries.filter(([, g]) => g.need == null);
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(70px, auto) minmax(60px, 1fr) auto", gap: "8px 10px",
        alignItems: "center" }}>
        {gates.map(([kind, g]) => (
          <React.Fragment key={kind}>
            <span className="aug-fs-sm" title={GATE_WHAT[kind]} style={{ color: "var(--t1)" }}>{keyToWords(kind)}</span>
            <Bar value={g.have} max={g.need ?? 0} color={g.passes ? "var(--grn3)" : "var(--chart-1)"} />
            <span className="aug-fs-sm" style={{ ...ROW, gap: 6, color: "var(--t2)", ...NUM, flexWrap: "nowrap" }}>
              {formatCount(g.have)} of {formatCount(g.need)}{kind === "guard_days" ? " days" : ""}
              {g.passes && <Chip tone="up">passes</Chip>}
            </span>
          </React.Fragment>
        ))}
      </div>
      {tiers.length > 0 && (
        <div className="aug-fs-xs" style={{ ...MUTED, marginTop: 8 }}
          title={tiers[0][1].note}>
          Not gates, graded by execution or a guard: {tiers.map(([k, g]) => `${keyToWords(k)} ${formatCount(g.have)}`).join(" · ")}
        </div>
      )}
      <DatasetInspector kinds={entries.map(([k]) => k).filter(k => DATASET_OF[k])} />
    </>
  );
}


// ── which verdicts fed a corpus ──────────────────────────────────────────────────────────────────────────────────────

function DatasetInspector({ kinds }: { kinds: string[] }) {
  const [kind, setKind] = useState<string | null>(null);
  const [detail, setDetail] = useState<LearningDatasetDetail | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "missing" | "failed">("idle");
  const inspect = async (k: string) => {
    if (kind === k) { setKind(null); setDetail(null); return; }
    setKind(k); setState("loading"); setDetail(null);
    try {
      const d = await getLearningDataset(DATASET_OF[k]);
      if (!d.found) { setState("missing"); return; }
      setDetail(d);
      setState("idle");
    } catch { setState("failed"); }
  };
  if (!kinds.length) return null;
  const node = detail?.dataset ?? {};
  const lineage = detail?.lineage?.length ?? 0;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ ...ROW, gap: 6 }}>
        <span className="aug-fs-xs" style={MUTED}>Inspect a corpus:</span>
        {kinds.map(k => (
          <Button key={k} size="xs" variant={kind === k ? "secondary" : "ghost"} onClick={() => inspect(k)}>
            {keyToWords(k)}
          </Button>
        ))}
      </div>
      {kind && state === "loading" && <Loading what={`the ${keyToWords(kind)} corpus`} style={{ marginTop: 6 }} />}
      {kind && state === "failed" && <Empty>Could not read the {keyToWords(kind)} corpus.</Empty>}
      {kind && state === "missing" && (
        <Empty>No exported version of “{DATASET_OF[kind]}” yet — press Export now once the corpus has rows.</Empty>
      )}
      {kind && detail && (
        <div className="aug-fs-chrome" style={{ marginTop: 8, background: "var(--bg-1)", borderRadius: "var(--r2)", padding: 10,
          color: "var(--t2)" }} title={`id ${String(node.id ?? "")} · data ${String(node.data_id ?? "")}`}>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--t1)" }}>{String(node.name ?? DATASET_OF[kind])}</span>
          {" · "}version {String(node.version ?? "—")}
          {" · "}{countNoun(Number(node.row_count ?? 0), "example")}
          {node.created_at ? ` · exported ${dayWords(String(node.created_at))}` : ""}
          <div className="aug-fs-sm" style={{ ...MUTED, marginTop: 4 }}>
            {countNoun(lineage, "lineage record")} — the verdicts and trusted queries that fed this version.
          </div>
          {detail.note && <div className="aug-fs-sm" style={{ color: "var(--amb4)", marginTop: 4 }}>{detail.note}</div>}
        </div>
      )}
    </div>
  );
}
