// @vitest-environment jsdom
/**
 * An Area's curation on its Discover page (the plan's D4, the user's call 2026-11-23): its curators edit its description,
 * owners and what it features in place, add anything Discover lists, and feature or take out a row; a thing's own owner
 * may take out what they placed; anyone else is offered nothing. The API is stubbed; what is sent is what is checked.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AddToArea, AreaEditor, RowMenu } from "@/components/discover/AreaCuration";
import { declarationsOf, type BusinessArea } from "@/lib/areas";
import type { DiscoverAreaPage, DiscoverItem } from "@/lib/discover";
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { measureNothing, writeIn } from "@/components/ui/richTextTesting";

const item = (over: Partial<DiscoverItem>): DiscoverItem => ({
  kind: "canvas", id: "cv1", name: "Returns desk", line: "", connection_id: "c1", connection_name: "theLook", area: "returns",
  area_how: "ana placed it here", owner: "user:ana", updated_at: "", state: "", certification: null, href: "/?tab=canvas-workspace&canvas=cv1",
  detail: {}, placed: true, ...over,
});
const RATE = item({ kind: "metric", id: "c1/return_rate", name: "Return rate", owner: "", placed: false, area_how: "read from its tables" });
const DESK = item({});

const page = (over: Partial<DiscoverAreaPage> = {}): DiscoverAreaPage => ({
  area: { id: "returns", name: "Returns", question: "What came back?", description: "Sent back, and why.", parent: "",
    business_owners: ["user:bo"], technical_owners: [], source: "package", connections: ["c1"], counts: {}, total: 2, deprecated: 0 },
  children: [], featured: [RATE, DESK], featured_refs: [{ kind: "metric", ref: "c1/return_rate" }, { kind: "canvas", ref: "cv1" }],
  kinds: [], empty_kinds: [], can_curate: true, you: "bo", said: [], ...over,
});

function serve(found: DiscoverItem[] = []) {
  const put: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      put.push({ path, body });
      return new Response(JSON.stringify(path === "/discover/placement" ? { ...body } : { area: {} }));
    }
    if (path === "/discover/search") return new Response(JSON.stringify({ items: found, total: found.length, by_meaning: true, withheld: {}, said: [] }));
    return new Response("{}", { status: 404 });
  }));
  return put;
}

afterEach(() => vi.unstubAllGlobals());
beforeAll(measureNothing);

describe("editing an Area", () => {
  it("saves its description, its owners as people, and what it features in the order chosen", async () => {
    const put = serve();
    const onSaved = vi.fn();
    render(<AreaEditor page={page()} onSaved={onSaved} onCancel={() => {}} />);
    await writeIn("Description", "What customers send back.");
    fireEvent.change(screen.getByLabelText("Business contacts"), { target: { value: "cai" } });
    fireEvent.keyDown(screen.getByLabelText("Business contacts"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Move Return rate down" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(put).toEqual([{ path: "/discover/areas/returns", body: {
      description: "What customers send back.", business_owners: ["user:bo", "user:cai"], technical_owners: [],
      featured: [{ kind: "canvas", ref: "cv1" }, { kind: "metric", ref: "c1/return_rate" }] } }]);
  });

  it("chooses its icon from the Area glyphs, and sends it only when it changed (2026-11-25)", async () => {
    const put = serve();
    const onSaved = vi.fn();
    render(<AreaEditor page={page({ area: { ...page().area, icon: "returns" } })} onSaved={onSaved} onCancel={() => {}} />);
    // a dropdown (the user, 2026-11-25): the button shows the glyph chosen, the list opens on it
    fireEvent.click(screen.getByRole("button", { name: "Its icon: returns" }));
    expect(await screen.findByRole("radio", { name: "returns" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "box" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Its icon: box" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(put[0].body).toEqual(expect.objectContaining({ icon: "box" }));
  });

  it("says a featured thing the person may not open, rather than leaving it out", () => {
    serve();
    render(<AreaEditor page={page({ featured: [RATE] })} onSaved={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId("discover-area-editor-featured")).toHaveTextContent("A Data Canvas you may not open, or no longer there");
  });
});

describe("adding to an Area", () => {
  it("finds anything Discover lists but what is already here or a Definition, and places what is picked", async () => {
    const elsewhere = item({ id: "cv9", name: "Refund queue", area: "orders" });
    const put = serve([elsewhere, DESK, item({ kind: "definition", id: "def", name: "Refund", area: "orders" })]);
    const onAdded = vi.fn();
    render(<AddToArea page={page()} onAdded={onAdded} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Find something to add to Returns"), { target: { value: "refund" } });
    fireEvent.click(await screen.findByText("Refund queue", {}, { timeout: 2000 }));
    expect(screen.queryByText("Returns desk")).toBeNull();                    // already here
    expect(screen.queryByText("Refund")).toBeNull();                          // a Definition's Area is chosen on its page
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(put).toEqual([{ path: "/discover/placement", body: { kind: "canvas", id: "cv9", area: "returns" } }]);
  });
});

describe("a row of an Area's page", () => {
  const open = async (name: string) => {
    fireEvent.keyDown(screen.getByRole("button", { name: `More for ${name}` }), { key: "Enter" });
    return screen.findAllByRole("menuitem");
  };

  it("lets a curator feature it, or stop featuring it", async () => {
    const put = serve();
    const other = item({ id: "cv2", name: "Exchanges" });
    render(<RowMenu item={other} page={page()} onChanged={() => {}} />);
    fireEvent.click((await open("Exchanges")).find(m => m.textContent === "Feature in Returns")!);
    await waitFor(() => expect(put).toHaveLength(1));
    expect(put[0].body.featured).toEqual([{ kind: "metric", ref: "c1/return_rate" }, { kind: "canvas", ref: "cv1" }, { kind: "canvas", ref: "cv2" }]);
  });

  it("lets a thing's own owner take out what was placed, and offers them nothing more", async () => {
    const put = serve();
    render(<RowMenu item={DESK} page={page({ can_curate: false, you: "ana" })} onChanged={() => {}} />);
    const items = await open("Returns desk");
    expect(items.map(m => m.textContent)).toEqual(["Take out of Returns"]);
    fireEvent.click(items[0]);
    await waitFor(() => expect(put).toEqual([{ path: "/discover/placement", body: { kind: "canvas", id: "cv1", area: "" } }]));
  });

  it("offers nothing to someone who neither curates the Area nor owns the thing", () => {
    serve();
    render(<RowMenu item={DESK} page={page({ can_curate: false, you: "cai" })} onChanged={() => {}} />);
    expect(screen.queryByRole("button", { name: "More for Returns desk" })).toBeNull();
  });
});

describe("the Semantic Layer's whole save", () => {
  it("keeps a package's Area that has only a description or featured things", () => {
    const pkg = (over: Partial<BusinessArea>): BusinessArea => ({ id: "returns", name: "Returns", question: "", parent: "",
      business_owners: [], technical_owners: [], source: "package", pack_id: "p", ...over });
    expect(declarationsOf([pkg({})])).toEqual([]);
    expect(declarationsOf([pkg({ description: "Sent back." })]).map(d => d.id)).toEqual(["returns"]);
    expect(declarationsOf([pkg({ featured: [{ kind: "canvas", ref: "cv1" }] })]).map(d => d.id)).toEqual(["returns"]);
  });
});
