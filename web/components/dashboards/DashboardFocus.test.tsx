// @vitest-environment jsdom

/**
 * A dashboard's focus (the board study, 2026-11-16): a click on a mark is traced and chosen for the whole dashboard; a
 * card is asked with every chosen value but its own; the bar says what the dashboard is filtered by, and a card the focus
 * could not cut says why in its own place.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen } from "@/lib/testing";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ComposedDashboard } from "@/components/dashboards/ComposedDashboard";
import type { CardState } from "@/components/brief/PinnedCardBody";
import type { StoredCard } from "@/lib/api";
import type { DashboardHostState } from "@/lib/dashboards/hostState";
import { MAX_FOCUS, chooseIn, chosenOn, focusFor, traceAndChoose, type DashboardFocus } from "@/lib/dashboards/focus";

const traceField = vi.fn();
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()), graduateCard: vi.fn(), updateCard: vi.fn(),
  traceField: (...a: unknown[]) => traceField(...a),
}));

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const SEARCH: DashboardFocus = { table: "users", column: "traffic_source", value: "Search", source: { card: "c1", field: "channel" } };
const JEANS: DashboardFocus = { table: "products", column: "category", value: "Jeans", source: { card: "c2", field: "category" } };

describe("choosing a value", () => {
  it("adds a column, replaces its other value, and takes it off when chosen again", () => {
    const one = chooseIn([], SEARCH);
    expect(one).toEqual([SEARCH]);
    const two = chooseIn(one, JEANS);
    expect(two).toEqual([SEARCH, JEANS]);
    const email = { ...SEARCH, value: "Email" };
    expect(chooseIn(two, email)).toEqual([email, JEANS]);
    expect(chooseIn(two, SEARCH)).toEqual([JEANS]);
  });

  it("holds no more than the server takes", () => {
    let f: DashboardFocus[] = [];
    for (let i = 0; i < MAX_FOCUS + 2; i++) f = chooseIn(f, { ...SEARCH, column: `c${i}` });
    expect(f).toHaveLength(MAX_FOCUS);
  });

  it("asks a card with every value but those chosen on itself, which it lights instead", () => {
    expect(focusFor([SEARCH, JEANS], "c1")).toEqual([{ table: "products", column: "category", value: "Jeans" }]);
    expect(chosenOn([SEARCH, JEANS], "c1", "channel")).toEqual(["Search"]);
    expect(chosenOn([SEARCH, JEANS], "c1", "category")).toBeNull();
  });
});

const premise = () => JSON.parse(readFileSync(resolve(process.cwd(), "lib/dashboards/premise.fixture.json"), "utf8"));
function card(id: string, title: string, value: number, cut?: { applied: boolean; by: string[]; why: string; through?: string[] }): CardState {
  const refresh = { cadence: "daily", last_run: "2026-09-28T06:00:00Z", last_value: value, prev_value: null, history: [value] };
  const c: StoredCard = {
    id, connection_id: "thelook", scope: "canvas", scope_ref: "cv", source: "authored", kind: "kpi", title, sql: "SELECT 1",
    query_ref: null, render: {}, refresh, thresholds: {}, provenance: {} as StoredCard["provenance"], links: [], body: "", author: "",
    created_at: "", updated_at: "",
  };
  return { card: c, run: { columns: ["v"], rows: [[value]], row_count: 1, caveats: [], error: null, refresh, ...(cut ? { cut } : {}) } };
}
const HOST: DashboardHostState = { range: { status: "final" }, cards: { c7f3a001: { status: "within" }, c91b2002: { status: "within" } } };

describe("the dashboard with a focus", () => {
  it("says what it is filtered by; a chip takes one off, Clear takes them all", () => {
    const onFocus = vi.fn();
    const cards = [card("c7f3a001", "Return rate", 0.1), card("c91b2002", "Net revenue", 341000)];
    render(<ComposedDashboard spec={premise()} cards={cards} host={HOST} doors={{ onRefresh: vi.fn() }} focus={[SEARCH, JEANS]} onFocus={onFocus} />);
    expect(screen.getByTestId("dashboard-filtered-by")).toHaveTextContent("Filtered by");
    const chips = screen.getAllByTestId("focus-chip");
    expect(chips.map(c => c.textContent?.trim())).toEqual(["traffic source = Search", "category = Jeans"]);
    fireEvent.click(chips[0]);
    expect(onFocus).toHaveBeenLastCalledWith([JEANS]);
    fireEvent.click(screen.getByTestId("filters-clear"));
    expect(onFocus).toHaveBeenLastCalledWith([]);
  });

  it("marks a card the focus could not cut, with the server's own reason", () => {
    const why = "Not cut by traffic_source = Search: it reads no users.";
    const cards = [card("c7f3a001", "Return rate", 0.1, { applied: false, by: [], why }), card("c91b2002", "Net revenue", 341000, { applied: true, by: ["traffic_source = Search"], why: "" })];
    render(<ComposedDashboard spec={premise()} cards={cards} host={HOST} doors={{ onRefresh: vi.fn() }} focus={[SEARCH]} onFocus={vi.fn()} />);
    const marks = screen.getAllByTestId("not-filtered");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveAttribute("title", why);
  });

  it("names the column a card was cut through when the value reached it by a link", () => {
    const by = "traffic_source = Search, through order_items.user_id";
    const cards = [card("c7f3a001", "Return rate", 0.1, { applied: true, by: ["traffic_source = Search"], why: "", through: [by] }), card("c91b2002", "Net revenue", 341000)];
    render(<ComposedDashboard spec={premise()} cards={cards} host={HOST} doors={{ onRefresh: vi.fn() }} focus={[SEARCH]} onFocus={vi.fn()} />);
    const said = screen.getAllByTestId("cut-through")[0];
    expect(said).toHaveAttribute("aria-label", "Through order_items.user_id");
    expect(said).toHaveTextContent("");
    expect(said).toHaveAttribute("title", by);
  });

  it("draws no bar, and marks nothing, without a focus", () => {
    render(<ComposedDashboard spec={premise()} cards={[card("c7f3a001", "Return rate", 0.1)]} host={HOST} doors={{ onRefresh: vi.fn() }} />);
    expect(screen.queryByTestId("dashboard-filtered-by")).toBeNull();
    expect(screen.queryByTestId("not-filtered")).toBeNull();
  });
});

describe("a click on a mark", () => {
  it("is traced off the card's statement and chosen; one that stands for no column chooses nothing", async () => {
    traceField.mockResolvedValueOnce({ table: "users", column: "traffic_source", confidence: "certain" });
    const onFocus = vi.fn();
    const said = vi.fn();
    await traceAndChoose(traceField, "c1", { field: "channel", value: "Search" }, [], onFocus, said);
    expect(traceField).toHaveBeenCalledWith("c1", "channel");
    expect(onFocus).toHaveBeenCalledWith([SEARCH]);
    const refused = "total is worked out from its table, not read from one, so a click on it filters nothing.";
    traceField.mockResolvedValueOnce({ refused });
    onFocus.mockClear();
    await traceAndChoose(traceField, "c1", { field: "total", value: 3 }, [], onFocus, said);
    expect(onFocus).not.toHaveBeenCalled();
    expect(said).toHaveBeenCalledWith(refused);
  });
});
