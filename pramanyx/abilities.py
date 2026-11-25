"""ONE list of what Pramanyx's coworker can do, in either of its two places (the user, 2026-11-20: "one coworker, two
places" — the Ask panel beside the work, and the coworker app full screen — sharing abilities, approvals, conversations,
memory and trace; Stage 2 of that plan).

Each ability is a row of facts: its words (what a step of the work says it did), what it needs from an organisation's
agent policy (`read`, `run` or `act`, the levels `mcp/policy.py` gates on), whether it STAGES a change for a person's
Allow, and the places it is offered. How it is allowed is not a fact of the row: it is ONE rule, `allowed`, read by both
places — the panel and the coworker never decide it twice.

The rule:
  - a read goes ahead;
  - a change that is staged goes ahead to the staging, which changes nothing: the person allows it once, on the staged
    change's card in the conversation, line by line (the user, 2026-11-20, for the coworker too: "Staged card in chat");
  - anything else that spends or changes asks once in the conversation, unless `GOES_AHEAD_BECAUSE` says why it does not
    — a reason a reviewer can read, never a habit.

The declarations themselves (descriptions, parameters, what runs) stay where each roster keeps them; `tests/unit/
test_abilities.py` holds this list to what each place actually serves, so an ability cannot be added in one place
without a row here, nor a row claim a place that does not serve it.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Level = Literal["read", "run", "act"]
Allowed = Literal["goes_ahead", "staged", "asks_once"]

PANEL = "panel"
COWORKER = "coworker"
BOTH = frozenset({PANEL, COWORKER})
PANEL_ONLY = frozenset({PANEL})
COWORKER_ONLY = frozenset({COWORKER})


@dataclass(frozen=True)
class Ability:
    name: str
    words: str                      # what a finished step says it did
    needs: Level                    # what an organisation's agent policy must allow
    places: frozenset[str]
    stages: bool = False            # it stages a change for a person's Allow, and changes nothing itself
    which: tuple[str, ...] = ()     # the arguments that say what a step was about, in order of preference
    about_to: str = ""              # what a step that changes something says until it is done
    only_when: str = ""             # offered only in some turns: when, in words
    same_as: str = ""               # the same work as another row, declared twice today (a parity gap)


#: The runs and acts that go ahead without asking, each with why. Nothing else that spends or changes does.
GOES_AHEAD_BECAUSE: dict[str, str] = {
    "answer_question": "it answers the question the person asked",
    "ask": "it answers the question the person asked",
    "deep_analysis": "it answers the question the person asked, in depth",
    "get_briefing": "it reads the Briefing the person asked about, written once if it is not yet",
    "delegate_task": "it asks the person's own saved agent the question they asked",
    "bring_in_file": "the person attaching the file was the asking; it becomes theirs alone",
    "set_preference": "a cosmetic setting of the person's own, applied and undone the same way (ROADMAP §3.11)",
    "propose_context_note": "only a high-confidence note on one column, with its evidence, applies; anything else is staged",
    "ask_in_parallel": "it answers the questions the person's request asks, side by side, through the governed pipeline",
}

_ROWS: tuple[Ability, ...] = (
    # ── a question, answered ───────────────────────────────────────────────────────────────────────────────────────
    Ability("answer_question", "Answered through the governed pipeline", "run", PANEL_ONLY, which=("question",), same_as="ask"),
    Ability("ask", "Answered through the governed pipeline", "run", COWORKER_ONLY, which=("question",), same_as="answer_question"),
    Ability("deep_analysis", "Ran a deep analysis", "run", BOTH, which=("question",)),
    Ability("run_sql", "Ran a query through the guard battery", "read", PANEL_ONLY),
    Ability("list_tables", "Read the tables there are", "read", PANEL_ONLY),
    Ability("describe_table", "Read a table's columns", "read", PANEL_ONLY, which=("table",)),
    Ability("explore", "Explored", "run", COWORKER_ONLY, which=("question", "topic", "focus"), about_to="Explore"),
    Ability("delegate_task", "Asked a saved agent", "run", PANEL_ONLY, which=("agent", "agent_id"),
            only_when="the connection has saved agents"),
    # ── working a request of several parts (Stage 4, 2026-11-20) ──────────────────────────────────────────────────
    Ability("plan", "Planned the work", "read", PANEL_ONLY),
    Ability("ask_in_parallel", "Asked helpers side by side", "run", PANEL_ONLY, which=("questions",)),
    # ── what the platform holds ────────────────────────────────────────────────────────────────────────────────────
    Ability("list_connections", "Listed the connections", "read", COWORKER_ONLY),
    Ability("search_graph", "Searched what is already known about", "read", BOTH, which=("query", "q", "question")),
    Ability("describe_entity", "Read the object", "read", BOTH, which=("entity", "name", "entity_id")),
    # the Atlas plan's A8 (2026-11-25): the Areas of the business — the organisation's map — read by the coworker
    Ability("list_areas", "Read the Areas of the business", "read", COWORKER_ONLY),
    Ability("describe_area", "Read the Area", "read", COWORKER_ONLY, which=("area",)),
    Ability("list_objects", "Listed the objects", "read", COWORKER_ONLY, which=("kind", "type")),
    Ability("get_object", "Read the object", "read", BOTH, which=("name", "object", "object_id", "id")),
    Ability("list_findings", "Read earlier findings", "read", BOTH, which=("query", "table")),
    Ability("get_briefing", "Read the Briefing", "run", BOTH),
    Ability("get_table_health", "Checked the health of the table", "read", BOTH, which=("table", "table_name")),
    Ability("list_trusted_queries", "Read the trusted queries", "read", BOTH),
    Ability("get_investigation", "Read an earlier analysis", "read", COWORKER_ONLY, which=("investigation_id", "id")),
    Ability("get_metric", "Read the definition of the metric", "read", COWORKER_ONLY, which=("name", "metric", "metric_name")),
    Ability("get_definitions", "Read what the words mean", "read", COWORKER_ONLY, which=("term",)),
    Ability("read_learned", "Read what is already learned", "read", COWORKER_ONLY, which=("about",)),
    Ability("list_monitors", "Checked the monitors and alerts", "read", PANEL_ONLY),
    Ability("list_packs", "Checked the packs", "read", PANEL_ONLY),
    Ability("read_pack", "Read a pack", "read", PANEL_ONLY, which=("pack", "name")),
    Ability("search_documents", "Searched the documents", "read", PANEL_ONLY, which=("query",)),
    Ability("table_origin", "Read where the table came from", "read", PANEL_ONLY, which=("table",)),
    Ability("table_dependents", "Read what depends on the table", "read", PANEL_ONLY, which=("table",)),
    Ability("explain_dashboard", "Read the dashboard", "read", PANEL_ONLY),
    Ability("explain_definition", "Read a Definition", "read", PANEL_ONLY, which=("term",)),
    # ── the platform's own account of itself ───────────────────────────────────────────────────────────────────────
    Ability("platform_help", "Read the platform guide", "read", PANEL_ONLY, which=("topic",), same_as="platform_guide"),
    Ability("platform_guide", "Read the platform guide", "read", BOTH, which=("topic",)),
    Ability("explain", "Asked how an answer was reached", "read", BOTH, which=("investigation_id",)),
    Ability("list_platform_connections", "Listed the connections", "read", BOTH),
    Ability("platform_usage", "Read usage and spend", "read", BOTH),
    Ability("platform_limits", "Read the platform's limits", "read", BOTH),
    Ability("review_missed_move", "Reviewed a missed move", "read", BOTH, which=("id",), about_to="Review a missed move"),
    Ability("platform_runs", "Read the platform's runs", "read", BOTH),
    Ability("investigation_cadence", "Read how often analyses run", "read", BOTH),
    Ability("answer_accuracy", "Read how accurate answers have been", "read", BOTH),
    Ability("table_popularity", "Read which tables are used most", "read", BOTH),
    Ability("platform_traces", "Read the platform's traces", "read", BOTH),
    Ability("platform_premortem", "Read the platform's pre-mortem", "read", BOTH),
    Ability("platform_audit", "Read the audit log", "read", BOTH),
    Ability("list_jobs", "Listed the jobs", "read", COWORKER_ONLY),
    Ability("get_job", "Checked on a job", "read", COWORKER_ONLY, which=("job_id", "id")),
    Ability("list_runs", "Listed recent runs", "read", COWORKER_ONLY),
    Ability("inspect_run", "Looked into a run", "read", COWORKER_ONLY, which=("trace_id",)),
    Ability("read_run_span", "Read one step of a run", "read", COWORKER_ONLY, which=("span_id",)),
    Ability("ground_agent", "Read what an agent rests on", "read", COWORKER_ONLY, which=("agent", "agent_id")),
    Ability("read_contract", "Read the agent contract", "read", COWORKER_ONLY),
    Ability("read_claims", "Read the Record", "read", COWORKER_ONLY, which=("subject", "kind")),
    Ability("read_restatements", "Read what was restated", "read", COWORKER_ONLY),
    # ── what stays the person's ────────────────────────────────────────────────────────────────────────────────────
    Ability("search_the_web", "Searched the web", "read", COWORKER_ONLY, which=("query",)),
    Ability("search_my_drive", "Searched your Drive", "read", COWORKER_ONLY, which=("words",)),
    Ability("deck_of_answers", "Made a deck of answers", "read", COWORKER_ONLY, which=("title",)),
    Ability("draft_email", "Drafted an email", "read", COWORKER_ONLY, which=("subject", "to")),
    Ability("bring_in_file", "Brought in a file", "act", COWORKER_ONLY, which=("name",)),
    Ability("my_memories", "Read what you asked me to remember", "read", COWORKER_ONLY),
    Ability("remember_for_me", "Remembered for you", "act", COWORKER_ONLY, which=("text",), about_to="Remember for you"),
    Ability("forget_for_me", "Forgot one thing you asked me to remember", "act", COWORKER_ONLY,
            about_to="Forget one thing you asked me to remember"),
    Ability("set_preference", "Changed a preference", "act", BOTH, which=("key", "name"), about_to="Change a preference"),
    Ability("show_rows", "Put the rows on the sheet", "read", PANEL_ONLY, only_when="the question is asked beside a sheet"),
    # ── changes, each the person's to allow ────────────────────────────────────────────────────────────────────────
    Ability("change_dashboard", "Proposed a change to the dashboard", "act", PANEL_ONLY, stages=True,
            about_to="Propose a change to the dashboard", only_when="the question is about a dashboard the person keeps"),
    Ability("change_chart", "Proposed a change to how the chart is drawn", "act", PANEL_ONLY, stages=True,
            about_to="Propose a change to how the chart is drawn",
            only_when="the question is about one chart of a dashboard the person keeps"),
    Ability("make_dashboard", "Drafted a new dashboard", "act", PANEL_ONLY, stages=True, which=("about",),
            about_to="Draft a new dashboard", only_when="the person asking is known"),
    Ability("propose_action", "Proposed an action", "act", PANEL_ONLY, stages=True, which=("action_id",),
            about_to="Propose an action", only_when="the agent asking was granted named actions"),
    Ability("propose_context_note", "Wrote back what was learned about the data", "act", PANEL_ONLY,
            which=("table", "column"), about_to="Write back what was learned about the data"),
    Ability("draft_agent", "Drafted a new agent", "act", BOTH, stages=True, which=("name",), about_to="Draft a new agent"),
    Ability("draft_automation", "Drafted a new automation", "act", BOTH, stages=True, which=("name", "outcome"),
            about_to="Draft a new automation"),
    Ability("edit_automation", "Changed an automation", "act", BOTH, stages=True, which=("name", "automation_id"),
            about_to="Change an automation"),
    Ability("draft_monitor", "Drafted a new monitor", "act", BOTH, stages=True, which=("name", "metric"),
            about_to="Draft a new monitor"),
    Ability("draft_brief", "Drafted a new scheduled brief", "act", BOTH, stages=True, which=("name", "title"),
            about_to="Draft a new scheduled brief"),
    Ability("pause_or_resume_automation", "Paused or resumed an automation", "act", BOTH, stages=True,
            which=("name", "automation_id"), about_to="Pause or resume an automation"),
    Ability("set_agent_limit", "Changed an agent's limit", "act", BOTH, stages=True, which=("agent", "agent_id"),
            about_to="Change an agent's limit"),
    Ability("propose_agent_grant", "Proposed giving an agent more access", "act", BOTH, stages=True,
            which=("agent", "agent_id"), about_to="Propose giving an agent more access"),
    Ability("draft_definition", "Drafted what a word means", "act", COWORKER_ONLY, which=("term",),
            about_to="Draft what a word means"),
    Ability("schedule", "Set up a schedule", "act", COWORKER_ONLY, which=("request",), about_to="Set up a schedule"),
    Ability("cancel_job", "Stopped the work in progress", "act", COWORKER_ONLY, which=("job_id", "id"),
            about_to="Stop the work in progress"),
    Ability("post_claim", "Wrote a claim to the Record", "run", COWORKER_ONLY, which=("subject", "kind"),
            about_to="Write a claim to the Record"),
)

ABILITIES: dict[str, Ability] = {a.name: a for a in _ROWS}

#: Offered in both places but written twice — once among the panel's tools, once among the MCP server's — rather than
#: declared once and served to both, as the Spotlight roster is. Held to what is served by `tests/unit/test_abilities.py`.
DECLARED_IN_EACH_PLACE: frozenset[str] = frozenset({
    "deep_analysis", "search_graph", "describe_entity", "list_findings", "get_briefing", "get_table_health",
    "list_trusted_queries",
})

#: Abilities a place adds at start-up, by family: named by the install's own agents, automations and ontology, so they
#: have no fixed row. Each says how it is allowed, by the same rule.
FAMILIES: tuple[dict, ...] = (
    {"family": "ask_<agent>", "words": "Asked a saved agent", "needs": "run", "allowed": "goes_ahead",
     "places": [COWORKER], "why": "it asks the person's own saved agent the question they asked"},
    {"family": "an automation", "words": "Ran an automation", "needs": "act", "allowed": "asks_once",
     "places": [COWORKER], "why": "it runs what the automation does, unattended work the person did not ask for this turn"},
    {"family": "an ontology action", "words": "Proposed an action", "needs": "act", "allowed": "asks_once",
     "places": [COWORKER], "why": "a declared action of the organisation's ontology"},
)


def allowed(a: Ability) -> Allowed:
    """THE approval rule, for both places: a read goes ahead; a staged change goes ahead to its card, where the person
    allows it once; anything else that spends or changes asks once, unless a reason says it goes ahead."""
    if a.stages:
        return "staged"
    if a.needs == "read" or a.name in GOES_AHEAD_BECAUSE:
        return "goes_ahead"
    return "asks_once"


def allowed_of(name: str) -> Allowed:
    """How the ability named is allowed; an ability with no row asks once (the conservative reading of an unknown)."""
    a = ABILITIES.get(name)
    return allowed(a) if a else "asks_once"


def levels(place: str) -> dict[str, Level]:
    """What each ability offered in ``place`` needs from an organisation's agent policy."""
    return {a.name: a.needs for a in _ROWS if place in a.places}


def as_rows() -> list[dict]:
    """Every ability as a reader of `GET /abilities` takes it: the coworker's page and the panel read the same rows."""
    return [{"name": a.name, "words": a.words, "about_to": a.about_to or a.words, "which": list(a.which),
             "needs": a.needs, "allowed": allowed(a), "why": GOES_AHEAD_BECAUSE.get(a.name, ""),
             "places": sorted(a.places), "only_when": a.only_when, "same_as": a.same_as} for a in _ROWS]


def parity() -> dict:
    """Where the two places differ: what only one offers, and what both offer but declare twice."""
    only_panel = sorted(a.name for a in _ROWS if a.places == PANEL_ONLY)
    only_coworker = sorted(a.name for a in _ROWS if a.places == COWORKER_ONLY)
    return {
        "both": sorted(a.name for a in _ROWS if a.places == BOTH),
        "panel_only": only_panel,
        "coworker_only": only_coworker,
        "declared_in_each_place": sorted(DECLARED_IN_EACH_PLACE),
        "same_work_two_names": sorted({tuple(sorted((a.name, a.same_as))) for a in _ROWS if a.same_as}),
        "approval": {k: sorted(a.name for a in _ROWS if allowed(a) == k) for k in ("goes_ahead", "staged", "asks_once")},
    }


__all__ = ["ABILITIES", "BOTH", "COWORKER", "DECLARED_IN_EACH_PLACE", "FAMILIES", "GOES_AHEAD_BECAUSE", "PANEL", "Ability", "allowed",
           "allowed_of", "as_rows", "levels", "parity"]
