"""The `chatgpt` backend runs on a person's ChatGPT plan (2026-11-23).

The user asked whether the platform could run on an LLM provider subscription. Of the vendors, OpenAI's
"ChatGPT plan usage" is the one that allows an open-source, locally hosted app to: the person signs in
through their browser and the app calls the Responses API with that token. A probe on the user's live
account measured what the plan takes before any of this was built — `json_schema` output, forced and
automatic tool calls, a tool-result round trip, reasoning effort and a token refresh answered; `stream:
false`, `temperature` and `/chat/completions` were refused.

So the platform's Chat Completions calls ride a translating transport (`chatgpt_plan.PlanTransport`), and
these tests hold it to the plan's rules without a network: every request upstream is caught by an
`httpx.MockTransport` that answers as the plan did in the probe. Nothing is spent and nothing leaves the
machine. The suite's no-key guarantee (no fallback chain) holds throughout.
"""
from __future__ import annotations

import json
import threading
import time

import httpx
import openai
import pytest
from pydantic import BaseModel

from pramanyx.llm import chatgpt_plan as CP
from pramanyx.llm import provider as P
from pramanyx.secretvault import decrypt_secret, encrypt_secret

# ── a stand-in for the plan's Responses API ────────────────────────────────────────────────


def _sse(*events: dict) -> bytes:
    return b"".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n".encode() for e in events)


def _text_answer(text: str, *, usage=(40, 7)) -> bytes:
    half = len(text) // 2
    return _sse({"type": "response.created", "response": {"id": "resp_1", "model": "plan-model"}},
                {"type": "response.output_text.delta", "delta": text[:half]},
                {"type": "response.output_text.delta", "delta": text[half:]},
                {"type": "response.completed", "response": {"status": "completed", "usage": {
                    "input_tokens": usage[0], "output_tokens": usage[1],
                    "input_tokens_details": {"cached_tokens": 0},
                    "output_tokens_details": {"reasoning_tokens": 2}}}})


def _tool_answer() -> bytes:
    item = {"type": "function_call", "id": "fc_1", "call_id": "call_9", "name": "run_sql", "arguments": ""}
    return _sse({"type": "response.created", "response": {"id": "resp_2"}},
                {"type": "response.output_item.added", "item": item},
                {"type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": '{"sql":"SELECT'},
                {"type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": ' 1"}'},
                {"type": "response.output_item.done", "item": {**item, "arguments": '{"sql":"SELECT 1"}'}},
                {"type": "response.completed", "response": {"usage": {"input_tokens": 70, "output_tokens": 12}}})


def _limit_reached() -> bytes:
    return _sse({"type": "response.created", "response": {"id": "resp_3"}},
                {"type": "response.failed", "response": {"error": {
                    "code": "subscription_sharing_usage_limit_exceeded", "message": "usage limit reached"}}})


class _Plan:
    """Answers each POST /v1/responses with the next scripted body, and keeps what was sent."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.sent: list[dict] = []
        self.headers: list[httpx.Headers] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/responses", request.url.path
        self.sent.append(json.loads(request.content))
        self.headers.append(request.headers)
        answer = self.answers.pop(0)
        if isinstance(answer, httpx.Response):
            return answer
        return httpx.Response(200, content=answer, headers={"content-type": "text/event-stream",
                                                           "x-request-id": "req_abc"})


def _signed_in(*, expires_in: float = 3600, scopes=("chatgpt.tokens.use.direct", "email", "offline_access",
                                                      "openid", "profile", "resource.invoke")) -> None:
    cfg = dict(P.read_config())
    cfg["chatgpt_plan"] = {"client_id": "oaiapp_test", "host_id": "urn:uuid:test-host", "account": "a@example.com",
                           "scopes": sorted(scopes), "access_token": encrypt_secret("AT-1"),
                           "refresh_token": encrypt_secret("RT-1"), "expires_at": time.time() + expires_in}
    P.write_config(cfg)


def _client(plan: _Plan) -> openai.OpenAI:
    transport = CP.PlanTransport(upstream=httpx.Client(transport=httpx.MockTransport(plan)))
    return openai.OpenAI(base_url=CP.API_BASE, api_key="unused", max_retries=0,
                         http_client=httpx.Client(transport=transport))


# ── the request, as the plan takes it ──────────────────────────────────────────────────────

def test_a_chat_completions_body_becomes_the_plans_responses_body():
    body = CP.to_responses({
        "model": "m", "temperature": 0.1, "max_tokens": 900, "seed": 3, "stream": False,
        "stream_options": {"include_usage": True}, "reasoning": {"effort": "low"},
        "messages": [{"role": "system", "content": "Be brief."},
                     {"role": "user", "content": "How many orders?"},
                     {"role": "assistant", "content": None, "tool_calls": [
                         {"id": "call_1", "type": "function", "function": {"name": "run_sql", "arguments": "{}"}}]},
                     {"role": "tool", "tool_call_id": "call_1", "content": "[{\"n\": 3}]"}],
        "tools": [{"type": "function", "function": {"name": "run_sql", "parameters": {"type": "object"}}}],
        "tool_choice": {"type": "function", "function": {"name": "run_sql"}},
        "response_format": {"type": "json_schema", "json_schema": {"name": "Out", "schema": {"type": "object"}}},
    })
    # Always streamed and never stored — the plan refuses anything else.
    assert body["stream"] is True and body["store"] is False
    # Nothing the plan refuses is sent: it answered `temperature` with "Unsupported parameter".
    for field in ("temperature", "max_tokens", "seed", "stream_options", "messages", "response_format"):
        assert field not in body
    # The system prompt rides as instructions (an explicit system input item is refused).
    assert body["instructions"] == "Be brief."
    assert body["input"] == [
        {"role": "user", "content": "How many orders?"},
        {"type": "function_call", "call_id": "call_1", "name": "run_sql", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "call_1", "output": "[{\"n\": 3}]"},
    ]
    # `strict` defaults to TRUE on the Responses API; the platform's tool schemas are not written to its rules.
    assert body["tools"] == [{"type": "function", "name": "run_sql", "description": "",
                              "parameters": {"type": "object"}, "strict": False}]
    assert body["tool_choice"] == {"type": "function", "name": "run_sql"}
    assert body["text"] == {"format": {"type": "json_schema", "name": "Out", "schema": {"type": "object"},
                                       "strict": False}}
    assert body["reasoning"] == {"effort": "low"}


def test_json_object_output_and_image_parts_translate():
    body = CP.to_responses({"model": "m", "response_format": {"type": "json_object"}, "messages": [
        {"role": "user", "content": [{"type": "text", "text": "what is this?"},
                                     {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA"}}]}]})
    assert body["text"] == {"format": {"type": "json_object"}}
    assert body["input"][0]["content"] == [{"type": "input_text", "text": "what is this?"},
                                           {"type": "input_image", "image_url": "data:image/png;base64,AA"}]


# ── the answer, as the platform reads it ───────────────────────────────────────────────────

def test_a_text_answer_comes_back_as_a_chat_completion_with_exact_usage():
    _signed_in()
    plan = _Plan(_text_answer("Hello, world!"))
    out = _client(plan).chat.completions.create(model="plan-model", temperature=0.1, max_tokens=50,
                                                messages=[{"role": "user", "content": "Say hello"}])
    assert out.choices[0].message.content == "Hello, world!"
    assert out.choices[0].finish_reason == "stop"
    assert (out.usage.prompt_tokens, out.usage.completion_tokens) == (40, 7)
    assert out.usage.completion_tokens_details.reasoning_tokens == 2
    # The fresh access token from the sign-in rides every request; the client's own key never leaves.
    assert plan.headers[0]["authorization"] == "Bearer AT-1"
    assert "temperature" not in plan.sent[0] and "max_tokens" not in plan.sent[0]


def test_a_tool_call_comes_back_with_its_final_arguments():
    _signed_in()
    out = _client(_Plan(_tool_answer())).chat.completions.create(
        model="m", messages=[{"role": "user", "content": "count"}],
        tools=[{"type": "function", "function": {"name": "run_sql", "parameters": {"type": "object"}}}])
    call = out.choices[0].message.tool_calls[0]
    assert (call.id, call.function.name, call.function.arguments) == ("call_9", "run_sql", '{"sql":"SELECT 1"}')
    assert out.choices[0].finish_reason == "tool_calls"


def test_a_streamed_answer_arrives_as_chunks_then_usage():
    _signed_in()
    stream = _client(_Plan(_text_answer("Orders rose twelve percent"))).chat.completions.create(
        model="m", stream=True, stream_options={"include_usage": True},
        messages=[{"role": "user", "content": "headline"}])
    pieces, usage = [], None
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            pieces.append(chunk.choices[0].delta.content)
        if chunk.usage:
            usage = chunk.usage
    assert "".join(pieces) == "Orders rose twelve percent"
    assert len(pieces) == 2                       # streamed as written, not buffered into one
    assert usage is not None and usage.prompt_tokens == 40


# ── refusals, said in the words the classifier and the fallback chain read ────────────────

def test_a_spent_plan_is_a_quota_exhaustion_that_names_where_to_look():
    _signed_in()
    with pytest.raises(openai.RateLimitError) as caught:
        _client(_Plan(_limit_reached())).chat.completions.create(
            model="m", messages=[{"role": "user", "content": "hi"}])
    exc = caught.value
    assert exc.status_code == 429
    # Exhausted, not throttled: straight to the cooldown and the fallback, never retried in place.
    assert P._is_quota_exhausted(exc) and not P._is_transient(exc)
    assert P.classify_provider_error(exc) == "quota_exhausted"
    assert CP.USAGE_URL in str(exc)
    assert exc.response.headers.get("x-request-id") == "req_abc"   # kept for OpenAI, as it asks


def test_a_spent_plan_on_a_streamed_call_is_an_http_error_not_a_200():
    _signed_in()
    with pytest.raises(openai.RateLimitError):
        _client(_Plan(_limit_reached())).chat.completions.create(
            model="m", stream=True, messages=[{"role": "user", "content": "hi"}])


def test_a_refused_field_keeps_the_plans_own_words():
    _signed_in()
    refused = httpx.Response(400, json={"detail": "Unsupported parameter: temperature"})
    with pytest.raises(openai.BadRequestError) as caught:
        _client(_Plan(refused)).chat.completions.create(model="m", messages=[{"role": "user", "content": "hi"}])
    assert "Unsupported parameter: temperature" in str(caught.value)


def test_another_route_is_refused_by_name_not_passed_through():
    _signed_in()
    with pytest.raises(openai.NotFoundError) as caught:
        _client(_Plan()).embeddings.create(model="m", input="x")
    assert "Responses API only" in str(caught.value)


def test_nobody_signed_in_is_refused_before_anything_is_sent():
    plan = _Plan()
    with pytest.raises(openai.AuthenticationError) as caught:
        _client(plan).chat.completions.create(model="m", messages=[{"role": "user", "content": "hi"}])
    assert "Continue with ChatGPT" in str(caught.value)
    assert plan.sent == []


def test_a_sign_in_that_declined_plan_use_runs_no_calls():
    _signed_in(scopes=("email", "openid", "profile"))
    assert CP.status()["signed_in"] and not CP.status()["plan_usage"]
    with pytest.raises(CP.PlanNotSignedIn, match="did not allow plan usage"):
        CP.access_token()


# ── the provider, end to end over the transport ────────────────────────────────────────────

class _City(BaseModel):
    city: str
    population_millions: float


@pytest.fixture
def plan_backend(monkeypatch):
    """The `chatgpt` binding with its upstream swapped for a scripted plan."""
    real = CP.PlanTransport
    plan = _Plan()
    monkeypatch.setattr(CP, "PlanTransport",
                        lambda: real(upstream=httpx.Client(transport=httpx.MockTransport(plan))))
    _signed_in()
    return plan


def test_a_structured_call_on_the_plan_sends_the_schema_and_validates_the_answer(plan_backend):
    plan_backend.answers.append(_text_answer('{"city": "Tokyo", "population_millions": 14.2}'))
    out = P.LLMProvider("chatgpt", "coder", model="plan-model").complete(
        "You answer geography questions.", "Largest city in Japan?", _City)
    assert out.model_dump() == {"city": "Tokyo", "population_millions": 14.2}
    sent = plan_backend.sent[0]
    assert sent["text"]["format"]["type"] == "json_schema"          # instructor's JSON_SCHEMA mode, carried across
    assert sent["text"]["format"]["schema"]["properties"].keys() == {"city", "population_millions"}
    assert "geography" in sent["instructions"]
    assert "temperature" not in sent and "max_tokens" not in sent


def test_a_tool_turn_on_the_plan(plan_backend):
    plan_backend.answers.append(_tool_answer())
    turn = P.LLMProvider("chatgpt", "coder", model="plan-model").complete_with_tools(
        "Use the tool.", "count", [{"type": "function", "function": {"name": "run_sql",
                                                                     "parameters": {"type": "object"}}}])
    assert turn.tool_call is not None and turn.tool_call.name == "run_sql"
    assert turn.tool_call.arguments == {"sql": "SELECT 1"}


def test_the_call_record_says_the_sampling_was_the_providers_default(monkeypatch):
    seen = {}
    from pramanyx.obs import session_log
    monkeypatch.setattr(session_log, "emit", lambda *a, **kw: seen.update(kw))
    P._record_llm_call(backend="chatgpt", model="m", role="coder", prompt_tokens=1, completion_tokens=1, ms=1.0,
                       temperature=0.1)
    assert "temperature" not in seen["payload"]
    assert seen["payload"]["sampling"] == "provider default"


# ── tokens: refreshed ahead of expiry, once at a time, and a spent session ends cleanly ───

def test_a_token_near_expiry_is_refreshed_once_across_threads_and_rotated(monkeypatch):
    _signed_in(expires_in=60)                     # inside the five-minute refresh margin
    calls = []

    def token_endpoint(url, data=None, timeout=None):
        calls.append(dict(data))
        time.sleep(0.05)                          # long enough for the other threads to queue on the lock
        return httpx.Response(200, json={"access_token": "AT-2", "refresh_token": "RT-2", "expires_in": 3600,
                                         "scope": "chatgpt.tokens.use.direct openid"},
                              request=httpx.Request("POST", url))
    monkeypatch.setattr(CP.httpx, "post", token_endpoint)
    got = []
    threads = [threading.Thread(target=lambda: got.append(CP.access_token())) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert got == ["AT-2"] * 4
    assert len(calls) == 1                        # one refresh; the rotated token was not presented twice
    assert calls[0] == {"grant_type": "refresh_token", "client_id": "oaiapp_test", "refresh_token": "RT-1",
                        "resource": CP.API_BASE}
    rec = P.read_config()["chatgpt_plan"]
    assert decrypt_secret(rec["refresh_token"]) == "RT-2"
    assert rec["expires_at"] > time.time() + 3000


def test_a_spent_refresh_token_ends_the_session_and_says_why(monkeypatch):
    _signed_in(expires_in=0)
    monkeypatch.setattr(CP.httpx, "post", lambda url, data=None, timeout=None: httpx.Response(
        400, json={"error": "refresh_token_reused"}, request=httpx.Request("POST", url)))
    with pytest.raises(CP.PlanNotSignedIn, match="refresh_token_reused"):
        CP.access_token()
    s = CP.status()
    assert not s["signed_in"] and "refresh_token_reused" in s["ended"]
    # The registration stays, so the next sign-in is a returning one (no consent screen).
    assert P.read_config()["chatgpt_plan"]["client_id"] == "oaiapp_test"


def test_a_refresh_that_does_not_land_keeps_the_session(monkeypatch):
    _signed_in(expires_in=120)                    # still valid, inside the refresh margin
    monkeypatch.setattr(CP.httpx, "post", lambda url, data=None, timeout=None: httpx.Response(
        503, json={"error": {"message": "unavailable"}}, request=httpx.Request("POST", url)))
    assert CP.access_token() == "AT-1"
    assert CP.status()["signed_in"]


def test_a_settings_save_keeps_the_sign_in():
    _signed_in()
    P.set_config({"models": {"coder": "plan-model"}})
    assert decrypt_secret(P.read_config()["chatgpt_plan"]["refresh_token"]) == "RT-1"


# ── sign-in ─────────────────────────────────────────────────────────────────────────────────

def test_a_first_sign_in_registers_and_a_returning_one_reuses_the_issued_client(monkeypatch):
    first = CP.begin(CP.redirect_uri_for(8000))
    q = httpx.URL(first["authorize_url"]).params
    assert first["authorize_url"].startswith(CP.AUTHORIZE_URL)
    assert q["client_id"] == "dynamic_agent_client" and q["agent_name_hint"] == "Pramanyx"
    assert q["redirect_uri"] == "http://127.0.0.1:8000/auth/callback"          # 127.0.0.1, never localhost
    assert q["code_challenge_method"] == "S256" and q["resource"] == CP.API_BASE
    assert set(q["scope"].split()) >= {"offline_access", "resource.invoke", "chatgpt.tokens.use.direct"}
    host = q["ext_agent_host_id"]
    assert host.startswith("urn:uuid:")

    exchanged = []

    def token_endpoint(url, data=None, timeout=None):
        exchanged.append(dict(data))
        return httpx.Response(200, json={"access_token": "AT", "refresh_token": "RT", "id_token": "IDT",
                                         "expires_in": 3600, "scope": "chatgpt.tokens.use.direct email openid"},
                              request=httpx.Request("POST", url))
    monkeypatch.setattr(CP.httpx, "post", token_endpoint)
    monkeypatch.setattr(CP, "_verified_identity", lambda tok, client_id, nonce: {"sub": "u1", "email": "a@b.co"})
    out = CP.complete(state=q["state"], code="CODE", client_id="oaiapp_new")
    assert out == {"signed_in": True, "account": "a@b.co", "plan_usage": True}
    assert exchanged[0]["client_id"] == "oaiapp_new" and exchanged[0]["redirect_uri"] == q["redirect_uri"]
    assert "client_secret" not in exchanged[0]

    again = httpx.URL(CP.begin(CP.redirect_uri_for(8010))["authorize_url"]).params
    assert again["client_id"] == "oaiapp_new" and "agent_name_hint" not in again
    assert again["ext_agent_host_id"] == host                                    # one host id, kept


def test_a_return_no_sign_in_is_waiting_for_is_refused():
    with pytest.raises(LookupError):
        CP.complete(state="forged", code="x")


def test_a_return_is_used_once():
    q = httpx.URL(CP.begin(CP.redirect_uri_for(8000))["authorize_url"]).params
    with pytest.raises(ValueError, match="did not complete"):
        CP.complete(state=q["state"], error="access_denied")
    with pytest.raises(LookupError):
        CP.complete(state=q["state"], code="x")


def test_sign_out_forgets_the_tokens_before_revoking(monkeypatch):
    _signed_in()
    order = []
    monkeypatch.setattr(CP, "_discovery", lambda timeout=10.0: order.append(
        ("discovery", CP.status()["signed_in"])) or {"revocation_endpoint": "https://auth.example/revoke"})
    monkeypatch.setattr(CP.httpx, "post", lambda url, data=None, timeout=None: order.append(
        ("revoke", data["token"])) or httpx.Response(200, request=httpx.Request("POST", url)))
    out = CP.sign_out()
    assert order == [("discovery", False), ("revoke", "RT-1")]                    # cleared first, then revoked
    assert out["revocation"] == "revoked" and not out["signed_in"]


# ── where the plan sits in the platform ────────────────────────────────────────────────────

def test_the_plan_is_a_built_in_backend_with_a_sign_in_not_a_key():
    assert "chatgpt" in P.backends() and "chatgpt" in P.SIGN_IN_BACKENDS
    assert "chatgpt" not in P.keyed_backends()
    assert "chatgpt" not in P._FALLBACK_ORDER      # a person's plan is spent only where they chose it
    cfg = P.current_config()
    assert cfg["sign_in_backends"] == ["chatgpt"]
    assert set(cfg["chatgpt_plan"]) >= {"signed_in", "plan_usage", "usage_url"}
    assert "access_token" not in json.dumps(cfg) and "RT-" not in json.dumps(cfg)


def test_a_key_for_the_plan_is_never_stored():
    P.set_config({"keys": {"chatgpt": "sk-pasted"}})
    assert "chatgpt" not in (P.read_config().get("keys") or {})


def test_the_capability_says_plan_and_public_api():
    from pramanyx.control_plane.inference import capability_for
    cap = capability_for("chatgpt", "plan-model", "coder", CP.API_BASE)
    assert (cap.cost, cap.privacy_class, cap.tooling, cap.structured_output) == (
        "plan", "public_api", "native_tools", "native")


def test_a_plan_call_bills_nothing_beyond_the_plan():
    from pramanyx.obs.usage import price_for
    price = price_for("chatgpt", "any-model-the-account-lists")
    assert price is not None and (price.input_per_1m, price.output_per_1m) == (0.0, 0.0)


def test_the_model_door_is_bound_to_the_plan_and_hands_no_credential(monkeypatch):
    """The user, 2026-11-24: "Teach the door the plan" — the coworker's own turns run on the plan too. The door is given
    an address and no key: the token is added in this process, on the way out."""
    monkeypatch.setattr(P, "resolve_binding", lambda role: ("chatgpt", "plan-model", CP.API_BASE))
    assert P.door_binding("coder") == ("chatgpt", "plan-model", f"{CP.API_BASE}/chat/completions", "")


@pytest.fixture
def plan_door(monkeypatch):
    """The model door open and bound to the plan, the plan answered by a script."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from pramanyx.orgsettings.store import load_org_settings, save_org_settings
    from pramanyx.routers import model_door
    _signed_in()
    before = load_org_settings()
    save_org_settings(before.model_copy(update={"coworker_models": True}))
    monkeypatch.setattr(P, "resolve_binding", lambda role: ("chatgpt", f"plan-{role}", CP.API_BASE))
    records: list[dict] = []
    monkeypatch.setattr(P, "record_door_call", lambda **kw: records.append(kw))
    holder: dict = {}

    def plan_client():
        sync = CP.PlanTransport(upstream=httpx.Client(transport=httpx.MockTransport(holder["plan"])))
        return httpx.AsyncClient(transport=CP.AsyncPlanTransport(sync))
    monkeypatch.setattr(model_door, "_plan_client", plan_client)
    app = FastAPI()
    app.include_router(model_door.router)
    client = TestClient(app)

    def ask(plan, **body):
        holder["plan"] = plan
        return client.post("/llm/door/v1/chat/completions",
                           json={"model": "narrator", "messages": [{"role": "user", "content": "hi"}], **body})
    yield ask, records
    save_org_settings(before)


def _chunks(text: str) -> list[dict]:
    return [json.loads(line[5:]) for line in text.splitlines() if line.startswith("data:") and line.strip() != "data: [DONE]"]


def test_the_door_relays_a_streamed_answer_from_the_plan_as_chat_completions_chunks(plan_door):
    ask, records = plan_door
    plan = _Plan(_text_answer("Revenue rose in August."))
    r = ask(plan, stream=True)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    words = "".join((c["choices"][0]["delta"].get("content") or "") for c in _chunks(r.text) if c.get("choices"))
    assert words == "Revenue rose in August."
    assert plan.sent[0]["model"] == "plan-narrator" and plan.sent[0]["stream"] is True   # the organisation's model
    assert plan.headers[0]["authorization"] == "Bearer AT-1" and "AT-1" not in r.text     # the token stays here
    assert records and records[0]["backend"] == "chatgpt" and records[0]["ok"] is True
    assert records[0]["prompt_tokens"] == 40 and records[0]["completion_tokens"] == 7    # counted from the stream


def test_the_door_relays_a_tool_call_and_a_plain_answer_from_the_plan(plan_door):
    ask, _ = plan_door
    r = ask(_Plan(_tool_answer()), stream=True, tools=[{"type": "function", "function": {"name": "run_sql"}}])
    calls = [tc for c in _chunks(r.text) if c.get("choices") for tc in (c["choices"][0]["delta"].get("tool_calls") or [])]
    assert calls[0]["function"]["name"] == "run_sql"
    assert "".join(tc["function"].get("arguments") or "" for tc in calls) == '{"sql":"SELECT 1"}'
    r = ask(_Plan(_text_answer("Twelve.")))                                               # not streamed
    assert r.status_code == 200 and r.json()["choices"][0]["message"]["content"] == "Twelve."


def test_a_spent_plan_is_said_through_the_door_before_anything_streams(plan_door):
    ask, records = plan_door
    r = ask(_Plan(_limit_reached()), stream=True)
    assert r.status_code == 429 and "subscription_sharing_usage_limit_exceeded" in r.text
    assert records[-1]["ok"] is False


def test_an_organisation_cannot_bind_the_plan():
    from pramanyx.llm import org_config
    with pytest.raises(ValueError, match="cannot bind it as its own"):
        org_config.save_org_config("org-x", {"backend": "chatgpt"})
