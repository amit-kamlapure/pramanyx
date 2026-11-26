// @vitest-environment jsdom
/** A new Definition opened from the Atlas's review ("Write its Definition", A5, 2026-11-25) comes with the word it was
 *  learned under, filled in for the person to keep or change; one opened with none starts blank, as before. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { DefinitionView } from "@/components/definitions/DefinitionView";
import { render, screen } from "@/lib/testing";

afterEach(() => vi.unstubAllGlobals());

function serve() {
  // each read answered in its own shape: the connection's Areas, the word's Definitions (none), who is reading
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    String(url).includes("/areas") ? { areas: [{ id: "orders_sales", name: "Orders & sales" }] }
      : String(url).includes("/record/you") ? { principal: "user:me" } : []))));
}

describe("a new Definition", () => {
  it("comes with the word it was learned under, to keep or change", async () => {
    serve();
    render(<DefinitionView term="" newTerm="Repeat buyer" connection="c1" initialArea="orders_sales" inApp />);
    expect(await screen.findByDisplayValue("Repeat buyer")).toBeTruthy();
  });

  it("starts blank when it is given no word", async () => {
    serve();
    render(<DefinitionView term="" connection="c1" inApp />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByDisplayValue("Repeat buyer")).toBeNull();
  });
});
