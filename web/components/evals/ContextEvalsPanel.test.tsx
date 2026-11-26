// @vitest-environment jsdom
/**
 * Evals of the context layer (§7.9, decision 3): the cases by source, drawn without a model; a run only on a person's
 * click, saying it is real answers; each case reached or not, and why — as Discover draws a row.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextEvalsPanel } from "@/components/evals/ContextEvalsPanel";
import type { ContextEvals } from "@/lib/contextEvals";
import { fireEvent, render, screen, waitFor } from "@/lib/testing";

const EVALS: ContextEvals = {
  suite: { id: "s1", name: "The context layer — theLook" },
  by_source: { definition: 1, metric: 1, trusted_query: 0, corrected: 0 },
  run: { id: "r1", status: "succeeded", started_at: "2026-11-26T10:00:00Z", finished_at: "2026-11-26T10:05:00Z", summary: { cases: 2, passed: 1 } },
  cases: [
    { id: "a", question: "How many Repeat buyer were there in the last 30 days?", source: "definition", name: "Repeat buyer", ref: "c1/Repeat buyer/",
      result: { passed: true, why: "it reached the answer" } },
    { id: "b", question: "What was Revenue over the last 30 days?", source: "metric", name: "Revenue", ref: "c1/revenue",
      result: { passed: false, why: "the answer did not use its formula" } },
  ],
};

function serve() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("/cases")) return new Response(JSON.stringify({ cases: 2, by_source: EVALS.by_source, unread: [] }));
    if (url.endsWith("/run")) return new Response(JSON.stringify({ run_id: "r2" }));
    if (url.includes("/evals/metric-bar")) return new Response(JSON.stringify({ connection: "c1", questions: [], verdict: null, offered: false, running: false }));
    return new Response(JSON.stringify(EVALS));
  }));
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("the context layer's evals", () => {
  it("shows the cases by source, the last run, and each case reached or not with why", async () => {
    serve();
    render(<ContextEvalsPanel connId="c1" />);
    expect(await screen.findByTestId("context-evals-sources")).toHaveTextContent("1 · Published Definition1 · Approved metric0 · Trusted query0 · Corrected answer");
    expect(screen.getByTestId("context-evals-last")).toHaveTextContent("1 of 2 reached the answer");
    expect(screen.getAllByTestId("context-evals-case").map((r) => r.textContent)).toEqual([
      "How many Repeat buyer were there in the last 30 days?Published Definition · Repeat buyer · it reached the answerReached",
      "What was Revenue over the last 30 days?Approved metric · Revenue · the answer did not use its formulaNot reached",
    ]);
    expect(screen.getByText(/1 not reached — each waits in the Inbox's knowledge review/)).toBeTruthy();
  });

  it("draws the cases without a model, and answers them only on a click", async () => {
    const calls = serve();
    render(<ContextEvalsPanel connId="c1" />);
    await screen.findByTestId("context-evals-sources");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Draw the cases again/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/evals/context/c1/cases"))).toBe(true));
    expect(screen.getByText(/Each is a real answer — 2 model-backed answers/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Answer 2/ }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/evals/context/c1/run"))?.body).toEqual({ limit: 40 }));
  });

  it("asks for a connection when none is chosen", () => {
    serve();
    render(<ContextEvalsPanel />);
    expect(screen.getByText(/Choose a connection in the bar above/)).toBeTruthy();
  });
});
