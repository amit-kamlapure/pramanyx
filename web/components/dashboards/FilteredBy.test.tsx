// @vitest-environment jsdom

/**
 * The study's R14, R15, R17 and R18: everything a dashboard is cut by in one bar, a card its author set apart from the filters,
 * a way to another page with the chosen value still on, and the builder's pages (dashboard format v18).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen, waitFor, within } from "@/lib/testing";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposedDashboard, type PageDoors } from "@/components/dashboards/ComposedDashboard";
import type { CardState } from "@/components/brief/PinnedCardBody";
import type { StoredCard } from "@/lib/api";
import { addPage, duplicatePage, removePage, setProps, tabsOf, type DashboardSpec } from "@/lib/dashboards/edit";
import { notFiltered, type DashboardFocus } from "@/lib/dashboards/focus";
import type { DashboardHostState } from "@/lib/dashboards/hostState";
import { checkDashboardSpec, openingTab } from "@/lib/dashboards/rules";

const runCard = vi.fn();
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()), graduateCard: vi.fn(), updateCard: vi.fn(),
  runCard: (...a: unknown[]) => runCard(...a),
}));

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => runCard.mockReset());

const premise = (): DashboardSpec => JSON.parse(readFileSync(resolve(process.cwd(), "lib/dashboards/premise.fixture.json"), "utf8"));
const SEARCH: DashboardFocus = { table: "users", column: "traffic_source", value: "Search", source: { card: "c7f3a001", field: "channel" } };
const HOST: DashboardHostState = { range: { status: "final" }, cards: { c7f3a001: { status: "within" }, c91b2002: { status: "within" } } };
function card(id: string, title: string): CardState {
  const refresh = { cadence: "daily", last_run: "2026-09-28T06:00:00Z", last_value: 1, prev_value: null, history: [1] };
  const c: StoredCard = {
    id, connection_id: "thelook", scope: "canvas", scope_ref: "cv", source: "authored", kind: "kpi", title, sql: "SELECT 1", query_ref: null,
    render: {}, refresh, thresholds: {}, provenance: {} as StoredCard["provenance"], links: [], body: "", author: "", created_at: "", updated_at: "",
  };
  return { card: c, run: { columns: ["v"], rows: [[1]], row_count: 1, caveats: [], error: null, refresh } };
}
const CARDS = [card("c7f3a001", "Return rate"), card("c91b2002", "Net revenue")];
const tabKey = (s: DashboardSpec, label: string) => tabsOf(s).find(t => t.label === label)?.key as string;
const doorsOf = (): PageDoors => ({ add: vi.fn(() => "page-3"), rename: vi.fn(), duplicate: vi.fn(() => "overview-copy"), remove: vi.fn(), hide: vi.fn() });

describe("the one bar", () => {
  it("is not drawn while nothing cuts the dashboard", () => {
    render(<ComposedDashboard spec={premise()} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn() }} focus={[]} onFocus={vi.fn()} />);
    expect(screen.queryByTestId("dashboard-filtered-by")).toBeNull();
  });

  it("offers the other pages while a value is chosen, and opens one with the value still on", () => {
    const onFocus = vi.fn();
    render(<ComposedDashboard spec={premise()} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn() }} focus={[SEARCH]} onFocus={onFocus} />);
    const open = screen.getByRole("button", { name: "Open on Watches" });
    fireEvent.click(open);
    expect(screen.getByRole("tab", { name: "Watches" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Open on Overview" })).toBeTruthy();
    expect(onFocus).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("focus-chip")).toHaveLength(1);
  });

  it("offers no page a reader may not open", () => {
    const spec = setProps(premise(), tabKey(premise(), "Watches"), { hidden: true });
    render(<ComposedDashboard spec={spec} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn() }} focus={[SEARCH]} onFocus={vi.fn()} />);
    expect(screen.queryByTestId("focus-open-page")).toBeNull();
  });
});

describe("a card set apart from the filters", () => {
  const apart = (): DashboardSpec => {
    const s = premise();
    for (const [k, el] of Object.entries(s.elements)) if (el.type === "Card" && el.props.card === "c91b2002") s.elements[k].props.not_filtered = true;
    return s;
  };

  it("is known by its placement", () => {
    expect(notFiltered(apart(), "c91b2002")).toBe(true);
    expect(notFiltered(apart(), "c7f3a001")).toBe(false);
  });

  it("says so while a filter is on, and says nothing while none is", () => {
    const { rerender } = render(<ComposedDashboard spec={apart()} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn() }} focus={[SEARCH]} onFocus={vi.fn()} />);
    const said = screen.getAllByTestId("not-filtered");
    expect(said.length).toBeGreaterThan(0);
    expect(said[0]).toHaveAttribute("title", "Its author set this card not to be cut by the dashboard's filters.");
    rerender(<ComposedDashboard spec={apart()} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn() }} focus={[]} onFocus={vi.fn()} />);
    expect(screen.queryByTestId("not-filtered")).toBeNull();
  });
});

describe("a dashboard's pages", () => {
  it("adds a page the rules accept, gathering a dashboard without tabs into a first one", () => {
    const made = addPage(premise());
    expect(checkDashboardSpec(made.spec).issues).toEqual([]);
    expect(tabsOf(made.spec).map(t => t.label)).toEqual(["Overview", "Watches", "Page 3"]);
    expect(made.name).toBe("page-3");
  });

  it("copies a page with what it holds, under a name of its own, right after it", () => {
    const s = premise();
    const made = duplicatePage(s, tabKey(s, "Overview"));
    expect(checkDashboardSpec(made.spec).issues).toEqual([]);
    expect(tabsOf(made.spec).map(t => t.label)).toEqual(["Overview", "Overview copy", "Watches"]);
    expect(made.name).toBe("overview-copy");
  });

  it("takes a page off with what it holds, and keeps the last one", () => {
    const s = premise();
    const one = removePage(s, tabKey(s, "Watches"));
    expect(checkDashboardSpec(one).issues).toEqual([]);
    expect(one.elements["sec-limits"]).toBeUndefined();
    expect(tabsOf(removePage(one, tabKey(one, "Overview"))).map(t => t.label)).toEqual(["Overview"]);
  });

  it("never opens on a page kept from readers, and refuses a dashboard that keeps every page from them", () => {
    const s = premise();
    const hidden = setProps(s, tabKey(s, "Overview"), { hidden: true });
    expect(openingTab(hidden)).toBe("watches");
    const both = setProps(hidden, tabKey(hidden, "Watches"), { hidden: true });
    expect(checkDashboardSpec(both).issues.map(i => i.message)).toContain("Every page of this dashboard is hidden from its readers. Keep one for them to open.");
  });

  it("refuses to hide a page that holds what a page readers keep needs", () => {
    const s = premise();
    s.elements["orders-table"] = { type: "ObjectTable", props: { entity: "order", size: "wide" }, children: [] };
    s.elements["sec-limits"].children.push("orders-table");
    s.elements["order-detail"] = { type: "ObjectDetail", props: { follows: "orders-table" }, children: [] };
    s.elements["sec-headline"].children.push("order-detail");
    expect(checkDashboardSpec(s).issues).toEqual([]);
    const said = checkDashboardSpec(setProps(s, tabKey(s, "Watches"), { hidden: true })).issues.map(i => i.message);
    expect(said.some(m => m.startsWith("A page hidden from readers holds what another page needs."))).toBe(true);
    // the page that only reads may be hidden: nothing readers keep needs it
    expect(checkDashboardSpec(setProps(s, tabKey(s, "Overview"), { hidden: true })).issues).toEqual([]);
  });

  it("shows a reader only the pages meant for them; the builder shows all and adds, renames and hides", async () => {
    const s = premise();
    const spec = setProps(s, tabKey(s, "Watches"), { hidden: true });
    const { unmount } = render(<ComposedDashboard spec={spec} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn() }} />);
    expect(screen.queryByRole("tab", { name: "Watches" })).toBeNull();
    expect(screen.queryByTestId("dashboard-add-page")).toBeNull();
    unmount();

    const pages = doorsOf();
    render(<ComposedDashboard spec={spec} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn(), onSelect: vi.fn(), pages }} />);
    expect(screen.getByRole("tab", { name: "Watches" })).toHaveAttribute("data-hidden-page", "true");
    fireEvent.click(screen.getByTestId("dashboard-add-page"));
    expect(pages.add).toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByRole("tab", { name: "Overview" }));
    const box = screen.getByTestId("dashboard-page-name");
    fireEvent.change(box, { target: { value: "Summary" } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.blur(box);
    expect(pages.rename).toHaveBeenCalledWith(tabKey(spec, "Overview"), "Summary");

    fireEvent.keyDown(screen.getByTestId("dashboard-page-menu"), { key: "Enter" });
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: "Duplicate page" })).toBeTruthy());
    // the only page a reader can open cannot be hidden too
    expect(within(menu).getByRole("menuitem", { name: "Hide from readers" })).toHaveAttribute("aria-disabled", "true");
  });
});
