// @vitest-environment jsdom
import { change, fireEvent, render, screen, waitFor } from "@/lib/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BusinessArea } from "@/lib/areas";

import { AreaOwnersEditor, AreaPlacement, DeclareArea } from "./AreaControls";

const area = (id: string, extra: Partial<BusinessArea> = {}): BusinessArea => ({
  id, name: id[0].toUpperCase() + id.slice(1), question: "", parent: "", business_owners: [], technical_owners: [],
  source: "package", pack_id: "retail", ...extra,
});
const AREAS = [area("orders"), area("returns", { business_owners: ["user:ana"] }), area("marketplace", { source: "organisation" })];

function serve(reply: (body: Record<string, unknown>) => Response) {
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    sent.push(body);
    return reply(body);
  }));
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("the organisation's word on its areas (2026-11-17)", () => {
  it("saves an area's owners and place as the organisation's whole declaration", async () => {
    const sent = serve(() => new Response(JSON.stringify({ areas: AREAS })));
    const saved = vi.fn();
    render(<AreaOwnersEditor connId="shop" areas={AREAS} area={AREAS[0]} onSaved={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "Contacts and place" }));
    for (const name of ["bo", "cai"]) {
      fireEvent.change(screen.getByLabelText("Business contacts"), { target: { value: name } });
      fireEvent.keyDown(screen.getByLabelText("Business contacts"), { key: "Enter" });
    }
    change(screen.getByLabelText("Sits under"), { target: { value: "marketplace" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const decls = (sent[0] as { areas: { id: string }[] }).areas;
    expect(decls).toContainEqual({ id: "orders", parent: "marketplace", business_owners: ["user:bo", "user:cai"], technical_owners: [] });
    expect(decls.map((d) => d.id).sort()).toEqual(["marketplace", "orders", "returns"]);       // the rest kept
  });

  it("says every reason a declaration was refused", async () => {
    serve(() => new Response(JSON.stringify({ detail: { code: "AREAS_REFUSED", problems: ["seller_ops sits under nowhere, which is no area"] } }), { status: 422 }));
    render(<DeclareArea connId="shop" areas={AREAS} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Declare an area" }));
    fireEvent.change(screen.getByLabelText("Area name"), { target: { value: "Seller ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Declare" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not saved: seller_ops sits under nowhere, which is no area.");
  });

  it("places a table, or leaves it to the evidence", async () => {
    const sent = serve((b) => new Response(JSON.stringify({ area: b.area || null })));
    const placed = vi.fn();
    render(<AreaPlacement connId="shop" table="orders" areas={AREAS} placed={null} onPlaced={placed} />);
    change(screen.getByLabelText("The area orders serves"), { target: { value: "returns" } });
    await waitFor(() => expect(placed).toHaveBeenCalledWith("returns"));
    expect(sent[0]).toMatchObject({ kind: "table", ref: "orders", area: "returns" });
  });
});
