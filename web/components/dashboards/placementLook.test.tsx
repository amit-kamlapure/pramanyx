/**
 * A placed card's own look (dashboard format v16; study R8, R9): its title in place of the card's, hidden or shown, a
 * description under it, and how its numbers are written — decimals, compact or whole, negatives in parentheses — with
 * the unit the card's own.
 */
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { CardState } from "@/components/brief/PinnedCardBody";
import { formatMetric } from "@/components/brief/metricFormat";
import { DashboardTile } from "@/components/dashboards/DashboardTile";
import { PlacementLookProvider, placementLookOf } from "@/components/dashboards/placementLook";
import { draftedFigure } from "@/lib/dashboards/figureText";
import { isPlainLook, lookOf, writeNumber } from "@/lib/dashboards/numberLook";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkDashboardSpec } from "@/lib/dashboards/rules";
import type { CardRunResult, DashboardCard } from "@/lib/api";

vi.mock("@/components/charts/vega/VegaChart", () => ({ VegaChart: () => <div data-testid="vega" /> }));
beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

describe("writing a number by a look", () => {
  it("writes decimals, compact or whole, and a negative its way", () => {
    expect(writeNumber(1234567, { decimals: 2 }, { compact: true })).toBe("1.23M");
    expect(writeNumber(1234567, { compact: false }, { compact: true })).toBe("1,234,567");
    expect(writeNumber(1234567.891, { compact: false, decimals: 1 }, { compact: true })).toBe("1,234,567.9");
    expect(writeNumber(-1234, { negatives: "parens", compact: false }, { prefix: "$", compact: true })).toBe("($1,234)");
    expect(writeNumber(-1234, {}, { prefix: "$", compact: true })).toBe("-$1.2K");
    expect(writeNumber(12.345, { decimals: 0 }, { percent: true, compact: false })).toBe("12%");
    expect(writeNumber(-0.004, { decimals: 2, negatives: "parens" }, { compact: false })).toBe("0.00");   // never "(0.00)"
    expect(writeNumber(950, { compact: true }, { compact: true })).toBe("950");                          // under a thousand
  });

  it("asks for nothing when nothing is set, and reads a look off a card's props", () => {
    expect(isPlainLook({})).toBe(true);
    expect(isPlainLook({ decimals: null })).toBe(true);
    expect(lookOf({ number: { decimals: 1 } })).toEqual({ decimals: 1 });
    expect(lookOf({ number: {} })).toBeNull();
    expect(placementLookOf({ show_title: false, title: "  ", description: "After returns." }))
      .toEqual({ title: null, showTitle: false, description: "After returns.", number: null });
  });

  it("keeps the unit the metric's: a rate stays a percent, money keeps its symbol, a bound still holds", () => {
    const RATIO = { kind: "ratio01" as const, lo: 0, hi: 1 };
    expect(formatMetric(0.1234, "ratio 0-1", "$", "Return rate", RATIO, { decimals: 2 }).display).toBe("12.34%");
    expect(formatMetric(1234567, "usd", "$", "Revenue", undefined, { compact: false }).display).toBe("$1,234,567");
    expect(formatMetric(1234567, "usd", "$", "Revenue", undefined, null).display).toBe("$1.2M");
    expect(formatMetric(1.4, "ratio 0-1", "$", "Return rate", RATIO, { decimals: 2 }).ok).toBe(false);
    expect(draftedFigure(1234567, "money", { compact: true })).toMatch(/1\.2M$/);
    expect(draftedFigure(0.5, "percent", { decimals: 0 })).toBe("50%");
  });
});

describe("a tile under its placement's look", () => {
  const card = {
    id: "c1", connection_id: "thelook", scope: "user", scope_ref: "default", source: "authored", kind: "kpi",
    title: "Revenue", sql: "SELECT 1", query_ref: null, render: {},
    refresh: { cadence: "daily", last_run: "", last_value: null, prev_value: null, history: [] },
    thresholds: {}, provenance: { insight_id: "", origin_finding_id: "", receipt_ref: "", metric: "revenue", metric_version: 1 },
    links: [], body: "", author: "", created_at: "", updated_at: "", own: true, made_from: "metric", unit: "usd",
    stated_range: { kind: "open", lo: null, hi: null },
  } as unknown as DashboardCard;
  const run = {
    columns: ["v"], rows: [["1234567"]], row_count: 1, caveats: [], error: null, value: 1234567,
    refresh: { cadence: "daily", last_run: "", last_value: null, prev_value: null, history: [] },
    scoped: { covers: "July 2026", standing: false, why: "", grain: "orders.created_at" }, previous: null,
  } as unknown as CardRunResult;
  const draw = (props: Record<string, unknown>) => render(
    <PlacementLookProvider value={placementLookOf(props)}>
      <DashboardTile cs={{ card, run } as CardState & { card: DashboardCard }} status="unmeasured" sym="$" doors={{ onRemove: vi.fn() }} />
    </PlacementLookProvider>);

  it("names the card by its placement's title, with a description under it, and writes its figure the placement's way", () => {
    draw({ title: "Revenue, this dashboard", description: "Before returns.", number: { compact: false } });
    expect(screen.getByTestId("tile-title")).toHaveTextContent("Revenue, this dashboard");
    expect(screen.getByTestId("tile-description")).toHaveTextContent("Before returns.");
    expect(screen.getByTestId("tile-figure")).toHaveTextContent("$1,234,567");
  });

  it("hides the title when told, and with no look draws the card as it always did", () => {
    const { unmount } = draw({ show_title: false });
    expect(screen.queryByTestId("tile-title")).toBeNull();
    unmount();
    draw({});
    expect(screen.getByTestId("tile-title")).toHaveTextContent("Revenue");
    expect(screen.getByTestId("tile-figure")).toHaveTextContent("$1.2M");
    expect(screen.queryByTestId("tile-description")).toBeNull();
  });
});

describe("the format", () => {
  const withLook = (props: Record<string, unknown>) => {
    const spec = JSON.parse(readFileSync(resolve(process.cwd(), "lib/dashboards/premise.fixture.json"), "utf8"));
    Object.assign(spec.elements["card-net"].props, props);
    return checkDashboardSpec(spec);
  };
  it("holds a card's look to its words, and hands its title and description to the numerals law", () => {
    const ok = withLook({ title: "Net", description: "After returns.", number: { decimals: 1, compact: true, negatives: "parens" } });
    expect(ok.valid).toBe(true);
    expect(ok.texts.filter(t => t.elementKey === "card-net").map(t => t.prop)).toEqual(["title", "description"]);
    expect(withLook({}).texts.some(t => t.elementKey === "card-net")).toBe(false);
    for (const bad of [{ number: { decimals: 3 } }, { number: { currency: "EUR" } }, { title: "" }]) expect(withLook(bad).valid).toBe(false);
  });
});
