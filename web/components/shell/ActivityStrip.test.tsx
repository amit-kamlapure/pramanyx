// @vitest-environment jsdom
/**
 * The top bar's activity strip is read on every page, so it reads no more than it draws (2026-11-23): the agents' runs
 * alone, once at load — a connection arriving re-reads the explorer's phase, not a day of runs.
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render } from "@/lib/testing";

const api = vi.hoisted(() => ({
  getObsTimeseries: vi.fn(async () => ({ measured: true, window: { bucket_seconds: 3600 }, edges: [], group: "charter",
    measure: "runs", series: [], scanned: 0, attributed: 0, coverage: null, runners_read: false })),
  getJobs: vi.fn(async () => []),
  getExplorationStatus: vi.fn(async () => ({ phase: "complete" })),
}));
vi.mock("@/lib/api", async importOriginal => ({ ...(await importOriginal<typeof import("@/lib/api")>()), ...api }));
vi.mock("@/lib/events", () => ({ subscribeKernelEvents: vi.fn(() => () => {}) }));

const { ActivityStrip } = await import("./ActivityStrip");

afterEach(() => vi.clearAllMocks());

describe("the activity strip", () => {
  it("reads the agents' runs once, leaving the automation's unread, and the phase for the connection as it arrives", async () => {
    const { rerender } = render(<ActivityStrip connectionId="" />);
    await act(async () => {});
    rerender(<ActivityStrip connectionId="c1" />);
    await act(async () => {});
    expect(api.getObsTimeseries).toHaveBeenCalledTimes(1);
    expect(api.getObsTimeseries).toHaveBeenCalledWith({ source: "jobs", range: "24h", runners: false });
    expect(api.getJobs).toHaveBeenCalledTimes(1);
    expect(api.getExplorationStatus).toHaveBeenCalledTimes(1);
    expect(api.getExplorationStatus).toHaveBeenCalledWith("c1");
  });
});
