// @vitest-environment jsdom

/** The study's R21: a subscription is saved for the published dashboard; a preview sends nothing. */
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SubscribeDashboard } from "@/components/dashboards/SubscribeDashboard";

const api = vi.hoisted(() => ({
  createBriefSubscription: vi.fn(), deleteBriefSubscription: vi.fn(), getActionTriggers: vi.fn(), getBriefSubscriptions: vi.fn(), getSlackBots: vi.fn(),
  previewBriefSubscription: vi.fn(), testBriefSubscription: vi.fn(),
}));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));

const HELD = { id: "s1", conn_id: "c", name: "n", period: "week", send_cron: "", content: "dashboard", dashboard: "sales", email_to: "a@example.com",
  trigger_id: "", enabled: true, created_at: "", updated_at: "", last_sent_at: null, last_status: null, last_error: null };
const draw = () => render(<SubscribeDashboard open onClose={vi.fn()} connectionId="c" dashboardId="sales" title="Sales" />);

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset());
  api.getBriefSubscriptions.mockResolvedValue([]);
  api.getSlackBots.mockResolvedValue([]);
  api.getActionTriggers.mockResolvedValue([]);
  api.createBriefSubscription.mockResolvedValue(HELD);
});

describe("subscribing to a dashboard", () => {
  it("saves the dashboard, the rhythm, the address and the file", async () => {
    draw();
    expect(screen.getByTestId("dashboard-subscribe-save")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByTestId("dashboard-subscribe-save"));
    await waitFor(() => expect(api.createBriefSubscription).toHaveBeenCalledWith(expect.objectContaining({
      conn_id: "c", content: "dashboard", dashboard: "sales", period: "week", email_to: "a@example.com", file_format: "pdf",
    })));
  });

  it("lists only this dashboard's, and a preview says what would go without sending it", async () => {
    api.getBriefSubscriptions.mockResolvedValue([HELD, { ...HELD, id: "s2", dashboard: "other" }, { ...HELD, id: "s3", content: "briefing", dashboard: "" }]);
    api.previewBriefSubscription.mockResolvedValue({ status: "preview", markdown: "Revenue: 12 (October)" });
    draw();
    await waitFor(() => expect(screen.getAllByTestId("dashboard-subscription")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByTestId("dashboard-subscribe-preview")).toHaveTextContent("Revenue: 12 (October)");
    expect(api.testBriefSubscription).not.toHaveBeenCalled();
  });

  it("says why a subscription was refused", async () => {
    api.createBriefSubscription.mockRejectedValue(new Error("This App has no published version to read."));
    draw();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "a@example.com" } });
    fireEvent.click(screen.getByTestId("dashboard-subscribe-save"));
    expect(await screen.findByTestId("dashboard-subscribe-problem")).toHaveTextContent("no published version");
  });
});
