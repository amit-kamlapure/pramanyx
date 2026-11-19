// @vitest-environment jsdom
/**
 * What a sheet's conversation shows (Arc SH, SH-4): a proposal changes nothing until the person applies it, and then only
 * the changes they left ticked; an answer's rows say how many of what whole. Asking FROM the sheet, in the Ask panel since
 * the sheet's own chat folded into it, is ChatPanel.sheet.test.tsx.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const applyProposal = vi.fn(async (_id: string, picks: number[] | null) => ({ change_id: "c1", applied: picks ?? [], sheet: "s1" }));
const propose = vi.fn();
vi.mock("@/lib/sheets", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/sheets")>()),
  applyProposal: (id: string, picks: number[] | null) => applyProposal(id, picks),
  propose: (id: string, words: string) => propose(id, words),
  readGrounding: async () => ({ found: true, table: "olist_orders", rows: 6, summary: "",
    view: { name: "Overdue, still open", where: "TRUE", rows: 2 } }),
}));

import { ProposalCard, RowsCard } from "./SheetChat";
import type { SheetRowsRef } from "@/lib/chatTurn";
import type { Proposal, Sheet } from "@/lib/sheets";

const SHEET = { id: "s1", name: "Olist orders", table: "olist_orders", columns: [], views: [] } as unknown as Sheet;

const PROPOSAL: Proposal = {
  id: "p1", state: "staged", words: "flag them", changes: [
    { type: "view", name: "Overdue, still open", said: "View Overdue, still open — 2 rows", rows: 2 },
    { type: "computed_column", name: "Days overdue", said: "Column Days overdue — computed" },
    { type: "column", name: "Followed up", said: "Column Followed up — Yes/No, empty, for people to fill" },
  ],
};

beforeEach(() => { applyProposal.mockClear(); propose.mockReset(); });

describe("ProposalCard", () => {
  it("applies only the changes left ticked, and nothing before the click", async () => {
    const onApplied = vi.fn();
    render(<ProposalCard proposal={PROPOSAL} onApplied={onApplied} onUndone={() => {}} />);
    expect(screen.getByText("nothing applied yet")).toBeInTheDocument();
    expect(applyProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(PROPOSAL.changes[2].said));      // untick "Followed up"
    fireEvent.click(screen.getByText("Apply 2 changes"));
    await waitFor(() => expect(applyProposal).toHaveBeenCalledWith("p1", [0, 1]));
    expect(onApplied).toHaveBeenCalledWith([0, 1], "s1");
  });
});

describe("RowsCard", () => {
  const sheet = { ...SHEET, columns: [{ id: "c7", name: "order_delivered_carrier_date", kind: "datetime" }], rules: [] } as unknown as Sheet;
  const rows: SheetRowsRef = {
    sheet: "s1", view: "v1", withinView: false, filter: [{ column: "c7", op: "empty" }],
    conditions: [{ column: "c7", op: "empty" }], sort: [], search: "", about: "Orders with no carrier date",
    rows: 1783, of: 99441, share: 1.8, said: "order_delivered_carrier_date is empty",
  };

  it("says how many of what whole, in the grid's words, and changes nothing until a click", async () => {
    const onShow = vi.fn();
    const onKeep = vi.fn(async () => true);
    render(<RowsCard rows={rows} sheet={sheet} onShow={onShow} onKeep={onKeep} />);
    expect(screen.getByText("1,783 orders")).toBeInTheDocument();
    expect(screen.getByText(/of 99,441 · 1.8%/)).toBeInTheDocument();
    expect(screen.getByText("order_delivered_carrier_date is empty")).toBeInTheDocument();
    expect(onShow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Show in the grid"));
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Shown in the grid")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Keep as a view · Orders with no carrier date"));
    expect(await screen.findByText("Kept as the view Orders with no carrier date")).toBeInTheDocument();
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it("offers nothing to show when no row matches", () => {
    render(<RowsCard rows={{ ...rows, rows: 0, share: 0 }} sheet={sheet} onShow={() => {}} onKeep={async () => true} />);
    expect(screen.getByText("0 orders")).toBeInTheDocument();
    expect(screen.queryByText("Show in the grid")).not.toBeInTheDocument();
  });
});
