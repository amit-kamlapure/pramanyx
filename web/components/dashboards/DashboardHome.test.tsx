/**
 * The dashboards home (the user, 2026-11-18): every dashboard as one list, drawn as a list, with its detail or as a grid;
 * searched, filtered and sorted; Metrics pinned first; a person's view and stars kept for them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@/lib/testing";

import { DashboardHome } from "@/components/dashboards/DashboardHome";
import type { DashboardListed, SharedDashboardListed } from "@/lib/api";
import { homeItems, miniatureCell, modifiedWords, shownItems, startOfWeek, NO_FILTERS, type HomeItem } from "@/lib/dashboards/homeList";

const prefs = vi.hoisted(() => ({ getMyPreferences: vi.fn(), putMyPreference: vi.fn() }));
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...prefs }));
vi.mock("@/components/ui/toast", async (original) => ({ ...(await original<typeof import("@/components/ui/toast")>()), toast: toasts }));

const NOW = new Date("2026-11-18T12:00:00Z");
const own = (id: string, title: string, kept_at: string, over: Partial<DashboardListed> = {}) =>
  ({ cockpit_id: id, title, kept_at, started_at: kept_at, version: 3, retired: false, cards: ["a", "b"], note: "a card placed by hand",
     published_to: [], state: "draft", outline: [{ kind: "Card", size: "wide" }, { kind: "Note", w: 4, h: 3 }], ...over }) as unknown as DashboardListed;
// kept hours ago, whatever day the suite runs: a literal date read "… ago" only on the day it was written (2026-11-19)
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const OWN = [own("returns-1", "Returns", hoursAgo(3)), own("pricing-1", "Pricing", "2026-10-01T09:00:00Z"),
  own("gone-1", "Gone", hoursAgo(2), { retired: true })];
const SHARED = [{ owner: "priya", cockpit_id: "sales-1", title: "Sales weekly", version: 2, kept_at: "2026-11-17T09:00:00Z",
  published_by: "user:priya", published_to: [{ kind: "group", id: "s", name: "Sales" }] }] as unknown as SharedDashboardListed[];
const MARK = { securable: "x", status: "certified" as const, why: "", by: "user:bo", at: "2026-11-01" };
const ITEMS = homeItems("thelook", "me", OWN, SHARED, { "thelook:me:pricing-1": MARK }, "::metrics");
const names = (items: HomeItem[]) => items.map(i => i.title);

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  prefs.getMyPreferences.mockResolvedValue({ user: "local", preferences: {} });
  prefs.putMyPreference.mockResolvedValue(undefined);
});

describe("what the home lists", () => {
  it("lists Metrics, the person's dashboards in use and the Apps shared with them; never a retired one", () => {
    expect(names(ITEMS)).toEqual(["Metrics", "Returns", "Pricing", "Sales weekly"]);
    expect(ITEMS.map(i => i.owner)).toEqual(["This connection", "You", "You", "priya"]);
    expect(ITEMS[3].id).toBe("shared:priya/sales-1");
    expect(ITEMS[2].mark?.status).toBe("certified");
  });

  it("keeps Metrics pinned first in either order; the rest by when they changed, or by name", () => {
    expect(names(shownItems(ITEMS, NO_FILTERS, "modified", [], NOW))).toEqual(["Metrics", "Returns", "Sales weekly", "Pricing"]);
    expect(names(shownItems(ITEMS, NO_FILTERS, "name", [], NOW))).toEqual(["Metrics", "Pricing", "Returns", "Sales weekly"]);
  });

  it("finds by words in the name or the owner, and filters by whose, when, favorited and certified", () => {
    const by = (over: Partial<typeof NO_FILTERS>, stars: string[] = []) => names(shownItems(ITEMS, { ...NO_FILTERS, ...over }, "name", stars, NOW));
    expect(by({ words: "SALES" })).toEqual(["Sales weekly"]);
    expect(by({ words: "priya weekly" })).toEqual(["Sales weekly"]);
    expect(by({ mine: true })).toEqual(["Pricing", "Returns"]);
    expect(by({ week: true })).toEqual(["Returns", "Sales weekly"]);
    expect(by({ starred: true }, ["::metrics", "pricing-1"])).toEqual(["Metrics", "Pricing"]);
    expect(by({ certified: true })).toEqual(["Pricing"]);
    expect(by({ mine: true, certified: true, words: "ret" })).toEqual([]);
  });

  it("says when as a person says it, and a week starts on Monday", () => {
    expect(modifiedWords("2026-11-18T11:59:50Z", NOW)).toBe("Just now");
    expect(modifiedWords("2026-11-18T11:15:00Z", NOW)).toBe("45 minutes ago");
    expect(modifiedWords("2026-11-18T09:00:00Z", NOW)).toBe("3 hours ago");
    expect(modifiedWords("2026-11-17T09:00:00Z", NOW)).toBe("Yesterday");
    expect(modifiedWords("2026-11-14T09:00:00Z", NOW)).toBe("4 days ago");
    expect(modifiedWords("2026-10-01T09:00:00Z", NOW)).toBe("Oct 1");
    expect(modifiedWords("2025-10-01T09:00:00Z", NOW)).toBe("Oct 1, 2025");
    expect(modifiedWords("", NOW)).toBe("—");
    expect(startOfWeek(new Date(2026, 10, 18)).getDay()).toBe(1);
    expect(startOfWeek(new Date(2026, 10, 22)).getDate()).toBe(16);                  // a Sunday belongs to the week before it
  });

  it("draws a piece's room from what it says it takes", () => {
    expect(miniatureCell({ kind: "Card", size: "wide" })).toEqual({ columns: 6, rows: 4 });
    expect(miniatureCell({ kind: "Card", size: "full" }).columns).toBe(12);
    expect(miniatureCell({ kind: "Note", w: 4, h: 3 })).toEqual({ columns: 4, rows: 3 });
    expect(miniatureCell({ kind: "Card" })).toEqual({ columns: 3, rows: 4 });
  });
});

describe("the home", () => {
  const draw = (onOpen = vi.fn()) => { render(<DashboardHome connectionId="thelook" items={ITEMS} onOpen={onOpen} />); return onOpen; };
  const rows = () => screen.getAllByTestId("dashboard-open").map(b => b.textContent);

  it("opens a dashboard from its row or its name, and a star opens nothing", async () => {
    const onOpen = draw();
    fireEvent.click(screen.getAllByTestId("dashboard-row")[1]);
    expect(onOpen).toHaveBeenLastCalledWith("returns-1");
    fireEvent.click(screen.getAllByTestId("dashboard-open")[0]);
    expect(onOpen).toHaveBeenLastCalledWith("::metrics");
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getAllByTestId("dashboard-star")[1]);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("dashboard-pinned")).toHaveTextContent("Pinned");
    await waitFor(() => expect(prefs.putMyPreference).toHaveBeenCalled());
  });

  it("searches and filters, says how many match, and clears when nothing does", () => {
    draw();
    expect(screen.getByTestId("dashboards-count")).toHaveTextContent("4");
    fireEvent.change(screen.getByTestId("dashboards-search"), { target: { value: "sales" } });
    expect(rows()).toEqual(["Sales weekly"]);
    expect(screen.getByTestId("dashboards-count")).toHaveTextContent("1 of 4");
    fireEvent.click(screen.getByTestId("dashboards-filter-mine"));
    expect(screen.getByTestId("dashboards-filter-mine")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("dashboards-none-match")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("dashboards-none-match")).getByRole("button", { name: "Clear filters" }));
    expect(rows()).toHaveLength(4);
  });

  it("draws the view the person keeps, the miniature on the detail and the grid", async () => {
    prefs.getMyPreferences.mockResolvedValue({ user: "local", preferences: { dashboards_view: "grid" } });
    draw();
    expect(await screen.findByTestId("dashboards-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("dashboard-miniature").length).toBe(3);             // this App's fixture says no layout
  });

  it("writes names and details at the platform's reading size, in every view", async () => {
    prefs.getMyPreferences.mockResolvedValue({ user: "local", preferences: { dashboards_view: "grid" } });
    draw();
    const grid = await screen.findByTestId("dashboards-grid");
    expect(within(grid).getAllByText("Returns")[0]).toHaveClass("aug-fs-ui");
    expect(within(grid).getByText(/ago · You/)).toHaveClass("aug-fs-ui");
    expect(within(grid).getByText("Pinned")).toHaveClass("aug-fs-ui");
    // a chip's own class is its shape: the words inside it are at the reading size
    for (const small of grid.querySelectorAll(".aug-fs-xs, .aug-fs-sm")) expect(small.querySelector(".aug-fs-ui")).not.toBeNull();
  });

  it("draws the detail with what last changed and the facts", async () => {
    prefs.getMyPreferences.mockResolvedValue({ user: "local", preferences: { dashboards_view: "detail" } });
    draw();
    const detail = await screen.findByTestId("dashboards-detail");
    expect(within(detail).getAllByText("A card placed by hand").length).toBe(2);
    expect(detail).toHaveTextContent("2 cards · version 3");
  });

  it("keeps a star for the person, by connection, and takes it back if it could not be kept", async () => {
    prefs.getMyPreferences.mockResolvedValue({ user: "local", preferences: { dashboard_stars: ["other:x"] } });
    draw();
    await waitFor(() => expect(prefs.getMyPreferences).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByTestId("dashboard-star")[1]).toHaveAttribute("aria-pressed", "false"));
    fireEvent.click(screen.getAllByTestId("dashboard-star")[1]);
    await waitFor(() => expect(prefs.putMyPreference).toHaveBeenCalledWith("dashboard_stars", expect.arrayContaining(["other:x", "thelook:returns-1"])));
    expect(screen.getAllByTestId("dashboard-star")[1]).toHaveAttribute("aria-pressed", "true");

    prefs.putMyPreference.mockRejectedValueOnce(new Error("no"));
    fireEvent.click(screen.getAllByTestId("dashboard-star")[2]);
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("The favorite was not kept"));
    expect(screen.getAllByTestId("dashboard-star")[2]).toHaveAttribute("aria-pressed", "false");
  });
});
