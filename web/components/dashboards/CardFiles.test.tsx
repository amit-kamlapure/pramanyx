/**
 * The study's R23: a card's doors offer its rows as a CSV, and its chart as a picture where it draws one.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/lib/testing";

import type { CardState } from "@/components/brief/PinnedCardBody";
import { DashboardTile, shapedTable } from "@/components/dashboards/DashboardTile";
import type { DashboardCard, QueryShaped, QueryShown } from "@/lib/api";

const files = vi.hoisted(() => ({ downloadCsv: vi.fn(), downloadChartPng: vi.fn() }));
vi.mock("@/lib/query/csv", async (original) => ({ ...(await original<typeof import("@/lib/query/csv")>()), downloadCsv: files.downloadCsv }));
vi.mock("@/lib/chartExport", async (original) => ({ ...(await original<typeof import("@/lib/chartExport")>()), downloadChartPng: files.downloadChartPng }));
vi.mock("@/components/charts/vega/VegaChart", () => ({ VegaChart: () => <div data-testid="vega" /> }));
beforeAll(() => { globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver; });
beforeEach(() => vi.clearAllMocks());

const refresh = { cadence: "daily", last_run: "", last_value: null, prev_value: null, history: [] };
const SETUP = { as: "bar", series: [{ column: "orders", agg: "sum" }], split: "", x: "channel" } as unknown as QueryShown;
const BAR = { as: "bar", x: { name: "channel", kind: "text", bucket: "" }, series: [""], other: false, said: [],
  points: [{ x: "Email", s: "", v: 3 }, { x: "Search", s: "", v: 5 }] } as unknown as QueryShaped;
const TABLE = { as: "table", columns: [{ name: "id", type: "VARCHAR" }, { name: "n", type: "BIGINT" }], rows: [["a", 1]], more: false, said: [] } as unknown as QueryShaped;
const tile = (shown: QueryShaped) => render(<DashboardTile status="unmeasured" sym="$" doors={{ onRefresh: vi.fn() }}
  cs={{ card: { id: "c1", title: "Orders by channel!", sql: "SELECT 1", render: { shown: SETUP }, refresh, thresholds: {}, provenance: {} } as unknown as DashboardCard,
        run: { columns: [], rows: [], row_count: 0, caveats: [], error: null, refresh, shown } } as unknown as CardState & { card: DashboardCard }} />);
const open = () => fireEvent.keyDown(screen.getByTestId("card-download"), { key: "Enter" });

describe("a card's downloads", () => {
  it("offers a chart's points as rows and the chart as a picture", async () => {
    tile(BAR);
    open();
    fireEvent.click(await screen.findByTestId("card-download-csv"));
    expect(files.downloadCsv).toHaveBeenCalledTimes(1);
    const [name, body] = files.downloadCsv.mock.calls[0];
    expect(name).toMatch(/^orders-by-channel-\d{4}-/);
    expect(body).toContain("channel,orders");
    expect(body).toContain("Search,5");
    open();
    fireEvent.click(await screen.findByTestId("card-download-png"));
    expect(files.downloadChartPng).toHaveBeenCalledTimes(1);
  });

  it("offers a table its rows and no picture", async () => {
    tile(TABLE);
    open();
    expect(await screen.findByTestId("card-download-csv")).toBeInTheDocument();
    expect(screen.queryByTestId("card-download-png")).toBeNull();
  });

  it("writes a figure as one row under its label", () => {
    expect(shapedTable({ as: "figure", value: 12, label: "Orders", said: [] } as unknown as QueryShaped)).toEqual({ columns: ["Orders"], rows: [[12]] });
  });
});
