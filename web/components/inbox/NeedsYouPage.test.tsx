// @vitest-environment jsdom
/**
 * The Inbox — Needs you (the Atlas plan's §7.8, decision 2; 2026-11-26): the lanes with what the person has not opened,
 * each lane's rows as Discover's rows, a row opened in a tab of the side panel and marked read, a review row settled
 * there by the door it names — Confirm, Mark it wrong, Write its Definition, Not now.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/RecommendationInbox", () => ({ RecommendationInbox: () => <div data-testid="recommendations-stub" /> }));
vi.mock("@/components/definitions/DefinitionView", () => ({
  DefinitionView: ({ term, newTerm }: { term: string; newTerm?: string }) => <div data-testid="definition-stub">{term || `new:${newTerm}`}</div>,
}));
vi.mock("@/components/ProposalCard", () => ({ ProposalCardById: ({ proposalId }: { proposalId: string }) => <div data-testid="proposal-stub">{proposalId}</div> }));

import { NeedsYouPage } from "@/components/inbox/NeedsYouPage";
import { InspectorHost, InspectorProvider } from "@/components/shell/Inspector";
import { PageChromeProvider } from "@/components/shell/PageChrome";
import type { NeedsYou } from "@/lib/needsYou";
import { fireEvent, render, screen, waitFor, within } from "@/lib/testing";

const VIEW: NeedsYou = {
  person: "user:ana", badge: 3, said: [],
  lanes: [
    { id: "decide", title: "To decide", count: 2, unread: 1, not_read: [], rows: [
      { source: "kinetic_inbox", id: "p1", title: "send_report: the weekly report", connection_id: "c1", connection_name: "theLook",
        since: "2026-11-25T10:00:00Z", waiting_ms: 3_600_000 * 5, resolve: {}, lane: "decide", key: "kinetic_inbox:p1", read: false },
      { source: "paused_run", id: "inv1", title: "Why did revenue fall?", connection_id: "c1", connection_name: "theLook",
        since: null, waiting_ms: null, resolve: {}, lane: "decide", key: "paused_run:inv1", read: true },
    ] },
    { id: "alerts", title: "Alerts", count: 1, unread: 1, not_read: [], rows: [
      { source: "monitor_alert", id: "a1", title: "Revenue watch: dropped 12%", connection_id: "c1", connection_name: "theLook",
        since: null, waiting_ms: 60_000, severity: "critical", resolve: { monitor_id: "m1" }, lane: "alerts", key: "monitor_alert:a1", read: false },
    ] },
    { id: "review", title: "Knowledge review", count: 3, unread: 3, mine: 2, mine_unread: 1, unplaced: 1, read_at: null, not_read: [],
      areas: [
        { id: "marketing", name: "Marketing", icon: "", count: 1, unread: 1, mine: false },
        { id: "orders_sales", name: "Orders & sales", icon: "cart", count: 2, unread: 1, mine: true },
      ] },
  ],
};

const REVIEW = {
  area: "orders_sales", within: [], total: 2, set_aside: 1, read_at: null, said: [], by_source: {},
  items: [
    { id: "finding:clm1", source: "finding", kind: "candidate", title: "Repeat buyers spend more", detail: "Measured by a run.",
      area: "orders_sales", count: null, complaints: 0, at: "", connection_id: "c1", connection_name: "theLook",
      resolve: { href: "/?tab=record", action: "Confirm it, or mark it wrong" },
      actions: [{ do: "accept", label: "Confirm it", call: { method: "POST", path: "/record/claims/clm1/right", body: {} } },
                { do: "reject", label: "Mark it wrong", call: { method: "POST", path: "/record/claims/clm1/wrong", body: { why: "x" } } }] },
    { id: "new_definition:r1", source: "new_definition", kind: "candidate", title: "“Repeat buyer” — learned 3 times", detail: "",
      area: "orders_sales", count: 3, complaints: 0, at: "", connection_id: "c1", connection_name: "theLook",
      resolve: { href: "/?tab=semantic", action: "Write its Definition" },
      actions: [{ do: "edit", label: "Write its Definition", open: { new_definition: { connection: "c1", term: "Repeat buyer", area: "orders_sales" } } }] },
  ],
};

function serve() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("/needs-you/read")) return new Response(JSON.stringify({ marked: 1, read: 1 }));
    if (url.includes("/needs-you")) return new Response(JSON.stringify(VIEW));
    if (url.includes("/discover/atlas/review")) return new Response(JSON.stringify(REVIEW));
    if (url.includes("/record/set-aside")) return new Response(JSON.stringify({ item_kind: "review" }), { status: 201 });
    if (url.includes("/record/claims/")) return new Response(JSON.stringify({}), { status: 201 });
    return new Response(JSON.stringify({}));
  }));
  return calls;
}

function shell() {
  return render(
    <PageChromeProvider pageKey="p">
      <InspectorProvider pageKey="p"><NeedsYouPage workspaceId="default" /><InspectorHost /></InspectorProvider>
    </PageChromeProvider>,
  );
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("the Inbox: what waits on you", () => {
  it("lists its lanes with what you have not opened, and a lane's rows as Discover's rows, unread in bold", async () => {
    serve();
    shell();
    const lanes = await screen.findByRole("tablist", { name: "Lanes" });
    expect(within(lanes).getAllByRole("tab").map((t) => t.textContent)).toEqual(["To decide1", "Alerts1", "Recommendations",
      "Knowledge review1"]);
    expect(screen.getAllByTestId("needs-row").map((r) => r.textContent)).toEqual([
      "send_report: the weekly reportStaged change · theLook · waiting 5 h",
      "Why did revenue fall?Paused deep analysis · theLook",
    ]);
    expect(screen.getByTestId("needs-card-decide")).toHaveTextContent("2 waiting · 1 not opened");
    fireEvent.click(screen.getByTestId("needs-lane-recommendations"));
    expect(screen.getByTestId("recommendations-stub")).toBeTruthy();       // the recommendations keep their own page, whole
  });

  it("opens a row in a tab of the side panel and marks it read for you", async () => {
    const calls = serve();
    shell();
    const [first] = await screen.findAllByTestId("needs-row");
    fireEvent.click(first.querySelector("a")!);
    expect(screen.getByRole("complementary", { name: "Inspector: send_report: the weekly report" })).toBeTruthy();
    expect(screen.getByTestId("proposal-stub")).toHaveTextContent("p1");    // the approval card, Accept and Reject on it
    await waitFor(() => expect(calls.some((c) => c.url.includes("/needs-you/read") && JSON.stringify(c.body) === '{"keys":["kinetic_inbox:p1"],"read":true}')).toBe(true));
    expect(within(screen.getByRole("tablist", { name: "Lanes" })).getByRole("tab", { name: /To decide/ })).toHaveTextContent("To decide2");
  });

  it("an alert opens with Acknowledge; a lane is marked read at once", async () => {
    const calls = serve();
    shell();
    fireEvent.click(await screen.findByTestId("needs-lane-alerts"));
    expect(screen.getByTestId("needs-row")).toHaveTextContent("critical");
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/needs-you/read") && JSON.stringify(c.body).includes("monitor_alert:a1"))).toBe(true));
    fireEvent.click(screen.getByTestId("needs-row").querySelector("a")!);
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeTruthy();
  });

  it("reviews an Area's rows: each opens 'For review' with the doors that settle it, and Not now", async () => {
    const calls = serve();
    shell();
    fireEvent.click(await screen.findByTestId("needs-lane-review"));
    expect(screen.getByTestId("needs-review-summary")).toHaveTextContent("2 are in the Areas you answer for — 1 not opened.");
    const areas = screen.getAllByTestId(/^needs-area-/).map((a) => a.textContent);
    expect(areas).toEqual(["Orders & sales2", "Marketing1"]);                 // yours first
    fireEvent.click(screen.getByTestId("needs-area-orders_sales"));
    const rows = await screen.findAllByTestId("needs-review-row");
    expect(screen.getByTestId("needs-review-rows")).toHaveTextContent("2 waiting · 1 set aside");
    fireEvent.click(rows[0].querySelector("a")!);
    const banner = screen.getByRole("region", { name: "For review" });
    expect(banner).toHaveTextContent("For review: To confirm");
    expect(within(banner).getAllByRole("button").map((b) => b.textContent)).toEqual(["Confirm it", "Mark it wrong", "Not now"]);
    fireEvent.click(within(banner).getByRole("button", { name: "Confirm it" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/record/claims/clm1/right"))).toBe(true));
    // the next: write its Definition — the Definition's own page opens as a tab of its own, its word filled in
    fireEvent.click(screen.getAllByTestId("needs-review-row")[1].querySelector("a")!);
    fireEvent.click(within(screen.getByRole("region", { name: "For review" })).getByRole("button", { name: "Write its Definition" }));
    expect(await screen.findByTestId("definition-stub")).toHaveTextContent("new:Repeat buyer");
    fireEvent.click(within(screen.getByRole("tablist", { name: "Open in the side panel" })).getByRole("tab", { name: /learned 3 times/ }));
    fireEvent.click(within(screen.getByRole("region", { name: "For review" })).getByRole("button", { name: "Not now" }));
    await waitFor(() => {
      const aside = calls.find((c) => c.url.includes("/record/set-aside"));
      expect(aside?.body).toMatchObject({ kind: "review", ref: "c1:new_definition:r1" });
    });
  });
});
