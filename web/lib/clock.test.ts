// @vitest-environment jsdom
/**
 * The person's clock rides every request to the API (2026-11-17: one definition of "yesterday" for the platform and
 * the coworker, `pramanyx/kernel/clock.py`). Never to a third party, and never over a header a caller set itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("installClockHeader", () => {
  let seen: Array<{ url: string; headers: Headers }> = [];
  beforeEach(() => {
    seen = [];
    vi.resetModules();
    window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response("{}");
    }) as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it("stamps the browser's zone on our API and on same-origin calls only", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: "Asia/Calcutta" } as Intl.ResolvedDateTimeFormatOptions);
    const { installClockHeader, CLOCK_HEADER } = await import("@/lib/clock");
    installClockHeader("http://localhost:8000");
    await window.fetch("http://localhost:8000/chat");
    await window.fetch("/api/thing");
    await window.fetch("https://elsewhere.example/x");
    await window.fetch("http://localhost:8000/x", { headers: { [CLOCK_HEADER]: "Europe/London" } });
    expect(seen[0].headers.get(CLOCK_HEADER)).toBe("Asia/Calcutta");
    expect(seen[1].headers.get(CLOCK_HEADER)).toBe("Asia/Calcutta");
    expect(seen[2].headers.get(CLOCK_HEADER)).toBeNull();               // a third party is told nothing
    expect(seen[3].headers.get(CLOCK_HEADER)).toBe("Europe/London");    // a caller's own choice wins
  });
});
