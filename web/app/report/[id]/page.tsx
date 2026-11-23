"use client";

/**
 * `/report/<run id>`: a deep analysis's report, drawn by the platform's one report view — the page the coworker
 * opens beside its conversation for a deep answer (the user, 2026-11-23: "the output format, the methodology and user
 * experience has to be the same across the harness (coworker), Data canvas and the Ask on the right panel"). Before, the
 * coworker drew a deep analysis as a step row of raw JSON while the Ask panel and a Data Canvas drew the report. As with
 * `/chart/<id>`, the coworker keeps one drawing of an answer — the platform's — rather than a second of its own.
 *
 * Each exhibit's source opens over the page, as it opens beside an answer in the Ask panel.
 */
import { use, useEffect, useState } from "react";

import { SourcePanel } from "@/components/ChatMessage";
import { InvestigationReportView, type AnswerReport } from "@/components/InvestigationReport";
import { readStoredRun } from "@/lib/api";
import { installAuthFetch } from "@/lib/auth";
import { getApiBase } from "@/lib/config";

// Opened in a frame beside the coworker, where the workbench never installed the authenticated fetch (as /receipt/<id>).
if (typeof window !== "undefined") installAuthFetch(getApiBase());

function segment(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** One exhibit's source, as the report hands it over. */
type Source = { columns: string[]; rows: unknown[][]; sql: string | null; title: string };

type Read =
  | { state: "reading" }
  | { state: "report"; report: AnswerReport; question: string; connectionId: string }
  | { state: "said"; question: string; text: string }
  | { state: "none"; text: string };

export default function ReportRoute({ params }: { params: Promise<{ id: string }> }) {
  const id = segment(use(params).id);
  const [read, setRead] = useState<Read>({ state: "reading" });
  const [source, setSource] = useState<Source | null>(null);

  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const { status, body } = await readStoredRun(id);
        if (!body) {
          if (!gone) setRead({ state: "none", text: status === 404 ? "There is no analysis with this id." : `The platform said ${status}.` });
          return;
        }
        const report = body.report as { phases?: unknown; headline?: unknown } | null | undefined;
        const question = String(body?.question ?? "");
        const connectionId = String(body?.connection_id ?? "");
        if (gone) return;
        if (report && Array.isArray(report.phases)) setRead({ state: "report", report: report as AnswerReport, question, connectionId });
        else if (report?.headline) setRead({ state: "said", question, text: String(report.headline) });
        else setRead({ state: "none", text: body?.status === "running" ? "This analysis is still running." : "This analysis stored no report." });
      } catch {
        if (!gone) setRead({ state: "none", text: "The platform is not answering." });
      }
    })();
    return () => { gone = true; };
  }, [id]);

  return (
    <main data-testid="report-page" className="aug-page-surface"
      style={{ minHeight: "100vh", position: "relative", background: "var(--bg-1)", color: "var(--t1)" }}>
      <div style={{ padding: "20px 24px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
        {read.state === "reading" && <p className="aug-fs-sm" style={{ color: "var(--t3)" }}>Reading the report…</p>}
        {read.state === "none" && <p className="aug-fs-sm" style={{ color: "var(--t2)" }}>{read.text}</p>}
        {(read.state === "report" || read.state === "said") && read.question && (
          <p className="aug-fs-xs" style={{ color: "var(--t3)", margin: 0 }}>{read.question}</p>
        )}
        {read.state === "said" && <p className="aug-fs-sm" style={{ margin: 0 }}>{read.text}</p>}
        {read.state === "report" && <InvestigationReportView report={read.report} onShowSource={setSource} />}
      </div>
      {source && read.state === "report" && (
        <div style={{ position: "fixed", inset: 0, zIndex: 30, background: "var(--blue1)", display: "flex", flexDirection: "column" }}>
          <SourcePanel columns={source.columns} rows={source.rows} sql={source.sql} title={source.title}
            connectionId={read.connectionId} onClose={() => setSource(null)} />
        </div>
      )}
    </main>
  );
}
