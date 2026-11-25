// @vitest-environment jsdom
/** The Atlas, by Area (2026-11-25, A4a): the Ontology page opens on the organisation's Areas — a bubble each, sized by
 *  the answers that drew on it; the month in the side panel; what waits, by Area; a bubble chosen, its own panel. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { AreaMap } from "@/components/ontology/AreaMap";
import type { Atlas, AtlasArea } from "@/lib/areaMap";
import { forgetDiscoverReads, type AtlasReview, type DiscoverAreaPage, type DiscoverItem, type ReviewRow } from "@/lib/discover";
import type { LearnedItem } from "@/lib/learned";
import { InspectorHost, InspectorProvider } from "@/components/shell/Inspector";
import { PageChromeProvider } from "@/components/shell/PageChrome";
import { act, fireEvent, render, screen, within } from "@/lib/testing";
import { setActiveWorkspace } from "@/lib/workspace";

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

const waiting = (id: string, source: string, kind: ReviewRow["kind"], title: string, extra: Partial<ReviewRow> = {}): ReviewRow => ({
  id, source, kind, title, detail: "", area: "orders_sales", count: null, complaints: 0, at: "", connection_id: "c1",
  connection_name: "theLook", resolve: { href: `/?tab=semantic&id=${id}`, action: "Decide it" }, ...extra,
});

const REVIEW: AtlasReview = {
  area: "orders_sales", within: ["returns_sub"], total: 3, read_at: "2026-11-25T10:00:00+00:00", said: [],
  by_source: { framing_miss: 1, new_definition: 1, rival_meanings: 1 },
  items: [
    waiting("g1", "framing_miss", "gap", "What is a repeat buyer?", { count: 12, resolve: { href: "/?tab=semantic", action: "Define it" } }),
    waiting("n1", "new_definition", "candidate", "“Repeat buyer” — learned 3 times; no Definition says what it means", { count: 3 }),
    waiting("c1", "rival_meanings", "conflict", "“Active customer” means two things", { complaints: 2 }),
  ],
};

function serve(body: Atlas = ATLAS, many?: DiscoverItem[]) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(String(url));
    if (String(url).includes("/discover/atlas/review")) return new Response(JSON.stringify(REVIEW));
    // the Overview's stores (the Brain map) and promoted findings (Org) — `AtlasKnows.test.tsx` holds what they show
    if (String(url).includes("/brain/map")) return new Response(JSON.stringify({ connection_id: "c1", vaults: [], boxes: [], edges: [] }));
    if (String(url).includes("/org-intelligence")) return new Response(JSON.stringify([]));
    if (String(url).includes("/connections")) return new Response(JSON.stringify([]));
    if (String(url).includes("/discover/areas/")) return new Response(JSON.stringify(PAGE));
    if (String(url).includes("/discover/items")) {
      // the server's paged list of a kind in an Area (`discover/service.list_items`), as many as `many` asks for
      const q = new URL(String(url), "http://x").searchParams;
      const all = (many ?? PAGE.kinds.flatMap((k) => k.items)).filter((i) =>
        (!q.get("kind") || i.kind === q.get("kind")) && (!q.get("area") || i.area === q.get("area"))
        && (q.get("certified") !== "true" || i.certification?.status === "certified"));
      const at = Number(q.get("cursor") ?? 0), n = Number(q.get("limit") ?? 50);
      return new Response(JSON.stringify({ items: all.slice(at, at + n), total: all.length, next_cursor: at + n < all.length ? at + n : null,
        withheld: {}, said: [] }));
    }
    if (String(url).includes("/discover/search")) {
      const q = new URL(String(url), "http://x").searchParams.get("q") ?? "";
      const hit = PAGE.kinds.flatMap((k) => k.items).filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
      return new Response(JSON.stringify({ items: hit, total: hit.length, by_meaning: false, withheld: {}, said: [] }));
    }
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

  it("holds, on its Overview, where what the platform knows lives and what was promoted — once pages of their own", async () => {
    const urls = serve();
    render(<AreaMap connectionId="c1" />);
    expect(await screen.findByTestId("atlas-stores")).toHaveTextContent("Where what it knows lives");
    expect(await screen.findByTestId("atlas-promoted-empty")).toHaveTextContent("Nothing promoted yet");
    await vi.waitFor(() => expect(urls.find((u) => u.includes("/brain/map"))).toContain("connection_id=c1"));
  });

  it("lists what waits by Area on its Review tab, and a bubble chosen becomes that Area's panel", async () => {
    serve();
    render(<AreaMap />);
    fireEvent.click(await screen.findByRole("tab", { name: "Review 801" }));
    expect(screen.getByTestId("atlas-review-total")).toHaveTextContent("801 wait for review, 534 in no Area");
    expect(screen.getAllByRole("listitem").map((r) => r.textContent)).toEqual([
      "In no Area534 wait, placed in no Area", "Orders & sales2 gaps · 1 to confirm · 4 learned"]);
    fireEvent.click(screen.getByTestId("atlas-bubble-orders_sales"));
    expect(screen.getByTestId("atlas-area-panel")).toHaveTextContent("Orders & sales");
    expect(screen.getByTestId("atlas-area-answers")).toHaveTextContent("40 answers this month drew on it");
    expect(screen.getByRole("link", { name: "Open its page in Discover" }).getAttribute("href")).toContain("id=orders_sales");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Where you are" })).getByRole("button", { name: "Ontology" }));
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
    // the reference's rows: the name, how much it was used and its mark, what it says
    expect((await screen.findAllByTestId("atlas-kind-row")).map((r) => r.textContent)).toEqual([
      "RevenueUsed in 12 answers · theLook",
      "Average order valueNot used this month · theLookDraft",
    ]);
    expect(screen.getByTestId("atlas-kind-count")).toHaveTextContent("2 metrics");
    // where the reader is, each place a way back
    const trail = screen.getByRole("navigation", { name: "Where you are" });
    expect(trail.textContent).toBe("OntologyOrders & salesMetrics");
    fireEvent.click(within(trail).getByRole("button", { name: "Orders & sales" }));
    fireEvent.click(screen.getByTestId("atlas-fan-row-certified"));
    expect((await screen.findAllByTestId("atlas-kind-row")).map((r) => r.textContent)).toEqual(["ordersNot used this month · theLookCertified"]);
  });

  it("lets the reader widen or narrow the left panel, and keeps the width they chose", async () => {
    window.localStorage.removeItem("pramanyx_areas_rail_width");
    serve();
    const { unmount } = render(<AreaMap />);
    const grip = await screen.findByRole("separator", { name: "Resize the left panel" });
    expect(grip).toHaveAttribute("aria-valuenow", "360");
    fireEvent.keyDown(grip, { key: "ArrowRight" });
    fireEvent.keyDown(grip, { key: "ArrowRight" });
    expect(grip).toHaveAttribute("aria-valuenow", "392");
    fireEvent.keyDown(grip, { key: "ArrowLeft" });
    expect(grip).toHaveAttribute("aria-valuenow", "376");
    unmount();
    render(<AreaMap />);
    expect(await screen.findByRole("separator", { name: "Resize the left panel" })).toHaveAttribute("aria-valuenow", "376");
    window.localStorage.removeItem("pramanyx_areas_rail_width");
  });

  it("lists a long kind a page at a time, in the order asked for", async () => {
    const many = Array.from({ length: 45 }, (_, n) => item("metric", `c1/m${n}`, `Metric ${n}`));
    const urls = serve(ATLAS, many);
    render(<AreaMap />);
    fireEvent.click(await screen.findByTestId("atlas-bubble-orders_sales"));
    fireEvent.click(await screen.findByTestId("atlas-fan-metric"));
    expect(await screen.findAllByTestId("atlas-kind-row")).toHaveLength(20);
    expect(screen.getByTestId("atlas-kind-count")).toHaveTextContent("45 metrics");
    fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
    await vi.waitFor(() => expect(screen.getAllByTestId("atlas-kind-row")).toHaveLength(5));
    expect(screen.getAllByTestId("atlas-kind-row")[0]).toHaveTextContent("Metric 40");
    const listed = urls.filter((u) => u.includes("/discover/items"));
    expect(listed[0]).toContain("sort=use");
    expect(listed.at(-1)).toContain("cursor=40");
    fireEvent.keyDown(screen.getByRole("button", { name: "In order: Most used" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Name" }));
    await vi.waitFor(() => expect(urls.filter((u) => u.includes("/discover/items")).at(-1)).toContain("sort=name"));
    expect(urls.filter((u) => u.includes("/discover/items")).at(-1)).toContain("cursor=0");    // a new order starts at its first page
  });

  it("searches what is in view from the head of the left panel; a thing found opens on the right", async () => {
    serve();
    render(<AreaMap />);
    fireEvent.click(await screen.findByRole("button", { name: "Search every Area" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search every Area" }), { target: { value: "revenue" } });
    await vi.waitFor(() => expect(screen.getByTestId("atlas-search")).toHaveTextContent("1 found in every Area"));
    fireEvent.click(screen.getByTestId("atlas-kind-row"));
    expect(screen.getByTestId("atlas-open-item")).toHaveTextContent("Revenue");
    fireEvent.click(screen.getByRole("button", { name: "Stop searching" }));
    expect(screen.queryByTestId("atlas-search")).toBeNull();
  });

  it("inside the app, a thing opens as a tab of the one side panel — a page of its own, with its glyph", async () => {
    serve();
    render(
      <PageChromeProvider pageKey="p"><InspectorProvider pageKey="p"><AreaMap /><InspectorHost /></InspectorProvider></PageChromeProvider>,
    );
    fireEvent.click(await screen.findByTestId("atlas-bubble-orders_sales"));
    fireEvent.click(await screen.findByTestId("atlas-fan-metric"));
    fireEvent.click((await screen.findAllByTestId("atlas-kind-row"))[0]);
    expect(screen.queryByTestId("atlas-open-panel")).toBeNull();                       // no second panel of the Areas' own
    const open = screen.getByRole("tablist", { name: "Open in the side panel" });
    expect(within(open).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Orders & sales", "Revenue"]);
    expect(screen.getByRole("complementary", { name: "Inspector: Revenue" })).toHaveTextContent("FormulaSUM(sale_price)");
  });

  it("opening things adds tabs to the right panel, side by side; one closes", async () => {
    serve();
    render(<AreaMap />);
    fireEvent.click(await screen.findByTestId("atlas-bubble-orders_sales"));
    fireEvent.click(await screen.findByTestId("atlas-fan-metric"));
    const [revenue, aov] = await screen.findAllByTestId("atlas-kind-row");
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
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    expect(screen.getByTestId("learned-promote")).toBeTruthy();
  });

  it("an Area's Review lists what waits in it and its sub-Areas, in the plan's words, each with its door", async () => {
    const urls = serve();
    render(<AreaMap />);
    fireEvent.click(await screen.findByTestId("atlas-bubble-orders_sales"));
    fireEvent.click(await screen.findByTestId("atlas-area-review"));
    expect(await screen.findByTestId("atlas-review-list")).toHaveTextContent("3 wait for review");
    expect(screen.getByTestId("atlas-review-list")).toHaveTextContent("with its 1 sub-Area · across its connections");
    expect(screen.getAllByTestId("atlas-review-row").map((r) => r.textContent?.split("theLook")[0])).toEqual([
      "GapWhat is a repeat buyer?", "New Definition“Repeat buyer” — learned 3 times; no Definition says what it means",
      "Conflict“Active customer” means two things"]);
    expect(screen.getAllByTestId("atlas-review-row")[0]).toHaveTextContent("theLook · asked 12 times");
    expect(screen.getAllByTestId("atlas-review-row")[2]).toHaveTextContent("2 complaints");
    expect(screen.getByRole("button", { name: "Define it" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Conflict 1" }));
    expect(screen.getAllByTestId("atlas-review-row")).toHaveLength(1);
    expect(urls.find((u) => u.includes("/discover/atlas/review"))).toContain("area=orders_sales");
  });

  it("the Review tab opens an Area straight to its review, and lists what waits in no Area", async () => {
    const urls = serve();
    render(<AreaMap />);
    fireEvent.click(await screen.findByRole("tab", { name: "Review 801" }));
    fireEvent.click(screen.getByTestId("atlas-review-unplaced"));
    expect(await screen.findByTestId("atlas-review-list")).toHaveTextContent("for review in no Area");
    expect(urls.some((u) => u.includes("/discover/atlas/review") && u.includes("area=none"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "By Area" }));
    fireEvent.click(screen.getAllByRole("listitem").find((r) => r.textContent?.startsWith("Orders & sales"))!);
    expect(await screen.findByTestId("atlas-area-panel")).toHaveTextContent("Orders & sales");
    expect(await screen.findByTestId("atlas-review-list")).toHaveTextContent("3 wait for review");
  });

  it("a circle clicked opens that Area and its tab on the right; a sub-Area opens beside its parent, to one side", async () => {
    serve();
    render(<AreaMap />);
    fireEvent.click(await screen.findByTestId("atlas-bubble-orders_sales"));
    expect(await screen.findByTestId("atlas-open-area")).toHaveTextContent("Orders & sales");
    expect(screen.getByTestId("atlas-open-area")).toHaveTextContent("This month40 answers drew on it");
    fireEvent.click(await screen.findByTestId("atlas-fan-child-returns_sub"));
    expect(await screen.findByTestId("atlas-fan-parent")).toHaveTextContent("Orders & sales");
    expect(screen.getByTestId("atlas-fan-centre")).toHaveTextContent("Refunds");
    expect(screen.getAllByRole("tab", { name: /Orders & sales|Refunds/ }).map((t) => t.textContent)).toEqual(["Orders & sales", "Refunds"]);
    expect(screen.getByTestId("atlas-open-area")).toHaveTextContent("Refunds");
  });

  it("reads the map again for a workspace chosen after it read, and closes what the other workspace had open", async () => {
    const urls = serve();
    const atlasReads = () => urls.filter((u) => u.includes("/discover/atlas") && !u.includes("/review"));
    render(<AreaMap />);
    fireEvent.click(await screen.findByTestId("atlas-bubble-orders_sales"));
    expect(await screen.findByTestId("atlas-open-area")).toHaveTextContent("Orders & sales");
    expect(atlasReads()).toHaveLength(1);
    act(() => setActiveWorkspace("lux"));
    try {
      expect(await screen.findByTestId("atlas-bubble-orders_sales")).toBeTruthy();
      expect(screen.queryByTestId("atlas-open-area")).toBeNull();
      expect(atlasReads()).toHaveLength(2);
      expect(atlasReads()[1]).toContain("workspace_id=lux");
    } finally {
      act(() => setActiveWorkspace(""));
    }
  });
});

