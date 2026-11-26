// @vitest-environment jsdom
/**
 * The metric engine's bar on the Evals page (the metric-views plan's M5): the verdict — right with the metric read and
 * without it, question by question — whether answers are offered it, and a measurement only on a click, its cost said.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { MetricBarCard } from "@/components/evals/MetricBarCard";
import type { MetricBar } from "@/lib/contextEvals";
import { fireEvent, render, screen, waitFor } from "@/lib/testing";

const BAR: MetricBar = {
  connection: "c1", offered: true, running: false,
  questions: [{ id: "q1", question: "Revenue by category?" }, { id: "q2", question: "Orders by country?" }],
  verdict: { connection: "c1", cases: 2, without_tool: 1, with_tool: 2, met: true, at: "2026-11-26T10:00:00Z", rows: [
    { id: "q1", question: "Revenue by category?", without: { passed: false, why: "not the reference's rows (26 against 26)" },
      with: { passed: true, why: "matched the reference", used_the_tool: true } },
    { id: "q2", question: "Orders by country?", without: { passed: true, why: "matched the reference" }, with: { passed: true, why: "matched the reference" } },
  ] },
};

afterEach(() => vi.unstubAllGlobals());

describe("the metric engine's bar", () => {
  it("says the verdict question by question, and measures only on a click", async () => {
    const posts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") { posts.push(String(url)); return new Response(JSON.stringify({ started: true, questions: 2 })); }
      return new Response(JSON.stringify(BAR));
    }));
    render(<MetricBarCard connId="c1" />);
    expect(await screen.findByTestId("metric-bar-verdict")).toHaveTextContent("2 of 2 right with it · 1 of 2 without it");
    expect(screen.getByTestId("metric-bar")).toHaveTextContent("Answers are offered it");
    expect(screen.getAllByTestId("metric-bar-row")[0]).toHaveTextContent(
      "Revenue by category?Without it: not right — not the reference's rows (26 against 26)With it: right (used it)");
    expect(screen.getByText("4 model-backed answers: each question without it, then with it")).toBeTruthy();
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByTestId("metric-bar-run"));
    await waitFor(() => expect(posts).toEqual([expect.stringContaining("/evals/metric-bar/c1/run")]));
  });

  it("says when there is nothing to measure on", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...BAR, questions: [], verdict: null, offered: false }))));
    render(<MetricBarCard connId="c1" />);
    expect(await screen.findByText(/no golden metric-by-dimension questions/)).toBeTruthy();
  });
});
