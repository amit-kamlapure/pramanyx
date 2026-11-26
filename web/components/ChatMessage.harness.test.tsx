// @vitest-environment jsdom
/**
 * The Ask panel's answer, laid out the coworker's way (Stage 1, the user, 2026-11-19). An answer states its figure once in
 * words and once in the exhibit: the summary computed from the rows stands in only when no figure is shown. Seen live — a
 * restored "How many rows does netflix_titles have?" read "…contains 8,807 rows", then "Row Count: 8.8K", then 8.8K.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

// as the Ask panel draws a turn: a source panel to open the answer's source in
const inPanel = (turn: ChatTurn) => render(
  <HarnessContext.Provider value={{ on: true }}><ChatMessage turn={turn} connectionId="sheets" onShowSource={() => {}} /></HarnessContext.Provider>);

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

  // Was: "keeps the classic layout's Evidence, one click away beside the SQL" — Show the SQL and Evidence under the
  // exhibit. Since 2026-11-20 the SQL and how it was answered are the answer's source, opened from its foot
  // (`chat/AnswerFoot.test.tsx`), and a one-record answer draws no exhibit at all.
  it("draws no box for one record whose words state its figure, and says a figure they leave out in a line (2026-11-20)", () => {
    inPanel(TURN);
    expect(screen.queryByTestId("answer-exhibit")).not.toBeInTheDocument();
    expect(screen.getAllByText(/8,807/)).toHaveLength(1);                        // the headline, once
    cleanup();
    inPanel({ ...TURN, headline: "The Netflix titles sheet was counted" } as ChatTurn);
    expect(screen.queryByTestId("answer-exhibit")).not.toBeInTheDocument();
    expect(screen.getByText("8,807")).toBeInTheDocument();                        // what the words left out
  });

  it("keeps a chart's exhibit, with no SQL or evidence of its own beside the foot's source", () => {
    inPanel({ ...TURN, columns: ["type", "titles"], rows: [["Movie", 6131], ["TV Show", 2676]],
      headline: "Movies outnumber TV shows" } as ChatTurn);
    expect(screen.getByTestId("answer-exhibit")).toHaveTextContent("from the executed query · 2 rows");
    expect(screen.queryByText("Show the SQL")).not.toBeInTheDocument();
    expect(screen.queryByText("Evidence")).not.toBeInTheDocument();
  });

  it("folds its follow-ups until opened; open, they hold the questions and what the answer can become", () => {
    const onFollowUp = vi.fn(), onRegenerate = vi.fn();
    render(<HarnessContext.Provider value={{ on: true }}>
      <ChatMessage turn={{ ...TURN, followups: ["Break this out by type"] } as ChatTurn} connectionId="sheets"
        onFollowUp={onFollowUp} onRegenerate={onRegenerate} />
    </HarnessContext.Provider>);
    const fold = screen.getByRole("button", { name: /Follow-ups · 1/ });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Break this out by type")).not.toBeInTheDocument();
    fireEvent.click(fold);
    fireEvent.click(screen.getByText("Break this out by type"));
    expect(onFollowUp).toHaveBeenCalledWith("Break this out by type");
    const next = screen.getByRole("group", { name: "What this answer can become" });
    expect(next).toHaveTextContent("Pin to dashboard");
    fireEvent.click(screen.getByText("↺ Ask again"));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^More/)).not.toBeInTheDocument();
  });

  it("draws the deep analysis a conversation ran, though the turn was not asked as one (Agent on the person's dashboard)", () => {
    const REPORT = { headline: "Movies are 69.6% of the catalogue", executive_summary: "Films span 75 years; TV about 25.",
      confidence: "HIGH", observation_period: "", comparison_basis: "", recommendations: [], data_gaps: [],
      attribution_waterfall: [], phases: [] };
    inPanel({ ...TURN, mode: "ask", headline: null, columns: [], rows: [], sql: "", deepReport: REPORT } as unknown as ChatTurn);
    expect(screen.getByText("Movies are 69.6% of the catalogue")).toBeInTheDocument();
  });
});

