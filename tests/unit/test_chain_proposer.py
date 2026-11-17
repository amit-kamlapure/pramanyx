"""DS-15 — conversation authors the canvas, and the canvas still refuses a bad chain.

The wave's shape is the one every governed write here already has: the model DRAFTS, the
same validators a save runs refuse a draft that could not be saved, a dry run shows what
it would do, and a human arms it. A grant is permission to propose.

Every test injects its provider. This repo has already paid once for a suite that reached
a live model, so the rule is structural rather than remembered: `propose_chain` takes the
provider as an argument and the default is only resolved when nobody passed one.

What is pinned:

* **The prompt carries THIS deployment's truth** — the palette's own verdict on what is
  placeable and why, and the real ids. A model never shown a bot it cannot post as cannot
  propose posting as one.
* **A draft that would not save is not drawn.** Constructing the `Automation` runs every
  model validator and `validate_chain`; the refusal comes back with the reason.
* **It fails CLOSED.** `actions/propose.py` fails open to `[]` because it garnishes an
  answer somebody already asked for; here the proposal IS the request, so a silent empty
  would be answering "nothing" to "build me a chain".
* **Nothing is saved.** The one thing this module must never learn to do.
"""
from __future__ import annotations

import pytest

from pramanyx.automations.propose import ProposedChain, propose_chain
from pramanyx.automations.store import list_automations

CONN = "ds15"


class _Provider:
    """A stand-in for the LLM. Records the prompt, returns a scripted draft."""

    def __init__(self, draft=None, boom: bool = False):
        self.draft, self.boom = draft, boom
        self.system = ""
        self.user = ""

    def complete(self, *, system, user, response_model, temperature=0.0):
        self.system, self.user = system, user
        if self.boom:
            raise RuntimeError("model unreachable")
        return self.draft


def _chain(**kw) -> ProposedChain:
    base = dict(
        name="Monday pipeline summary",
        description="posts a summary on Mondays",
        conditions=[{"kind": "schedule", "config": {"cron": "0 9 * * 1"}}],
        effects=[{"kind": "investigate", "alias": "numbers",
                  "config": {"question": "how is the pipeline?"}}],
    )
    base.update(kw)
    return ProposedChain(**base)


@pytest.fixture(autouse=True)
def _no_leftovers():
    """The automations store is session-scoped. Nothing here should save — and this
    fixture is also how the "nothing is saved" test can trust its own count."""
    from pramanyx.automations.store import delete_automation
    for a in list_automations(conn_id=CONN):
        delete_automation(a.id)
    yield
    for a in list_automations(conn_id=CONN):
        delete_automation(a.id)


# ── the proposal ──────────────────────────────────────────────────────────────

def test_a_described_outcome_becomes_an_editable_chain_with_a_receipt():
    p = _Provider(_chain())
    out = propose_chain("post a Monday pipeline summary", conn_id=CONN, provider=p)
    assert out.verdict == "proposed"
    assert out.draft["name"] == "Monday pipeline summary"
    assert out.draft["conn_id"] == CONN
    assert out.draft["effects"][0]["kind"] == "investigate"
    # The receipt: a dry run of the DRAFT, not of anything stored.
    assert out.dry_run.get("outcome") in {"fired", "not_fired", "gated"}
    assert p.user == "post a Monday pipeline summary"


def test_nothing_is_saved():
    """The one thing this module must never learn to do."""
    before = len(list_automations(conn_id=CONN))
    propose_chain("anything at all", conn_id=CONN, provider=_Provider(_chain()))
    assert len(list_automations(conn_id=CONN)) == before


def test_the_draft_carries_no_armed_state():
    """A proposal that arrived already enabled — or already exposed as an MCP tool — would
    have made the decision the human is being asked to make."""
    out = propose_chain("x", conn_id=CONN, provider=_Provider(_chain()))
    assert "enabled" not in out.draft
    assert "exposed_as_tool" not in out.draft
    assert "id" not in out.draft


# ── refusals, all of them closed ──────────────────────────────────────────────

def test_a_draft_that_would_not_save_is_refused_rather_than_drawn():
    """A canvas showing a chain the Save button will reject is worse than a refusal: it
    looks like work that is nearly done. `notify` requires its trigger.

    A Slack channel is no longer the example: since SP-7 a channel the request did not name
    is the PERSON's choice, left open in the draft and refused at Accept instead
    (`test_sp7_honest_drafts.py`). Every other missing key still refuses here."""
    bad = _chain(effects=[{"kind": "notify", "config": {}}])
    out = propose_chain("tell the team", conn_id=CONN, provider=_Provider(bad))
    assert out.verdict == "refused"
    assert "trigger_id" in out.reason


def test_an_invented_effect_kind_is_refused():
    bad = _chain(effects=[{"kind": "send_carrier_pigeon", "config": {}}])
    out = propose_chain("mail it", conn_id=CONN, provider=_Provider(bad))
    assert out.verdict == "refused"


def test_a_binding_onto_a_step_that_does_not_exist_is_refused():
    """`validate_chain` is the same refusal a save performs — the proposer gets it for
    free by constructing the real model rather than a look-alike."""
    bad = _chain(effects=[
        {"kind": "investigate", "alias": "one", "config": {"question": "q"}},
        {"kind": "notify", "config": {"trigger_id": "t1",
                                      "message": {"$from": "ghost.answer"}}},
    ])
    out = propose_chain("chain them", conn_id=CONN, provider=_Provider(bad))
    assert out.verdict == "refused"
    assert "ghost" in out.reason


def test_an_empty_draft_comes_back_as_a_refusal_carrying_the_models_reason():
    """The model is asked to say what it could not do. A partial chain that silently drops
    half the request is worse, because a person reading a drawn canvas cannot see an
    absence."""
    out = propose_chain("do the impossible", conn_id=CONN,
                        provider=_Provider(_chain(effects=[], notes="no Slack bot exists here")))
    assert out.verdict == "refused"
    assert out.reason == "no Slack bot exists here"


def test_a_dead_model_fails_CLOSED_with_a_reason():
    """`actions/propose.py` fails open to [] because it garnishes an answer somebody
    already asked for. Here the proposal IS the request."""
    out = propose_chain("anything", conn_id=CONN, provider=_Provider(boom=True))
    assert out.verdict == "refused"
    assert "model unreachable" in out.reason


def test_an_empty_outcome_never_reaches_the_model():
    p = _Provider(_chain())
    out = propose_chain("   ", conn_id=CONN, provider=p)
    assert out.verdict == "refused"
    assert p.system == "", "an empty request must not spend a token"


# ── the binding the live model got wrong ──────────────────────────────────────

def test_a_binding_written_as_a_STRING_is_repaired():
    """Found by driving it live, not by a test — which is the point of driving it.

    The model returned `"{\"$from\": \"step.key\"}"`: a string holding the JSON of a
    binding. Nothing refused it, because a string is a legal literal — the chain
    validated, the dry run was clean, and it would have posted those characters to Slack.
    """
    draft = _chain(effects=[
        {"kind": "investigate", "alias": "summary", "config": {"question": "how are sales?"}},
        {"kind": "notify", "config": {"trigger_id": "t1",
                                      "message": '{"$from": "summary.answer"}'}},
    ])
    out = propose_chain("summarise and tell someone", conn_id=CONN,
                        provider=_Provider(draft))
    assert out.verdict == "proposed", out.reason
    assert out.draft["effects"][1]["config"]["message"] == {"$from": "summary.answer"}


def test_a_binding_EMBEDDED_in_a_sentence_is_left_alone():
    """Deliberately not repaired. The engine cannot interpolate a binding into prose, so
    guessing what the author meant would swap a visible mistake for an invisible one — the
    step still reads as a literal, and a person can see that it does."""
    draft = _chain(effects=[
        {"kind": "investigate", "alias": "summary", "config": {"question": "q"}},
        {"kind": "notify", "config": {
            "trigger_id": "t1",
            "message": 'revenue is {"$from": "summary.answer"} today'}},
    ])
    out = propose_chain("x", conn_id=CONN, provider=_Provider(draft))
    assert out.draft["effects"][1]["config"]["message"] == \
        'revenue is {"$from": "summary.answer"} today'


def test_an_ordinary_string_that_merely_starts_with_a_brace_survives():
    """The repair matches an EXACT single-key `$from` object and nothing else."""
    draft = _chain(effects=[{"kind": "investigate",
                             "config": {"question": '{"not": "a binding"}'}}])
    out = propose_chain("x", conn_id=CONN, provider=_Provider(draft))
    assert out.draft["effects"][0]["config"]["question"] == '{"not": "a binding"}'


def test_the_prompt_shows_what_a_bound_field_looks_like():
    """The repair is a net, not a fix. The prompt now carries the correct and incorrect
    shapes side by side, because a model that never writes the bug needs no net."""
    p = _Provider(_chain())
    propose_chain("x", conn_id=CONN, provider=p)
    assert "never text inside a string" in p.system
    assert "posts the literal characters" in p.system


# ── what the model is told ────────────────────────────────────────────────────

def test_the_prompt_carries_this_deployments_own_verdict_on_each_kind():
    """Built from the SAME palette the canvas reads, so the prompt cannot drift from what
    the save enforces. A hand-written kind list in a prompt rots in the worst direction:
    it offers something the code refuses."""
    p = _Provider(_chain())
    propose_chain("x", conn_id=CONN, provider=p)
    assert "AVAILABLE TRIGGERS AND STEPS" in p.system
    assert "investigate" in p.system and "Requires: question" in p.system
    # An unavailable kind is named as unavailable WITH the palette's reason, so the model
    # is told why rather than simply not offered it.
    assert "UNAVAILABLE" in p.system


def test_the_prompt_forbids_inventing_an_id_and_lists_the_real_ones():
    p = _Provider(_chain())
    propose_chain("x", conn_id=CONN, provider=p)
    assert "never invent an id" in p.system
    assert "SLACK BOTS" in p.system


def test_a_list_publishing_key_is_marked_as_one():
    """DS-12 gave this plane its first declared list. The proposer has to know which key a
    `for_each` may fan over, or it will propose fanning over a string.

    The condition is MADE, not scanned for. The first version of this test asked "if
    trusted_query appears, assert the marker" — which passes on a deployment with no
    trusted queries by never asserting anything, and that is the vacuous shape this repo
    has a standing lesson about. Seeding one makes the kind available, which is the only
    state in which the marker should appear at all.
    """
    from pramanyx.semantic import trusted_queries as tq

    tq.save_trusted(tq.TrustedQuery(id="tq_ds15", connection_id=CONN,
                                    question="which accounts churned?",
                                    sql="SELECT 1", tables=[], status="approved"))
    try:
        p = _Provider(_chain())
        propose_chain("x", conn_id=CONN, provider=p)
        assert "trusted_query" in p.system
        assert "(a list: rows)" in p.system, p.system
    finally:
        tq.delete_trusted("tq_ds15")


def test_an_unavailable_kind_is_named_as_unavailable_and_not_offered_ports():
    """The other half: a kind whose object does not exist here is listed with the
    palette's reason and WITHOUT its ports, so the model is told why rather than tempted.

    ⚠️ Subject changed 2026-09-19 (DS-19). This test used to read `trusted_query`, which
    was the clearest example of a gated kind — until that step became authorable, and a
    kind that can carry SQL a person types needs nothing to exist before it works. It is
    now always ready, deliberately (`palette.py`), so it is no longer an example of
    anything this test is about. The PROPERTY is unchanged and still worth pinning, so it
    moved to `mcp_call`, whose allowlist genuinely is its off state.
    """
    p = _Provider(_chain())
    propose_chain("x", conn_id=CONN, provider=p)
    line = next(ln for ln in p.system.splitlines() if ln.startswith("- mcp_call"))
    assert "UNAVAILABLE" in line
    assert "Publishes:" not in line


def test_an_authorable_kind_is_offered_even_with_an_empty_catalogue():
    """DS-19's other side, pinned here so the change above cannot be read as a loosening:
    `trusted_query` is offered WITH its ports on a connection holding no trusted query at
    all, because a person can write one on the node."""
    p = _Provider(_chain())
    propose_chain("x", conn_id=CONN, provider=p)
    line = next(ln for ln in p.system.splitlines() if ln.startswith("- trusted_query"))
    assert "UNAVAILABLE" not in line
    assert "(a list: rows)" in line


# ── 2026-11-16: a sentence is the way to schedule anything ───────────────────────────────────────────────────────────

def test_the_designer_is_told_the_time_in_the_persons_clock_so_in_five_minutes_can_be_drawn():
    """The user, after the agent shell's scheduler took "deliver me AI news in the next 5 minutes here": the
    designer was never told the time, so it could draft only a rhythm."""
    once = "DTSTART:20991116T115800\nRRULE:FREQ=DAILY;COUNT=1"
    p = _Provider(_chain(conditions=[{"kind": "schedule", "config": {"cron": once}}]))
    out = propose_chain("in five minutes, how is the pipeline?", conn_id=CONN, provider=p, timezone_name="Asia/Kolkata")
    assert "NOW: " in p.system and "in Asia/Kolkata" in p.system and "Write every time in Asia/Kolkata" in p.system
    assert "COUNT=1" in p.system                                  # it is taught how to say once
    assert out.verdict == "proposed" and out.draft["timezone"] == "Asia/Kolkata"
    assert out.draft["conditions"][0]["config"]["cron"] == once
    assert out.first_run.startswith("2099-11-16T06:28")           # 11:58 in Kolkata, as the scheduler reads it


def test_a_sentences_times_are_read_in_the_zone_named_then_the_persons_then_where_they_are_then_the_orgs(monkeypatch):
    """The user, 2026-11-16 ("Yes, my clock"): a draft on the Automations page read "9 in the morning" as 09:00 UTC,
    because neither the person nor the organisation had set a clock — though the browser knew it."""
    import pramanyx.db.user_prefs as prefs
    import pramanyx.orgsettings.store as org
    from pramanyx.automations.propose import the_clock
    mine, ours = {"tz": ""}, {"tz": ""}
    monkeypatch.setattr(prefs, "preferred_timezone", lambda: mine["tz"])
    monkeypatch.setattr(org, "load_org_settings", lambda: type("S", (), {"timezone": ours["tz"]})())
    assert the_clock() == ""                                                   # nothing known: UTC
    ours["tz"] = "Europe/Berlin"
    assert the_clock() == "Europe/Berlin"
    assert the_clock(here="Asia/Kolkata") == "Asia/Kolkata"                    # where they are, before the org's
    mine["tz"] = "America/New_York"
    assert the_clock(here="Asia/Kolkata") == "America/New_York"                # their own choice, before the browser
    assert the_clock("Europe/London", "Asia/Kolkata") == "Europe/London"       # a zone they named, before all
    assert the_clock("Mars/Olympus", "Asia/Kolkata") == "America/New_York"     # one nobody can read is passed over
    p = _Provider(_chain())
    mine["tz"] = ""
    out = propose_chain("every day at nine, how is the pipeline", conn_id=CONN, provider=p, clock_here="Asia/Kolkata")
    assert "Write every time in Asia/Kolkata" in p.system and out.draft["timezone"] == "Asia/Kolkata"


def test_a_request_from_a_conversation_needs_no_sending_step_for_here():
    p = _Provider(_chain())
    propose_chain("every Monday, how is the pipeline — here", conn_id=CONN, provider=p, from_conversation=True)
    assert "THE PERSON ASKED IN A CONVERSATION" in p.system and "need no sending step" in p.system
    p = _Provider(_chain())
    propose_chain("every Monday, how is the pipeline", conn_id=CONN, provider=p)
    assert "THE PERSON ASKED IN A CONVERSATION" not in p.system   # the Automations page's box is not a conversation


def test_a_recurrence_the_designer_writes_wrongly_is_refused_like_any_unsaveable_draft():
    p = _Provider(_chain(conditions=[{"kind": "schedule", "config": {"cron": "DTSTART:20991116T090000\nRRULE:FREQ=SECONDLY"}}]))
    out = propose_chain("every second", conn_id=CONN, provider=p)
    assert out.verdict == "refused" and "FREQ must be one of" in out.reason


def test_the_designer_writes_a_question_as_asked_never_how_to_report_it():
    """The user, 2026-11-16, of a scheduled answer that opened on "order_items.sale_price joined to products.category…":
    the designer had written into the question "State the date range and source you used", and the answer obeyed."""
    p = _Provider(_chain())
    propose_chain("every Monday, top 5 categories by revenue", conn_id=CONN, provider=p)
    assert "Never tell the analysis\nhow to report" in p.system and "state the date range or source you used" in p.system
    # Found beside the agent shell's own scheduler, which kept "yesterday" relative to each run: the designer had
    # written "For yesterday (2026-11-15, …)" — right once, wrong every morning after for a daily schedule.
    assert "Keep a period as the person said it" in p.system and "Never turn it into a calendar date" in p.system


# ── 2026-11-17: a rhythm more often than hourly, from a conversation, is confirmed before it is made ─────────────────

def test_a_sub_hourly_rhythm_is_said_back_in_words_and_once_or_hourly_or_daily_needs_nothing():
    from datetime import datetime, timezone as tz
    from pramanyx.automations.propose import rhythm_to_confirm
    now = datetime(2026, 11, 17, 1, 40, tzinfo=tz.utc)
    draft = lambda cron, **kw: {"timezone": "Asia/Calcutta", "conditions": [{"kind": "schedule", "config": {"cron": cron}}], **kw}
    runaway = rhythm_to_confirm(draft("DTSTART:20261117T074500\nRRULE:FREQ=MINUTELY;INTERVAL=2"), now)
    assert "runs every 2 minutes, with no end" in runaway and "confirm_rhythm" in runaway
    assert "every 2 minutes, with no end" in rhythm_to_confirm(draft("*/2 * * * *"), now)
    bounded = rhythm_to_confirm(draft("DTSTART:20261117T074500\nRRULE:FREQ=MINUTELY;INTERVAL=15;COUNT=4"), now)
    assert "every 15 minutes (" in bounded and "with no end" not in bounded       # still asked: a quarter-hourly analysis
    assert "with no end" not in rhythm_to_confirm(draft("*/5 * * * *", expires_at="2026-11-18T00:00:00Z"), now)
    for fine in ("DTSTART:20261117T074500\nRRULE:FREQ=DAILY;COUNT=1",    # once, in five minutes
                 "0 * * * *",                                              # hourly
                 "0 8 * * 1-5"):                                           # weekday mornings
        assert rhythm_to_confirm(draft(fine), now) == "", fine
    assert rhythm_to_confirm({"conditions": [{"kind": "metric", "config": {}}]}, now) == ""


def test_the_propose_door_leaves_a_conversations_sub_hourly_rhythm_open_but_not_the_pages_or_a_confirmed_one(monkeypatch):
    from fastapi.testclient import TestClient
    import pramanyx.automations.propose as P
    from pramanyx.api import app
    every_two = {"conn_id": CONN, "name": "Top categories", "timezone": "UTC",
                 "conditions": [{"kind": "schedule", "config": {"cron": "*/2 * * * *"}}],
                 "effects": [{"kind": "investigate", "config": {"question": "Top 5 categories by revenue yesterday"}}]}
    monkeypatch.setattr(P, "propose_chain", lambda *a, **k: P.ChainProposal(verdict="proposed", draft=every_two))
    client = TestClient(app)
    ask = lambda **kw: client.post("/automations/propose", json={"outcome": "every 2 minutes, top categories",
                                                                  "conn_id": CONN, **kw}).json()["to_fill"]
    assert any("every 2 minutes, with no end" in x for x in ask(from_conversation=True))
    assert ask(from_conversation=True, confirmed_rhythm=True) == []
    assert ask() == []                         # the Automations page draws the draft on the canvas for a person to check
