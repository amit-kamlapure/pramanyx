// @vitest-environment jsdom

/** The data a dashboard is built on (2026-11-19): datasets added from the connection's tables or a statement of one's own,
 *  each held once, taken off with ×, and never a piece of the page. */
import { change, fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DataView, DatasetLine, OpenDatasetContext, addDatasets, followDataset, moveToDataset, tableDataset } from "@/components/dashboards/Datasets";
import { MAX_DATASETS, builtOn, cardsBuiltOn, datasetOfCard, dropDataset, freshDatasetName, placeCard, type DashboardSpec } from "@/lib/dashboards/edit";
import { cardsDashboardSpec } from "@/lib/dashboards/start";

const api = vi.hoisted(() => ({ getCatalogTree: vi.fn(), previewDashboardQuery: vi.fn(), keepDashboardQuery: vi.fn(), askForSql: vi.fn() }));
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

describe("the Data tab (2026-11-19)", () => {
  const view = (spec: DashboardSpec, onChange = vi.fn(), extra: Partial<Parameters<typeof DataView>[0]> = {}) => {
    render(<DataView spec={spec} connectionId="c" onChange={onChange} pages={[]} onPage={vi.fn()} {...extra} />);
    return onChange;
  };

  it("says how to get going when there are none, and adds the tables ticked", async () => {
    const onChange = view(blank());
    expect(screen.getByTestId("data-view-empty")).toHaveTextContent("Add data to get going");
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
    const onChange = view(blank());
    fireEvent.click(screen.getByTestId("data-add-sql"));
    fireEvent.change(screen.getByLabelText("The dataset's name"), { target: { value: "Late orders" } });
    fireEvent.change(screen.getByLabelText("The dataset's SQL"), { target: { value: "SELECT * FROM shop.orders WHERE late" } });
    fireEvent.click(screen.getByTestId("add-data-check"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(api.previewDashboardQuery).toHaveBeenCalledWith("c", expect.objectContaining({ sql: "SELECT * FROM shop.orders WHERE late" }));
    expect(onChange.mock.calls[0][0].datasets).toEqual({ late_orders: { label: "Late orders", sql: "SELECT * FROM shop.orders WHERE late" } });
  });

  it("takes one off with ×", () => {
    const onChange = view(addDatasets(blank(), [ORDERS]).spec);
    expect(screen.getByTestId("data-dataset")).toHaveTextContent("Ordersshop.orders");
    fireEvent.click(screen.getByRole("button", { name: "Take Orders off" }));
    expect(onChange.mock.calls[0][0].datasets).toBeUndefined();
    expect(onChange.mock.calls[0][1]).toBe("a dataset taken off by hand");
  });

  it("runs the statement as typed, and shows its first rows or its columns", async () => {
    api.previewDashboardQuery.mockResolvedValue({ connection_id: "c", refused: [], more: true, duration_ms: 120,
      columns: [{ name: "day", type: "DATE" }, { name: "total", type: "DOUBLE" }], rows: [["2026-11-01", 12.5], ["2026-11-02", 8]] });
    view(addDatasets(blank(), [ORDERS]).spec);
    expect(screen.getByTestId("data-dataset-result")).toHaveTextContent("Run it to see what it returns.");
    fireEvent.change(screen.getByLabelText("The dataset's SQL"), { target: { value: "SELECT day, total FROM shop.orders" } });
    fireEvent.click(screen.getByTestId("data-dataset-run"));
    expect(await screen.findByTestId("data-dataset-rows")).toHaveTextContent("2026-11-0112.5");
    expect(api.previewDashboardQuery).toHaveBeenCalledWith("c", expect.objectContaining({ sql: "SELECT day, total FROM shop.orders" }));
    expect(screen.getByTestId("data-dataset-result")).toHaveTextContent("2 columns · the first 2 rows, and more · 0.12 s");
    fireEvent.click(screen.getByRole("radio", { name: "Schema" }));
    expect(screen.getByTestId("data-dataset-schema")).toHaveTextContent("daydate · DATE");
  });

  it("goes back to the canvas on a page chosen above it", () => {
    const onPage = vi.fn();
    view(blank(), vi.fn(), { pages: [{ name: "one", label: "One", hidden: false }, { name: "two", label: "Two", hidden: true }], onPage });
    fireEvent.click(screen.getAllByTestId("data-view-page")[1]);
    expect(onPage).toHaveBeenCalledWith("two");
  });
});

/** Two charts on the orders dataset, one on nothing: what a change to the dataset's statement reaches. */
function linked(): DashboardSpec {
  let spec = addDatasets(blank(), [ORDERS]).spec;
  for (const id of ["bars0001", "line0002", "solo0003"]) spec = placeCard(spec, id);
  return builtOn(builtOn(spec, "bars0001", "orders"), "line0002", "orders");
}
const SHOWN = { as: "bar", x: "day", bucket: "day", series: [{ column: "total", agg: "sum" }] };
const held = (id: string) => ({ id, title: id === "bars0001" ? "Sales" : "Trend", render: { shown: { ...SHOWN, as: id === "bars0001" ? "bar" : "line" } } });

describe("charts built on a dataset (2026-11-19: link them)", () => {
  it("knows which charts each dataset holds, and lets them go when it is taken off", () => {
    const spec = linked();
    expect(cardsBuiltOn(spec, "orders")).toEqual(["bars0001", "line0002"]);
    expect(datasetOfCard(spec, "solo0003")).toBeNull();
    const gone = dropDataset(spec, "orders");
    expect(cardsBuiltOn(gone, "orders")).toEqual([]);
    expect(Object.values(gone.elements).filter(e => e.type === "Card")).toHaveLength(3);      // they stay, reading what they read
  });

  it("keeps a new statement on every chart built on it, each as it is set up, replacing its card", async () => {
    api.previewDashboardQuery.mockResolvedValue({ connection_id: "c", refused: [] });
    api.keepDashboardQuery.mockImplementation(async (_c: string, q: { replaces: string }) => ({ card: { id: `new-${q.replaces}` }, preview: {} }));
    const def = { label: "Orders", sql: "SELECT * FROM shop.orders WHERE status = 'paid'" };
    const out = await followDataset("c", linked(), "orders", def, held);
    if ("refused" in out) throw new Error(out.refused.join(" "));
    expect(api.keepDashboardQuery.mock.calls.map(c => [c[1].replaces, c[1].sql, c[1].shown.as])).toEqual([
      ["bars0001", def.sql, "bar"], ["line0002", def.sql, "line"]]);
    expect(out.spec.datasets?.orders).toEqual(def);
    expect(cardsBuiltOn(out.spec, "orders")).toEqual(["new-bars0001", "new-line0002"]);
    expect(Object.values(out.spec.elements).some(e => e.props?.card === "solo0003")).toBe(true);    // a chart on nothing is not touched
  });

  it("changes none when one chart cannot read the new statement, and says which and why", async () => {
    api.previewDashboardQuery.mockImplementation(async (_c: string, q: { shown: { as: string } }) => ({ connection_id: "c",
      refused: q.shown.as === "line" ? ["day is not a column of what it returns."] : [] }));
    const out = await followDataset("c", linked(), "orders", { label: "Orders", sql: "SELECT total FROM shop.orders" }, held);
    expect(out).toEqual({ refused: ["Trend: day is not a column of what it returns."] });
    expect(api.keepDashboardQuery).not.toHaveBeenCalled();
  });

  it("the Data tab says how many charts each holds, renames without running, and sends a new statement to the charts", async () => {
    api.previewDashboardQuery.mockResolvedValue({ connection_id: "c", refused: [] });
    const onChange = vi.fn();
    const onFollow = vi.fn(async () => [] as string[]);
    render(<DataView spec={linked()} connectionId="c" onChange={onChange} onFollow={onFollow} pages={[]} onPage={vi.fn()} />);
    expect(screen.getByTestId("data-dataset")).toHaveTextContent("shop.orders · 2 charts");
    fireEvent.change(screen.getByLabelText("The dataset's name"), { target: { value: "Paid orders" } });
    fireEvent.click(screen.getByTestId("data-dataset-keep"));
    expect(onChange.mock.calls[0][0].datasets.orders).toEqual({ ...ORDERS, label: "Paid orders" });
    expect(api.previewDashboardQuery).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("The dataset's SQL"), { target: { value: "SELECT * FROM shop.orders WHERE paid" } });
    fireEvent.click(screen.getByTestId("data-dataset-keep"));
    await waitFor(() => expect(onFollow).toHaveBeenCalledWith("orders", { label: "Orders", sql: "SELECT * FROM shop.orders WHERE paid" }));
  });

  it("shows what stops the charts following, and keeps the statement as typed", async () => {
    api.previewDashboardQuery.mockResolvedValue({ connection_id: "c", refused: [] });
    render(<DataView spec={linked()} connectionId="c" onChange={vi.fn()} pages={[]} onPage={vi.fn()}
      onFollow={async () => ["Trend: day is not a column of what it returns."]} />);
    fireEvent.change(screen.getByLabelText("The dataset's SQL"), { target: { value: "SELECT total FROM shop.orders" } });
    fireEvent.click(screen.getByTestId("data-dataset-keep"));
    expect(await screen.findByTestId("data-dataset-refused")).toHaveTextContent("Trend: day is not a column");
    expect(screen.getByLabelText("The dataset's SQL")).toHaveValue("SELECT total FROM shop.orders");
  });
});

describe("what a chart is built on, under its Visualization (2026-11-19)", () => {
  const two = () => addDatasets(linked(), [{ label: "Returns", sql: "SELECT * FROM shop.returns" }]).spec;

  it("names its dataset, which opens it in the Data pane, and moves it to another with the pencil", async () => {
    const open = vi.fn();
    const onMove = vi.fn(async () => [] as string[]);
    render(<OpenDatasetContext.Provider value={open}><DatasetLine spec={two()} cardId="bars0001" onMove={onMove} /></OpenDatasetContext.Provider>);
    fireEvent.click(screen.getByTestId("chart-dataset-open"));
    expect(open).toHaveBeenCalledWith("orders");
    expect(screen.getByTestId("chart-dataset-open")).toHaveTextContent("Orders");
    fireEvent.click(screen.getByRole("button", { name: "Change dataset" }));
    change(screen.getByLabelText("Build it on"), { target: { value: "returns" } });
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("returns"));
  });

  it("says a chart of its own SQL is one, and offers the dashboard's datasets", () => {
    render(<DatasetLine spec={two()} cardId="solo0003" onMove={vi.fn(async () => [])} />);
    expect(screen.getByTestId("chart-dataset-line")).toHaveTextContent("Its own SQL");
    expect(screen.getByRole("button", { name: "Change dataset" })).toBeInTheDocument();
  });

  it("says nothing on a dashboard with no data, for a chart of its own SQL", () => {
    render(<DatasetLine spec={blank()} cardId="solo0003" onMove={vi.fn(async () => [])} />);
    expect(screen.queryByTestId("chart-dataset-line")).toBeNull();
  });

  it("keeps a chart's fields where the other dataset has them, and sets them again from its columns where it does not", async () => {
    api.keepDashboardQuery.mockImplementation(async (_c: string, q: { replaces: string }) => ({ card: { id: `new-${q.replaces}` }, preview: {} }));
    api.previewDashboardQuery.mockResolvedValueOnce({ connection_id: "c", refused: [] });
    const fits = await moveToDataset("c", two(), held("bars0001") as never, "returns");
    expect(fits).toEqual({ cardId: "new-bars0001", reset: false });
    expect(api.keepDashboardQuery.mock.calls[0][1]).toEqual(expect.objectContaining({ sql: "SELECT * FROM shop.returns", replaces: "bars0001",
      shown: expect.objectContaining({ x: "day" }) }));
    api.previewDashboardQuery.mockResolvedValueOnce({ connection_id: "c", refused: ["day is not a column of what it returns."],
      columns: [{ name: "returned_on", type: "DATE" }, { name: "refund", type: "DOUBLE" }] });
    const reset = await moveToDataset("c", two(), held("bars0001") as never, "returns");
    expect(reset).toEqual({ cardId: "new-bars0001", reset: true });
    expect(api.keepDashboardQuery.mock.calls[1][1].shown).toEqual(expect.objectContaining({ as: "bar", x: "returned_on", series: [{ column: "refund", agg: "sum" }], split: "" }));
  });
});

describe("a dataset's parameters and Edit ✦ (2026-11-20)", () => {
  const withWindow = (): DashboardSpec => ({ ...addDatasets(blank(), [ORDERS]).spec, values: { window: { label: "Window", kind: "days", value: 14 } } } as DashboardSpec);
  const view = (spec: DashboardSpec, onChange = vi.fn()) => {
    render(<DataView spec={spec} connectionId="c" onChange={onChange} pages={[]} onPage={vi.fn()} />);
    return onChange;
  };

  it("puts one of the dashboard's values in the statement, and runs it with the value tried", async () => {
    api.previewDashboardQuery.mockResolvedValue({ connection_id: "c", refused: [], columns: [{ name: "total", type: "DOUBLE" }], rows: [[1]] });
    view(withWindow());
    fireEvent.click(screen.getByTestId("data-dataset-add-parameter"));
    fireEvent.click(screen.getByTestId("data-parameter"));
    const box = screen.getByLabelText("The dataset's SQL") as HTMLTextAreaElement;
    expect(box.value).toBe(`${ORDERS.sql} {{window}}`);              // never placed in it yet: at its end, never its start
    expect(screen.getByLabelText("Run with Window as")).toHaveValue(14);
    fireEvent.change(screen.getByLabelText("Run with Window as"), { target: { value: "30" } });
    fireEvent.click(screen.getByTestId("data-dataset-run"));
    await waitFor(() => expect(api.previewDashboardQuery).toHaveBeenCalledWith("c", expect.objectContaining({ values: { window: { kind: "days", value: 30 } } })));
  });

  it("makes a new parameter a value of the dashboard, and puts it in the statement", () => {
    const onChange = view(addDatasets(blank(), [ORDERS]).spec);
    fireEvent.click(screen.getByTestId("data-dataset-add-parameter"));
    fireEvent.change(screen.getByLabelText("The parameter's name"), { target: { value: "Least total" } });
    fireEvent.change(screen.getByLabelText("What it starts as"), { target: { value: "100" } });
    fireEvent.click(screen.getByTestId("data-parameter-make"));
    const [next, note] = onChange.mock.calls[0];
    expect(note).toBe("a parameter added to a dataset by hand");
    const [[name, def]] = Object.entries(next.values as Record<string, unknown>);
    expect(def).toEqual({ label: "Least total", kind: "number", value: 100 });
    expect((screen.getByLabelText("The dataset's SQL") as HTMLTextAreaElement).value).toContain(`{{${name}}}`);
  });

  it("says what stops a run before anything runs: a value not given", () => {
    view(withWindow());
    fireEvent.change(screen.getByLabelText("The dataset's SQL"), { target: { value: "SELECT * FROM shop.orders WHERE age < {{window}}" } });
    fireEvent.change(screen.getByLabelText("Run with Window as"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("data-dataset-run"));
    expect(screen.getByTestId("data-dataset-result")).toHaveTextContent("Give Window days to try the query with.");
    expect(api.previewDashboardQuery).not.toHaveBeenCalled();
  });

  it("Edit ✦ rewrites the statement as asked, in place: nothing run or kept, and the edit undone with one click", async () => {
    api.askForSql.mockResolvedValue({ sql: "SELECT * FROM shop.orders WHERE total > 100", notes: ["Kept to orders over 100."], outcome: "" });
    const onChange = view(addDatasets(blank(), [ORDERS]).spec);
    fireEvent.click(screen.getByTestId("data-dataset-edit"));
    fireEvent.change(screen.getByTestId("data-dataset-ask-input"), { target: { value: "only orders over 100" } });
    fireEvent.keyDown(screen.getByTestId("data-dataset-ask-input"), { key: "Enter" });
    await waitFor(() => expect(screen.getByLabelText("The dataset's SQL")).toHaveValue("SELECT * FROM shop.orders WHERE total > 100"));
    expect(api.askForSql).toHaveBeenCalledWith("c", "only orders over 100", { sql: ORDERS.sql });
    expect(screen.getByTestId("data-dataset-edited")).toHaveTextContent("Kept to orders over 100.");
    expect(onChange).not.toHaveBeenCalled();
    expect(api.previewDashboardQuery).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("data-dataset-edit-undo"));
    expect(screen.getByLabelText("The dataset's SQL")).toHaveValue(ORDERS.sql);
  });
});
