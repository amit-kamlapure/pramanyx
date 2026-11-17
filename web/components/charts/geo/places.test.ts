import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchPlaces, placeColumn, placeKey, shapeOf } from "@/components/charts/geo/places";

/** The shapes the install ships, read from disk: every name the tables point at must be one a shape carries. */
const shipped = (file: string) =>
  new Set((JSON.parse(readFileSync(join(__dirname, "../../../public/geo", file), "utf8")) as {
    features: { properties: { name: string } }[];
  }).features.map((f) => f.properties.name));

describe("which shapes a column of places fills", () => {
  it("names only shapes the install ships", () => {
    const world = shipped("world.json");
    const states = shipped("us-states.json");
    for (const v of ["Brasil", "España", "Deutschland", "South Korea", "USA", "UK", "IND", "Côte d'Ivoire", "Czechia"]) {
      expect(world.has(shapeOf("countries", v)!), v).toBe(true);
    }
    for (const v of ["CA", "Texas", "washington dc", "New York"]) expect(states.has(shapeOf("us_states", v)!), v).toBe(true);
  });

  it("reads a country column with the spellings theLook carries", () => {
    const m = matchPlaces(["Brasil", "España", "Deutschland", "United States", "China", "South Korea", "Brasil"])!;
    expect(m.set).toBe("countries");
    expect(m.shapes.get("Brasil")).toBe("Brazil");
    expect(m.shapes.get("España")).toBe("Spain");
    expect(m.shapes.get("South Korea")).toBe("Korea");
    expect(m.unmatched).toEqual([]);
    expect(m.distinct).toBe(6);
  });

  it("takes a column of postal codes as US states, though some are country codes too", () => {
    const m = matchPlaces(["CA", "TX", "NY", "IN", "AL", "WA"])!;
    expect(m.set).toBe("us_states");
    expect(m.shapes.get("IN")).toBe("Indiana");
  });

  it("takes country codes as countries, though some are US state codes too", () => {
    const m = matchPlaces(["IN", "CA", "FR", "DE", "JP", "BR"])!;
    expect(m.set).toBe("countries");
    expect(m.shapes.get("IN")).toBe("India");
  });

  it("says which values matched no shape, and matches none of a region column", () => {
    const m = matchPlaces(["Texas", "California", "Guangdong", "São Paulo"])!;
    expect(m.set).toBe("us_states");
    expect(m.unmatched).toEqual(["Guangdong", "São Paulo"]);
    expect(matchPlaces(["North", "South", "East", "West"])).toBeNull();
  });

  it("keeps 'NA' as not available, never Namibia", () => {
    expect(shapeOf("countries", "NA")).toBeNull();
    expect(shapeOf("countries", "Namibia")).toBe("Namibia");
  });

  it("keys a name without its accents, case, dots or a leading 'the'", () => {
    expect(placeKey("  The Bahamas ")).toBe("bahamas");
    expect(placeKey("U.S.A.")).toBe("usa");
    expect(placeKey("Côte d’Ivoire")).toBe("cote divoire");
  });

  it("finds the place column only when most of its values are places", () => {
    const columns = ["product", "country", "orders"];
    const rows = [["Georgia peach", "France", 3], ["Jeans", "Spain", 4], ["Hat", "Brasil", 5]];
    expect(placeColumn(columns, rows, [0, 1])?.column).toBe("country");
    expect(placeColumn(["region", "orders"], [["North", 1], ["South", 2]], [0])).toBeNull();
  });
});
