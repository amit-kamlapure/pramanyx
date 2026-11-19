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

  it("says a change a later one replaced was replaced, not rejected", async () => {
    api.getProposalById.mockResolvedValue({ ...STAGED, status: "superseded" });
    render(<DashboardChangeCard proposalId="p1" />);
    expect(await screen.findByTestId("dashboard-change-decided")).toHaveTextContent("Replaced by a later change. Nothing changed by this one.");
  });

  it("reads itself again when a later change is drafted, so a replaced one stops offering Allow (seen live 2026-11-19)", async () => {
    const status: Record<string, string> = { p1: "pending", p2: "pending" };
    api.getProposalById.mockImplementation(async (id: string) => ({ ...STAGED, id, status: status[id] }));
    render(<DashboardChangeCard proposalId="p1" />);
    expect(await screen.findByTestId("dashboard-change-allow")).toBeTruthy();
    status.p1 = "superseded";                                   // the next draft replaces it
    render(<DashboardChangeCard proposalId="p2" />);
    await waitFor(() => expect(screen.getByTestId("dashboard-change-decided")).toHaveAttribute("data-decision", "replaced"));
    expect(screen.getAllByTestId("dashboard-change-allow")).toHaveLength(1);   // only the latest still asks
  });
});

describe("a change to how one chart is drawn (2026-11-19)", () => {
  it("names the chart and says each setting that changes, before Allow", async () => {
    api.getProposalById.mockResolvedValue({ id: "p2", kind: "chart_look", connection_id: "sheets", status: "pending",
      detail: { title: "Revenue by priority", lines: ["Line width: 2 → 4", "Line shape: none → smooth"] } });
    render(<DashboardChangeCard proposalId="p2" />);
    expect(await screen.findByTestId("dashboard-change-card")).toHaveTextContent("Change how “Revenue by priority” is drawn?");
    expect(screen.getAllByTestId("dashboard-change-line").map(l => l.textContent)).toEqual(["ChangeLine width: 2 → 4", "ChangeLine shape: none → smooth"]);
    expect(api.acceptProposal).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dashboard-change-stand-in")).toBeNull();
  });

  it("says first when it is only the closest the chart can do to what was asked (2026-11-20)", async () => {
    api.getProposalById.mockResolvedValue({ id: "p3", kind: "chart_look", connection_id: "sheets", status: "pending",
      detail: { title: "Olist orders", lines: ["Line width: 4 → 6"], stand_in: "Not possible here: a neon glow. This is the closest the chart can do." } });
    render(<DashboardChangeCard proposalId="p3" />);
    expect(await screen.findByTestId("dashboard-change-stand-in")).toHaveTextContent("Not possible here: a neon glow. This is the closest the chart can do.");
    expect(screen.getAllByTestId("dashboard-change-line")).toHaveLength(1);
  });
});
