// @vitest-environment jsdom
/**
 * A quick answer, as the Evidence → Action study draws one (§12.2–12.4; the user, 2026-11-10: "Actions and the Ask"):
 * the headline said as Narrative (the model wrote it from the rows), the figures said as Computed (the executed query's
 * own), its explanation, its statement and its details; Open in SQL Editor puts the statement, as it ran, in a new
 * editor tab without running it.
 *
 * Since 2026-11-27 (the plan of record: one answer view everywhere) the four views are not tabs: the result leads, the
 * explanation is the body under the headline, and the statement and details open from "SQL" and "Evidence" under "How
 * it was answered" — where no source panel is there to open them in (here, as in the ⌘K overlay); where one is, the
 * answer's foot opens them there (`chat/AnswerFoot.test.tsx`). Open in SQL Editor is in the folded follow-ups.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";

import { ChatMessage } from "@/components/ChatMessage";
import { EMPTY_TURN, type ChatTurn } from "@/lib/chatTurn";
import { OpenInQueryProvider } from "@/lib/openInQuery";

beforeAll(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
});

const TURN = {
  ...EMPTY_TURN, id: "t1", mode: "ask", status: "done",
  question: "Revenue by month this year",
  sql: "SELECT month, revenue FROM monthly_revenue ORDER BY month",
  columns: ["month", "revenue"],
  rows: [["2026-01", 100], ["2026-02", 120], ["2026-03", 90]],
  headline: "Revenue peaked in February at 120.",
  narrative: { narrative: "February led; March fell back.", anomalies: [], trend: "", confidence: "" },
  tablesUsed: ["thelook.monthly_revenue"],
  receiptId: "r1",
} as ChatTurn;

const open = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("a quick answer's anatomy", () => {
  it("says the headline is narrative and the figures computed, and leads with the result", () => {
    render(<Theme><ChatMessage turn={TURN} connectionId="c1" /></Theme>);
    expect(screen.getByTestId("answer-narrative-label")).toHaveTextContent(/^Narrative\s*written by the model from the rows the query returned$/);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByTestId("answer-computed-label")).toHaveTextContent(/^Computed\s*from the executed query · 3 rows · reads thelook.monthly_revenue$/);
    // the result is drawn before how it was answered, and that before the follow-ups
    const order = ["answer-exhibit", "answer-how", "answer-onward"].map(id => screen.getByTestId(id));
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Explain the data")).not.toBeInTheDocument();
  });

  it("says the narrative as the body, and opens the statement under SQL and the details under Evidence", () => {
    render(<Theme><ChatMessage turn={TURN} connectionId="c1" /></Theme>);
    expect(screen.getByText("February led; March fell back.")).toBeInTheDocument();
    expect(screen.getByTestId("answer-explanation-label")).toHaveTextContent(/^Narrative\s*written by the model from the rows$/);
    open("SQL");
    expect(screen.getByTestId("answer-sql")).toHaveTextContent(TURN.sql!);     // exactly as it ran — `month` not upper-cased
    open("Evidence");
    expect(screen.getByTestId("answer-evidence")).toHaveTextContent("Tables used");
  });

  it("says an explanation the platform summarised is computed, not the model's", () => {
    // the platform's summary of the rows stands in only where no figure is drawn (beside one object): beside the
    // exhibit it would say the figure a third time (`ChatMessage.harness.test.tsx`)
    render(<Theme><ChatMessage turn={{ ...TURN, narrative: null } as ChatTurn} connectionId="c1" lean /></Theme>);
    expect(screen.getByTestId("answer-explanation-label")).toHaveTextContent(/^Computed\s*summarised from the rows by the platform/);
  });

  it("does not call a headline with no query behind it, or a withheld one, the model's narrative", () => {
    const { unmount } = render(<Theme><ChatMessage turn={{ ...TURN, sql: null, columns: [], rows: [], headline: "Mytheresa isn't a franchise here." } as ChatTurn} connectionId="c1" /></Theme>);
    expect(screen.queryByTestId("answer-narrative-label")).not.toBeInTheDocument();
    unmount();
    render(<Theme><ChatMessage turn={{ ...TURN, guardReceipts: [{ guard: "numeric grounding", action: "withheld the answer", detail: "" }] } as ChatTurn} connectionId="c1" /></Theme>);
    expect(screen.queryByTestId("answer-narrative-label")).not.toBeInTheDocument();
  });

  it("opens the statement, as it ran, in the SQL Editor", () => {
    const openIn = vi.fn();
    render(<Theme><OpenInQueryProvider value={openIn}><ChatMessage turn={TURN} connectionId="c1" /></OpenInQueryProvider></Theme>);
    fireEvent.click(screen.getByRole("button", { name: /^Follow-ups/ }));
    fireEvent.click(screen.getByTestId("answer-open-in-editor"));
    expect(openIn).toHaveBeenCalledWith(expect.objectContaining({ sql: TURN.sql, connId: "c1", mode: "sql" }));
  });
});
