// @vitest-environment jsdom
/**
 * The Ask panel beside a sheet (Stage 1, the user, 2026-11-19: the sheet's own chat folds into the one conversation, losing
 * nothing). A question is asked FROM the sheet and the view on screen; what the chat reads is said under it; a change asked
 * for is proposed and changes nothing until applied, with the other way one click away; a file becomes a proposal for a new
 * sheet; an answer's rows can be seen in the grid. The chat transport is a double: no network.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { text: string; body: Record<string, unknown> }[] = [];
const prior = vi.hoisted(() => ({ messages: [] as unknown[] }));
const sheets = vi.hoisted(() => ({
  propose: vi.fn(),
  proposeNewSheet: vi.fn(),
  stageFile: vi.fn(async () => ({ token: "t1" })),
  applyProposal: vi.fn(async (_id: string, picks: number[] | null) => ({ change_id: "c1", applied: picks ?? [], sheet: "s1" })),
}));

vi.mock("@/lib/usePramanyxChat", () => ({
  usePramanyxChat: () => ({
    messages: prior.messages,
    sendMessage: (m: { text: string }, o: { body: Record<string, unknown> }) => { sent.push({ text: m.text, body: o.body }); return Promise.resolve(); },
    setMessages: vi.fn(), regenerate: vi.fn(), stop: vi.fn(), status: "ready", error: undefined, clearError: vi.fn(),
  }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getConnections: vi.fn(async () => []),
  getSystemFlags: vi.fn(async () => ({})),
  listUserAgents: vi.fn(async () => []),
  recordOverviewDrill: vi.fn(),
  cancelActiveDeepRun: vi.fn(),
}));
vi.mock("@/lib/sheets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sheets")>()),
  ...sheets,
  readGrounding: async () => ({ found: true, table: "olist_orders", rows: 6, summary: "",
    view: { name: "Overdue, still open", where: "TRUE", rows: 2 } }),
}));

import { ChatPanel } from "./ChatPanel";
import { setPageSubject } from "@/lib/askSubject";
import { useSheetDoorsHere, useSheetsHomeHere, type SheetActions } from "@/lib/sheetBridge";
import type { Proposal, Sheet } from "@/lib/sheets";

const SHEET = { id: "s1", name: "Olist orders", table: "olist_orders", columns: [], views: [], rules: [] } as unknown as Sheet;
const PROPOSAL: Proposal = {
  id: "p1", state: "staged", words: "flag them", changes: [
    { type: "view", name: "Overdue, still open", said: "View Overdue, still open — 2 rows", rows: 2 },
    { type: "computed_column", name: "Days overdue", said: "Column Days overdue — computed" },
    { type: "column", name: "Followed up", said: "Column Followed up — Yes/No, empty, for people to fill" },
  ],
};
const actions = (): SheetActions => ({ showRows: vi.fn(), keepRows: vi.fn(async () => true), applied: vi.fn(), openView: vi.fn(), openSheet: vi.fn() });

function SheetOnScreen({ doors }: { doors: SheetActions }) {
  useSheetDoorsHere(SHEET, "v9", 2, doors);
  return null;
}

beforeEach(() => {
  sent.length = 0;
  prior.messages = [];
  Object.values(sheets).forEach(f => f.mockClear());
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ suggestions: [], starters: [] }), { status: 200 })));
  setPageSubject({ kind: "sheet", connectionId: "sheets", noun: ["row", "rows"], id: "s1", title: "Olist orders", view: "v9", viewName: "Overdue, still open" });
});
afterEach(() => { setPageSubject(null); });

async function panel(doors = actions()) {
  render(<QueryClientProvider client={new QueryClient()}><SheetOnScreen doors={doors} /><ChatPanel connectionId="sheets" harness beside /></QueryClientProvider>);
  await act(async () => {});
  return { box: screen.getByRole("textbox") as HTMLTextAreaElement, doors };
}
const send = (box: HTMLTextAreaElement, value: string) => {
  fireEvent.change(box, { target: { value } });
  fireEvent.keyDown(box, { key: "Enter" });
};

describe("the Ask panel beside a sheet", () => {
  it("asks from the sheet and the view on screen, and says what it reads", async () => {
    const { box } = await panel();
    expect(box.placeholder).toContain("Ask about this sheet, drop a file, or ask for a change");
    expect(await screen.findByTestId("sheet-grounding")).toHaveTextContent("the view Overdue, still open: 2 rows");
    send(box, "How many are overdue?");
    expect(sent.at(-1)?.body).toMatchObject({ focus: { kind: "sheet", id: "s1:v9" } });
    expect(sheets.propose).not.toHaveBeenCalled();
  });

  it("proposes a change asked for, changes nothing until it is applied, and reads the sheet again after", async () => {
    sheets.propose.mockResolvedValue({ staged: true, proposal: PROPOSAL });
    const { box, doors } = await panel();
    send(box, "Flag the ones still open");
    await waitFor(() => expect(sheets.propose).toHaveBeenCalledWith("s1", "Flag the ones still open"));
    expect(sent).toHaveLength(0);                                                       // proposed, not asked
    expect(await screen.findByText("3 changes")).toBeInTheDocument();
    expect(sheets.applyProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply 3 changes" }));
    await waitFor(() => expect(sheets.applyProposal).toHaveBeenCalledWith("p1", [0, 1, 2]));
    await waitFor(() => expect(doors.applied).toHaveBeenCalled());
    expect(doors.openView).toHaveBeenCalledWith("Overdue, still open");                  // the view it made, opened
  });

  it("asks a proposal as a question instead, in one click", async () => {
    sheets.propose.mockResolvedValue({ staged: true, proposal: PROPOSAL });
    const { box } = await panel();
    send(box, "Flag the ones still open");
    fireEvent.click(await screen.findByRole("button", { name: "ask it as a question instead" }));
    expect(sent.at(-1)).toMatchObject({ text: "Flag the ones still open", body: { focus: { kind: "sheet", id: "s1:v9" } } });
  });

  it("makes a dropped file one proposal for a new sheet, said with what was written", async () => {
    sheets.proposeNewSheet.mockResolvedValue({ staged: true, proposal: { ...PROPOSAL, id: "p2", new_sheet: true, name: "Complaints",
      file: "complaints.csv", rows: 40, columns: [], changes: [] } });
    const { box } = await panel();
    fireEvent.change(box, { target: { value: "complaints to follow up" } });
    const file = new File(["a,b\n1,2"], "complaints.csv", { type: "text/csv" });
    fireEvent.drop(screen.getByTestId("chat-drop"), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(sheets.proposeNewSheet).toHaveBeenCalledWith("t1", "complaints to follow up"));
    expect(await screen.findByText("A new sheet · Complaints")).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it("offers an answer's rows to see in the grid, and the other way to ask it", async () => {
    prior.messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Which are still open?" }] },
      { id: "a1", role: "assistant", parts: [
        { type: "text", text: "Two are still open.", state: "done", providerMetadata: { pramanyx: { channel: "headline" } } },
        { type: "data-sheet_rows", data: { sheet: "s1", view: "v9", within_view: true, filter: [], conditions: [], sort: [], search: "",
          about: "Still open", rows: 2, of: 6, share: 33, said: "status is open" } },
      ] },
    ];
    const { doors } = await panel();
    fireEvent.click(await screen.findByRole("button", { name: "Show in the grid" }));
    expect(doors.showRows).toHaveBeenCalledWith(expect.objectContaining({ about: "Still open", rows: 2 }));
  });
});

describe("the Ask panel's composer (2026-11-20)", () => {
  it("offers no Quick or Agent and no agent to answer as: the conversation decides", async () => {
    const { box } = await panel();
    expect(screen.queryByRole("radiogroup", { name: "How to answer" })).toBeNull();
    expect(screen.queryByText("No agent")).toBeNull();
    send(box, "How many are still open?");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toMatchObject({ mode: "auto", depth: "auto" });           // the conversation, with its own tools
  });
});

function HomeOnScreen({ openSheet }: { openSheet: (id: string) => void }) {
  useSheetsHomeHere(openSheet);
  return null;
}

describe("the Spreadsheets home's In the chat (2026-11-20: the Ask panel, not a small panel of its own)", () => {
  it("makes a file dropped there one proposal for a new sheet, and opens the sheet made", async () => {
    setPageSubject(null);
    sheets.proposeNewSheet.mockResolvedValue({ staged: true, proposal: { ...PROPOSAL, id: "p3", new_sheet: true, name: "Complaints",
      file: "complaints.csv", rows: 40, columns: [], changes: [] } });
    const openSheet = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}><HomeOnScreen openSheet={openSheet} /><ChatPanel connectionId="sheets" harness beside /></QueryClientProvider>);
    await act(async () => {});
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.placeholder).toContain("Drop a file and say what it is for");
    fireEvent.change(box, { target: { value: "complaints to follow up" } });
    fireEvent.drop(screen.getByTestId("chat-drop"), { dataTransfer: { files: [new File(["a,b\n1,2"], "complaints.csv", { type: "text/csv" })] } });
    await waitFor(() => expect(sheets.proposeNewSheet).toHaveBeenCalledWith("t1", "complaints to follow up"));
    expect(await screen.findByText("A new sheet · Complaints")).toBeInTheDocument();
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Create sheet" }));
    await waitFor(() => expect(openSheet).toHaveBeenCalledWith("s1"));                  // made, and opened on the home
  });
});
