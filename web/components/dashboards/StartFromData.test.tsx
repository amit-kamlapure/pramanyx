// @vitest-environment jsdom

/** A dashboard started from the tables a person chooses, or a statement of their own, each held as a dataset; no model asked. */
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FromSql, FromTables, MAX_START_TABLES, tableSql } from "@/components/dashboards/StartFromData";

const api = vi.hoisted(() => ({ getCatalogTree: vi.fn(), keepDashboardQuery: vi.fn(), keepDashboard: vi.fn(), previewDashboardQuery: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));

const TREE = (n = 3, type = "duckdb") => ({ sections: [{ id: "s", label: "S", entries: [{ conn_id: "c", conn_type: type, schemas: [
  { name: "shop", tables: Array.from({ length: n }, (_, i) => ({ name: ["orders", "customers", "order_lines"][i] ?? `t${i}` })) }] }] }] });

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset());
  api.getCatalogTree.mockResolvedValue(TREE());
  api.keepDashboardQuery.mockImplementation(async (_c: string, q: { title: string }) => ({ card: { id: `card-${q.title}` }, preview: {} }));
  api.keepDashboard.mockResolvedValue({ kept: true, version: 1 });
});

describe("starting from tables", () => {
  it("holds each table chosen as a dataset, places no card of its rows, and asks no model", async () => {
    const onKept = vi.fn();
    render(<FromTables connectionId="c" onKept={onKept} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "shop.orders" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "shop.order_lines" }));
    expect(screen.getByTestId("dashboard-start-tables")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("The dashboard's name"), { target: { value: "Sales" } });
    fireEvent.click(screen.getByTestId("dashboard-start-tables"));
    await waitFor(() => expect(onKept).toHaveBeenCalledTimes(1));
    expect(api.keepDashboardQuery).not.toHaveBeenCalled();
    const spec = api.keepDashboard.mock.calls[0][2] as { elements: Record<string, { type: string }>; datasets: Record<string, { label: string; sql: string; table: string }> };
    expect(Object.values(spec.elements).filter(e => e.type === "Card")).toEqual([]);
    expect(spec.datasets).toEqual({
      orders: { label: "Orders", sql: "SELECT * FROM shop.orders", table: "shop.orders" },
      order_lines: { label: "Order lines", sql: "SELECT * FROM shop.order_lines", table: "shop.order_lines" },
    });
  });

  it("finds a table by its name", async () => {
    render(<FromTables connectionId="c" onKept={vi.fn()} />);
    await screen.findByRole("checkbox", { name: "shop.orders" });
    fireEvent.change(screen.getByLabelText("Find a table"), { target: { value: "cust" } });
    expect(screen.getAllByTestId("dashboard-table-choice")).toHaveLength(1);
  });

  it("holds a start to the most tables it may place", async () => {
    api.getCatalogTree.mockResolvedValue(TREE(MAX_START_TABLES + 2));
    render(<FromTables connectionId="c" onKept={vi.fn()} />);
    await screen.findByRole("checkbox", { name: "shop.orders" });
    const boxes = screen.getAllByRole("checkbox");
    boxes.slice(0, MAX_START_TABLES).forEach(b => fireEvent.click(b));
    expect(boxes[MAX_START_TABLES]).toBeDisabled();
  });

  it("starts on a statement of one's own once it is checked to read, held as the first dataset", async () => {
    api.previewDashboardQuery.mockResolvedValueOnce({ connection_id: "c", refused: ["It reads nothing this card can read."] });
    const onKept = vi.fn();
    render(<FromSql connectionId="c" onKept={onKept} />);
    fireEvent.change(screen.getByLabelText("The dataset's name"), { target: { value: "Big orders" } });
    fireEvent.change(screen.getByLabelText("The dataset's SQL"), { target: { value: "SELECT * FROM shop.orders WHERE total > 100" } });
    fireEvent.click(screen.getByTestId("add-data-check"));
    expect(await screen.findByTestId("add-data-refused")).toHaveTextContent("It reads nothing this card can read.");
    expect(api.keepDashboard).not.toHaveBeenCalled();
    api.previewDashboardQuery.mockResolvedValueOnce({ connection_id: "c", refused: [], columns: [{ name: "total", type: "DOUBLE" }] });
    fireEvent.click(screen.getByTestId("add-data-check"));
    await waitFor(() => expect(onKept).toHaveBeenCalledTimes(1));
    const [, , spec, note] = api.keepDashboard.mock.calls[0];
    expect(note).toBe("Started from your own SQL");
    expect((spec as { datasets: unknown }).datasets).toEqual({ big_orders: { label: "Big orders", sql: "SELECT * FROM shop.orders WHERE total > 100" } });
    expect(api.keepDashboardQuery).not.toHaveBeenCalled();
  });

  it("writes a name that needs quoting as the connection quotes it", () => {
    expect(tableSql({ schema: "my shop", table: "orders" }, "`")).toBe("SELECT * FROM `my shop`.orders");
    expect(tableSql({ schema: "", table: "order lines" }, '"')).toBe('SELECT * FROM "order lines"');
    expect(tableSql({ schema: "main", table: "titles" }, '"', true)).toBe("SELECT * EXCLUDE (_row) FROM main.titles");
  });
});
