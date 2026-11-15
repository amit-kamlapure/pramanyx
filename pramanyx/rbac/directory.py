"""The people directory — who is in the organisation, their title, team and manager (People, 2026-11-15).

Measured that morning: there was no person record anywhere. A person existed only as a string on a role row, a group
membership or a write, and the live install had 4 function groups with 0 members. This is the one person record, in
the RBAC store beside `role_assignments` and `groups` (one ``PRAMANYX_RBAC_DB`` keeps all three hermetic).

* The key is the sign-in email, lower-cased — the value OIDC's ``email`` claim carries, so a directory row and a
  signed-in person meet without a link table. Members of groups are written ``user:<email>``, as `groups.py` stores
  every person.
* A team is a function group, not a second field: importing ``team=Finance`` puts ``user:<email>`` in the group
  ``finance`` (made if missing). The row keeps the team's group id only to know which membership the directory itself
  made, so a move between teams takes the person out of the old one and nobody else's grant is touched.
* A person missing from a full import is deactivated, never deleted: their verdicts and claims still name them.
* An import is shown before it is applied (`plan_import`), and an applied one is journaled ``directory.imported``.

Fed by a CSV today; a provider (SCIM, the IdP) writes the same rows later with its own ``source``.
"""
from __future__ import annotations

import csv
import io
import re
import sqlite3
from dataclasses import asdict, dataclass, field
from typing import Optional

from pramanyx.db.backend import connect_store
from pramanyx.db.store_pool import ensure_once
from pramanyx.rbac.store import db_path
from pramanyx.util.time import now_iso as _now

#: Column names a CSV may use for each field (lower-cased, spaces and dashes as underscores).
_COLUMNS = {
    "email": ("email", "work_email", "mail", "user", "user_id", "login"),
    "name": ("name", "display_name", "full_name"),
    "title": ("title", "job_title", "role_title", "position"),
    "team": ("team", "department", "function", "group"),
    "manager": ("manager", "manager_email", "reports_to"),
}
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_ROWS = 20_000


@dataclass
class Person:
    email: str
    name: str = ""
    title: str = ""
    team: str = ""                  #: the team's group id ("" when none)
    manager: str = ""               #: the manager's email
    source: str = "csv"
    active: bool = True
    imported_at: str = ""


@dataclass
class ImportPlan:
    """What an import would do, said before it is done."""
    add: list[dict] = field(default_factory=list)
    change: list[dict] = field(default_factory=list)        #: {email, fields: {name: [before, after]}}
    deactivate: list[str] = field(default_factory=list)
    unchanged: int = 0
    teams_new: list[str] = field(default_factory=list)
    refused: list[dict] = field(default_factory=list)       #: {line, reason}

    def as_dict(self) -> dict:
        return asdict(self)


def _conn() -> sqlite3.Connection:
    c = connect_store(db_path())
    c.row_factory = sqlite3.Row
    return c


def _ensure_schema(c: sqlite3.Connection) -> None:
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS people (
            org_id       TEXT NOT NULL,
            email        TEXT NOT NULL,
            name         TEXT NOT NULL DEFAULT '',
            title        TEXT NOT NULL DEFAULT '',
            team         TEXT NOT NULL DEFAULT '',
            manager      TEXT NOT NULL DEFAULT '',
            source       TEXT NOT NULL DEFAULT 'csv',
            active       INTEGER NOT NULL DEFAULT 1,
            imported_at  TEXT NOT NULL,
            PRIMARY KEY (org_id, email)
        )
        """
    )
    c.commit()


def _row(r: sqlite3.Row) -> Person:
    return Person(email=r["email"], name=r["name"], title=r["title"], team=r["team"], manager=r["manager"],
                  source=r["source"], active=bool(r["active"]), imported_at=r["imported_at"])


def people(org_id: str, *, include_inactive: bool = False) -> list[Person]:
    c = _conn()
    ensure_once(c, _ensure_schema)
    q = "SELECT * FROM people WHERE org_id = ?" + ("" if include_inactive else " AND active = 1") + " ORDER BY email"
    return [_row(r) for r in c.execute(q, (org_id,)).fetchall()]


def person(org_id: str, who: str) -> Optional[Person]:
    """A person by email, or by any principal spelling of it (``user:<email>``)."""
    email = _bare(who)
    if not email:
        return None
    c = _conn()
    ensure_once(c, _ensure_schema)
    r = c.execute("SELECT * FROM people WHERE org_id = ? AND email = ?", (org_id, email)).fetchone()
    return _row(r) if r else None


def _bare(who: str) -> str:
    return re.sub(r"^(user|person):", "", str(who or "").strip()).lower()


def team_id(name: str) -> str:
    """A team's group id: its name as a slug ("Supply Chain" → ``supply-chain``)."""
    return re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")[:64]


# ── reading a CSV ─────────────────────────────────────────────────────────────────────────────────────────

def parse_csv(text: str) -> tuple[list[tuple[Person, str]], list[dict]]:
    """The people a CSV names, each with its team's display name, and the lines refused with why."""
    reader = csv.DictReader(io.StringIO((text or "").lstrip("﻿")))
    heads = {re.sub(r"[\s-]+", "_", (h or "").strip().lower()): h for h in (reader.fieldnames or [])}
    col = {f: next((heads[a] for a in names if a in heads), None) for f, names in _COLUMNS.items()}
    if not col["email"]:
        return [], [{"line": 1, "reason": "no email column (one of: " + ", ".join(_COLUMNS["email"]) + ")"}]
    got: list[tuple[Person, str]] = []
    refused: list[dict] = []
    seen: set[str] = set()
    for i, raw in enumerate(reader, start=2):
        if i - 1 > MAX_ROWS:
            refused.append({"line": i, "reason": f"more than {MAX_ROWS} rows; the rest were not read"})
            break

        def val(f: str) -> str:
            return str(raw.get(col[f]) or "").strip() if col[f] else ""
        email = val("email").lower()
        if not email and not any(str(v or "").strip() for v in raw.values()):
            continue                                                        # a blank line
        if not _EMAIL.match(email):
            refused.append({"line": i, "reason": f"not an email: {email or '(empty)'}"})
            continue
        if email in seen:
            refused.append({"line": i, "reason": f"{email} appears twice; the first row stands"})
            continue
        manager = val("manager").lower()
        if manager and not _EMAIL.match(manager):
            refused.append({"line": i, "reason": f"{email}: the manager is not an email ({manager}); left blank"})
            manager = ""
        seen.add(email)
        team_name = val("team")
        got.append((Person(email=email, name=val("name"), title=val("title"), team=team_id(team_name),
                           manager=manager), team_name))
    return got, refused


# ── planning and applying ─────────────────────────────────────────────────────────────────────────────────

_FIELDS = ("name", "title", "team", "manager")


def plan_import(org_id: str, text: str, *, full: bool = True) -> ImportPlan:
    """What importing ``text`` would do. ``full`` — the file is the whole directory, so a person it does not name is
    deactivated; otherwise it only adds and changes."""
    from pramanyx.rbac.groups import get_group
    rows, refused = parse_csv(text)
    plan = ImportPlan(refused=refused)
    have = {p.email: p for p in people(org_id, include_inactive=True)}
    teams_new: dict[str, str] = {}
    for p, team_name in rows:
        old = have.get(p.email)
        if p.team and p.team not in teams_new and get_group(org_id, p.team) is None:
            teams_new[p.team] = team_name
        if old is None:
            plan.add.append({"email": p.email, "name": p.name, "title": p.title, "team": p.team, "manager": p.manager})
            continue
        diff = {f: [getattr(old, f), getattr(p, f)] for f in _FIELDS if getattr(old, f) != getattr(p, f)}
        if not old.active:
            diff["active"] = [False, True]
        if diff:
            plan.change.append({"email": p.email, "fields": diff})
        else:
            plan.unchanged += 1
    if full and rows:
        named = {p.email for p, _ in rows}
        plan.deactivate = sorted(e for e, p in have.items() if p.active and e not in named)
    plan.teams_new = sorted(teams_new)
    return plan


def apply_import(org_id: str, text: str, *, full: bool = True, by: str = "") -> ImportPlan:
    """Apply what `plan_import` says, then journal it. Team membership follows the row: into the new team's group,
    out of the team the directory had put them in."""
    from pramanyx.rbac.groups import add_member, get_group, remove_member, upsert_group
    plan = plan_import(org_id, text, full=full)
    rows, _ = parse_csv(text)
    names = {p.team: team_name for p, team_name in rows if p.team}
    have = {p.email: p for p in people(org_id, include_inactive=True)}
    now = _now()
    moves: list[tuple[str, str, str]] = []        # (old team, new team, email) — applied once the rows are committed
    c = _conn()
    ensure_once(c, _ensure_schema)
    try:
        for p, _ in rows:
            old = have.get(p.email)
            c.execute(
                """INSERT INTO people (org_id, email, name, title, team, manager, source, active, imported_at)
                   VALUES (?,?,?,?,?,?,?,1,?)
                   ON CONFLICT(org_id, email) DO UPDATE SET name=excluded.name, title=excluded.title,
                     team=excluded.team, manager=excluded.manager, source=excluded.source, active=1,
                     imported_at=excluded.imported_at""",
                (org_id, p.email, p.name, p.title, p.team, p.manager, p.source, now))
            moves.append((old.team if old else "", p.team, p.email))
        for email in plan.deactivate:
            c.execute("UPDATE people SET active = 0, imported_at = ? WHERE org_id = ? AND email = ?",
                      (now, org_id, email))
            old = have.get(email)
            moves.append((old.team if old else "", "", email))
        c.commit()
    finally:
        c.close()
    for was, now_team, email in moves:
        if was and was != now_team:
            remove_member(org_id, was, f"user:{email}")
        if now_team:
            if get_group(org_id, now_team) is None:
                upsert_group(org_id, now_team, names.get(now_team) or now_team, "A team, from the people directory")
            add_member(org_id, now_team, f"user:{email}")
    try:
        from pramanyx.kernel.ledger import Ledger
        Ledger.default().emit("directory.imported", {
            "by": by, "added": len(plan.add), "changed": len(plan.change), "deactivated": len(plan.deactivate),
            "unchanged": plan.unchanged, "teams_new": plan.teams_new, "refused": len(plan.refused), "full": full})
    except Exception as exc:  # noqa: BLE001 — the rows are the durable thing; the journal line is its record
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "the directory import is applied; its journal line was not written",
                 counter="directory.journal")
    return plan
