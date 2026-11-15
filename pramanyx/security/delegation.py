"""The person the coworker acts for — carried from the app, never claimed (People, 2026-11-15).

Measured that morning: the coworker sent no identity at all. Its MCP server ran as a stdio child with only the API's
address, and its answer card forwarded Right / Wrong with nothing but a content type — so everything it did was
recorded under the API process's own login, and with sign-in on, every call would have been refused. The only way a
name could ride along was a body field the model could set.

A delegation is how the app hands the coworker its person:

1. the app asks ``POST /auth/delegation`` for the person it is signed in as (with sign-in off, the install's
   operator — who a write here is recorded under anyway);
2. it puts the token in the address it opens the coworker at, in the fragment, which no server and no log sees;
3. the coworker's own host keeps it (never the model) and presents it as ``X-Pramanyx-Delegation`` on what it sends
   for the person: their Right / Wrong, and the platform tools the agent calls in their conversation;
4. ``authz.resolve_principal`` resolves it like a session: an unknown, expired or revoked token resolves NO person
   and never falls through to a weaker seam.

What it may do (the user, 2026-11-15): a verdict is the person's word only when they gave it themselves. Calls the
agent makes carry the agent mark (``X-Pramanyx-Agent``) and the verdict doors refuse a verdict that carries it,
delegated or not — so the agent can read what the person may read, and never speak for them.

The token is a random secret; the ledger holds its SHA-256 (``delegations``), so a read of the ledger yields no usable
token. It lives :data:`TTL_S` and ends on ``DELETE /auth/delegation``.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import time
from typing import Optional

from pramanyx.security.authz import Principal

HEADER = "X-Pramanyx-Delegation"
STORE = "delegations"
AUDIENCE = "coworker"

#: Twelve hours, like a browser session: a working day in the coworker without signing in again.
TTL_S = int(os.environ.get("PRAMANYX_DELEGATION_TTL_S", str(12 * 3600)))


def _key(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _ledger():
    from pramanyx.kernel.ledger import Ledger
    return Ledger.default()


def mint(user_id: str, org_id: str, audience: str = AUDIENCE) -> tuple[str, int]:
    """A new delegation for a person: the token (returned once, never stored) and the epoch second it expires."""
    user, org = str(user_id or "").strip(), str(org_id or "").strip()
    if not user or not org:
        raise ValueError("a delegation names a person and their organisation")
    if user.startswith(("agent:", "service:", "api:", "said:")):
        raise ValueError(f"only a person can delegate; {user!r} is not one")
    secret = secrets.token_urlsafe(32)
    now = int(time.time())
    _ledger().kv_put(STORE, _key(secret), {"user_id": user, "org_id": org, "aud": audience,
                                           "exp": now + TTL_S, "issued_at": now})
    return secret, now + TTL_S


def resolve(secret: Optional[str], audience: str = AUDIENCE) -> Optional[Principal]:
    """The person a delegation names, or ``None`` — unknown, expired (and then removed), revoked, or for another
    audience."""
    secret = str(secret or "").strip()
    if not secret:
        return None
    led = _ledger()
    row = led.kv_get(STORE, _key(secret))
    if not row or row.get("aud") != audience:
        return None
    if int(row.get("exp") or 0) <= int(time.time()):
        led.kv_delete(STORE, _key(secret))
        return None
    user, org = str(row.get("user_id") or ""), str(row.get("org_id") or "")
    return Principal(user_id=user, org_id=org) if user and org else None


def revoke(secret: Optional[str]) -> bool:
    secret = str(secret or "").strip()
    return bool(secret) and _ledger().kv_delete(STORE, _key(secret))


def presented(request) -> bool:
    return bool((request.headers.get(HEADER) or "").strip())
