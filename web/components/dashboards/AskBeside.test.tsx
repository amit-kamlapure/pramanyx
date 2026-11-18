// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ changeDashboardLive: vi.fn(), getProposalById: vi.fn(), acceptProposal: vi.fn(), rejectProposal: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));
vi.mock("next/dynamic", () => ({ default: () => function Chat() { return <div data-testid="the-chat" />; } }));

import { AskBeside } from "@/components/dashboards/AskBeside";
import { askAbout, askSubject, hideAskBeside, type AskSubject } from "@/lib/askSubject";
import { NAVIGATE_EVENT } from "@/lib/navigate";

const SUBJECT: AskSubject = { kind: "dashboard", connectionId: "thelook", noun: ["card", "cards"], dashboard: "sales", title: "Sales", period: null };
const door = (over = {}) => ({ dashboardId: "sales", unpublished: true, onChanged: vi.fn(), onPublish: vi.fn(), ...over });
const page = (change: ReturnType<typeof door> | null = door(), dashboardKey = "sales") => (
  <Theme><AskBeside connectionId="thelook" dashboardKey={dashboardKey} title="Sales" change={change}><div data-testid="the-dashboard" /></AskBeside></Theme>
);
const STAGED = { staged: true, proposal_id: "p1", summary: "", rounds: 1, stop_reason: "", sentences: [] };
const PROPOSAL = { id: "p1", reasoning: "Revenue leads the page.", detail: { mode: "edit", outline: [{ sections: [{ title: "Sales", change: "changed", cards: [{ title: "Revenue", change: "changed" }] }] }], taken_off: [] } };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Ask, beside the dashboard", () => {
  it("opens beside the page with what was asked about, and leaves the page where it is", () => {
    const went = vi.fn();
    window.addEventListener(NAVIGATE_EVENT, went);
    render(page());
    expect(screen.queryByTestId("ask-beside")).toBeNull();
    act(() => askAbout(SUBJECT));
    expect(screen.getByTestId("ask-beside")).toBeVisible();
    expect(screen.getByTestId("the-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("the-chat")).toBeInTheDocument();
    expect(askSubject()).toBe(SUBJECT);
    expect(went).not.toHaveBeenCalled();
    window.removeEventListener(NAVIGATE_EVENT, went);
  });

  it("opens the Data Canvas as before where no page holds a panel", () => {
    const went = vi.fn();
    window.addEventListener(NAVIGATE_EVENT, went);
    askAbout(SUBJECT);
    expect(went).toHaveBeenCalledTimes(1);
    window.removeEventListener(NAVIGATE_EVENT, went);
  });

  it("lets go of the subject when closed, and starts over on another dashboard", () => {
    const { rerender } = render(page());
    act(() => askAbout(SUBJECT));
    fireEvent.click(screen.getByTestId("ask-beside-close"));
    expect(askSubject()).toBeNull();
    expect(screen.getByTestId("ask-beside")).not.toBeVisible();
    act(() => askAbout(SUBJECT));
    rerender(page(door(), "operations"));
    expect(screen.queryByTestId("ask-beside")).toBeNull();
    expect(askSubject()).toBeNull();
  });

  it("offers Change only on a dashboard the person may change", () => {
    render(page(null));
    act(() => askAbout(SUBJECT));
    expect(screen.queryByRole("radio", { name: "Change" })).toBeNull();
    act(() => hideAskBeside());
  });

  it("shows a change before making it, and only the person's Allow makes it", async () => {
    api.changeDashboardLive.mockImplementation(async (_c, _d, _w, _s, live) => { live.hear({ type: "read", metrics: 2, trusted_queries: 0, findings: 0 }); return STAGED; });
    api.getProposalById.mockResolvedValue(PROPOSAL);
    api.acceptProposal.mockResolvedValue({ status: "executed" });
    const change = door();
    render(page(change));
    act(() => askAbout(SUBJECT));
    fireEvent.click(screen.getByRole("radio", { name: "Change" }));
    fireEvent.change(screen.getByLabelText("Describe the change"), { target: { value: "Put revenue first" } });
    fireEvent.keyDown(screen.getByLabelText("Describe the change"), { key: "Enter" });

    expect(await screen.findByTestId("change-card")).toHaveTextContent("Apply 1 change?");
    expect(screen.getByTestId("change-line")).toHaveTextContent("Revenue");
    expect(api.acceptProposal).not.toHaveBeenCalled();
    expect(change.onChanged).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("change-allow"));
    await waitFor(() => expect(api.acceptProposal).toHaveBeenCalledWith("p1", "briefing"));
    expect(await screen.findByTestId("change-decided")).toHaveTextContent("Applied 1 change");
    expect(change.onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("change-steps-toggle")).toHaveTextContent("steps");
  });

  it("changes nothing on Skip, and says why when no change could be drafted", async () => {
    api.changeDashboardLive.mockResolvedValueOnce(STAGED).mockResolvedValueOnce({ ...STAGED, staged: false, proposal_id: "", sentences: ["There is no such card."] });
    api.getProposalById.mockResolvedValue(PROPOSAL);
    api.rejectProposal.mockResolvedValue(true);
    const change = door();
    render(page(change));
    act(() => askAbout(SUBJECT));
    fireEvent.click(screen.getByRole("radio", { name: "Change" }));
    const box = screen.getByLabelText("Describe the change");
    fireEvent.change(box, { target: { value: "Put revenue first" } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.click(await screen.findByTestId("change-skip"));
    expect(await screen.findByTestId("change-decided")).toHaveTextContent("Skipped. Nothing changed.");
    expect(api.acceptProposal).not.toHaveBeenCalled();
    expect(api.rejectProposal).toHaveBeenCalledWith("p1", "briefing");

    fireEvent.change(box, { target: { value: "Add a card" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByTestId("change-refused")).toHaveTextContent("There is no such card.");
  });
});
