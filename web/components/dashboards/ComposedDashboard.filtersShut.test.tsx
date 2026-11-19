// @vitest-environment jsdom
/**
 * The dashboard's filters column put away and brought back (the user, 2026-11-19: "our Global filters need to be
 * collapsible"). Put away, a thin strip stands in its place saying how many filters still hold a choice; the column stays
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
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), dashboardFilterValues }));
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
    expect(screen.getByTestId("global-filters")).not.toBeVisible();          // still mounted, out of sight
    expect(window.localStorage.getItem("pramanyx:dashboard-filters-shut")).toBe("1");
    act(() => { fireEvent.click(screen.getByTestId("global-filters-show")); });
    expect(screen.queryByTestId("global-filters-shut")).toBeNull();
    expect(screen.getByTestId("global-filters")).toBeVisible();
  });
});
