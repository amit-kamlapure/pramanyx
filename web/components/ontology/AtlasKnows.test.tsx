// @vitest-environment jsdom
/**
 * The Brain map and Org, parts of the Atlas's Overview since 2026-11-25 (the Atlas plan §7, decision 1). Ported from
 * the two pages' own tests, so what each page promised is held here: each store with a live count and its route, a
 * store that could not be read shown as a dash with its reason (never a zero), each measured link with both ends'
 * titles, the changed facts with what they replaced; the promoted findings by domain, the source named once, each
 * removable — a failed read a failed read, and an empty answer possibly a store that could not be read.
 */
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromotedFindings, WhereItLives, firstConnection } from "@/components/ontology/AtlasKnows";
import type { BrainMap } from "@/lib/api";
import { boxFigure, edgeLines, recentFacts, vaultColumns } from "@/lib/brainMap";
import { choose, fireEvent, render, screen, waitFor, within } from "@/lib/testing";

const MAP: BrainMap = {
  connection_id: "c1",
  vaults: [{ id: "company", title: "What it knows" }, { id: "engagement", title: "What it did with people" },
           { id: "working_memory", title: "What people told it" }],
  boxes: [
    { id: "facts", vault: "company", title: "Dated facts", door: "GET /graph", count: 17, unit: "facts",
      line: "17 of 17 dated · 1 changed since first seen · 0 retired, kept",
      detail: { with_history: 1, recent: [{ id: "metric:aov", kind: "metric", label: "aov", first_seen: "2026-09-23T10:00:00Z",
        last_changed: "2026-09-23T10:05:00Z", observed_at: "", observed_basis: "build",
        history: [{ replaced_at: "2026-09-23T10:05:00Z", reason: "corrected", facts: { formula_sql: "AVG(total_amount)", tables: ["orders", "items"] } }] }] } },
    { id: "visibility", vault: "company", title: "What the platform can see", door: "GET /visibility", count: null, unit: "",
      line: "Reads 4 tables — how many this connection holds is not known yet", detail: {} },
    { id: "findings", vault: "engagement", title: "Findings", door: "GET /exploration/{conn}/domains", count: 1250, unit: "findings",
      line: "1,250 across 9 domains", detail: {} },
    { id: "owners", vault: "working_memory", title: "Owners reachable", door: "GET /owners", count: 0, unit: "owners reachable",
      line: "0 of 7 named owners reachable", detail: {} },
  ],
  edges: [{ from: "findings", to: "facts", count: 3, label: "findings landed in the graph as facts" }],
};

const CONNS = [{ id: "c1", name: "theLook" }, { id: "c2", name: "LuxExperience" }];

let brain: Record<string, BrainMap | "fail"> = {};
let found: unknown[] | "fail" = [];
const calls: { url: string; method: string }[] = [];
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  brain = { c1: MAP, c2: { ...MAP, connection_id: "c2", boxes: MAP.boxes.map((b) => (b.id === "findings" ? { ...b, count: 7, line: "7 across 2 domains" } : b)) } };
  found = [];
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/brain/map")) {
      const c = new URL(url, "http://x").searchParams.get("connection_id") ?? "";
      const m = brain[c];
      return m === "fail" || !m ? new Response("{}", { status: 500 }) : ok(m);
    }
    if (url.includes("/connections")) return ok([{ id: "c1", name: "theLook" }]);
    if (url.includes("/org-intelligence")) {
      if (method === "DELETE") return ok({ ok: true });
      return found === "fail" ? new Response("{}", { status: 500 }) : ok(found);
    }
    return ok({});
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("brainMap, as the Atlas reads it", () => {
  it("groups stores by vault and reads an unknown as a dash, never a zero", () => {
    expect(vaultColumns(MAP).map((v) => [v.id, v.boxes.map((b) => b.id)])).toEqual([
      ["company", ["facts", "visibility"]], ["engagement", ["findings"]], ["working_memory", ["owners"]]]);
    expect(boxFigure(MAP.boxes[1])).toBe("—");
    expect(boxFigure(MAP.boxes[2])).toBe("1,250");
    expect(boxFigure(MAP.boxes[3])).toBe("0");
  });

  it("writes each measured link with both ends' titles, and each changed fact with what it replaced", () => {
    expect(edgeLines(MAP)).toEqual(["Findings → Dated facts: 3 findings landed in the graph as facts"]);
    expect(recentFacts(MAP)).toEqual([{ id: "metric:aov", label: "aov", kind: "metric", changed: "2026-09-23",
      replaced: "AVG(total_amount) · orders, items", reason: "corrected" }]);
  });

  it("counts the connection the page stands on first, when the Atlas holds it", () => {
    expect(firstConnection(CONNS, "c2")).toBe("c2");
    expect(firstConnection(CONNS, "gone")).toBe("c1");
    expect(firstConnection([], "c2")).toBe("");
  });
});

describe("where what it knows lives, on the Atlas's Overview", () => {
  it("lists every store with its count and route, says why one has no number, and each link in words", async () => {
    render(<WhereItLives connections={CONNS} standing="c1" />);
    const visibility = await screen.findByTestId("atlas-store-visibility");
    expect(visibility.textContent).toContain("how many this connection holds is not known yet");
    expect(visibility.textContent).toContain("—");
    // the route rides the store's hover, never its face
    expect(screen.getByTestId("atlas-store-facts").getAttribute("title")).toBe("GET /graph");
    expect(screen.getByTestId("atlas-store-facts").textContent).not.toContain("GET /graph");
    expect(screen.getByTestId("atlas-store-findings").textContent).toContain("1,250");
    expect(screen.getAllByRole("list").map((l) => l.getAttribute("aria-label")))
      .toEqual(["What it knows", "What it did with people", "What people told it", "Measured links"]);
    expect(screen.getByTestId("atlas-store-links").textContent).toContain("Findings → Dated facts: 3 findings landed in the graph as facts");
    expect(screen.getByTestId("atlas-fact-metric:aov").textContent).toContain("was AVG(total_amount)");
  });

  it("counts another connection when one is chosen", async () => {
    render(<WhereItLives connections={CONNS} standing="c1" />);
    await screen.findByTestId("atlas-store-findings");
    await choose(screen.getByRole("combobox", { name: "The connection its stores are counted on" }), "c2");
    await waitFor(() => expect(screen.getByTestId("atlas-store-findings").textContent).toContain("7 across 2 domains"));
    expect(calls.filter((c) => c.url.includes("/brain/map")).at(-1)?.url).toContain("connection_id=c2");
  });

  it("says a failed read and reads again on Retry — never an empty list", async () => {
    brain.c1 = "fail";
    render(<WhereItLives connections={CONNS} standing="c1" />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("theLook's stores"));
    expect(screen.queryByTestId("atlas-store-facts")).toBeNull();
    brain.c1 = MAP;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("atlas-store-facts")).toBeTruthy();
  });

  it("says the fact history was not read when the facts store could not be read, rather than that nothing changed", async () => {
    brain.c1 = { ...MAP, boxes: MAP.boxes.map((b) => (b.id === "facts" ? { ...b, count: null, detail: {}, line: "could not be read (OSError)" } : b)) };
    render(<WhereItLives connections={CONNS} standing="c1" />);
    await waitFor(() => expect(screen.getByTestId("atlas-changed-facts").textContent).toContain("Fact history not read — could not be read (OSError)"));
    expect(screen.getByTestId("atlas-changed-facts").textContent).not.toContain("No fact has changed");
  });

  it("shows the newest few changed facts, and all of them on Show all", async () => {
    const recent = Array.from({ length: 8 }, (_, i) => ({ id: `metric:m${i}`, kind: "metric", label: `m${i}`, first_seen: "",
      last_changed: "2026-11-20T10:00:00Z", observed_at: "", observed_basis: "build", history: [{ replaced_at: "", reason: "changed", summary: "old" }] }));
    brain.c1 = { ...MAP, boxes: MAP.boxes.map((b) => (b.id === "facts" ? { ...b, detail: { with_history: 93, recent } } : b)) };
    render(<WhereItLives connections={CONNS} standing="c1" />);
    await screen.findByTestId("atlas-fact-metric:m0");
    expect(screen.getByTestId("atlas-changed-facts").textContent).toContain("newest 8 of 93");
    expect(screen.queryByTestId("atlas-fact-metric:m5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 8" }));
    expect(screen.getByTestId("atlas-fact-metric:m7")).toBeTruthy();
  });
});

const finding = (id: string, domain: string, text: string, at: string) => ({
  id, insight_id: `f${id}`, canvas_id: "conn:c1", connection_id: "c1", schema: "s", text, domain, angle: "retention",
  novelty: 4, promoted_by: "user", promoted_at: at,
});

describe("promoted to the organisation, on the Atlas's Overview", () => {
  it("lists findings under their domain, the source named once, each removable", async () => {
    found = [
      finding("1", "Customers", "Repeat buyers spend more in their second month.", "2026-10-11T08:00:00Z"),
      finding("2", "Returns", "Outerwear returns run at 3x the average.", "2026-10-09T08:00:00Z"),
      finding("3", "Customers", "Search converts better than Organic.", "2026-10-02T08:00:00Z"),
    ];
    const user = userEvent.setup();
    render(<PromotedFindings />);
    const domains = await screen.findAllByTestId("atlas-promoted-domain");
    expect(domains.map((d) => d.getAttribute("aria-label"))).toEqual(["Customers", "Returns"]);
    expect(within(domains[0]).getAllByTestId("atlas-promoted-finding")).toHaveLength(2);
    // every finding came from one connection: the sentence names it, no line repeats it, no id shows
    await waitFor(() => expect(screen.getByText(/promoted from theLook's Briefing/)).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/from theLook ·|conn:c1|canvas/);
    expect(screen.getByText(/Every deep analysis is handed the five closest to its question/)).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "Filter promoted findings" }), "outerwear");
    expect(screen.getAllByTestId("atlas-promoted-finding")).toHaveLength(1);
    expect(screen.getByText("1 of 3")).toBeTruthy();
    await user.clear(screen.getByRole("textbox", { name: "Filter promoted findings" }));

    await user.click(within(screen.getAllByTestId("atlas-promoted-domain")[1]).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/org-intelligence/2"))).toBe(true));
    await waitFor(() => expect(screen.queryByText("Outerwear returns run at 3x the average.")).toBeNull());
  });

  it("says an empty answer may be a store that could not be read, and how a finding is promoted", async () => {
    render(<PromotedFindings />);
    const empty = await screen.findByTestId("atlas-promoted-empty");
    expect(empty.textContent).toContain("Nothing promoted yet");
    expect(empty.textContent).toContain("or its store could not be read");
    expect(empty.textContent).toContain("choose Promote");
  });

  it("shows a failed read as failed, with Retry — never as nothing promoted", async () => {
    found = "fail";
    const user = userEvent.setup();
    render(<PromotedFindings />);
    await screen.findByText(/Could not read the promoted findings/);
    expect(screen.queryByTestId("atlas-promoted-empty")).toBeNull();
    found = [finding("1", "Customers", "Repeat buyers spend more in their second month.", "2026-10-11T08:00:00Z")];
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Repeat buyers spend more in their second month.")).toBeTruthy();
  });
});
