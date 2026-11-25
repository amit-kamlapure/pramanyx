import { describe, expect, it } from "vitest";
import { workspaceHolding } from "./workspace";

const ws = [
  { id: "default", connection_ids: ["8233e4fd", "workspace"] },
  { id: "lux", connection_ids: ["dcc63d83"], accessible_connection_ids: ["dcc63d83", "8233e4fd"] },
];

describe("the workspace a connection opens in (S1, 2026-11-25)", () => {
  it("stays where it is when this workspace holds it", () => {
    expect(workspaceHolding(ws, "8233e4fd", "lux")).toBe("lux");
    expect(workspaceHolding(ws, "8233e4fd", "default")).toBe("default");
  });
  it("moves to the first workspace that holds it, its grants counted, and nowhere when none does", () => {
    expect(workspaceHolding(ws, "dcc63d83", "default")).toBe("lux");
    expect(workspaceHolding(ws, "gone", "default")).toBeNull();
  });
});
