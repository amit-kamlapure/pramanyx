"""The served auth config — what a browser needs to START authenticating (VA-10).

One route, deliberately public (it joins ``_AUTH_EXEMPT`` in ``api.py``): a client that
does not yet hold a token has to be able to learn HOW to get one, or requiring identity
would brick every UI. It serves only what is public by nature — the issuer and the
OAuth client id (the audience) — never a secret; verification uses none.

Served, never mirrored: the frontend renders its sign-in from this payload, so the
client id lives in exactly one place (``PRAMANYX_OIDC_AUDIENCE``) and a rotated client
needs no frontend change.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response

router = APIRouter(tags=["auth"])

_GOOGLE_ISSUER = "https://accounts.google.com"


@router.get("/auth/config")
def auth_config():
    """How this deployment authenticates. ``provider`` is a RENDERING hint — the
    verification path is issuer-generic; only the sign-in widget is provider-shaped,
    and today the one widget shipped is Google Identity Services."""
    from pramanyx.security import oidc
    from pramanyx.security.authz import identity_unverifiable, require_identity_enabled

    if not oidc.configured():
        # Required with nothing to verify it: the sentence every other route refuses with,
        # served here because this is where a client with no token learns what to do.
        return {"oidc_configured": False,
                "identity_required": require_identity_enabled(),
                "refusal": identity_unverifiable()}
    issuer = oidc.issuer()
    return {
        "oidc_configured": True,
        "identity_required": require_identity_enabled(),
        "issuer": issuer,
        "client_id": oidc.audience(),
        "provider": "google" if issuer == _GOOGLE_ISSUER else "generic",
    }


# ── The browser's session (Track A9) ──────────────────────────────────────────────

def _secure_here(request: Request) -> bool:
    """Whether the cookie may be marked Secure: the request came over TLS, directly or through a proxy
    that says so. On plain-HTTP localhost a Secure cookie is simply never sent back, which would read as
    a sign-in that does not stick."""
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").lower() == "https"


@router.post("/auth/session")
def open_session(request: Request, response: Response):
    """Exchange a verified ID token, presented ONCE as a bearer, for an HttpOnly session cookie.

    The token is verified exactly as every bearer is (``security/oidc.py``); nothing weaker mints a
    session — not the header seam, not a service principal, which already carry their own credential
    per request. The page then holds no credential a script can read (``web/lib/auth.ts``)."""
    from pramanyx.security import oidc, sessions
    if not oidc.configured():
        raise HTTPException(status_code=404, detail="no identity provider is configured; nothing to sign in to")
    try:
        principal = oidc.resolve_verified(request.headers.get("Authorization"))
    except oidc.OidcError as exc:
        raise HTTPException(status_code=401, detail=f"the token was refused: {exc}") from exc
    if principal is None:
        raise HTTPException(status_code=401, detail="present the identity provider's ID token as a bearer")
    secret, exp = sessions.mint(principal)
    response.set_cookie(sessions.COOKIE, secret, max_age=sessions.TTL_S, httponly=True, samesite="lax",
                        secure=_secure_here(request), path="/")
    return {"signed_in": True, "user_id": principal.user_id, "org_id": principal.org_id, "expires_at": exp}


@router.delete("/auth/session")
def close_session(request: Request, response: Response):
    """Sign out: the session row goes, and the cookie is cleared. Idempotent — a cookie nobody holds
    any more answers the same, so a double click or a stale tab never errors."""
    from pramanyx.security import sessions
    ended = sessions.revoke(request.cookies.get(sessions.COOKIE))
    response.delete_cookie(sessions.COOKIE, path="/")
    return {"signed_out": True, "ended": ended}


# ── The coworker's person (People, 2026-11-15) ─────────────────────────────────────────────────────────────────────

@router.post("/auth/delegation")
def delegate_to_the_coworker(request: Request):
    """A short-lived token naming the person this request is, for the coworker to present on their behalf
    (`security/delegation.py`). Minted only for a person: not for a service principal, not for the agent, and not
    from a delegation — a delegated request cannot pass itself on. With sign-in off, the person is the install's
    operator, who every write here is recorded under anyway."""
    from pramanyx.org.context import current_org_id
    from pramanyx.rbac.agent_gate import is_agent_request
    from pramanyx.security import delegation
    from pramanyx.security.authz import caller, get_principal, require_identity_enabled
    if delegation.presented(request) or is_agent_request(request):
        raise HTTPException(status_code=403, detail="Only a person can hand the coworker their identity.")
    principal = get_principal(request)
    if principal is None and require_identity_enabled():
        raise HTTPException(status_code=401, detail="Sign in first; the coworker acts for the person signed in.")
    user = principal.user_id if principal else caller()
    org = principal.org_id if principal else (current_org_id() or "default")
    try:
        token, exp = delegation.mint(user, org)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return {"token": token, "expires_at": exp, "user_id": user}


@router.delete("/auth/delegation")
def end_the_delegation(request: Request):
    """End the delegation this request presents. Idempotent."""
    from pramanyx.security import delegation
    return {"ended": delegation.revoke(request.headers.get(delegation.HEADER))}


@router.get("/auth/delegation")
def whose_delegation(request: Request):
    """Who the delegation this request presents names — how the coworker's host checks a token before keeping it.
    401 when none is presented or it does not resolve."""
    from pramanyx.security import delegation
    who = delegation.resolve(request.headers.get(delegation.HEADER))
    if who is None:
        raise HTTPException(status_code=401, detail="No delegation, or one that has ended.")
    return {"user_id": who.user_id, "org_id": who.org_id}
