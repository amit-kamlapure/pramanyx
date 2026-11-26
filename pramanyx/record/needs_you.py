"""Needs you — one view over every queue that waits on a person (the Atlas plan's §7.8; decision 2, the user,
2026-11-25: "Yes to all three, go ahead"). The Inbox is this view.

Four lanes are read here; a fifth, the deep analyses' recommendations, is read by the Inbox's own list as before:

* **for_you** — what is addressed to this person alone (Discover's C5 and P1, 2026-11-26): an ask for access to a thing
  they made (or, an admin, to one nobody made), the answer to an ask of their own, and a comment that mentions them.
  Nobody else's list shows it.

* **decide** — staged proposals, automation runs parked on an approval, deep runs paused at a gate, and automations
  that cannot dispatch: the needs-human derivation (`waiting`), which Agent Ops' Attention reads too — one derivation,
  two readers, so resolving a row anywhere takes it off both.
* **alerts** — monitor alerts no person acknowledged and no recovery closed, and agent alerts nobody acknowledged: two
  stores, one lane.
* **review** — the knowledge review by Area, from the Atlas's kept reading (A5), its rows on the Atlas's own door.

A READ WRITES NOTHING. Agent Ops' route sweeps lapsed proposals and resumes the runs parked behind them on every call
(`waiting(sweep=True)`); this view leaves a lapsed proposal off the list — it can no longer be accepted — and sweeps
nothing (`waiting(sweep=False)`).

Read state is per person: one ledger artifact per person, ``inbox_read:<person>``, its payload each row's key and when
the person opened it. A mark is a new version, the earlier ones kept; a key whose row is gone is dropped at the next
mark, so the record holds what still waits. The count on the rail is what this person has not opened: every unread row
to decide and every unread alert, and the review rows of the Areas the person answers for (a Business or Technical
contact) — the review of an Area nobody answers for is listed, never counted against everyone.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

logger = logging.getLogger(__name__)

#: The inbox's key on the needs-human wire — a row's `source` and its count's key, spelled once (a frozen name).
INBOX = "kinetic_inbox"
#: The lanes this module reads, in the order the page lists them; the page adds the recommendations after "alerts".
LANES = ("for_you", "decide", "alerts", "review")
LANE_TITLES = {"for_you": "For you", "decide": "To decide", "alerts": "Alerts", "review": "Knowledge review"}
#: The read marks' artifact kind; one artifact per person.
READ_KIND = "inbox_read"
#: Past this many marks, a mark drops those whose rows no longer wait (read afresh then, not on every mark).
TIDY_AT = 2000


def _parse_ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# ── what waits to be decided (the needs-human derivation) ─────────────────────────────────────────────────────────


def waiting(*, sweep: bool, scan: int) -> dict:
    """``{rows, sources, unread}`` over the five sources a person decides on — a VIEW, never a queue: each row names its
    native resolve surface, so resolving anywhere removes it everywhere (one store per source, no copies). ``sweep``
    first expires lapsed proposals and releases the runs parked behind them (Agent Ops' route, which always did);
    without it a lapsed proposal is left off and nothing is written. ``unread`` names each source whose read failed —
    a failed read counted 0 once, and "every source is empty" was said over a source nobody read."""
    from pramanyx.actions.inbox import expire_stale, list_proposals
    from pramanyx.automations.store import get_runs, paused_runs
    from pramanyx.db.history import list_investigations
    from pramanyx.kernel.ledger import Ledger

    now = datetime.now(timezone.utc)
    rows: list[dict] = []
    unread: list[str] = []

    def _waiting_ms(since: Any) -> Optional[int]:
        ts = _parse_ts(since)
        return int((now - ts).total_seconds() * 1000) if ts else None

    # Source A — staged proposals awaiting accept/reject. Swept first on Agent Ops (RC-3): a proposal past its window
    # is one the accept path refuses, and listing it asks someone to do what cannot be done. The sweep is hygiene
    # only — accept refuses a lapsed proposal whether or not it ran.
    if sweep:
        try:
            expire_stale()
        except Exception:
            logger.warning("needs-human: expiry sweep failed", exc_info=True)
        # DS-8 — a lapsed approval still ENDS the wait, so a run parked behind one is released here too.
        try:
            from pramanyx.automations.engine import resume_parked_runs
            resume_parked_runs()
        except Exception:
            logger.warning("needs-human: parked-run resume failed", exc_info=True)
    # DS-8 — which pending proposals a PARKED RUN already speaks for: the parked-run row wins (it says which
    # automation, which chain, which step), and resolving it goes through the very same proposal.
    parked_proposals: set[str] = set()
    parked = []
    try:
        parked = paused_runs(limit=scan)
        for run in parked:
            for effect in run.effects:
                pid = str((effect.data or {}).get("proposal_id") or "")
                if pid:
                    parked_proposals.add(pid)
    except Exception:
        logger.warning("needs-human: parked-run read failed", exc_info=True)
        unread.append("automation_approvals")

    inbox_count = 0
    lapsed: set[str] = set()
    try:
        for p in list_proposals(status="pending", limit=scan):
            if getattr(p, "kind", "") == "access_request":
                continue                # addressed to one person: their own "For you" lane, never everyone's queue
            if not sweep and p.expired:
                lapsed.add(p.id)    # no longer acceptable: off the list, and nothing written to say so
                continue
            if p.id in parked_proposals:
                continue
            inbox_count += 1
            rows.append({
                "source": INBOX, "id": p.id,
                "title": f"{p.action_id}: {p.reasoning[:140]}" if p.reasoning else p.action_id,
                "connection_id": p.connection_id,
                "since": p.created_at, "waiting_ms": _waiting_ms(p.created_at),
                "resolve": {"surface": "inbox",
                            "accept": f"/kinetic-actions/inbox/{p.id}/accept",
                            "reject": f"/kinetic-actions/inbox/{p.id}/reject"},
            })
    except Exception:
        logger.warning("needs-human: inbox read failed", exc_info=True)
        unread.append(INBOX)

    # Source B — deep runs paused at a gate, resumable via feedback. The honest timestamp is the
    # `investigation.paused` event; when the journal has aged it out, started_at — and the row SAYS so (`basis`).
    paused_count = 0
    try:
        paused_at: dict[str, str] = {}
        for ev in Ledger.default().events(kind="investigation.paused", limit=500):
            inv = (ev.get("payload") or {}).get("investigation_id")
            if inv and inv not in paused_at:
                paused_at[inv] = ev["at"]
        for inv in list_investigations(limit=200):
            if inv.get("status") != "paused":
                continue
            paused_count += 1
            since = paused_at.get(inv["id"])
            rows.append({
                "source": "paused_run", "id": inv["id"],
                "title": inv.get("question") or inv["id"],
                "connection_id": inv.get("connection_id"),
                "since": since or inv.get("started_at"),
                "since_basis": "paused_event" if since else "started_at",
                "waiting_ms": _waiting_ms(since or inv.get("started_at")),
                "resolve": {"surface": "investigation",
                            "feedback": f"/investigations/{inv['id']}/feedback"},
            })
    except Exception:
        logger.warning("needs-human: paused-run read failed", exc_info=True)
        unread.append("paused_runs")

    # Source C — automation runs PARKED on an approval (DS-8): read from the parked state, never guessed from history;
    # the resolve link points at the PROPOSAL, which is what resolves it.
    approval_count = 0
    try:
        for run in parked:
            for effect in run.effects:
                if effect.status != "approval_required":
                    continue
                proposal_id = str((effect.data or {}).get("proposal_id") or "")
                if proposal_id in lapsed:
                    continue        # its proposal lapsed: the sweep that releases the run is Agent Ops'
                approval_count += 1
                rows.append({
                    "source": "automation_approval",
                    "id": proposal_id or f"{run.id}:{effect.target}",
                    "title": f"{run.automation_name or run.automation_id} — "
                             f"{effect.kind}: {effect.message[:140]}",
                    "connection_id": run.conn_id,
                    "since": run.started_at, "waiting_ms": _waiting_ms(run.started_at),
                    # `inbox`, the surface Source A names — this row IS a proposal in that inbox.
                    "resolve": {"surface": "inbox",
                                "proposal_id": proposal_id,
                                "automation_id": run.automation_id,
                                "run_id": run.id},
                })
    except Exception:
        logger.warning("needs-human: parked-run row build failed", exc_info=True)
        unread.append("automation_approvals")

    # Source D — agent alerts nobody has acknowledged (VA-6); acknowledging is the resolve action, its severity on the row.
    alert_count = 0
    try:
        from pramanyx.obs.agent_alert_store import list_events

        for ev in list_events(unacknowledged_only=True, limit=scan):
            alert_count += 1
            rows.append({
                "source": "agent_alert", "id": ev.id,
                "title": f"{ev.rule_name}: {ev.reason[:140]}",
                "connection_id": "",
                "severity": ev.severity,
                "since": ev.fired_at, "waiting_ms": _waiting_ms(ev.fired_at),
                "resolve": {"surface": "agent_alert",
                            "ack": f"/obs/agent-alerts/events/{ev.id}/ack"},
            })
    except Exception:
        logger.warning("needs-human: agent-alert read failed", exc_info=True)
        unread.append("agent_alerts")

    # Source E — automations whose effects cannot dispatch at all: one row per automation, from its newest run THAT
    # FIRED (the engine ticks every minute and records `not_fired`; reading the newest run of any kind hid a broken
    # automation 59 minutes in 60).
    broken_count = 0
    try:
        seen_automations: set = set()
        for run in get_runs(limit=500):
            if run.automation_id in seen_automations:
                continue
            if not run.effects:
                continue        # never reached its effects; carries no dispatch verdict
            failing = [e for e in run.effects if e.status == "dispatch_error"]
            seen_automations.add(run.automation_id)
            if not failing:
                continue        # its newest fired run dispatched: whatever went wrong before has stopped
            broken_count += 1
            effect = failing[0]
            rows.append({
                "source": "automation_broken",
                "id": f"{run.automation_id}:broken",
                "title": f"{run.automation_name or run.automation_id} — cannot dispatch: "
                         f"{effect.message[:140]}",
                "connection_id": run.conn_id,
                "since": run.started_at, "waiting_ms": _waiting_ms(run.started_at),
                "resolve": {"surface": "automation",
                            "automation_id": run.automation_id,
                            "run_id": run.id},
            })
    except Exception:
        logger.warning("needs-human: broken-automation read failed", exc_info=True)
        unread.append("broken_automations")

    rows.sort(key=lambda r: r.get("waiting_ms") or 0, reverse=True)
    return {"rows": rows,
            "sources": {INBOX: inbox_count, "paused_runs": paused_count, "automation_approvals": approval_count,
                        "agent_alerts": alert_count, "broken_automations": broken_count},
            "unread": list(dict.fromkeys(unread))}


# ── alerts ───────────────────────────────────────────────────────────────────────────────────────────────────────


def monitor_alerts(*, allowed: Optional[set], org_conns: Optional[set], scan: int) -> tuple[list[dict], bool]:
    """Monitor alerts still waiting on a person — not acknowledged, never a recovery, and not closed by one (TC-4) —
    in the connections in view; and whether the store was read."""
    from pramanyx.monitors.recovery import still_open
    from pramanyx.monitors.store import get_alerts
    now = datetime.now(timezone.utc)
    try:
        alerts = still_open(get_alerts(limit=scan, unacknowledged_only=True))
    except Exception:
        logger.warning("needs-you: monitor-alert read failed", exc_info=True)
        return [], False
    rows = []
    for a in alerts:
        if (allowed is not None and a.conn_id not in allowed) or (org_conns is not None and a.conn_id not in org_conns):
            continue
        ts = _parse_ts(a.triggered_at)
        rows.append({
            "source": "monitor_alert", "id": a.id,
            "title": f"{a.monitor_name or a.monitor_id}: {(a.message or a.alert_on or 'fired')[:160]}",
            "connection_id": a.conn_id, "severity": a.severity, "metric": a.metric_name or "",
            "since": a.triggered_at, "waiting_ms": int((now - ts).total_seconds() * 1000) if ts else None,
            "resolve": {"surface": "monitor_alert", "monitor_id": a.monitor_id,
                        "ack": f"/alerts/{a.id}/acknowledge"},
        })
    return rows, True


# ── read state ───────────────────────────────────────────────────────────────────────────────────────────────────


def row_key(row: dict) -> str:
    """A row's name in a person's read marks: its source and id — a review row's with its connection, since two
    connections may each hold a row of one id."""
    if row.get("lane") == "review" or row.get("kind") in ("gap", "candidate", "conflict"):
        return f"review:{row.get('connection_id') or ''}:{row.get('id')}"
    return f"{row.get('source')}:{row.get('id')}"


def _read_key(person: str) -> str:
    return f"{READ_KIND}:{person}"


def read_marks(person: str) -> dict[str, str]:
    """Each row this person opened, by its key, with when."""
    from pramanyx.kernel.ledger import Ledger
    art = Ledger.default().artifact_latest(_read_key(person))
    payload = (art or {}).get("payload")
    marks = payload.get("read") if isinstance(payload, dict) else None
    return {str(k): str(v) for k, v in marks.items()} if isinstance(marks, dict) else {}


def mark(person: str, keys: Iterable[str], *, read: bool = True, live: Optional[set[str]] = None) -> dict[str, str]:
    """Mark rows read (or unread) for one person — a new version of their marks, the earlier kept. ``live``, when
    given, is every row that still waits: a mark for a row no longer there is dropped."""
    from pramanyx.kernel.ledger import Ledger
    keys = [str(k) for k in keys if str(k)]
    marks = read_marks(person)
    at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for k in keys:
        if read:
            marks[k] = at
        else:
            marks.pop(k, None)
    if live is not None:
        marks = {k: v for k, v in marks.items() if k in live or k in keys}
    Ledger.default().artifact_write(READ_KIND, _read_key(person), {"person": person, "read": marks},
                                    lineage=[("read_by", person, f"{len(keys)} {'read' if read else 'unread'}")])
    return marks


# ── the view ─────────────────────────────────────────────────────────────────────────────────────────────────────


def _mine(areas: dict[str, dict], person: str) -> set[str]:
    """The Areas this person answers for — a Business or Technical contact — and every Area under them."""
    from pramanyx.semantic.areas import curates
    own = {a_id for a_id, a in areas.items() if curates(a, person, admin=False)}
    frontier = set(own)
    while frontier:
        below = {a_id for a_id, a in areas.items() if a.get("parent") in frontier and a_id not in own}
        own |= below
        frontier = below
    return own


def needs_you(scope, *, scan: int = 500, with_live: bool = False) -> dict:
    """The Inbox: what waits on this person across the connections in view, by lane, each row read or not — and the
    count the rail shows. Writes nothing. ``with_live`` adds every waiting row's key, for tidying the marks."""
    from pramanyx.discover.atlas import review_in
    from pramanyx.discover.service import areas_in_view
    from pramanyx.security.authz import org_visible_conn_ids
    person = scope.person
    allowed = set(scope.connections)
    org_conns = org_visible_conn_ids()
    names = dict(scope.connections)
    marks = read_marks(person)
    said: list[str] = []

    def keep(r: dict) -> bool:
        cid = str(r.get("connection_id") or "")
        return not cid or cid in allowed

    def stamp(r: dict, lane: str) -> dict:
        r = {**r, "lane": lane, "connection_name": names.get(str(r.get("connection_id") or ""), "")}
        r["key"] = row_key(r)
        r["read"] = r["key"] in marks
        return r

    for_you, for_you_failed = [], []
    try:
        from pramanyx.record.access_requests import rows_for as access_rows
        for_you += [stamp(r, "for_you") for r in access_rows(person, admin=bool(getattr(scope, "curator", False)))]
    except Exception:
        logger.warning("needs-you: asks for access could not be read", exc_info=True)
        for_you_failed.append("access_requests")
    try:
        from pramanyx.record.mentions import rows_for as mention_rows
        for_you += [stamp(r, "for_you") for r in mention_rows(person, connections=allowed)]
    except Exception:
        logger.warning("needs-you: mentions could not be read", exc_info=True)
        for_you_failed.append("mentions")
    for_you.sort(key=lambda r: str(r.get("since") or ""), reverse=True)

    got = waiting(sweep=False, scan=scan)
    decide = [stamp(r, "decide") for r in got["rows"] if r["source"] != "agent_alert" and keep(r)]
    agent = [stamp(r, "alerts") for r in got["rows"] if r["source"] == "agent_alert"]
    monitors, read_ok = monitor_alerts(allowed=allowed, org_conns=org_conns, scan=scan)
    alerts = sorted([*agent, *(stamp(r, "alerts") for r in monitors)], key=lambda r: -(r.get("waiting_ms") or 0))
    unread = [s for s in got["unread"] if s != "agent_alerts"]
    alerts_unread = (["agent_alerts"] if "agent_alerts" in got["unread"] else []) + ([] if read_ok else ["monitor_alerts"])

    areas = areas_in_view(scope)
    mine = _mine(areas, person)
    rev = review_in(scope, "")
    said += rev.get("said") or []
    review_rows = [{**i, "lane": "review"} for i in rev.get("items") or []]
    by_area: dict[str, dict] = {}
    review_unread = mine_count = mine_unread = unplaced = 0
    for i in review_rows:
        is_read = row_key(i) in marks
        placed = [a for a in str(i.get("area") or "").split(",") if a]
        if not placed:
            unplaced += 1
        review_unread += 0 if is_read else 1
        if set(placed) & mine:
            mine_count += 1
            mine_unread += 0 if is_read else 1
        for a in placed or ["none"]:
            cur = by_area.setdefault(a, {"id": a, "count": 0, "unread": 0})
            cur["count"] += 1
            cur["unread"] += 0 if is_read else 1
    for a_id, cur in by_area.items():
        a = areas.get(a_id) or {}
        cur.update(name=a.get("name") or ("In no Area" if a_id == "none" else a_id), icon=a.get("icon") or "",
                   mine=a_id in mine)
    live = {r["key"] for r in [*for_you, *decide, *alerts]} | {row_key(i) for i in review_rows}

    def lane(lane_id: str, rows: list[dict], failed: list[str]) -> dict:
        return {"id": lane_id, "title": LANE_TITLES[lane_id], "rows": rows, "count": len(rows),
                "unread": sum(1 for r in rows if not r["read"]), "not_read": failed}

    out_lanes = [
        lane("for_you", for_you, for_you_failed),
        lane("decide", decide, unread),
        lane("alerts", alerts, alerts_unread),
        {"id": "review", "title": LANE_TITLES["review"], "count": len(review_rows), "unread": review_unread,
         "mine": mine_count, "mine_unread": mine_unread, "unplaced": unplaced, "read_at": rev.get("read_at"),
         "areas": sorted(by_area.values(), key=lambda a: (a["id"] == "none", -a["unread"], -a["count"], a["name"])),
         "not_read": []},
    ]
    badge = out_lanes[0]["unread"] + out_lanes[1]["unread"] + out_lanes[2]["unread"] + mine_unread
    out = {"person": person, "lanes": out_lanes, "badge": badge, "said": said}
    return {**out, "live": sorted(live)} if with_live else out


__all__ = ["INBOX", "LANES", "LANE_TITLES", "READ_KIND", "TIDY_AT", "mark", "monitor_alerts", "needs_you", "read_marks", "row_key",
           "waiting"]
