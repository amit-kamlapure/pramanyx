// @vitest-environment jsdom
/**
 * The Ask composer (Stage 1, the user's shape for the panel): "@ for objects, / for commands, ↑↓ for history". A mention
 * offers the connection's tables and metrics, read only once one is started; a command at the start changes how the next
 * question is answered; ↑ in an empty box brings back what was asked. The chat transport is a double: no network.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getSchemaRich: vi.fn(async () => ({ tables: [{ name: "main.orders", row_count: "1", columns: [] }, { name: "main.order_items", row_count: "1", columns: [] }], joins: [], isolated: [], warnings: [] })),
  getMetrics: vi.fn(async () => [{ name: "gross_revenue", label: "Gross revenue" }]),
  listDashboards: vi.fn(async () => ({ person: "ana", cockpits: [{ cockpit_id: "d1", title: "Operations", retired: false, cards: ["c1"] }] })),
  listCards: vi.fn(async () => [{ id: "c1", title: "Orders by day" }, { id: "c9", title: "Someone else's" }]),
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

import { dashboardSubject, setAskSubject } from "@/lib/askSubject";

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

  it("opens saying how it answers, with no Quick or Agent to switch to (2026-11-20)", async () => {
    await panel();
    const how = screen.getByTestId("chat-empty-how");
    expect(how).toHaveTextContent("Answers straight away. Type /agent to investigate in depth.");
    expect(how).not.toHaveTextContent("Quick");
  });

  it("beside a dashboard the person keeps, says a change waits for their Allow", async () => {
    act(() => setAskSubject(dashboardSubject("sheets", "sheets:ops", "Ops", null)));
    await panel();
    expect(screen.getByTestId("chat-empty-how")).toHaveTextContent(
      "Ask a question or describe a change: nothing changes until you allow it. Type /agent to investigate in depth.");
    act(() => setAskSubject(null));
  });

  it("on a Data Canvas is the one conversation: the panel's composer, no picker, /agent to go deep (2026-11-20)", async () => {
    render(<QueryClientProvider client={new QueryClient()}><ChatPanel connectionId="sheets" canvasId="cv1" harness oneConversation /></QueryClientProvider>);
    await act(async () => {});
    expect(screen.getByTestId("chat-empty-how")).toHaveTextContent("Answers straight away. Type /agent to investigate in depth.");
    expect(screen.queryByRole("radiogroup", { name: "How to answer" })).toBeNull();
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "how many orders?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(sent.at(-1)?.body).toMatchObject({ depth: "quick" });
  });

  it("under a canvas's own landing, still says how it answers (2026-11-20: the landing's Quick/Agent chips are gone)", async () => {
    render(<QueryClientProvider client={new QueryClient()}><ChatPanel connectionId="sheets" canvasId="cv1" harness oneConversation
      capabilities={<div data-testid="the-landing">Returns</div>} /></QueryClientProvider>);
    await act(async () => {});
    expect(screen.getByTestId("the-landing")).toBeInTheDocument();
    expect(screen.getByTestId("chat-empty-how")).toHaveTextContent(/^Answers straight away\. Type \/agent to .+ in depth\.$/);
    expect(screen.queryByText("Ask your data anything")).toBeNull();
  });

  it("lists a named starter by its short question, says it runs a deep analysis, and asks its whole brief (2026-11-20)", async () => {
    const brief = "Where are we losing money? Quantify money that walks back out — refunds, cancellations, chargebacks.";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ suggestions: [{ text: "How many orders a day?", mode: "ask" }],
      starters: [{ title: "Where are we losing money?", text: brief, mode: "explore", purpose: "profitability", source: "library" },
        { title: "orders", text: "Which states order most?", mode: "explore", purpose: "curated_question", source: "curated" }] }), { status: 200 })));
    render(<QueryClientProvider client={new QueryClient()}><ChatPanel connectionId="sheets" canvasId="cv1" harness oneConversation /></QueryClientProvider>);
    await act(async () => {});
    const rows = await screen.findAllByTestId("chat-starter");
    const texts = rows.map(r => r.textContent);
    expect(texts).toContain("Where are we losing money?Deep analysis");
    expect(texts).toContain("Which states order most?Deep analysis");   // a curated one is listed by its question, not its table
    expect(texts).toContain("How many orders a day?");                  // a plain suggestion answers straight away
    expect(texts.join(" ")).not.toContain("Quantify");
    fireEvent.click(rows.find(r => r.textContent?.startsWith("Where are we losing money?"))!);
    expect(sent.at(-1)?.text).toBe(brief);
  });

  it("says which saved agent the person arrived talking to, and lets it go", async () => {
    render(<QueryClientProvider client={new QueryClient()}><ChatPanel connectionId="sheets" harness oneConversation initialAgentId="ag1" /></QueryClientProvider>);
    await act(async () => {});
    expect(screen.getByTestId("composer-agent")).toHaveTextContent("Talking to");
    fireEvent.click(screen.getByRole("button", { name: "Stop talking to this agent" }));
    expect(screen.queryByTestId("composer-agent")).toBeNull();
  });

  it("on the legacy chat page, where the picker stays, still says Agent or Quick", async () => {
    render(<QueryClientProvider client={new QueryClient()}><ChatPanel connectionId="sheets" /></QueryClientProvider>);
    await act(async () => {});
    expect(screen.getByTestId("chat-empty-how")).toHaveTextContent("Agent investigates in depth — switch to Quick for a straight answer.");
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
    // the list appears once the objects arrive, with no further keystroke
    // the tables first, then a card on the person's own dashboard, said with the dashboard it is on — never another's
    await waitFor(() => expect(screen.getAllByTestId("composer-offer").map(o => o.textContent))
      .toEqual(["main.orderstable", "main.order_itemstable", "Orders by daycard · Operations"]));
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
