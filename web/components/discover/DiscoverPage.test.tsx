// @vitest-environment jsdom
/**
 * Discover, the page (the plan's §4.1–4.2, D2): the Areas as cards that open their page, what is certified (or that
 * nothing is), each kind with its first rows and "View all", what is withheld counted where it would stand, a kind that
 * could not be read said, the kinds with nothing named once, the search narrowing to a list, and an Area's page naming
 * the tab and saying how each thing came to stand in it. Fixtures are shaped as theLook's live read (2026-11-23).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiscoverAreaPage, DiscoverHome, DiscoverItem, DiscoverItems } from "@/lib/discover";
import { fireEvent, render, screen, waitFor, within } from "@/lib/testing";

const readDiscover = vi.fn();
const readDiscoverItems = vi.fn();
const readDiscoverArea = vi.fn();
const askAbout = vi.fn();
const readAreas = vi.fn();
const saveAreas = vi.fn();
const setNotAnArea = vi.fn();

vi.mock("@/lib/discover", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readDiscover: (...a: unknown[]) => readDiscover(...a),
  readDiscoverItems: (...a: unknown[]) => readDiscoverItems(...a),
  readDiscoverArea: (...a: unknown[]) => readDiscoverArea(...a),
}));
vi.mock("@/lib/askSubject", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  askAbout: (...a: unknown[]) => askAbout(...a),
}));
vi.mock("@/lib/areas", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readAreas: (...a: unknown[]) => readAreas(...a),
  saveAreas: (...a: unknown[]) => saveAreas(...a),
  setNotAnArea: (...a: unknown[]) => setNotAnArea(...a),
}));

const { DiscoverPage } = await import("@/components/discover/DiscoverPage");

const item = (over: Partial<DiscoverItem>): DiscoverItem => ({
  kind: "metric", id: "x", name: "x", line: "", connection_id: "8233e4fd", connection_name: "theLook", area: "orders_sales",
  area_how: "", owner: "", updated_at: "", state: "", certification: null, href: "/", detail: {}, ...over,
});

const ORDERS = item({ kind: "table", id: "8233e4fd.thelook.orders", name: "orders", detail: { rows: 124729, schema: "thelook" },
  href: "/?tab=catalog&conn=8233e4fd&schema=thelook&table=orders", area_how: "its name says order" });
const REVENUE = item({ id: "8233e4fd/revenue", name: "Revenue", state: "approved", href: "/metrics/revenue?conn=8233e4fd" });
const GMR = item({ id: "8233e4fd/gmr", name: "Gross Margin Rate", state: "deprecated", area: "margin_pricing" });
const SCOUT = item({ kind: "agent", id: "ua_6d", name: "Anomaly Scout", area: "other", state: "on" });

const area = (id: string, name: string, counts: Record<string, number>, over = {}) => ({
  id, name, question: id === "orders_sales" ? "How much did we sell?" : "", parent: "", business_owners: [], technical_owners: [],
  source: "package", connections: ["8233e4fd"], counts, total: Object.values(counts).reduce((a, b) => a + b, 0), deprecated: 0, ...over,
});

const HOME: DiscoverHome = {
  connections: [{ id: "8233e4fd", name: "theLook" }],
  areas: [area("orders_sales", "Orders & sales", { metric: 1, table: 1 }), area("margin_pricing", "Margin & pricing", { metric: 1 }, { deprecated: 1 }),
    { ...area("other", "Everything else", { agent: 1 }), source: "platform" }],
  quiet_areas: [{ id: "marketing", name: "Marketing", question: "What did growth cost?" }],
  suggested: [{ id: "operations", label: "Operations", tables: ["distribution_centers"], connection_id: "8233e4fd", connection_name: "theLook" }],
  certified: [], certified_count: 0,
  kinds: [
    { kind: "metric", title: "Metrics", count: 23, withheld: 0, states: {}, items: [REVENUE, GMR] },
    { kind: "table", title: "Tables", count: 1, withheld: 0, states: {}, items: [ORDERS] },
    { kind: "definition", title: "Definitions", count: 0, withheld: 0, states: {}, items: [] },
    { kind: "canvas", title: "Data Canvases", count: 0, withheld: 2, states: {}, items: [] },
    { kind: "agent", title: "Agents", count: 1, withheld: 0, states: {}, items: [SCOUT] },
    { kind: "trusted_query", title: "Trusted queries", count: 0, withheld: 0, states: {}, items: [] },
  ],
  withheld: { canvas: 2 },
  said: ["Spreadsheets could not be read (OSError)"],
};

function renderPage(openId: string | null = null) {
  const onOpenArea = vi.fn();
  const onName = vi.fn();
  render(<DiscoverPage openId={openId} onOpenArea={onOpenArea} onName={onName} connections={[{ id: "8233e4fd", name: "theLook" }]} />);
  return { onOpenArea, onName };
}

beforeEach(() => {
  for (const f of [readDiscover, readDiscoverItems, readDiscoverArea, askAbout, readAreas, saveAreas, setNotAnArea]) f.mockReset();
  readDiscover.mockResolvedValue(HOME);
});

describe("Discover", () => {
  it("opens on the Areas that hold something, each a card that opens its page, with the empty ones a click away", async () => {
    const { onOpenArea } = renderPage();
    const areas = await screen.findByTestId("discover-areas");
    const card = within(areas).getByTestId("discover-area-orders_sales");
    expect(card.textContent).toContain("How much did we sell?");
    expect(card.textContent).toContain("1 metric · 1 table");
    expect(card.textContent).toContain("No owner yet");
    expect(card.getAttribute("href")).toBe("?tab=discover&id=orders_sales");
    expect(within(areas).getByTestId("discover-area-margin_pricing").textContent).toContain("1 deprecated");
    expect(within(areas).getByTestId("discover-area-other").textContent).toContain("no Area names them");
    expect(within(areas).queryByTestId("discover-area-marketing")).toBeNull();
    fireEvent.click(within(areas).getByTestId("discover-quiet-toggle"));
    expect(within(areas).getByTestId("discover-area-marketing").textContent).toContain("Holds nothing yet");
    fireEvent.click(card);
    expect(onOpenArea).toHaveBeenCalledWith("orders_sales");
  });

  it("says that nothing is certified, counts what is withheld, says a kind it could not read, and names the empty kinds once", async () => {
    renderPage();
    expect((await screen.findByTestId("discover-certified")).textContent).toContain("Nothing here is certified yet");
    expect(screen.getByTestId("discover-said").textContent).toContain("Spreadsheets could not be read");
    expect(screen.getByTestId("discover-kind-canvas").textContent).toContain("2 not shared with you");
    expect(screen.getByTestId("discover-nothing-yet").textContent).toBe("Nothing yet: Definitions, Trusted queries.");
    expect(screen.queryByTestId("discover-kind-definition")).toBeNull();
  });

  it("shows each kind's first rows as links to their pages, marked, with their Area, and asks about a table from its row", async () => {
    renderPage();
    const metrics = await screen.findByTestId("discover-kind-metric");
    const rows = within(metrics).getAllByTestId("discover-row");
    expect(rows.map(r => r.querySelector("a")?.getAttribute("href"))).toEqual(["/metrics/revenue?conn=8233e4fd", "/"]);
    expect(rows[1].textContent).toContain("Deprecated");
    expect(rows[1].textContent).toContain("Margin & pricing");
    expect(within(metrics).getByRole("button", { name: "View all" })).toBeTruthy();
    expect(within(metrics).queryByRole("button", { name: /Ask about/ })).toBeNull();   // a metric has no Ask subject yet
    const tables = screen.getByTestId("discover-kind-table");
    expect(within(tables).queryByRole("button", { name: "View all" })).toBeNull();      // all of them are shown
    fireEvent.click(within(tables).getByRole("button", { name: "Ask about orders" }));
    expect(askAbout).toHaveBeenCalledWith(expect.objectContaining({ kind: "table", table: "thelook.orders" }));
  });

  it("narrows to a list as a person types or filters, and counts what the list leaves out", async () => {
    const found: DiscoverItems = { items: [REVENUE], total: 1, next_cursor: null, withheld: { canvas: 2 }, said: [] };
    readDiscoverItems.mockResolvedValue(found);
    renderPage();
    await screen.findByTestId("discover-areas");
    fireEvent.change(screen.getByTestId("discover-search").querySelector("input") ?? screen.getByTestId("discover-search"),
      { target: { value: "revenue" } });
    const results = await screen.findByTestId("discover-results", {}, { timeout: 2000 });
    expect(readDiscoverItems).toHaveBeenLastCalledWith(expect.objectContaining({ q: "revenue", limit: 50 }));
    expect(results.textContent).toContain("Revenue");
    expect(screen.getByTestId("discover-withheld").textContent).toContain("Data Canvases: 2 not shared with you");
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    await waitFor(() => expect(readDiscoverItems).toHaveBeenLastCalledWith(expect.objectContaining({ q: "revenue", mine: true })));
  });

  it("declares a suggested Area as the Semantic Layer does, keeping the organisation's other declarations", async () => {
    readAreas.mockResolvedValue({ areas: [{ id: "vip", name: "VIP", question: "", parent: "", business_owners: [], technical_owners: [],
      source: "organisation", pack_id: "" }], placed: { tables: {}, metrics: {}, connection: null } });
    saveAreas.mockResolvedValue([]);
    renderPage();
    const card = await screen.findByTestId("discover-suggested-operations");
    expect(card.textContent).toContain("Read from distribution_centers");
    fireEvent.click(within(card).getByRole("button", { name: "Declare" }));
    await waitFor(() => expect(saveAreas).toHaveBeenCalledWith("8233e4fd", [
      expect.objectContaining({ id: "vip", name: "VIP" }), { id: "operations", name: "Operations", question: "", parent: "" }]));
    await waitFor(() => expect(readDiscover).toHaveBeenCalledTimes(2));
  });
});

describe("an Area's page", () => {
  const PAGE: DiscoverAreaPage = {
    area: area("orders_sales", "Orders & sales", { table: 1 }), children: [],
    kinds: [{ kind: "table", title: "Tables", count: 1, withheld: 0, states: {}, items: [ORDERS] }],
    empty_kinds: ["definition", "agent"], said: [],
  };

  it("names the tab, says its question and that nobody owns it, and how each thing came to stand in it", async () => {
    readDiscoverArea.mockResolvedValue(PAGE);
    const { onName } = renderPage("orders_sales");
    const holds = await screen.findByTestId("discover-area-holds");
    await waitFor(() => expect(onName).toHaveBeenLastCalledWith("Orders & sales"));
    expect(screen.getByTestId("discover-area").textContent).toContain("How much did we sell?");
    expect(screen.getByTestId("discover-area").textContent).toContain("No owner yet");
    expect(within(holds).getByTestId("discover-row").textContent).toContain("its name says order");
    expect(holds.textContent).toContain("Nothing here yet: Definitions, Agents.");
    expect(readDiscoverArea).toHaveBeenCalledWith("orders_sales", "");
  });

  it("says when no connection in view has the Area", async () => {
    readDiscoverArea.mockResolvedValue(null);
    renderPage("no_such_area");
    expect((await screen.findByTestId("discover-area")).textContent).toContain("No connection in view has this Area");
  });
});
