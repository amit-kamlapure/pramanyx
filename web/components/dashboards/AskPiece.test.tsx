// @vitest-environment jsdom

/** The study's R19: a change to the chosen piece, asked in words, is said in the panel and kept or not by the person. */
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ASKS_OF_A_PIECE, AskPiece } from "@/components/dashboards/AskPiece";

const api = vi.hoisted(() => ({ askDashboard: vi.fn(), acceptProposal: vi.fn(), rejectProposal: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));

const STAGED = { staged: true, proposal_id: "p1", cockpit_id: "d1", summary: "Proposed an edit to the dashboard.", rounds: 1, stop_reason: "", sentences: [] };
const props = () => ({ connectionId: "c", dashboardId: "d1", pieceKey: "card-1", actor: "briefing", beforeAsk: vi.fn(async () => {}), onKept: vi.fn() });
const propose = (words: string) => {
  fireEvent.change(screen.getByLabelText("Change this in words"), { target: { value: words } });
  fireEvent.click(screen.getByTestId("ask-piece-propose"));
};

beforeEach(() => { api.askDashboard.mockReset(); api.acceptProposal.mockReset(); api.rejectProposal.mockReset(); });

describe("asking about one piece", () => {
  it("keeps what is waiting first, asks about that piece, and changes nothing until it is kept", async () => {
    api.askDashboard.mockResolvedValue(STAGED);
    const p = props();
    render(<AskPiece {...p} />);
    propose("Make it a bar chart");
    expect(await screen.findByTestId("ask-piece-summary")).toHaveTextContent("Proposed an edit");
    expect(p.beforeAsk).toHaveBeenCalled();
    expect(api.askDashboard).toHaveBeenCalledWith("c", "d1", "Make it a bar chart", undefined, "card-1");
    expect(api.acceptProposal).not.toHaveBeenCalled();
    expect(p.onKept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("ask-piece-keep"));
    await waitFor(() => expect(p.onKept).toHaveBeenCalledTimes(1));
    expect(api.acceptProposal).toHaveBeenCalledWith("p1", "briefing");
  });

  it("discards a proposal without keeping it", async () => {
    api.askDashboard.mockResolvedValue(STAGED);
    const p = props();
    render(<AskPiece {...p} />);
    propose("Wider");
    fireEvent.click(await screen.findByTestId("ask-piece-discard"));
    await waitFor(() => expect(api.rejectProposal).toHaveBeenCalledWith("p1", "briefing"));
    expect(p.onKept).not.toHaveBeenCalled();
  });

  it("says why nothing was proposed", async () => {
    api.askDashboard.mockResolvedValue({ ...STAGED, staged: false, proposal_id: "", sentences: ["That piece is no longer on the dashboard."] });
    render(<AskPiece {...props()} />);
    propose("Wider");
    expect(await screen.findByTestId("ask-piece-refused")).toHaveTextContent("no longer on the dashboard");
  });

  it("is not offered on a note, an image or the dashboard itself", () => {
    expect(["Note", "Image", "Cockpit", "Tab"].some(ASKS_OF_A_PIECE)).toBe(false);
    expect(ASKS_OF_A_PIECE("Card")).toBe(true);
  });
});
