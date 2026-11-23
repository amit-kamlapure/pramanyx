// @vitest-environment jsdom
/**
 * Define ▸ Own model (2026-11-23): what the organisation's own model learns and leaves out is said before anyone
 * builds, a model's measure reads before → after with its weakest held-out answers first, a draft offers to be put in
 * service and is not askable, and the page says why it cannot train while the organisation does not allow it.
 *
 * The client is mocked: an unmocked call would reach the live API from jsdom.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OwnModel, OwnModelOverview } from "@/lib/api";

const model = (over: Partial<OwnModel> = {}): OwnModel => ({
  number: 2, state: "draft", run_id: "r2", trained_at: "2026-11-23T12:00:00Z", trained_by: "ana",
  base: { source: "owner/base", architecture: "Qwen3ForCausalLM", bytes: 128e6 },
  training_set: { train: { version: 3, row_count: 649 }, held_out: { version: 3, row_count: 324 } },
  settings: { method: "full", epochs: 8, learning_rate: 3e-5 }, connections: ["c1"], device: "mps",
  params: 64e6, steps: 650, tokens: 300000, seconds: 300, bytes: 128e6,
  measure: {
    before: { rows: 324, answer_loss: 2.78, f1: 0.13, recalled: 0, by_kind: { metric: { n: 59, f1: 0.2, recalled: 0 } } },
    after: { rows: 324, answer_loss: 0.002, f1: 0.97, recalled: 0.98, by_kind: { metric: { n: 59, f1: 0.95, recalled: 1 } } },
  },
  served_as: "", recorded_at: "", published_at: "", note: "", ...over,
});

let overview: OwnModelOverview;
const asked: string[] = [];
vi.mock("@/lib/api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOwnModel: () => Promise.resolve(overview),
  getTrainingPlan: () => Promise.resolve({
    sources: { metric: 59, unsettled_term: 60 }, rows: { train: 649, held_out: 324 }, connections: ["c1"],
    withheld: [{ reason: "a finding nobody has confirmed", count: 772 }],
  }),
  getTrainingRows: () => Promise.resolve({ half: "train", total: 1, kinds: { metric: 1 }, state: "present", rows: [
    { prompt: "What is Revenue at theLook?", completion: "Revenue (revenue) at theLook: gross booked.", phrasing: 0,
      source: { kind: "metric", id: "c1:revenue", connection_id: "c1", tier: "approved" } }] }),
  getHeldOutAnswers: () => Promise.resolve({
    before: [{ question: "How is Revenue defined at theLook?", expected: "Revenue is gross booked.", answer: "A financial metric.", f1: 0.1, source: { kind: "metric" } }],
    after: [{ question: "How is Revenue defined at theLook?", expected: "Revenue is gross booked.", answer: "Revenue is gross booked.", f1: 1, source: { kind: "metric" } },
            { question: "What is Churn rate at theLook?", expected: "Nothing is settled about Churn rate.", answer: "Nothing is settled.", f1: 0.5, source: { kind: "unsettled_term" } }],
  }),
  askOwnModel: (_n: number, q: string) => {
    asked.push(q);
    return Promise.resolve(q.includes("NPS")
      ? { answer: "", served_as: "x", ms: 9, verdict: "withheld", why: "the model's answer matches nothing the organisation settled, so it is not shown", closest: { kind: "metric", id: "c1:repeat_purchase_rate" } }
      : { answer: "Revenue is gross booked.", served_as: "x", ms: 12, verdict: "settled", source: { kind: "metric", id: "c1:revenue" } });
  },
}));

const { OwnModelPanel } = await import("@/components/OwnModelPanel");
const mount = () => render(<Theme><OwnModelPanel /></Theme>);

beforeEach(() => {
  asked.length = 0;
  overview = {
    allowed: true, where: "Settings ▸ Organization ▸ What Pramanyx may do",
    setup: { ready: true, python: "/py", missing: [], how: "" },
    base: { source: "owner/base", dir: "/m", architecture: "Qwen3ForCausalLM", hidden_size: 768, layers: 8, vocab_size: 6400,
            bytes: 128e6, fetched_at: "2026-11-23T11:00:00Z", by: "ana", present: true },
    serving: { reachable: true, detail: "0.40.16", root: "http://localhost:11434" },
    training_set: { train: { id: "t", name: "company-knowledge", version: 3, kind: "knowledge", row_count: 649, created_at: "2026-11-23T11:30:00Z" },
                    held_out: { id: "h", name: "company-knowledge-held-out", version: 3, kind: "knowledge_golden", row_count: 324, created_at: "2026-11-23T11:30:00Z" } },
    run: null, models: [model()], defaults: { method: "full", epochs: 8, learning_rate: 3e-5, max_seq_len: 512 },
  };
});

describe("Define ▸ Own model", () => {
  it("says what the training set leaves out before anyone builds, and why", async () => {
    mount();
    expect(await screen.findByText("a finding nobody has confirmed")).toBeTruthy();
    expect(screen.getByText("772")).toBeTruthy();
    expect(screen.getByText(/A finding a person confirms in the Record joins the next build/)).toBeTruthy();
  });

  it("opens the newest model with its measure before → after and its weakest held-out answer first", async () => {
    mount();
    const detail = await screen.findByTestId("own-model-detail");
    expect(detail.textContent).toContain("Model 2");
    const answers = await screen.findByTestId("own-model-answers");
    await waitFor(() => expect(answers.textContent).toContain("Churn rate"));
    expect(answers.textContent!.indexOf("Churn rate")).toBeLessThan(answers.textContent!.indexOf("How is Revenue defined"));
    expect(screen.getByTestId("own-model-row-2").textContent).toMatch(/0%\s*→\s*98%/);
  });

  it("offers to put a draft in service and does not offer to ask it", async () => {
    mount();
    expect(await screen.findByText("Put in service")).toBeTruthy();
    expect(screen.queryByTestId("own-model-ask")).toBeNull();
  });

  it("asks a model in service", async () => {
    overview.models = [model({ state: "published", served_as: "pramanyx-own-default:v2" })];
    mount();
    const box = await screen.findByLabelText("A question for the model");
    fireEvent.change(box, { target: { value: "What is Revenue at theLook?" } });
    fireEvent.click(screen.getByText("Ask"));
    await waitFor(() => expect(asked).toEqual(["What is Revenue at theLook?"]));
    expect((await screen.findByTestId("own-model-asked")).textContent).toContain("From approved metrics · c1:revenue");
  });

  it("says an answer was withheld, and never shows its words", async () => {
    overview.models = [model({ state: "published", served_as: "pramanyx-own-default:v2" })];
    mount();
    const box = await screen.findByLabelText("A question for the model");
    fireEvent.change(box, { target: { value: "What is NPS at theLook?" } });
    fireEvent.click(screen.getByText("Ask"));
    const row = await screen.findByTestId("own-model-asked");
    expect(row.textContent).toContain("Withheld — the model's answer matches nothing the organisation settled");
    expect(row.textContent).toContain("c1:repeat_purchase_rate");
  });

  it("says why it cannot train while the organisation does not allow it", async () => {
    overview.allowed = false;
    mount();
    expect((await screen.findByTestId("own-model-off")).textContent).toContain("What Pramanyx may do");
    expect(screen.getByText(/Not yet: the organisation does not allow it yet/)).toBeTruthy();
  });
});
