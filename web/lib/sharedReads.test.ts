/**
 * Identical reads asked at the same moment share one request (2026-11-23): each asker gets its own copy of one answer;
 * a write ends every share under way; nothing is kept once answered.
 */
import { describe, expect, it, vi } from "vitest";

import { shareKey, sharingReads } from "@/lib/sharedReads";

const API = "http://api.test";

/** A fetch whose answers arrive when the test says, counting what was sent. */
function network() {
  const sent: { url: string; method: string }[] = [];
  const waiting: ((r: Response) => void)[] = [];
  const raw = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), method: (init?.method ?? "GET").toUpperCase() });
    return new Promise<Response>(resolve => waiting.push(resolve));
  });
  const answer = (body: unknown) => waiting.shift()?.(new Response(JSON.stringify(body)));
  return { raw, sent, answer, waiting };
}

describe("reads shared while on their way", () => {
  it("sends two identical reads once, and each asker reads its own copy of the answer", async () => {
    const net = network();
    const f = sharingReads(net.raw, () => API, () => "ws1");
    const a = f(`${API}/workspaces`), b = f(`${API}/workspaces`);
    expect(net.sent).toHaveLength(1);
    net.answer([{ id: 1 }]);
    expect(await (await a).json()).toEqual([{ id: 1 }]);
    expect(await (await b).json()).toEqual([{ id: 1 }]);
  });

  it("keeps nothing once answered: the next read goes out afresh", async () => {
    const net = network();
    const f = sharingReads(net.raw, () => API, () => "ws1");
    const a = f(`${API}/alerts`);
    net.answer([]);
    await a;
    await Promise.resolve();
    void f(`${API}/alerts`);
    expect(net.sent).toHaveLength(2);
  });

  it("never shares a read across a write: one asked after a save sees the save", () => {
    const net = network();
    const f = sharingReads(net.raw, () => API, () => "ws1");
    void f(`${API}/record/definitions`);
    void f(`${API}/record/definitions`, { method: "POST", body: "{}" });
    void f(`${API}/record/definitions`);
    expect(net.sent.map(s => s.method)).toEqual(["GET", "POST", "GET"]);
  });

  it("shares nothing that is not a plain read of the API", () => {
    const net = network();
    const f = sharingReads(net.raw, () => API, () => "ws1");
    const signal = new AbortController().signal;
    void f(`${API}/discover`, { signal }); void f(`${API}/discover`, { signal });             // a caller may abort its own
    void f("/api/chat/s1/stream"); void f("/api/chat/s1/stream");                           // not the API: the app's own routes
    void f("https://elsewhere.test/x"); void f("https://elsewhere.test/x");
    expect(net.sent).toHaveLength(6);
  });

  it("keys a read by its workspace and its headers", () => {
    expect(shareKey(`${API}/alerts`, undefined, API, "ws1")).not.toEqual(shareKey(`${API}/alerts`, undefined, API, "ws2"));
    expect(shareKey(`${API}/alerts`, { headers: { "X-A": "1" } }, API, "ws1"))
      .not.toEqual(shareKey(`${API}/alerts`, { headers: { "X-A": "2" } }, API, "ws1"));
    expect(shareKey(`${API}/events`, { headers: { Accept: "text/event-stream" } }, API, "ws1")).toBeNull();
    expect(shareKey(new Request(`${API}/alerts`), undefined, API, "ws1")).toBeNull();
  });

  it("hands a failure to every asker", async () => {
    const raw = vi.fn(() => Promise.reject(new Error("offline")));
    const f = sharingReads(raw, () => API, () => "ws1");
    await expect(Promise.all([f(`${API}/jobs`), f(`${API}/jobs`)])).rejects.toThrow("offline");
    expect(raw).toHaveBeenCalledTimes(1);
  });
});
