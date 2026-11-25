// @vitest-environment jsdom
/** An Area's relationships, plainly (A6; the raised drawing retired, 2026-11-25): the Area's entities and how they link,
 *  the links that leave it and for where, its processes stage by stage; an entity pressed opens on the right. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { AreaRelationships, partOf } from "@/components/ontology/AreaRelationships";
import type { ProcessesAndRules, TypeMap } from "@/lib/objectTypes";
import { fireEvent, render, screen } from "@/lib/testing";

const row = (object_type: string, display_name: string, table: string, rows = 10) => ({
  object_type, id: display_name, display_name, role: "business_object", domain: "", key: "id", key_verified: true, rows, table,
  display_property: "", display_is_key: true, properties: 4, bindings: 1, proposed_bindings: 0, links: 1, traversable_links: 1, actions: 0, metrics: 2,
});
const link = (from: string, to: string, verb: string) => ({ relationship: `${from}_${to}`, from, to, name: "", reverse_name: "", business_name: verb, verb, cardinality: "N:1", measured: true, traversable: true });
const MAP = {
  connection_id: "c1", schema_name: "s", generated_at: "",
  object_types: [row("order", "Order", "orders", 125042), row("order_item", "Order Item", "order_items"), row("user", "User", "users")],
  links: [link("order_item", "order", "belongs to"), link("order", "user", "placed by")],
} as unknown as TypeMap;
const DECLARED = { processes: [{ id: "fulfil", display_name: "Order Fulfilment", entity: "order", entity_id: "Order", objects: 125042,
  stages: [{ name: "placed", display_name: "placed", reached: 125042, promise: null }, { name: "shipped", display_name: "shipped", reached: 81140,
    promise: { open_overdue: 24911 } }], observed: [], leaves: { property: "status", values: ["Cancelled"], left: 18985, missing: [], unknown: 0, note: "" } }],
  rules: [] } as unknown as ProcessesAndRules;
const PLACED = new Map([["orders", { id: "orders_sales", name: "Orders & sales" }], ["order_items", { id: "orders_sales", name: "Orders & sales" }],
  ["users", { id: "customers", name: "Customers" }]]);

afterEach(() => vi.unstubAllGlobals());

describe("an Area's relationships", () => {
  it("keeps the Area's entities and the links among them, says the links that leave it and for where, and its processes", () => {
    const part = partOf(MAP, DECLARED, PLACED, "orders_sales");
    expect(part.map.object_types.map((t) => t.display_name)).toEqual(["Order", "Order Item"]);
    expect(part.map.links.map((l) => l.verb)).toEqual(["belongs to"]);
    expect(part.leaving).toEqual([{ from: "Order", verb: "placed by", to: "User", toArea: "Customers" }]);
    expect(part.processes.map((p) => p.id)).toEqual(["fulfil"]);
    expect(partOf(MAP, DECLARED, PLACED, "customers").processes).toEqual([]);
  });

  it("reads a part under its parent: its links are its parent's, never a link out of the Area; one link said once", () => {
    const map = { ...MAP, object_types: [...MAP.object_types, { ...row("order_line", "Order Line", "order_items"), absorbed_into: "order" },
      row("stock", "Inventory Item", "inventory_items")],
      links: [...MAP.links, link("order_line", "order", "belongs to"), { ...link("stock", "order_line", "fulfilled by"), shown_to: "order" },
        link("order", "user", "placed by")] } as unknown as TypeMap;
    const placed = new Map([...PLACED, ["inventory_items", { id: "orders_sales", name: "Orders & sales" }]]);
    const part = partOf(map, DECLARED, placed, "orders_sales");
    expect(part.map.object_types.map((t) => t.display_name)).toEqual(["Order", "Order Item", "Inventory Item"]);
    expect(part.map.links.map((l) => `${l.from}>${l.to}:${l.verb}`)).toContain("stock>order:fulfilled by");
    expect(part.leaving).toEqual([{ from: "Order", verb: "placed by", to: "User", toArea: "Customers" }]);
  });

  it("draws them with their links named, the stages with their counts, and opens an entity on a press", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/object-types")) return new Response(JSON.stringify(MAP));
      if (u.includes("/processes")) return new Response(JSON.stringify(DECLARED));
      if (u.includes("/discover/items")) return new Response(JSON.stringify({ items: [
        { kind: "table", name: "orders", area: "orders_sales", connection_id: "c1" }, { kind: "table", name: "order_items", area: "orders_sales", connection_id: "c1" },
        { kind: "table", name: "users", area: "customers", connection_id: "c1" }], total: 3 }));
      if (u.includes("/areas/")) return new Response(JSON.stringify({ areas: [{ id: "orders_sales", name: "Orders & sales" }, { id: "customers", name: "Customers" }] }));
      return new Response("{}", { status: 404 });
    }));
    const opened = vi.fn();
    render(<AreaRelationships area="orders_sales" connections={[{ id: "c1", name: "theLook" }]} onOpenEntity={opened} />);
    expect(await screen.findByTestId("area-entity-order")).toHaveTextContent("Order125,042 rows · key id ✓");
    expect(screen.getByTestId("area-relationships-graph")).toHaveTextContent("belongs to · N:1");
    expect(screen.getByTestId("area-link-out")).toHaveTextContent("Order placed by User — in Customers");
    expect(screen.getByTestId("area-process")).toHaveTextContent("Order Fulfilmentplaced125,042→shipped81,14024,911 overdue· 18,985 left (Cancelled)");
    fireEvent.click(screen.getByTestId("area-entity-order_item"));
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ display_name: "Order Item" }), { id: "c1", name: "theLook" });
  });
});
