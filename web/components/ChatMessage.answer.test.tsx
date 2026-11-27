// @vitest-environment jsdom
/**
 * Every kind of turn is drawn by the one answer view (the plan of record, 2026-11-27), in either layout the
 * conversation wears: the coworker's (the Ask panel, a Data Canvas) and the plain one (the Chat page, ⌘K) are the same
 * answer. A settled turn draws the stream's envelope; the analyst's concluded report keeps its exhibits; a report the
 * envelope does not map keeps its own body and ends as every answer ends — how it was answered, follow-ups, the foot.
 */
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/components/charts/ResultChartCard", () => ({
  ResultChartCard: ({ title }: { title: string }) => <div data-testid="chart">{title}</div>,
}));

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  getPublicReceipt: vi.fn(async () => { throw new Error("no receipt here"); }),
}));

import { ChatMessage } from "@/components/ChatMessage";
import { HarnessContext } from "@/components/chat/harnessLook";
import { readEnvelope } from "@/lib/answerEnvelope";
import { EMPTY_TURN, type ChatTurn } from "@/lib/chatTurn";

beforeAll(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
});

const ROUTE = { depth: "quick" as const, mode: "", tier: "", why: "", ambiguous: false, forced: null, downgradedFrom: null,
  shape: "survey", engine: "converse" };

const QUICK = {
  ...EMPTY_TURN, id: "t1", mode: "ask", status: "done", question: "What sells best?",
  sql: "SELECT category, revenue FROM sales", columns: ["category", "revenue"], rows: [["Jeans", 3], ["Coats", 5], ["Hats", 1]],
  headline: "Coats sell best", followups: [], receiptId: "inv-1", route: ROUTE,
  envelope: readEnvelope({
    headline: "Coats sell best", body: "Jeans follow.", grid: { columns: ["category", "revenue"], rows: [["Jeans", 3], ["Coats", 5], ["Hats", 1]] },
    caveats: ["Hats were discontinued in March"], follow_ups: ["By region?"],
    provenance: { path: { kind: "survey", depth: "quick", engine: "converse" }, sql: ["SELECT category, revenue FROM sales"] },
  }),
} as ChatTurn;

const finding = (id: string, rows: (string | number)[][]) => ({
  finding_id: id, title: `Result ${id}`, sql: `SELECT 1 -- ${id}`, columns: ["category", "revenue"], rows, row_count: rows.length,
  error: null, interpretation: "", key_numbers: [], chart_type: "bar", stat_note: null, is_significant: false, trust_caveat: null,
});

const REPORT = {
  headline: "Coats lead six-month revenue", executive_summary: "Jeans are second.", confidence: "HIGH",
  observation_period: "", comparison_basis: "", recommendations: [{ action: "Stock more coats", expected_impact: "", owner: "", timeline: "" }],
  data_gaps: [], attribution_waterfall: [], figures: [{ label: "Coats", value: "$5K" }], gaps: "Margin is not measured.",
  exhibits: [{ finding_id: "a1", claim: "Coats lead the ten" }], question_shape: "diagnose",
  phases: [{ phase_id: "adhoc", phase_name: "Revenue", phase_icon: "", status: "complete", summary: "",
             findings: [finding("a1", [["Coats", 5], ["Jeans", 3]]), finding("a2", [["Hats", 1], ["Caps", 2]])] }],
};

const DEEP = {
  ...EMPTY_TURN, id: "t2", mode: "investigate", status: "done", question: "Why do coats sell?", deepReport: REPORT,
  queryMode: "investigate", followups: ["And jeans?"], receiptId: "run-1",
  route: { ...ROUTE, depth: "deep" as const, shape: "diagnose", engine: "analyst" },
} as unknown as ChatTurn;

const draw = (turn: ChatTurn, coworker: boolean) => render(
  <HarnessContext.Provider value={{ on: coworker }}>
    <ChatMessage turn={turn} connectionId="c1" onShowSource={() => {}} />
  </HarnessContext.Provider>);

describe("a settled quick answer", () => {
  it("draws the envelope: its body, its grid, its caveats, how it was answered, its follow-ups and its foot", () => {
    draw(QUICK, false);
    expect(screen.getByText("Jeans follow.")).toBeInTheDocument();
    expect(screen.getByTestId("answer-exhibit")).toBeInTheDocument();
    expect(screen.getByTestId("answer-caveats")).toHaveTextContent("Hats were discontinued in March");
    expect(screen.getByTestId("answer-path")).toHaveTextContent("An open question · answered by the conversation · quick");
    expect(screen.getByRole("button", { name: /Follow-ups · 1/ })).toBeInTheDocument();
    // the foot is the answer's own: thumbs, copy, PDF and its one source
    expect(screen.getByTestId("turn-foot")).toBeInTheDocument();
    expect(screen.getByLabelText("Helpful")).toBeInTheDocument();
    expect(screen.getByTestId("answer-pdf")).toBeInTheDocument();
    expect(screen.getByTestId("answer-foot-source")).toHaveTextContent("1 source");
  });

  it("is the same answer in the coworker's layout and the plain one", () => {
    const { unmount } = draw(QUICK, true);
    const coworker = screen.getByTestId("answer-view").innerHTML;
    unmount();
    draw(QUICK, false);
    expect(screen.getByTestId("answer-view").innerHTML).toBe(coworker);
  });

  it("shows what streams before the envelope comes, and no foot until it has", () => {
    draw({ ...QUICK, status: "loading", headline: null, headlineStream: "Coats se", envelope: null, columns: [], rows: [] } as ChatTurn, false);
    expect(screen.getByText("Coats se")).toBeInTheDocument();
    expect(screen.queryByTestId("turn-foot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("answer-how")).not.toBeInTheDocument();
  });
});

describe("the analyst's concluded answer in a conversation", () => {
  it("keeps its figures, its exhibits, its next steps and the results it did not draw, and ends as every answer ends", () => {
    draw(DEEP, false);
    expect(screen.getByTestId("answer-figures")).toHaveTextContent("$5K");
    expect(screen.getByTestId("exhibit-a1")).toHaveTextContent("Coats lead the ten");
    expect(screen.getByText("1 of 2 results drawn")).toBeInTheDocument();
    expect(screen.getByText("Stock more coats")).toBeInTheDocument();
    expect(screen.getByTestId("uncited-results")).toHaveTextContent("1 not drawn");
    expect(screen.getByTestId("answer-gaps")).toHaveTextContent("Margin is not measured.");
    expect(screen.getByTestId("answer-path")).toHaveTextContent("A why · answered by the analyst · deep");
    expect(screen.getByRole("button", { name: /Follow-ups · 1/ })).toBeInTheDocument();
    expect(screen.getByTestId("turn-foot")).toBeInTheDocument();
  });

  it("is the same answer in either layout", () => {
    const { unmount } = draw(DEEP, true);
    const coworker = screen.getByTestId("answer-view").innerHTML;
    unmount();
    draw(DEEP, false);
    expect(screen.getByTestId("answer-view").innerHTML).toBe(coworker);
  });
});

describe("why this number", () => {
  it("is under the source's SQL when the foot opens a source, and under how it was answered when none opens", () => {
    const { unmount } = draw({ ...QUICK, publicReceiptId: "pr-1" } as ChatTurn, false);
    expect(screen.getByTestId("answer-how")).not.toHaveTextContent(/Why this number/i);
    unmount();
    draw({ ...DEEP, publicReceiptId: "pr-2" } as ChatTurn, false);
    expect(screen.getByTestId("answer-how")).toHaveTextContent(/Why this number/i);
  });
});

describe("a report the envelope does not map", () => {
  it("keeps its own body (the phase script) and ends as every answer ends", () => {
    const PHASES = { ...REPORT, exhibits: [], headline: "Movies are 69.6% of the catalogue" };
    draw({ ...DEEP, deepReport: PHASES } as unknown as ChatTurn, false);
    expect(screen.getByText("Movies are 69.6% of the catalogue")).toBeInTheDocument();
    expect(screen.queryByTestId("exhibit-a1")).not.toBeInTheDocument();
    expect(screen.getByTestId("answer-path")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Follow-ups · 1/ })).toBeInTheDocument();
    expect(screen.getByTestId("turn-foot")).toBeInTheDocument();
  });
});
