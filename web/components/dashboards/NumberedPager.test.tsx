/**
 * Paged tables (study R26): ‹ 1 2 3 4 5 … 16 › beneath the rows, the page shown marked, and a count that is the table's
 * own — "of the first 200" when the query returned more than a card keeps.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { NumberedPager, pagesShown } from "@/components/dashboards/NumberedPager";
import { QueryRows } from "@/components/dashboards/DashboardTile";

describe("the pages drawn", () => {
  it("draws every page up to seven, then the first, the last and the ones about the page shown", () => {
    expect(pagesShown(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pagesShown(2, 16)).toEqual([1, 2, 3, 4, 5, "gap", 16]);
    expect(pagesShown(8, 16)).toEqual([1, "gap", 7, 8, 9, "gap", 16]);
    expect(pagesShown(15, 16)).toEqual([1, "gap", 12, 13, 14, 15, 16]);
    for (const [c, n] of [[1, 9], [5, 9], [9, 9], [6, 40]]) expect(pagesShown(c, n).length).toBeLessThanOrEqual(7);
  });

  it("marks the page shown, goes to a page pressed, and draws nothing for one page", () => {
    const onPage = vi.fn();
    const { rerender, container } = render(<NumberedPager page={3} pages={16} onPage={onPage} />);
    expect(screen.getByRole("button", { name: "Page 3" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Page 16" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage.mock.calls).toEqual([[16], [4]]);
    rerender(<NumberedPager page={1} pages={1} onPage={onPage} />);
    expect(container.querySelector("nav")).toBeNull();
  });

  it("with no total, pages forward one at a time and names no last page", () => {
    render(<NumberedPager page={2} pages={null} more={false} onPage={() => {}} />);
    expect(screen.queryByRole("button", { name: /^Page / })).toBeNull();
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("a query card's table, a page at a time", () => {
  const table = (n: number, more = false) => ({
    as: "table" as const, more, said: [],
    columns: [{ name: "order_id", type: "VARCHAR" }, { name: "amount", type: "DOUBLE" }],
    rows: Array.from({ length: n }, (_, i) => [`o${i + 1}`, i + 1]),
  });

  it("shows as many rows as its box holds, the pages beneath, and the count of the first rows when there are more", () => {
    // 200px: (200 - 28 - 32) / 27 → 5 rows a page
    render(<QueryRows shaped={table(200, true)} height={200} />);
    expect(screen.getAllByRole("row")).toHaveLength(1 + 5);
    const pages = screen.getByTestId("query-tile-pages");
    expect(pages.textContent).toContain("1–5 of the first 200");
    fireEvent.click(within(pages).getByRole("button", { name: "Page 40" }));
    expect(screen.getByText("o200")).toBeTruthy();
    expect(screen.getByTestId("query-tile-pages").textContent).toContain("196–200 of the first 200");
  });

  it("draws no pages when every row fits", () => {
    render(<QueryRows shaped={table(4)} height={200} />);
    expect(screen.queryByTestId("query-tile-pages")).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(1 + 4);
  });
});
