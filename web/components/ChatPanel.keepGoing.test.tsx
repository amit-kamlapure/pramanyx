// @vitest-environment jsdom
/**
 * Keep going (the user, 2026-11-20, on Operations: a chart asked for "YYYY-MM" stopped with "ask a narrower question").
 * A turn that spent every step offers to go on; going on sends the same question with what the turn already did, refusals
 * marked, so the conversation picks up instead of starting over and does not ask a tool that said no again.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { text: string; body: Record<string, unknown> }[] = [];
let MESSAGES: unknown[] = [];

const stopped = (keepGoing: boolean) => [
  { id: "u1", role: "user", metadata: { mode: "ask" }, parts: [{ type: "text", text: "Write the months as YYYY-MM" }] },
  { id: "a1", role: "assistant", parts: [
    { type: "data-converse_step", data: { index: 1, tool: "change_chart", ok: true, refused: true, detail: "“monthFormat” is not something the chart editor sets." } },
    { type: "data-converse_step", data: { index: 2, tool: "explain_dashboard", ok: true, detail: "" } },
    { type: "text", text: "I used all 8 steps this turn before finishing.", providerMetadata: { pramanyx: { channel: "headline" } } },
    ...(keepGoing ? [{ type: "data-keep_going", data: { steps: 8, found: ["1. SELECT day, SUM(paid) FROM o GROUP BY 1 → 46 rows"] } }] : []),
    { type: "data-done", data: {} },
  ] },
];

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

describe("a turn that ran out of steps", () => {
  it("offers Keep going, which asks the same question again with the steps it took and what said no", async () => {
    MESSAGES = stopped(true);
    render(<ChatPanel connectionId="sheets" />);
    await act(async () => {});
    act(() => { fireEvent.click(screen.getByTestId("keep-going")); });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe("Write the months as YYYY-MM");
    expect(sent[0].body.keep_going).toBe("1. change_chart — said no: “monthFormat” is not something the chart editor sets.\n2. explain_dashboard"
      + "\nWhat the queries found:\n1. SELECT day, SUM(paid) FROM o GROUP BY 1 → 46 rows");
  });

  it("is not offered on a turn that finished", async () => {
    MESSAGES = stopped(false);
    render(<ChatPanel connectionId="sheets" />);
    await act(async () => {});
    expect(screen.queryByTestId("keep-going")).toBeNull();
  });
});
