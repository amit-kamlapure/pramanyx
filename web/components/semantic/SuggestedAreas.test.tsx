// @vitest-environment jsdom
/**
 * Punch list 87: the areas the model suggests wait for a curator. Each is shown with the tables it was read from;
 * Declare it saves it as an area with what was already declared; Not an area sets it aside; nothing is an area by
 * being suggested.
 */
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SuggestedAreas } from "./AreaControls";
import type { BusinessArea } from "@/lib/areas";

const FINANCE: BusinessArea = { id: "finance", name: "Finance", question: "", parent: "", business_owners: ["ana"],
  technical_owners: [], source: "organisation", pack_id: "" };

afterEach(() => vi.unstubAllGlobals());

function stub(answers: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(answers(String(url), init)));
  }));
  return calls;
}

describe("areas the model suggests", () => {
  it("are declared at a curator's word, with the areas already declared kept", async () => {
    const calls = stub((url, init) => (url.endsWith("/suggested")
      ? { suggested: [{ label: "Logistics", id: "logistics", tables: ["orders", "shipments"] }] }
      : init?.method === "PUT" ? { areas: [FINANCE, { ...FINANCE, id: "logistics", name: "Logistics", business_owners: [] }] } : {}));
    const onSaved = vi.fn();
    render(<SuggestedAreas connId="c1" areas={[FINANCE]} onSaved={onSaved} />);
    expect(await screen.findByTestId("suggested-area")).toHaveTextContent("Logistics2 tables: orders, shipments");
    fireEvent.click(screen.getByRole("button", { name: "Declare it" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(put.url).toContain("/areas/c1");
    expect(JSON.parse(String(put.init!.body)).areas).toEqual([
      { id: "finance", name: "Finance", question: "", parent: "", business_owners: ["ana"], technical_owners: [] },
      { id: "logistics", name: "Logistics", question: "", parent: "" },
    ]);
    await waitFor(() => expect(screen.queryByTestId("suggested-areas")).toBeNull());
  });

  it("are set aside when a curator says one is not an area, and show nothing when there are none", async () => {
    const calls = stub((url) => (url.endsWith("/suggested")
      ? { suggested: [{ label: "Marketing", id: "marketing", tables: ["reviews"] }] } : { not_areas: ["Marketing"] }));
    render(<SuggestedAreas connId="c1" areas={[]} onSaved={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Not an area" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/not-an-area"))).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith("/not-an-area"))!.init!.body))).toEqual({ label: "Marketing", not_an_area: true });
    await waitFor(() => expect(screen.queryByTestId("suggested-areas")).toBeNull());
  });
});
