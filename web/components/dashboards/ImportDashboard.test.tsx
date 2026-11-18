// @vitest-environment jsdom

/** The study's R22: a file is read in whole or refused by name. */
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImportDashboard } from "@/components/dashboards/ImportDashboard";

const importDashboard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), importDashboard }));

const handed = (text: string, name = "sales.dashboard.json") => {
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(screen.getByTestId("dashboard-import-file"), { target: { files: [file] } });
};

beforeEach(() => importDashboard.mockReset());

describe("reading in a dashboard file", () => {
  it("opens what it made", async () => {
    importDashboard.mockResolvedValue({ imported: true, dashboard_id: "sales-1", title: "Sales", version: 1 });
    const onImported = vi.fn();
    render(<ImportDashboard connectionId="c" onImported={onImported} onRefused={vi.fn()} />);
    handed('{"format":"pramanyx.dashboard"}');
    await waitFor(() => expect(onImported).toHaveBeenCalledWith("sales-1", "Sales"));
    expect(importDashboard).toHaveBeenCalledWith("c", { format: "pramanyx.dashboard" });
  });

  it("says each thing that did not resolve", async () => {
    const sentences = ['The card "Revenue" reads ledger.payments, which this connection does not have.'];
    importDashboard.mockResolvedValue({ imported: false, sentences });
    const onRefused = vi.fn();
    render(<ImportDashboard connectionId="c" onImported={vi.fn()} onRefused={onRefused} />);
    handed("{}");
    await waitFor(() => expect(onRefused).toHaveBeenCalledWith(sentences));
  });

  it("sends nothing of a file that is not JSON", async () => {
    const onRefused = vi.fn();
    render(<ImportDashboard connectionId="c" onImported={vi.fn()} onRefused={onRefused} />);
    handed("not json", "notes.txt");
    await waitFor(() => expect(onRefused).toHaveBeenCalledWith(["notes.txt is not a JSON file."]));
    expect(importDashboard).not.toHaveBeenCalled();
  });
});
