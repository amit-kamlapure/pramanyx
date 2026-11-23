// @vitest-environment jsdom
/**
 * A `?chat=` link opened an empty conversation, on every reload (2026-10-02): the canvas mounts the chat
 * panel before its connection has loaded, the restore wrote the turns into that Chat, and the arriving
 * connection rebuilt the Chat — same id, no turns. The connection now rides a ref; only a new session id
 * makes a new Chat.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePramanyxChat } from "@/lib/usePramanyxChat";

const turn = { id: "m1", role: "user" as const, parts: [{ type: "text" as const, text: "What was total revenue in July 2026?" }] };

describe("a restored conversation", () => {
  it("survives its connection arriving after it", () => {
    const { result, rerender } = renderHook((p: { connectionId: string; sessionId: string }) => usePramanyxChat(p),
                                            { initialProps: { connectionId: "", sessionId: "s1" } });
    act(() => result.current.setMessages([turn]));
    rerender({ connectionId: "8233e4fd", sessionId: "s1" });
    expect(result.current.messages.map((m) => m.id)).toEqual(["m1"]);
  });

  it("a new session is a new, empty conversation", () => {
    const { result, rerender } = renderHook((p: { connectionId: string; sessionId: string }) => usePramanyxChat(p),
                                            { initialProps: { connectionId: "c", sessionId: "s1" } });
    act(() => result.current.setMessages([turn]));
    rerender({ connectionId: "c", sessionId: "s2" });
    expect(result.current.messages).toEqual([]);
  });
});

describe("reattaching to a run in flight", () => {
  afterEach(() => vi.unstubAllGlobals());
  const asked = () => {
    const fetchSpy = vi.fn(async (_url: RequestInfo | URL) => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    return () => fetchSpy.mock.calls.map(([url]) => String(url)).filter(u => u.includes("/stream"));
  };

  it("is asked on mount by default", async () => {
    const streams = asked();
    renderHook(() => usePramanyxChat({ connectionId: "c", sessionId: "s1" }));
    await waitFor(() => expect(streams().some(u => u.includes("/api/chat/s1/stream"))).toBe(true));
  });

  it("is not asked for a conversation minted here and now (the ⌘K palette, on every page load, 2026-11-23)", async () => {
    const streams = asked();
    renderHook(() => usePramanyxChat({ connectionId: "c", sessionId: "s2", resume: false }));
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(streams()).toEqual([]);
  });
});
