// @vitest-environment jsdom
/**
 * The Ask panel's answer, laid out the coworker's way (Stage 1, the user, 2026-11-19). An answer states its figure once in
 * words and once in the exhibit: the summary computed from the rows stands in only when no figure is shown. Seen live — a
 * restored "How many rows does netflix_titles have?" read "…contains 8,807 rows", then "Row Count: 8.8K", then 8.8K.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ChatMessage } from "@/components/ChatMessage";
import { HarnessContext } from "@/components/chat/harnessLook";
import { EMPTY_TURN, type ChatTurn } from "@/lib/chatTurn";

beforeAll(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
});

const TURN = {
  ...EMPTY_TURN, id: "t1", mode: "ask", status: "done",
  question: "How many rows does netflix_titles have?",
  sql: "SELECT COUNT(*) AS row_count FROM netflix_titles",
  columns: ["row_count"],
  rows: [[8807]],
  headline: "Netflix titles table contains 8,807 rows",
} as ChatTurn;

const inPanel = (turn: ChatTurn) => render(
  <HarnessContext.Provider value={{ on: true }}><ChatMessage turn={turn} connectionId="sheets" /></HarnessContext.Provider>);

describe("an answer in the Ask panel", () => {
  it("does not say its figure a third time beside the exhibit", () => {
    inPanel(TURN);
    expect(screen.getByText("Netflix titles table contains 8,807 rows")).toBeInTheDocument();
    expect(screen.queryByText(/Row Count/)).not.toBeInTheDocument();
  });

  it("keeps the words written for the answer", () => {
    inPanel({ ...TURN, narrative: { narrative: "Each row is one title on Netflix.", anomalies: [] } } as unknown as ChatTurn);
    expect(screen.getByText(/Each row is one title on Netflix/)).toBeInTheDocument();
  });

  it("keeps the classic layout's Evidence, one click away beside the SQL", () => {
    inPanel(TURN);
    expect(screen.queryByTestId("answer-evidence")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("answer-show-evidence"));
    expect(screen.getByTestId("answer-evidence")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("answer-show-sql"));          // one open at a time
    expect(screen.queryByTestId("answer-evidence")).not.toBeInTheDocument();
    expect(screen.getByText(/SELECT COUNT/)).toBeInTheDocument();
  });

  it("draws the deep analysis a conversation ran, though the turn was not asked as one (Agent on the person's dashboard)", () => {
    const REPORT = { headline: "Movies are 69.6% of the catalogue", executive_summary: "Films span 75 years; TV about 25.",
      confidence: "HIGH", observation_period: "", comparison_basis: "", recommendations: [], data_gaps: [],
      attribution_waterfall: [], phases: [] };
    inPanel({ ...TURN, mode: "ask", headline: null, columns: [], rows: [], sql: "", deepReport: REPORT } as unknown as ChatTurn);
    expect(screen.getByText("Movies are 69.6% of the catalogue")).toBeInTheDocument();
  });
});

