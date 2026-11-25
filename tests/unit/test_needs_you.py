"""Needs you — the Inbox (the Atlas plan's §7.8, decision 2; the user, 2026-11-26: "go ahead with the Inbox"): one view
over every queue that waits on a person, by lane, read state per person, a count for the rail. A read writes nothing;
a review row says the doors that settle it; "Not now" sets a row aside until its day."""
from __future__ import annotations

import uuid
from types import SimpleNamespace as NS

import pytest

from pramanyx.discover import atlas as AT
from pramanyx.record import needs_you as N


def _person() -> str:
    return f"user:{uuid.uuid4().hex[:8]}"


def _proposal(pid: str, *, expired: bool = False, conn: str = "c1"):
    return NS(id=pid, action_id="send_report", reasoning="the weekly report", connection_id=conn,
              created_at="2026-11-25T10:00:00+00:00", expired=expired)


@pytest.fixture
def quiet_sources(monkeypatch):
    """Every source of what waits, empty — each test fills the one it reads."""
    import pramanyx.actions.inbox as inbox
    import pramanyx.automations.store as autos
    import pramanyx.db.history as history
    import pramanyx.obs.agent_alert_store as alerts
    monkeypatch.setattr(inbox, "list_proposals", lambda status=None, limit=100, connection_id=None: [])
    monkeypatch.setattr(autos, "paused_runs", lambda limit=500: [])
    monkeypatch.setattr(autos, "get_runs", lambda limit=500: [])
    monkeypatch.setattr(history, "list_investigations", lambda limit=200: [])
    monkeypatch.setattr(alerts, "list_events", lambda unacknowledged_only=True, limit=500: [])
    return monkeypatch


def test_the_view_reads_without_writing_and_leaves_a_lapsed_proposal_off(quiet_sources):
    import pramanyx.actions.inbox as inbox

    def no_sweep():
        raise AssertionError("the Inbox's read swept — only Agent Ops' route does")
    quiet_sources.setattr(inbox, "expire_stale", no_sweep)
    quiet_sources.setattr(inbox, "list_proposals", lambda status=None, limit=100, connection_id=None: [
        _proposal("p-live"), _proposal("p-lapsed", expired=True)])
    got = N.waiting(sweep=False, scan=50)
    assert [r["id"] for r in got["rows"]] == ["p-live"]
    assert got["sources"][N.INBOX] == 1 and got["unread"] == []


def test_agent_ops_route_still_sweeps_first_and_counts_every_source(quiet_sources):
    import pramanyx.actions.inbox as inbox
    swept = []
    quiet_sources.setattr(inbox, "expire_stale", lambda: swept.append(1))
    from pramanyx.routers.control_room import needs_human
    out = needs_human(limit=1)
    assert swept == [1] and out["count"] == sum(out["sources"].values()) == 0


def test_read_marks_are_each_persons_own_and_let_go_of_rows_that_no_longer_wait():
    ana, bo = _person(), _person()
    N.mark(ana, ["kinetic_inbox:p1", "monitor_alert:a1"])
    assert set(N.read_marks(ana)) == {"kinetic_inbox:p1", "monitor_alert:a1"}
    assert N.read_marks(bo) == {}
    N.mark(ana, ["monitor_alert:a1"], read=False)
    assert set(N.read_marks(ana)) == {"kinetic_inbox:p1"}
    N.mark(ana, ["review:c1:framing_miss:x"], live={"review:c1:framing_miss:x"})      # p1 no longer waits
    assert set(N.read_marks(ana)) == {"review:c1:framing_miss:x"}


def _review_row(id_, area, conn="c1"):
    return {"id": id_, "source": "framing_miss", "kind": "gap", "title": id_, "detail": "", "area": area, "count": 1,
            "complaints": 0, "at": "", "connection_id": conn, "resolve": {"href": "/x", "action": "Define it"}, "actions": []}


def test_the_view_has_its_lanes_each_row_read_or_not_and_the_badge_counts_only_what_is_the_persons(quiet_sources):
    import pramanyx.actions.inbox as inbox
    from pramanyx.discover import service as S
    ana = _person()
    quiet_sources.setattr(inbox, "list_proposals", lambda status=None, limit=100, connection_id=None: [
        _proposal("p1"), _proposal("p2"), _proposal("elsewhere", conn="c9")])
    quiet_sources.setattr(N, "monitor_alerts", lambda allowed, org_conns, scan: ([{
        "source": "monitor_alert", "id": "a1", "title": "Revenue: dropped", "connection_id": "c1", "severity": "warning",
        "since": "", "waiting_ms": 5, "resolve": {"surface": "monitor_alert"}}], True))
    quiet_sources.setattr(S, "areas_in_view", lambda scope: {
        "orders_sales": {"id": "orders_sales", "name": "Orders & sales", "parent": "", "business_owners": [ana],
                         "technical_owners": []},
        "returns": {"id": "returns", "name": "Returns", "parent": "orders_sales", "business_owners": [], "technical_owners": []},
        "marketing": {"id": "marketing", "name": "Marketing", "parent": "", "business_owners": [], "technical_owners": []}})
    rows = [_review_row("framing_miss:a", "orders_sales"), _review_row("framing_miss:b", "returns"),
            _review_row("framing_miss:c", "marketing"), _review_row("framing_miss:d", "")]
    quiet_sources.setattr(AT, "slow_parts", lambda scope, wait=False: ({"review_items": rows, "at": "2026-11-26T10:00"}, []))
    N.mark(ana, ["kinetic_inbox:p1", "review:c1:framing_miss:b"])
    out = N.needs_you(NS(person=ana, connections={"c1": "theLook"}, workspace_id=None))
    decide, alerts, review = out["lanes"]
    assert [r["id"] for r in decide["rows"]] == ["p1", "p2"], "a connection out of view is not listed"
    assert [r["read"] for r in decide["rows"]] == [True, False] and decide["unread"] == 1
    assert alerts["rows"][0]["key"] == "monitor_alert:a1" and alerts["rows"][0]["connection_name"] == "theLook"
    assert (review["count"], review["unread"], review["mine"], review["mine_unread"], review["unplaced"]) == (4, 3, 2, 1, 1)
    assert [(a["id"], a["count"], a["unread"], a["mine"]) for a in review["areas"]] == [
        ("marketing", 1, 1, False), ("orders_sales", 1, 1, True), ("returns", 1, 0, True), ("none", 1, 1, False)]
    # the rail counts what is the person's to act on: one proposal, one alert, the review of the Area they answer for
    assert out["badge"] == 1 + 1 + 1


def test_a_review_row_says_the_doors_that_settle_it(monkeypatch):
    from pramanyx.knowledge import review as R
    monkeypatch.setattr("pramanyx.knowledge.learned.learned_items", lambda conn, limit=500: {"items": [
        {"kind": "finding", "standing": "measured", "standing_said": "measured by a run", "source": "an answer",
         "ref": "clm1", "text": "Repeat buyers spend more", "area": "customers", "as_of": "2026-11-25"}]})
    rows = R._unconfirmed("c1", R._links("c1"))
    assert [(a["do"], a["call"]["method"], a["call"]["path"]) for a in rows[0]["actions"]] == [
        ("accept", "POST", "/record/claims/clm1/right"), ("reject", "POST", "/record/claims/clm1/wrong")]
    gap = R._row(source="framing_miss", ref="x", kind="gap", title="what is churn?", href=None, action="Define it",
                 actions=[R._new_definition("Define the words it used", "c1")])
    assert gap["actions"][0]["open"] == {"new_definition": {"connection": "c1", "term": "", "area": ""}}


def test_not_now_takes_a_row_off_the_review_until_its_day(monkeypatch):
    from datetime import datetime, timedelta, timezone

    from pramanyx.discover import service as S
    from pramanyx.record.set_aside import set_aside
    monkeypatch.setattr(S, "areas_in_view", lambda scope: {"orders_sales": {"id": "orders_sales", "parent": ""}})
    conn = "c" + uuid.uuid4().hex[:6]
    rows = [_review_row("framing_miss:a", "orders_sales", conn), _review_row("framing_miss:b", "orders_sales", conn)]
    monkeypatch.setattr(AT, "slow_parts", lambda scope, wait=False: ({"review_items": rows, "at": "2026-11-26T10:00"}, []))
    scope = NS(connections={conn: "theLook"}, person="", curator=False)
    assert AT.review_in(scope, "orders_sales")["total"] == 2
    until = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    set_aside(item_kind="review", ref=f"{conn}:framing_miss:a", until=until, why="not now", by="user:ana")
    got = AT.review_in(scope, "orders_sales")
    assert [i["id"] for i in got["items"]] == ["framing_miss:b"] and got["set_aside"] == 1


def test_the_doors_answer_for_the_person_signed_in(quiet_sources):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from pramanyx.routers import needs_you as R
    ana = _person()
    quiet_sources.setattr(R, "_scope", lambda request, workspace_id: NS(person=ana, connections={"c1": "theLook"},
                                                                         workspace_id=workspace_id))
    quiet_sources.setattr(AT, "slow_parts", lambda scope, wait=False: (None, ["It is being read."]))
    quiet_sources.setattr(N, "monitor_alerts", lambda allowed, org_conns, scan: ([], True))
    quiet_sources.setattr("pramanyx.discover.service.areas_in_view", lambda scope: {})
    app = FastAPI()
    app.include_router(R.router)
    client = TestClient(app)
    view = client.get("/needs-you").json()
    assert [lane["id"] for lane in view["lanes"]] == ["decide", "alerts", "review"] and view["said"] == ["It is being read."]
    assert client.get("/needs-you/count").json() == {"badge": 0, "lanes": {"decide": 0, "alerts": 0, "review": 0}}
    assert client.post("/needs-you/read", json={"keys": ["monitor_alert:a1"]}).json() == {"marked": 1, "read": 1}
    assert set(N.read_marks(ana)) == {"monitor_alert:a1"}
