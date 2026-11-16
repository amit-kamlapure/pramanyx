// @vitest-environment jsdom

/**
 * A piece moves by its header in the builder (the board study, 2026-11-16): a grip at rest, Alt+Shift+arrows from the
 * keyboard, and the section's grid packs densely so a moved piece leaves no hole. A reader's dashboard offers none of
 * it. (jsdom has no geometry, so the drag's landing is the browser's to show; the door it reaches is tested here.)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen } from "@/lib/testing";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ComposedDashboard, type DashboardDoors } from "@/components/dashboards/ComposedDashboard";
import type { CardState } from "@/components/brief/PinnedCardBody";
import type { StoredCard } from "@/lib/api";
import type { DashboardHostState } from "@/lib/dashboards/hostState";

vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), graduateCard: vi.fn(), updateCard: vi.fn() }));

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const premise = () => JSON.parse(readFileSync(resolve(process.cwd(), "lib/dashboards/premise.fixture.json"), "utf8"));
function card(id: string, title: string, value: number): CardState {
  const refresh = { cadence: "daily", last_run: "2026-09-28T06:00:00Z", last_value: value, prev_value: null, history: [value] };
  const c: StoredCard = {
    id, connection_id: "thelook", scope: "canvas", scope_ref: "cv", source: "authored", kind: "kpi", title, sql: "SELECT 1",
    query_ref: null, render: {}, refresh, thresholds: {}, provenance: {} as StoredCard["provenance"], links: [], body: "", author: "",
    created_at: "", updated_at: "",
  };
  return { card: c, run: { columns: ["v"], rows: [[value]], row_count: 1, caveats: [], error: null, refresh } };
}
const CARDS = [card("c7f3a001", "Return rate", 0.1003), card("c91b2002", "Net merchandise revenue", 341000)];
const HOST: DashboardHostState = { range: { status: "final" }, cards: { c7f3a001: { status: "within" }, c91b2002: { status: "within" } } };
const cellOf = (key: string) => document.querySelector(`[data-element="${key}"]`) as HTMLElement;

describe("moving a piece", () => {
  it("in the builder: a grip on every piece, and Alt+Shift+arrows move it one place", () => {
    const onMove = vi.fn();
    const doors: DashboardDoors = { onRefresh: vi.fn(), onMove };
    render(<ComposedDashboard spec={premise()} cards={CARDS} host={HOST} doors={doors} />);
    expect(screen.getAllByTestId("move-grip").length).toBeGreaterThanOrEqual(2);
    fireEvent.keyDown(cellOf("card-rate"), { key: "ArrowRight", altKey: true, shiftKey: true });
    expect(onMove).toHaveBeenLastCalledWith("card-rate", "card-net", "after");
    fireEvent.keyDown(cellOf("card-net"), { key: "ArrowUp", altKey: true, shiftKey: true });
    expect(onMove).toHaveBeenLastCalledWith("card-net", "card-rate", "before");
    // the last piece has nowhere later to go
    onMove.mockClear();
    fireEvent.keyDown(cellOf("card-net"), { key: "ArrowRight", altKey: true, shiftKey: true });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("for a reader: no grip, and the keys move nothing", () => {
    render(<ComposedDashboard spec={premise()} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn() }} />);
    expect(screen.queryByTestId("move-grip")).toBeNull();
    expect(cellOf("card-rate").getAttribute("tabindex")).toBeNull();
  });

  it("packs a section densely, so a hole fills itself", () => {
    render(<ComposedDashboard spec={premise()} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn() }} />);
    const grid = cellOf("card-rate").parentElement as HTMLElement;
    expect(grid.style.gridAutoFlow).toBe("row dense");
  });
});
