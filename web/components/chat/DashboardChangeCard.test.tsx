// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DASHBOARD_CHANGED, DashboardChangeCard } from "@/components/chat/DashboardChangeCard";

const api = vi.hoisted(() => ({ getProposalById: vi.fn(), acceptProposal: vi.fn(), rejectProposal: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));
beforeEach(() => { Object.values(api).forEach(f => f.mockReset()); });

const STAGED = { id: "p1", connection_id: "sheets", status: "pending",
  detail: { mode: "edit", outline: [{ tab: "", sections: [{ title: "One", cards: [{ title: "Movies only", change: "changed" }] }] }] } };

describe("a dashboard change asked in the conversation", () => {
  it("says what it would do and changes nothing until Allow, then tells the dashboard to read itself again", async () => {
    api.getProposalById.mockResolvedValue(STAGED);
    api.acceptProposal.mockResolvedValue({ accepted: true });
    const heard = vi.fn();
    window.addEventListener(DASHBOARD_CHANGED, heard);
    render(<DashboardChangeCard proposalId="p1" />);
    expect(await screen.findByTestId("dashboard-change-card")).toHaveTextContent("Apply 1 change?");
    expect(screen.getByTestId("dashboard-change-line")).toHaveTextContent("Movies only");
    expect(api.acceptProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("dashboard-change-allow"));
    await waitFor(() => expect(screen.getByTestId("dashboard-change-decided")).toHaveTextContent("Applied 1 change"));
    expect(api.acceptProposal).toHaveBeenCalledWith("p1", "briefing");
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(DASHBOARD_CHANGED, heard);
  });

  it("is rejected with nothing changed, and an already decided one reads as decided", async () => {
    api.getProposalById.mockResolvedValueOnce(STAGED).mockResolvedValueOnce({ ...STAGED, status: "accepted" });
    api.rejectProposal.mockResolvedValue(true);
    const { unmount } = render(<DashboardChangeCard proposalId="p1" />);
    fireEvent.click(await screen.findByTestId("dashboard-change-reject"));
    expect(screen.getByTestId("dashboard-change-decided")).toHaveTextContent("Rejected. Nothing changed.");
    expect(api.rejectProposal).toHaveBeenCalledWith("p1", "briefing");
    unmount();
    render(<DashboardChangeCard proposalId="p1" />);
    expect(await screen.findByTestId("dashboard-change-decided")).toHaveAttribute("data-decision", "allowed");
  });

  it("says when the change cannot be read", async () => {
    api.getProposalById.mockResolvedValue(null);
    render(<DashboardChangeCard proposalId="gone" />);
    expect(await screen.findByTestId("dashboard-change-gone")).toBeTruthy();
  });
});
