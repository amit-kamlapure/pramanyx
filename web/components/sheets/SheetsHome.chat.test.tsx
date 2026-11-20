// @vitest-environment jsdom
/**
 * The Spreadsheets home's "In the chat" (2026-11-20): the Ask panel, not a small panel of its own. It opens on the sheets'
 * connection, where a file dropped becomes one proposal for a new sheet (`ChatPanel.sheet.test.tsx`).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sheets", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/sheets")>()),
  listSheets: async () => ({ sheets: [], uploads: [], shared_with: "workspace", me: "ana" }),
}));

import { SheetsHome } from "./SheetsHome";
import { resetAskPanel, useAskPanel } from "@/lib/askPanel";

function Panel() {
  const p = useAskPanel();
  return <span data-testid="panel" data-open={p.open || undefined}>{p.tabs.map(t => t.connectionId).join(",")}</span>;
}

beforeEach(() => { window.localStorage.clear(); resetAskPanel(); });

describe("the Spreadsheets home's In the chat", () => {
  it("opens the Ask panel on the sheets, and no panel of its own", async () => {
    render(<><SheetsHome onOpen={() => {}} /><Panel /></>);
    fireEvent.click(await screen.findByRole("button", { name: /In the chat/ }));
    expect(screen.getByTestId("panel")).toHaveAttribute("data-open");
    expect(screen.getByTestId("panel")).toHaveTextContent("sheets");
    expect(screen.queryByRole("complementary", { name: "Make a sheet in the chat" })).toBeNull();
  });
});
