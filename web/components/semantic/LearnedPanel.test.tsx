// @vitest-environment jsdom
/** The Learned page (2026-11-25, A3): what the platform picked up, in the one order with why, narrowed by Area — or to
 *  what sits in none — and Promote, which drafts a Definition in the person's own name, saying where it came from. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { LearnedPanel } from "@/components/semantic/LearnedPanel";
import { wordOf, whereFrom, type Learned, type LearnedItem } from "@/lib/learned";
import { choose, fireEvent, render, screen, waitFor } from "@/lib/testing";

const ITEM: LearnedItem = {
  kind: "answer", text: "Monthly revenue baseline (Jan 2025–May 2026): revenue rose 8.9% in May.", source: "an answer",
  author: "system", standing: "measured", standing_said: "measured by a run", why: "measured by a run · as of 2026-11-24",
  as_of: "2026-11-24", tables: ["order_items"], lineage: ["run:67156c0d"], ref: "c1", area: "orders_sales", uses: null,
  times: 2, also: ["c9"],
};
const TQ: LearnedItem = { ...ITEM, kind: "trusted_query", text: "Revenue by month", ref: "tq1", area: "", tables: [],
  lineage: [], why: "approved as a trusted query · used in 3 answers this month", uses: 3, times: 1 };
const LEARNED: Learned = { items: [ITEM, TQ], total: 2, matched: 2, folded: 1, unplaced: 1, withheld: null,
  areas: [{ id: "orders_sales", name: "Orders & sales", count: 1 }, { id: "returns", name: "Returns", count: 0 }] };

function serve(defined: Record<string, unknown> = { suggested: null }) {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method ?? "GET"), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify(String(url).includes("/record/definitions") ? defined : LEARNED), { status: String(url).includes("/record/definitions") ? 201 : 200 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("the Learned page", () => {
  it("says what there is, why each stands where it does, and narrows to what sits in no Area", async () => {
    const calls = serve();
    render(<LearnedPanel connId="c1" />);
    expect(await screen.findByTestId("learned-summary")).toHaveTextContent("2 things learned · 1 in an Area, 1 in none · 1 repeat folded in");
    expect(screen.getAllByTestId("learned-why").map((e) => e.textContent)).toEqual([ITEM.why, TQ.why]);
    expect(screen.getAllByTestId("learned-row")[0]).toHaveTextContent("read order_items · Orders & sales · booked 2 times");
    await choose(screen.getByLabelText("Area"), "none");
    await waitFor(() => expect(calls.some((c) => c.url.includes("area=none"))).toBe(true));
  });

  it("promotes an item to a draft Definition in the person's name, saying where it came from — never a trusted query", async () => {
    const calls = serve();
    render(<LearnedPanel connId="c1" />);
    await screen.findByTestId("learned-summary");
    expect(screen.getAllByRole("button", { name: "Promote" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    expect(screen.getByLabelText("The word")).toHaveValue("Monthly revenue baseline");
    fireEvent.click(screen.getByRole("button", { name: "Save the draft" }));
    expect(await screen.findByTestId("learned-promoted")).toHaveTextContent("Drafted as “Monthly revenue baseline”. Open it");
    const sent = calls.find((c) => c.url.includes("/record/definitions"))!;
    expect(sent.method).toBe("POST");
    expect(sent.body).toEqual(expect.objectContaining({ connection_id: "c1", term: "Monthly revenue baseline", area: "orders_sales",
      links: [{ kind: "table", ref: "order_items", label: "order_items" }] }));
    expect(String(sent.body.text)).toContain("Where this comes from: learned from an answer, over order_items — measured by a run");
    expect(screen.getByRole("link", { name: "Open it" }).getAttribute("href")).toContain("definition=Monthly+revenue+baseline");
  });

  it("says when the word is someone else's: a suggested edit for its owner", async () => {
    serve({ suggested: { id: "s1" } });
    render(<LearnedPanel connId="c1" />);
    await screen.findByTestId("learned-summary");
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    fireEvent.click(screen.getByRole("button", { name: "Save the draft" }));
    expect(await screen.findByTestId("learned-promoted")).toHaveTextContent("already defined — filed as a suggested edit for its owner");
  });
});

describe("the words of a Promote", () => {
  it("guesses the word from what an item says, and says where it came from", () => {
    expect(wordOf("Order counts by status")).toBe("Order counts by status");
    expect(wordOf("Restated: revenue for Korea is now 2: was 1")).toBe("revenue for Korea is now 2");
    expect(wordOf("The overall return rate across all order items is 9.9% this year.")).toBe("The overall return rate across all");
    expect(whereFrom(ITEM)).toBe("Where this comes from: learned from an answer, over order_items — measured by a run · as of 2026-11-24 (receipt 67156c0d).");
  });
});
