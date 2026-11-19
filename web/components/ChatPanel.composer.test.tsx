// @vitest-environment jsdom
/**
 * The Ask composer (Stage 1, the user's shape for the panel): "@ for objects, / for commands, ↑↓ for history". A mention
 * offers the connection's tables and metrics, read only once one is started; a command at the start changes how the next
 * question is answered; ↑ in an empty box brings back what was asked. The chat transport is a double: no network.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getSchemaRich: vi.fn(async () => ({ tables: [{ name: "main.orders", row_count: "1", columns: [] }, { name: "main.order_items", row_count: "1", columns: [] }], joins: [], isolated: [], warnings: [] })),
  getMetrics: vi.fn(async () => [{ name: "gross_revenue", label: "Gross revenue" }]),
}));
const sent: { text: string; body: Record<string, unknown> }[] = [];
const prior = vi.hoisted(() => ({ messages: [] as unknown[] }));

vi.mock("@/lib/usePramanyxChat", () => ({
  usePramanyxChat: () => ({
    messages: prior.messages,
    sendMessage: (m: { text: string }, o: { body: Record<string, unknown> }) => { sent.push({ text: m.text, body: o.body }); return Promise.resolve(); },
    setMessages: vi.fn(), regenerate: vi.fn(), stop: vi.fn(), status: "ready", error: undefined, clearError: vi.fn(),
  }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
  getConnections: vi.fn(async () => []),
  getSystemFlags: vi.fn(async () => ({})),
  listUserAgents: vi.fn(async () => []),
  recordOverviewDrill: vi.fn(),
  cancelActiveDeepRun: vi.fn(),
}));

import { ChatPanel } from "./ChatPanel";

beforeEach(() => {
  sent.length = 0;
  prior.messages = [];
  api.getSchemaRich.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ suggestions: [], starters: [] }), { status: 200 })));
});

async function panel(onNew = vi.fn()) {
  render(<QueryClientProvider client={new QueryClient()}><ChatPanel connectionId="sheets" harness beside onNew={onNew} /></QueryClientProvider>);
  await act(async () => {});
  return { box: screen.getByRole("textbox") as HTMLTextAreaElement, onNew };
}
const type = (box: HTMLTextAreaElement, value: string) => {
  fireEvent.change(box, { target: { value, selectionStart: value.length } });
  box.setSelectionRange(value.length, value.length);
  fireEvent.select(box);
};

describe("the Ask composer", () => {
  it("says what it offers in its placeholder", async () => {
    const { box } = await panel();
    expect(box.placeholder).toContain("@ for objects, / for commands, ↑↓ for history");
  });

  it("offers commands at the start, and /quick answers the next question quickly", async () => {
    const { box } = await panel();
    type(box, "/q");
    expect(screen.getByTestId("composer-offers")).toHaveAttribute("data-kind", "command");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("");
    type(box, "how many orders?");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(sent.at(-1)?.body).toMatchObject({ depth: "quick" });
  });

  it("opens a new conversation with /new", async () => {
    const { box, onNew } = await panel();
    type(box, "/ne");
    fireEvent.click(screen.getByRole("option", { name: /\/new/ }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("offers the connection's tables and metrics after @, read only once a mention starts", async () => {
    const { box } = await panel();
    expect(api.getSchemaRich).not.toHaveBeenCalled();
    type(box, "How many rows in @ord");
    await act(async () => {});
    type(box, "How many rows in @ord");                     // the objects have arrived
    const offers = screen.getAllByTestId("composer-offer").map(o => o.textContent);
    expect(offers).toEqual(["main.orderstable", "main.order_itemstable"]);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Tab" });
    expect(box.value).toBe("How many rows in @main.order_items ");
    expect(api.getSchemaRich).toHaveBeenCalledTimes(1);
  });

  it("brings back what was asked with ↑ in an empty box, and the draft with ↓", async () => {
    prior.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "how many orders?" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Twelve.", state: "done", providerMetadata: { pramanyx: { channel: "headline" } } }] },
    ];
    const { box } = await panel();
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box.value).toBe("how many orders?");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.value).toBe("");
  });
});
