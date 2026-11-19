// @vitest-environment jsdom
/**
 * The dashboard's filters column put away and brought back (the user, 2026-11-19: "our Global filters need to be
 * collapsible", and later the peer product's model: one filter icon at the canvas's upper left, the panel open or put away
 * as the dashboard was published). Put away, ONE filter icon on a strip at the left stands for every column, says how many
 * filters still hold a choice, and takes none of the page's height; the columns stay mounted, because they also feed the
 * values the cards' queries read. Whether it opens is the dashboard's own; a reader's toggle lasts their visit.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, fireEvent, render, screen, within } from "@/lib/testing";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposedDashboard } from "@/components/dashboards/ComposedDashboard";
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
beforeEach(() => { window.localStorage.clear(); });

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
  it("is put away to one Global filters button under the pages, beside how many things cut it, stays mounted, and comes back", () => {
    render(<ComposedDashboard spec={withFilters()} cards={CARDS} host={HOST} focus={HELD} onFocus={vi.fn()} doors={{ onRefresh: vi.fn() }} />);
    expect(screen.getByTestId("global-filters")).toBeVisible();
    fireEvent.click(screen.getByTestId("global-filters-hide"));
    const shut = screen.getByTestId("global-filters-shut");
    expect(within(shut).getByRole("button", { name: "Show the global filters · 1 holding a choice" })).toHaveTextContent("Global filters");
    // beside it, how many things cut the dashboard — its menu
    expect(within(shut).getByTestId("filters-menu")).toHaveTextContent(/^1$/);
    // tight under the row of pages (the user, 2026-11-19, of a peer product's editor), above the cards, the cards at full width
    expect(shut.closest('[role="tablist"]')).toBeNull();
    expect(screen.getByRole("tablist").compareDocumentPosition(shut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shut.compareDocumentPosition(screen.getAllByTestId("dashboard-card")[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("dashboard-filters-folded").style.gridTemplateColumns).toBe("");
    expect(screen.getByTestId("global-filters")).not.toBeVisible();          // still mounted, out of sight
    expect(window.localStorage.length).toBe(0);                             // the reader's, for this visit: nothing kept in the browser
    act(() => { fireEvent.click(screen.getByTestId("global-filters-show")); });
    expect(screen.queryByTestId("global-filters-shut")).toBeNull();
    expect(screen.getByTestId("global-filters")).toBeVisible();
  });

  it("on a dashboard of one page, is at the top of its cards", () => {
    // one page: the root holds its filters and one section, and nothing else
    const spec = withFilters();
    const section = spec.elements["tab-overview"].children[0];
    const keep = new Set([spec.root, "global-filters", "f-type", section, ...spec.elements[section].children]);
    for (const key of Object.keys(spec.elements)) if (!keep.has(key)) delete spec.elements[key];
    spec.elements[spec.root].children = ["global-filters", section];
    delete spec.state;
    spec.elements[spec.root].props.filters_shut = true;
    render(<ComposedDashboard spec={spec} cards={CARDS} host={HOST} focus={HELD} onFocus={vi.fn()} doors={{ onRefresh: vi.fn() }} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getAllByTestId("global-filters-show")).toHaveLength(1);
  });

  it("opens as the dashboard was left: put away when it says so, and a reader may still open it", () => {
    const spec = withFilters();
    spec.elements[spec.root].props.filters_shut = true;
    render(<ComposedDashboard spec={spec} cards={CARDS} host={HOST} focus={HELD} onFocus={vi.fn()} doors={{ onRefresh: vi.fn() }} />);
    expect(screen.getByTestId("global-filters-shut")).toBeInTheDocument();
    act(() => { fireEvent.click(screen.getByTestId("global-filters-show")); });
    expect(screen.getByTestId("global-filters")).toBeVisible();
  });

  it("in the builder, keeps the panel open or put away on the dashboard, for its readers", () => {
    const onFiltersShut = vi.fn();
    render(<ComposedDashboard spec={withFilters()} cards={CARDS} host={HOST} focus={HELD} onFocus={vi.fn()} doors={{ onRefresh: vi.fn(), onFiltersShut }} />);
    fireEvent.click(screen.getByTestId("global-filters-hide"));
    expect(onFiltersShut).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("global-filters")).toBeVisible();             // the dashboard says what it is, once kept
  });

  it("is ONE button however many columns the dashboard draws (2026-11-19: three stacked Filters buttons)", () => {
    const spec = withFilters();
    spec.elements.qf = { type: "QueryFilters", props: { table: "orders", columns: [{ column: "channel", label: "Channel" }] }, children: [] };
    spec.elements[spec.root].children = ["qf", ...spec.elements[spec.root].children];                // a file's column leads
    spec.elements[spec.root].props.filters_shut = true;
    render(<ComposedDashboard spec={spec} cards={CARDS} host={HOST} focus={HELD} onFocus={vi.fn()} doors={{ onRefresh: vi.fn() }} />);
    expect(screen.getAllByTestId("global-filters-show")).toHaveLength(1);
    expect(screen.getByTestId("query-filters")).not.toBeVisible();
    expect(screen.getByTestId("global-filters")).not.toBeVisible();
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
  it("is put away the same way, to the one Global filters button, and comes back", () => {
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

  it("stands in from the page's edge as far as the Ask panel moved the page, so readers always see it (2026-11-19)", () => {
    render(<ComposedDashboard spec={withFilters()} cards={CARDS} host={HOST} focus={HELD} onFocus={vi.fn()} doors={{ onRefresh: vi.fn() }} />);
    const column = screen.getByTestId("dashboard-global-filter-column");
    expect(column.style.transform).toBe("translateX(var(--ask-pushed, 0px))");
    expect(column.style.zIndex).toBe("3");                                     // over the cards that pass under it
  });
});
