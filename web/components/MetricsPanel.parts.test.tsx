// @vitest-environment jsdom
/**
 * The metric-views plan's M1 in the editor: a metric written as parts (a source, a measure, filters one per line) is
 * sent as parts and its statement composed by the server; a statement stays one; every kept version says what it
 * changed and an earlier one can be put back; statements are written as parts only where the figure holds.
 */
import { choose, fireEvent, render, screen, waitFor, within } from "@/lib/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Metric, MetricSplit, MetricVersion } from "@/lib/api";

vi.mock("@/lib/useMe", () => ({ useMe: () => ({ actor: "ana" }) }));

import { MetricGrouped, MetricVersions, MetricWords, SplitIntoParts, builtFromMetrics, composedPreview, formToMetric, metricToForm } from "./MetricsPanel";
import { formatFigure } from "@/lib/format";

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

describe("a metric grouped by any dimension (M2)", () => {
  it("offers its source's dimensions and those through a link, and lists the groups largest first", async () => {
    const asked: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/dimensions")) return new Response(JSON.stringify({ metric: "revenue", groupable: true, why: "",
        dimensions: [{ path: "status", label: "Status", type: "VARCHAR", via: "" },
                     { path: "order.channel", label: "Order · Channel", type: "VARCHAR", via: "order" }] }));
      asked.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ metric: "revenue", label: "Revenue", unit: "$", by: ["order.channel"], grain: null,
        columns: ["order.channel", "revenue"], rows: [["web", 100], ["app", 250]], caveats: [], sql: "SELECT …",
        links: [{ link: "order", from: "OrderItem", to: "Order", cardinality: "N:1", treatment: "joined" }] }));
    }));
    render(<MetricGrouped metric={PARTS} />);
    const by = await screen.findByRole("combobox", { name: "Grouped by" });
    await choose(by, "order.channel");
    fireEvent.click(screen.getByTestId("metric-grouped-run"));
    await waitFor(() => expect(screen.getAllByTestId("metric-grouped-row")).toHaveLength(2));
    expect(screen.getAllByTestId("metric-grouped-row").map((r) => r.textContent)).toEqual(["app250 $", "web100 $"]);
    expect(screen.getByTestId("metric-grouped-sum")).toHaveTextContent("2 rows · joined through order (N:1, joined)");
    expect(asked).toEqual([{ metric: "revenue", connection_id: "c", schema_name: null, by: ["order.channel"], grain: null, limit: 200 }]);
  });

  it("says why a metric cannot be grouped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ metric: "revenue", groupable: false,
      why: "cannot be grouped: it is one whole query", dimensions: [] }))));
    render(<MetricGrouped metric={{ ...PARTS, groupable: false }} />);
    expect(await screen.findByTestId("metric-grouped-why")).toHaveTextContent("Cannot be grouped: it is one whole query — Edit › Parts to group it.");
  });
});

describe("a metric built from metrics, and a window (M3)", () => {
  it("is sent with no source, its window kept, and says what it is built from", () => {
    const avg = { ...PARTS, source: null, measure: "MEASURE(line_revenue) / MEASURE(line_count)", filters: [],
                  window: { kind: "trailing", n: 3 } } as unknown as Metric;
    expect(builtFromMetrics(avg.measure)).toEqual(["line_revenue", "line_count"]);
    const f = metricToForm(avg);
    expect([f.written, f.window, f.window_n]).toEqual(["parts", "trailing", "3"]);
    const sent = formToMetric(f);
    expect([sent.source, sent.tables, sent.window]).toEqual([null, [], { kind: "trailing", n: 3 }]);
    expect(composedPreview(f)).toBe("Built from line_revenue, line_count — each measured as asked, then combined; a division by nothing is no figure.");
    expect(formToMetric({ ...metricToForm(PARTS), window: "cumulative" }).window).toEqual({ kind: "cumulative" });
    expect(formToMetric(metricToForm(PARTS)).window).toBeNull();
  });

  it("asks the Grouped read for a window once a period is chosen", async () => {
    const asked: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/dimensions")) return new Response(JSON.stringify({ metric: "revenue", groupable: true, why: "", dimensions: [] }));
      asked.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ metric: "revenue", label: "Revenue", unit: "$", by: [], grain: "month", columns: ["period", "revenue"],
        rows: [["2024-01-01", 10], ["2024-02-01", 30]], caveats: ["a running total"], sql: "…", links: [] }));
    }));
    render(<MetricGrouped metric={PARTS} />);
    await choose(await screen.findByRole("combobox", { name: "By period" }), "month");
    await choose(await screen.findByRole("combobox", { name: "Window" }), "cumulative");
    fireEvent.click(screen.getByTestId("metric-grouped-run"));
    await waitFor(() => expect(screen.getAllByTestId("metric-grouped-row")).toHaveLength(2));
    expect(asked[0]).toMatchObject({ grain: "month", window: { kind: "cumulative" } });
    expect(screen.getByTestId("metric-grouped-sum")).toHaveTextContent("2 rows · a running total");
  });
});

describe("the words a metric is known by, and how its figures are shown (M4)", () => {
  it("formats a figure as declared, and as before without a declaration", () => {
    expect(formatFigure(1234567.891, { format: "currency", currency: "EUR", decimals: 2 })).toBe("€1,234,567.89");
    expect(formatFigure(0.256, { format: "percent" })).toBe("25.6%");
    expect(formatFigure(1234567.891, { format: "compact" })).toBe("1.2M");
    expect(formatFigure(1234.5, { format: "number", decimals: 0 }, "days")).toBe("1,235 days");
    expect(formatFigure(1234567.891, null, "$")).toBe("1.23M $");
    expect(formatFigure(null, { format: "currency", currency: "USD" })).toBe("—");
  });

  it("adds and takes off a word, and saves the format", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/synonyms")) return new Response(JSON.stringify({ synonyms: body.add?.length ? ["sales", ...body.add] : [] }));
      return new Response(JSON.stringify({ format: { format: "currency", currency: "USD", decimals: 0, compact: false, display_name: "" } }));
    }));
    const changed = vi.fn();
    render(<MetricWords metric={{ ...PARTS, synonyms: ["sales"], format: null }} onChanged={changed} />);
    expect(screen.getByTestId("metric-synonyms")).toHaveTextContent("sales");
    fireEvent.change(screen.getByRole("textbox", { name: "Another word" }), { target: { value: "turnover" } });
    fireEvent.click(screen.getByTestId("metric-synonym-add"));
    await waitFor(() => expect(screen.getByTestId("metric-synonyms")).toHaveTextContent("salesturnover"));
    expect(calls[0]).toEqual({ url: expect.stringContaining("/metrics/revenue/synonyms"), body: { connection: "c", add: ["turnover"], remove: [] } });
    fireEvent.click(screen.getByRole("button", { name: "Take “sales” off" }));
    await waitFor(() => expect(calls[1]?.body).toEqual({ connection: "c", add: [], remove: ["sales"] }));
    await choose(screen.getByRole("combobox", { name: "Format" }), "currency");
    fireEvent.change(screen.getByRole("textbox", { name: "Currency" }), { target: { value: "usd" } });
    fireEvent.click(screen.getByTestId("metric-format-save"));
    await waitFor(() => expect(calls[2]?.body).toEqual({ connection: "c", format: "currency", currency: "USD" }));
    expect(await screen.findByTestId("metric-words-said")).toHaveTextContent("Its figures are shown so from now on.");
    expect(changed).toHaveBeenCalled();
  });
});
