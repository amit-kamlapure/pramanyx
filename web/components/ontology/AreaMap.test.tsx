// @vitest-environment jsdom
/** The Atlas, by Area (2026-11-25, A4a): the Ontology page opens on the organisation's Areas — a bubble each, sized by
 *  the answers that drew on it; the month in the side panel; what waits, by Area; a bubble chosen, its own panel. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { AreaMap } from "@/components/ontology/AreaMap";
import type { Atlas, AtlasArea } from "@/lib/areaMap";
import { forgetDiscoverReads } from "@/lib/discover";
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

function serve(body: Atlas = ATLAS) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { urls.push(String(url)); return new Response(JSON.stringify(body)); }));
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
});
