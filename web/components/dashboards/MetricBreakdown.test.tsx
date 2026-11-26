// @vitest-environment jsdom
/**
 * The metric-views plan's M2 on a dashboard: a governed metric grouped by any dimension its source reaches, in its own
 * query (`POST /metrics/query`) on the dashboard's connection — the largest groups first, how many more, the links it
 * joined through; a metric that cannot be grouped says why.
 */
import { render, screen, waitFor } from "@/lib/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ComposedDashboard } from "@/components/dashboards/ComposedDashboard";
import type { DashboardHostState } from "@/lib/dashboards/hostState";
import { cardsDashboardSpec } from "@/lib/dashboards/start";

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(() => vi.unstubAllGlobals());

const SPEC = (props: Record<string, unknown>) => {
  const spec = cardsDashboardSpec("Sales", []);
  Object.values(spec.elements).find(e => e.type === "Section")!.children = ["by-channel"];
  spec.elements["by-channel"] = { type: "MetricBreakdown", props: { metric: "revenue", label: "Revenue by channel", by: "order.channel", top: 5, ...props }, children: [] };
  return spec;
};
const HOST: DashboardHostState = { range: { status: "standing" }, cards: {} };
const draw = (props: Record<string, unknown> = {}) => render(
  <ComposedDashboard spec={SPEC(props)} cards={[]} host={HOST} doors={{ onRefresh: vi.fn() }} connectionId="thelook" />);

describe("a metric breakdown", () => {
  it("groups the metric by a dimension through a link, the largest first, on the dashboard's connection", async () => {
    const asked: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/metrics/query")) {
        asked.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ metric: "revenue", label: "Revenue", unit: "$", by: ["order.channel"], grain: null,
          columns: ["order.channel", "revenue"], rows: [["web", 1200], ["app", 4800.5], [null, 3], ["store", 900], ["mail", 10], ["fax", 1], ["kiosk", 2]],
          caveats: [], sql: "SELECT …", links: [{ link: "order", from: "OrderItem", to: "Order", cardinality: "N:1", treatment: "joined" }] }));
      }
      return new Response(JSON.stringify({}));
    }));
    draw();
    await waitFor(() => expect(screen.getAllByTestId("metric-breakdown-row")).toHaveLength(5));
    expect(screen.getAllByTestId("metric-breakdown-row").map(r => r.textContent)).toEqual([
      "app4,800.5 $", "web1,200 $", "store900 $", "mail10 $", "No value3 $"]);
    expect(screen.getByTestId("metric-breakdown")).toHaveTextContent("7 groups, the largest 5 shown · joined through order");
    expect(asked).toEqual([{ metric: "revenue", connection_id: "thelook", by: ["order.channel"], limit: 1000 }]);
  });

  it("says why a metric cannot be grouped", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).endsWith("/metrics/query")
      ? new Response(JSON.stringify({ detail: { code: "METRIC_NOT_COMPILED", why: "cannot be grouped: it is one whole query" } }), { status: 422 })
      : new Response(JSON.stringify({})))));
    draw();
    expect(await screen.findByText(/cannot be grouped: it is one whole query/)).toBeTruthy();
  });
});
