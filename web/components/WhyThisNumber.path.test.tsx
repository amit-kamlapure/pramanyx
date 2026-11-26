/**
 * The blueprint (2026-11-27): what an answer was given and the path it took were recorded but on no receipt a person
 * could read — "what touched what" could not be answered for any answer. The drawer says both.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const receipt = {
  receipt_version: 2, id: "r1", created_at: null, mode: "quick", question: "What stands out?", headline: "Returns rose",
  connection: { id: "c1", name: "theLook", dialect: "bigquery" }, executed_sql: [], input_tables: [],
  columns: { level: null, note: null, columns: [], tables_only: [] }, guards: [], caveats: [],
  metrics: { used: [], drifted: [], available: [], proposed: [] }, confidence: { level: null, capped_by: null },
  data_trust: { window: null, coverage_notes: null }, model: { role: "coder", id: null }, agent: null,
  resolved_readings: [], learning: null, activations: [], grounded_in_graph: [], cost: null, record: null,
  given: { definition: ["Revenue", "Return rate"], trusted_query: ["Returns by category"] },
  path: { kind: "survey", depth: "deep", engine: "analyst", why: "an open question — every approved metric measured first" },
};

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  getPublicReceipt: vi.fn(async () => receipt),
  getAnswerTrace: vi.fn(async () => null),
}));

import { WhyThisNumber } from "@/components/WhyThisNumber";

describe("the Trust Receipt drawer", () => {
  it("says the path the answer took and what it was given", async () => {
    render(<WhyThisNumber receiptId="r1" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /Why this number/ }));
    await act(async () => {});
    expect(screen.getByTestId("receipt-path")).toHaveTextContent("An open question · answered by the analyst · deep budget");
    expect(screen.getByTestId("receipt-path")).toHaveTextContent("every approved metric measured first");
    expect(screen.getByTestId("receipt-given")).toHaveTextContent("Definitions: Revenue · Return rate");
    expect(screen.getByTestId("receipt-given")).toHaveTextContent("Trusted queries: Returns by category");
  });
});
