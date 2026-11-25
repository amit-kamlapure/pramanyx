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
