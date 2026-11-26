/**
 * The context-layer evals' reads and writes (`pramanyx/evals/context_layer.py`; the Atlas plan's §7.9, decision 3):
 * cases drawn from a connection's published Definitions, approved metrics, trusted queries and corrected answers; a run
 * that answers them through the real answer path (model calls — a person's click); each case reached or not, and why.
 */
import { fastApiError } from "@/lib/api";
import { getApiBase } from "@/lib/config";

export type ContextSource = "definition" | "metric" | "trusted_query" | "corrected";

export interface ContextCase {
  id: string; question: string; source: ContextSource; name: string; ref: string;
  result: { passed: boolean; why: string } | null;
}

export interface ContextRun { id: string; status: string; started_at: string; finished_at: string | null;
  summary: { cases?: number; passed?: number; error?: string } | null }

export interface ContextEvals {
  suite: { id: string; name: string } | null;
  cases: ContextCase[];
  by_source: Record<ContextSource, number>;
  run: ContextRun | null;
}

export const CONTEXT_SOURCE_WORDS: Record<ContextSource, string> = {
  definition: "Published Definition", metric: "Approved metric", trusted_query: "Trusted query", corrected: "Corrected answer",
};

async function answer<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(fastApiError(await res.json().catch(() => ({})), `${what} failed (${res.status})`));
  return res.json();
}

export async function readContextEvals(connectionId: string): Promise<ContextEvals> {
  return answer(await fetch(`${getApiBase()}/evals/context?connection_id=${encodeURIComponent(connectionId)}`), "Reading the context evals");
}

export async function drawContextCases(connectionId: string): Promise<{ cases: number; by_source: Record<ContextSource, number>; unread: string[] }> {
  return answer(await fetch(`${getApiBase()}/evals/context/${encodeURIComponent(connectionId)}/cases`, { method: "POST" }), "Drawing the cases");
}

export async function runContextEvals(connectionId: string, limit: number): Promise<{ run_id: string }> {
  return answer(await fetch(`${getApiBase()}/evals/context/${encodeURIComponent(connectionId)}/run`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit }),
  }), "Starting the run");
}

/** The metric-views plan's M5 — the bar the metric engine meets before answers are offered its governed metric read: the
 *  connection's golden metric-by-dimension questions answered without it and with it, each graded on its reference. */
export interface MetricBarArm { passed: boolean; why: string; used_the_tool?: boolean }
export interface MetricBarVerdict {
  connection: string; cases: number; without_tool: number; with_tool: number; met: boolean; at: string;
  /** How many answers with it called it — none, and a tie says nothing of the engine (2026-11-26). */
  used?: number; why?: string;
  rows: { id: string; question: string; without: MetricBarArm; with: MetricBarArm }[];
}
export interface MetricBar {
  connection: string; questions: { id: string; question: string }[]; verdict: MetricBarVerdict | null; offered: boolean; running: boolean;
}

export async function readMetricBar(connectionId: string): Promise<MetricBar> {
  const bar: Partial<MetricBar> = await answer(await fetch(`${getApiBase()}/evals/metric-bar?connection_id=${encodeURIComponent(connectionId)}`), "Reading the metric engine's bar");
  return { connection: connectionId, offered: !!bar.offered, running: !!bar.running, questions: bar.questions ?? [], verdict: bar.verdict ?? null };
}

export async function runMetricBar(connectionId: string, limit = 30): Promise<{ started: boolean; questions: number }> {
  return answer(await fetch(`${getApiBase()}/evals/metric-bar/${encodeURIComponent(connectionId)}/run`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit }),
  }), "Starting the measurement");
}

