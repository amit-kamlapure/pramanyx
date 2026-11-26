// @vitest-environment jsdom
/** A person's own searches on Discover (S2, 2026-11-25): kept under a name, one click to search again, forgotten at will. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMyPreferences = vi.fn();
const putMyPreference = vi.fn();
vi.mock("@/lib/api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMyPreferences: (...a: unknown[]) => getMyPreferences(...a),
  putMyPreference: (...a: unknown[]) => putMyPreference(...a),
}));

const { SavedSearches, searchName } = await import("@/components/discover/DiscoverPage");
const NONE = { conn: "", q: "", kind: "" as const, area: "", certified: false, mine: false, across: false };
const RETURNS = { name: "Returns tables", q: "returns", kind: "table", area: "", conn: "", certified: false, mine: false, across: true };

beforeEach(() => { getMyPreferences.mockReset(); putMyPreference.mockReset(); putMyPreference.mockResolvedValue(undefined); });

describe("searches a person keeps", () => {
  it("is named by its words, else by what it narrows to", () => {
    expect(searchName({ ...NONE, q: " orders " })).toBe("orders");
    expect(searchName({ ...NONE, kind: "metric", certified: true })).toBe("metric · certified");
  });

  it("searches again in one click and forgets one at will", async () => {
    getMyPreferences.mockResolvedValue({ user: "ana", preferences: { discover_searches: [RETURNS] } });
    const onPick = vi.fn();
    render(<SavedSearches filters={NONE} onPick={onPick} />);
    fireEvent.click(await screen.findByRole("button", { name: "Returns tables" }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ q: "returns", kind: "table", across: true }));
    fireEvent.click(screen.getByRole("button", { name: "Forget Returns tables" }));
    await waitFor(() => expect(putMyPreference).toHaveBeenCalledWith("discover_searches", []));
  });

  it("keeps the search on screen under the name its person gives it", async () => {
    getMyPreferences.mockResolvedValue({ user: "ana", preferences: {} });
    render(<SavedSearches filters={{ ...NONE, q: "orders", across: true }} onPick={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save this search" }));
    fireEvent.change(screen.getByLabelText("Name this search"), { target: { value: "All orders" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(putMyPreference).toHaveBeenCalledWith("discover_searches", [
      { name: "All orders", q: "orders", kind: "", area: "", conn: "", certified: false, mine: false, across: true }]));
    expect(await screen.findByRole("button", { name: "All orders" })).toBeTruthy();
  });
});
