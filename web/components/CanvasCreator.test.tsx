// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasCreator } from "@/components/CanvasCreator";
import type { Connection } from "@/lib/api";

const api = vi.hoisted(() => ({ suggestCanvasTables: vi.fn(), suggestCanvasName: vi.fn(), createCanvas: vi.fn(), getCatalogTree: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));
// one object across renders, as the shared schema cache hands out
const shared = vi.hoisted(() => ({ schema: { tables: [{ name: "orders" }, { name: "returns" }, { name: "users" }] }, error: null }));
vi.mock("@/lib/schema-context", () => ({ useRichSchema: () => shared }));

const CONNECTIONS = [{ id: "c1", name: "Shop", conn_type: "duckdb" }] as Connection[];
const words = () => screen.getByLabelText("What should this canvas do?");
beforeEach(() => { Object.values(api).forEach(f => f.mockReset()); });
async function opened() {
  const onCreated = vi.fn();
  render(<CanvasCreator connections={CONNECTIONS} onCreated={onCreated} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Shop/ }));
  await screen.findByLabelText("What should this canvas do?");
  return onCreated;
}

describe("starting a canvas by describing it", () => {
  it("proposes tables for the person to check, and makes nothing until they create it", async () => {
    api.suggestCanvasTables.mockResolvedValue({ tables: ["orders", "returns"], why: "They hold what was sold and sent back.", said: "" });
    api.suggestCanvasName.mockResolvedValue({ name: "Returns", description: "A model's line" });
    api.createCanvas.mockResolvedValue({ id: "cv1" });
    const onCreated = await opened();
    fireEvent.change(words(), { target: { value: "See what drives returns" } });
    fireEvent.click(screen.getByTestId("canvas-propose-tables"));
    expect(await screen.findByTestId("canvas-proposal")).toHaveTextContent("2 tables proposed. Check them");
    expect(api.suggestCanvasTables).toHaveBeenCalledWith("c1", "See what drives returns", ["orders", "returns", "users"]);
    expect(api.createCanvas).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(api.createCanvas).toHaveBeenCalledWith("Returns", "See what drives returns", [{ connection_id: "c1", schema_name: null, tables: ["orders", "returns"] }]);
  });

  it("says when nothing fits, and leaves choosing by hand as it was", async () => {
    api.suggestCanvasTables.mockResolvedValue({ tables: [], why: "", said: "No table clearly fits that." });
    await opened();
    fireEvent.change(words(), { target: { value: "Weather on Mars" } });
    fireEvent.click(screen.getByTestId("canvas-propose-tables"));
    expect(await screen.findByTestId("canvas-proposal")).toHaveTextContent("No table clearly fits that.");
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "users" }));
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });
});
