// @vitest-environment jsdom

/** A dashboard started from the tables a person chooses, with no model asked. */
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FromTables, MAX_START_TABLES, tableSql } from "@/components/dashboards/StartFromData";

const api = vi.hoisted(() => ({ getCatalogTree: vi.fn(), keepDashboardQuery: vi.fn(), keepDashboard: vi.fn() }));
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
  it("places a card of each table chosen and asks no model", async () => {
    const onKept = vi.fn();
    render(<FromTables connectionId="c" onKept={onKept} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "shop.orders" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "shop.order_lines" }));
    expect(screen.getByTestId("dashboard-start-tables")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("The dashboard's name"), { target: { value: "Sales" } });
    fireEvent.click(screen.getByTestId("dashboard-start-tables"));
    await waitFor(() => expect(onKept).toHaveBeenCalledTimes(1));
    expect(api.keepDashboardQuery.mock.calls.map(c => c[1].sql)).toEqual(["SELECT * FROM shop.orders", "SELECT * FROM shop.order_lines"]);
    expect(api.keepDashboardQuery.mock.calls[1][1].title).toBe("Order lines");
    const spec = api.keepDashboard.mock.calls[0][2] as { elements: Record<string, { type: string; props: { card?: string } }> };
    expect(Object.values(spec.elements).filter(e => e.type === "Card").map(e => e.props.card)).toEqual(["card-Orders", "card-Order lines"]);
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

  it("says why when no table could be read, and makes nothing", async () => {
    api.keepDashboardQuery.mockRejectedValue(new Error("the table is gone"));
    render(<FromTables connectionId="c" onKept={vi.fn()} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "shop.orders" }));
    fireEvent.change(screen.getByLabelText("The dashboard's name"), { target: { value: "Sales" } });
    fireEvent.click(screen.getByTestId("dashboard-start-tables"));
    expect(await screen.findByTestId("dashboard-from-tables-problem")).toHaveTextContent("shop.orders: the table is gone");
    expect(api.keepDashboard).not.toHaveBeenCalled();
  });

  it("writes a name that needs quoting as the connection quotes it", () => {
    expect(tableSql({ schema: "my shop", table: "orders" }, "`")).toBe("SELECT * FROM `my shop`.orders");
    expect(tableSql({ schema: "", table: "order lines" }, '"')).toBe('SELECT * FROM "order lines"');
  });
});
