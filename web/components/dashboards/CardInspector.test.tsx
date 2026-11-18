// @vitest-environment jsdom

/**
 * The builder's one panel for a card (the board study, 2026-11-16; since 2026-11-18 it opens on the look, with what it
 * reads and the SQL folded below, and with nothing chosen it is the dashboard's own setup). The SQL tab shows the
 * statement as it RAN with its values beside it, or says why it cannot; the Chart tab holds the card's own editor —
 * a dock that serves one card only.
 */
import { act, fireEvent, render, screen } from "@/lib/testing";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CardSql, ChartDock } from "@/components/dashboards/CardInspector";
import { PieceSetup } from "@/components/dashboards/PieceSetup";
import { setVizDock, useVizDock } from "@/components/charts/vizEditorStore";
import type { CardState } from "@/components/brief/PinnedCardBody";
import type { StoredCard } from "@/lib/api";
import type { DashboardSpec } from "@/lib/dashboards/edit";
import { cardsDashboardSpec } from "@/lib/dashboards/start";

const SPEC: DashboardSpec = cardsDashboardSpec("Sales", [{ card: "card1", size: "half" }]);
const PLACED = Object.entries(SPEC.elements).find(([, e]) => e.type === "Card")![0];

function cs(ran: CardState["run"] extends infer R ? R extends { ran?: infer X } ? X : never : never): CardState {
  const refresh = { cadence: "daily", last_run: null, last_value: null, prev_value: null, history: [] };
  const card = { id: "card1", title: "Revenue by channel", sql: "SELECT channel, SUM(sale_price) FROM order_items GROUP BY 1" } as unknown as StoredCard;
  return { card, run: { columns: [], rows: [], row_count: 0, caveats: [], error: null, refresh, ran,
    scoped: { covers: "the year 2025", standing: false, why: "", grain: "order_items.created_at" } } as unknown as CardState["run"] };
}

describe("the card's panel", () => {
  it("opens on its look — the chart editor first — with what it reads and the SQL folded below (2026-11-18)", () => {
    render(<PieceSetup spec={SPEC} selected={PLACED} onChange={() => {}} connectionId="thelook"
      cardSetup={() => <div data-testid="the-setup" />}
      cardChart={() => <div data-testid="the-chart" />} cardSql={() => <div data-testid="the-sql" />} />);
    const panel = screen.getByTestId("card-panel");
    expect(panel.firstElementChild).toBe(screen.getByTestId("the-chart"));
    expect(screen.getByText("Edge")).toBeInTheDocument();
    expect(screen.queryByTestId("the-sql")).toBeNull();
    expect(screen.queryByTestId("the-setup")).toBeNull();
    fireEvent.click(screen.getByTestId("card-fold-sql"));
    expect(screen.getByTestId("the-sql")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("card-fold-reads"));
    expect(screen.getByTestId("the-setup")).toBeInTheDocument();
    expect(screen.queryByTestId("card-tabs")).toBeNull();
  });

  it("folds nothing where nothing gives a part to fold", () => {
    render(<PieceSetup spec={SPEC} selected={PLACED} onChange={() => {}} connectionId="thelook" />);
    expect(screen.queryByTestId("card-fold-sql")).toBeNull();
    expect(screen.queryByTestId("card-fold-reads")).toBeNull();
    expect(screen.getByText("Edge")).toBeInTheDocument();
  });

  it("with nothing chosen, is the dashboard's own setup: its name, what it holds, and the way to its layout", () => {
    let opened = 0;
    render(<PieceSetup spec={SPEC} selected={null} onChange={() => {}} connectionId="thelook" onOpenLayout={() => { opened += 1; }} />);
    expect(screen.getByTestId("setup-empty")).toHaveTextContent("Sales");
    expect(screen.getByTestId("setup-empty")).toHaveTextContent(/Cards\s*1/);
    fireEvent.click(screen.getByTestId("setup-open-layout"));
    expect(opened).toBe(1);
  });
});

describe("the dashboard's own setup", () => {
  it("says the ontology release its pieces read, where the canvas no longer does", () => {
    const { rerender } = render(<PieceSetup spec={SPEC} selected={null} onChange={() => {}} connectionId="thelook" release="6" />);
    expect(screen.getByTestId("setup-release")).toHaveTextContent("Its pieces read release 6, the one it was composed against.");
    rerender(<PieceSetup spec={SPEC} selected={null} onChange={() => {}} connectionId="thelook" />);
    expect(screen.queryByTestId("setup-release")).toBeNull();
  });
});

describe("the SQL tab", () => {
  it("shows the statement as it ran, what it covered, and its values beside it", () => {
    render(<CardSql cs={cs({ sql: "SELECT SUM(x) FROM (SELECT 1) WHERE c = $1", params: { flt_0_0: "Search" } })} />);
    expect(screen.getByText(/The statement as it ran, for the year 2025\./)).toBeInTheDocument();
    expect(screen.getByTestId("card-sql")).toHaveTextContent("WHERE c = $1");
    expect(screen.getByTestId("card-sql-params")).toHaveTextContent('flt_0_0 = "Search"');
  });

  it("says it has not run, and shows the statement as kept", () => {
    render(<CardSql cs={cs(null)} />);
    expect(screen.getByText(/It has not run here yet/)).toBeInTheDocument();
    expect(screen.getByTestId("card-sql")).toHaveTextContent("SUM(sale_price)");
    expect(screen.queryByTestId("card-sql-params")).toBeNull();
  });

  it("says why a card reading the dashboard's values shows its statement as kept", () => {
    render(<CardSql cs={cs(null)} readsValues />);
    expect(screen.getByText(/runs with each reader's own/)).toBeInTheDocument();
  });
});

describe("the Chart tab", () => {
  it("holds a dock for its own card only, and lets go of it when it closes", () => {
    const { unmount } = render(<ChartDock cardKey="card1" charted />);
    const dock = screen.getByTestId("card-chart-dock");
    const mine = renderHook(() => useVizDock("card1"));
    const other = renderHook(() => useVizDock("card2"));
    expect(mine.result.current).toBe(dock);
    expect(other.result.current).toBeNull();
    unmount();
    mine.rerender();
    expect(mine.result.current).toBeNull();
    act(() => setVizDock(null));
  });

  it("says a figure has no chart to set up", () => {
    render(<ChartDock cardKey="card1" charted={false} />);
    expect(screen.getByTestId("card-chart-none")).toHaveTextContent("draws a figure");
  });
});


describe("the period's setup (v15)", () => {
  const spec = (): DashboardSpec => {
    const s: DashboardSpec = JSON.parse(JSON.stringify(SPEC));
    const section = Object.entries(s.elements).find(([, e]) => e.type === "Section")![0];
    s.elements.period = { type: "Period", props: {}, children: [] };
    s.elements[section].children.unshift("period");
    return s;
  };

  it("names it, says what it opens on, and which date each card is cut by", () => {
    let next: DashboardSpec | null = null;
    render(<PieceSetup spec={spec()} selected="period" onChange={s => { next = s; }} connectionId="thelook"
      cardDates={() => [{ id: "card1", title: "Revenue by channel", date: "order_items.created_at", standing: false },
        { id: "card2", title: "Every order ever", date: null, standing: true }]} />);
    expect(screen.getByTestId("period-cuts")).toHaveTextContent("Revenue by channelorder_items.created_at");
    expect(screen.getByTestId("period-cuts")).toHaveTextContent("Every order everno date: read as written");
    expect(screen.getByTestId("setup-period-opens")).toHaveTextContent("Last month");
    void next;
  });
});
