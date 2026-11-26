"""A person links their own Slack account (2026-11-26).

The user chose how: "From Slack, confirmed in app". The person asks the bot to link; the platform sends a one-time
code by direct message to THAT Slack account, through the bot's own token; the person enters the code in the app while
signed in, and the link is made. Each side is proven by the person holding it: only the Slack account can read the
code, and only the signed-in person can enter it.

Why the code is SENT here and never returned to whoever asked for it: a request naming a Slack id is a claim, not a
proof (`said_asker`, People 2026-11-15). If the code went back to the caller, anyone able to call the API could ask for
someone else's code and tie that person's Slack account to themselves. Sent by Slack to the account, it can be read
only there.

What a link does: it says where a message meant for the person goes in Slack (a post addressed to `@me`), and it
attributes that Slack account's actions to them in the audit (`resolver.attribution_key`). It never makes a Slack
message act as the person — a person comes from sign-in or a delegation, never from a body.

The code: eight characters from an alphabet with no look-alikes, shown as two groups of four, good for
:data:`CODE_MINUTES` and once. Only its hash is stored. A new code for the same Slack account retires the older ones.
A person who enters :data:`MAX_TRIES` wrong codes within :data:`CODE_MINUTES` is stopped until the window passes.
"""
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from pramanyx.org.context import current_org_id

#: Where a person enters the code and sees their linked accounts — said in the DM, on a refused `@me`, and the
#: panel's own heading in the app (`web/components/YourSlackAccount.tsx`).
LINK_PLACE = "Settings ▸ Integrations ▸ Slack bots ▸ Your Slack account"
#: How long a code works, and the window wrong tries are counted in.
CODE_MINUTES = 15
#: Wrong codes a person may enter in that window.
MAX_TRIES = 5
#: No 0/O, 1/I/L: a code is read off one screen and typed into another.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


class LinkRefused(ValueError):
    """A code that cannot link: wrong, used, expired, or too many tries. The message is the person's to read."""


@dataclass(frozen=True)
class Linked:
    provider: str
    external_id: str
    display: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(at: datetime) -> str:
    return at.isoformat(timespec="seconds")


def normalise(code: str) -> str:
    """What a person typed, as the code it means: case, spaces and the dash do not matter."""
    return "".join(ch for ch in str(code or "").upper() if ch.isalnum())


def _hash(code: str) -> str:
    return hashlib.sha256(normalise(code).encode()).hexdigest()


def shown(code: str) -> str:
    """The code as it is shown: two groups of four."""
    raw = normalise(code)
    return f"{raw[:4]}-{raw[4:]}" if len(raw) == 8 else raw


def start(provider: str, external_id: str, *, display: str = "", now: Optional[datetime] = None) -> str:
    """A new one-time code for this external account; any older code of its is retired. Returns the code — for the
    caller that SENDS it to that account, never for a response body."""
    from pramanyx.identity.store import connection
    if not (provider and external_id):
        raise ValueError("an account to link names its provider and its id")
    at = now or _now()
    code = "".join(secrets.choice(_ALPHABET) for _ in range(8))
    c = connection()
    try:
        c.execute("UPDATE identity_link_codes SET used_at = ?, used_by = 'retired: a newer code was sent' "
                  "WHERE org_id = ? AND provider = ? AND external_id = ? AND used_at IS NULL",
                  (_iso(at), current_org_id(), provider, external_id))
        c.execute("INSERT INTO identity_link_codes (code_hash, org_id, provider, external_id, display, created_at, "
                  "expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                  (_hash(code), current_org_id(), provider, external_id, display[:120], _iso(at),
                   _iso(at + timedelta(minutes=CODE_MINUTES))))
        c.commit()
    finally:
        c.close()
    return code


def redeem(code: str, person: str, *, now: Optional[datetime] = None) -> Linked:
    """Link the account the code was sent to, to ``person`` (the signed-in person entering it). Once only."""
    from pramanyx.identity.store import connection, put_link
    who = str(person or "").strip()
    if not who:
        raise LinkRefused("Sign in first: a code links a Slack account to the person entering it.")
    at = now or _now()
    org = current_org_id()
    c = connection()
    try:
        since = _iso(at - timedelta(minutes=CODE_MINUTES))
        tries = c.execute("SELECT COUNT(*) FROM identity_link_tries WHERE org_id = ? AND person = ? AND at >= ?",
                          (org, who, since)).fetchone()[0]
        if tries >= MAX_TRIES:
            raise LinkRefused(f"Too many wrong codes. Wait {CODE_MINUTES} minutes, then ask the bot for a new one.")
        row = c.execute("SELECT * FROM identity_link_codes WHERE code_hash = ? AND org_id = ?",
                        (_hash(code), org)).fetchone()
        why = ("That code is not right. Check it, or ask the bot for a new one." if row is None
               else "That code was already used, or a newer one was sent. Ask the bot for a new one."
               if row["used_at"] else "That code has expired. Ask the bot for a new one."
               if row["expires_at"] < _iso(at) else "")
        if why:
            c.execute("INSERT INTO identity_link_tries (org_id, person, at) VALUES (?, ?, ?)", (org, who, _iso(at)))
            c.commit()
            raise LinkRefused(why)
        done = c.execute("UPDATE identity_link_codes SET used_at = ?, used_by = ? WHERE code_hash = ? AND used_at IS NULL",
                         (_iso(at), who, row["code_hash"]))
        c.commit()
        if done.rowcount != 1:           # another request used it in between
            raise LinkRefused("That code was already used. Ask the bot for a new one.")
    finally:
        c.close()
    put_link(row["provider"], row["external_id"], who, display=row["display"], linked_by=f"code:{who}")
    return Linked(provider=row["provider"], external_id=row["external_id"], display=row["display"])
