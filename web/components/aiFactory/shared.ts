/**
 * The AI Factory's words and number formats, shared by its tabs (`components/aiFactory/`). One place, so a source, a
 * state or an engine is called the same thing on every tab.
 */
import type { OwnModel } from "@/lib/api";

/** What each source of a training set is called on the page. */
export const KIND_WORD: Record<string, string> = {
  metric: "Approved metrics", glossary_table: "Glossary tables", glossary_column: "Glossary columns",
  definition: "Published Definitions", finding: "Confirmed findings", trusted_query: "Trusted queries",
  unsettled_metric: "Drafts and retired metrics", unsettled_term: "Words not defined",
  unqualified: "Asked with no connection", scope: "Outside what it knows",
};
export const kindWord = (k: string) => KIND_WORD[k] ?? k;

export const STATE_TONE: Record<OwnModel["state"], "plain" | "up" | "amber"> = { draft: "plain", published: "up", archived: "amber" };
export const STATE_WORD: Record<OwnModel["state"], string> = { draft: "Draft", published: "In service", archived: "Withdrawn" };

/** A run's state as the page says it (the kernel's `JobState`). */
export const RUN_WORD: Record<string, string> = {
  PENDING: "waiting to start", RUNNING: "running", SUCCEEDED: "finished", FAILED: "failed", CANCELLED: "stopped",
  INTERRUPTED: "interrupted by a restart", PAUSED: "paused",
};
export const ACTIVE = new Set(["PENDING", "RUNNING"]);

export const ENGINE_WORD: Record<string, string> = { builtin: "Built-in", llamafactory: "LlamaFactory", trl: "TRL" };
export const engineWord = (e?: string) => ENGINE_WORD[e ?? "builtin"] ?? e ?? "Built-in";

export const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
export const f2 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));
export const mb = (b?: number | null) => (b == null ? "—" : `${Math.round(b / 1e6)} MB`);
export const gb = (b?: number | null) => (b == null || !b ? "—" : `${Math.round(b / 2 ** 30)} GB`);
export const paramsWord = (p?: number | null) => (p == null ? "—" : `${Math.round(p / 1e6)}M parameters`);
export const minutes = (s?: number | null) => (s == null ? "—" : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 6) / 10} min`);

/** The tabs, in the order the work goes. */
export type FactoryTab = "overview" | "recipes" | "environments" | "runs" | "models" | "playground";
export const FACTORY_TABS: { id: FactoryTab; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "recipes", label: "Recipes" }, { id: "environments", label: "Environments" },
  { id: "runs", label: "Runs" }, { id: "models", label: "Models" }, { id: "playground", label: "Playground" },
];
