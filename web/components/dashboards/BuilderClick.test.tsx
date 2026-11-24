/**
 * The study's R4: in the builder a click chooses the piece and reshapes nothing, and Alt and a click tries the filter a
 * reader's click would make. R13: a note may hold two levels of heading, and a note of headings alone has no card.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@/lib/testing";

import { ComposedDashboard } from "@/components/dashboards/ComposedDashboard";
import { NoteProse, isHeadingNote } from "@/components/dashboards/NoteProse";
import { NoteTile } from "@/components/dashboards/StaticTile";
import { CellBoxContext } from "@/components/dashboards/cellBox";
import type { CardState } from "@/components/brief/PinnedCardBody";
import type { DashboardHostState } from "@/lib/dashboards/hostState";

const traceField = vi.fn();
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()), traceField: (...a: unknown[]) => traceField(...a),
}));
vi.mock("@/components/dashboards/DashboardTile", async (original) => ({
  ...(await original<typeof import("@/components/dashboards/DashboardTile")>()),
  DashboardTile: ({ focus }: { focus?: { onPick?: (p: { field: string; value: string }) => void } }) => (
    <span role="button" data-testid="a-mark" onClick={() => focus?.onPick?.({ field: "channel", value: "Search" })}>A mark</span>
  ),
}));
beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => { traceField.mockReset(); traceField.mockResolvedValue({ traced: true, table: "users", column: "traffic_source", why: "" }); });

const SPEC = JSON.parse(readFileSync(resolve(process.cwd(), "lib/dashboards/premise.fixture.json"), "utf8"));
const refresh = { cadence: "daily", last_run: "", last_value: 1, prev_value: null, history: [1] };
const CARDS = ["c7f3a001", "c91b2002"].map(id => ({ card: { id, title: id, sql: "SELECT 1", render: {}, refresh, thresholds: {}, provenance: {} },
  run: { columns: ["v"], rows: [[1]], row_count: 1, caveats: [], error: null, refresh } })) as unknown as CardState[];
const HOST: DashboardHostState = { range: { status: "final" }, cards: { c7f3a001: { status: "within" }, c91b2002: { status: "within" } } };

function click(alt: boolean) {
  const mark = screen.getAllByTestId("a-mark")[0];
  fireEvent(mark, new MouseEvent("pointerdown", { bubbles: true, altKey: alt }));   // jsdom's pointer event carries no keys
  fireEvent.click(mark, { altKey: alt });
}

describe("a click on a mark", () => {
  it("in the builder chooses the piece and filters nothing; with Alt it tries the filter", async () => {
    const onFocus = vi.fn(), onSelect = vi.fn();
    render(<ComposedDashboard spec={SPEC} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn(), onSelect }} focus={[]} onFocus={onFocus} />);
    click(false);
    await new Promise(r => setTimeout(r, 20));
    expect(onSelect).toHaveBeenCalled();
    expect(traceField).not.toHaveBeenCalled();
    expect(onFocus).not.toHaveBeenCalled();
    click(true);
    await waitFor(() => expect(traceField).toHaveBeenCalledTimes(1));
  });

  it("filters for a reader, as it always did", async () => {
    render(<ComposedDashboard spec={SPEC} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn() }} focus={[]} onFocus={vi.fn()} />);
    click(false);
    await waitFor(() => expect(traceField).toHaveBeenCalledTimes(1));
  });
});

describe("a note's headings", () => {
  it("draws two levels, and any deeper one as plain words", () => {
    render(<NoteProse text={"# Revenue\n\n## This quarter\n\n### Deeper"} />);
    expect(screen.getAllByTestId("note-heading").map(h => h.textContent)).toEqual(["Revenue", "This quarter"]);
    expect(screen.getByText("Deeper").tagName).not.toMatch(/^H/);
  });

  it("knows a note of headings alone", () => {
    expect(isHeadingNote("# Revenue")).toBe(true);
    expect(isHeadingNote("# Revenue\n\n## This quarter")).toBe(true);
    expect(isHeadingNote("# Revenue\nand some words")).toBe(false);
    expect(isHeadingNote("#Revenue")).toBe(false);
    expect(isHeadingNote("### Deeper")).toBe(false);
  });

  it("stands on the page with no card, its stamp on hover; a note with words keeps its card and stamp", () => {
    const { unmount } = render(<NoteTile elementKey={null} text="# Revenue" author="user:amit" size="full" doors={{}} />);
    expect(screen.queryByTestId("note-chip")).toBeNull();
    expect(screen.getByTestId("dashboard-note").style.background).toBe("transparent");
    expect(screen.getByTestId("note-room").getAttribute("title")).toMatch(/amit.*not measured, cited by nothing/);
    unmount();
    render(<NoteTile elementKey={null} text="Words of mine" author="user:amit" size="small" doors={{}} />);
    expect(screen.getByTestId("note-chip")).toBeInTheDocument();
    expect(screen.getByText(/not measured, cited by nothing/)).toBeInTheDocument();
  });
});

describe("a note in a box of the grid", () => {
  // jsdom lays nothing out: the room the box gives the words, and how tall the words are, are said here
  const sized = (room: number, words: number) => {
    const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get(this: HTMLElement) {
      return this.dataset?.testid === "note-room" ? room : this.dataset?.testid === "note-words" ? words : 0;
    } });
    return () => { if (was) Object.defineProperty(HTMLElement.prototype, "clientHeight", was); };
  };
  const note = (h: number) => (
    <CellBoxContext.Provider value={{ onGrid: true, w: 12, h }}>
      <NoteTile elementKey={null} text={"Each row is **one product in one year**.\n\n- the Returns Area\n- the Operations dashboard"}
        author="user:amit" writtenAt="2026-11-24T02:26:00Z" size="full" doors={{}} />
    </CellBoxContext.Provider>
  );

  it("short, keeps its words: its head folds into its stamp, and the words past the box are said", () => {
    const back = sized(26, 80);
    try {
      render(note(2));
      expect(screen.queryByTestId("note-chip")).toBeNull();
      expect(screen.getByText(/^Your words · amit · written .* · not measured, cited by nothing$/)).toBeInTheDocument();
      expect(screen.getByTestId("note-more")).toHaveTextContent("more below");
      expect(screen.getByTestId("dashboard-note").style.padding).toBe("8px 12px 6px");
    } finally { back(); }
  });

  it("tall enough, keeps its head and its air, and says nothing more when every word shows", () => {
    const back = sized(200, 80);
    try {
      render(note(6));
      expect(screen.getByTestId("note-chip")).toHaveTextContent("Your words");
      expect(screen.queryByTestId("note-more")).toBeNull();
      expect(screen.getByTestId("dashboard-note").style.padding).toBe("16px 18px 14px");
    } finally { back(); }
  });
});
