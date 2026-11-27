// @vitest-environment jsdom
/**
 * The one answer view (the plan of record, 2026-11-27): an answer is drawn from the one answer object in one fixed
 * order — headline, body, figures, exhibits or the one grid, caveats and what it could not see, how it was answered,
 * follow-ups, foot — and a chat and a report are layouts of it, not two views.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/components/charts/ResultChartCard", () => ({
  ResultChartCard: ({ title }: { title: string }) => <div data-testid="chart">{title}</div>,
}));

import { AnswerView } from "@/components/answer/AnswerView";
import { EMPTY_ENVELOPE, type AnswerEnvelope } from "@/lib/answerEnvelope";

beforeAll(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
});

const ANSWER: AnswerEnvelope = {
  ...EMPTY_ENVELOPE,
  question: "Why did revenue fall in March?",
  headline: "Revenue fell 12% in March",
  body: "Fewer orders, not smaller ones.",
  figures: [{ label: "March revenue", value: "$88K" }],
  exhibits: [{ claim: "Orders fell by a fifth", grid: { columns: ["month", "orders"], rows: [["2026-02", 11], ["2026-03", 9]] },
               chart: { chart_type: "bar", chart_config: {} }, caveats: [] }],
  caveats: ["Two stores reported late"],
  gaps: "Returns were not read.",
  follow_ups: ["By region?"],
  provenance: { ...EMPTY_ENVELOPE.provenance, path: { kind: "diagnose", depth: "deep", engine: "analyst", why: "a why question" } },
};

/** Whether each element comes after the one before it in the page. */
const inOrder = (els: Element[]) => els.every((el, i) => i === 0 || !!(els[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));

describe("the one answer view", () => {
  it("draws every part of an answer in the one order", () => {
    render(<AnswerView answer={ANSWER} foot={<div data-testid="foot">foot</div>} />);
    const parts = [
      screen.getByRole("heading", { name: "Revenue fell 12% in March" }),
      screen.getByText("Fewer orders, not smaller ones."),
      screen.getByTestId("answer-figures"),
      screen.getByTestId("exhibit-exhibit-1"),
      screen.getByTestId("answer-caveats"),
      screen.getByTestId("answer-gaps"),
      screen.getByTestId("answer-how"),
      screen.getByTestId("answer-onward"),
      screen.getByTestId("foot"),
    ];
    expect(inOrder(parts)).toBe(true);
    expect(screen.getByTestId("exhibit-exhibit-1")).toHaveTextContent("Orders fell by a fifth");
    expect(screen.getByTestId("answer-path")).toHaveTextContent("A why · answered by the analyst · deep");
    expect(screen.getByTestId("answer-how")).toHaveTextContent("a why question");
    expect(screen.getByTestId("answer-gaps")).toHaveTextContent("Returns were not read.");
  });

  it("is one view in two layouts: a chat sets the figures in a line, a report as a row", () => {
    const { unmount } = render(<AnswerView answer={ANSWER} layout="compact" />);
    expect(screen.getByTestId("answer-view")).toHaveAttribute("data-layout", "compact");
    expect(screen.getByTestId("answer-figures").style.display).toBe("flex");
    unmount();
    render(<AnswerView answer={ANSWER} layout="full" />);
    expect(screen.getByTestId("answer-view")).toHaveAttribute("data-layout", "full");
    expect(screen.getByTestId("answer-figures").style.display).toBe("grid");
  });

  it("folds the follow-ups, with what the answer can become under them", () => {
    const onFollowUp = vi.fn();
    render(<AnswerView answer={ANSWER} onFollowUp={onFollowUp} onward={<span>Pin to dashboard</span>} />);
    expect(screen.queryByText("By region?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Follow-ups · 1/ }));
    fireEvent.click(screen.getByText("By region?"));
    expect(onFollowUp).toHaveBeenCalledWith("By region?");
    expect(screen.getByRole("group", { name: "What this answer can become" })).toHaveTextContent("Pin to dashboard");
  });

  it("draws the one grid when the answer cites no exhibits: one record as figures, more as its result, said as computed", () => {
    const one = { ...ANSWER, exhibits: [], figures: [], headline: "Orders were counted",
      grid: { columns: ["orders"], rows: [[1642]] } };
    const { unmount } = render(<AnswerView answer={one} />);
    expect(screen.queryByTestId("answer-exhibit")).not.toBeInTheDocument();
    expect(screen.getByText("1,642")).toBeInTheDocument();
    unmount();
    render(<AnswerView answer={{ ...one, grid: { columns: ["store", "orders"], rows: [["A", 3], ["B", 4], ["C", 5]] },
      provenance: { ...one.provenance, tables_used: ["shop.orders"] } }} />);
    expect(screen.getByTestId("answer-computed-label")).toHaveTextContent(/^Computed\s*from the executed query · 3 rows · reads shop.orders$/);
  });

  it("while the answer is on its way, shows its scaffold and nothing that needs it whole", () => {
    render(<AnswerView answer={{ ...EMPTY_ENVELOPE, follow_ups: ["x"] }} live={{ headline: "Revenue fe", pending: true }}
      foot={<div data-testid="foot" />} />);
    expect(screen.getByText("Revenue fe")).toBeInTheDocument();
    for (const id of ["answer-how", "answer-onward", "foot", "answer-caveats"]) expect(screen.queryByTestId(id)).not.toBeInTheDocument();
  });

  it("draws a report the envelope does not map in the body's place, and ends it as every answer ends", () => {
    render(<AnswerView answer={{ ...ANSWER, headline: "", body: "", figures: [], exhibits: [] }}
      drawn={<div data-testid="own-report">the exploration</div>} foot={<div data-testid="foot" />} />);
    expect(screen.getByTestId("own-report")).toBeInTheDocument();
    expect(screen.queryByTestId("answer-figures")).not.toBeInTheDocument();
    expect(inOrder([screen.getByTestId("own-report"), screen.getByTestId("answer-caveats"), screen.getByTestId("answer-how"),
                    screen.getByTestId("answer-onward"), screen.getByTestId("foot")])).toBe(true);
  });
});
