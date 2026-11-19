// @vitest-environment jsdom
/**
 * A card of a person's own query is set up in the one chart editor (the user, 2026-11-19: "keep almost entirely of how we
 * edit the visualisation in general like the dropdown for viz type, formatting of fields, etc.", its fields each a pill:
 * "All fields are almost with +/- icons that open up properties"). One kind in force, kept one way; what each
 * axis and the colour read is the card's setup; how it is dressed is its chart settings; each change is kept on the card.
 */
import { fireEvent, render, screen, waitFor, within } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ updateCard: vi.fn(async () => ({})) }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));

import { QueryChartEditor } from "@/components/dashboards/CardInspector";
import type { CardState } from "@/components/brief/PinnedCardBody";

const SETUP = { as: "bar", summed: true, x: "month", bucket: "month", series: [{ column: "orders", agg: "sum" }], split: "status", top: 6,
  segments: "stacked", running: false, labels: false, columns: [], sort: "", descending: true, label: "" };
const COLUMNS = [{ name: "month", type: "DATE" }, { name: "status", type: "VARCHAR" }, { name: "orders", type: "BIGINT" }, { name: "price", type: "DOUBLE" }];
const SHAPED = { as: "bar", x: { name: "month", kind: "date", bucket: "month" }, series: ["paid", "refunded"], other: false, said: [],
  points: [{ x: "2025-01-01", s: "paid", v: 10 }, { x: "2025-01-01", s: "refunded", v: 2 }, { x: "2025-02-01", s: "paid", v: 12 }] };
const card = (render: Record<string, unknown>, shown: unknown = SHAPED): CardState =>
  ({ card: { id: "c1", title: "Orders by status", render: { columns: COLUMNS, ...render } }, run: { shown } } as unknown as CardState);
type Sent = { render: { shown: Record<string, unknown>; viz?: Record<string, unknown> } };
const lastSent = () => (api.updateCard.mock.calls.at(-1) as unknown as [string, Sent])[1].render;

beforeEach(() => { api.updateCard.mockClear(); });

describe("the editor of a query card", () => {
  it("draws each channel's field as a pill: the bucket and the calculation said as functions of the field", () => {
    render(<QueryChartEditor cs={card({ shown: SETUP })} onKept={vi.fn()} />);
    expect(within(screen.getByTestId("viz-channel-x")).getByRole("button", { name: "X axis: MONTHLY(month)" })).toBeInTheDocument();
    expect(within(screen.getByTestId("viz-channel-y")).getByRole("button", { name: "Y axis: SUM(orders)" })).toBeInTheDocument();
    expect(within(screen.getByTestId("viz-channel-color")).getByRole("button", { name: "Color: status" })).toBeInTheDocument();
    // the colour can be taken off; the bottom cannot, a chart needs something along it
    expect(within(screen.getByTestId("viz-channel-color")).getByRole("button", { name: "Take status off Color" })).toBeInTheDocument();
    expect(within(screen.getByTestId("viz-channel-x")).queryByRole("button", { name: /^Take / })).toBeNull();
  });

  it("keeps a colour taken off as the card's setup, after a pause, and reads the card again", async () => {
    const onKept = vi.fn();
    render(<QueryChartEditor cs={card({ shown: SETUP, viz: { yLog: true } })} onKept={onKept} />);
    fireEvent.click(screen.getByRole("button", { name: "Take status off Color" }));
    await waitFor(() => expect(onKept).toHaveBeenCalled());
    expect(lastSent().shown.split).toBe("");
    expect(lastSent().viz).toEqual({ yLog: true });                                      // its chart settings stay
  });

  it("adds a measure from the list, grouped as measures and fields, and its kind of sum follows the field", async () => {
    render(<QueryChartEditor cs={card({ shown: { ...SETUP, split: "" } })} onKept={vi.fn()} />);
    fireEvent.click(within(screen.getByTestId("viz-channel-y")).getByRole("button", { name: "Y axis: add a field" }));
    const picker = await screen.findByTestId("viz-field-picker");
    expect(within(picker).getByRole("group", { name: "Measures" })).toHaveTextContent(/orders.*price/);
    expect(within(picker).getByRole("group", { name: "Fields" })).toHaveTextContent(/month.*status/);
    fireEvent.change(within(picker).getByRole("textbox", { name: "Search the fields" }), { target: { value: "pri" } });
    fireEvent.click(within(picker).getByRole("option", { name: "price" }));
    await waitFor(() => expect(api.updateCard).toHaveBeenCalled());
    expect(lastSent().shown.series).toEqual([{ column: "orders", agg: "sum" }, { column: "price", agg: "sum" }]);
  });

  it("says a chart of several measures is coloured by them, and offers no colour field then", () => {
    render(<QueryChartEditor cs={card({ shown: { ...SETUP, split: "", series: [{ column: "orders", agg: "sum" }, { column: "price", agg: "avg" }] } })} onKept={vi.fn()} />);
    const color = screen.getByTestId("viz-channel-color");
    expect(color).toHaveTextContent("Coloured by its measures");
    expect(within(color).queryByRole("button", { name: "Color: add a field" })).toBeNull();
    // each measure can be taken off while another stays
    expect(within(screen.getByTestId("viz-channel-y")).getByRole("button", { name: "Take AVG(price) off Y axis" })).toBeInTheDocument();
  });

  it("keeps how it is dressed as its chart settings: the value axis's range, typed and kept after a pause", async () => {
    render(<QueryChartEditor cs={card({ shown: SETUP })} onKept={vi.fn()} />);
    fireEvent.click(within(screen.getByTestId("viz-channel-y")).getByRole("button", { name: "Y axis: properties" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Lowest on the value axis" }), { target: { value: "5" } });
    await waitFor(() => expect(api.updateCard).toHaveBeenCalled());
    expect(lastSent().viz).toEqual({ yMin: 5 });
    expect(lastSent().shown.split).toBe("status");                                        // its setup stays
  });

  it("shows each value's colour, and keeps one chosen on the dashboard", async () => {
    const choose = vi.fn();
    render(<QueryChartEditor cs={card({ shown: SETUP })} onKept={vi.fn()} colors={{ kept: { status: { refunded: 3 } }, choose }} />);
    const swatches = screen.getAllByTestId("viz-value-color");
    expect(swatches.map(s => s.getAttribute("aria-label"))).toEqual(["paid: its colour", "refunded: its colour"]);
    fireEvent.click(swatches[0]);
    fireEvent.click(await screen.findByRole("radio", { name: "Colour 2" }));
    expect(choose).toHaveBeenCalledWith("status", "paid", 2);
  });

  it("lists every kind in one dropdown, and keeps the query's own kind with its setup, clearing another the settings held", async () => {
    const onKept = vi.fn();
    render(<QueryChartEditor cs={card({ shown: SETUP, viz: { type: "multi_line", yLog: true } })} onKept={onKept} />);
    const kinds = screen.getByRole("combobox", { name: "Visualization" });
    fireEvent.click(kinds);
    const offered = (await screen.findAllByRole("option")).map(o => o.textContent?.trim());
    expect(offered.slice(0, 4)).toEqual(["Bar", "Line", "Area", "Scatter"]);
    expect(offered.slice(-2)).toEqual(["Table", "Figure"]);
    fireEvent.click(screen.getByRole("option", { name: "Line" }));
    await waitFor(() => expect(onKept).toHaveBeenCalled());
    expect(lastSent().shown.as).toBe("line");
    expect(lastSent().viz).toEqual({ yLog: true });                                      // its other settings stay, its kind goes
  });

  it("swaps a bar's axes as its setup: the bars run sideways", async () => {
    render(<QueryChartEditor cs={card({ shown: SETUP })} onKept={vi.fn()} />);
    fireEvent.click(screen.getByTestId("viz-swap-axes"));
    await waitFor(() => expect(api.updateCard).toHaveBeenCalled());
    expect(lastSent().shown.across).toBe(true);
  });

  it("sets a table's columns and its order, and a figure's value and the words under it, in the same editor", () => {
    const { unmount } = render(<QueryChartEditor cs={card({ shown: { ...SETUP, as: "table", columns: ["status"] } }, null)} onKept={vi.fn()} />);
    expect(within(screen.getByTestId("viz-channel-columns")).getByRole("button", { name: "Columns: status" })).toBeInTheDocument();
    expect(screen.getByTestId("viz-channel-sort")).toHaveTextContent("As the query returns them");
    expect(screen.queryByTestId("viz-channel-x")).toBeNull();
    unmount();
    render(<QueryChartEditor cs={card({ shown: { ...SETUP, as: "figure", series: [{ column: "", agg: "count" }], label: "Orders" } }, null)} onKept={vi.fn()} />);
    expect(within(screen.getByTestId("viz-channel-y")).getByRole("button", { name: "Value: COUNT(*)" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Said under the figure" })).toHaveValue("Orders");
  });
});
