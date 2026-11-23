// @vitest-environment jsdom
/**
 * The one chart editor beside an answer's chart (the owner, 2026-11-20: ONE chart editor everywhere, "Dashboard has the
 * best one"; answers get it rows only): the drawer opens on what the chart actually draws — its type and its fields,
 * never "Auto" or "As answered" — a colour is added from a searchable list of measures and fields and taken off with −,
 * the bars' axes swap, and what only a new query could honour is said to need the question asked again.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@/lib/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/Chart", () => ({ Chart: () => null }));
vi.mock("@/components/charts/vega/VegaChart", () => ({ VegaChart: () => <div data-testid="shared-drawing" /> }));

import { ResultChartCard } from "@/components/charts/ResultChartCard";
import { openVizEditor } from "@/components/charts/vizEditorStore";
import type { VizConfig } from "@/components/charts/vizConfig";

const COLUMNS = ["channel", "month", "revenue"];
const ROWS = [["Online", "2025-01-01", 10], ["Store", "2025-01-01", 7], ["Online", "2025-02-01", 12], ["Store", "2025-02-01", 9]];
const lastShown = (fn: ReturnType<typeof vi.fn<(c: VizConfig) => void>>) => fn.mock.calls.at(-1)?.[0].shown;

async function drawer(key: string) {
  act(() => openVizEditor(key));
  return screen.findByRole("dialog", { name: "Edit visualization" });
}

describe("the drawer beside an answer's chart", () => {
  it("opens on the chart's fields as pills, adds a colour from the list and takes it off again", async () => {
    const onConfigChange = vi.fn<(c: VizConfig) => void>();
    render(<ResultChartCard columns={COLUMNS} rows={ROWS} chartType="bar" editorKey="answer-1" onConfigChange={onConfigChange} />);
    const d = await drawer("answer-1");
    expect(within(d).getByRole("button", { name: "X axis: Channel" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Y axis: Revenue" })).toBeInTheDocument();
    // opening the editor keeps nothing: only a person's change is theirs
    expect(onConfigChange).not.toHaveBeenCalled();
    fireEvent.click(within(d).getByRole("button", { name: "Color: add a field" }));
    const picker = await screen.findByTestId("viz-field-picker");
    expect(within(picker).getByRole("group", { name: "Measures" })).toHaveTextContent(/Revenue/i);
    expect(within(picker).getByRole("group", { name: "Fields" })).toHaveTextContent(/Month/i);
    fireEvent.click(within(picker).getByRole("option", { name: /Month/i }));
    await waitFor(() => expect(lastShown(onConfigChange)?.split).toBe("month"));
    // kept as the answer's setup, rows only: never summed, never put in other buckets
    expect(lastShown(onConfigChange)).toMatchObject({ as: "bar", x: "channel", summed: false, bucket: "" });
    // a click inside the list is the list's: the drawer stays open
    expect(screen.getByRole("dialog", { name: "Edit visualization" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("viz-channel-color")).getByRole("button", { name: /^Take .* off Color$/ }));
    await waitFor(() => expect(lastShown(onConfigChange)?.split).toBe(""));
    // set up in the editor, it is drawn as a dashboard draws a card
    expect(screen.getByTestId("shared-drawing")).toBeInTheDocument();
  });

  it("swaps a bar's axes from between them: a ranking drawn lying down stands up", async () => {
    const onConfigChange = vi.fn<(c: VizConfig) => void>();
    render(<ResultChartCard columns={COLUMNS} rows={ROWS} chartType="bar" editorKey="answer-2" onConfigChange={onConfigChange} />);
    await drawer("answer-2");
    fireEvent.click(await screen.findByTestId("viz-swap-axes"));
    await waitFor(() => expect(onConfigChange).toHaveBeenCalled());
    expect(lastShown(onConfigChange)?.across).toBe(false);
  });

  it("opens on the type drawn and its real fields — never Auto or As answered", async () => {
    render(<ResultChartCard columns={["month", "channel", "revenue"]} rows={ROWS.map(r => [r[1], r[0], r[2]])} chartType="multi_line" editorKey="answer-3" />);
    const d = await drawer("answer-3");
    expect(within(d).getByRole("combobox", { name: "Visualization" })).toHaveTextContent("Multi-line");
    expect(within(d).getByRole("button", { name: "X axis: Month" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Y axis: Revenue" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Color: Channel" })).toBeInTheDocument();
    expect(d).not.toHaveTextContent(/As answered|Choose a field/);
    expect(within(d).getByRole("combobox", { name: "Visualization" })).not.toHaveTextContent("Auto");
  });

  it("names an inferred chart's type when the answer gave no hint", async () => {
    render(<ResultChartCard columns={["region", "orders"]} rows={[["North", 5], ["South", 9], ["East", 3]]} editorKey="answer-4" />);
    const d = await drawer("answer-4");
    expect(within(d).getByRole("combobox", { name: "Visualization" })).toHaveTextContent("Bar");
    expect(within(d).getByRole("button", { name: "X axis: Region" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Y axis: Orders" })).toBeInTheDocument();
  });

  it("says what only a new query could do, and offers no calculation or summing", async () => {
    render(<ResultChartCard columns={["month", "revenue"]} rows={[["2025-01-01", 4], ["2025-02-01", 6], ["2025-03-01", 5]]} chartType="line" editorKey="answer-5" />);
    const d = await drawer("answer-5");
    fireEvent.click(within(within(d).getByTestId("viz-channel-x")).getByRole("button", { name: "X axis: properties" }));
    fireEvent.click(within(within(d).getByTestId("viz-channel-y")).getByRole("button", { name: "Y axis: properties" }));
    const withheld = within(d).getAllByTestId("viz-withheld").map(w => w.textContent);
    expect(withheld).toEqual([
      expect.stringMatching(/Counted by.*needs the question asked again/),
      expect.stringMatching(/Calculation.*needs the question asked again/),
      expect.stringMatching(/Rows.*needs the question asked again/),
    ]);
    expect(within(d).queryByRole("combobox", { name: "Counted by" })).toBeNull();
    expect(within(d).queryByRole("radiogroup", { name: "Rows" })).toBeNull();
    // what the rows can do stays: a running total over the points drawn
    expect(within(d).getByRole("radiogroup", { name: "Running total" })).toBeInTheDocument();
  });

  it("keeps the answer's own extras in the one list: Pivot beside Table, and the kinds its rows draw", async () => {
    const onConfigChange = vi.fn<(c: VizConfig) => void>();
    render(<ResultChartCard columns={COLUMNS} rows={ROWS} chartType="bar" editorKey="answer-6" onConfigChange={onConfigChange} />);
    const d = await drawer("answer-6");
    fireEvent.click(within(d).getByRole("combobox", { name: "Visualization" }));
    const offered = (await screen.findAllByRole("option")).map(o => o.textContent?.trim());
    expect(offered.slice(0, 4)).toEqual(["Bar", "Line", "Area", "Scatter"]);
    expect(offered).toEqual(expect.arrayContaining(["Pie", "Table", "Pivot", "Figure"]));
    fireEvent.click(screen.getByRole("option", { name: "Pivot" }));
    await waitFor(() => expect(onConfigChange.mock.calls.at(-1)?.[0].view).toBe("pivot"));
  });

  it("restores a chart set up before, on its setup, and draws it the shared way", async () => {
    const config: VizConfig = { shown: { as: "line", summed: false, x: "month", bucket: "", series: [{ column: "revenue", agg: "sum" }],
      split: "channel", top: 5, segments: "stacked", running: false, labels: false, columns: [], sort: "", descending: true, label: "" } };
    render(<ResultChartCard columns={COLUMNS} rows={ROWS} chartType="bar" editorKey="answer-7" config={config} />);
    expect(screen.getByTestId("shared-drawing")).toBeInTheDocument();
    const d = await drawer("answer-7");
    expect(within(d).getByRole("combobox", { name: "Visualization" })).toHaveTextContent("Line");
    expect(within(d).getByRole("button", { name: "Color: Channel" })).toBeInTheDocument();
  });
});

describe("the drawer as a person works in it (2026-11-23)", () => {
  it("makes the page give it room while open, and Escape in an open list closes the list, not the drawer", async () => {
    render(<ResultChartCard columns={COLUMNS} rows={ROWS} chartType="bar" editorKey="answer-esc" onConfigChange={vi.fn()} />);
    const d = await drawer("answer-esc");
    expect(document.body.dataset.vizEditor).toBe("open");
    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    document.body.appendChild(list);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(d).toBeInTheDocument();                                    // the list was open: the drawer stays
    list.remove();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit visualization" })).toBeNull());
    expect(document.body.dataset.vizEditor).toBeUndefined();
  });
});
