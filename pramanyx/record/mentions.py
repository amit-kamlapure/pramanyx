"""A mention reaches the person — Discover's left-out plan's P1 (`docs/DISCOVER_LEFT_OUT_PLAN_2026-11-25.md` §4.2; the
user's call 3, 2026-11-25: "A mention reaches the person as an item in Decide ▸ Inbox — 'Ana mentioned you on Repeat
buyer', opening the Definition, read once opened").

The comment keeps who it mentions (`record/definition_comments`); each mention is also a ``definition.mentioned`` event
in the journal, as a vote is, so the person's own list is read from what happened — never a copy kept beside the
comment. A mention names a person as they sign in (``@ana`` or ``@ana@example.com``); ``@ana`` reaches
``ana@example.com`` too. A comment taken back takes its mentions off the list. Mentioning yourself reaches nobody.
"""
from __future__ import annotations

MENTIONED = "definition.mentioned"
#: How much of the comment rides the event, for the row's line.
EXCERPT = 160


def _id(person: str) -> str:
    return str(person or "").strip().lower().removeprefix("user:").removeprefix("person:")


def names(person: str) -> set[str]:
    """The words that mention ``person``: their id, and the part before the ``@`` of an email id."""
    pid = _id(person)
    return {pid, pid.split("@", 1)[0]} - {""}


def note_mentions(mentioned: list[str], *, by: str, connection_id: str, term: str, area: str, said_id: str,
                  text: str) -> int:
    """One event a person mentioned (not the commenter themself); returns how many."""
    from pramanyx.kernel.ledger import Ledger
    n = 0
    for to in mentioned or []:
        if _id(to) in names(by):
            continue
        Ledger.default().emit(MENTIONED, {"to": _id(to), "by": _id(by), "connection_id": connection_id, "term": term,
                                          "area": area, "said_id": said_id, "excerpt": " ".join(text.split())[:EXCERPT]},
                              conn_id=connection_id or None)
        n += 1
    return n


def rows_for(person: str, *, connections: set[str] | None = None, limit: int = 200) -> list[dict]:
    """The mentions that reach ``person``, newest first, each opening its Definition; those whose comment was taken back,
    or on a connection out of view, are left off."""
    from pramanyx.kernel.ledger import Ledger
    from pramanyx.record.definition_comments import is_open
    from pramanyx.org.context import current_org_id
    from pramanyx.security.authz import require_identity_enabled
    mine = names(person)
    out: list[dict] = []
    org = (current_org_id() or "default") if require_identity_enabled() else None
    for e in Ledger.default().events(kind=MENTIONED, org_id=org, limit=5000):
        p = e.get("payload") or {}
        if _id(p.get("to", "")) not in mine:
            continue
        cid = str(p.get("connection_id") or "")
        if connections is not None and cid and cid not in connections:
            continue
        try:
            if not is_open(cid, p.get("term", ""), p.get("area", ""), p.get("said_id", "")):
                continue
        except Exception as exc:  # noqa: BLE001 — unread, left off: a mention is never shown for a comment not read
            from pramanyx.kernel.errors import tolerate
            tolerate(exc, "mentions: the comment could not be read", counter="mentions.comment")
            continue
        out.append({"source": "mention", "id": p.get("said_id", ""), "connection_id": cid,
                    "since": str(e.get("at") or ""),
                    "title": f'{p.get("by") or "Someone"} mentioned you on “{p.get("term", "")}”',
                    "line": p.get("excerpt", ""),
                    "open": {"kind": "definition", "connection_id": cid, "term": p.get("term", ""),
                             "area": p.get("area", "")}})
        if len(out) >= limit:
            break
    return sorted(out, key=lambda r: r["since"], reverse=True)
