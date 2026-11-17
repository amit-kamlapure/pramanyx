// @vitest-environment jsdom
/**
 * The schedules page, two ways (2026-11-18): from the coworker's Schedules entry it carries the connection picker; opened
 * beside a conversation (`beside=1`) it is that schedule on the conversation's connection and nothing else — the user:
 * the Automations, Runs and Inbox tabs and the connection picker are "not needed" there.
 */
import { act, Suspense } from "react";
import { render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const panel = vi.fn();
vi.mock("@/components/AutomationsPanel", () => ({
  AutomationsPanel: (props: Record<string, unknown>) => { panel(props); return <div data-testid="automations-panel" />; },
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  getConnections: vi.fn(async () => [{ id: "sheets", name: "Sheets" }, { id: "thelook", name: "theLook" }]),
}));

const { default: AutomationsRoute } = await import("./page");

async function open(query: Record<string, string>) {
  await act(async () => {
    render(<Suspense fallback={null}><AutomationsRoute searchParams={Promise.resolve(query)} /></Suspense>);
  });
}

beforeEach(() => panel.mockReset());

describe("the schedules page", () => {
  it("beside a conversation: no connection picker, and the panel is told it is beside one", async () => {
    await open({ conn: "sheets", focus: "a1", beside: "1" });
    await screen.findByTestId("automations-panel");
    expect(screen.queryByLabelText("Connection")).toBeNull();
    expect(screen.queryByText("Schedules and automations on")).toBeNull();
    await waitFor(() => expect(panel).toHaveBeenLastCalledWith(expect.objectContaining({ connId: "sheets", focusId: "a1", beside: true })));
  });

  it("from the Schedules entry: the connection picker, and the panel whole", async () => {
    await open({ conn: "sheets" });
    await screen.findByTestId("automations-panel");
    expect(screen.getByLabelText("Connection")).toBeInTheDocument();
    await waitFor(() => expect(panel).toHaveBeenLastCalledWith(expect.objectContaining({ connId: "sheets", beside: false })));
  });
});
