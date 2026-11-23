/**
 * What Discover's rows and cards say (`lib/discover.ts`), on items shaped as the live theLook read returns them
 * (2026-11-23): an Area's holdings in Discover's order, who owns it or that nobody does, a row's second line by kind,
 * the one mark a row carries, and the Ask panel subject a row can be asked about by — none for a kind the panel has
 * no subject for.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { askSubjectOf, holdsWords, markOf, ownersLine, readDiscover, secondLine, withheldWords, type DiscoverItem } from "@/lib/discover";

const item = (over: Partial<DiscoverItem>): DiscoverItem => ({
  kind: "metric", id: "x", name: "x", line: "", connection_id: "8233e4fd", connection_name: "theLook", area: "",
  area_how: "", owner: "", updated_at: "", state: "", certification: null, href: "/", detail: {}, ...over,
});

describe("what an Area holds", () => {
  it("is counted kind by kind in Discover's order, one and many said right", () => {
    expect(holdsWords({ schedule: 5, table: 3, metric: 4, dashboard: 2 })).toBe("4 metrics · 3 tables · 2 dashboards · 5 schedules");
    expect(holdsWords({ canvas: 1, sheet: 1 })).toBe("1 Data Canvas · 1 spreadsheet");
    expect(holdsWords({})).toBe("");
  });

  it("names its owners, or says nobody is recorded", () => {
    expect(ownersLine({ business_owners: ["user:ana"], technical_owners: ["bo"] })).toBe("Owned by ana · its data by bo");
    expect(ownersLine({ business_owners: [], technical_owners: [] })).toBe("No owner yet");
  });
});

describe("a row", () => {
  it("says what the thing is by its kind, and its connection only when the page spans several", () => {
    const orders = item({ kind: "table", name: "orders", detail: { rows: 124729, schema: "thelook" } });
    expect(secondLine(orders, false)).toBe("thelook · 124,729 rows");
    expect(secondLine(orders, true)).toBe("theLook · thelook · 124,729 rows");
    expect(secondLine(item({ kind: "agent", line: "" }), false)).toBe("No purpose written yet");
    expect(secondLine(item({ kind: "metric", line: "Share of orders completed" }), false)).toBe("Share of orders completed");
  });

  it("carries the organisation's word first, else its own standing where that says something", () => {
    expect(markOf(item({ certification: { status: "certified" }, state: "draft" }))).toEqual({ word: "Certified", tone: "up" });
    expect(markOf(item({ state: "deprecated" }))).toEqual({ word: "Deprecated", tone: "amber" });
    expect(markOf(item({ certification: { status: "deprecated" }, state: "approved" }))).toEqual({ word: "Deprecated", tone: "amber" });
    expect(markOf(item({ state: "off", kind: "schedule" }))).toEqual({ word: "Off", tone: "plain" });
    expect(markOf(item({ state: "approved" }))).toBeNull();
    expect(markOf(item({ state: "on", kind: "agent" }))).toBeNull();
  });

  it("is asked about by the subject the Ask panel already knows, and by none where it knows none", () => {
    expect(askSubjectOf(item({ kind: "table", name: "orders", detail: { schema: "thelook" } })))
      .toMatchObject({ kind: "table", connectionId: "8233e4fd", table: "thelook.orders" });
    expect(askSubjectOf(item({ kind: "dashboard", name: "Sales", href: "/?tab=dashboards&conn=8233e4fd&dashboard=sales" })))
      .toMatchObject({ kind: "dashboard", dashboard: "sales", title: "Sales" });
    expect(askSubjectOf(item({ kind: "dashboard", name: "Ops", href: "/?tab=dashboards&conn=8233e4fd&dashboard=shared%3Abo%3Aops" })))
      .toMatchObject({ kind: "dashboard", dashboard: "ops", owner: "bo" });
    expect(askSubjectOf(item({ kind: "sheet", id: "2973a50616", name: "Netflix titles" })))
      .toMatchObject({ kind: "sheet", connectionId: "sheets", id: "2973a50616" });
    expect(askSubjectOf(item({ kind: "metric" }))).toBeNull();
    expect(askSubjectOf(item({ kind: "agent" }))).toBeNull();
  });

  it("says what is withheld as what it is: not shared, or beyond clearance", () => {
    expect(withheldWords("canvas", 2)).toBe("2 not shared with you");
    expect(withheldWords("trusted_query", 1)).toBe("1 beyond your clearance");
    expect(withheldWords("sheet", 0)).toBe("");
  });
});

describe("reading Discover", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("asks once for a read already out or just answered, and again when told to read fresh", async () => {
    const fetch = vi.fn(async (_href: string) => new Response(JSON.stringify({ areas: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await Promise.all([readDiscover("c-once", "w"), readDiscover("c-once", "w")]);   // a strict double effect
    await readDiscover("c-once", "w");                                               // mounted again as the shell settles
    expect(fetch).toHaveBeenCalledTimes(1);
    await readDiscover("c-once", "w", true);                                         // after a change the person made
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toContain("connection_id=c-once");
    expect(String(fetch.mock.calls[0][0])).toContain("workspace_id=w");
  });
});
