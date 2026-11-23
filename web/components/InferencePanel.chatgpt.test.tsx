// @vitest-environment jsdom
/**
 * Settings ▸ Models: the ChatGPT plan (2026-11-23). Its credential is a person's sign-in, so the Provider card offers
 * "Continue with ChatGPT" where a keyed provider offers a key field; signed in, it names the account, links the plan's
 * usage page (OpenAI asks every app to) and offers Sign out. A live binding on the plan with nobody signed in is said
 * under "Needs you". The model chips say "your plan", never "$/token", for a model on it.
 */
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getLlmConfig: vi.fn(), setLlmConfig: vi.fn(), getLlmModels: vi.fn(), getUsageReport: vi.fn(),
  testLlmConfig: vi.fn(), cacheProbe: vi.fn(), addLlmModel: vi.fn(), removeLlmModel: vi.fn(),
  startChatgptSignIn: vi.fn(), signOutChatgpt: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import { InferencePanel } from "./InferencePanel";

const CAP = { cache_mode: "auto_prefix_unverified", tooling: "native_tools", structured_output: "native",
  token_accounting: "exact", max_context: 32768, privacy_class: "public_api", cost: "plan" };
const BOUND = { coder: "plan-model", narrator: "plan-model", fast: "plan-model" };
const SIGNED_OUT = { signed_in: false, account: null, plan_usage: false, ended: null, signing_in: false,
  usage_url: "https://chatgpt.com/settings/usage" };
const SIGNED_IN = { ...SIGNED_OUT, signed_in: true, account: "person@example.com", plan_usage: true };

function config(plan: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    backend: "chatgpt", models: BOUND, models_set: BOUND, base_urls: {}, base_urls_set: {},
    keys_set: { openrouter: true }, keys_state: { openrouter: "set" },
    capabilities: { coder: CAP, narrator: CAP, fast: CAP },
    backends: ["openrouter", "chatgpt"], needs_key: ["openrouter"], local_backends: [],
    sign_in_backends: ["chatgpt"], chatgpt_plan: plan,
    default_models: {}, json_mode: {}, json_mode_backends: [],
    fallback: { backend: "none", model: "", chain: [], active: false, env_pinned: false },
    ...over,
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getLlmModels.mockResolvedValue({ backend: "chatgpt", models: [], custom: [], live: true, live_count: 0, error: "", defaults: {} });
  api.getUsageReport.mockResolvedValue({ axes: ["provider", "model"], total_calls: 0, rows: [] });
});

describe("Settings ▸ Models · the ChatGPT plan", () => {
  it("offers Continue with ChatGPT in place of a key, and says the live binding needs a sign-in", async () => {
    api.getLlmConfig.mockResolvedValue(config({ ...SIGNED_OUT, ended: "ChatGPT ended the session (refresh_token_reused)" }));
    render(<InferencePanel />);
    const needs = await screen.findByTestId("needs-sign-in");
    expect(needs).toHaveTextContent("Nobody is signed in to the ChatGPT plan");
    expect(needs).toHaveTextContent("refresh_token_reused");
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(screen.getByText("not signed in")).toBeInTheDocument();
  });

  it("opens OpenAI's page in the tab it opened inside the click", async () => {
    api.getLlmConfig.mockResolvedValue(config(SIGNED_OUT));
    api.startChatgptSignIn.mockResolvedValue({ authorize_url: "https://auth.openai.com/api/accounts/authorize?x=1", expires_in: 600 });
    const tab = { closed: false, opener: {}, location: { href: "about:blank" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    render(<InferencePanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue with ChatGPT" }));
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");          // before anything is awaited
    await waitFor(() => expect(tab.location.href).toBe("https://auth.openai.com/api/accounts/authorize?x=1"));
    expect(tab.opener).toBeNull();
    open.mockRestore();
  });

  it("signed in: the account, the usage page, Sign out — and nothing needs you for it", async () => {
    api.getLlmConfig.mockResolvedValue(config(SIGNED_IN));
    render(<InferencePanel />);
    expect(await screen.findByText("person@example.com")).toBeInTheDocument();
    expect(screen.getByText("Using ChatGPT plan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage usage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByTestId("needs-sign-in")).toBeNull();
  });

  it("says a model on the plan is paid by the plan, never $/token", async () => {
    api.getLlmConfig.mockResolvedValue(config(SIGNED_IN));
    render(<InferencePanel />);
    await screen.findByText("person@example.com");
    expect(screen.getAllByText("your plan").length).toBeGreaterThan(0);
    expect(screen.queryByText("$/token")).toBeNull();
  });

  it("a sign-in that declined plan use is said, with a way to sign in again", async () => {
    api.getLlmConfig.mockResolvedValue(config({ ...SIGNED_IN, plan_usage: false }));
    render(<InferencePanel />);
    const needs = await screen.findByTestId("needs-sign-in");
    expect(needs).toHaveTextContent("plan use was not allowed");
    expect(screen.getByText("plan use not allowed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  });
});
