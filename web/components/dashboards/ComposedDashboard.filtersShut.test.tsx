// @vitest-environment jsdom
/**
 * The dashboard's filters column put away and brought back (the user, 2026-11-19: "our Global filters need to be
 * collapsible"; "it should sit on top of the dashboard components"). Put away, a button above the cards says how many filters
 * still hold a choice, and the cards take the column's width; the column stays
 * mounted, because it also feeds the values the cards' queries read. The choice is the reader's, kept in their browser.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, fireEvent, render, screen } from "@/lib/testing";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposedDashboard } from "@/components/dashboards/ComposedDashboard";
import { resetFiltersShut } from "@/components/dashboards/GlobalFilters";
import type { CardState } from "@/components/brief/PinnedCardBody";
import type { StoredCard } from "@/lib/api";
import type { DashboardFocus } from "@/lib/dashboards/focus";

const dashboardFilterValues = vi.hoisted(() => vi.fn(async () => ({ values: [{ value: "Movie", n: 6131 }], more: false })));
const previewDashboardQuery = vi.hoisted(() => vi.fn(async () => ({ refused: [], rows: [["Search", 4], ["Email", 3]] })));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), dashboardFilterValues, previewDashboardQuery }));
vi.mock("@/components/dashboards/DashboardTile", async (original) => ({
  ...(await original<typeof import("@/components/dashboards/DashboardTile")>()),
  DashboardTile: ({ cs }: { cs: CardState }) => <div>{cs.card.title}</div>,
}));

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => { window.localStorage.clear(); resetFiltersShut(); });

function withFilters() {
  const spec = JSON.parse(readFileSync(resolve(process.cwd(), "lib/dashboards/premise.fixture.json"), "utf8"));
  spec.elements["global-filters"] = { type: "GlobalFilters", props: {}, children: ["f-type"] };
  spec.elements["f-type"] = { type: "GlobalFilter", props: { title: "Type", kind: "multi", table: "titles", column: "type" }, children: [] };
  spec.elements[spec.root].children = ["global-filters", ...spec.elements[spec.root].children];
  return spec;
}
const CARDS: CardState[] = [{ card: { id: "c7f3a001", title: "Return rate" } as StoredCard }, { card: { id: "c91b2002", title: "Net merchandise revenue" } as StoredCard }];
const HOST = { range: { status: "final" as const }, cards: { c7f3a001: { status: "within" as const }, c91b2002: { status: "within" as const } } };
const HELD: DashboardFocus[] = [{ table: "titles", column: "type", value: "", op: "in", values: ["Movie"], source: { card: "filter:f-type", field: "type" } }];

describe("the dashboard's filters column", () => {
  it("is put away to a strip that says how many filters hold a choice, stays mounted, and comes back", () => {
    render(<ComposedDashboard spec={withFilters()} cards={CARDS} host={HOST} focus={HELD} onFocus={vi.fn()} doors={{ onRefresh: vi.fn() }} />);
    expect(screen.getByTestId("global-filters")).toBeVisible();
    fireEvent.click(screen.getByTestId("global-filters-hide"));
    expect(screen.getByTestId("global-filters-held")).toHaveTextContent("1");
    // above the cards, not beside them: the button and the dashboard stand in one column, each the full width
    const shut = screen.getByTestId("global-filters-shut");
    expect(shut.parentElement?.style.flexDirection).toBe("column");
    expect(shut.parentElement?.style.gridTemplateColumns).toBe("");
    expect(shut.compareDocumentPosition(screen.getByTestId("dashboard")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("global-filters")).not.toBeVisible();          // still mounted, out of sight
    expect(window.localStorage.getItem("pramanyx:dashboard-filters-shut")).toBe("1");
    act(() => { fireEvent.click(screen.getByTestId("global-filters-show")); });
    expect(screen.queryByTestId("global-filters-shut")).toBeNull();
    expect(screen.getByTestId("global-filters")).toBeVisible();
  });
});

describe("a card whose own window gave way to the dates chosen (2026-11-19)", () => {
  it("says so on the card: its figure no longer covers what its query says", () => {
    const own = "Its own window, reckoned from today, gave way to the days chosen.";
    const ran = CARDS.map(c => ({ ...c, run: { columns: ["n"], rows: [["1"]], row_count: 1, caveats: [], error: null, value: 1,
      refresh: null, cut: { applied: true, by: ["created_at 2024-03-01 to 2024-03-31"], why: "", own_window: own } } })) as unknown as CardState[];
    render(<ComposedDashboard spec={withFilters()} cards={ran} host={HOST} focus={HELD} onFocus={vi.fn()} doors={{ onRefresh: vi.fn() }} />);
    const marks = screen.getAllByTestId("cut-through");
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0]).toHaveAttribute("data-own-window");
    expect(marks[0]).toHaveAttribute("aria-label", own);
  });
});

describe("the filter column of a dashboard made from a file", () => {
  it("is put away the same way, to a button above the cards, and comes back", () => {
    const spec = JSON.parse(readFileSync(resolve(process.cwd(), "lib/dashboards/premise.fixture.json"), "utf8"));
    spec.elements.qf = { type: "QueryFilters", props: { table: "orders", columns: [{ column: "channel", label: "Channel" }] }, children: [] };
    spec.elements[spec.root].children = ["qf", ...spec.elements[spec.root].children];
    render(<ComposedDashboard spec={spec} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn() }} />);
    expect(screen.getByTestId("query-filters")).toBeVisible();
    fireEvent.click(screen.getByTestId("global-filters-hide"));
    expect(screen.getByTestId("global-filters-shut")).toBeInTheDocument();
    expect(screen.getByTestId("query-filters")).not.toBeVisible();          // still mounted: it holds what was chosen
    act(() => { fireEvent.click(screen.getByTestId("global-filters-show")); });
    expect(screen.getByTestId("query-filters")).toBeVisible();
  });
});

