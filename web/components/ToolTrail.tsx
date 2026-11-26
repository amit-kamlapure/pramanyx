"use client";
/**
 * CI-6a — the converse body's tool trail, rendered as Chain-of-Thought steps.
 *
 * Each step is one tool the model CHOSE on this turn — a query run, a findings
 * lookup, the briefing read, a deep analysis launched. The trail is what makes the
 * conversation's texture visible: without it a converse turn reads as silence
 * followed by an answer, which is exactly the mechanical feel CI-0 measured.
 *
 * Mirrors GuardReceiptChain deliberately: same organ (the vendored ChainOfThought),
 * same "renders nothing when empty" contract, same label philosophy — the backend
 * names the mechanism, the surface names what the reader gains, and an unknown tool
 * falls back to its raw id so a new roster entry is visible before this map learns
 * its nice name.
 */
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import type { ConverseStep } from "@/lib/chatTurn";

/** Each step in words, per ability: the platform's one list (`pramanyx/abilities.py`, 2026-11-20), which the coworker's
 *  steps say too; `tests/unit/test_abilities.py` holds this to it. */
const TOOL_LABEL: Record<string, string> = {
  answer_question: "Answered through the governed pipeline",
  deep_analysis: "Ran a deep analysis",
  run_sql: "Ran a query through the guard battery",
  query_metric: "Read a governed metric, grouped",
  list_tables: "Read the tables there are",
  describe_table: "Read a table's columns",
  delegate_task: "Asked a saved agent",
  plan: "Planned the work",
  ask_in_parallel: "Asked helpers side by side",
  search_graph: "Searched what is already known about",
  describe_entity: "Read the object",
  list_areas: "Read the Areas of the business",
  describe_area: "Read the Area",
  get_object: "Read the object",
  list_findings: "Read earlier findings",
  get_briefing: "Read the Briefing",
  get_table_health: "Checked the health of the table",
  list_trusted_queries: "Read the trusted queries",
  list_monitors: "Checked the monitors and alerts",
  list_packs: "Checked the packs",
  read_pack: "Read a pack",
  search_documents: "Searched the documents",
  table_origin: "Read where the table came from",
  table_dependents: "Read what depends on the table",
  explain_dashboard: "Read the dashboard",
  explain_definition: "Read a Definition",
  platform_help: "Read the platform guide",
  platform_guide: "Read the platform guide",
  explain: "Asked how an answer was reached",
  list_platform_connections: "Listed the connections",
  platform_usage: "Read usage and spend",
  platform_limits: "Read the platform's limits",
  review_missed_move: "Reviewed a missed move",
  platform_runs: "Read the platform's runs",
  investigation_cadence: "Read how often analyses run",
  answer_accuracy: "Read how accurate answers have been",
  table_popularity: "Read which tables are used most",
  platform_traces: "Read the platform's traces",
  platform_premortem: "Read the platform's pre-mortem",
  platform_audit: "Read the audit log",
  set_preference: "Changed a preference",
  show_rows: "Put the rows on the sheet",
  change_dashboard: "Proposed a change to the dashboard",
  change_chart: "Proposed a change to how the chart is drawn",
  make_dashboard: "Drafted a new dashboard",
  propose_action: "Proposed an action",
  propose_context_note: "Wrote back what was learned about the data",
  draft_agent: "Drafted a new agent",
  draft_automation: "Drafted a new automation",
  edit_automation: "Changed an automation",
  draft_monitor: "Drafted a new monitor",
  draft_brief: "Drafted a new scheduled brief",
  pause_or_resume_automation: "Paused or resumed an automation",
  set_agent_limit: "Changed an agent's limit",
  propose_agent_grant: "Proposed giving an agent more access",
};

function truncate(s: string, n = 110): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function ToolTrail({
  steps,
  streaming = false,
}: {
  steps: ConverseStep[];
  streaming?: boolean;
}) {
  if (!steps.length) return null;
  return (
    <ChainOfThought defaultOpen={false} className="my-1">
      <ChainOfThoughtHeader streaming={streaming}>
        {steps.length === 1 ? "1 step taken" : `${steps.length} steps taken`}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {steps.map((s, i) => (
          <ChainOfThoughtStep
            key={`${s.tool}-${s.index}-${i}`}
            label={TOOL_LABEL[s.tool] ?? s.tool}
            description={
              s.refused
                ? `said no — ${truncate(s.detail)}`
                : s.ok
                  ? (s.detail ? truncate(s.detail) : undefined)
                  : `failed${s.detail ? ` — ${truncate(s.detail)}` : ""} (the model saw this and can recover)`
            }
            status="complete"
            icon={
              s.ok && !s.refused ? undefined : (
                <span
                  data-testid={s.refused ? "step-refused" : "step-failed"}
                  className="block h-1.5 w-1.5 rounded-[var(--r-pill)]"
                  style={{ background: s.refused ? "var(--amb4)" : "var(--red4)" }}
                />
              )
            }
          />
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}
