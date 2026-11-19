// @vitest-environment jsdom

/** The data a dashboard is built on (2026-11-19): datasets added from the connection's tables or a statement of one's own,
 *  each held once, taken off with ×, and never a piece of the page. */
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DatasetsList, addDatasets, tableDataset } from "@/components/dashboards/Datasets";
import { MAX_DATASETS, freshDatasetName, type DashboardSpec } from "@/lib/dashboards/edit";
import { cardsDashboardSpec } from "@/lib/dashboards/start";

const api = vi.hoisted(() => ({ getCatalogTree: vi.fn(), previewDashboardQuery: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));

const blank = () => cardsDashboardSpec("Ops", []);
const ORDERS = { label: "Orders", sql: "SELECT * FROM shop.orders", table: "shop.orders" };

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset());
  api.getCatalogTree.mockResolvedValue({ sections: [{ id: "s", label: "S", entries: [{ conn_id: "c", conn_type: "duckdb", schemas: [
    { name: "shop", tables: [{ name: "orders" }, { name: "order lines" }] }] }] }] });
});

describe("holding datasets", () => {
  it("names each by its label, and holds one statement once", () => {
    const one = addDatasets(blank(), [ORDERS, { label: "Orders", sql: "SELECT * FROM shop.orders WHERE total > 1" }]);
    expect(one.names).toEqual(["orders", "orders_2"]);
    const again = addDatasets(one.spec, [{ ...ORDERS, label: "Orders again" }]);
    expect(again.names).toEqual(["orders"]);
    expect(Object.keys(again.spec.datasets ?? {})).toEqual(["orders", "orders_2"]);
  });

  it("holds no more than a dashboard may", () => {
    const many = Array.from({ length: MAX_DATASETS + 3 }, (_, i) => ({ label: `T${i}`, sql: `SELECT ${i}` }));
    expect(Object.keys(addDatasets(blank(), many).spec.datasets ?? {})).toHaveLength(MAX_DATASETS);
  });

  it("gives a name a statement can carry, whatever the label", () => {
    expect(freshDatasetName(blank(), "2024 Orders — EU")).toBe("d_2024_orders_eu");
    expect(freshDatasetName(blank(), "!!!")).toBe("data");
    expect(freshDatasetName(addDatasets(blank(), [{ label: "2024", sql: "SELECT 1" }]).spec, "2024")).toBe("d_2024_2");
    expect(tableDataset({ schema: "shop", table: "order lines" }, '"')).toEqual({ label: "Order lines", sql: 'SELECT * FROM shop."order lines"', table: "shop.order lines" });
  });
});

describe("the Data pane's datasets", () => {
  const pane = (spec: DashboardSpec, onChange = vi.fn()) => { render(<DatasetsList spec={spec} connectionId="c" onChange={onChange} />); return onChange; };

  it("says how to get going when there are none, and adds the tables ticked", async () => {
    const onChange = pane(blank());
    expect(screen.getByTestId("data-datasets-empty")).toHaveTextContent("Add data to get going");
    fireEvent.click(screen.getByTestId("data-add-table"));
    fireEvent.click(await screen.findByRole("checkbox", { name: "shop.orders" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "shop.order lines" }));
    fireEvent.click(screen.getByTestId("add-data-tables"));
    const [next, note] = onChange.mock.calls[0];
    expect(note).toBe("tables added as data by hand");
    expect(Object.values(next.datasets as Record<string, { table: string }>).map(d => d.table)).toEqual(["shop.orders", "shop.order lines"]);
  });

  it("adds a statement of one's own only once it is checked to read", async () => {
    api.previewDashboardQuery.mockResolvedValue({ connection_id: "c", refused: [], columns: [] });
    const onChange = pane(blank());
    fireEvent.click(screen.getByTestId("data-add-sql"));
    fireEvent.change(screen.getByLabelText("The dataset's name"), { target: { value: "Late orders" } });
    fireEvent.change(screen.getByLabelText("The dataset's SQL"), { target: { value: "SELECT * FROM shop.orders WHERE late" } });
    fireEvent.click(screen.getByTestId("add-data-check"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(api.previewDashboardQuery).toHaveBeenCalledWith("c", expect.objectContaining({ sql: "SELECT * FROM shop.orders WHERE late" }));
    expect(onChange.mock.calls[0][0].datasets).toEqual({ late_orders: { label: "Late orders", sql: "SELECT * FROM shop.orders WHERE late" } });
  });

  it("takes one off with ×", () => {
    const onChange = pane(addDatasets(blank(), [ORDERS]).spec);
    expect(screen.getByTestId("data-dataset")).toHaveTextContent("Ordersshop.orders");
    fireEvent.click(screen.getByRole("button", { name: "Take Orders off" }));
    expect(onChange.mock.calls[0][0].datasets).toBeUndefined();
    expect(onChange.mock.calls[0][1]).toBe("a dataset taken off by hand");
  });
});
