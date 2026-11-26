// @vitest-environment jsdom
/**
 * The metric-views plan's M1 in the editor: a metric written as parts (a source, a measure, filters one per line) is
 * sent as parts and its statement composed by the server; a statement stays one; every kept version says what it
 * changed and an earlier one can be put back; statements are written as parts only where the figure holds.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Metric, MetricSplit, MetricVersion } from "@/lib/api";

vi.mock("@/lib/useMe", () => ({ useMe: () => ({ actor: "ana" }) }));

import { MetricVersions, SplitIntoParts, composedPreview, formToMetric, metricToForm } from "./MetricsPanel";

const PARTS: Metric = {
  name: "revenue", label: "Revenue", sql: "SELECT SUM(sale_price) AS revenue FROM order_items WHERE (status IN ('a', 'b'))",
  source: "order_items", measure: "SUM(sale_price)", filters: ["status IN ('a', 'b')"], tables: ["order_items"],
  dimensions: [], connection: "c", status: "approved", quality_tests: [], lineage: [], wrong_usage_examples: [],
} as unknown as Metric;

afterEach(() => vi.unstubAllGlobals());

describe("a metric written as parts", () => {
  it("round-trips through the form, a filter with a comma kept whole, and is sent as parts with no statement", () => {
    const f = metricToForm(PARTS);
    expect(f.written).toBe("parts");
    expect(f.filters).toBe("status IN ('a', 'b')");
    const sent = formToMetric({ ...f, filters: "status IN ('a', 'b')\nis_test = false" });
    expect([sent.source, sent.measure, sent.sql, sent.tables]).toEqual(["order_items", "SUM(sale_price)", "", ["order_items"]]);
    expect(sent.filters).toEqual(["status IN ('a', 'b')", "is_test = false"]);
    expect(composedPreview({ ...f, filters: "status <> 'x'\nb = 1" }))
      .toBe("SELECT SUM(sale_price) AS revenue FROM order_items WHERE (status <> 'x') AND (b = 1)");
  });

  it("a statement stays one: written as a statement, no parts sent", () => {
    const f = metricToForm({ ...PARTS, source: null, measure: null, filters: ["a = 1", "b = 2"] });
    expect(f.written).toBe("statement");
    expect(f.filters).toBe("a = 1, b = 2");
    const sent = formToMetric(f);
    expect([sent.source, sent.measure, sent.sql]).toEqual([null, null, PARTS.sql]);
  });
});

const VERSIONS: MetricVersion[] = [
  { version: 2, at: "2026-11-26T10:00:00Z", by: "ana", definition: { ...PARTS, filters: [] } },
  { version: 1, at: "2026-11-25T10:00:00Z", by: "", definition: PARTS },
];

describe("a metric's versions", () => {
  it("lists each with what it changed, and puts an earlier one back through the edit door", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body as string | undefined });
      if (String(url).includes("/restore")) return new Response(JSON.stringify(PARTS));
      return new Response(JSON.stringify({ versions: VERSIONS }));
    }));
    const changed = vi.fn();
    render(<MetricVersions metric={PARTS} onChanged={changed} />);
    const rows = await screen.findAllByTestId("metric-version");
    expect(rows[0]).toHaveTextContent("v2");
    expect(rows[0]).toHaveTextContent("current");
    expect(rows[0]).toHaveTextContent("filters: status IN ('a', 'b') → none");
    expect(rows[1]).toHaveTextContent("first kept");
    expect(within(rows[0]).queryByTestId("metric-version-put-back")).toBeNull();
    fireEvent.click(within(rows[1]).getByTestId("metric-version-put-back"));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toContain("/metrics/revenue/versions/1/restore");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ connection: "c", schema_name: null });
    expect(await screen.findByTestId("metric-version-said")).toHaveTextContent("Version 1 is back — saved as a new version; a changed formula waits for review.");
  });
});

const SPLIT = (applied: boolean): MetricSplit => ({
  connection: "c", applied, split: 1, kept: 1, rows: [
    { name: "revenue", label: "Revenue", outcome: "split", why: "", before: 170, after: 170,
      parts: { source: "order_items", measure: "SUM(sale_price)", filters: ["status <> 'Cancelled'"], sql: "…" } },
    { name: "web_lines", label: "Web lines", outcome: "kept", before: null, after: null, parts: null,
      why: "one whole query — it joins tables, groups, or uses a CTE or a subquery, so no single source and measure can be lifted out of it" },
  ],
});

describe("writing statements as parts", () => {
  it("says what would be split and why the rest stays, and writes only on a click", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      bodies.push(body);
      return new Response(JSON.stringify(SPLIT(!!body.apply)));
    }));
    const done = vi.fn();
    render(<SplitIntoParts connId="c" onDone={done} />);
    fireEvent.click(screen.getByTestId("metric-split-open"));
    expect(await screen.findByTestId("metric-split-sum")).toHaveTextContent("1 metric can be written as parts; 1 statement stays as it is.");
    const rows = screen.getAllByTestId("metric-split-row");
    expect(rows[0]).toHaveTextContent("SUM(sale_price) over order_items, where status <> 'Cancelled' — the same figure both ways (170)");
    expect(rows[1]).toHaveTextContent("one whole query — it joins tables");
    expect(bodies).toEqual([{ apply: false, names: [] }]);
    fireEvent.click(screen.getByTestId("metric-split-apply"));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(bodies[1]).toEqual({ apply: true, names: [] });
    expect(screen.getByTestId("metric-split-sum")).toHaveTextContent("1 metric written as parts; 1 statement kept.");
  });
});
