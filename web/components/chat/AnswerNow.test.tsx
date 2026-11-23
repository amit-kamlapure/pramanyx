// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnswerNow } from "@/components/chat/AnswerNow";
import { answerableRun, DEEP_ANALYSIS_MODE } from "@/lib/api";

const answerRunNow = vi.fn();
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), answerRunNow: (...a: unknown[]) => answerRunNow(...a) }));
beforeEach(() => { answerRunNow.mockReset(); });

describe("Answer now", () => {
  it("asks only when pressed, for this run, and says it is answering", async () => {
    answerRunNow.mockResolvedValue(undefined);
    render(<AnswerNow runId="inv7" />);
    expect(answerRunNow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Answer now" }));
    await waitFor(() => expect(screen.getByTestId("answer-now-asked")).toHaveTextContent("from what it has found so far"));
    expect(answerRunNow).toHaveBeenCalledWith("inv7");
  });

  it("says why a run could not be asked, and can be pressed again", async () => {
    answerRunNow.mockImplementation(async () => { throw new Error("It is not running: there is nothing to answer early."); });
    render(<AnswerNow runId="inv7" />);
    fireEvent.click(screen.getByRole("button", { name: "Answer now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("It is not running");
    expect(screen.getByRole("button", { name: "Answer now" })).toBeEnabled();
  });
});

describe("which run a turn can answer early", () => {
  const running = { status: "loading", planPending: null, clarifyPending: null };

  it("a turn routed deep, by its run", () => {
    expect(answerableRun({ ...running, mode: DEEP_ANALYSIS_MODE, runHandle: "inv7" })).toBe("inv7");
    expect(answerableRun({ ...running, status: "done", mode: DEEP_ANALYSIS_MODE, runHandle: "inv7" })).toBeNull();
    expect(answerableRun({ ...running, mode: DEEP_ANALYSIS_MODE, runHandle: "inv7", planPending: {} })).toBeNull();
  });

  it("a quick turn whose conversation started a deep analysis, until its report lands (2026-11-23)", () => {
    expect(answerableRun({ ...running, mode: "ask" })).toBeNull();                       // a quick answer: no run
    expect(answerableRun({ ...running, mode: "ask", runHandle: "inv9" })).toBe("inv9");  // the analyst's start
    expect(answerableRun({ ...running, mode: "ask", runHandle: "inv9", deepReport: { headline: "…" } })).toBeNull();
  });
});
