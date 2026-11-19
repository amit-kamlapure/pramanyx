// @vitest-environment jsdom
/**
 * One way to give a card of a person's own query its kind of chart (the user, 2026-11-19: "the chart type is not editable
 * ... two ways to edit a visualisation ... causing a major issue"): every kind listed together, the one in force marked,
 * and choosing one of the query's own clears any other the chart's settings held, so the card draws one way everywhere.
 */
import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ updateCard: vi.fn(async () => ({})) }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), ...api }));

import { QueryKindPick } from "@/components/dashboards/CardInspector";
import type { CardState } from "@/components/brief/PinnedCardBody";

const SETUP = { as: "bar", summed: false, x: "month", bucket: "month", series: [{ column: "orders", agg: "sum" }], split: "status", top: 6,
  segments: "stacked", running: false, labels: false, columns: [], sort: "", descending: true, label: "" };
const card = (render: Record<string, unknown>): CardState => ({ card: { id: "c1", title: "Orders by status", render } } as unknown as CardState);

beforeEach(() => { api.updateCard.mockClear(); });

describe("a card's kind of chart, in one place", () => {
  it("lists the query's own kinds with the one in force marked", () => {
    render(<QueryKindPick cs={card({ shown: SETUP, viz: { type: "bar" } })} onKept={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Bar" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("radio").map(r => r.dataset.kind)).toEqual(["bar", "line", "area", "scatter"]);
  });

  it("keeps the query's own kind with its setup, and clears a kind the chart's settings held", async () => {
    const onKept = vi.fn();
    render(<QueryKindPick cs={card({ shown: SETUP, viz: { type: "multi_line", yLog: true } })} onKept={onKept} />);
    fireEvent.click(screen.getByRole("radio", { name: "Line" }));
    await waitFor(() => expect(onKept).toHaveBeenCalled());
    const [, sent] = api.updateCard.mock.calls[0] as unknown as [string, { render: { shown: { as: string }; viz: Record<string, unknown> } }];
    expect(sent.render.shown.as).toBe("line");
    expect(sent.render.viz).toEqual({ yLog: true });                         // its other settings stay, its kind goes
  });

  it("sends a table or a figure to where its columns are set", () => {
    render(<QueryKindPick cs={card({ shown: { ...SETUP, as: "table" } })} onKept={vi.fn()} />);
    expect(screen.getByTestId("query-kind-none")).toHaveTextContent("Drawn as a table");
  });
});
