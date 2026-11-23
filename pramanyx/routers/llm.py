"""LLM provider configuration — Settings → Inference.

Lets a user switch the inference backend / models / API keys at runtime (no env
edit, no restart). Keys are secretvault-encrypted on disk and never returned to
the client (GET reports only whether each key is set)."""
from __future__ import annotations

from typing import Optional

from html import escape

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from pramanyx.licensing import Capability, gate
from pramanyx.llm import provider as _provider
from pramanyx.security.authz import connection_owner_guard

#: DATA-06 — every connection a door of this router names belongs to the caller's org (identity on).
router = APIRouter(tags=["llm"], dependencies=[Depends(connection_owner_guard)])


@router.get("/llm/config")
def get_llm_config():
    """The effective inference config — backend, models, base URLs, which keys are
    set, plus the available backends and per-backend default models for the UI."""
    return _provider.current_config()


class _ConfigPatch(BaseModel):
    backend: Optional[str] = None
    models: Optional[dict] = None       # {coder?, narrator?, fast?}  ("" clears)
    base_urls: Optional[dict] = None    # {ollama?, lmstudio?}        ("" clears)
    keys: Optional[dict] = None         # {groq?, together?, anthropic?}  ("" clears, masked = unchanged)
    # Where calls go when the primary fails: {backend?, model?}. "" = the built-in order,
    # "none" = no fallback at all, a backend name = that one link. One model serves every
    # role, which is what Settings offers; per-role pins remain an env-only contract.
    fallback: Optional[dict] = None
    # Free-by-default: binding a non-`:free` OpenRouter model is refused unless
    # this is set — paying must be a deliberate act, never a typo.
    allow_paid: Optional[bool] = None
    # {backend: [model, …]} — models the operator has decided to run in JSON structured
    # output instead of tool calling. Per backend the list REPLACES; [] clears.
    json_mode: Optional[dict] = None


@router.post("/llm/config", dependencies=[gate(Capability.SECURITY_SUITE)])
def set_llm_config(patch: _ConfigPatch):
    """Merge a partial config and reload live providers. Returns the new config.

    Gated (SEC-10): changing the inference backend / models / API keys is an
    admin-grade action — an ungated caller could pivot all inference to an
    attacker endpoint (exfil) or set keys. Default tier is enterprise, so this is
    a no-op today; it becomes real the moment lower tiers exist.
    """
    try:
        return _provider.set_config(patch.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class _ProviderIn(BaseModel):
    name: str                            # what the pickers call it; its id is derived from it and fixed
    base_url: str                        # the address its OpenAI-compatible API answers on
    api_key: Optional[str] = None        # write-only; "" or absent = a keyless endpoint
    models: Optional[list[str]] = None   # model ids to offer where the provider lists none


class _ProviderEdit(BaseModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None        # absent/masked = unchanged, "" = remove the stored key
    models: Optional[list[str]] = None   # REPLACES the listed ids; [] clears them


@router.post("/llm/providers", dependencies=[gate(Capability.SECURITY_SUITE)])
def add_llm_provider(body: _ProviderIn):
    """Add a named OpenAI-compatible provider (Azure OpenAI, Mistral, DeepSeek, xAI, a keyed vLLM …).

    It joins the one list of providers: it can serve the roles, be the fallback, and list its models in the
    picker. Its key is encrypted with the others and never returned. Gated like the config it extends — a new
    endpoint is where prompts can be sent. Refused (400, with a sentence) when the name collides with a
    built-in or an added provider."""
    try:
        return _provider.add_provider(body.name, body.base_url, api_key=body.api_key or "",
                                      models=body.models)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/llm/providers/{provider_id}", dependencies=[gate(Capability.SECURITY_SUITE)])
def edit_llm_provider(provider_id: str, body: _ProviderEdit):
    """Edit an added provider's base URL, key or listed models. Its name is its identity and stays."""
    try:
        return _provider.update_provider(provider_id, base_url=body.base_url, api_key=body.api_key,
                                         models=body.models)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/llm/providers/{provider_id}", dependencies=[gate(Capability.SECURITY_SUITE)])
def remove_llm_provider(provider_id: str):
    """Remove an added provider and what is stored for it. Settings that named it — the provider every role
    ran on, the fallback, an organisation's own binding — are cleared, and ``said`` says each one."""
    try:
        return _provider.remove_provider(provider_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class _TestRequest(BaseModel):
    backend: Optional[str] = None
    model: Optional[str] = None            # explicit → test just that one
    include_agents: bool = False           # also ping each per-agent pinned model
    force: bool = False                    # bypass the short-TTL verdict cache (real re-probe)
    models: Optional[dict[str, str]] = None  # the role → model on the form, not saved yet: what is tested


@router.post("/llm/config/test")
def test_llm_config(req: Optional[_TestRequest] = None):
    """Real completions against a backend to confirm it is reachable and configured.

    Tests every DISTINCT model the deployment would use — all three role
    bindings, and the per-agent pins with ``include_agents`` — not just the coder
    model. A single-model check said nothing about a narrator or fast binding
    that may be a different model entirely.
    """
    req = req or _TestRequest()
    return _provider.test_provider(backend=req.backend, model=req.model,
                                   include_agents=req.include_agents, force=req.force, models=req.models)


class _CustomModelIn(BaseModel):
    backend: str
    model: str


@router.get("/llm/models")
def list_llm_models(backend: Optional[str] = None, refresh: bool = False):
    """The model catalogue for the picker — live list where the backend serves
    one, a curated floor otherwise, plus the user's kept custom entries.

    Not gated: reading which models exist is not privileged, and the picker needs
    it to render. Writing the config (which model to USE, and the keys) stays
    behind SECURITY_SUITE on POST /llm/config.
    """
    from pramanyx.llm import models as _models

    target = backend or _provider.current_config()["backend"]
    try:
        return _models.list_models(target, refresh=refresh)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/llm/models", dependencies=[gate(Capability.SECURITY_SUITE)])
def add_llm_model(body: _CustomModelIn):
    """Keep a typed model in the picker for next time. Idempotent.

    Gated with the rest of the inference config: a custom entry is a suggestion
    an operator will later click, so writing it is the same trust boundary as
    writing the config it feeds.
    """
    from pramanyx.llm import models as _models

    try:
        return {"backend": body.backend,
                "custom": _models.add_custom_model(body.backend, body.model)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/llm/models", dependencies=[gate(Capability.SECURITY_SUITE)])
def remove_llm_model(backend: str, model: str):
    """Drop a custom entry. Built-in and live entries are not removable — hiding
    a model the backend actually serves would make the picker lie."""
    from pramanyx.llm import models as _models

    try:
        return {"backend": backend,
                "custom": _models.remove_custom_model(backend, model)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class _ProbeRequest(BaseModel):
    role: Optional[str] = None       # which role's bound model to probe (default coder)
    rounds: Optional[int] = None     # shared/distinct calls per series (probe's own default)


@router.post("/llm/config/cache-probe")
def cache_probe(req: Optional[_ProbeRequest] = None):
    """Measure whether the active binding reuses a shared prompt prefix across requests
    (PLATFORM_ARCHITECTURE.md §5b.3) and persist the verdict so the capability seam adopts
    it. Makes a handful of real completions — defaults to the coder role's model.

    The verdict may be ``inconclusive``, which CLEARS any persisted override rather than
    writing one, and the report then carries a ``reason``. That is a real answer: latency
    inference cannot resolve prefix caching on a noisy hosted binding, and this probe used
    to return confident contradictory verdicts instead of saying so.
    """
    from pramanyx.llm import cache_probe as _probe

    req = req or _ProbeRequest()
    # `rounds` is forwarded only when the caller named one. Repeating a default here is how
    # the route silently pinned 3 after the probe itself moved to 5 — one default, one
    # place, and the probe owns it.
    kw = {"rounds": req.rounds} if req.rounds else {}
    return _probe.probe_prefix_cache(role=(req.role or "coder"), **kw)


# ── The ChatGPT plan's sign-in (pramanyx/llm/chatgpt_plan.py) ─────────────────────────────────

def _loopback(host: str) -> bool:
    return host in ("127.0.0.1", "::1", "localhost") or host.startswith("127.")


@router.post("/llm/chatgpt/sign-in", dependencies=[gate(Capability.SECURITY_SUITE)])
def chatgpt_sign_in(request: Request) -> dict:
    """Start a sign-in to the person's ChatGPT plan: the URL their browser opens. OpenAI returns the browser to
    this API on `127.0.0.1` at the port it listens on, so the browser must be on the machine the API runs on —
    refused with that reason otherwise, rather than sending a person to a sign-in that cannot come back."""
    from pramanyx.llm import chatgpt_plan

    client = (request.client.host if request.client else "") or ""
    if client and not _loopback(client):
        raise HTTPException(status_code=409, detail=(
            "Sign in to ChatGPT from a browser on the machine this API runs on: OpenAI returns the browser to "
            "127.0.0.1, which from another machine is that machine, not this one."))
    server = request.scope.get("server") or ("127.0.0.1", request.url.port or 8000)
    return chatgpt_plan.begin(chatgpt_plan.redirect_uri_for(int(server[1])))


@router.get("/auth/callback", response_class=HTMLResponse, include_in_schema=False)
def chatgpt_callback(state: str = "", code: str = "", client_id: str = "", error: str = "",
                     error_description: str = "") -> HTMLResponse:
    """Where OpenAI returns the browser after a ChatGPT sign-in. Exempt from the API key (`api._AUTH_EXEMPT`):
    the return carries none, and the unguessable `state` this install minted is what is verified — a state no
    sign-in is waiting for is refused."""
    from pramanyx.llm import chatgpt_plan

    def page(title: str, words: str, status: int = 200) -> HTMLResponse:
        return HTMLResponse(f"<!doctype html><meta charset=utf-8><title>{escape(title)}</title>"
                            f"<body style='font:14px system-ui;margin:48px'><h1 style='font-size:18px'>"
                            f"{escape(title)}</h1><p>{escape(words)}</p></body>", status_code=status)
    try:
        out = chatgpt_plan.complete(state=state, code=code, client_id=client_id,
                                    error=(error_description or error))
    except LookupError as exc:
        return page("Sign-in not completed", str(exc), 404)
    except Exception as exc:
        return page("Sign-in failed", str(exc)[:400], 400)
    if not out["plan_usage"]:
        return page("Signed in, without plan use",
                    "ChatGPT signed you in but did not allow Pramanyx to use your plan, so no model calls will run "
                    "on it. Sign in again from Settings ▸ Inference and allow it.")
    return page("You're using your ChatGPT plan",
                f"Signed in as {out.get('account') or 'your ChatGPT account'}. Model calls on the ChatGPT backend "
                "now draw on your plan. You can close this tab and go back to Pramanyx.")


@router.post("/llm/chatgpt/sign-out", dependencies=[gate(Capability.SECURITY_SUITE)])
def chatgpt_sign_out() -> dict:
    """End the ChatGPT session: the tokens are forgotten here first, then revoked with OpenAI. Calls bound to the
    ChatGPT backend refuse by name until someone signs in again; the fallback chain still serves them."""
    from pramanyx.llm import chatgpt_plan

    return chatgpt_plan.sign_out()
