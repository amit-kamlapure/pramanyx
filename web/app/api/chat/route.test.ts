/**
 * `/api/chat` invariant tests — CI-1d.
 *
 * These stub the upstream rather than run a server, because the three
 * invariants are all about what happens when the upstream misbehaves — and a
 * healthy local backend is exactly the condition under which none of them fire.
 * Each case below is a bug someone already hit through this path.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

/** Read the handler's SSE body back into the chunk objects it encodes. */
async function chunksOf(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((r) => r.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim())
    .filter((d): d is string => Boolean(d) && d !== "[DONE]")
    .map((d) => JSON.parse(d) as Record<string, unknown>);
}

function sse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
    ...init,
  });
}

const ask = (question = "q") =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({ question, connection_id: "c1" }),
  });

afterEach(() => vi.unstubAllGlobals());

describe("invariant 1 — anything that is not a live SSE body becomes an error chunk", () => {
  it("surfaces an HTML error page instead of spinning forever", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response("<html>502 Bad Gateway</html>", {
        status: 502, headers: { "content-type": "text/html" },
      }));
    const chunks = await chunksOf(await POST(ask()));
    const err = chunks.find((c) => c.type === "error");
    expect(err).toBeDefined();
    expect(String(err?.errorText)).toContain("502");
    // and the message is still well-formed
    expect(chunks.at(-1)?.type).toBe("finish");
  });

  it("carries the demo backend's refusal text verbatim — it is a PRODUCT surface", async () => {
    const refusal = "This demo shows completed analyses. To ask new questions, connect your own backend.";
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ detail: refusal, demo: true }), {
        status: 501, headers: { "content-type": "application/json" },
      }));
    const chunks = await chunksOf(await POST(ask()));
    const err = chunks.find((c) => c.type === "error");
    // Burying this under "Request failed (HTTP 501)" hides the one instruction
    // the reader needs.
    expect(String(err?.errorText)).toContain("connect your own backend");
  });

  it("reports an unreachable backend rather than throwing", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("ECONNREFUSED"); });
    const chunks = await chunksOf(await POST(ask()));
    expect(String(chunks.find((c) => c.type === "error")?.errorText)).toContain("ECONNREFUSED");
  });

  it("treats a 200 that is not an event-stream as an error", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    expect(await chunksOf(await POST(ask())).then((c) => c.some((x) => x.type === "error")))
      .toBe(true);
  });
});

describe("the happy path", () => {
  it("translates frames into a well-formed chunk stream", async () => {
    vi.stubGlobal("fetch", async () => sse(
      // Real wire format: bare `data:` records, frame name inside the payload.
      'data: {"type":"start","investigation_id":"i1"}\n\n'
      + 'data: {"type":"narrative_delta","narrative":"Rev"}\n\n'
      + 'data: {"type":"narrative_delta","narrative":"Revenue rose"}\n\n'
      + 'data: {"type":"done"}\n\n'));
    const chunks = await chunksOf(await POST(ask()));
    const kinds = chunks.map((c) => c.type);
    expect(kinds[0]).toBe("start");
    expect(kinds).toContain("text-start");
    expect(kinds.at(-1)).toBe("finish");

    // replace→append held across the proxy, not just in the unit test
    const text = chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("");
    expect(text).toBe("Revenue rose");
  });

  it("emits nothing after a terminal frame", async () => {
    vi.stubGlobal("fetch", async () => sse(
      'data: {"type":"done"}\n\n'
      + 'data: {"type":"narrative_delta","narrative":"late"}\n\n'));
    const chunks = await chunksOf(await POST(ask()));
    expect(chunks.filter((c) => c.type === "text-delta")).toHaveLength(0);
  });
});

describe("a dropped upstream is not silence", () => {
  it("closes an unterminated message with an abort", async () => {
    // No `done` — the connection died mid-answer.
    vi.stubGlobal("fetch", async () => sse(
      'data: {"type":"narrative_delta","narrative":"half a sent"}\n\n'));
    const chunks = await chunksOf(await POST(ask()));
    const kinds = chunks.map((c) => c.type);
    // Leaving the text block open makes the SDK throw UIMessageStreamError.
    expect(kinds).toContain("text-end");
    expect(kinds).toContain("abort");
  });
});

describe("a dropped deep run is read until it lands, and says why it ended", () => {
  it("reads a hand-back on as the run it names, and gives that run's own reason", async () => {
    // 2026-11-24: the recovery said a bare "failed after the connection dropped", never the reason the row recorded,
    // and polled an interrupted or handed-back run to its deadline.
    const realTimeout = globalThis.setTimeout;
    // the recovery waits 4 s between reads: here each wait is a tick
    vi.stubGlobal("setTimeout", ((fn: () => void) => realTimeout(fn, 0)) as unknown as typeof setTimeout);
    const read: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/ask")) return sse('data: {"type":"start","investigation_id":"again"}\n\n');
      read.push(path);
      const rows: Record<string, unknown> = {
        "/investigations/again": { id: "again", status: "handed_back", handed_to: "r2" },
        "/investigations/r2": { id: "r2", status: "failed", error: "Stopped at the Analyst's 1800s time budget." },
      };
      return new Response(JSON.stringify(rows[path.replace(/^.*(\/investigations\/)/, "$1")] ?? {}),
                          { headers: { "content-type": "application/json" } });
    });
    try {
      const chunks = await chunksOf(await POST(ask()));
      expect(read.map((p) => p.split("/").pop())).toEqual(["again", "r2"]);
      const errors = chunks.filter((c) => c.type === "error" || c.type === "data-error").map((c) => JSON.stringify(c));
      expect(errors.join(" ")).toContain("Stopped at the Analyst's 1800s time budget.");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the question comes from `messages`, not `question`", () => {
  /**
   * The defect these exist for: the SDK posts `messages` and NEVER a `question`
   * field, so reading `body.question` sent the backend an empty string on every
   * browser-driven turn. The backend does not treat that as an error — it
   * answered from whatever context it had, and the UI showed a fluent,
   * confident answer to a question nobody asked.
   *
   * Every test in this file previously posted `question`, which is the one shape
   * the real client never uses. A suite that only exercises the caller you wrote
   * cannot catch the caller you shipped.
   */
  function sdkPost(messages: unknown) {
    return new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages, connection_id: "c1", session_id: "s1" }),
    });
  }

  /** Capture what the route forwarded upstream. */
  function captureUpstream() {
    const seen: { body?: Record<string, unknown> } = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return sse('data: {"type":"done"}\n\n');
    });
    return seen;
  }

  it("takes the newest user message's text", async () => {
    const seen = captureUpstream();
    await POST(sdkPost([
      { id: "1", role: "user", parts: [{ type: "text", text: "first question" }] },
      { id: "2", role: "assistant", parts: [{ type: "text", text: "an answer" }] },
      { id: "3", role: "user", parts: [{ type: "text", text: "the real question" }] },
    ]));
    expect(seen.body?.question).toBe("the real question");
  });

  it("never forwards an empty question when a message exists", async () => {
    const seen = captureUpstream();
    await POST(sdkPost([{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }]));
    expect(seen.body?.question).not.toBe("");
  });

  it("joins multiple text parts of one message", async () => {
    const seen = captureUpstream();
    await POST(sdkPost([
      { id: "1", role: "user", parts: [{ type: "text", text: "part one " },
                                       { type: "text", text: "part two" }] },
    ]));
    expect(seen.body?.question).toBe("part one part two");
  });

  it("ignores non-text parts", async () => {
    const seen = captureUpstream();
    await POST(sdkPost([
      { id: "1", role: "user", parts: [{ type: "data-thing", text: "nope" },
                                       { type: "text", text: "yes" }] },
    ]));
    expect(seen.body?.question).toBe("yes");
  });

  it("still honours an explicit `question` — direct callers keep working", async () => {
    const seen = captureUpstream();
    await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ question: "direct", connection_id: "c1" }),
    }));
    expect(seen.body?.question).toBe("direct");
  });

  it("forwards connection and session so the backend can rebuild the thread", async () => {
    const seen = captureUpstream();
    await POST(sdkPost([{ id: "1", role: "user", parts: [{ type: "text", text: "q" }] }]));
    expect(seen.body?.connection_id).toBe("c1");
    expect(seen.body?.session_id).toBe("s1");
  });
});

describe("an Ask this briefing turn carries what it was asked from", () => {
  /** The Briefing's panel sends its schema, `surface: "briefing"` and the open period's key.
   *  The backend keeps the conversation to that schema and reads that period's Briefing, so
   *  all three must reach `/ask` (2026-10-06: an answer on uber_ncr came from two other
   *  datasets on the same connection). */
  it("forwards schema, surface and brief_period to the unified door", async () => {
    const seen: { url?: string; body?: Record<string, unknown> } = {};
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.url = String(url);
      seen.body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return sse('data: {"type":"done"}\n\n');
    });
    await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Which city leads?" }] }],
        connection_id: "workspace", session_id: "s1", depth: "quick", schema: "uber_ncr",
        surface: "briefing", brief_period: "range:last_month:2026-08-01..2026-08-31",
      }),
    }));
    expect(seen.url).toMatch(/\/ask$/);
    expect(seen.body?.schema).toBe("uber_ncr");
    expect(seen.body?.surface).toBe("briefing");
    expect(seen.body?.brief_period).toBe("range:last_month:2026-08-01..2026-08-31");
  });
});

describe("Keep going carries what the stopped turn already did", () => {
  /** A turn that ran out of steps offers Keep going; the panel sends the same question with the
   *  steps it took (refusals marked), so the next turn picks up rather than starting over
   *  (2026-11-20, the Operations chart asked for "YYYY-MM" seven times). */
  it("forwards keep_going to the unified door, and nothing when there is none", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return sse('data: {"type":"done"}\n\n');
    });
    const ask = (extra: Record<string, unknown>) => POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Write the months as YYYY-MM" }] }],
        connection_id: "sheets", session_id: "s1", ...extra,
      }),
    }));
    await ask({ keep_going: "1. change_chart — said no: “monthFormat” is not something the chart editor sets." });
    await ask({});
    expect(bodies[0].keep_going).toBe("1. change_chart — said no: “monthFormat” is not something the chart editor sets.");
    expect(bodies[1]).not.toHaveProperty("keep_going");
  });
});

describe("Answer anyway carries the clarification left unanswered", () => {
  /** The Area map plan's gap (2026-11-26): what was asked and the readings offered reach the door, so the receipt of
   *  the answer that went ahead keeps them. */
  it("forwards clarify_asked and clarify_options", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return sse('data: {"type":"done"}\n\n');
    });
    await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "revenue last month" }] }],
        connection_id: "c1", skip_clarify: true, clarify_asked: "Which revenue do you mean?",
        clarify_options: ["booked", "net of returns"], clarify_source: "rival_meanings",
      }),
    }));
    expect([body.skip_clarify, body.clarify_asked, body.clarify_options, body.clarify_source])
      .toEqual([true, "Which revenue do you mean?", ["booked", "net of returns"], "rival_meanings"]);
  });
});

describe("every send goes through the one door", () => {
  /** 2026-11-27: a send carrying a seed, a finding or a cache skip went to `/investigate` (the older graph engine) and a
   *  forced Quick with extras to `/chat` (the bare core, no router) — the same question took a different engine by the
   *  button that sent it. Every send posts `/ask`, carrying what it carries; the button chooses only the depth. */
  it("posts a seeded Agent send to /ask at deep depth with its seed, and a Quick send at quick", async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return sse('data: {"type":"done"}\n\n');
    });
    const send = (extra: Record<string, unknown>) => POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Explore this fact" }] }],
        connection_id: "c1", session_id: "s1", ...extra,
      }),
    }));
    await send({ mode: "investigate", seed_sql: "SELECT 1", seed_context: "a fact", skip_cache: true, insight_id: "f1" });
    await send({ mode: "ask", skip_cache: true });
    expect(seen.map(s => s.url.replace(/^.*(\/[a-z]+)$/, "$1"))).toEqual(["/ask", "/ask"]);
    expect([seen[0].body.depth, seen[0].body.seed_sql, seen[0].body.seed_context, seen[0].body.skip_cache, seen[0].body.insight_id])
      .toEqual(["deep", "SELECT 1", "a fact", true, "f1"]);
    expect([seen[1].body.depth, seen[1].body.skip_cache]).toEqual(["quick", true]);
  });
});
