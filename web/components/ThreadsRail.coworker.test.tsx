// @vitest-environment jsdom
/**
 * One record for both places (2026-11-20, the user: "One record for all"): the platform files each coworker turn in its
 * conversation store under `coworker:<session>`, so a conversation held in the coworker app is listed here beside the
 * app's own, and says where it was held.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThreadsRail } from "@/components/ThreadsRail";
import { inTheCoworker } from "@/lib/askPanel";

afterEach(() => vi.unstubAllGlobals());

describe("conversations held in the coworker", () => {
  it("are known by their id", () => {
    expect(inTheCoworker("coworker:session-77aa11bb")).toBe(true);
    expect(inTheCoworker("siao31vmhenb1eca3amgc")).toBe(false);
  });

  it("are listed beside the app's own, saying they were held in the coworker", async () => {
    const rows = [
      { session_id: "coworker:session-77aa11bb", title: "How many orders were delivered?", turns: 1, last_at: new Date().toISOString() },
      { session_id: "siao31vmhenb1eca3amgc", title: "Give the line a neon glow", turns: 2, last_at: new Date().toISOString() },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })));
    render(<ThreadsRail connectionId="sheets" activeSessionId={null} onSelect={vi.fn()} onNew={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByText("How many orders were delivered?")).toBeInTheDocument();
    expect(screen.getAllByTestId("thread-coworker")).toHaveLength(1);
  });
});
