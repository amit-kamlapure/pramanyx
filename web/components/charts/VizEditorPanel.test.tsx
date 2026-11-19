// @vitest-environment jsdom
/**
 * The one chart editor beside an answer's chart (the user, 2026-11-19: a chart is edited one way everywhere, its fields
 * each a pill with + and −): the drawer opens on the chart's own fields, a colour is added from a searchable list of
 * measures and fields and taken off with −, and the bars' axes swap.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@/lib/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/Chart", () => ({ Chart: () => null }));

import { ResultChartCard } from "@/components/charts/ResultChartCard";
import { openVizEditor } from "@/components/charts/vizEditorStore";
import type { VizConfig } from "@/components/charts/vizConfig";

const COLUMNS = ["channel", "month", "revenue"];
const ROWS = [["Online", "2025-01-01", 10], ["Store", "2025-01-01", 7], ["Online", "2025-02-01", 12], ["Store", "2025-02-01", 9]];

describe("the drawer beside an answer's chart", () => {
  it("opens on the chart's fields as pills, adds a colour from the list and takes it off again", async () => {
    const onConfigChange = vi.fn<(c: VizConfig) => void>();
    render(<ResultChartCard columns={COLUMNS} rows={ROWS} chartType="bar" editorKey="answer-1" onConfigChange={onConfigChange} />);
    act(() => openVizEditor("answer-1"));
    const drawer = await screen.findByRole("dialog", { name: "Edit visualization" });
    expect(within(drawer).getByTestId("viz-channel-x")).toHaveTextContent(/Channel|Month/);
    expect(within(drawer).getByTestId("viz-channel-y")).toHaveTextContent(/Revenue/i);
    fireEvent.click(within(drawer).getByRole("button", { name: "Color: add a field" }));
    const picker = await screen.findByTestId("viz-field-picker");
    expect(within(picker).getByRole("group", { name: "Measures" })).toHaveTextContent(/Revenue/i);
    expect(within(picker).getByRole("group", { name: "Fields" })).toHaveTextContent(/Channel/i);
    fireEvent.click(within(picker).getByRole("option", { name: /Channel/i }));
    await waitFor(() => expect(onConfigChange).toHaveBeenLastCalledWith(expect.objectContaining({ colorField: "channel" })));
    // a click inside the list is the list's: the drawer stays open
    expect(screen.getByRole("dialog", { name: "Edit visualization" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("viz-channel-color")).getByRole("button", { name: /^Take .* off Color$/ }));
    await waitFor(() => expect(onConfigChange.mock.calls.at(-1)?.[0].colorField).toBeUndefined());
  });

  it("swaps a bar's axes from between them", async () => {
    const onConfigChange = vi.fn<(c: VizConfig) => void>();
    render(<ResultChartCard columns={COLUMNS} rows={ROWS} chartType="bar" editorKey="answer-2" onConfigChange={onConfigChange} />);
    act(() => openVizEditor("answer-2"));
    fireEvent.click(await screen.findByTestId("viz-swap-axes"));
    await waitFor(() => expect(onConfigChange).toHaveBeenLastCalledWith(expect.objectContaining({ orient: "horizontal" })));
  });
});
