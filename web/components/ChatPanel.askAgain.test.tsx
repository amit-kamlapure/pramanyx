// @vitest-environment jsdom
/**
 * A question asked again is asked as a typed one is (2026-11-23). A clicked follow-up carried `purpose`, which kept it off
 * the conversation's door: it went to the old `/chat` door, with no tools and no subject, so in the Ask panel beside a
 * dashboard a follow-up was answered about nothing in particular. "Ask again" and Edit went to `/ask` at depth auto with
 * no subject either. Each now takes the conversation's door, at its depth, about what the page shows.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nounOf, setAskSubject, type AskSubject } from "@/lib/askSubject";

const sent: { text: string; body: Record<string, unknown> }[] = [];
const regenerate = vi.fn((_o?: unknown) => Promise.resolve());

const ANSWERED = [
  { id: "u1", role: "user", metadata: { mode: "ask" }, parts: [{ type: "text", text: "How many orders were late?" }] },
  { id: "a1", role: "assistant", parts: [
    { type: "text", text: "Twelve orders were late.", providerMetadata: { pramanyx: { channel: "headline" } } },
    { type: "data-followups", data: { questions: ["Which carrier was late most?"] } },
    { type: "data-done", data: {} },
  ] },
];

vi.mock("@/lib/usePramanyxChat", () => ({
  usePramanyxChat: () => ({
    messages: ANSWERED,
    sendMessage: (m: { text: string }, o: { body: Record<string, unknown> }) => { sent.push({ text: m.text, body: o.body }); return Promise.resolve(); },
    setMessages: vi.fn(), regenerate, stop: vi.fn(), status: "ready", error: undefined, clearError: vi.fn(),
  }),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getConnections: vi.fn(async () => []),
  getSystemFlags: vi.fn(async () => ({})),
  listUserAgents: vi.fn(async () => []),
  recordOverviewDrill: vi.fn(),
  cancelActiveDeepRun: vi.fn(),
}));

import { ChatPanel } from "./ChatPanel";

const LATE: AskSubject = { kind: "objects", connectionId: "thelook", noun: nounOf("Order"), label: "Late dispatch",
  refs: ["order:1", "order:2"] };
const FOCUS = { focus: { kind: "objects", objects: ["order:1", "order:2"], label: "Late dispatch" } };

beforeEach(() => {
  sent.length = 0;
  regenerate.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ suggestions: [], starters: [] }), { status: 200 })));
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => setAskSubject(null));
});

const inThePanel = async () => {
  act(() => setAskSubject(LATE));
  render(<ChatPanel connectionId="thelook" harness beside />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /Follow-ups · 1/ }));
};

describe("a question asked again, in the Ask panel beside what a reader chose", () => {
  it("a clicked follow-up goes through the conversation's door, about the same subject", async () => {
    await inThePanel();
    fireEvent.click(screen.getByText("Which carrier was late most?"));
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ mode: "auto", depth: "auto", purpose: "followup", ...FOCUS });
  });

  it("Ask again goes through the same door, about the same subject", async () => {
    await inThePanel();
    fireEvent.click(screen.getByText("↺ Ask again"));
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(regenerate.mock.calls[0][0]).toMatchObject({ body: { mode: "auto", depth: "auto", purpose: "ask_again", ...FOCUS } });
  });
});
