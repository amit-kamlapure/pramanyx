// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnswerNow } from "@/components/chat/AnswerNow";

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
