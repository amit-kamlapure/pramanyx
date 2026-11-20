// @vitest-environment jsdom
/**
 * An answer's foot in the coworker's layout (the user, 2026-11-20: "except thumbs up/down and copy, I dont [want] anything
 * here. Keep the download option as PDF.. Let Source show both data + SQL.."): beside the thumbs, copy, the PDF and the
 * source — and under the source's SQL, why the number and how it was answered.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({ downloadAnswerPdf: vi.fn(), getPublicReceipt: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/lib/api", async (real) => ({ ...(await real<typeof import("@/lib/api")>()), ...api }));

import { AnswerFoot, SourceFoot } from "@/components/chat/AnswerFoot";
import { EMPTY_TURN, type ChatTurn } from "@/lib/chatTurn";

beforeAll(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
});

const TURN = {
  ...EMPTY_TURN, id: "t1", mode: "ask", status: "done", question: "How many rows does netflix_titles have?",
  sql: "SELECT COUNT(*) AS row_count FROM netflix_titles", columns: ["row_count"], rows: [[8807]],
  headline: "Netflix titles table contains 8,807 rows", receiptId: "r1", publicReceiptId: "p1",
  analysis: { intent: "Count the rows of the sheet", steps: ["Counted every row"] },
} as unknown as ChatTurn;

describe("an answer's foot", () => {
  it("is copy, the PDF and the source — nothing else", () => {
    const onSource = vi.fn();
    render(<AnswerFoot turn={TURN} onSource={onSource} />);
    const foot = screen.getByTestId("answer-foot");
    expect(screen.getByRole("button", { name: "Copy the answer" })).toBeInTheDocument();
    expect(foot).toHaveTextContent(/^1 source$/);
    expect(foot).not.toHaveTextContent(/Why this number|How it was answered|More/);
    fireEvent.click(screen.getByTestId("answer-pdf"));
    expect(api.downloadAnswerPdf).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByTestId("answer-source"));
    expect(onSource).toHaveBeenCalledTimes(1);
  });

  it("says when an answer was never stored, so there is no PDF of it", () => {
    api.downloadAnswerPdf.mockClear();
    render(<AnswerFoot turn={{ ...TURN, receiptId: null } as unknown as ChatTurn} onSource={vi.fn()} />);
    fireEvent.click(screen.getByTestId("answer-pdf"));
    expect(api.downloadAnswerPdf).not.toHaveBeenCalled();
    expect(screen.getByTestId("answer-foot")).toHaveTextContent("there is no PDF of it");
  });

  it("offers no source for an answer that read no rows", () => {
    render(<AnswerFoot turn={{ ...TURN, columns: [], rows: [] } as unknown as ChatTurn} onSource={vi.fn()} />);
    expect(screen.queryByTestId("answer-source")).not.toBeInTheDocument();
  });
});

describe("under the source's SQL", () => {
  it("says why the number, and how it was answered when asked", () => {
    render(<SourceFoot turn={TURN} connectionId="sheets" />);
    expect(screen.getByRole("button", { name: /Why this number/ })).toBeInTheDocument();
    expect(screen.queryByTestId("answer-evidence")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("source-how"));
    expect(screen.getByTestId("answer-evidence")).toHaveTextContent("Count the rows of the sheet");
  });
});
