// What a step of the work says (2026-11-18; the user: "it must ask permission explicitly for tasks that may be risky or
// critical"). A step that waits on a person's answer, or that a person turned down, was drawn in the words of the thing
// done: "Remembered for you", over an Allow once nobody had pressed. A row says a thing was done only once it was.

export const PREFIX = "mcp__pramanyx__";

/**
 * Pramanyx's other tools, in the words of what each does. A tool's wire name is `mcp__pramanyx__get_metric`; a
 * person reading the steps is told a metric's definition was read, and which. The second entry names the argument
 * that says which. A tool not listed is named from its own name, with the underscores taken out.
 */
export const DOES = {
  deep_analysis: ["Ran a deep analysis", ["question"]],
  draft_email: ["Drafted an email", ["subject", "to"]],
  schedule: ["Set up a schedule", ["request"]],
  schedule_question: ["Set a question on a schedule", ["question", "cron"]],
  search_the_web: ["Searched the web", ["query"]],
  explore: ["Explored", ["question", "topic", "focus"]],
  explain: ["Asked how an answer was reached", ["investigation_id"]],
  get_metric: ["Read the definition of the metric", ["name", "metric", "metric_name"]],
  describe_entity: ["Read the object", ["entity", "name", "entity_id"]],
  get_object: ["Read the object", ["name", "object", "object_id", "id"]],
  list_objects: ["Listed the objects", ["kind", "type"]],
  search_graph: ["Searched what is already known about", ["query", "q", "question"]],
  list_findings: ["Read earlier findings", ["query", "table"]],
  list_trusted_queries: ["Read the trusted queries", []],
  get_table_health: ["Checked the health of the table", ["table", "table_name"]],
  table_popularity: ["Read which tables are used most", []],
  list_connections: ["Listed the connections", []],
  list_platform_connections: ["Listed the connections", []],
  get_briefing: ["Read the Briefing", []],
  get_investigation: ["Read an earlier analysis", ["investigation_id", "id"]],
  list_runs: ["Listed recent runs", []],
  inspect_run: ["Looked into a run", ["trace_id"]],
  read_run_span: ["Read one step of a run", ["span_id"]],
  get_job: ["Checked on a job", ["job_id", "id"]],
  list_jobs: ["Listed the jobs", []],
  read_claims: ["Read the Record", ["subject", "kind"]],
  read_contract: ["Read the agent contract", []],
  read_restatements: ["Read what was restated", []],
  post_claim: ["Wrote a claim to the Record", ["subject", "kind"]],
  answer_accuracy: ["Read how accurate answers have been", []],
  ground_agent: ["Read what an agent rests on", ["agent", "agent_id"]],
  investigation_cadence: ["Read how often analyses run", []],
  review_missed_move: ["Reviewed a missed move", ["id"]],
  platform_audit: ["Read the audit log", []],
  platform_guide: ["Read the platform guide", ["topic"]],
  platform_limits: ["Read the platform's limits", []],
  platform_premortem: ["Read the platform's pre-mortem", []],
  platform_runs: ["Read the platform's runs", []],
  platform_traces: ["Read the platform's traces", []],
  platform_usage: ["Read usage and spend", []],
  get_definitions: ["Read what the words mean", ["term"]],
  read_learned: ["Read what is already learned", ["about"]],
  bring_in_file: ["Brought in a file", ["name"]],
  draft_definition: ["Drafted what a word means", ["term"]],
  remember_for_me: ["Remembered for you", ["text"]],
  my_memories: ["Read what you asked me to remember", []],
  forget_for_me: ["Forgot one thing you asked me to remember", []],
  deck_of_answers: ["Made a deck of answers", ["title"]],
  search_my_drive: ["Searched your Drive", ["words"]],
  cancel_job: ["Stopped the work in progress", ["job_id", "id"]],
  set_preference: ["Changed a preference", ["key", "name"]],
  draft_agent: ["Drafted a new agent", ["name"]],
  draft_automation: ["Drafted a new automation", ["name", "outcome"]],
  edit_automation: ["Changed an automation", ["name", "automation_id"]],
  draft_monitor: ["Drafted a new monitor", ["name", "metric"]],
  draft_brief: ["Drafted a new scheduled brief", ["name", "title"]],
  pause_or_resume_automation: ["Paused or resumed an automation", ["name", "automation_id"]],
  set_agent_limit: ["Changed an agent's limit", ["agent", "agent_id"]],
  propose_agent_grant: ["Proposed giving an agent more access", ["agent", "agent_id"]],
};

/**
 * The platform's abilities that STAGE a change for the person's Allow (`GET /abilities`, "staged"; 2026-11-20): each is
 * drawn as the staged change's card, where the person allows it once. `tests/unit/test_abilities.py` holds this to the
 * platform's own rows.
 */
export const STAGED = new Set([
  "draft_agent", "draft_automation", "edit_automation", "draft_monitor", "draft_brief", "pause_or_resume_automation",
  "set_agent_limit", "propose_agent_grant",
]);

/** What a tool that changes something is about to do: its words until it has done it. */
export const ABOUT_TO = {
  schedule: "Set up a schedule",
  schedule_question: "Set a question on a schedule",
  explore: "Explore",
  post_claim: "Write a claim to the Record",
  review_missed_move: "Review a missed move",
  draft_definition: "Draft what a word means",
  remember_for_me: "Remember for you",
  forget_for_me: "Forget one thing you asked me to remember",
  cancel_job: "Stop the work in progress",
  set_preference: "Change a preference",
  draft_agent: "Draft a new agent",
  draft_automation: "Draft a new automation",
  edit_automation: "Change an automation",
  draft_monitor: "Draft a new monitor",
  draft_brief: "Draft a new scheduled brief",
  pause_or_resume_automation: "Pause or resume an automation",
  set_agent_limit: "Change an agent's limit",
  propose_agent_grant: "Propose giving an agent more access",
};

/** A step in words: what it did once it has, what it is about to do until then. */
export function saidOf(toolName, args, finished = true) {
  const short = toolName.startsWith(PREFIX) ? toolName.slice(PREFIX.length) : toolName;
  const [does, whichKeys] = DOES[short] ?? [short.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), []];
  const which = whichKeys.map((key) => args[key]).find((value) => typeof value === "string" && value.trim());
  const words = finished ? does : (ABOUT_TO[short] ?? does);
  return which ? `${words}: ${which}` : words;
}

/**
 * Why a call was not carried out, when a person's answer is the reason: the harness's own sentences for each outcome,
 * and the home plugin's for a No that still stands. Anything else that failed is a failure, and is said as one.
 */
const NOT_CARRIED_OUT = [
  [/the user rejected tool/, "you said no"],
  [/The person declined this a moment ago/, "you said no"],
  [/approval for tool .* was cancelled/, "not answered"],
  [/requires approval, but no approval channel/, "could not be asked"],
  // A call the conversation's hold turned away (`home/lib/index.js` refusalFor) was never asked of the data, and one the
  // turn's stop cut off was never answered: a row in the work says so, not a "could not be answered" card among the
  // answers (2026-11-20, an FY2027 overview: four refusals and three stopped asks drew seven empty cards).
  [/This conversation is held to the connection/, "not asked here"],
  [/tool call aborted before dispatch/, "stopped before it was asked"],
  // The call in flight when a turn is stopped: the shell flattens its abort reason to "[object Object]".
  [/^(Error: )?(\[object Object\]|(The|This) operation was aborted\.?|AbortError\b.*)$/, "stopped"],
];

export function turnedDown(text) {
  const said = String(text || "");
  return NOT_CARRIED_OUT.find(([sentence]) => sentence.test(said))?.[1] ?? null;
}

/**
 * What a staging tool's result says (2026-11-20): `{staged, id, said}` — whether it staged a change, the change to draw as
 * its card, and otherwise the platform's own words without its bookkeeping. The platform's door answers `{tool, result}`
 * (`/spotlight/tools/<name>`), so the staging tool's own answer is its `result`; a result that is not JSON is said as it is.
 */
export function stagedOf(text) {
  let got = null;
  try { got = JSON.parse(String(text ?? "")); } catch { got = null; }
  if (got && typeof got.result === "object" && got.result !== null) got = got.result;
  if (got && got.staged === true && got.proposal_id) return { staged: true, id: String(got.proposal_id), said: "" };
  const said = String(got?.summary || got?.error || text || "The platform did not stage it.").replace(/\s*\(proposal [^)]*\)/g, "");
  return { staged: false, id: "", said: said.slice(0, 600) };
}
