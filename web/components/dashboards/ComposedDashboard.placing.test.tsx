// @vitest-environment jsdom
/**
 * Placing on the canvas (the user, 2026-11-19, of a peer product's editor): a global filter set down in a section is a box of
 * its own there, drawn for a reader as one in the filters column is; and while a box is carried or waits for what it is, the
 * section shows it where it goes.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, render, screen, within } from "@/lib/testing";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ComposedDashboard } from "@/components/dashboards/ComposedDashboard";
import { PlacementShown } from "@/components/dashboards/placementView";
import type { CardState } from "@/components/brief/PinnedCardBody";
import type { StoredCard } from "@/lib/api";

const dashboardFilterValues = vi.hoisted(() => vi.fn(async () => ({ values: [{ value: "Movie", n: 6131 }], more: false })));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), dashboardFilterValues }));
vi.mock("@/components/dashboards/DashboardTile", async (original) => ({
  ...(await original<typeof import("@/components/dashboards/DashboardTile")>()),
  DashboardTile: ({ cs }: { cs: CardState }) => <div>{cs.card.title}</div>,
}));

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const CARDS: CardState[] = [{ card: { id: "c7f3a001", title: "Return rate" } as StoredCard }, { card: { id: "c91b2002", title: "Net merchandise revenue" } as StoredCard }];
const HOST = { range: { status: "final" as const }, cards: { c7f3a001: { status: "within" as const }, c91b2002: { status: "within" as const } } };

function premise() {
  return JSON.parse(readFileSync(resolve(process.cwd(), "lib/dashboards/premise.fixture.json"), "utf8"));
}
const firstSection = (spec: { elements: Record<string, { type: string; children: string[]; props?: Record<string, unknown> }> }) =>
  Object.keys(spec.elements).find(k => spec.elements[k].type === "Section" && spec.elements[k].children.every(c => spec.elements[c]?.type !== "Section"))!;

describe("a global filter placed on the canvas", () => {
  it("is drawn in its section, as a box of its own, for a reader", async () => {
    const spec = premise();
    const sec = firstSection(spec);
    spec.elements["f-type"] = { type: "GlobalFilter", props: { title: "Type", kind: "multi", table: "titles", column: "type", x: 1, y: 1, w: 4, h: 2 }, children: [] };
    // a section on the grid holding the filter alone: a place is said only on a section's grid
    for (const k of spec.elements[sec].children) delete spec.elements[k];
    spec.elements[sec].children = ["f-type"];
    spec.elements[sec].props = { title: spec.elements[sec].props?.title ?? "Headline", grid: 12 };
    render(<ComposedDashboard spec={spec} cards={CARDS} host={HOST} focus={[]} onFocus={vi.fn()} doors={{ onRefresh: vi.fn() }} />);
    await act(async () => {});
    const section = screen.getAllByTestId("dashboard-section").find(s => s.dataset.key === sec)!;
    const placed = within(section).getByTestId("placed-filter");
    expect(within(placed).getByTestId("global-filter")).toHaveAttribute("aria-label", "Type");
    expect(screen.queryByTestId("global-filters")).toBeNull();                 // no column: it is not one of the column's
  });
});

describe("a box being placed", () => {
  it("shows in the section where the pointer would set it down, and the box set down, with what it waits for", () => {
    const spec = premise();
    const sec = firstSection(spec);
    render(
      <PlacementShown.Provider value={{ ghost: { section: sec, x: 7, y: 2, w: 6, h: 8, kind: "chart" }, box: { section: sec, x: 1, y: 12, w: 4, h: 2, kind: "filter" } }}>
        <ComposedDashboard spec={spec} cards={CARDS} host={HOST} doors={{ onRefresh: vi.fn() }} />
      </PlacementShown.Provider>,
    );
    const section = screen.getAllByTestId("dashboard-section").find(s => s.dataset.key === sec)!;
    const ghost = within(section).getByTestId("place-ghost");
    expect(ghost.style.left).toMatch(/0\.5/);                                  // half way: the seventh of twelve columns
    expect(ghost.style.top).toBe("40px");
    expect(within(section).getByTestId("place-box")).toHaveTextContent("A filter · choose what it is in the panel");
  });
});
