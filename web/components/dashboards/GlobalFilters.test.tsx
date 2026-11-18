// @vitest-environment jsdom

/** Global filters (format v19): six ways to choose, each asking the cards for what the reader chose. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen, waitFor } from "@/lib/testing";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalFiltersColumn } from "@/components/dashboards/GlobalFilters";
import { MAX_GLOBAL_FILTERS } from "@/lib/dashboards/catalog";
import { addGlobalFilter, setProps, takeOff, type DashboardSpec } from "@/lib/dashboards/edit";
import { focusFor, focusWords, type DashboardFocus } from "@/lib/dashboards/focus";
import { fits, focusOfChoice, heldBy, stillHeld, withFilter, type GlobalFilterProps } from "@/lib/dashboards/globalFilters";
import { checkDashboardSpec } from "@/lib/dashboards/rules";

const dashboardFilterValues = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), dashboardFilterValues }));

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  dashboardFilterValues.mockReset();
  dashboardFilterValues.mockImplementation(async (_c: string, a: { read: string }) => (a.read === "range" ? { low: 1, high: 90 }
    : { values: [{ value: "Movie", n: 6131 }, { value: "TV Show", n: 2676 }], more: false }));
});

const premise = (): DashboardSpec => JSON.parse(readFileSync(resolve(process.cwd(), "lib/dashboards/premise.fixture.json"), "utf8"));
const P = (over: Partial<GlobalFilterProps>): GlobalFilterProps => ({ title: "Type", kind: "multi", table: "titles", column: "type", ...over });
function draw(p: GlobalFilterProps, focus: DashboardFocus[] = [], building = false) {
  const onFocus = vi.fn();
  render(<GlobalFiltersColumn filters={[{ key: "f1", props: p }]} connectionId="c" focus={focus} onFocus={onFocus} building={building} selected={null} />);
  return onFocus;
}
const asked = (onFocus: ReturnType<typeof vi.fn>) => focusFor(onFocus.mock.calls.at(-1)?.[0] as DashboardFocus[], "any");

describe("each way of choosing", () => {
  it("multiple values asks for any of those ticked", async () => {
    const onFocus = draw(P({}));
    fireEvent.click(await screen.findByRole("checkbox", { name: "TV Show" }));
    expect(asked(onFocus)).toEqual([{ table: "titles", column: "type", value: "", op: "in", values: ["TV Show"] }]);
  });

  it("a single value stands at All until one is chosen, and asks for the one chosen", async () => {
    const onFocus = draw(P({ kind: "single" }));
    expect((await screen.findByRole("combobox", { name: "Type" })).textContent).toContain("All");
    expect(onFocus).not.toHaveBeenCalled();
    const chosen = focusOfChoice("f1", P({ kind: "single" }), { kind: "single", value: "Movie" }) as DashboardFocus;
    expect(focusFor([chosen], "any")).toEqual([{ table: "titles", column: "type", value: "Movie" }]);
  });

  it("a single value without All always holds one, the commonest until a reader chooses", async () => {
    const onFocus = draw(P({ kind: "single", allow_all: false }));
    await waitFor(() => expect(onFocus).toHaveBeenCalled());
    expect(asked(onFocus)[0].value).toBe("Movie");
    expect(screen.getByRole("combobox", { name: "Type" }).textContent).not.toContain("All");
  });

  it("a date asks for that day, and a date range for the days between", () => {
    const onDay = draw(P({ kind: "date", title: "Added", column: "added" }));
    fireEvent.change(screen.getByLabelText("Added", { selector: "input" }), { target: { value: "2021-09-25" } });
    expect(asked(onDay)[0]).toMatchObject({ op: "dates", low: "2021-09-25", high: "2021-09-25" });
  });

  it("a date range may be open at one end", () => {
    const onRange = vi.fn();
    const held = focusOfChoice("f1", P({ kind: "date_range", title: "Added", column: "added" }), { kind: "date_range", low: "2021-01-01", high: "2021-12-31" }) as DashboardFocus;
    render(<GlobalFiltersColumn filters={[{ key: "f1", props: P({ kind: "date_range", title: "Added", column: "added" }) }]} connectionId="c" focus={[held]} onFocus={onRange} building={false} selected={null} />);
    fireEvent.change(screen.getByLabelText("Added: to"), { target: { value: "" } });
    expect(asked(onRange)[0]).toMatchObject({ op: "dates", low: "2021-01-01" });
    expect(asked(onRange)[0].high).toBeUndefined();
  });

  it("text asks once the words are finished", () => {
    const onFocus = draw(P({ kind: "text", title: "Title", column: "title" }));
    const box = screen.getByLabelText("Title", { selector: "input" });
    fireEvent.change(box, { target: { value: "  love " } });
    expect(onFocus).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(asked(onFocus)[0]).toMatchObject({ op: "contains", value: "love" });
  });

  it("a range slider runs between the least and the most the column holds", async () => {
    draw(P({ kind: "range", title: "Rating", column: "score" }));
    await waitFor(() => expect(screen.getByTestId("global-filter-range")).toHaveTextContent("190"));
    expect(dashboardFilterValues).toHaveBeenCalledWith("c", { table: "titles", column: "score", read: "range" });
  });
});

describe("the column", () => {
  it("shows a reader only the filters that have a field, and the builder every one", () => {
    const { unmount } = render(<GlobalFiltersColumn filters={[{ key: "f1", props: { kind: "multi", title: "New" } }]} connectionId="c" focus={[]} onFocus={vi.fn()} building={false} selected={null} />);
    expect(screen.queryByTestId("global-filters")).toBeNull();
    unmount();
    const onAdd = vi.fn();
    render(<GlobalFiltersColumn filters={[{ key: "f1", props: { kind: "multi", title: "New" } }]} connectionId="c" focus={[]} onFocus={vi.fn()} building selected="f1" onAdd={onAdd} />);
    expect(screen.getByText("Select a field to filter.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("global-filter-add"));
    expect(onAdd).toHaveBeenCalled();
  });

  it("says what each holds in the Filtered by bar, in the filter's own name", () => {
    const f = focusOfChoice("f1", P({}), { kind: "multi", values: ["Movie", "TV Show"] }) as DashboardFocus;
    expect(focusWords(f)).toBe("Type: Movie, TV Show");
    expect(focusWords(focusOfChoice("f1", P({ title: "Year" }), { kind: "range", low: 2000, high: 2010 }) as DashboardFocus)).toBe("Year: 2000 to 2010");
    expect(focusWords(focusOfChoice("f1", P({ title: "Name" }), { kind: "text", words: "love" }) as DashboardFocus)).toBe("Name: “love”");
  });

  it("holds one choice per filter, and lets go of what a changed filter no longer reads", () => {
    const one = focusOfChoice("f1", P({}), { kind: "multi", values: ["Movie"] }) as DashboardFocus;
    const held = withFilter(withFilter([], "f1", one), "f1", { ...one, values: ["TV Show"] });
    expect(held).toHaveLength(1);
    expect(heldBy(held, "f1", P({ column: "rating" }))).toBeNull();
    expect(stillHeld(held, { f1: P({ column: "rating" }) })).toEqual([]);
    expect(stillHeld(held, {})).toEqual([]);
    expect(stillHeld(held, { f1: P({}) })).toEqual(held);
  });

  it("offers a column only where the filter can read it", () => {
    expect([fits("date", "date"), fits("date_range", "time"), fits("range", "number"), fits("text", "number")]).toEqual([true, true, true, true]);
    expect([fits("date", "text"), fits("range", "text")]).toEqual([false, false]);
  });
});

describe("the dashboard's spec", () => {
  it("takes a global filter beside its pages, by the rules", () => {
    const made = addGlobalFilter(premise());
    expect(checkDashboardSpec(made.spec).issues).toEqual([]);
    const set = setProps(made.spec, made.key as string, { kind: "date_range", table: "titles", column: "added" });
    expect(checkDashboardSpec(set).issues).toEqual([]);
  });

  it("takes the column away with its last filter, and holds no more than it may", () => {
    const made = addGlobalFilter(premise());
    const gone = takeOff(made.spec, made.key as string);
    expect(Object.values(gone.elements).some(e => e.type === "GlobalFilters")).toBe(false);
    expect(checkDashboardSpec(gone).issues).toEqual([]);
    let s = premise() as DashboardSpec;
    for (let i = 0; i < MAX_GLOBAL_FILTERS; i++) s = addGlobalFilter(s).spec;
    expect(addGlobalFilter(s).key).toBeNull();
  });

  it("refuses a kind of filter it does not know", () => {
    const made = addGlobalFilter(premise());
    expect(checkDashboardSpec(setProps(made.spec, made.key as string, { kind: "slider" })).valid).toBe(false);
  });
});

describe("filters that wait, link and list (format v20)", () => {
  const two = [{ key: "kind", props: P({}) }, { key: "score", props: P({ title: "Score", column: "score" }) }];

  it("holds choices until Apply, and runs the cards once", async () => {
    const onFocus = vi.fn();
    render(<GlobalFiltersColumn filters={two.slice(0, 1)} connectionId="c" focus={[]} onFocus={onFocus} building={false} selected={null} applyButton />);
    fireEvent.click((await screen.findAllByRole("checkbox", { name: "Movie" }))[0]);
    fireEvent.click(screen.getByRole("checkbox", { name: "TV Show" }));
    expect(onFocus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("global-filters-apply"));
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus.mock.calls[0][0][0]).toMatchObject({ op: "in", values: ["Movie", "TV Show"] });
  });

  it("lets a waiting choice be discarded", async () => {
    const onFocus = vi.fn();
    render(<GlobalFiltersColumn filters={two.slice(0, 1)} connectionId="c" focus={[]} onFocus={onFocus} building={false} selected={null} applyButton />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Movie" }));
    fireEvent.click(screen.getByTestId("global-filters-discard"));
    expect(screen.queryByTestId("global-filters-apply")).toBeNull();
    expect(onFocus).not.toHaveBeenCalled();
  });

  it("asks a linked filter's list for what the other filters leave", async () => {
    const held: DashboardFocus[] = [{ table: "titles", column: "score", value: "", op: "in", values: [1], source: { card: "filter:score", field: "score" } }];
    render(<GlobalFiltersColumn filters={two} connectionId="c" focus={held} onFocus={vi.fn()} building={false} selected={null} />);
    await waitFor(() => expect(dashboardFilterValues).toHaveBeenCalledWith("c", expect.objectContaining({ column: "type", focus: [expect.objectContaining({ column: "score" })] })));
  });

  it("selects every value that matches what was typed", async () => {
    const onFocus = vi.fn();
    dashboardFilterValues.mockImplementation(async () => ({ more: false, values: Array.from({ length: 10 }, (_, i) => ({ value: i % 2 ? `Movie ${i}` : `Show ${i}`, n: 1 })) }));
    render(<GlobalFiltersColumn filters={two.slice(0, 1)} connectionId="c" focus={[]} onFocus={onFocus} building={false} selected={null} />);
    fireEvent.change(await screen.findByPlaceholderText("Find a value"), { target: { value: "movie" } });
    fireEvent.click(screen.getByTestId("global-filter-select-all"));
    expect(onFocus.mock.calls[0][0][0].values).toEqual(["Movie 1", "Movie 3", "Movie 5", "Movie 7", "Movie 9"]);
  });

  it("draws a filter held to a page only on that page", () => {
    const paged = [{ key: "kind", props: P({ page: "two" }) }];
    const { rerender } = render(<GlobalFiltersColumn filters={paged} connectionId="c" focus={[]} onFocus={vi.fn()} building={false} selected={null} page="one" />);
    expect(screen.queryByTestId("global-filter")).toBeNull();
    rerender(<GlobalFiltersColumn filters={paged} connectionId="c" focus={[]} onFocus={vi.fn()} building={false} selected={null} page="two" />);
    expect(screen.getByTestId("global-filter")).toBeInTheDocument();
  });
});
