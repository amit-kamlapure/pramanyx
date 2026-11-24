// @vitest-environment jsdom
/**
 * Define ▸ AI Factory (2026-11-24): six tabs over one read. The Overview says what needs a person; Environments says
 * how an answer will be scored and what a build leaves out; the Playground never shows a withheld answer's words; and
 * Runs says why it cannot start while the organisation does not allow it. There is no Engines tab ("lets not say how
 * we do it", the user): a new run offers the engines ready here as a dropdown, and the base is changed beside it.
 *
 * The client is mocked: an unmocked call would reach the live API from jsdom.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AIFactoryOverview, OwnModel } from "@/lib/api";
import { optionsOf } from "@/lib/testing";

const model = (over: Partial<OwnModel> = {}): OwnModel => ({
  number: 1, state: "published", run_id: "r1", trained_at: "2026-11-23T12:00:00Z", trained_by: "ana",
  base: { source: "owner/base", architecture: "Qwen3ForCausalLM", bytes: 128e6 },
  training_set: { train: { version: 1, row_count: 391 }, held_out: { version: 1, row_count: 195 } },
  settings: { method: "full", epochs: 8, learning_rate: 3e-5 }, connections: ["c1"], device: "mps",
  params: 64e6, steps: 392, tokens: 524136, seconds: 301, bytes: 128e6, engine: "builtin",
  measure: { before: { recalled: 0, f1: 0.14, by_kind: { metric: { n: 59, f1: 0.2, recalled: 0 } } },
             after: { recalled: 0.96, f1: 0.97, by_kind: { metric: { n: 59, f1: 1, recalled: 1 } } } },
  served_as: "pramanyx-own-default:v1", recorded_at: "", published_at: "", note: "", ...over,
});

let overview: AIFactoryOverview;
const asked: string[] = [];
vi.mock("@/lib/api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAIFactory: () => Promise.resolve(overview),
  getTrainingPlan: () => Promise.resolve({
    sources: { metric: 59, unsettled_term: 60 }, rows: { train: 391, held_out: 195 }, connections: ["c1"],
    withheld: [{ reason: "a finding nobody has confirmed", count: 772 }, { reason: "a glossary entry a model wrote, not a person", count: 129 }],
  }),
  getFactoryRecipes: () => Promise.resolve([
    { id: "company_dictionary", name: "Company dictionary", environment: "knowledge", what: "Answers what a word means.",
      facts: ["391 questions"], status: "in service", trainable: true, measured_by: "recall" },
    { id: "router", name: "Router", environment: "routing", what: "Picks the route.", facts: ["211 recorded choices"],
      status: "needs your say", why: "its tasks carry the questions people asked", trainable: false, measured_by: "agreement" },
  ]),
  getFactoryEnvironments: () => Promise.resolve({ reward_band: [0.1, 0.8], environments: [
    { id: "knowledge", name: "Company knowledge", tasks: 391, held_out: 195, scored_by: "matches a settled source",
      pass_base: 0, pass_best: 0.96, fit: "too easy now — examples did it", status: "ready", runs: true },
    { id: "sql", name: "SQL against the warehouse", tasks: 0, need: 1000, held_out: 5, scored_by: "runs · result matches",
      pass_base: null, pass_best: null, fit: "waiting for checked pairs", status: "waiting for data", runs: false,
      rubric: [{ check: "Result matches the reference", weight: 1, means: "same rows" }], sources: { accepts: 10, trusted: 2 } },
  ] }),
  getFactoryEngines: () => Promise.resolve({
    engines: [
      { id: "builtin", name: "Built-in", version: "", status: "ready", why: "", how: "", teaches: ["example"], runs_here: true, summary: "MiniMind's loop." },
      { id: "llamafactory", name: "LlamaFactory", version: "0.9.5", status: "ready", why: "", how: "", teaches: ["example"], runs_here: true, summary: "Every tuning method." },
      { id: "hosted", name: "Hosted services", version: "", status: "off", why: "the tasks and the data would leave the install", how: "", teaches: [], runs_here: false, summary: "Tinker." },
      { id: "axolotl", name: "Axolotl", version: "", status: "review", why: "its plugin licence forbids fine-tuning platforms", how: "", teaches: [], runs_here: false, summary: "GRPO." },
    ],
    capabilities: { builtin: { example: "full · LoRA" }, llamafactory: { example: "full · LoRA · DoRA" }, hosted: {}, axolotl: {} },
    hardware: { system: "Darwin", machine: "arm64", memory_bytes: 24 * 2 ** 30, accelerator: "Apple silicon (MPS)", nvidia: false },
  }),
  getFactoryRuns: () => Promise.resolve([]),
  getTrainingRows: () => Promise.resolve({ half: "train", total: 0, kinds: {}, rows: [], state: "present" }),
  getHeldOutAnswers: () => Promise.resolve({ before: [], after: [] }),
  askOwnModel: (_n: number, q: string) => {
    asked.push(q);
    return Promise.resolve({ answer: "", served_as: "x", ms: 9, verdict: "withheld",
      why: "the model's answer matches nothing the organisation settled, so it is not shown",
      closest: { kind: "metric", id: "c1:repeat_purchase_rate" } });
  },
}));

const { AIFactoryPanel } = await import("@/components/aiFactory/AIFactoryPanel");
const mount = () => render(<Theme><AIFactoryPanel /></Theme>);
const openTab = async (name: RegExp) => fireEvent.mouseDown(await screen.findByRole("tab", { name }));   // a Radix tab turns on the press

beforeEach(() => {
  asked.length = 0;
  overview = {
    allowed: true, where: "Settings ▸ Organization ▸ What Pramanyx may do",
    setup: { ready: true, python: "/py", missing: [], how: "" },
    base: { source: "owner/base", dir: "/m", architecture: "Qwen3ForCausalLM", hidden_size: 768, layers: 8, vocab_size: 6400,
            bytes: 128e6, fetched_at: "2026-11-23T11:00:00Z", by: "ana", present: true },
    serving: { reachable: true, detail: "0.40.16", root: "http://localhost:11434" },
    training_set: { train: { id: "t", name: "company-knowledge", version: 1, kind: "knowledge", row_count: 391, created_at: "2026-11-23T11:30:00Z" },
                    held_out: { id: "h", name: "company-knowledge-held-out", version: 1, kind: "knowledge_golden", row_count: 195, created_at: "2026-11-23T11:30:00Z" } },
    run: null, models: [model()], defaults: { method: "full", epochs: 8, learning_rate: 3e-5, max_seq_len: 512 },
  };
});

describe("Define ▸ AI Factory", () => {
  it("opens on the overview and says what needs a person", async () => {
    mount();
    expect((await screen.findByTestId("needs-findings")).textContent).toContain("772 findings wait for a person");
    expect(screen.getByTestId("needs-sql").textContent).toContain("0 of 1,000");
    expect(screen.getByTestId("ai-factory-figures").textContent).toContain("96%");
  });

  it("says how a SQL answer will be scored and what a knowledge build leaves out", async () => {
    mount();
    await openTab(/Environments/);
    expect((await screen.findByTestId("ai-factory-env-knowledge")).textContent).toContain("a glossary entry a model wrote, not a person");
    fireEvent.click(screen.getByTestId("env-sql"));
    expect((await screen.findByTestId("ai-factory-env-sql")).textContent).toContain("Result matches the reference");
  });

  it("has no Engines tab, and a new run offers only the engines ready here — never says how it trains", async () => {
    mount();
    await screen.findByTestId("ai-factory-figures");
    expect(screen.queryByRole("tab", { name: /Engines/ })).toBeNull();
    await openTab(/Runs/);
    const form = await screen.findByTestId("ai-factory-new-run");
    expect(optionsOf(screen.getByRole("combobox", { name: "Engine" })).map(o => o.text)).toEqual(["Built-in", "LlamaFactory"]);
    for (const word of ["Axolotl", "Hosted", "licence", "Apple silicon", "rented GPU"]) expect(form.textContent).not.toContain(word);
  });

  it("changes the base from the run form", async () => {
    mount();
    await openTab(/Runs/);
    const base = await screen.findByTestId("ai-factory-base");
    expect(base.textContent).toContain("owner/base · Qwen3ForCausalLM · 128 MB");
    expect(screen.queryByLabelText("The base to fetch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText("The base to fetch")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fetch" })).toBeTruthy();
  });

  it("shows a withheld answer as withheld, with its nearest source, and not its words", async () => {
    mount();
    await openTab(/Playground/);
    fireEvent.change(await screen.findByLabelText("A question for the models"), { target: { value: "What is NPS at theLook?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(asked).toEqual(["What is NPS at theLook?"]));
    const card = await screen.findByTestId("ai-factory-asked");
    expect(card.textContent).toContain("Withheld");
    expect(card.textContent).toContain("c1:repeat_purchase_rate");
  });

  it("cannot start a run while the organisation does not allow it, and says so", async () => {
    overview.allowed = false;
    mount();
    expect((await screen.findByTestId("ai-factory-off")).textContent).toContain("admin");
    await openTab(/Runs/);
    expect((await screen.findByTestId("ai-factory-new-run")).textContent).toContain("Not yet: the organisation does not allow it yet");
  });

  it("offers both ready engines for a run, LoRA by default on LlamaFactory", async () => {
    mount();
    await openTab(/Runs/);
    const form = await screen.findByTestId("ai-factory-new-run");
    expect(screen.getByRole("combobox", { name: "Engine" }).getAttribute("data-value")).toBe("llamafactory");
    // No LoRA run on LlamaFactory has been timed yet: the estimate says whose time it borrows, never a guessed factor.
    expect(form.textContent).toContain("roughly 5 min, going by Model 1 (Built-in, every weight)");
    expect(screen.getByRole("radio", { name: "LoRA" }).getAttribute("aria-checked") ?? screen.getByRole("radio", { name: "LoRA" }).getAttribute("data-state")).toMatch(/true|checked|on/);
  });
});
