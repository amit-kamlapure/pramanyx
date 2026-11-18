// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { DATE_PRESETS, rangeOfPreset } from "@/lib/dashboards/datePresets";
import { FILTERS_PARAM, filterLink, focusOfCard, focusWords, pagesHolding, type DashboardFocus } from "@/lib/dashboards/focus";
import { focusOfChoice, narrowedBy, openedWith, openingChoice, parameterValue, type GlobalFilterProps } from "@/lib/dashboards/globalFilters";

const NOW = new Date(2026, 10, 19, 12);
const P = (over: Partial<GlobalFilterProps> = {}): GlobalFilterProps => ({ title: "Country", kind: "multi", table: "users", column: "country", ...over });
const chosen = (key: string, over: Partial<DashboardFocus> = {}): DashboardFocus =>
  ({ table: "users", column: "country", value: "", op: "in", values: ["China"], source: { card: `filter:${key}`, field: "country" }, ...over });

const SPEC = { root: "top", elements: {
  top: { type: "Page", props: {}, children: ["tabs"] },
  tabs: { type: "Tabs", props: {}, children: ["one", "two"] },
  one: { type: "Tab", props: { name: "one", label: "One" }, children: ["a"] },
  two: { type: "Tab", props: { name: "two", label: "Two" }, children: ["b", "c", "d"] },
  a: { type: "Card", props: { card: "ca" }, children: [] },
  b: { type: "Card", props: { card: "cb", ignores_filters: ["country"] }, children: [] },
  c: { type: "Card", props: { card: "cc", not_filtered: true, fixed_filters: [{ table: "orders", column: "status", op: "eq", value: "Complete" }] }, children: [] },
  d: { type: "Card", props: { card: "cd", fixed_filters: [{ table: "orders", column: "status", op: "eq", value: "Complete" }] }, children: [] },
} };

afterEach(() => { window.localStorage.clear(); });

describe("dates that move", () => {
  it("count complete days and months, ending before today", () => {
    expect(rangeOfPreset("yesterday", NOW)).toEqual({ low: "2026-11-18", high: "2026-11-18" });
    expect(rangeOfPreset("last_7_days", NOW)).toEqual({ low: "2026-11-12", high: "2026-11-18" });
    expect(rangeOfPreset("last_month", NOW)).toEqual({ low: "2026-10-01", high: "2026-10-31" });
    expect(rangeOfPreset("last_12_months", NOW)).toEqual({ low: "2025-11-01", high: "2026-10-31" });
    expect(rangeOfPreset("this_year", NOW)).toEqual({ low: "2026-01-01", high: "2026-11-19" });
    for (const p of DATE_PRESETS) { const r = rangeOfPreset(p, NOW); expect(r.low <= r.high).toBe(true); }
  });

  it("are kept by name and said by name", () => {
    const f = focusOfChoice("when", P({ kind: "date_range", column: "created_at" }), { kind: "date_range", low: "", high: "", preset: "last_30_days" });
    expect(f).toMatchObject({ op: "dates", preset: "last_30_days" });
    expect(focusWords(f as DashboardFocus)).toBe("Country: Last 30 days");
  });
});

describe("what a filter opens on", () => {
  it("is applied the first time, and a reader who clears it keeps it cleared", () => {
    const filters = { country: P({ opens_with: { values: ["China"] } }) };
    const first = openedWith("d", filters, []);
    expect(first?.[0]).toMatchObject({ op: "in", values: ["China"] });
    expect(openedWith("d", filters, [])).toBeNull();
    expect(openedWith("d", { country: P({ opens_with: { values: ["Japan"] } }) }, [])?.[0]).toMatchObject({ values: ["Japan"] });
  });

  it("gives way to what a shared link already chose", () => {
    const shared = [chosen("country", { values: ["Brazil"] })];
    expect(openedWith("d", { country: P({ opens_with: { values: ["China"] } }) }, shared)).toBeNull();
  });

  it("is read as each kind of filter holds it", () => {
    expect(openingChoice(P({ kind: "single", opens_with: { value: "China" } }))).toEqual({ kind: "single", value: "China" });
    expect(openingChoice(P({ kind: "date_range", opens_with: { preset: "last_90_days" } }))).toMatchObject({ preset: "last_90_days" });
    expect(openingChoice(P({ kind: "range", opens_with: { low: 1, high: 5 } }))).toEqual({ kind: "range", low: 1, high: 5 });
    expect(openingChoice(P())).toBeNull();
  });
});

describe("linked filters", () => {
  const held = [chosen("country"), chosen("city", { column: "city" }), { ...chosen("x"), source: { card: "card-1", field: "x" } }];

  it("narrow by the other filters, never by themselves or by a click on a chart", () => {
    expect(narrowedBy(held, "country", P()).map(f => f.column)).toEqual(["city"]);
  });

  it("can be unlinked, and do not follow a filter held to another page", () => {
    expect(narrowedBy(held, "country", P({ linked: false }))).toEqual([]);
    expect(narrowedBy([chosen("city", { page: "two" })], "country", P(), "one")).toEqual([]);
  });
});

describe("what a card is asked with", () => {
  const country = chosen("country");
  it("follows a filter only on the page it holds to", () => {
    expect(pagesHolding(SPEC, "cb")).toEqual(new Set(["two"]));
    const paged = chosen("region", { column: "region", page: "two" });
    expect(focusOfCard(SPEC, [paged], "ca")).toEqual([]);
    expect(focusOfCard(SPEC, [paged], "cd").map(f => f.column)).toEqual(["status", "region"]);
  });

  it("leaves out a filter the card ignores, and keeps the others", () => {
    expect(focusOfCard(SPEC, [country, chosen("city", { column: "city" })], "cb").map(f => f.column)).toEqual(["city"]);
  });

  it("keeps its fixed filters even when set apart from the rest", () => {
    expect(focusOfCard(SPEC, [country], "cc")).toEqual([{ table: "orders", column: "status", op: "eq", value: "Complete" }]);
  });

  it("sends how words match, and nothing the server does not read", () => {
    const f = focusOfChoice("t", P({ kind: "text", match: "exact", case_sensitive: true }), { kind: "text", words: "Love" }) as DashboardFocus;
    const [sent] = focusOfCard({ elements: {} }, [f], "any");
    expect(sent).toEqual({ table: "users", column: "country", value: "Love", op: "contains", match: "exact", case_sensitive: true });
  });
});

describe("a link to a filtered view", () => {
  it("carries the choices in the address, and is refused when too long", () => {
    const link = filterLink([chosen("country", { values: ["São Paulo"] })], "http://x.test/?tab=dash");
    expect(new URL(link as string).searchParams.get(FILTERS_PARAM)).toBeTruthy();
    expect(new URL(link as string).searchParams.get("tab")).toBe("dash");
    expect(filterLink([chosen("c", { values: Array.from({ length: 200 }, (_, i) => `value number ${i} with some length`) })], "http://x.test/")).toBeNull();
  });
});

describe("a filter that feeds a query's value", () => {
  it("hands over what it holds, and nothing once cleared", () => {
    expect(parameterValue(chosen("c"))).toEqual(["China"]);
    expect(parameterValue(chosen("c", { op: "dates", values: undefined, low: "2026-01-01", high: "2026-02-01" }))).toBe("2026-01-01");
    expect(parameterValue(null)).toBeUndefined();
  });
});
