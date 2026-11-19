// @vitest-environment jsdom
/**
 * A chart's own prompt (the user, 2026-11-19, of a peer product's per-chart assistant): the spark on a card opens one line
 * across its top; what is typed there is asked in the Ask panel's conversation about that card alone, with the card as the
 * question's subject. On a dashboard the person keeps it offers to edit the chart; on one shared with them, to ask about it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, fireEvent, render, screen } from "@/lib/testing";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CardState } from "@/components/brief/PinnedCardBody";
import { CardPrompt } from "@/components/dashboards/CardPrompt";
import { ComposedDashboard } from "@/components/dashboards/ComposedDashboard";
import type { StoredCard } from "@/lib/api";
import { resetAskPanel, takeQueuedAsk, useAskPanel, useQueuedAsk } from "@/lib/askPanel";
import { askSubject, dashboardSubject, setAskSubject, subjectKey } from "@/lib/askSubject";

vi.mock("@/components/dashboards/DashboardTile", async (original) => ({
  ...(await original<typeof import("@/components/dashboards/DashboardTile")>()),
  // the tile's own tools: the spark is one of them
  DashboardTile: ({ cs, doors }: { cs: CardState; doors: { onAskChange?: () => void } }) => (
    <div>{cs.card.title}{doors.onAskChange && <span data-testid="card-ask" onClick={doors.onAskChange}>spark</span>}</div>
  ),
}));

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => { window.localStorage.clear(); resetAskPanel(); setAskSubject(null); });

const SPEC = () => JSON.parse(readFileSync(resolve(process.cwd(), "lib/dashboards/premise.fixture.json"), "utf8"));
const CARDS: CardState[] = [{ card: { id: "c7f3a001", title: "Return rate" } as StoredCard }, { card: { id: "c91b2002", title: "Net merchandise revenue" } as StoredCard }];
const HOST = { range: { status: "final" as const }, cards: { c7f3a001: { status: "within" as const }, c91b2002: { status: "within" as const } } };

function Queue() {
  const q = useQueuedAsk();
  const panel = useAskPanel();
  return <span data-testid="queued" data-open={panel.open || undefined}>{q ? `${q.text}|${q.subject}` : ""}</span>;
}

describe("a chart's own prompt", () => {
  it("opens across the card from its spark, and asks in the panel about that card alone", () => {
    render(<><ComposedDashboard spec={SPEC()} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn() }} connectionId="sheets"
      dashboardId="sheets:ops" /><Queue /></>);
    fireEvent.click(screen.getAllByTestId("card-ask")[0]);
    const input = screen.getByRole("textbox", { name: "Ask to edit this chart" });
    fireEvent.change(input, { target: { value: "Increase the thickness of lines" } });
    act(() => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(screen.queryByTestId("card-prompt")).toBeNull();                  // it hands over, and gets out of the way
    const asked = askSubject();
    expect(asked).toEqual(expect.objectContaining({ kind: "dashboard", dashboard: "ops", card: { id: "c7f3a001", title: "Return rate" } }));
    expect(screen.getByTestId("queued")).toHaveTextContent(`Increase the thickness of lines|${subjectKey(asked)}`);
    expect(screen.getByTestId("queued")).toHaveAttribute("data-open");      // the panel opens on it
  });

  it("closes with Escape and asks nothing", () => {
    const subject = dashboardSubject("sheets", "sheets:ops", "Ops", null, { id: "c7f3a001", title: "Return rate" })!;
    const onClose = vi.fn();
    render(<><CardPrompt subject={subject} onClose={onClose} /><Queue /></>);
    fireEvent.keyDown(screen.getByTestId("card-prompt-input"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId("queued")).toBeEmptyDOMElement();
    expect(askSubject()).toBeNull();
  });

  it("on a dashboard shared with the person, asks about the chart rather than offering to edit it", () => {
    const shared = dashboardSubject("sheets", "shared:bo:ops", "Ops", null, { id: "c7f3a001", title: "Return rate" })!;
    render(<CardPrompt subject={shared} onClose={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Ask about this chart" })).toHaveAttribute("placeholder", "Ask about this chart…");
  });

  it("is taken only by its own number, so it is sent once", () => {
    const subject = dashboardSubject("sheets", "sheets:ops", "Ops", null, { id: "c7f3a001", title: "Return rate" })!;
    render(<><CardPrompt subject={subject} onClose={vi.fn()} /><Queue /></>);
    fireEvent.change(screen.getByTestId("card-prompt-input"), { target: { value: "Make it a bar chart" } });
    act(() => { fireEvent.click(screen.getByTestId("card-prompt-send")); });
    expect(screen.getByTestId("queued")).toHaveTextContent("Make it a bar chart");
    act(() => { takeQueuedAsk(0); });                                          // another question's number takes nothing
    expect(screen.getByTestId("queued")).toHaveTextContent("Make it a bar chart");
  });
});
