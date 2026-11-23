"""The ChatGPT plan — the `chatgpt` backend's sign-in, its tokens, and its wire.

OpenAI lets an open-source, locally hosted app run on the person's own ChatGPT plan
("ChatGPT plan usage", https://developers.openai.com/siwc/token-sharing-open-source): the
person signs in through their browser (authorization code + PKCE, a loopback redirect to
`127.0.0.1`), and the app calls the public Responses API with the access token. A paid or
remotely hosted app is not this path; OpenAI routes those to an interest form.

Measured on a live account on 2026-11-23, before a line of this was written: plain text,
`instructions`, a strict `json_schema`, a forced and an automatic tool call, a tool-result
round trip with the history resent, a reasoning effort and a token refresh all answered.
Refused, each in the plan's own words: `stream: false` ("Stream must be set to true"),
`temperature` ("Unsupported parameter"), and `/chat/completions` (401, no matching rule).

So the wire is the one thing that differs, and it differs underneath everything else. The
provider builds the ordinary OpenAI client over :class:`PlanTransport`, which turns each
Chat Completions request into a streamed Responses request and the answer back into a Chat
Completions one. instructor, the tool loop, token usage, the call record, the error
classifier and the fallback chain all run the code every other binding runs. What the plan
does not take — `temperature`, `max_tokens`, `seed`, `stop`, … — is not sent, and the call
record says the sampling was the provider's default rather than claiming a temperature the
model never saw.

The sign-in lives in the inference config (`llm_config.json`, key ``chatgpt_plan``), beside
the API keys and encrypted like them. The access token lasts an hour and the refresh token
rotates on every refresh, so a refresh is serialised and its write holds the config lock: a
settings save racing it would otherwise drop the new refresh token, and the next refresh
would present a spent one and end the session.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Iterator, Optional
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

BACKEND = "chatgpt"
API_BASE = "https://api.openai.com/v1"
AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize"
TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token"
DISCOVERY_URL = "https://auth.openai.com/.well-known/openid-configuration"
ISSUER = "https://auth.openai.com"
#: Where a person sees and manages what their plan has used — OpenAI asks every app to link it.
USAGE_URL = "https://chatgpt.com/settings/usage"
#: The first-time registration entrypoint. Never saved: the callback returns the client id to keep.
REGISTRATION_CLIENT = "dynamic_agent_client"
#: Identity scopes, then the plan-usage ones. `chatgpt.tokens.use.direct` is what lets the token pay for calls.
SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
PLAN_SCOPE = "chatgpt.tokens.use.direct"
#: The path OpenAI holds the loopback redirect to, byte for byte; only the port may vary.
CALLBACK_PATH = "/auth/callback"
#: The name a person sees on OpenAI's consent screen (they may edit it there).
APP_NAME = "Pramanyx"

_CONFIG_KEY = "chatgpt_plan"
_PENDING_TTL_S = 600.0
#: Refresh this long before the access token expires, so a long call never starts on a token about to lapse.
_REFRESH_AHEAD_S = 300.0
#: A refresh answered with one of these ends the session: the refresh token is spent or revoked.
_TERMINAL_REFRESH = frozenset({"invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired",
                               "refresh_token_invalidated", "refresh_token_reused", "invalid_client"})


class PlanNotSignedIn(RuntimeError):
    """The `chatgpt` backend was asked for a call with nobody signed in, or after the session ended."""


# ── The stored sign-in ──────────────────────────────────────────────────────────────────────

def _read() -> dict:
    from pramanyx.llm.provider import read_config
    rec = read_config().get(_CONFIG_KEY)
    return dict(rec) if isinstance(rec, dict) else {}


def _update(mutate) -> dict:
    """Read, change and write the sign-in record under the config lock — the one writer pattern every
    writer of the inference config follows, so a token rotation and a settings save cannot drop each other."""
    from pramanyx.llm.provider import config_lock, read_config, write_config
    with config_lock():
        cfg = dict(read_config())
        rec = dict(cfg.get(_CONFIG_KEY) or {})
        mutate(rec)
        cfg[_CONFIG_KEY] = rec
        write_config(cfg)
        return rec


def _secret(rec: dict, field: str) -> str:
    from pramanyx.secretvault import decrypt_secret
    return decrypt_secret(rec.get(field)) or ""


def _host_id(rec: dict) -> str:
    """This install's host id: chosen once, before its first sign-in, and kept (OpenAI's rule). Opaque."""
    return str(rec.get("host_id") or f"urn:uuid:{uuid.uuid4()}")


def _store_tokens(rec: dict, tok: dict, *, now: Optional[float] = None) -> None:
    """Put a token response on the record — the access token, its expiry, the granted scopes and the
    ROTATED refresh token together, so a record never pairs a new access token with a spent refresh token."""
    from pramanyx.secretvault import encrypt_secret
    now = time.time() if now is None else now
    for field in ("access_token", "refresh_token", "id_token"):
        if tok.get(field):
            rec[field] = encrypt_secret(str(tok[field]))
    rec["expires_at"] = now + float(tok.get("expires_in") or 3600)
    if tok.get("earliest_refresh_at"):
        rec["earliest_refresh_at"] = float(tok["earliest_refresh_at"])
    if tok.get("scope"):
        rec["scopes"] = sorted(str(tok["scope"]).split())
    rec["saved_at"] = now
    rec.pop("ended", None)


def _clear_tokens(rec: dict, why: str) -> None:
    """Forget the tokens and say why. The registration (client id, host id, account) stays: the next
    sign-in is a returning one, with no consent screen."""
    for field in ("access_token", "refresh_token", "id_token", "expires_at", "earliest_refresh_at", "scopes"):
        rec.pop(field, None)
    rec["ended"] = {"why": why, "at": time.time()}


def status() -> dict:
    """What Settings shows: signed in or not, as whom, whether the plan may pay for calls, and why a
    session ended. Never a token."""
    rec = _read()
    signed_in = bool(rec.get("refresh_token") or rec.get("access_token"))
    scopes = list(rec.get("scopes") or [])
    return {
        "signed_in": signed_in,
        "account": rec.get("account") if signed_in else None,
        # A person can sign in and decline plan use on OpenAI's screen: signed in, and still no calls.
        "plan_usage": signed_in and PLAN_SCOPE in scopes,
        "ended": None if signed_in else (rec.get("ended") or {}).get("why"),
        "signing_in": _pending_count() > 0,
        "usage_url": USAGE_URL,
    }


def is_signed_in() -> bool:
    s = status()
    return bool(s["signed_in"] and s["plan_usage"])


# ── Sign-in ─────────────────────────────────────────────────────────────────────────────────

@dataclass
class _Pending:
    verifier: str
    nonce: str
    redirect_uri: str
    client_id: str           # REGISTRATION_CLIENT on a first sign-in, else the issued id
    host_id: str
    started: float


_pending: dict[str, _Pending] = {}
_pending_lock = threading.Lock()


def _pending_count() -> int:
    with _pending_lock:
        _expire_pending()
        return len(_pending)


def _expire_pending() -> None:
    cutoff = time.monotonic() - _PENDING_TTL_S
    for state in [s for s, p in _pending.items() if p.started < cutoff]:
        _pending.pop(state, None)


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def redirect_uri_for(port: int) -> str:
    """The loopback redirect for this API's own port. `127.0.0.1`, never `localhost` (OpenAI compares the
    URI byte for byte), and the path is fixed."""
    return f"http://127.0.0.1:{int(port)}{CALLBACK_PATH}"


def begin(redirect_uri: str) -> dict:
    """Start a sign-in: the URL the browser opens. The attempt waits ten minutes for the browser to return."""
    rec = _read()
    host_id = _host_id(rec)
    if not rec.get("host_id"):
        _update(lambda r: r.setdefault("host_id", host_id))      # chosen before the first sign-in, then kept
    client_id = str(rec.get("client_id") or REGISTRATION_CLIENT)
    state, nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(64)
    params = {
        "client_id": client_id, "ext_agent_host_id": host_id, "response_type": "code",
        "redirect_uri": redirect_uri, "scope": SCOPE, "resource": API_BASE, "state": state, "nonce": nonce,
        "code_challenge_method": "S256", "code_challenge": _b64url(hashlib.sha256(verifier.encode()).digest()),
    }
    if client_id == REGISTRATION_CLIENT:
        params["agent_name_hint"] = APP_NAME
    elif rec.get("account"):
        params["login_hint"] = str(rec["account"])
    with _pending_lock:
        _expire_pending()
        _pending[state] = _Pending(verifier, nonce, redirect_uri, client_id, host_id, time.monotonic())
    return {"authorize_url": f"{AUTHORIZE_URL}?{urlencode(params)}", "redirect_uri": redirect_uri,
            "expires_in": int(_PENDING_TTL_S)}


def _discovery(timeout: float = 10.0) -> dict:
    r = httpx.get(DISCOVERY_URL, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _verified_identity(id_token: str, *, client_id: str, nonce: str) -> dict:
    """The ID token's claims, its signature checked against OpenAI's published keys — issuer, audience
    (the issued client id), expiry and the nonce this attempt minted. Refused, never trusted unchecked."""
    import jwt

    jwks = jwt.PyJWKClient(_discovery()["jwks_uri"])
    key = jwks.get_signing_key_from_jwt(id_token)
    claims = jwt.decode(id_token, key.key, algorithms=["RS256", "ES256"], audience=client_id, issuer=ISSUER)
    if claims.get("nonce") != nonce:
        raise ValueError("the ID token's nonce does not match this sign-in")
    return claims


def complete(*, state: str, code: str = "", client_id: str = "", error: str = "") -> dict:
    """Finish a sign-in from the browser's return. Raises ``LookupError`` for a state no sign-in is waiting
    for (an old tab, a forged return) and ``ValueError`` with OpenAI's reason for a sign-in that failed."""
    with _pending_lock:
        _expire_pending()
        p = _pending.pop(state, None) if state else None
    if p is None:
        raise LookupError("no ChatGPT sign-in is waiting for this return — it expired after ten minutes or was "
                          "already used. Start it again from Settings ▸ Inference.")
    if error:
        raise ValueError(f"ChatGPT did not complete the sign-in: {error}")
    if not code:
        raise ValueError("ChatGPT returned without a sign-in code")
    issued = client_id or ("" if p.client_id == REGISTRATION_CLIENT else p.client_id)
    if not issued:
        raise ValueError("ChatGPT returned no client id for this new registration, so it is incomplete — "
                         "sign in again")
    if p.client_id != REGISTRATION_CLIENT and issued != p.client_id:
        raise ValueError("ChatGPT returned a different client id than this install registered — refused")
    r = httpx.post(TOKEN_URL, data={"grant_type": "authorization_code", "client_id": issued, "code": code,
                                    "code_verifier": p.verifier, "redirect_uri": p.redirect_uri,
                                    "resource": API_BASE}, timeout=30.0)
    if r.status_code != 200:
        raise ValueError(f"ChatGPT refused the sign-in code (HTTP {r.status_code}): {_said(r)}")
    tok = r.json()
    claims = _verified_identity(str(tok.get("id_token") or ""), client_id=issued, nonce=p.nonce)

    def put(rec: dict) -> None:
        rec.update({"client_id": issued, "host_id": p.host_id, "subject": claims.get("sub"),
                    "account": claims.get("email")})
        _store_tokens(rec, tok)

    rec = _update(put)
    return {"signed_in": True, "account": rec.get("account"), "plan_usage": PLAN_SCOPE in (rec.get("scopes") or [])}


def sign_out() -> dict:
    """End the session: the tokens leave the durable record FIRST, then the refresh token is revoked with
    OpenAI. A revocation that fails is said; the session here has ended either way."""
    rec = _read()
    refresh, client_id = _secret(rec, "refresh_token"), str(rec.get("client_id") or "")
    _update(lambda r: _clear_tokens(r, "signed out in Settings"))
    revoked: Optional[str] = None
    if refresh and client_id:
        try:
            endpoint = _discovery().get("revocation_endpoint")
            if endpoint:
                httpx.post(endpoint, data={"token": refresh, "token_type_hint": "refresh_token",
                                           "client_id": client_id}, timeout=10.0).raise_for_status()
                revoked = "revoked"
        except Exception as exc:
            revoked = f"not revoked with OpenAI ({type(exc).__name__}); revoke it from your ChatGPT settings"
    return {**status(), "revocation": revoked}


# ── Tokens ──────────────────────────────────────────────────────────────────────────────────

_refresh_lock = threading.Lock()


def _said(r: httpx.Response) -> str:
    try:
        body = r.json()
    except ValueError:
        return r.text[:200]
    err = body.get("error")
    if isinstance(err, dict):
        return str(err.get("message") or err.get("code") or err)[:200]
    return str(body.get("error_description") or err or body.get("detail") or body)[:200]


def _error_code(r: httpx.Response) -> str:
    try:
        body = r.json()
    except ValueError:
        return ""
    err = body.get("error")
    return str((err.get("code") if isinstance(err, dict) else err) or "")


def access_token() -> str:
    """A usable access token, refreshed ahead of expiry. One refresh at a time: the refresh token rotates,
    and two threads presenting the same one would spend it twice (`refresh_token_reused`) and end the session."""
    rec = _read()
    if not rec.get("refresh_token") and not rec.get("access_token"):
        why = (rec.get("ended") or {}).get("why")
        raise PlanNotSignedIn("nobody is signed in to a ChatGPT plan here"
                              + (f" ({why})" if why else "")
                              + " — sign in from Settings ▸ Inference ▸ Continue with ChatGPT")
    if PLAN_SCOPE not in (rec.get("scopes") or []):
        raise PlanNotSignedIn("the ChatGPT sign-in did not allow plan usage — sign in again and allow it")
    if float(rec.get("expires_at") or 0) - time.time() > _REFRESH_AHEAD_S:
        return _secret(rec, "access_token")
    with _refresh_lock:
        rec = _read()                    # another thread may have refreshed while this one waited
        if float(rec.get("expires_at") or 0) - time.time() > _REFRESH_AHEAD_S:
            return _secret(rec, "access_token")
        return _refresh(rec)


def _refresh(rec: dict) -> str:
    refresh, client_id = _secret(rec, "refresh_token"), str(rec.get("client_id") or "")
    if not refresh or not client_id:
        _update(lambda r: _clear_tokens(r, "the stored sign-in has no refresh token"))
        raise PlanNotSignedIn("the ChatGPT session cannot be renewed — sign in again from Settings ▸ Inference")
    r = httpx.post(TOKEN_URL, data={"grant_type": "refresh_token", "client_id": client_id,
                                    "refresh_token": refresh, "resource": API_BASE}, timeout=30.0)
    if r.status_code == 200:
        tok = r.json()
        _update(lambda rr: _store_tokens(rr, tok))
        return str(tok["access_token"])
    code = _error_code(r)
    if code in _TERMINAL_REFRESH or (r.status_code in (400, 401) and not code):
        why = f"ChatGPT ended the session ({code or f'HTTP {r.status_code}'})"
        _update(lambda rr: _clear_tokens(rr, why))
        raise PlanNotSignedIn(f"{why} — sign in again from Settings ▸ Inference")
    # A network or server fault keeps the credentials: the session has not ended, the refresh just did not land.
    expires_at = float(rec.get("expires_at") or 0)
    if expires_at > time.time():
        logger.warning("chatgpt plan: refresh failed (HTTP %s, %s); the current token still has %.0fs",
                       r.status_code, code or "no code", expires_at - time.time())
        return _secret(rec, "access_token")
    raise httpx.HTTPStatusError(f"ChatGPT could not renew the session (HTTP {r.status_code}): {_said(r)}",
                                request=r.request, response=r)


def list_models(*, timeout: float = 6.0) -> list[dict]:
    """The models this account may use, in OpenAI's order — `visibility: list` only, as OpenAI asks."""
    r = httpx.get(f"{API_BASE}/models", headers={"Authorization": f"Bearer {access_token()}"}, timeout=timeout)
    r.raise_for_status()
    body = r.json()
    rows = body.get("models") if isinstance(body.get("models"), list) else body.get("data") or []
    out = []
    for m in rows:
        slug = m.get("slug") or m.get("id")
        if not slug or m.get("visibility") not in (None, "list"):
            continue
        entry: dict[str, Any] = {"id": str(slug), "source": "live"}
        if m.get("display_name"):
            entry["label"] = str(m["display_name"])
        ctx = m.get("context_window") or m.get("max_context_window")
        if isinstance(ctx, int) and ctx > 0:
            entry["context"] = ctx
        out.append(entry)
    return out


# ── The wire: Chat Completions in, Responses out ────────────────────────────────────────────

#: Chat Completions fields the plan's Responses API does not take. Not sent; see the module note.
_NOT_SENT = frozenset({"temperature", "top_p", "max_tokens", "max_completion_tokens", "n", "seed", "stop", "user",
                       "presence_penalty", "frequency_penalty", "logprobs", "top_logprobs", "logit_bias",
                       "metadata", "service_tier", "store", "prediction", "modalities", "audio", "stream_options",
                       "safety_identifier", "prompt_cache_retention", "verbosity", "web_search_options"})

#: A plan refusal's code → the HTTP status the OpenAI client and our classifier read it by. The 429 is what sends
#: a spent allowance to the quota cooldown and the fallback chain; the 503s are retried with backoff.
_STATUS_FOR_CODE = {
    "subscription_sharing_usage_limit_exceeded": 429,
    "subscription_sharing_usage_unavailable": 503,
    "subscription_sharing_user_unavailable": 503,
    "subscription_sharing_unsupported_capability": 400,
    "subscription_sharing_route_not_supported": 404,
    "subscription_sharing_invalid_user": 401,
    "subscription_sharing_user_not_eligible": 403,
    "chatpass_v2_scope_not_authorized": 403,
    "chatpass_v2_invalid_authorization_context": 403,
    "rate_limit_exceeded": 429,
    "server_error": 500,
}

_LIMIT_WORDS = (f"Your ChatGPT plan's usage limit is reached (subscription_sharing_usage_limit_exceeded). "
                f"See {USAGE_URL}; calls go to the fallback until it resets.")


def _text_of(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(str(p.get("text") or "") for p in content if isinstance(p, dict))
    return str(content)


def _input_parts(content: Any) -> Any:
    """A user message's content as Responses input: a string stays a string; parts become input parts."""
    if not isinstance(content, list):
        return _text_of(content)
    parts = []
    for p in content:
        if not isinstance(p, dict):
            continue
        if p.get("type") == "text":
            parts.append({"type": "input_text", "text": str(p.get("text") or "")})
        elif p.get("type") == "image_url":
            url = p.get("image_url")
            parts.append({"type": "input_image", "image_url": url.get("url") if isinstance(url, dict) else url})
    return parts


def to_responses(body: dict) -> dict:
    """A Chat Completions request body as the plan's Responses request: always streamed, never stored."""
    out: dict[str, Any] = {"model": body.get("model"), "store": False, "stream": True}
    instructions: list[str] = []
    items: list[dict] = []
    for m in body.get("messages") or []:
        role = m.get("role")
        if role in ("system", "developer"):
            # An explicit system input item is refused by the plan; the system prompt rides as instructions.
            text = _text_of(m.get("content"))
            if text:
                instructions.append(text)
        elif role == "user":
            items.append({"role": "user", "content": _input_parts(m.get("content"))})
        elif role == "assistant":
            text = _text_of(m.get("content"))
            if text:
                items.append({"role": "assistant", "content": text})
            for tc in m.get("tool_calls") or []:
                fn = tc.get("function") or {}
                items.append({"type": "function_call", "call_id": tc.get("id"), "name": fn.get("name"),
                              "arguments": fn.get("arguments") or "{}"})
        elif role == "tool":
            items.append({"type": "function_call_output", "call_id": m.get("tool_call_id"),
                          "output": _text_of(m.get("content"))})
    if instructions:
        out["instructions"] = "\n\n".join(instructions)
    out["input"] = items
    tools = []
    for t in body.get("tools") or []:
        fn = t.get("function") if t.get("type") == "function" else None
        if not fn:
            continue
        tools.append({"type": "function", "name": fn.get("name"), "description": fn.get("description") or "",
                      "parameters": fn.get("parameters") or {"type": "object", "properties": {}},
                      # The Responses API reads an absent `strict` as TRUE; the platform's tool schemas are not
                      # written to strict's rules, so it is false unless the caller asked for it.
                      "strict": bool(fn.get("strict", False))})
    if tools:
        out["tools"] = tools
    choice = body.get("tool_choice")
    if isinstance(choice, dict) and choice.get("type") == "function":
        out["tool_choice"] = {"type": "function", "name": (choice.get("function") or {}).get("name")}
    elif isinstance(choice, str) and tools:
        out["tool_choice"] = choice
    if "parallel_tool_calls" in body and tools:
        out["parallel_tool_calls"] = bool(body["parallel_tool_calls"])
    fmt = body.get("response_format") or {}
    if fmt.get("type") == "json_object":
        out["text"] = {"format": {"type": "json_object"}}
    elif fmt.get("type") == "json_schema":
        js = fmt.get("json_schema") or {}
        out["text"] = {"format": {"type": "json_schema", "name": js.get("name") or "response",
                                  "schema": js.get("schema") or {}, "strict": bool(js.get("strict", False)),
                                  **({"description": js["description"]} if js.get("description") else {})}}
    effort = body.get("reasoning_effort") or (body.get("reasoning") or {}).get("effort")
    if effort:
        out["reasoning"] = {"effort": effort}
    return out


def _event(data: str) -> Optional[dict]:
    """One `data:` line as an event, or None for a line that is not one. Counted, not swallowed: a stream the
    plan garbles shows up as `llm.chatgpt_unreadable_event` rather than as an answer that quietly lost a piece."""
    try:
        ev = json.loads(data)
    except ValueError as exc:
        from pramanyx.kernel.errors import tolerate
        tolerate(exc, "a ChatGPT plan stream line was not JSON; skipped", counter="llm.chatgpt_unreadable_event")
        return None
    return ev if isinstance(ev, dict) else None


def _sse_events(lines: Iterator[str]) -> Iterator[dict]:
    for line in lines:
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        ev = _event(data) if data and data != "[DONE]" else None
        if ev is not None:
            yield ev


def _usage(resp: dict) -> Optional[dict]:
    u = resp.get("usage")
    if not isinstance(u, dict):
        return None
    pin, pout = int(u.get("input_tokens") or 0), int(u.get("output_tokens") or 0)
    return {"prompt_tokens": pin, "completion_tokens": pout, "total_tokens": pin + pout,
            "prompt_tokens_details": {"cached_tokens": int((u.get("input_tokens_details") or {})
                                                           .get("cached_tokens") or 0)},
            "completion_tokens_details": {"reasoning_tokens": int((u.get("output_tokens_details") or {})
                                                                  .get("reasoning_tokens") or 0)}}


def _error_body(code: str, message: str, param: Any = None) -> dict:
    return {"error": {"message": message, "type": "chatgpt_plan", "code": code or None, "param": param}}


def _failure(ev: dict) -> tuple[int, dict]:
    """A `response.failed` (or `error`) event as an HTTP status and an OpenAI-shaped error body."""
    err = (ev.get("response") or {}).get("error") or ev.get("error")
    if err is None and ev.get("type") == "error":      # an `error` event carries its fields at the top
        err = {k: ev.get(k) for k in ("code", "message", "param")}
    if not isinstance(err, dict):
        err = {"message": str(err or "")}
    code = str(err.get("code") or "")
    message = _LIMIT_WORDS if code == "subscription_sharing_usage_limit_exceeded" else (
        f"{err.get('message') or 'the ChatGPT plan refused the call'} ({code or 'no code'})")
    return _STATUS_FOR_CODE.get(code, 500), _error_body(code, message, err.get("param"))


class _Assembly:
    """The parts of one streamed Responses answer, gathered as the events arrive."""

    def __init__(self, model: str):
        self.id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
        self.model = model
        self.created = int(time.time())
        self.text: list[str] = []
        self.calls: list[dict] = []            # {id, name, arguments}
        self._index: dict[str, int] = {}       # output item id → position in `calls`
        self.usage: Optional[dict] = None
        self.finish = "stop"
        self.failed: Optional[tuple[int, dict]] = None
        self.done = False

    def take(self, ev: dict) -> list[dict]:
        """Fold one event in; return the Chat Completions deltas it stands for."""
        typ = ev.get("type", "")
        if typ == "response.created":
            self.model = (ev.get("response") or {}).get("model") or self.model
            return [{"role": "assistant"}]
        if typ == "response.output_text.delta":
            d = str(ev.get("delta") or "")
            self.text.append(d)
            return [{"content": d}] if d else []
        if typ == "response.output_item.added" and (ev.get("item") or {}).get("type") == "function_call":
            it = ev["item"]
            self._index[str(it.get("id"))] = len(self.calls)
            self.calls.append({"id": it.get("call_id"), "name": it.get("name"), "arguments": ""})
            i = len(self.calls) - 1
            return [{"tool_calls": [{"index": i, "id": it.get("call_id"), "type": "function",
                                     "function": {"name": it.get("name"), "arguments": ""}}]}]
        if typ == "response.function_call_arguments.delta":
            i = self._index.get(str(ev.get("item_id")))
            if i is None:
                return []
            d = str(ev.get("delta") or "")
            self.calls[i]["arguments"] += d
            return [{"tool_calls": [{"index": i, "function": {"arguments": d}}]}] if d else []
        if typ == "response.output_item.done" and (ev.get("item") or {}).get("type") == "function_call":
            it = ev["item"]
            i = self._index.get(str(it.get("id")))
            if i is not None and it.get("arguments") is not None:
                self.calls[i]["arguments"] = str(it["arguments"])       # the final text is the authority
            return []
        if typ in ("response.completed", "response.incomplete"):
            resp = ev.get("response") or {}
            self.usage = _usage(resp)
            if typ == "response.incomplete":
                reason = (resp.get("incomplete_details") or {}).get("reason")
                self.finish = "content_filter" if reason == "content_filter" else "length"
            elif self.calls:
                self.finish = "tool_calls"
            self.done = True
            return []
        if typ in ("response.failed", "error"):
            self.failed = _failure(ev)
            self.done = True
        return []

    def completion(self) -> dict:
        message: dict[str, Any] = {"role": "assistant", "content": "".join(self.text) or None}
        if self.calls:
            message["tool_calls"] = [{"id": c["id"], "type": "function",
                                      "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
                                     for c in self.calls]
        return {"id": self.id, "object": "chat.completion", "created": self.created, "model": self.model,
                "choices": [{"index": 0, "message": message, "finish_reason": self.finish, "logprobs": None}],
                **({"usage": self.usage} if self.usage else {})}

    def chunk(self, delta: dict, finish: Optional[str] = None) -> bytes:
        c = {"id": self.id, "object": "chat.completion.chunk", "created": self.created, "model": self.model,
             "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
        return f"data: {json.dumps(c)}\n\n".encode()


class _ChunkStream(httpx.SyncByteStream):
    """The streamed answer, re-said as Chat Completions chunks while the plan is still writing it."""

    def __init__(self, asm: _Assembly, head: list[bytes], events: Iterator[dict], upstream: httpx.Response,
                 include_usage: bool):
        self._asm, self._head, self._events, self._up, self._usage = asm, head, events, upstream, include_usage

    def __iter__(self) -> Iterator[bytes]:
        try:
            yield from self._head
            for ev in self._events:
                for d in self._asm.take(ev):
                    yield self._asm.chunk(d)
                if self._asm.done:
                    break
            if self._asm.failed:
                # Mid-stream: the OpenAI client raises on an `error` member in a chunk.
                yield f"data: {json.dumps(self._asm.failed[1])}\n\n".encode()
                return
            yield self._asm.chunk({}, self._asm.finish)
            if self._usage and self._asm.usage:
                tail = {"id": self._asm.id, "object": "chat.completion.chunk", "created": self._asm.created,
                        "model": self._asm.model, "choices": [], "usage": self._asm.usage}
                yield f"data: {json.dumps(tail)}\n\n".encode()
            yield b"data: [DONE]\n\n"
        finally:
            self._up.close()

    def close(self) -> None:
        self._up.close()


class PlanTransport(httpx.BaseTransport):
    """An httpx transport for the OpenAI client: Chat Completions in, the plan's Responses API out.

    Every request carries a fresh access token (refreshed ahead of expiry), so a provider the cache keeps
    for hours never sends a lapsed one. Any path but chat completions is refused by name — the plan serves
    the Responses API only, and a silent pass-through would be a 401 that blames the sign-in."""

    def __init__(self, upstream: Optional[httpx.Client] = None):
        self._http = upstream or httpx.Client(timeout=httpx.Timeout(180.0, connect=15.0))

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        if not request.url.path.rstrip("/").endswith("/chat/completions"):
            return self._json(404, _error_body("subscription_sharing_route_not_supported",
                                               f"the ChatGPT plan serves the Responses API only; "
                                               f"{request.url.path} is not offered through it"), request)
        try:
            body = json.loads(request.read() or b"{}")
        except ValueError:
            return self._json(400, _error_body("invalid_request", "the request body is not JSON"), request)
        try:
            token = access_token()
        except PlanNotSignedIn as exc:
            return self._json(401, _error_body("not_signed_in", str(exc)), request)
        wants_stream = bool(body.get("stream"))
        include_usage = bool((body.get("stream_options") or {}).get("include_usage"))
        rbody = to_responses(body)
        up = self._http.send(self._http.build_request(
            "POST", f"{API_BASE}/responses", json=rbody,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                     "Accept": "text/event-stream"}), stream=True)
        rid = {"x-request-id": up.headers["x-request-id"]} if up.headers.get("x-request-id") else {}
        if up.status_code != 200:
            raw = up.read()
            up.close()
            return self._json(up.status_code, self._refusal(up.status_code, raw), request, rid)
        asm = _Assembly(str(body.get("model") or ""))
        events = _sse_events(up.iter_lines())
        if not wants_stream:
            try:
                for ev in events:
                    asm.take(ev)
                    if asm.done:
                        break
            finally:
                up.close()
            if asm.failed:
                return self._json(asm.failed[0], asm.failed[1], request, rid)
            if not asm.done:
                return self._json(502, _error_body("stream_interrupted", "the ChatGPT plan's answer stopped before "
                                                   "it was complete"), request, rid)
            return self._json(200, asm.completion(), request, rid)
        # Streamed: hold the answer until its first word, so a refusal before any output is still an HTTP error
        # the retry ladder and the fallback chain can read — not a 200 whose body turns out to be an error.
        head: list[bytes] = []
        for ev in events:
            deltas = asm.take(ev)
            head.extend(asm.chunk(d) for d in deltas)
            if asm.failed:                       # nothing written yet: refused as an HTTP error
                up.close()
                return self._json(asm.failed[0], asm.failed[1], request, rid)
            if asm.done or any(d.get("content") or d.get("tool_calls") for d in deltas):
                break
        return httpx.Response(200, headers={"content-type": "text/event-stream", **rid},
                              stream=_ChunkStream(asm, head, events, up, include_usage), request=request)

    @staticmethod
    def _refusal(status: int, raw: bytes) -> dict:
        """A refusal before the stream opened, said in the shape the OpenAI client reads. OpenAI's own
        words stay, for the reader and the classifier."""
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            body = {"detail": raw.decode(errors="replace")[:300]}
        err = body.get("error")
        if isinstance(err, dict):
            code = str(err.get("code") or "")
            if code == "subscription_sharing_usage_limit_exceeded":
                return _error_body(code, _LIMIT_WORDS, err.get("param"))
            return _error_body(code, str(err.get("message") or code or f"HTTP {status}"), err.get("param"))
        return _error_body("", str(body.get("detail") or err or f"HTTP {status}"))

    @staticmethod
    def _json(status: int, payload: dict, request: httpx.Request, headers: Optional[dict] = None) -> httpx.Response:
        return httpx.Response(status, json=payload, headers=headers or {}, request=request)

    def close(self) -> None:
        self._http.close()
