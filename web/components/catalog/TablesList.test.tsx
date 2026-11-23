// @vitest-environment jsdom
/** The Catalog's tables list with this month's reads beside each table (Discover D5's popularity, in the Catalog). */
import { describe, expect, it } from "vitest";

import { TablesList, readsKey } from "@/components/catalog/CatalogTools";
import type { ScopeTable } from "@/lib/catalogSummary";
import { render, screen } from "@/lib/testing";

const table = (name: string): ScopeTable => ({ key: name, schema: "thelook", name, rows: 100, object: null, questions: null,
  questionsNote: "", metrics: 0, state: "read" } as unknown as ScopeTable);

describe("the tables list", () => {
  it("draws this month's reads as a column of their own only when they are asked for", () => {
    const { unmount } = render(<TablesList tables={[table("orders")]} onOpen={() => {}} />);
    expect(screen.queryByText("Read this month")).toBeNull();
    unmount();
    render(<TablesList tables={[table("orders"), table("users"), table("events")]} onOpen={() => {}} reads={{
      [readsKey("thelook", "orders")]: { measured: "reads", count: 1204, people: null, unattributed: null, last: null },
      [readsKey("thelook", "users")]: { measured: "reads", count: 0, people: 0, unattributed: 0, last: null } }} />);
    expect(screen.getByText("Read this month")).toBeInTheDocument();
    const cells = screen.getAllByTestId("catalog-table-reads");
    expect(cells.map(c => c.textContent)).toEqual(["1.2K", "—", "…"]);
    expect(cells[0].getAttribute("title")).toBe("read 1,204 times this month · who read it is not recorded");
    expect(cells[2].getAttribute("title")).toBe("Not read yet");
  });
});
