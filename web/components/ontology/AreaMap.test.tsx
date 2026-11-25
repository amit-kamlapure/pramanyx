// @vitest-environment jsdom
/** The Atlas, by Area (2026-11-25, A4a): the Ontology page opens on the organisation's Areas — a bubble each, sized by
 *  the answers that drew on it; the month in the side panel; what waits, by Area; a bubble chosen, its own panel. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { AreaMap } from "@/components/ontology/AreaMap";
import type { Atlas, AtlasArea } from "@/lib/areaMap";
import { forgetDiscoverReads, type DiscoverAreaPage, type DiscoverItem } from "@/lib/discover";
import type { LearnedItem } from "@/lib/learned";
import { fireEvent, render, screen } from "@/lib/testing";

const area = (id: string, name: string, answers: number, extra: Partial<AtlasArea> = {}): AtlasArea => ({
  id, name, question: `${name}?`, icon: "cart", parent: "", business_owners: [], technical_owners: [], source: "package",
  connections: ["c1"], counts: { metric: 2, table: 3 }, total: 5, answers, review: { gap: 2, candidate: 1, conflict: 0 },
  learned: 4, ...extra,
} as AtlasArea);

const ATLAS: Atlas = {
  connections: [{ id: "c1", name: "theLook" }],
  areas: [area("orders_sales", "Orders & sales", 40), area("returns", "Returns", 0, { review: { gap: 0, candidate: 0, conflict: 0 }, learned: 0 })],
  everything_else: area("other", "Everything else", 3, { total: 76 }),
  quiet: [{ id: "promotions", name: "Promotions", question: "" }],
  suggested: [{ id: "s1", label: "Commerce", tables: ["orders"], connection_id: "c1", connection_name: "theLook" }],
  figures: { answers: 304, previous: 186, governed: 120, in_an_area: 250, window_days: 30, given_since: "2026-11-25" },
  contacts: { named: 0, of: 18 },
  most_used: [], review: { total: 801, unplaced: 534 }, learned: { total: 318, unplaced: 51 },
  read_at: "2026-11-25T10:00:00+00:00", said: [],
};

afterEach(() => { vi.unstubAllGlobals(); forgetDiscoverReads(); });

const item = (kind: DiscoverItem["kind"], id: string, name: string, extra: Partial<DiscoverItem> = {}): DiscoverItem => ({
  kind, id, name, line: "", connection_id: "c1", connection_name: "theLook", area: "orders_sales", area_how: "read from its tables",
  owner: "", updated_at: "", state: "", certification: null, href: `/x/${id}`, detail: {}, use: null, ...extra,
});

const PAGE: DiscoverAreaPage = {
  area: { ...area("orders_sales", "Orders & sales", 40), business_owners: [], technical_owners: [] },
  children: [{ ...area("returns_sub", "Refunds", 0), parent: "orders_sales", total: 2 }],
  featured: [], featured_refs: [],
  kinds: [
    { kind: "metric", title: "Metrics", count: 2, withheld: 0, states: {}, items: [
      item("metric", "c1/revenue", "Revenue", { state: "approved", detail: { unit: "USD", formula: "SUM(sale_price)" },
        use: { measured: "opens", count: 3, people: 2, unattributed: 0, last: null, answers: 12 } }),
      item("metric", "c1/aov", "Average order value", { state: "draft" })] },
    { kind: "table", title: "Tables", count: 1, withheld: 0, states: {}, items: [
      item("table", "c1.orders", "orders", { certification: { status: "certified", by: "ana" } })] },
  ],
  empty_kinds: [], can_curate: false, you: "user:me", said: [],
};

const LEARNED: LearnedItem = {
  kind: "answer", text: "Revenue counts completed orders only", source: "an answer", author: "", standing: "said",
  standing_said: "said, never measured", why: "said, never measured — no person has confirmed it", as_of: "2026-11-20",
  tables: ["orders"], lineage: [], ref: "r1", area: "orders_sales", uses: null, times: 1, also: [],
};

function serve(body: Atlas = ATLAS) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(String(url));
    if (String(url).includes("/discover/areas/")) return new Response(JSON.stringify(PAGE));
    if (String(url).includes("/learned")) {
      return new Response(JSON.stringify({ items: [LEARNED], total: 1, matched: 1, folded: 0, unplaced: 0, areas: [], withheld: null }));
    }
    return new Response(JSON.stringify(body));
  }));
  return urls;
}

describe("the Atlas, by Area", () => {
  it("draws each Area with its answers, what sits in no Area and the quiet ones apart, a suggestion dashed", async () => {
    const urls = serve();
    render(<AreaMap />);
    expect(await screen.findByTestId("atlas-bubble-orders_sales")).toHaveTextContent("Orders & sales40 answers · 5 things");
    expect(screen.getByTestId("atlas-bubble-returns")).toHaveTextContent("0 answers · 5 things");
    expect(screen.getByTestId("atlas-bubble-suggested")).toHaveTextContent("CommerceSuggested · theLook");
    expect(screen.getByTestId("atlas-everything-else")).toHaveTextContent("Everything else · 76 things in no Area · 3 answers read no placed table");
    expect(screen.getByTestId("atlas-quiet")).toHaveTextContent("1 hold nothing yet — Promotions");
    expect(urls[0]).toContain("/discover/atlas");
  });

  it("tells the month in the side panel: answers, governed reach, Area coverage, contacts", async () => {
    serve();
    render(<AreaMap />);
    expect(await screen.findByTestId("atlas-answers")).toHaveTextContent("304answers in the last 30 days that ran SQL");
    expect(screen.getByText("↑ 63% on the 30 days before (186)")).toBeTruthy();
    expect(screen.getByTestId("atlas-governed")).toHaveTextContent("39%Governed reach");
    expect(screen.getByTestId("atlas-governed")).toHaveTextContent("Definitions counted since 2026-11-25");
    expect(screen.getByTestId("atlas-coverage")).toHaveTextContent("82%Area coverage");
    expect(screen.getByTestId("atlas-contacts")).toHaveTextContent("0 of 18 Areas name a Business or Technical contact");
  });

  it("lists what waits by Area on its Review tab, and a bubble chosen becomes that Area's panel", async () => {
    serve();
    render(<AreaMap />);
    fireEvent.click(await screen.findByRole("tab", { name: "Review 801" }));
    expect(screen.getByTestId("atlas-review-total")).toHaveTextContent("801 wait for review, 534 in no Area");
    expect(screen.getAllByRole("listitem").map((r) => r.textContent)).toEqual(["Orders & sales2 gaps · 1 to confirm · 4 learned"]);
    fireEvent.click(screen.getByTestId("atlas-bubble-orders_sales"));
    expect(screen.getByTestId("atlas-area-panel")).toHaveTextContent("Orders & sales");
    expect(screen.getByTestId("atlas-area-answers")).toHaveTextContent("40 answers this month drew on it");
    expect(screen.getByRole("link", { name: "Open its page in Discover" }).getAttribute("href")).toContain("id=orders_sales");
    fireEvent.click(screen.getByRole("button", { name: /All Areas/ }));
    expect(screen.queryByTestId("atlas-area-panel")).toBeNull();
  });

  it("says when what waits is not read yet, rather than calling it none", async () => {
    serve({ ...ATLAS, review: null, learned: null, said: ["What waits for review and what was learned, by Area, is being read; it shows on the next visit."],
      areas: ATLAS.areas.map((a) => ({ ...a, review: null, learned: null })) });
    render(<AreaMap />);
    fireEvent.click(await screen.findByRole("tab", { name: "Review" }));
    expect(screen.getByText(/is being read; it shows on the next visit/)).toBeTruthy();
  });

  it("opens an Area: the canvas fans it out by kind with counts, its sub-Areas around them; the rail is the Area's", async () => {
    const urls = serve();
    render(<AreaMap />);
    fireEvent.click(await screen.findByTestId("atlas-bubble-orders_sales"));
    expect(await screen.findByTestId("atlas-fan-metric")).toHaveTextContent("2 metrics");
    expect(screen.getByTestId("atlas-fan-certified")).toHaveTextContent("1 certified");
    expect(screen.getByTestId("atlas-fan-learned")).toHaveTextContent("4 learned");
    expect(screen.getByTestId("atlas-fan-table")).toHaveTextContent("1 table");
    expect(screen.getByTestId("atlas-fan-child-returns_sub")).toHaveTextContent("Refunds2 things");
    expect(screen.getByTestId("atlas-fan-row-metric")).toHaveTextContent("2 metrics");
    expect(screen.queryByTestId("atlas-bubble-returns")).toBeNull();
    expect(urls.find((u) => u.includes("/discover/areas/orders_sales"))).toContain("by_use=true");
  });

  it("a count opens that kind's list, the most used first with its state, connection and use", async () => {
    serve();
    render(<AreaMap />);
    fireEvent.click(await screen.findByTestId("atlas-bubble-orders_sales"));
    fireEvent.click(await screen.findByTestId("atlas-fan-metric"));
    expect(screen.getAllByTestId("atlas-kind-row").map((r) => r.textContent)).toEqual([
      "RevenuetheLook · opened 3 times this month by 2 people · used in 12 answers",
      "Average order valueDraft · theLook · not used this month",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "The Area" }));
    fireEvent.click(screen.getByTestId("atlas-fan-row-certified"));
    expect(screen.getAllByTestId("atlas-kind-row").map((r) => r.textContent)).toEqual(["ordersTable · Certified · theLook · not used this month"]);
  });

  it("opening things adds tabs to the right panel, side by side; one closes", async () => {
    serve();
    render(<AreaMap />);
    fireEvent.click(await screen.findByTestId("atlas-bubble-orders_sales"));
    fireEvent.click(await screen.findByTestId("atlas-fan-metric"));
    const [revenue, aov] = screen.getAllByTestId("atlas-kind-row");
    fireEvent.click(revenue);
    expect(screen.getByTestId("atlas-open-item")).toHaveTextContent("Revenue");
    expect(screen.getByTestId("atlas-open-item")).toHaveTextContent("FormulaSUM(sale_price)");
    fireEvent.click(aov);
    expect(screen.getAllByRole("tab", { name: /Revenue|Average order value/ }).map((t) => t.textContent)).toEqual(["Revenue", "Average order value"]);
    expect(screen.getByTestId("atlas-open-item")).toHaveTextContent("Average order value");
    fireEvent.click(screen.getByRole("tab", { name: "Revenue" }));
    expect(screen.getByTestId("atlas-open-item")).toHaveTextContent("used in 12 answers");
    fireEvent.click(screen.getByRole("button", { name: "Close Revenue" }));
    expect(screen.getAllByRole("tab", { name: /Revenue|Average order value/ }).map((t) => t.textContent)).toEqual(["Average order value"]);
  });

  it("what was learned in an Area lists across its connections; one opened says where it stands, and offers Promote", async () => {
    const urls = serve();
    render(<AreaMap />);
    fireEvent.click(await screen.findByTestId("atlas-bubble-orders_sales"));
    fireEvent.click(await screen.findByTestId("atlas-fan-learned"));
    const row = await screen.findByTestId("atlas-learned-row");
    expect(row).toHaveTextContent("Revenue counts completed orders onlyFrom an answer · theLook");
    expect(urls.find((u) => u.includes("/knowledge/c1/learned"))).toContain("area=orders_sales");
    fireEvent.click(row);
    expect(screen.getByTestId("atlas-open-learned")).toHaveTextContent("Where it standssaid, never measured — no person has confirmed it");
    expect(screen.getByTestId("atlas-open-learned")).toHaveTextContent("Used in answersnot counted yet");
    fireEvent.click(screen.getByRole("button", { name: "Promote to a Definition" }));
    expect(screen.getByTestId("learned-promote")).toBeTruthy();
  });
});
