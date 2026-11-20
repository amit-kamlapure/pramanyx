"use client";

/**
 * `/chart/<answer id>`: one answer's chart and THE chart editor, docked under it — the page the coworker opens beside its
 * conversation for "Edit visualization" (the user, 2026-11-20: "why do we three distinct type of viz editors???????? Canvas,
 * Dashboard and harness.. all have different", "Dashboard has the best one"). The editor is the platform's one
 * (`ResultChartCard` over `queryEditorModel`, the dashboard's), working on the answer's own rows, as an answer's chart does
 * everywhere: nothing is asked of the warehouse again.
 *
 * A person's choices are kept by the platform in the card-less chart store (`/viz-configs`, scope "coworker", the answer's
 * id), and the coworker's answer card reads them back to draw its chart the same way. Each save is told to the window that
 * opened this page, so the coworker redraws at once.
 */
import { use, useEffect, useRef, useState } from "react";

import { ResultChartCard } from "@/components/charts/ResultChartCard";
import type { VizConfig } from "@/components/charts/vizConfig";
import { ChartDock } from "@/components/dashboards/CardInspector";
import { getVizConfigs, saveVizConfig } from "@/lib/api";
import { installAuthFetch } from "@/lib/auth";
import { getApiBase } from "@/lib/config";

// Opened in a frame beside the coworker, where the workbench never installed the authenticated fetch (as /receipt/<id>).
if (typeof window !== "undefined") installAuthFetch(getApiBase());

/** The store's scope for the coworker's answers; the answer card reads the same (`coworker/plugins/answer-card`). */
const COWORKER_SCOPE = "coworker";
/** What the page posts to the window that opened it after each save. */
const SAVED_MESSAGE = "pramanyx:chart-saved";
const WAIT_MS = 400;

interface Answer { headline: string; columns: string[]; rows: unknown[][]; chartType: string | null }

/** An answer's chart as the platform stored it: the report of its run. */
async function readAnswer(id: string): Promise<Answer | null> {
  const res = await fetch(`${getApiBase()}/investigations/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const body = await res.json();
  const report = body?.report ?? {};
  const columns = Array.isArray(report.columns) ? report.columns.map(String) : [];
  const rows = Array.isArray(report.rows) ? report.rows : [];
  return { headline: String(report.headline || body?.headline || ""), columns, rows, chartType: report.chart_type ?? null };
}

function segment(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export default function ChartRoute({ params }: { params: Promise<{ id: string }> }) {
  const id = segment(use(params).id);
  const [answer, setAnswer] = useState<Answer | null | undefined>(undefined);
  const [config, setConfig] = useState<VizConfig | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([readAnswer(id), getVizConfigs(COWORKER_SCOPE)])
      .then(([a, kept]) => { if (live) { setAnswer(a); setConfig((kept[id] as VizConfig | undefined) ?? null); } })
      .catch(() => { if (live) { setAnswer(null); setConfig(null); } });
    return () => { live = false; if (timer.current) clearTimeout(timer.current); };
  }, [id]);

  const keep = (next: VizConfig) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void saveVizConfig(COWORKER_SCOPE, id, next as Record<string, unknown>).then(() => {
        try { window.parent?.postMessage({ type: SAVED_MESSAGE, id }, "*"); } catch { /* not in a frame */ }
      });
    }, WAIT_MS);
  };

  const page = { padding: "16px 18px", display: "flex", flexDirection: "column" as const, gap: 14, minHeight: "100vh",
    background: "var(--bg-0)", color: "var(--t1)" };
  if (answer === undefined || config === undefined) {
    return <div className="aug-fs-sm" style={{ ...page, color: "var(--t3)" }}>Reading the answer…</div>;
  }
  if (!answer || !answer.columns.length) {
    return <div className="aug-fs-sm" data-testid="chart-page-none" style={{ ...page, color: "var(--t3)" }}>
      This answer has no rows to chart{answer ? "" : ", or it could not be read"}.
    </div>;
  }
  const key = `answer-${id}`;
  return (
    <div data-testid="chart-page" style={page}>
      {answer.headline && <div className="aug-fs-h2" style={{ fontWeight: 600 }}>{answer.headline.split("\n")[0].replace(/\*\*/g, "")}</div>}
      <ResultChartCard columns={answer.columns} rows={answer.rows} chartType={answer.chartType} editorKey={key} pencil={false}
        config={config} onConfigChange={keep} />
      <ChartDock cardKey={key} charted />
    </div>
  );
}
