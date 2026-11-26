// @vitest-environment jsdom
/**
 * "Answer anyway" (the Area map plan's gap, 2026-11-26): going ahead without answering a clarifying question sends what
 * was asked and the readings it offered, so the answer's receipt keeps the clarification left unanswered — before, only
 * `skip_clarify` went, and nothing anywhere said what had been asked.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { text: string; body: Record<string, unknown> }[] = [];
let MESSAGES: unknown[] = [];

vi.mock("@/lib/usePramanyxChat", () => ({
  usePramanyxChat: () => ({
    messages: MESSAGES,
    sendMessage: (m: { text: string }, o: { body: Record<string, unknown> }) => { sent.push({ text: m.text, body: o.body }); return Promise.resolve(); },
    setMessages: vi.fn(), regenerate: vi.fn(), stop: vi.fn(), status: "ready", error: undefined, clearError: vi.fn(),
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

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ suggestions: [], starters: [] }), { status: 200 })));
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("a clarifying question the person goes ahead without", () => {
  it("sends what was asked and the readings offered, beside skip_clarify", async () => {
    MESSAGES = [
      { id: "u1", role: "user", metadata: { mode: "auto" }, parts: [{ type: "text", text: "revenue last month" }] },
      { id: "a1", role: "assistant", parts: [
        { type: "data-clarify", data: { question: "Which revenue do you mean?", options: ["booked", "net of returns"],
          previews: [], source: "rival_meanings", reason: "two Areas define it" } },
        { type: "data-done", data: {} },
      ] },
    ];
    render(<ChatPanel connectionId="c1" />);
    await act(async () => {});
    act(() => { fireEvent.click(screen.getByText(/Answer anyway/)); });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe("revenue last month");
    expect([sent[0].body.skip_clarify, sent[0].body.clarify_reading, sent[0].body.clarify_asked, sent[0].body.clarify_options,
      sent[0].body.clarify_source, sent[0].body.clarify_subject])
      .toEqual([true, "", "Which revenue do you mean?", ["booked", "net of returns"], "rival_meanings", "revenue last month"]);
  });
});
